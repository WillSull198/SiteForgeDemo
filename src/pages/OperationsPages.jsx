/* SiteForge audit: Repaired live operations workflows for project creation,
   diary-to-variation conversion, variation template selection, document preview,
   plan search, annotations, and settings persistence. */

import { useEffect, useMemo, useState } from "react";
import { flagBudgetAnomaly, suggestRFI, suggestRfiSmart } from "../services/aiDraftService";
import { AI_PROVIDERS, AI_STORAGE_KEYS, DEFAULT_AI_MODELS, askSiteForgeAi, getStoredAiConfig, normaliseAiProvider, normaliseOpenAiProxyUrl, testAiConnection as runProviderConnectionTest, verifyOpenAiProxy } from "../services/aiService";
import DataTable from "../components/DataTable";
import FileDropZone from "../components/FileDropZone";
import PhotoUpload from "../components/PhotoUpload";
import VoiceRecorder, { AudioNotePlayer } from "../components/VoiceRecorder";
import PDFViewer from "../components/PDFViewer";
import { exportCsv, exportElementToPdf } from "../services/pdfService";
import { previewPdf } from "../services/documentIntelligence";
import { deletePersistedAppState, persistAppState } from "../services/dbService";
import { getAll as getAllRecords, put as putRecord } from "../services/db";
import { COMPLIANCE_DOC_TYPES, complianceLabel, complianceStatusFor, complianceTone, requiredDocsForTrade } from "../services/compliance";
import { useSiteForge } from "../services/siteforgeStore";
import { can, canSeeAllSites, mustHandUpForApproval } from "../services/permissions";
import { clearStateSlot, getStateStorageKey, readStateSlot, storageSlotExists, writeStateSlot } from "../services/storageMode";
import { Icons } from "../components/icons";
import {
  Badge,
  Button,
  Card,
  DetailHeader,
  EmptyState,
  LinkedRecordsPanel,
  MetricGrid,
  Modal,
  RestrictedPanel,
  Tabs,
  Timeline,
} from "../components/ui";

const INCLUDE_DEMO_DATA = import.meta.env.VITE_INCLUDE_DEMO_DATA !== "false";

const aiSourceLabel = (source) => {
  if (source === "openai") return "ChatGPT";
  if (source === "claude") return "Claude";
  if (source === "local-template") return "Local template";
  if (source === "ai-parse-error") return "AI parse error";
  return source || "summary";
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function extractionStatusMeta(status) {
  const map = {
    complete: { label: "Text searchable", tone: "passed", help: "PDF text layer extracted and available for plan search." },
    "no-text-layer": { label: "Scanned PDF", tone: "medium", help: "No embedded text layer was found. Add a manual searchable description." },
    encrypted: { label: "Encrypted", tone: "critical", help: "Password-protected files cannot be searched until unlocked and re-uploaded." },
    failed: { label: "Extraction failed", tone: "critical", help: "Text extraction failed. Add a manual searchable description." },
    "pdfjs-unavailable": { label: "Extractor unavailable", tone: "medium", help: "PDF.js was unavailable in this browser session." },
    "not-run": { label: "Not extracted", tone: "medium", help: "This file type has no extraction result." },
  };
  return map[status] || map["not-run"];
}

function useSessionState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn("Failed to persist session filter", error);
    }
  }, [key, value]);

  return [value, setValue];
}

function SearchFilterBar({ storageKey, placeholder = "Search...", statusOptions = [], onChange }) {
  const [filters, setFilters] = useSessionState(storageKey, { query: "", status: "all" });

  useEffect(() => {
    onChange?.(filters);
  }, [filters, onChange]);

  return (
    <div className="table-filters">
      <div className="sb">
        <span>⌘K</span>
        <input
          value={filters.query}
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          placeholder={placeholder}
        />
      </div>
      {statusOptions.length ? (
        <select className="role-select" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="all">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      ) : null}
      <Button small onClick={() => setFilters({ query: "", status: "all" })}>
        Clear Filters
      </Button>
    </div>
  );
}

function validateABN(value) {
  const digits = String(value || "").replace(/\s/g, "").split("").map(Number);
  if (digits.length !== 11 || digits.some(Number.isNaN)) return false;
  digits[0] -= 1;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = digits.reduce((total, digit, index) => total + digit * weights[index], 0);
  return sum % 89 === 0;
}

function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
}

function validAuPhone(value) {
  return !value || /^\+?61\s?[2-478]\s?\d{4}\s?\d{4}$|^0[2-478]\s?\d{4}\s?\d{4}$/.test(String(value).replace(/[()-]/g, ""));
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function collectBlobReferenceIds(payload) {
  const ids = { photos: new Set(), audio: new Set() };
  const stack = [payload];
  const seen = new WeakSet();
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value.photos)) {
      value.photos.forEach((photo) => {
        if (photo && typeof photo === "object" && photo.id) ids.photos.add(photo.id);
      });
    }
    if (Array.isArray(value.voiceNotes)) {
      value.voiceNotes.forEach((note) => {
        if (note && typeof note === "object" && note.id) ids.audio.add(note.id);
      });
    }
    Object.entries(value).forEach(([key, child]) => {
      if (["data", "dataUrl", "thumbnailDataUrl", "base64", "blobData"].includes(key)) return;
      if (child && typeof child === "object") stack.push(child);
    });
  }
  return ids;
}

async function buildBackupBundle(payload) {
  const blobIds = collectBlobReferenceIds(payload);
  const base = {
    exportVersion: 2,
    exportedAt: new Date().toISOString(),
    state: payload,
    blobs: { photos: {}, audio: {} },
  };
  if (!blobIds.photos.size && !blobIds.audio.size) return base;
  const [photos, audio] = await Promise.all([
    getAllRecords("photos").catch(() => []),
    getAllRecords("audio").catch(() => []),
  ]);
  const photoBundle = {};
  const audioBundle = {};
  photos.forEach((record) => {
    if (record?.id && blobIds.photos.has(record.id)) photoBundle[record.id] = record;
  });
  await Promise.all(
    audio
      .filter((record) => record?.id && blobIds.audio.has(record.id))
      .map(async (record) => {
        audioBundle[record.id] = {
          ...record,
          blob: undefined,
          dataUrl: record.blob ? await blobToDataUrl(record.blob) : record.dataUrl,
        };
      }),
  );
  return {
    ...base,
    state: payload,
    blobs: { photos: photoBundle, audio: audioBundle },
  };
}

async function restoreBackupBlobs(blobs) {
  const photos = Object.values(blobs?.photos || {});
  const audio = Object.values(blobs?.audio || {});
  const audioRecords = await Promise.all(
    audio
      .filter((note) => note?.id)
      .map(async (note) => ({
        ...note,
        blob: note.blob || (note.dataUrl ? await dataUrlToBlob(note.dataUrl) : null),
        dataUrl: undefined,
      })),
  );
  await Promise.all([
    ...photos.filter((photo) => photo?.id).map((photo) => putRecord("photos", photo)),
    ...audioRecords.filter((note) => note?.id && note.blob).map((note) => putRecord("audio", note)),
  ]);
}

function PortfolioPage() {
  const { state, actions } = useSiteForge();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    projectName: "",
    clientFirstName: "",
    clientLastName: "",
    clientEmail: "",
    clientPhone: "",
    siteAddress: "",
    contractValue: "",
    contractType: "HIA",
    startDate: "",
    expectedCompletionDate: "",
    supervisorAssigned: "Dave Mitchell",
    status: "Active",
  });
  const metrics = [
    { label: "Active Sites", value: state.sites.filter((site) => site.status === "active").length, color: "g" },
    { label: "Contract Value", value: `$${(state.sites.reduce((sum, site) => sum + (Number(site.contractValue) || 0), 0) / 1e6).toFixed(1)}M`, color: "a" },
    { label: "Margin At Risk", value: `$${Math.round(state.sites.reduce((sum, site) => sum + (Number(site.marginAtRisk) || 0), 0) / 1000)}k`, color: "r" },
    { label: "Clients", value: state.clients.length, color: "b" },
  ];

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div>
          <div className="b md">Portfolio</div>
          <div className="xs ct3">Create projects, switch sites, and see commercial risk at a glance.</div>
        </div>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
          New Project
        </Button>
      </div>
      <MetricGrid columns={4} items={metrics} />
      <div className="g2">
        {state.sites.map((site) => (
          <button className="pc" key={site.id} onClick={() => actions.navigate({ kind: "internal", siteId: site.id, page: "dash", entityId: null })} type="button">
            <div className="fb mb4">
              <div>
                <div className="md bb">{site.name}</div>
                <div className="xs ct3">
                  {site.address} · {site.region}
                </div>
              </div>
              <Badge tone={site.risk === "red" ? "critical" : site.risk === "amber" ? "high" : "passed"}>{site.risk}</Badge>
            </div>
            <div className="pb mb4">
              <div className="pf" style={{ width: `${site.progress}%`, background: "linear-gradient(90deg,var(--gn),var(--am))" }} />
            </div>
            <div className="fb xs ct3">
              <span>{site.progress}% complete</span>
              <span>{site.currentPhase}</span>
            </div>
            <div className="g2" style={{ marginTop: 8 }}>
              <div>
                <div className="xs ct3">Contract</div>
                <div className="mono b">${Math.round((Number(site.contractValue) || 0) / 1000)}k</div>
              </div>
              <div>
                <div className="xs ct3">Margin at risk</div>
                <div className="mono b">${(site.marginAtRisk || 0).toLocaleString()}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
      <Modal open={open} close={() => setOpen(false)} title="Create New Project" wide>
        {error ? <div className="form-error mb8">{error}</div> : null}
        <div className="ff">
          <label>Project name</label>
          <input value={form.projectName} onChange={(event) => setForm((current) => ({ ...current, projectName: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Client first name</label>
            <input value={form.clientFirstName} onChange={(event) => setForm((current) => ({ ...current, clientFirstName: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Client last name</label>
            <input value={form.clientLastName} onChange={(event) => setForm((current) => ({ ...current, clientLastName: event.target.value }))} />
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Client email</label>
            <input type="email" value={form.clientEmail} onChange={(event) => setForm((current) => ({ ...current, clientEmail: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Client phone</label>
            <input value={form.clientPhone} onChange={(event) => setForm((current) => ({ ...current, clientPhone: event.target.value }))} />
          </div>
        </div>
        <div className="ff">
          <label>Site address</label>
          <input value={form.siteAddress} onChange={(event) => setForm((current) => ({ ...current, siteAddress: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Contract value (AUD)</label>
            <input type="number" min="1" value={form.contractValue} onChange={(event) => setForm((current) => ({ ...current, contractValue: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Contract type</label>
            <select value={form.contractType} onChange={(event) => setForm((current) => ({ ...current, contractType: event.target.value }))}>
              {["HIA", "AS4000", "AS2124", "MBA", "Custom"].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Start date</label>
            <input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Expected completion</label>
            <input type="date" value={form.expectedCompletionDate} onChange={(event) => setForm((current) => ({ ...current, expectedCompletionDate: event.target.value }))} />
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Supervisor assigned</label>
            <input value={form.supervisorAssigned} onChange={(event) => setForm((current) => ({ ...current, supervisorAssigned: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Status</label>
            <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              {["Active", "On Hold", "Completed"].map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              const required = [form.projectName, form.clientFirstName, form.clientLastName, form.clientEmail, form.siteAddress, form.contractValue];
              if (required.some((value) => !String(value || "").trim())) {
                setError("Fill the required project, client, address and contract value fields before saving.");
                return;
              }
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.clientEmail)) {
                setError("Enter a valid client email so portal notifications can be sent.");
                return;
              }
              actions.createProject(form);
              setOpen(false);
              setError("");
              setForm({
                projectName: "",
                clientFirstName: "",
                clientLastName: "",
                clientEmail: "",
                clientPhone: "",
                siteAddress: "",
                contractValue: "",
                contractType: "HIA",
                startDate: "",
                expectedCompletionDate: "",
                supervisorAssigned: "Dave Mitchell",
                status: "Active",
              });
            }}
          >
            Create Project
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function DashboardPage() {
  const { state, actions, derived } = useSiteForge();
  const site = derived.currentSite;
  const role = state.session.role;
  if (!site) {
    return (
      <div className="oy fin">
        <Card title="Project setup required" icon={Icons.briefcase}>
          <EmptyState
            icon={Icons.briefcase}
            title="No project is available for this route"
            description="The dashboard needs a valid project. Restart onboarding to recreate the first project and repair the session."
            action={<Button tone="bt-p" onClick={() => actions.restartOnboarding()}>Restart Onboarding</Button>}
          />
        </Card>
      </div>
    );
  }
  const siteApprovals = state.approvals.filter((approval) => approval.siteId === site.id);
  const todaysCrew = state.presence.records.filter((record) => record.siteId === site.id && record.status === "verified-on-site");
  const openProblems = state.problems.filter((problem) => problem.siteId === site.id && ["open", "under-review"].includes(problem.status));
  const arrivingToday = state.procurement.filter((item) => item.siteId === site.id && item.eta === new Date().toISOString().slice(0, 10));
  const qaDue = state.qa.filter((entry) => entry.siteId === site.id && entry.date === new Date().toISOString().slice(0, 10));
  const siteMetric = derived.metrics.siteMetrics.find((metric) => metric.siteId === site.id);
  const openRainEvent = state.diary.find((entry) => entry.siteId === site.id && entry.rainEvent);

  const quickActions =
    mustHandUpForApproval(role)
      ? [
          { label: "Report Problem", icon: Icons.alert, onClick: () => actions.navigate({ kind: "internal", siteId: site.id, page: "probs", entityId: null }) },
          { label: "Check In Crew", icon: Icons.login, onClick: () => actions.navigate({ kind: "internal", siteId: site.id, page: "passport", entityId: null }) },
          {
            label: "Rain Day Claim",
            icon: Icons.sun,
            onClick: () => (openRainEvent ? actions.createRainDayClaim(openRainEvent.id) : actions.navigate({ kind: "internal", siteId: site.id, page: "diary", entityId: null })),
          },
          { label: "Request Material", icon: Icons.box, onClick: () => actions.navigate({ kind: "internal", siteId: site.id, page: "mats", entityId: null }) },
          {
            label: "Raise Issue to PM",
            icon: Icons.link,
            onClick: () =>
              openProblems[0]
                ? actions.createApprovalFromSource({ sourceType: "problem", sourceId: openProblems[0].id, approvalType: "Variation", handUp: mustHandUpForApproval(role) })
                : actions.navigate({ kind: "internal", siteId: site.id, page: "probs", entityId: null }),
          },
        ]
      : [
          { label: "New Approval", icon: Icons.flag, onClick: () => actions.navigate({ kind: "internal", siteId: site.id, page: "clientflow", entityId: null }) },
          { label: "Open Schedule", icon: Icons.cal, onClick: () => actions.navigate({ kind: "internal", siteId: site.id, page: "sched", entityId: null }) },
          { label: "Open Budget", icon: Icons.dollar, onClick: () => actions.navigate({ kind: "internal", siteId: site.id, page: "budget", entityId: null }) },
        ];

  const metrics =
    can(role, "budget.view")
      ? [
          { label: "Margin At Risk", value: `$${Math.round(siteMetric?.costExposure || 0)}`, color: "r" },
          { label: "Programme At Risk", value: `${siteMetric?.timeExposure || 0}d`, color: "a" },
          { label: "Client Awaiting", value: siteApprovals.filter((approval) => approval.status === "awaiting-client").length, color: "b" },
          { label: "Overdue RFIs", value: state.rfis.filter((rfi) => rfi.siteId === site.id && rfi.status === "overdue").length, color: "o" },
        ]
      : [
          { label: "Crew Today", value: todaysCrew.length, color: "g" },
          { label: "Open Problems", value: openProblems.length, color: "r" },
          { label: "Stalled Approvals", value: siteApprovals.filter((approval) => ["question", "changes-requested"].includes(approval.status)).length, color: "a" },
          { label: "QA Due", value: qaDue.length, color: "b" },
        ];

  return (
    <div className="oy fin">
      <MetricGrid columns={4} items={metrics} />
      <div className="quick-bar">
        {quickActions.map((action) => (
          <Button key={action.label} icon={action.icon} onClick={action.onClick} className="touch-button">
            {action.label}
          </Button>
        ))}
      </div>
      <div className="g23">
        <div>
          <Card title="Enhanced Command Centre" icon={Icons.grid} className="mb8">
            <div className="g2">
              <div className="mini-panel">
                <div className="xs ct3">Affected trades</div>
                <div className="sm ct2" style={{ marginTop: 6 }}>
                  {(siteMetric?.affectedTrades || []).join(", ") || "Carpentry, Waterproofing, Electrical"}
                </div>
              </div>
              <div className="mini-panel">
                <div className="xs ct3">Commercial exposure</div>
                <div className="sm ct2" style={{ marginTop: 6 }}>
                  ${Math.round(siteMetric?.costExposure || 0).toLocaleString()} across open issues and approvals.
                </div>
              </div>
              <div className="mini-panel">
                <div className="xs ct3">Recovery status</div>
                <div className="sm ct2" style={{ marginTop: 6 }}>
                  {siteMetric?.stalledApprovals ? "Commercial recovery is active but waiting on approvals." : "Recovery actions are largely current."}
                </div>
              </div>
              <div className="mini-panel">
                <div className="xs ct3">Downstream impact</div>
                <div className="sm ct2" style={{ marginTop: 6 }}>
                  {siteMetric?.timeExposure || 0} days currently exposed on linked programme items.
                </div>
              </div>
            </div>
          </Card>
          <Card title="Priority Issues" icon={Icons.alert}>
            <div className="list-stack">
              {openProblems.map((problem) => (
                <div className="act" key={problem.id}>
                  <div style={{ flex: 1 }}>
                    <div className="b sm">{problem.title}</div>
                    <div className="xs ct3">
                      ${problem.costImpact.toLocaleString()} · {problem.timeImpact}d
                    </div>
                  </div>
                  <Button small tone="bt-p" onClick={() => actions.createApprovalFromSource({ sourceType: "problem", sourceId: problem.id, approvalType: "Variation", handUp: mustHandUpForApproval(role) })}>
                    Raise Approval
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div>
          <Card title="Today's Crew" icon={Icons.users} className="mb8">
            <div className="list-stack">
              {todaysCrew.map((record) => (
                <div className="linked-row" key={record.id}>
                  <div>
                    <div className="b sm">{record.person}</div>
                    <div className="xs ct3">{record.status}</div>
                  </div>
                  <Badge tone="passed">{record.confidence}%</Badge>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Arrivals & QA Due" icon={Icons.truck}>
            <div className="list-stack">
              {arrivingToday.map((item) => (
                <div className="linked-row" key={item.id}>
                  <div>
                    <div className="b sm">{item.item}</div>
                    <div className="xs ct3">ETA today</div>
                  </div>
                  <Badge tone="medium">{item.status}</Badge>
                </div>
              ))}
              {qaDue.map((entry) => (
                <div className="linked-row" key={entry.id}>
                  <div>
                    <div className="b sm">{entry.title}</div>
                    <div className="xs ct3">{entry.type}</div>
                  </div>
                  <Badge tone="high">Due today</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TasksPage() {
  const { state, actions } = useSiteForge();
  const siteId = state.session.siteId;
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ title: "", description: "", trade: "General", priority: "medium", dueDate: "" });
  const tasks = state.tasks.filter((task) => task.siteId === siteId && !task.archived);
  const editTask = tasks.find((task) => task.id === editId) || null;

  useEffect(() => {
    if (editTask) {
      setForm({
        title: editTask.title,
        description: editTask.description,
        trade: editTask.trade,
        priority: editTask.priority || "medium",
        dueDate: editTask.dueDate || "",
      });
    }
  }, [editTask]);

  const columns = [
    {
      key: "title",
      label: "Task",
      filterable: true,
      render: (_, row) => (
        <div>
          <div className="b sm">{row.title}</div>
          <div className="xs ct3">{row.description}</div>
        </div>
      ),
    },
    { key: "trade", label: "Trade", filterable: true, options: ["General", "Carpentry", "Electrical", "Plumbing", "Waterproofing", "Concrete"] },
    { key: "dueDate", label: "Due", type: "date", filterable: true, render: (value) => <span className="xs">{value}</span> },
    {
      key: "status",
      label: "Status",
      filterable: true,
      options: ["todo", "in-progress", "done"],
      render: (value) => <Badge tone={value === "done" ? "passed" : value === "in-progress" ? "medium" : "high"}>{value}</Badge>,
    },
    {
      key: "progress",
      label: "Progress",
      type: "number",
      filterable: true,
      render: (value) => (
        <div className="pb" style={{ minWidth: 100 }}>
          <div className="pf" style={{ width: `${value}%`, background: "var(--am)" }} />
        </div>
      ),
    },
  ];

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
          New Task
        </Button>
      </div>
      <DataTable
        storageKey={`tasks-${siteId}`}
        title="Tasks"
        columns={columns}
        rows={tasks}
        bulkActions={[
          { label: "Archive", tone: "bt-r", onClick: (ids) => ids.forEach((id) => actions.archiveEntity("task", id)) },
          { label: "Mark In Progress", onClick: (ids) => actions.bulkUpdateTasks(ids, "in-progress") },
          { label: "Mark Done", tone: "bt-g", onClick: (ids) => actions.bulkUpdateTasks(ids, "done") },
        ]}
        rowActions={[
          { label: "Edit", onClick: (row) => setEditId(row.id) },
          { label: "Start", when: (row) => row.status === "todo", onClick: (row) => actions.updateTaskStatus(row.id, "in-progress") },
          { label: "Done", tone: "bt-g", when: (row) => row.status !== "done", onClick: (row) => actions.updateTaskStatus(row.id, "done") },
          { label: "Reopen", when: (row) => row.status === "done", onClick: (row) => actions.reopenTask(row.id) },
          { label: "Duplicate", onClick: (row) => actions.duplicateEntity("task", row.id) },
          { label: "Delete", tone: "bt-r", onClick: (row) => actions.deleteEntity("task", row.id) },
        ]}
      />
      <Modal open={open} close={() => setOpen(false)} title="Create Task">
        <div className="ff">
          <label>Title</label>
          <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Trade</label>
            <select value={form.trade} onChange={(event) => setForm((current) => ({ ...current, trade: event.target.value }))}>
              {state.trades?.map?.((trade) => (
                <option key={trade}>{trade}</option>
              )) || ["General", "Carpentry", "Electrical", "Plumbing"].map((trade) => <option key={trade}>{trade}</option>)}
            </select>
          </div>
          <div className="ff">
            <label>Priority</label>
            <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
              {["critical", "high", "medium", "low"].map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="ff">
          <label>Due Date</label>
          <input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} />
        </div>
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addTask(form);
              setOpen(false);
              setForm({ title: "", description: "", trade: "General", priority: "medium", dueDate: "" });
            }}
          >
            Create Task
          </Button>
        </div>
      </Modal>
      <Modal open={Boolean(editTask)} close={() => setEditId(null)} title="Edit Task">
        <div className="ff">
          <label>Title</label>
          <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Trade</label>
            <input value={form.trade} onChange={(event) => setForm((current) => ({ ...current, trade: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Due Date</label>
            <input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} />
          </div>
        </div>
        <div className="fa">
          <Button onClick={() => setEditId(null)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.updateEntity("task", editId, form);
              setEditId(null);
            }}
          >
            Save Task
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function ProblemsPage() {
  const { state, actions, derived } = useSiteForge();
  const role = state.session.role;
  const siteId = state.session.siteId;
  const routeEntityId = state.session.route?.entityId;
  const accessibleSiteIds = new Set(derived.accessibleSites.map((site) => site.id));
  const [selectedId, setSelectedId] = useState(routeEntityId || state.problems.find((problem) => problem.siteId === siteId)?.id || null);
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useSessionState("sf-problems-status", "all");
  const [priorityFilter, setPriorityFilter] = useSessionState("sf-problems-priority", "all");
  const [reply, setReply] = useState("");
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", costImpact: "", timeImpact: "", photos: [] });
  const canView = can(role, "problems.view");
  const canCreateProblem = can(role, "problems.create");
  const canResolveProblem = can(role, "problems.resolve");
  const canEscalateProblem = can(role, "problems.escalate");
  const scopedProblems = state.problems.filter((problem) => {
    if (canSeeAllSites(role) || can(role, "problems.escalate")) {
      return accessibleSiteIds.has(problem.siteId);
    }
    return problem.siteId === siteId;
  });
  const problems = scopedProblems.filter((problem) => {
    const statusOk = statusFilter === "all" || problem.status === statusFilter;
    const priorityOk = priorityFilter === "all" || problem.priority === priorityFilter;
    return statusOk && priorityOk;
  });
  const selected = problems.find((problem) => problem.id === selectedId) || problems[0];

  useEffect(() => {
    if (routeEntityId) {
      setSelectedId(routeEntityId);
    }
  }, [routeEntityId]);

  if (!canView) {
    return <RestrictedPanel title="Problems" body="Your current role cannot view site problems." />;
  }

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div className="fx" style={{ gap: 6, flexWrap: "wrap" }}>
          <Badge tone="critical">{problems.filter((problem) => problem.priority === "critical").length} critical</Badge>
          <Badge tone="medium">{problems.filter((problem) => problem.status === "open").length} open</Badge>
          <select className="role-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {["all", "open", "in-progress", "resolved", "closed"].map((status) => (
              <option key={status} value={status}>{status === "all" ? "All status" : status}</option>
            ))}
          </select>
          <select className="role-select" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
            {["all", "critical", "high", "medium", "low"].map((priority) => (
              <option key={priority} value={priority}>{priority === "all" ? "All priority" : priority}</option>
            ))}
          </select>
        </div>
        {canCreateProblem ? (
          <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
            Report Problem
          </Button>
        ) : null}
      </div>
      <div className="g32">
        <Card title="Problems" icon={Icons.alert}>
          <div className="list-stack">
            {problems.map((problem) => (
              <button className={`act text-button ${selected?.id === problem.id ? "row-selected" : ""}`.trim()} key={problem.id} onClick={() => setSelectedId(problem.id)} type="button">
                <div style={{ flex: 1 }}>
                  <div className="b sm">{problem.title}</div>
                  <div className="xs ct3">
                    ${problem.costImpact.toLocaleString()} · {problem.timeImpact}d
                  </div>
                </div>
                <Badge tone={problem.priority === "critical" ? "critical" : "high"}>{problem.priority}</Badge>
              </button>
            ))}
          </div>
        </Card>
        {selected ? (
          <div>
            <Card title="Problem Detail" icon={Icons.file} className="mb8">
              <DetailHeader
                title={selected.title}
                subtitle={selected.category}
                badges={[
                  { label: selected.status, tone: selected.status === "open" ? "medium" : "passed" },
                  { label: `$${selected.costImpact.toLocaleString()}`, tone: "high" },
                  { label: `${selected.timeImpact}d`, tone: "medium" },
                ]}
                actions={[
                  canEscalateProblem
                    ? {
                        label: "Raise Approval",
                        tone: "bt-p",
                        icon: Icons.link,
                        dataTestId: "problem-raise-approval",
                        onClick: () => actions.createApprovalFromSource({ sourceType: "problem", sourceId: selected.id, approvalType: "Variation", handUp: mustHandUpForApproval(role) }),
                      }
                    : null,
                  {
                    label: "→ RFI",
                    icon: Icons.help,
                    tone: "bt-p",
                    dataTestId: "problem-raise-rfi",
                    onClick: async () => {
                      const suggestion = suggestRFI(selected);
                      const rfiId = actions.createRfiFromProblem(selected.id, {
                        title: suggestion.title,
                        description: suggestion.description,
                        to: suggestion.recommendedRecipient,
                        trade: "General",
                      });
                      const integrationSettings = state.device?.settings?.integrations || state.settings?.integrations || {};
                      const aiConfig = getStoredAiConfig(integrationSettings);
                      if (!aiConfig.apiKey || state.org?.mode === "demo") return;
                      const site = state.sites.find((entry) => entry.id === selected.siteId);
                      const smart = await suggestRfiSmart(selected, { orgMode: state.org?.mode, problem: selected, site, company: state.company }, integrationSettings);
                      if (smart.source === "openai" || smart.source === "claude") {
                        actions.updateRfi(rfiId, {
                          title: smart.title,
                          description: smart.description,
                          to: smart.recommendedRecipient,
                          aiSource: smart.source,
                        });
                      }
                    },
                  },
                  canResolveProblem
                    ? {
                        label: selected.status === "resolved" ? "Reopen" : "Resolve",
                        tone: selected.status === "resolved" ? "" : "bt-g",
                        onClick: () => actions.setProblemStatus(selected.id, selected.status === "resolved" ? "open" : "resolved"),
                      }
                    : null,
                ].filter(Boolean)}
              />
              <div className="mt">
                {selected.thread.map((entry) => (
                  <div className="mm them" key={entry.id}>
                    <div className="mf">{entry.by}</div>
                    <div>{entry.body}</div>
                    <div className="mt2">{entry.at}</div>
                  </div>
                ))}
              </div>
              {selected.photos?.length ? (
                <div style={{ marginTop: 12 }}>
                  <PhotoUpload existingPhotos={selected.photos} parentType="problem" parentId={selected.id} />
                </div>
              ) : null}
              <div className="mi" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <input value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to field thread..." />
                <Button
                  tone="bt-p"
                  small
                  onClick={() => {
                    actions.replyProblem(selected.id, reply);
                    setReply("");
                  }}
                >
                  Reply
                </Button>
              </div>
            </Card>
            <LinkedRecordsPanel records={selected.linkedRecords} resolveRecord={derived.resolveRecord} />
          </div>
        ) : null}
      </div>
      <Modal open={open} close={() => setOpen(false)} title="Report Problem">
        <div className="ff">
          <label>Title</label>
          <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Priority</label>
            <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
              {["critical", "high", "medium", "low"].map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Delay (days)</label>
            <input value={form.timeImpact} onChange={(event) => setForm((current) => ({ ...current, timeImpact: event.target.value }))} />
          </div>
        </div>
        <div className="ff">
          <label>Cost Impact</label>
          <input value={form.costImpact} onChange={(event) => setForm((current) => ({ ...current, costImpact: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Photos</label>
          <PhotoUpload
            existingPhotos={form.photos}
            parentType="problem"
            onPhotosAdded={(photos) => setForm((current) => ({ ...current, photos: [...current.photos, ...photos] }))}
            onRemove={(photoId) => setForm((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== photoId) }))}
          />
        </div>
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addProblem(form);
              setOpen(false);
              setForm({ title: "", description: "", priority: "medium", costImpact: "", timeImpact: "", photos: [] });
            }}
          >
            Report
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function WorkforcePage() {
  const { state, actions } = useSiteForge();
  const siteId = state.session.siteId;
  const [scanOpen, setScanOpen] = useState(false);
  const [passportId, setPassportId] = useState(state.passports.records.find((record) => record.siteId === siteId)?.id || "");
  const records = state.presence.records.filter((record) => record.siteId === siteId);
  const sitePassports = state.passports.records.filter((record) => record.siteId === siteId);
  const subcontractorCompanies = state.companies.filter((company) => company.kind === "Subcontractor");
  const complianceRows = subcontractorCompanies.map((company) => {
    const passport = sitePassports.find((entry) => entry.companyId === company.id) || state.passports.records.find((entry) => entry.companyId === company.id);
    const required = requiredDocsForTrade(passport?.trade || "");
    const docs = state.complianceDocuments.filter((doc) => doc.companyId === company.id);
    const outstanding = required
      .map((requirement) => {
        const latest = docs.find((doc) => doc.docType === requirement.docType && (requirement.scope !== "job-stage" || doc.siteId === siteId || doc.linkedJobIds?.includes(siteId)));
        const status = complianceStatusFor(latest);
        return { requirement, doc: latest, status };
      })
      .filter((item) => item.status !== "valid");
    return { company, passport, docs, outstanding };
  });
  const pendingCompliance = state.complianceDocuments.filter((doc) => doc.status === "pending-review" && (!doc.siteId || doc.siteId === siteId || doc.linkedJobIds?.includes(siteId)));

  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "Verified", value: records.filter((record) => record.status === "verified-on-site").length, color: "g" },
          { label: "Review", value: records.filter((record) => record.payrollState === "review").length, color: "a" },
          { label: "Hold", value: records.filter((record) => record.payrollState === "hold").length, color: "r" },
          { label: "Scan Events", value: state.passports.scanLog.filter((entry) => entry.siteId === siteId).length, color: "b" },
        ]}
      />
      <div className="fb mb8">
        <div className="b sm">Workforce Confidence</div>
        <Button tone="bt-p" icon={Icons.login} onClick={() => setScanOpen(true)}>
          Check In Crew
        </Button>
      </div>
      <div className="g2">
        <Card title="Presence Records" icon={Icons.users}>
          <div className="list-stack">
            {records.map((record) => (
              <div className="linked-row" key={record.id}>
                <div>
                  <div className="b sm">{record.person}</div>
                  <div className="xs ct3">{record.status}</div>
                </div>
                <div className="fx" style={{ gap: 4 }}>
                  <Badge tone={record.payrollState === "ready" ? "passed" : record.payrollState === "hold" ? "critical" : "medium"}>{record.payrollState}</Badge>
                  <Button small onClick={() => actions.resolvePresence(record.id, "verify", "Verified from workforce dashboard.")}>
                    Resolve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Attendance Timeline" icon={Icons.clock}>
          <div className="list-stack">
            {state.presence.events
              .filter((event) => event.siteId === siteId)
              .slice(0, 8)
              .map((event) => (
                <div className="act" key={event.id}>
                  <div style={{ flex: 1 }}>
                    <div className="b sm">{event.signal}</div>
                    <div className="xs ct3">
                      {event.at} · {event.note}
                    </div>
                  </div>
                  <Badge tone={event.state === "blocked" ? "critical" : "passed"}>{event.state}</Badge>
                </div>
              ))}
          </div>
        </Card>
      </div>
      <Card title="Subcontractor Compliance" icon={Icons.shield} className="mb8">
        <div className="g2">
          <div className="mini-panel">
            <div className="b sm mb8">Pending my review</div>
            <div className="list-stack">
              {pendingCompliance.length ? pendingCompliance.map((doc) => {
                const company = state.companies.find((entry) => entry.id === doc.companyId);
                return (
                  <div className="linked-row" key={doc.id}>
                    <div>
                      <div className="b sm">{doc.docType}</div>
                      <div className="xs ct3">{company?.name || doc.companyId} · {doc.expiryDate || "no expiry"}</div>
                    </div>
                    <div className="fx" style={{ gap: 4 }}>
                      <Button small tone="bt-g" onClick={() => actions.reviewComplianceDocument(doc.id, { accepted: true })}>Accept</Button>
                      <Button small tone="bt-r" onClick={() => actions.reviewComplianceDocument(doc.id, { accepted: false, rejectionReason: "Document unreadable or does not match the required item." })}>Reject</Button>
                    </div>
                  </div>
                );
              }) : <div className="xs ct3">No compliance documents waiting for review.</div>}
            </div>
          </div>
          <div className="mini-panel">
            <div className="b sm mb8">Missing & expiring by company</div>
            <div className="list-stack">
              {complianceRows.map(({ company, outstanding }) => (
                <div className="linked-row" key={company.id}>
                  <div>
                    <div className="b sm">{company.name}</div>
                    <div className="xs ct3">
                      {outstanding.length ? outstanding.map((item) => `${item.requirement.docType}: ${complianceLabel(item.status, item.doc)}`).join(" · ") : "All required documents valid"}
                    </div>
                  </div>
                  <div className="fx" style={{ gap: 4 }}>
                    <Badge tone={outstanding.length ? "critical" : "passed"}>{outstanding.length ? `${outstanding.length} outstanding` : "complete"}</Badge>
                    <Button small onClick={() => actions.chaseComplianceDocuments(company.id)}>Chase</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <Modal open={scanOpen} close={() => setScanOpen(false)} title="Check In Crew">
        <div className="ff">
          <label>Passport</label>
          <select value={passportId} onChange={(event) => setPassportId(event.target.value)}>
            {sitePassports.map((passport) => (
              <option key={passport.id} value={passport.id}>
                {passport.person}
              </option>
            ))}
          </select>
        </div>
        <div className="fa">
          <Button onClick={() => setScanOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.scanPassport(siteId, passportId);
              setScanOpen(false);
            }}
          >
            Check In
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function ProcurementPage() {
  const { state, actions } = useSiteForge();
  const siteId = state.session.siteId;
  const [open, setOpen] = useState(false);
  const [transitionItem, setTransitionItem] = useState(null);
  const [transitionForm, setTransitionForm] = useState({ eta: "", trackingNumber: "", signatureName: "", supplier: "", notes: "" });
  const [form, setForm] = useState({ item: "", quantity: "", supplier: "", cost: "", eta: "" });
  const items = state.procurement.filter((item) => item.siteId === siteId && !item.archived);
  const statusOrder = [
    "requested",
    "quoted",
    "approved",
    "ordered",
    "supplier-confirmed",
    "dispatched",
    "in-transit",
    "delivered",
    "delayed",
    "escalated",
    "verified",
    "invoice-received",
    "paid",
    "cancelled",
  ];
  const columns = [
    {
      key: "item",
      label: "Item",
      filterable: true,
      render: (_, row) => (
        <div>
          <div className="b sm">{row.item}</div>
          <div className="xs ct3">{row.supplier || "Supplier pending"}</div>
        </div>
      ),
    },
    { key: "quantity", label: "Qty", filterable: true },
    { key: "eta", label: "ETA", type: "date", filterable: true, render: (value) => <span className="xs">{value || "TBC"}</span> },
    {
      key: "status",
      label: "Status",
      filterable: true,
      options: statusOrder,
      render: (value) => <Badge tone={["delayed", "escalated", "cancelled"].includes(value) ? "critical" : ["delivered", "verified", "paid"].includes(value) ? "passed" : "medium"}>{value}</Badge>,
    },
    { key: "cost", label: "Cost", type: "number", filterable: true, render: (value) => <span className="mono xs">${Number(value || 0).toLocaleString()}</span> },
  ];
  const currentTransitionTarget = transitionItem
    ? statusOrder[Math.min(statusOrder.indexOf(transitionItem.status) + 1, statusOrder.length - 1)] || "quoted"
    : "quoted";

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div className="fx" style={{ gap: 6 }}>
          <Badge tone="critical">{items.filter((item) => ["delayed", "escalated"].includes(item.status)).length} delayed</Badge>
          <Badge tone="medium">{items.filter((item) => ["requested", "quoted", "approved"].includes(item.status)).length} active</Badge>
          <Badge tone="passed">{items.filter((item) => item.status === "delivered").length} delivered</Badge>
        </div>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
          Request Material
        </Button>
      </div>
      <DataTable
        storageKey={`procurement-${siteId}`}
        title="Procurement Lifecycle"
        columns={columns}
        rows={items}
        bulkActions={[
          { label: "Archive", tone: "bt-r", onClick: (ids) => ids.forEach((id) => actions.archiveEntity("procurement", id)) },
          { label: "Supplier Confirmed", onClick: (ids) => ids.forEach((id) => actions.transitionProcurement(id, "supplier-confirmed", { eta: form.eta || "" })) },
        ]}
        rowActions={[
          { label: "Edit", onClick: (row) => setForm({ item: row.item, quantity: row.quantity, supplier: row.supplier, cost: row.cost, eta: row.eta || "" }) || setTransitionItem(row) },
          { label: "Next", onClick: (row) => setTransitionItem(row) },
          { label: "Delay", tone: "bt-r", when: (row) => !["paid", "verified", "cancelled"].includes(row.status), onClick: (row) => actions.transitionProcurement(row.id, "delayed") },
          { label: "Draft EOT", tone: "bt-p", dataTestId: "procurement-raise-eot", when: (row) => ["delayed", "escalated"].includes(row.status), onClick: (row) => actions.createEotFromProcurement(row.id) },
          { label: "Cancel", tone: "bt-r", when: (row) => !["delivered", "verified", "paid", "cancelled"].includes(row.status), onClick: (row) => actions.transitionProcurement(row.id, "cancelled", { notes: "Cancelled from procurement register." }) },
          { label: "Duplicate", onClick: (row) => actions.duplicateEntity("procurement", row.id) },
        ]}
      />
      <div className="g2" style={{ marginTop: 10 }}>
        <Card title="Critical Items" icon={Icons.alert}>
          <div className="list-stack">
            {items.filter((item) => ["requested", "quoted", "approved"].includes(item.status)).slice(0, 5).map((item) => (
              <div className="linked-row" key={item.id}>
                <div>
                  <div className="b sm">{item.item}</div>
                  <div className="xs ct3">Need by {item.eta || "TBC"}</div>
                </div>
                <Badge tone="high">{item.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Invoicing Queue" icon={Icons.invoice}>
          <div className="list-stack">
            {items.filter((item) => ["invoice-received", "paid"].includes(item.status)).slice(0, 5).map((item) => (
              <div className="linked-row" key={item.id}>
                <div>
                  <div className="b sm">{item.item}</div>
                  <div className="xs ct3">{item.supplier}</div>
                </div>
                <Badge tone={item.status === "paid" ? "passed" : "medium"}>{item.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Modal open={open} close={() => setOpen(false)} title="Request Materials">
        <div className="ff">
          <label>Item</label>
          <input value={form.item} onChange={(event) => setForm((current) => ({ ...current, item: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Quantity</label>
            <input value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Cost</label>
            <input value={form.cost} onChange={(event) => setForm((current) => ({ ...current, cost: event.target.value }))} />
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Supplier</label>
            <input value={form.supplier} onChange={(event) => setForm((current) => ({ ...current, supplier: event.target.value }))} />
          </div>
          <div className="ff">
            <label>ETA</label>
            <input type="date" value={form.eta} onChange={(event) => setForm((current) => ({ ...current, eta: event.target.value }))} />
          </div>
        </div>
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addProcurementRequest(form);
              setOpen(false);
              setForm({ item: "", quantity: "", supplier: "", cost: "", eta: "" });
            }}
          >
            Submit
          </Button>
        </div>
      </Modal>
      <Modal open={Boolean(transitionItem)} close={() => setTransitionItem(null)} title={`Move ${transitionItem?.item || "item"} to next status`}>
        <div className="ff">
          <label>Next status</label>
          <input value={currentTransitionTarget} readOnly />
        </div>
        <div className="g2">
          <div className="ff">
            <label>ETA</label>
            <input type="date" value={transitionForm.eta} onChange={(event) => setTransitionForm((current) => ({ ...current, eta: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Supplier</label>
            <input value={transitionForm.supplier} onChange={(event) => setTransitionForm((current) => ({ ...current, supplier: event.target.value }))} />
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Tracking</label>
            <input value={transitionForm.trackingNumber} onChange={(event) => setTransitionForm((current) => ({ ...current, trackingNumber: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Signature</label>
            <input value={transitionForm.signatureName} onChange={(event) => setTransitionForm((current) => ({ ...current, signatureName: event.target.value }))} />
          </div>
        </div>
        <div className="ff">
          <label>Notes</label>
          <textarea value={transitionForm.notes} onChange={(event) => setTransitionForm((current) => ({ ...current, notes: event.target.value }))} />
        </div>
        <div className="fa">
          <Button onClick={() => setTransitionItem(null)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              if (transitionItem) {
                actions.transitionProcurement(transitionItem.id, currentTransitionTarget, transitionForm);
              }
              setTransitionItem(null);
              setTransitionForm({ eta: "", trackingNumber: "", signatureName: "", supplier: "", notes: "" });
            }}
          >
            Apply Transition
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function RfisPage() {
  const { state, actions } = useSiteForge();
  const siteId = state.session.siteId;
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [rfiPolishLoading, setRfiPolishLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(state.rfis.find((rfi) => rfi.siteId === siteId)?.id || null);
  const [form, setForm] = useState({ title: "", description: "", to: "Consultant", priority: "medium", trade: "General" });
  const rfis = state.rfis.filter((rfi) => rfi.siteId === siteId);
  const selected = rfis.find((rfi) => rfi.id === selectedId) || rfis[0];

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div className="fx" style={{ gap: 6 }}>
          <Badge tone="critical">{rfis.filter((rfi) => rfi.status === "overdue").length} overdue</Badge>
          <Badge tone="medium">{rfis.filter((rfi) => rfi.status === "open").length} open</Badge>
        </div>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
          New RFI
        </Button>
      </div>
      <div className="g32">
        <Card title="RFI Register" icon={Icons.help}>
          <div className="list-stack">
            {rfis.map((rfi) => (
              <button className={`act text-button ${selected?.id === rfi.id ? "row-selected" : ""}`.trim()} key={rfi.id} onClick={() => setSelectedId(rfi.id)} type="button">
                <div style={{ flex: 1 }}>
                  <div className="b sm">
                    {rfi.number} · {rfi.title}
                  </div>
                  <div className="xs ct3">{rfi.to}</div>
                </div>
                <Badge tone={rfiStatusTone(rfi.status)}>{rfi.status}</Badge>
              </button>
            ))}
          </div>
        </Card>
        {selected ? (
          <Card title="RFI Detail" icon={Icons.file}>
            <DetailHeader
              title={`${selected.number} ${selected.title}`}
              subtitle={`${selected.trade} · Due ${selected.dueDate}`}
              badges={[{ label: selected.status, tone: rfiStatusTone(selected.status) }]}
              actions={[
                ...(selected.status === "converted-to-variation" ? [] : [{ label: "Convert to Variation", tone: "bt-p", icon: Icons.shuffle, dataTestId: "rfi-convert-variation", onClick: () => actions.createVariationFromRfi(selected.id) }]),
                ...(selected.responses?.length ? [{ label: "Close", tone: "", icon: Icons.check, onClick: () => actions.closeRfi(selected.id) }] : []),
              ]}
            />
            <div className="sm ct2" style={{ lineHeight: 1.7 }}>
              {selected.description}
            </div>
            <div className="list-stack" style={{ marginTop: 10 }}>
              {selected.responses.map((response) => (
                <div className="act" key={response.id}>
                  <div>
                    <div className="b sm">{response.by}</div>
                    <div className="xs ct3">{response.at}</div>
                    <div className="sm ct2">{response.body}</div>
                  </div>
                </div>
              ))}
            </div>
	            <div className="mi" style={{ paddingLeft: 0, paddingRight: 0 }}>
	              <input value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Add response..." />
	              <Button
	                small
	                icon={Icons.zap}
	                disabled={rfiPolishLoading}
	                onClick={async () => {
	                  setRfiPolishLoading(true);
	                  const result = await actions.respondRfiSmart(selected.id, reply);
	                  setRfiPolishLoading(false);
	                  if (result?.ok) {
	                    setReply(result.body);
	                  }
	                }}
	              >
	                {rfiPolishLoading ? "Polishing..." : "AI Polish"}
	              </Button>
	              <Button
	                small
	                tone="bt-p"
                onClick={() => {
                  actions.respondRfi(selected.id, reply);
                  setReply("");
                }}
              >
                Respond
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
      <Modal open={open} close={() => setOpen(false)} title="New RFI">
        <div className="ff">
          <label>Title</label>
          <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Trade</label>
            <input value={form.trade} onChange={(event) => setForm((current) => ({ ...current, trade: event.target.value }))} />
          </div>
          <div className="ff">
            <label>To</label>
            <input value={form.to} onChange={(event) => setForm((current) => ({ ...current, to: event.target.value }))} />
          </div>
        </div>
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.createRfi(form);
              setOpen(false);
              setForm({ title: "", description: "", to: "Consultant", priority: "medium", trade: "General" });
            }}
          >
            Submit
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function variationStatusTone(status) {
  if (status === "signed" || status === "approved") return "passed";
  if (status === "void" || status === "declined") return "critical";
  if (status === "client-pending" || status === "review") return "high";
  return "medium";
}

function rfiStatusTone(status) {
  if (status === "overdue") return "critical";
  if (["responded", "closed", "converted-to-variation"].includes(status)) return "passed";
  return "medium";
}

function VariationsPage() {
  const { state, actions } = useSiteForge();
  const siteId = state.session.siteId;
  const role = state.session.role;
  const currentSite = state.sites.find((site) => site.id === siteId) || state.sites[0];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    siteId: siteId || "",
    clientId: currentSite?.clientId || "",
    title: "",
    description: "",
    reason: "",
    value: "",
    days: "",
    trade: "General",
    priority: "medium",
    templateId: "",
    photos: [],
  });
  const variations = state.variations.filter((variation) => variation.siteId === siteId);
  const variationTemplates = state.contractTemplates.filter((template) => template.status !== "archived" && ["Variation", "Scope Clarification", "Selection Upgrade"].includes(template.type));
  const canCreateStandaloneVariation = ["Project Manager", "Contract Admin", "Director"].includes(role);
  const selectableSites = canSeeAllSites(role) ? state.sites : state.sites.filter((site) => site.id === siteId);
  const selectedFormSite = state.sites.find((site) => site.id === form.siteId) || currentSite;
  const resetForm = () =>
    setForm({
      siteId: siteId || "",
      clientId: currentSite?.clientId || "",
      title: "",
      description: "",
      reason: "",
      value: "",
      days: "",
      trade: "General",
      priority: "medium",
      templateId: "",
      photos: [],
    });

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div className="fx" style={{ gap: 6 }}>
          <Badge tone="medium">{variations.filter((variation) => variation.status === "submitted").length} submitted</Badge>
          <Badge tone="passed">{variations.filter((variation) => variation.status === "signed").length} signed</Badge>
        </div>
        {canCreateStandaloneVariation ? (
          <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
            New Variation
          </Button>
        ) : null}
      </div>
      <Card title="Variations" icon={Icons.shuffle}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Variation</th>
                <th>Trade</th>
                <th>Value</th>
                <th>Time</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {variations.map((variation) => (
                <tr key={variation.id}>
                  <td>
                    <div className="b sm">
                      {variation.number} · {variation.title}
                    </div>
                    <div className="xs ct3">{variation.sourceType}</div>
                  </td>
                  <td className="xs">{variation.trade}</td>
                  <td className="mono xs">${variation.value.toLocaleString()}</td>
                  <td className="mono xs">{variation.days}d</td>
                  <td>
                    <Badge tone={variationStatusTone(variation.status)}>{variation.status}</Badge>
                  </td>
                  <td>
                    <div className="fx" style={{ gap: 6, justifyContent: "flex-end" }}>
                      {variation.status === "submitted" && can(role, "clientflow.send") ? (
                        <Button small tone="bt-p" data-testid="variation-create" onClick={() => actions.sendVariationToClient(variation.id, variation.templateId)}>
                          Submit Review
                        </Button>
                      ) : null}
                      {!["signed", "void"].includes(variation.status) && can(role, "clientflow.send") ? (
                        <Button small tone="bt-r" onClick={() => actions.voidVariation(variation.id, "Voided from the variation register.")}>
                          Void
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={open} close={() => setOpen(false)} title="Create Variation Draft">
        <div className="g2">
          <div className="ff">
            <label>Site</label>
            <select
              value={form.siteId}
              onChange={(event) => {
                const nextSite = state.sites.find((site) => site.id === event.target.value);
                setForm((current) => ({ ...current, siteId: event.target.value, clientId: nextSite?.clientId || current.clientId }));
              }}
            >
              {selectableSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Client</label>
            <select value={form.clientId || selectedFormSite?.clientId || ""} onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))}>
              {state.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="ff">
          <label>Title</label>
          <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Value</label>
            <input value={form.value} onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Days</label>
            <input value={form.days} onChange={(event) => setForm((current) => ({ ...current, days: event.target.value }))} />
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Trade</label>
            <input value={form.trade} onChange={(event) => setForm((current) => ({ ...current, trade: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Priority</label>
            <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
              {["critical", "high", "medium", "low"].map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="ff">
          <label>Reason</label>
          <textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Contract template</label>
          <select value={form.templateId} onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value }))}>
            <option value="">Use default variation template</option>
            {variationTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ff">
          <label>Supporting photos</label>
          <PhotoUpload
            existingPhotos={form.photos}
            parentType="variation"
            onPhotosAdded={(photos) => setForm((current) => ({ ...current, photos: [...current.photos, ...photos] }))}
            onRemove={(photoId) => setForm((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== photoId) }))}
          />
        </div>
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
	          <Button
	            tone="bt-p"
	            onClick={() => {
	              const targetSite = state.sites.find((site) => site.id === form.siteId) || currentSite;
	              actions.createApprovalFromSource({
	                sourceType: "manual",
	                sourceId: null,
	                approvalType: "Variation",
	                handUp: mustHandUpForApproval(role),
	                manualOverride: {
	                  ...form,
	                  siteId: targetSite?.id || siteId,
	                  clientId: form.clientId || targetSite?.clientId,
	                  costImpact: Number(form.value || 0),
	                  timeImpact: Number(form.days || 0),
	                  submitForReview: true,
	                },
	              });
	              setOpen(false);
	              resetForm();
	            }}
	          >
	            Submit for PM Review
	          </Button>
        </div>
      </Modal>
    </div>
  );
}

function QaPage() {
  const { state, actions } = useSiteForge();
  const siteId = state.session.siteId;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", type: "Hold Point", trade: "General", date: "", totalCount: "", notes: "", photos: [] });
  const items = state.qa.filter((item) => item.siteId === siteId);

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div className="fx" style={{ gap: 6 }}>
          <Badge tone="critical">{items.filter((item) => item.status === "failed").length} failed</Badge>
          <Badge tone="medium">{items.filter((item) => item.status === "scheduled").length} scheduled</Badge>
        </div>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
          Add Inspection
        </Button>
      </div>
      <Card title="QA / Inspections" icon={Icons.clipboard}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Inspection</th>
                <th>Trade</th>
                <th>Date</th>
                <th>Items</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="b sm">{item.title}</div>
                    <div className="xs ct3">{item.notes}</div>
                    {item.photos?.length ? <div className="xs ct3">{item.photos.length} photo(s)</div> : null}
                  </td>
                  <td className="xs">{item.trade}</td>
                  <td className="xs">{item.date}</td>
                  <td className="mono xs">
                    {item.passCount}/{item.totalCount}
                  </td>
                  <td>
                    <Badge tone={item.status === "failed" ? "critical" : item.status === "passed" ? "passed" : "medium"}>{item.status}</Badge>
                  </td>
                  <td>
                    <div className="fx" style={{ gap: 4 }}>
                      {item.status === "scheduled" ? (
                        <Button small onClick={() => actions.updateQaStatus(item.id, "in-progress")}>
                          Start
                        </Button>
                      ) : null}
                      {item.status !== "passed" ? (
                        <Button small tone="bt-g" onClick={() => actions.updateQaStatus(item.id, "passed")}>
                          Pass
                        </Button>
                      ) : null}
                      {item.status !== "failed" ? (
                        <Button small tone="bt-r" onClick={() => actions.updateQaStatus(item.id, "failed")}>
                          Fail
                        </Button>
                      ) : null}
                      {item.status === "failed" ? (
                        <Button small tone="bt-p" onClick={() => actions.createReworkTaskFromQa(item.id)}>
                          Rework Task
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={open} close={() => setOpen(false)} title="Add Inspection">
        <div className="ff">
          <label>Title</label>
          <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Type</label>
            <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}>
              <option>Hold Point</option>
              <option>Witness Point</option>
            </select>
          </div>
          <div className="ff">
            <label>Trade</label>
            <input value={form.trade} onChange={(event) => setForm((current) => ({ ...current, trade: event.target.value }))} />
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Total Items</label>
            <input value={form.totalCount} onChange={(event) => setForm((current) => ({ ...current, totalCount: event.target.value }))} />
          </div>
        </div>
        <div className="ff">
          <label>Notes</label>
          <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Photos</label>
          <PhotoUpload
            existingPhotos={form.photos}
            parentType="qa"
            onPhotosAdded={(photos) => setForm((current) => ({ ...current, photos: [...current.photos, ...photos] }))}
            onRemove={(photoId) => setForm((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== photoId) }))}
          />
        </div>
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addQaRecord(form);
              setOpen(false);
              setForm({ title: "", type: "Hold Point", trade: "General", date: "", totalCount: "", notes: "", photos: [] });
            }}
          >
            Add
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function DiaryPage() {
  const { state, actions } = useSiteForge();
  const siteId = state.session.siteId;
  const [open, setOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [variationEntry, setVariationEntry] = useState(null);
  const [rawNote, setRawNote] = useState("");
  const [form, setForm] = useState({ date: "", weather: "", crew: "", summary: "", safety: "", delays: "", rainEvent: false, photos: [], voiceNotes: [] });
  const [variationForm, setVariationForm] = useState({ title: "", description: "", value: "", days: "", reason: "", trade: "General", priority: "medium", templateId: "", photos: [] });
  const entries = state.diary.filter((entry) => entry.siteId === siteId);
  const variationTemplates = state.contractTemplates.filter((template) => template.status !== "archived" && ["Variation", "Selection Upgrade", "Scope Clarification"].includes(template.type));

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div className="b sm">Site Diary</div>
        <div className="fx" style={{ gap: 6 }}>
          <Button icon={Icons.chat} onClick={() => setVoiceOpen(true)}>
            Quick voice note
          </Button>
          <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
            New Entry
          </Button>
        </div>
      </div>
      {entries.map((entry) => (
        <Card title={entry.date} key={entry.id} icon={Icons.book} className="mb8">
          <div className="sm ct2" style={{ lineHeight: 1.7 }}>
            {entry.summary}
          </div>
          {entry.photos?.length ? <PhotoUpload existingPhotos={entry.photos} parentType="diary" parentId={entry.id} /> : null}
          {entry.voiceNotes?.length ? (
            <div style={{ marginTop: 10 }}>
              {entry.voiceNotes.map((note) => (
                <AudioNotePlayer key={note.id} note={note} />
              ))}
            </div>
          ) : null}
          <div className="fx" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <Badge tone="medium">{entry.weather}</Badge>
            <Badge tone="passed">{entry.crew} crew</Badge>
            {entry.rainEvent ? (
              <Button small tone="bt-p" data-testid="diary-claim-rain-day" onClick={() => actions.createRainDayClaim(entry.id)}>
                Claim Rain Day
              </Button>
            ) : null}
            <Button
              small
              onClick={() => {
                setVariationEntry(entry);
                setVariationForm({
                  title: `Variation from diary - ${entry.date}`,
                  description: entry.summary,
                  value: "",
                  days: "",
                  reason: entry.delays && entry.delays !== "Nil" ? entry.delays : "Diary event changed the original scope or sequence.",
                  trade: "General",
                  priority: entry.rainEvent ? "high" : "medium",
                  templateId: state.settings?.contractDefaults?.standardVariationTemplate || variationTemplates[0]?.id || "",
                  photos: entry.photos || [],
                  releaseToClient: true,
                });
              }}
            >
              Convert to Variation
            </Button>
          </div>
        </Card>
      ))}
      <Modal open={open} close={() => setOpen(false)} title="Diary Entry">
        <div className="g2">
          <div className="ff">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Weather</label>
            <input value={form.weather} onChange={(event) => setForm((current) => ({ ...current, weather: event.target.value }))} />
          </div>
        </div>
        <div className="ff">
          <label>Crew</label>
          <input value={form.crew} onChange={(event) => setForm((current) => ({ ...current, crew: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Summary</label>
          <textarea value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Safety</label>
          <input value={form.safety} onChange={(event) => setForm((current) => ({ ...current, safety: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Delays</label>
          <input value={form.delays} onChange={(event) => setForm((current) => ({ ...current, delays: event.target.value }))} />
        </div>
        <label className="sig-check">
          <input type="checkbox" checked={form.rainEvent} onChange={(event) => setForm((current) => ({ ...current, rainEvent: event.target.checked }))} />
          Mark as rain event
        </label>
	        <div className="ff">
	          <label>Photos</label>
	          <PhotoUpload
            existingPhotos={form.photos}
            parentType="diary"
            onPhotosAdded={(photos) => setForm((current) => ({ ...current, photos: [...current.photos, ...photos] }))}
            onRemove={(photoId) => setForm((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== photoId) }))}
	          />
	        </div>
	        <div className="ff">
	          <label>Voice note</label>
	          <VoiceRecorder onVoiceNoteAdded={(note) => setForm((current) => ({ ...current, voiceNotes: [...(current.voiceNotes || []), note] }))} />
	          {form.voiceNotes?.length ? (
	            <div className="list-stack" style={{ marginTop: 8 }}>
	              {form.voiceNotes.map((note) => (
	                <AudioNotePlayer key={note.id} note={note} />
	              ))}
	            </div>
	          ) : null}
	        </div>
	        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            data-testid="diary-create-variation"
	            onClick={() => {
	              actions.addDiaryEntry(form);
	              setOpen(false);
	              setForm({ date: "", weather: "", crew: "", summary: "", safety: "", delays: "", rainEvent: false, photos: [], voiceNotes: [] });
	            }}
          >
            Save Entry
          </Button>
        </div>
      </Modal>
      <Modal open={Boolean(variationEntry)} close={() => setVariationEntry(null)} title="Convert Diary Entry to Variation" wide>
        <div className="ff">
          <label>Variation title</label>
          <input value={variationForm.title} onChange={(event) => setVariationForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Description for client</label>
          <textarea value={variationForm.description} onChange={(event) => setVariationForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Estimated cost</label>
            <input type="number" value={variationForm.value} onChange={(event) => setVariationForm((current) => ({ ...current, value: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Time impact days</label>
            <input type="number" value={variationForm.days} onChange={(event) => setVariationForm((current) => ({ ...current, days: event.target.value }))} />
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Trade</label>
            <input value={variationForm.trade} onChange={(event) => setVariationForm((current) => ({ ...current, trade: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Priority</label>
            <select value={variationForm.priority} onChange={(event) => setVariationForm((current) => ({ ...current, priority: event.target.value }))}>
              {["critical", "high", "medium", "low"].map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="ff">
          <label>Reason for variation</label>
          <textarea value={variationForm.reason} onChange={(event) => setVariationForm((current) => ({ ...current, reason: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Contract template</label>
          <select value={variationForm.templateId} onChange={(event) => setVariationForm((current) => ({ ...current, templateId: event.target.value }))}>
            <option value="">Auto select best template</option>
            {variationTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ff">
          <label>Supporting photos</label>
          <PhotoUpload
            existingPhotos={variationForm.photos}
            parentType="variation"
            onPhotosAdded={(photos) => setVariationForm((current) => ({ ...current, photos: [...current.photos, ...photos] }))}
            onRemove={(photoId) => setVariationForm((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== photoId) }))}
          />
        </div>
        <label className="sig-check">
          <input type="checkbox" checked={variationForm.releaseToClient !== false} onChange={(event) => setVariationForm((current) => ({ ...current, releaseToClient: event.target.checked }))} />
          Submit to internal review immediately
        </label>
        <div className="fa">
          <Button onClick={() => setVariationEntry(null)}>Cancel</Button>
          <Button
            tone="bt-p"
            data-testid="variation-create"
            onClick={() => {
              if (!variationEntry) return;
              actions.createVariationFromDiary(variationEntry.id, variationForm);
              setVariationEntry(null);
            }}
          >
            {variationForm.releaseToClient !== false ? "Create ClientFlow Review" : "Create Variation Draft"}
          </Button>
        </div>
      </Modal>
      <Modal open={voiceOpen} close={() => setVoiceOpen(false)} title="Quick Voice Note">
        <div className="ff">
          <label>Raw field note</label>
          <textarea
            value={rawNote}
            onChange={(event) => setRawNote(event.target.value)}
            placeholder="Paste the rough note or mock transcript here and SiteForge will structure it into a diary entry."
          />
        </div>
        <div className="fa">
          <Button onClick={() => setVoiceOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addDiaryEntry({ date: "", weather: "Field note", crew: "", rawText: rawNote });
              setRawNote("");
              setVoiceOpen(false);
            }}
          >
            Structure Note
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function SafetyPage() {
  const { state, actions } = useSiteForge();
  const siteId = state.session.siteId;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ topic: "", type: "toolbox", acknowledgementRequired: false, photos: [] });
  const records = state.safety.filter((entry) => entry.siteId === siteId);

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div className="fx" style={{ gap: 6 }}>
          <Badge tone="passed">{records.filter((entry) => entry.type === "toolbox").length} toolbox talks</Badge>
          <Badge tone="critical">{records.filter((entry) => entry.type === "critical" || entry.type === "incident").length} incidents</Badge>
        </div>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
          Log Safety Record
        </Button>
      </div>
      {records.map((record) => (
        <Card title={record.topic} key={record.id} icon={Icons.shield} className="mb8">
          <div className="xs ct3">
            {record.date} · {record.by}
          </div>
          <div className="sm ct2" style={{ marginTop: 8 }}>
            {record.type === "critical" || record.type === "incident"
              ? "This item has direct stoppage, notification, and programme implications."
              : "Toolbox or safety advisory record captured for the team."}
          </div>
          {record.photos?.length ? <PhotoUpload existingPhotos={record.photos} parentType="safety" parentId={record.id} /> : null}
          {record.type === "critical" || record.type === "incident" ? (
            <Button tone="bt-p" icon={Icons.flag} onClick={() => actions.createDelayNoticeFromSafety(record.id)} style={{ marginTop: 10 }}>
              Log Work Stoppage / Delay Notice
            </Button>
          ) : null}
        </Card>
      ))}
      <Modal open={open} close={() => setOpen(false)} title="Log Safety Record">
        <div className="ff">
          <label>Topic</label>
          <input value={form.topic} onChange={(event) => setForm((current) => ({ ...current, topic: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Type</label>
            <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}>
              <option value="toolbox">Toolbox</option>
              <option value="alert">Alert</option>
              <option value="incident">Incident</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <label className="sig-check">
            <input
              type="checkbox"
              checked={form.acknowledgementRequired}
              onChange={(event) => setForm((current) => ({ ...current, acknowledgementRequired: event.target.checked }))}
            />
            Acknowledgement required
          </label>
        </div>
        <div className="ff">
          <label>Photos</label>
          <PhotoUpload
            existingPhotos={form.photos}
            parentType="safety"
            onPhotosAdded={(photos) => setForm((current) => ({ ...current, photos: [...current.photos, ...photos] }))}
            onRemove={(photoId) => setForm((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== photoId) }))}
          />
        </div>
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addSafetyRecord(form);
              setOpen(false);
              setForm({ topic: "", type: "toolbox", acknowledgementRequired: false, photos: [] });
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function DocumentsPage() {
  const { state, actions, derived } = useSiteForge();
  const siteId = state.session.siteId;
  const [selectedId, setSelectedId] = useState(state.documents.find((document) => document.siteId === siteId)?.id || null);
  const [uploading, setUploading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfViewerFile, setPdfViewerFile] = useState(null);
  const [pdfViewerPage, setPdfViewerPage] = useState(1);
  const [planQuery, setPlanQuery] = useState("");
  const [planResults, setPlanResults] = useState([]);
  const [planSearchLoading, setPlanSearchLoading] = useState(false);
  const [planSearchSummary, setPlanSearchSummary] = useState("");
  const [planSearchSource, setPlanSearchSource] = useState("");
  const [annotation, setAnnotation] = useState({ locationRef: "", note: "" });
  const [manualSearchDescription, setManualSearchDescription] = useState("");
  const [transmittalDraft, setTransmittalDraft] = useState({ purpose: "For Information", recipients: "" });
  const [permitDraft, setPermitDraft] = useState({ title: "", authority: "", expiryDate: "" });
  const documents = state.documents.filter((document) => document.siteId === siteId && !document.archived);
  const archived = state.documents.filter((document) => document.siteId === siteId && document.archived);
  const transmittals = (state.transmittals || []).filter((entry) => entry.siteId === siteId);
  const permits = (state.permits || []).filter((entry) => entry.siteId === siteId);
  const expiringDocuments = documents.filter((document) => document.expiryDate || document.retentionUntil).slice(0, 8);
  const selected = documents.find((document) => document.id === selectedId) || documents[0] || null;
  const selectedFile = selected?.fileId ? state.files.records.find((file) => file.id === selected.fileId) : null;
  const selectedExtractionMeta = extractionStatusMeta(selectedFile?.extractionStatus || (selected?.manualSearchDescription ? "complete" : "not-run"));
  useEffect(() => {
    setManualSearchDescription(selected?.manualSearchDescription || "");
  }, [selected?.id, selected?.manualSearchDescription]);
  const fileForDocument = (document) => (document?.fileId ? state.files.records.find((entry) => entry.id === document.fileId) : null);
  const queryTokens = (query) => query.toLowerCase().split(/\s+/).filter(Boolean);
  const scorePlanDocument = (document, file, query) => {
    const tokens = queryTokens(query);
    const pageText = (file?.textPages || []).map((page) => page.text || "").join(" ");
    const haystack = `${document.title} ${document.drawingNumber || ""} ${document.rev || ""} ${document.tags?.join(" ") || ""} ${document.manualSearchDescription || ""} ${document.impactAnalysis?.summary || ""} ${file?.extractedText || ""} ${pageText}`.toLowerCase();
    return tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
  };
  const buildPlanCandidates = (query) =>
    documents
      .map((document) => {
        const file = fileForDocument(document);
        if (!file) return null;
        const pages = file.textPages || [];
        const hasSearchableText = pages.some((page) => page?.text?.trim()) || file.extractedText || document.manualSearchDescription;
        if (!hasSearchableText) return null;
        return { document, file, score: scorePlanDocument(document, file, query) };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);
  const buildDeepPlanContext = (candidates) => {
    const fullTextCandidates = candidates.slice(0, 5);
    const totalPages = fullTextCandidates.reduce((sum, candidate) => sum + Math.max(1, candidate.file.textPages?.length || 0), 0);
    const perPageBudget = clamp(Math.floor(60000 / Math.max(1, totalPages)), 1500, 6000);
    return candidates.map(({ document, file }, index) => {
      const pages = {};
      if (index < 5) {
        (file.textPages || []).forEach((page, pageIndex) => {
          const pageNum = page.pageNumber ?? pageIndex + 1;
          if (page?.text?.trim()) pages[pageNum] = page.text.trim().slice(0, perPageBudget);
        });
      }
      const hasPages = Object.keys(pages).length > 0;
      return {
        documentId: document.id,
        drawingNumber: document.drawingNumber || document.title,
        title: document.title,
        revision: document.rev,
        manualSearchDescription: document.manualSearchDescription || "",
        pageCount: file.textPages?.length || 1,
        pages: hasPages ? pages : undefined,
        firstPageText: index >= 5 ? (file.textPages?.[0]?.text || file.extractedText || "").slice(0, 500) : undefined,
        extractedText: hasPages ? undefined : (file.extractedText || document.manualSearchDescription || "").slice(0, index < 5 ? 20000 : 500),
      };
    });
  };
  const keywordPlanSearch = (query) => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const searchable = documents
      .map((document) => {
        const file = fileForDocument(document);
        const pageText = (file?.textPages || []).map((page) => page.text || "").join(" ");
        const haystack = `${document.title} ${document.drawingNumber || ""} ${document.rev || ""} ${document.tags?.join(" ") || ""} ${document.manualSearchDescription || ""} ${document.impactAnalysis?.summary || ""} ${file?.extractedText || ""} ${pageText}`;
        const lower = haystack.toLowerCase();
        const score = tokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
        const firstToken = tokens.find((token) => lower.includes(token));
        const index = firstToken ? Math.max(0, lower.indexOf(firstToken) - 80) : 0;
        return {
          id: document.id,
          documentId: document.id,
          drawingNumber: document.drawingNumber || document.title,
          page: file?.textPages?.find((page) => tokens.some((token) => page.text.toLowerCase().includes(token)))?.pageNumber || (file?.type?.includes("pdf") ? 1 : document.rev),
          title: document.title,
          fileId: file?.id,
          confidence: score > 1 ? "medium" : "low",
          score,
          excerpt: haystack.slice(index, index + 240).trim(),
        };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return searchable.length
      ? searchable
      : [
          {
            page: "Annotation fallback",
            title: "No text match",
            confidence: "low",
            excerpt: "No extractable text match was found. Add a plan note or describe the room/zone so SiteForge can keep the search context for future uploads.",
          },
        ];
  };
  const searchPlan = async () => {
    if (!planQuery.trim()) return;
    setPlanSearchLoading(true);
    setPlanSearchSummary("");
    setPlanSearchSource("");
    const aiConfig = getStoredAiConfig(state.device?.settings?.integrations || state.settings?.integrations || {});
    const candidates = buildPlanCandidates(planQuery);
    try {
      let deepCandidates = candidates.length > 8 ? candidates.slice(0, 8) : candidates;
      if (candidates.length > 8 && aiConfig.apiKey) {
        const lightContext = candidates.map(({ document, file }) => ({
          documentId: document.id,
          drawingNumber: document.drawingNumber || document.title,
          title: document.title,
          revision: document.rev,
          firstPageText: (file.textPages?.[0]?.text || file.extractedText || document.manualSearchDescription || "").slice(0, 400),
        }));
        const shortlist = await askSiteForgeAi({
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          openaiProxyUrl: aiConfig.openaiProxyUrl,
          projectContext: { siteId, documents: lightContext, orgMode: state.org?.mode },
          allowInDemo: true,
          userMessage: `Plan search routing query: "${planQuery}".

Pick the 3-5 documentIds most likely to contain the answer. Reply ONLY as JSON:
{ "documentIds": ["id-1", "id-2"] }

Documents:
${JSON.stringify(lightContext)}`,
        });
        if (shortlist.source === "claude" || shortlist.source === "openai") {
          const match = shortlist.text.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(match ? match[0] : shortlist.text);
          const selectedIds = new Set((parsed.documentIds || []).map(String));
          const shortlisted = candidates.filter(({ document }) => selectedIds.has(String(document.id))).slice(0, 5);
          if (shortlisted.length) deepCandidates = shortlisted;
        }
      }
      const documentContext = buildDeepPlanContext(deepCandidates);
      if (!documentContext.length) throw new Error("No searchable document text available.");
      const result = await askSiteForgeAi({
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        openaiProxyUrl: aiConfig.openaiProxyUrl,
        projectContext: { siteId, documents: documentContext, orgMode: state.org?.mode },
        allowInDemo: true,
        userMessage: `Plan search query: "${planQuery}".

Search the documents below and respond ONLY as JSON:
{
	  "summary": "plain-English answer",
	  "results": [
	    { "documentId": "id", "drawingNumber": "number", "page": <page number as integer from the pages map, or null>, "excerpt": "verbatim substring from that page, max 160 chars", "confidence": "high|medium|low" }
	  ]
	}

	When "pages" is present on a document, use the page number keys to find the right page.
The excerpt MUST be a verbatim substring of the page text, not a paraphrase, so the user can locate it in the document.

	Documents:
${JSON.stringify(documentContext)}`,
      });
      if (result.source === "claude" || result.source === "openai") {
        const match = result.text.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(match ? match[0] : result.text);
        setPlanSearchSummary(parsed.summary || "");
        setPlanSearchSource(result.source);
        setPlanResults(
          (parsed.results || []).map((entry, index) => {
            const document = documents.find((item) => item.id === entry.documentId || item.drawingNumber === entry.drawingNumber);
            const file = document?.fileId ? state.files.records.find((item) => item.id === document.fileId) : null;
            return {
              id: document?.id || `${entry.drawingNumber || "ai"}-${index}`,
              title: document?.title || entry.drawingNumber || "AI plan match",
              drawingNumber: entry.drawingNumber,
              page: entry.page != null && !Number.isNaN(Number(entry.page)) ? Number(entry.page) : null,
              excerpt: entry.excerpt || "",
              confidence: entry.confidence || "medium",
              fileId: file?.id,
            };
          }),
        );
        setPlanSearchLoading(false);
        return;
      }
      setPlanSearchSource(result.source);
    } catch (error) {
      setPlanSearchSource("keyword");
    }
    setPlanSearchSummary("");
    setPlanResults(keywordPlanSearch(planQuery));
    setPlanSearchLoading(false);
  };
  const columns = [
    {
      key: "title",
      label: "Document",
      filterable: true,
      render: (_, row) => (
        <div>
          <div className="b sm">{row.title}</div>
          <div className="xs ct3">{row.tags.join(", ")}</div>
        </div>
      ),
    },
    { key: "rev", label: "Rev", filterable: true },
    { key: "category", label: "Category", filterable: true, options: [...new Set(documents.map((document) => document.category))] },
    {
      key: "extractionStatus",
      label: "Search",
      accessor: (row) => fileForDocument(row)?.extractionStatus || "not-run",
      render: (value, row) => {
        const file = fileForDocument(row);
        const meta = extractionStatusMeta(file?.extractionStatus || (row.manualSearchDescription ? "complete" : "not-run"));
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
    },
    { key: "date", label: "Date", type: "date", filterable: true },
    {
      key: "impactAnalysis",
      label: "Impact",
      filterable: true,
      accessor: (row) => row.impactAnalysis?.summary || "No linked impact scan recorded.",
      render: (value) => <div className="sm ct2">{value}</div>,
    },
  ];

  return (
    <div className="oy fin">
      <div className="g32">
        <div>
          <Card title="Document Control" icon={Icons.file} className="mb8">
            <FileDropZone
              label="Upload revision"
              description="Drop a PDF, image, DOCX, TXT or MD file and SiteForge will classify it, detect revision naming, and supersede the current issue where it matches."
              loading={uploading}
              onFiles={async (files) => {
                if (!files?.length) return;
                setUploading(true);
                try {
                  await actions.uploadDocumentRevision(files[0], siteId);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </Card>
          <DataTable
            storageKey={`documents-${siteId}`}
            title="Current Register"
            columns={columns}
            rows={documents}
            onRowClick={(row) => setSelectedId(row.id)}
            bulkActions={[
              { label: "Archive", tone: "bt-r", onClick: (ids) => ids.forEach((id) => actions.archiveEntity("document", id)) },
              { label: "Restore Archived", onClick: () => archived.forEach((document) => actions.restoreEntity("document", document.id)) },
            ]}
            rowActions={[
              { label: "Archive", tone: "bt-r", onClick: (row) => actions.archiveEntity("document", row.id) },
              { label: "Duplicate", onClick: (row) => actions.duplicateEntity("document", row.id) },
            ]}
          />
        </div>

        <div>
          {selected ? (
            <Card title={`Revision Intelligence - ${selected.title}`} icon={Icons.link} className="mb8">
              <div className="sm ct2">{derived.revisionSummary(selected.id)}</div>
              <div className="fx" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                <Badge tone="medium">{selected.impactAnalysis?.affectedTasks?.length || 0} tasks</Badge>
                <Badge tone="high">{selected.impactAnalysis?.affectedRfis?.length || 0} RFIs</Badge>
                <Badge tone="passed">{(selected.impactAnalysis?.affectedTrades || []).join(", ") || "No trade impacts"}</Badge>
              </div>
              {selected.impactAnalysis ? (
                <>
                  <div className="mini-panel" style={{ marginTop: 12 }}>
                    <div className="xs ct3">Changed zones</div>
                    <div className="sm ct2" style={{ marginTop: 6 }}>
                      {(selected.impactAnalysis.affectedZones || []).join(", ") || "General plan revision"}
                    </div>
                  </div>
	                  <div className="mini-panel" style={{ marginTop: 12 }}>
	                    <div className="xs ct3">Revision notes</div>
	                    <div className="sm ct2" style={{ marginTop: 6 }}>
	                      {(selected.impactAnalysis.notes || []).join(" ") || selected.impactAnalysis.summary}
	                    </div>
	                  </div>
                  <div className="mini-panel" style={{ marginTop: 12 }}>
                    <div className="fb">
                      <div className="xs ct3">AI summary</div>
                      <Badge tone={selected.impactAnalysis.aiSource ? "passed" : "medium"}>
                        {selected.impactAnalysis.aiSource === "openai" ? "ChatGPT" : selected.impactAnalysis.aiSource === "claude" ? "Claude" : "Keyword diff"}
                      </Badge>
                    </div>
                    <div className="sm ct2" style={{ marginTop: 6 }}>
                      {selected.impactAnalysis.aiSummary || "AI revision summary will appear here after upload when a real AI provider is connected."}
                    </div>
                  </div>
	                  <div className="list-stack" style={{ marginTop: 12 }}>
                    {(selected.impactAnalysis.acknowledgementsRequired || []).map((userId) => {
                      const user = state.users.find((entry) => entry.id === userId);
                      const done = selected.impactAnalysis.acknowledgedBy?.includes(userId);
                      return (
                        <div className="linked-row" key={userId}>
                          <div>
                            <div className="b sm">{user?.name || userId}</div>
                            <div className="xs ct3">{done ? "Acknowledged" : "Pending acknowledgement"}</div>
                          </div>
                          {done ? (
                            <Badge tone="passed">Clear</Badge>
                          ) : (
                            <div className="fx" style={{ gap: 4 }}>
                              <Button small tone="bt-p" onClick={() => actions.acknowledgeDocumentRevision(selected.id, userId)}>
                                Mark Ack
                              </Button>
                              <Button small onClick={() => actions.addConversationMessage("document-reminder", selected.id, [userId], `Please acknowledge ${selected.title} ${selected.rev} before next site entry.`)}>
                                Send Reminder
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
              <div className="mini-panel" style={{ marginTop: 12 }}>
                <div className="fb mb8">
                  <div>
                    <div className="xs ct3">Plan preview</div>
                    <div className="sm b">{selectedFile?.name || "Seeded document without upload blob"}</div>
                  </div>
                  <Button
                    small
                    disabled={!selectedFile || previewLoading}
                    onClick={async () => {
                      if (!selectedFile) return;
                      setPreviewLoading(true);
                      try {
                        const result = selectedFile.type?.includes("pdf")
                          ? await previewPdf(selectedFile)
                          : { html: selectedFile.thumbnailDataUrl ? `<img src="${selectedFile.thumbnailDataUrl}" alt="${selectedFile.name}" style="max-width:100%;border-radius:12px;" />` : "<p>No preview available for this file.</p>" };
                        setPreviewHtml(result.html);
                      } finally {
                        setPreviewLoading(false);
                      }
                    }}
                  >
                    {previewLoading ? "Opening..." : "Open Preview"}
                  </Button>
                  {selectedFile?.type?.includes("pdf") ? (
                    <Button small tone="bt-p" onClick={() => { setPdfViewerPage(1); setPdfViewerFile(selectedFile); }}>
                      Full PDF Viewer
                    </Button>
                  ) : null}
                  <Button small onClick={() => actions.verifyDocumentIntegrity(selected.id)}>
                    Verify Integrity
                  </Button>
                </div>
                {selected.integrity ? (
                  <div className="xs ct3" style={{ marginBottom: 8 }}>
                    Integrity {selected.integrity.status} · {selected.integrity.hash} · {selected.integrity.verifiedAt}
                  </div>
                ) : null}
	                {previewHtml ? <div className="document-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} /> : <div className="xs ct3">Open a PDF or uploaded image to preview it here.</div>}
	              </div>
	              <div className="mini-panel" style={{ marginTop: 12 }}>
	                <div className="fb mb8">
	                  <div>
	                    <div className="xs ct3">Text extraction</div>
	                    <div className="sm ct2">{selectedExtractionMeta.help}</div>
	                  </div>
	                  <Badge tone={selectedExtractionMeta.tone}>{selectedExtractionMeta.label}</Badge>
	                </div>
	                {selectedFile?.extractionStatus === "no-text-layer" || selectedFile?.extractionStatus === "failed" || selectedFile?.extractionStatus === "encrypted" || selected?.manualSearchDescription ? (
	                  <div className="ff">
	                    <label>Manual searchable description</label>
	                    <textarea
	                      value={manualSearchDescription}
	                      onChange={(event) => setManualSearchDescription(event.target.value)}
	                      placeholder="Describe the drawing contents, key rooms, grids, fixture schedules or certificate details so plan search can still find this document."
	                    />
	                    <Button small tone="bt-p" onClick={() => actions.updateDocumentSearchDescription(selected.id, manualSearchDescription)} disabled={!selected}>
	                      Save Search Description
	                    </Button>
	                  </div>
	                ) : null}
	              </div>
	              <div className="mini-panel" style={{ marginTop: 12 }}>
	                <div className="xs ct3 mb4">AI plan search</div>
                <div className="fx" style={{ gap: 6 }}>
                  <input className="inline-input" value={planQuery} onChange={(event) => setPlanQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchPlan()} />
                  <Button small tone="bt-p" onClick={searchPlan}>
                    {planSearchLoading ? "Searching..." : "Search"}
                  </Button>
                </div>
                {planSearchSource && !["claude", "openai"].includes(planSearchSource) ? (
                  <div className="xs ct3" style={{ marginTop: 8 }}>
                    <Badge tone="medium">Keyword match</Badge> Add a Claude or ChatGPT API key in Settings for AI plan search.
                  </div>
                ) : null}
                {["claude", "openai"].includes(planSearchSource) ? (
                  <div className="xs ct3" style={{ marginTop: 8 }}>
                    <Badge tone="passed">{planSearchSource === "openai" ? "ChatGPT" : "Claude"}</Badge> AI plan search completed.
                  </div>
                ) : null}
                {planSearchSummary ? <div className="mini-panel sm ct2" style={{ marginTop: 8 }}>{planSearchSummary}</div> : null}
                <div className="list-stack" style={{ marginTop: 8 }}>
                  {planResults.map((result, index) => (
                    <div className="linked-row" key={`${result.page}-${index}`}>
                      <div>
                        <div className="b sm">{result.title || selected?.title} · Page {result.page}</div>
                        <div className="xs ct3">{result.excerpt}</div>
                      </div>
                      {result.confidence ? <Badge tone={result.confidence === "high" ? "passed" : result.confidence === "medium" ? "medium" : "low"}>{result.confidence}</Badge> : null}
                      {result.fileId ? (
                        <Button
                          small
                          onClick={() => {
                            const file = state.files.records.find((entry) => entry.id === result.fileId);
                            if (file) {
                              setPdfViewerPage(Number.parseInt(result.page, 10) || 1);
                              setPdfViewerFile(file);
                            }
                          }}
                        >
                          Open
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mini-panel" style={{ marginTop: 12 }}>
                <div className="xs ct3 mb4">Pinned annotations</div>
                <div className="g2">
                  <input className="inline-input" value={annotation.locationRef} onChange={(event) => setAnnotation((current) => ({ ...current, locationRef: event.target.value }))} placeholder="Grid / room / page" />
                  <input className="inline-input" value={annotation.note} onChange={(event) => setAnnotation((current) => ({ ...current, note: event.target.value }))} placeholder="Note" />
                </div>
                <Button
                  small
                  tone="bt-p"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    if (!annotation.note.trim()) return;
                    actions.addDocumentAnnotation(selected.id, annotation);
                    setAnnotation({ locationRef: "", note: "" });
                  }}
                >
                  Pin Note
                </Button>
                <div className="list-stack" style={{ marginTop: 8 }}>
                  {(selected.annotations || []).map((item) => (
                    <div className="linked-row" key={item.id}>
                      <div>
                        <div className="b sm">{item.locationRef}</div>
                        <div className="xs ct3">{item.note}</div>
                      </div>
                      <Badge tone="medium">{item.by}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          ) : null}

          <Card title="Transmittals" icon={Icons.send} className="mb8">
            <div className="mini-panel">
              <div className="g2">
                <div className="ff">
                  <label>Purpose</label>
                  <select value={transmittalDraft.purpose} onChange={(event) => setTransmittalDraft((current) => ({ ...current, purpose: event.target.value }))}>
                    <option>For Information</option>
                    <option>For Construction</option>
                    <option>For Approval</option>
                    <option>Superseded</option>
                  </select>
                </div>
                <div className="ff">
                  <label>Recipients</label>
                  <input value={transmittalDraft.recipients} onChange={(event) => setTransmittalDraft((current) => ({ ...current, recipients: event.target.value }))} placeholder="Name/email, comma separated" />
                </div>
              </div>
              <Button
                small
                tone="bt-p"
                disabled={!selected}
                onClick={() =>
                  actions.createTransmittal({
                    documentIds: selected ? [selected.id] : [],
                    purpose: transmittalDraft.purpose,
                    recipients: transmittalDraft.recipients
                      .split(",")
                      .map((entry) => entry.trim())
                      .filter(Boolean)
                      .map((name) => ({ name })),
                  })
                }
              >
                Create transmittal for selected document
              </Button>
            </div>
            <div className="list-stack" style={{ marginTop: 10 }}>
              {transmittals.slice(0, 6).map((transmittal) => (
                <div className="linked-row" key={transmittal.id}>
                  <div>
                    <div className="b sm">{transmittal.number} · {transmittal.purpose}</div>
                    <div className="xs ct3">{transmittal.documentIds.length} docs · {transmittal.createdAt}</div>
                  </div>
                  <div className="fx" style={{ gap: 4 }}>
                    <Badge tone={transmittal.fileId ? "passed" : "medium"}>{transmittal.fileId ? "PDF" : "Queued"}</Badge>
                    <Button small onClick={() => actions.acknowledgeTransmittal(transmittal.id)}>
                      Acknowledge
                    </Button>
                  </div>
                </div>
              ))}
              {!transmittals.length ? <div className="ct3 sm empty">No transmittals issued for this site yet.</div> : null}
            </div>
          </Card>

          <Card title="Expiry, Retention & Permits" icon={Icons.shield} className="mb8">
            <div className="list-stack">
              {expiringDocuments.map((document) => (
                <div className="linked-row" key={document.id}>
                  <div>
                    <div className="b sm">{document.title}</div>
                    <div className="xs ct3">Retention until {document.retentionUntil || "not set"}{document.expiryDate ? ` · expires ${document.expiryDate}` : ""}</div>
                  </div>
                  <Badge tone={document.expiryDate ? "high" : "medium"}>{document.retentionCategory}</Badge>
                </div>
              ))}
            </div>
            <div className="mini-panel" style={{ marginTop: 12 }}>
              <div className="g2">
                <input className="inline-input" value={permitDraft.title} onChange={(event) => setPermitDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Permit / approval name" />
                <input className="inline-input" value={permitDraft.authority} onChange={(event) => setPermitDraft((current) => ({ ...current, authority: event.target.value }))} placeholder="Authority" />
                <input className="inline-input" type="date" value={permitDraft.expiryDate} onChange={(event) => setPermitDraft((current) => ({ ...current, expiryDate: event.target.value }))} />
              </div>
              <div className="fa" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                <Button small tone="bt-p" onClick={() => {
                  actions.createPermit({ ...permitDraft, documentId: selected?.id, siteId });
                  setPermitDraft({ title: "", authority: "", expiryDate: "" });
                }}>
                  Add permit
                </Button>
                <Button small onClick={() => actions.runDocumentRetentionSweep()}>
                  Run retention sweep
                </Button>
              </div>
            </div>
            <div className="list-stack" style={{ marginTop: 10 }}>
              {permits.map((permit) => (
                <div className="linked-row" key={permit.id}>
                  <div>
                    <div className="b sm">{permit.title}</div>
                    <div className="xs ct3">{permit.authority} · expires {permit.expiryDate || "n/a"}</div>
                  </div>
                  <div className="fx" style={{ gap: 4 }}>
                    <Badge tone={permit.status === "approved" ? "passed" : "high"}>{permit.status}</Badge>
                    <Button small onClick={() => actions.updatePermitStatus(permit.id, permit.status === "approved" ? "required" : "approved")}>
                      {permit.status === "approved" ? "Reopen" : "Approve"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Photo Timeline" icon={Icons.camera} className="mb8">
            <div className="client-photo-row">
              {derived.photoTimeline
                .filter((photo) => photo.siteId === siteId)
                .slice(0, 6)
                .map((photo) => (
                  <div className="client-photo" key={photo.id}>
                    {photo.thumbnailDataUrl ? <img alt={photo.label} src={photo.thumbnailDataUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : photo.label}
                  </div>
                ))}
            </div>
          </Card>

          <Card title="Archived Revisions" icon={Icons.clock}>
            <div className="list-stack">
              {archived.length ? (
                archived.map((document) => (
                  <div className="linked-row" key={document.id}>
                    <div>
                      <div className="b sm">{document.title}</div>
                      <div className="xs ct3">{document.rev}</div>
                    </div>
                    <Button small onClick={() => actions.restoreEntity("document", document.id)}>
                      Restore
                    </Button>
                  </div>
                ))
              ) : (
                <div className="ct3 xs">No archived revisions for this site.</div>
              )}
            </div>
          </Card>
        </div>
      </div>
      {pdfViewerFile ? <PDFViewer fileMeta={pdfViewerFile} initialPage={pdfViewerPage} onClose={() => setPdfViewerFile(null)} /> : null}
    </div>
  );
}

function SchedulePage() {
  const { state } = useSiteForge();
  const schedule = state.schedules.find((entry) => entry.siteId === state.session.siteId);
  if (!schedule) {
    return <RestrictedPanel title="Schedule" body="No schedule loaded for this site." />;
  }

  return (
    <div className="oy fin">
      <Card title="Programme Timeline" icon={Icons.cal}>
        <div className="gantt-stage">
          {schedule.phases.map((phase) => (
            <div className="gantt-r" key={phase.id}>
              <div className="gantt-l">{phase.label}</div>
              <div className="gantt-t">
                <div className="gantt-b" style={{ left: `${phase.startDay}%`, width: `${phase.duration}%`, background: phase.color }}>
                  {phase.progress}%
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="list-stack" style={{ marginTop: 12 }}>
          {schedule.impacts.map((impact) => (
            <div className="linked-row" key={impact.id}>
              <div>
                <div className="b sm">{impact.reason}</div>
                <div className="xs ct3">{impact.sourceId}</div>
              </div>
              <Badge tone="high">{impact.days}d</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function BudgetPage() {
  const { state } = useSiteForge();
  const site = state.sites.find((entry) => entry.id === state.session.siteId);
  const budget = state.siteBudgets.find((entry) => entry.siteId === state.session.siteId);
  if (!budget) return <RestrictedPanel title="Budget" body="No budget loaded for this site." />;

  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "Contract Value", value: `$${Math.round(site.contractValue / 1000)}k`, color: "b" },
          { label: "Spent", value: `$${Math.round(site.spent / 1000)}k`, color: "a" },
          { label: "Committed", value: `$${Math.round(site.committed / 1000)}k`, color: "p" },
          { label: "Forecast Margin", value: `${site.forecastMargin}%`, color: "g" },
        ]}
      />
      <Card title="Budget Breakdown" icon={Icons.dollar}>
        <div className="list-stack">
          {budget.items.map((item) => {
            const anomaly = flagBudgetAnomaly(item);
            const utilisation = Math.round(((item.spent + item.committed) / Math.max(1, item.budget)) * 100);
            return (
              <div className="bb-row" key={item.id}>
                <div className="bb-l">{item.category}</div>
                <div className="bb-t">
                  <div className="bb-f" style={{ width: `${Math.min(100, utilisation)}%`, background: anomaly.flagged ? "var(--rd)" : "var(--gn)" }} />
                </div>
                <div className="bb-v">${item.spent.toLocaleString()} / ${item.budget.toLocaleString()}</div>
                <Badge tone={anomaly.flagged ? "critical" : "passed"}>{anomaly.confidence}%</Badge>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function TeamPage() {
  const { state } = useSiteForge();
  const siteId = state.session.siteId;
  const users = state.users.filter((user) => user.siteIds?.includes(siteId) || canSeeAllSites(user.role));
  return (
    <div className="oy fin">
      <div className="team-grid">
        {users.map((user) => (
          <div className="cd team-card" key={user.id}>
            <div className="team-avatar">{user.avatar}</div>
            <div className="b sm">{user.name}</div>
            <div className="xs ct3">
              {user.role} · {user.trade}
            </div>
            <div className="xs ct3" style={{ marginTop: 4 }}>
              {user.company}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalculatorsPage() {
  const { state, actions } = useSiteForge();
  const [activeId, setActiveId] = useState("concrete");
  const [showWorking, setShowWorking] = useState(false);
  const [values, setValues] = useState({});
  const calculators = [
    {
      id: "concrete",
      title: "Concrete Volume",
      unit: "m3",
      inputs: [
        { key: "length", label: "Length (m)" },
        { key: "width", label: "Width (m)" },
        { key: "depth", label: "Depth (mm)" },
      ],
      solve: ({ length = 0, width = 0, depth = 0 }) => ({ result: ((length * width * depth) / 1000).toFixed(2), working: "length × width × (depth ÷ 1000)" }),
    },
    {
      id: "paint",
      title: "Paint Coverage",
      unit: "L",
      inputs: [{ key: "area", label: "Area (m²)" }, { key: "coats", label: "Coats" }],
      solve: ({ area = 0, coats = 1 }) => ({ result: ((area * coats) / 12).toFixed(1), working: "(area × coats) ÷ 12" }),
    },
    {
      id: "tile",
      title: "Tile + Adhesive + Grout",
      unit: "tiles",
      inputs: [{ key: "area", label: "Area (m²)" }, { key: "tileArea", label: "Tile face (m²)" }, { key: "waste", label: "Waste %" }],
      solve: ({ area = 0, tileArea = 0.09, waste = 10 }) => ({
        result: Math.ceil((area / Math.max(tileArea, 0.01)) * (1 + waste / 100)),
        working: "(area ÷ tile face) × waste factor",
        extra: `Adhesive ${(area * 4).toFixed(1)}kg · Grout ${(area * 0.35).toFixed(1)}kg`,
      }),
    },
    {
      id: "plasterboard",
      title: "Plasterboard Sheets + Compound",
      unit: "sheets",
      inputs: [{ key: "wallArea", label: "Wall/Ceiling area (m²)" }, { key: "sheetArea", label: "Sheet area (m²)" }],
      solve: ({ wallArea = 0, sheetArea = 8.64 }) => ({
        result: Math.ceil(wallArea / Math.max(sheetArea, 0.1)),
        working: "wall area ÷ sheet area",
        extra: `Compound ${(wallArea * 0.22).toFixed(1)} bags`,
      }),
    },
    {
      id: "timber",
      title: "Framing Timber",
      unit: "LM",
      inputs: [{ key: "wallLength", label: "Wall length (m)" }, { key: "height", label: "Height (m)" }, { key: "spacing", label: "Stud spacing (mm)" }],
      solve: ({ wallLength = 0, height = 2.4, spacing = 450 }) => {
        const studs = Math.ceil(wallLength / Math.max(spacing / 1000, 0.1)) + 1;
        return {
          result: (studs * height + wallLength * 2).toFixed(1),
          working: "stud count × height + plates",
          extra: `${studs} studs`,
        };
      },
    },
    {
      id: "reo",
      title: "Reo Mesh + Bars",
      unit: "sheets",
      inputs: [{ key: "slabArea", label: "Slab area (m²)" }, { key: "sheetArea", label: "Mesh sheet area (m²)" }],
      solve: ({ slabArea = 0, sheetArea = 14.4 }) => ({
        result: Math.ceil(slabArea / Math.max(sheetArea, 0.1)),
        working: "slab area ÷ mesh sheet area",
        extra: `Bars ${Math.ceil((slabArea / 10) * 1.2)} lengths`,
      }),
    },
    {
      id: "insulation",
      title: "Insulation Rolls",
      unit: "rolls",
      inputs: [{ key: "area", label: "Area (m²)" }, { key: "rollCoverage", label: "Roll coverage (m²)" }],
      solve: ({ area = 0, rollCoverage = 18 }) => ({ result: Math.ceil(area / Math.max(rollCoverage, 1)), working: "area ÷ roll coverage" }),
    },
    {
      id: "fasteners",
      title: "Fastener Quantities",
      unit: "pcs",
      inputs: [{ key: "fixings", label: "Fixings count" }, { key: "factor", label: "Allow extra %" }],
      solve: ({ fixings = 0, factor = 10 }) => ({ result: Math.ceil(fixings * (1 + factor / 100)), working: "fixings × extra factor" }),
    },
    {
      id: "cable",
      title: "Cable Runs + Load",
      unit: "m",
      inputs: [{ key: "runLength", label: "Run length (m)" }, { key: "circuits", label: "Circuits" }, { key: "load", label: "Load per circuit (A)" }],
      solve: ({ runLength = 0, circuits = 1, load = 10 }) => ({
        result: (runLength * circuits).toFixed(1),
        working: "run length × circuits",
        extra: `Total load ${(circuits * load).toFixed(1)}A`,
      }),
    },
    {
      id: "hydraulic",
      title: "Hydraulic Pipe + Fittings",
      unit: "m",
      inputs: [{ key: "pipeRun", label: "Pipe run (m)" }, { key: "drops", label: "Drops / fixtures" }],
      solve: ({ pipeRun = 0, drops = 0 }) => ({
        result: pipeRun.toFixed(1),
        working: "entered run length",
        extra: `Allow ${Math.ceil(drops * 3)} fittings`,
      }),
    },
    {
      id: "soil",
      title: "Soil / Gravel / Sand",
      unit: "m3",
      inputs: [{ key: "length", label: "Length (m)" }, { key: "width", label: "Width (m)" }, { key: "depth", label: "Depth (m)" }],
      solve: ({ length = 0, width = 0, depth = 0 }) => {
        const volume = length * width * depth;
        return { result: volume.toFixed(2), working: "length × width × depth", extra: `Truck loads ${Math.ceil(volume / 10)}` };
      },
    },
    {
      id: "skip",
      title: "Skip Bin Sizing",
      unit: "m3",
      inputs: [{ key: "wasteVolume", label: "Waste volume (m³)" }],
      solve: ({ wasteVolume = 0 }) => ({ result: Math.ceil(wasteVolume / 3) * 3, working: "round up to nearest standard bin size" }),
    },
  ];
  const active = calculators.find((calculator) => calculator.id === activeId) || calculators[0];
  const activeValues = values[active.id] || {};
  const solved = active.solve(Object.fromEntries(active.inputs.map((input) => [input.key, Number(activeValues[input.key] || 0)])));
  return (
    <div className="oy fin">
      <div className="g32">
        <Card title="Calculator Suite" icon={Icons.calc}>
          <div className="fx" style={{ gap: 6, flexWrap: "wrap" }}>
            {calculators.map((calculator) => (
              <button className={`ft ${active.id === calculator.id ? "on" : ""}`.trim()} key={calculator.id} onClick={() => setActiveId(calculator.id)} type="button">
                {calculator.title}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            {active.inputs.map((input) => (
              <div className="ff" key={input.key}>
                <label>{input.label}</label>
                <input
                  value={activeValues[input.key] || ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [active.id]: { ...(current[active.id] || {}), [input.key]: event.target.value },
                    }))
                  }
                />
              </div>
            ))}
            <label className="sig-check">
              <input type="checkbox" checked={showWorking} onChange={(event) => setShowWorking(event.target.checked)} />
              Show working
            </label>
            <div className="cr">
              <span>{active.title}</span>
              {solved.result} {active.unit}
            </div>
            {showWorking ? <div className="sm ct2" style={{ marginTop: 10 }}>{solved.working}</div> : null}
            {solved.extra ? <div className="sm ct2" style={{ marginTop: 6 }}>{solved.extra}</div> : null}
            <div className="fa">
              <Button
                onClick={() =>
                  actions.saveCalculatorResult({
                    calculator: active.title,
                    result: `${solved.result} ${active.unit}`,
                    working: solved.working,
                  })
                }
              >
                Save to History
              </Button>
              <Button
                tone="bt-p"
                onClick={() =>
                  actions.saveCalculationToProcurement({
                    calculator: active.title,
                    historyId: `${active.id}-${Date.now()}`,
                    item: `${active.title} material allowance`,
                    quantity: `${solved.result} ${active.unit}`,
                  })
                }
              >
                Send to Procurement
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Recent Calculations" icon={Icons.clock}>
          <div className="list-stack">
            {(state.calculatorHistory || []).slice(0, 12).map((entry) => (
              <div className="linked-row" key={entry.id}>
                <div>
                  <div className="b sm">{entry.calculator}</div>
                  <div className="xs ct3">{entry.at}</div>
                </div>
                <span className="mono xs">{entry.result}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ReportsPage() {
  const { state, actions, derived } = useSiteForge();
  const site = derived.currentSite;
  if (!site) {
    return (
      <div className="oy fin">
        <Card title="Reports setup required" icon={Icons.download}>
          <EmptyState
            icon={Icons.download}
            title="No project is available for reports"
            description="Project reports need a valid project. Complete onboarding or create a project before generating report artifacts."
            action={<Button tone="bt-p" onClick={() => actions.restartOnboarding()}>Restart Onboarding</Button>}
          />
        </Card>
      </div>
    );
  }
  const siteMetric = derived.metrics.siteMetrics.find((metric) => metric.siteId === site.id) || {
    costExposure: 0,
    timeExposure: 0,
    presenceConfidence: 0,
  };
  const reportTypes = [
    ["daily-site-report", "Daily Site Report"],
    ["weekly-site-operations", "Weekly Site Operations"],
    ["weekly-clientflow", "Weekly ClientFlow"],
    ["monthly-compliance", "Monthly Compliance"],
    ["monthly-safety", "Monthly Safety"],
    ["handover-pack", "Handover Pack"],
    ["audit-trail", "Audit Trail"],
  ];
  const siteReports = state.boardReports.filter((report) => !report.siteId || report.siteId === site.id).slice(0, 8);
  const queuedReports = state.reportQueue.filter((report) => report.siteId === site.id).slice(0, 8);

  return (
    <div className="oy fin">
      <div className="g3">
        <Card title="Project Health" icon={Icons.bar}>
          <div className="g2">
            <div>
              <div className="xs ct3">Progress</div>
              <div className="mono bb">{site.progress}%</div>
            </div>
            <div>
              <div className="xs ct3">Cost exposure</div>
              <div className="mono bb">${Math.round(siteMetric.costExposure)}</div>
            </div>
            <div>
              <div className="xs ct3">Time exposure</div>
              <div className="mono bb">{siteMetric.timeExposure}d</div>
            </div>
            <div>
              <div className="xs ct3">Presence confidence</div>
              <div className="mono bb">{siteMetric.presenceConfidence}%</div>
            </div>
          </div>
        </Card>
        <Card title="Commercial Recovery" icon={Icons.shuffle}>
          <div className="sm ct2">
            Signed approvals this site: {state.approvals.filter((approval) => approval.siteId === site.id && approval.status === "signed").length}
          </div>
        </Card>
        <Card title="ClientFlow Value" icon={Icons.flag}>
          <div className="sm ct2">
            Approved or signed value: $
            {state.approvals
              .filter((approval) => approval.siteId === site.id && ["approved", "signed", "contract-drafted", "contract-awaiting-client"].includes(approval.status))
              .reduce((sum, approval) => sum + approval.costImpact, 0)
              .toLocaleString()}
          </div>
        </Card>
      </div>
      <div className="g32" style={{ marginTop: 12 }}>
        <Card title="Operations PDF Reports" icon={Icons.download}>
          <div className="list-stack">
            {reportTypes.map(([value, label]) => (
              <div className="linked-row" key={value}>
                <div>
                  <div className="b sm">{label}</div>
                  <div className="xs ct3">Generates a durable PDF artifact into Document Control.</div>
                </div>
                <Button small tone="bt-p" onClick={() => actions.generateOperationsReport(value, site.id)}>
                  Generate PDF
                </Button>
              </div>
            ))}
          </div>
          <div className="fx" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Button tone="bt-s" icon={Icons.clock} onClick={() => actions.queueScheduledReports()}>
              Queue Scheduled Reports
            </Button>
            <Button tone="bt-p" icon={Icons.zap} onClick={() => actions.generateWeeklyOperationsSummary()}>
              Generate AI Weekly Summary
            </Button>
          </div>
        </Card>

        <div>
          <Card title="Scheduled Delivery Queue" icon={Icons.clock} className="mb8">
            <div className="list-stack">
              {queuedReports.length ? (
                queuedReports.map((report) => (
                  <div className="linked-row" key={report.id}>
                    <div>
                      <div className="b sm">{report.reportType}</div>
                      <div className="xs ct3">Queued {report.queuedAt} · recipients {(report.recipients || []).join(", ")}</div>
                    </div>
                    <Badge tone="medium">{report.status}</Badge>
                  </div>
                ))
              ) : (
                <EmptyState icon={Icons.clock} title="No scheduled reports queued" description="Queued weekly and monthly operations reports will appear here before delivery." />
              )}
            </div>
          </Card>
          <Card title="Generated Report Artifacts" icon={Icons.file}>
            <div className="list-stack">
              {siteReports.length ? (
                siteReports.map((report) => (
	                  <div className="linked-row" key={report.id}>
	                    <div>
	                      <div className="b sm">{report.title}</div>
	                      <div className="xs ct3">{report.createdAt} · {report.documentId ? "Document Control" : "Boardroom only"}</div>
	                    </div>
	                    <div className="fx" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
	                      <Badge tone={report.fileId ? "passed" : "medium"}>{report.fileId ? "PDF" : "summary"}</Badge>
	                      <Badge tone={["openai", "claude"].includes(report.source) ? "passed" : report.upgradeStartedAt ? "medium" : "medium"}>{report.upgradeStartedAt ? "AI upgrading" : aiSourceLabel(report.source)}</Badge>
	                    </div>
	                  </div>
                ))
              ) : (
                <EmptyState icon={Icons.file} title="No report artifacts yet" description="Generate an operations report to store a durable PDF in Document Control." />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AdminPage() {
  const { actions, derived, persistence, state } = useSiteForge();
  const currentUser = derived.currentUser;
  const integrationSettings = state.device?.settings?.integrations || state.settings?.integrations || {};
  const storedAiConfig = getStoredAiConfig(integrationSettings);
  const [companyForm, setCompanyForm] = useState({
    name: state.org?.settings?.company?.name || state.settings?.company?.name || state.company?.name || "",
    legalName: state.org?.settings?.company?.legalName || state.settings?.company?.legalName || state.company?.legalName || "",
    abn: state.org?.settings?.company?.abn || state.settings?.company?.abn || state.company?.abn || "",
    address: state.org?.settings?.company?.address || state.settings?.company?.address || state.company?.address || "",
    phone: state.org?.settings?.company?.phone || state.settings?.company?.phone || state.company?.phone || "",
    email: state.org?.settings?.company?.email || state.settings?.company?.email || state.company?.email || "",
    website: state.org?.settings?.company?.website || state.settings?.company?.website || state.company?.website || "",
    defaultContractType: state.org?.settings?.contractDefaults?.defaultContractType || state.settings?.contractDefaults?.defaultContractType || "HIA",
    logoDataUrl: state.org?.settings?.company?.logoDataUrl || state.settings?.company?.logoDataUrl || "",
  });
  const [integrationsForm, setIntegrationsForm] = useState({
    aiProvider: storedAiConfig.provider,
    anthropicApiKey: storedAiConfig.anthropicKey,
    openaiApiKey: storedAiConfig.openaiKey,
    openaiProxyUrl: storedAiConfig.openaiProxyUrl,
    aiModel: storedAiConfig.model,
    anthropicModel: integrationSettings.anthropicModel || integrationSettings.aiModel || DEFAULT_AI_MODELS.anthropic,
    openaiModel: integrationSettings.openaiModel || DEFAULT_AI_MODELS.openai,
    buildxactApiKey: state.device?.settings?.integrations?.buildxactApiKey || state.settings?.integrations?.buildxactApiKey || "",
    buildxactWorkspaceId: state.device?.settings?.integrations?.buildxactWorkspaceId || state.settings?.integrations?.buildxactWorkspaceId || "",
  });
  const [appearanceForm, setAppearanceForm] = useState({ theme: state.device?.settings?.appearance?.theme || state.settings?.appearance?.theme || state.settings?.theme || "light" });
  const [userForm, setUserForm] = useState({
    displayName: state.user?.settings?.profile?.displayName || currentUser?.name || "",
    role: state.user?.settings?.profile?.role || currentUser?.role || state.session.role,
    email: state.user?.settings?.profile?.email || currentUser?.email || "",
    phone: state.user?.settings?.profile?.phone || currentUser?.phone || "",
  });
  const [notificationForm, setNotificationForm] = useState({
    inApp: state.user?.settings?.notifications?.inApp ?? true,
    email: state.user?.settings?.notifications?.email ?? true,
    teams: state.user?.settings?.notifications?.teams ?? false,
    quietHours: state.user?.settings?.notifications?.quietHours ?? false,
  });
  const [settingsMessage, setSettingsMessage] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [importCandidate, setImportCandidate] = useState(null);
  const [testingAi, setTestingAi] = useState(false);
  const [testingProxy, setTestingProxy] = useState(false);

  const saveCompany = () => {
    if (!companyForm.name.trim()) {
      setSettingsMessage("Company name is required.");
      return;
    }
    if (!validateABN(companyForm.abn)) {
      setSettingsMessage("ABN must be a valid 11-digit Australian Business Number.");
      return;
    }
    if (!validEmail(companyForm.email)) {
      setSettingsMessage("Company email format is invalid.");
      return;
    }
    if (!validAuPhone(companyForm.phone)) {
      setSettingsMessage("Phone number should be an Australian landline or mobile format.");
      return;
    }
    actions.updateSettings("company", companyForm);
    actions.updateSettings("contractDefaults", { defaultContractType: companyForm.defaultContractType });
    setSettingsMessage("Company settings saved and will flow into contracts and portal headers.");
  };

  const saveIntegrations = () => {
    const provider = normaliseAiProvider(integrationsForm.aiProvider);
    const activeModel = provider === AI_PROVIDERS.OPENAI ? integrationsForm.openaiModel : integrationsForm.anthropicModel;
    const proxyUrlToSave = normaliseOpenAiProxyUrl(integrationsForm.openaiProxyUrl);
    if (typeof window !== "undefined") {
      if (integrationsForm.anthropicApiKey.trim()) {
        window.localStorage.setItem(AI_STORAGE_KEYS.anthropic, integrationsForm.anthropicApiKey.trim());
      } else {
        window.localStorage.removeItem(AI_STORAGE_KEYS.anthropic);
      }
      if (integrationsForm.openaiApiKey.trim()) {
        window.localStorage.setItem(AI_STORAGE_KEYS.openai, integrationsForm.openaiApiKey.trim());
      } else {
        window.localStorage.removeItem(AI_STORAGE_KEYS.openai);
      }
      if (proxyUrlToSave) {
        window.localStorage.setItem(AI_STORAGE_KEYS.openaiProxy, proxyUrlToSave);
      } else {
        window.localStorage.removeItem(AI_STORAGE_KEYS.openaiProxy);
      }
    }
    setIntegrationsForm((current) => ({ ...current, openaiProxyUrl: proxyUrlToSave }));
    actions.updateSettings("integrations", {
      aiProvider: provider,
      aiModel: activeModel,
      anthropicModel: integrationsForm.anthropicModel,
      openaiModel: integrationsForm.openaiModel,
      openaiProxyConfigured: Boolean(proxyUrlToSave),
      anthropicConfigured: Boolean(integrationsForm.anthropicApiKey.trim()),
      openaiConfigured: Boolean(integrationsForm.openaiApiKey.trim()),
      buildxactApiKey: integrationsForm.buildxactApiKey,
      buildxactWorkspaceId: integrationsForm.buildxactWorkspaceId,
    });
    setSettingsMessage("Integration settings saved. AI keys are stored on this device only.");
  };

  const testAiConnection = async () => {
    const provider = normaliseAiProvider(integrationsForm.aiProvider);
    const apiKey = provider === AI_PROVIDERS.OPENAI ? integrationsForm.openaiApiKey.trim() : integrationsForm.anthropicApiKey.trim();
    const model = provider === AI_PROVIDERS.OPENAI ? integrationsForm.openaiModel : integrationsForm.anthropicModel;
    const providerName = provider === AI_PROVIDERS.OPENAI ? "OpenAI" : "Claude";
    if (!apiKey) {
      setSettingsMessage(`Paste a ${providerName} API key first.`);
      return;
    }
    setTestingAi(true);
    try {
      const result = await runProviderConnectionTest({
        provider,
        apiKey,
        model,
        openaiProxyUrl: normaliseOpenAiProxyUrl(integrationsForm.openaiProxyUrl),
      });
      const testPatch = {
        aiLastTestedAt: new Date().toISOString(),
        aiLastTestStatus: result.ok ? "ok" : "failed",
        aiLastTestProvider: provider,
        aiLastTestMessage: result.text || "",
      };
      actions.updateSettings("integrations", testPatch);
      if (result.ok) {
        setSettingsMessage(`✓ ${providerName} API key works.`);
      } else {
        setSettingsMessage(result.text || `${providerName} API key test failed.`);
      }
    } catch (error) {
      setSettingsMessage(`${providerName} API key test failed: ${error?.message || "Unknown error"}`);
    } finally {
      setTestingAi(false);
    }
  };

  const runProxyVerification = async () => {
    setTestingProxy(true);
    try {
      const cleanedProxyUrl = normaliseOpenAiProxyUrl(integrationsForm.openaiProxyUrl);
      if (cleanedProxyUrl && cleanedProxyUrl !== integrationsForm.openaiProxyUrl.trim()) {
        setIntegrationsForm((current) => ({ ...current, openaiProxyUrl: cleanedProxyUrl }));
      }
      const result = await verifyOpenAiProxy(cleanedProxyUrl || integrationsForm.openaiProxyUrl.trim());
      const testedUrl = result.proxyUrl || cleanedProxyUrl;
      setSettingsMessage(result.ok ? `✓ ${result.text} Tested ${testedUrl}/health.` : result.text);
    } catch (error) {
      setSettingsMessage(`Proxy verification failed: ${error?.message || "Unknown error"}`);
    } finally {
      setTestingProxy(false);
    }
  };

  const saveAppearance = () => {
    actions.updateSettings("appearance", appearanceForm);
    setSettingsMessage("Theme preference saved.");
  };

  const saveUserSettings = () => {
    if (!userForm.displayName.trim()) {
      setSettingsMessage("Display name is required.");
      return;
    }
    if (userForm.email && !validEmail(userForm.email)) {
      setSettingsMessage("User email format is invalid.");
      return;
    }
    actions.updateSettings("profile", userForm);
    actions.updateSettings("notifications", notificationForm);
    setSettingsMessage("User profile and notification preferences saved.");
  };

  const validateImportShape = (payload) =>
    payload &&
    Array.isArray(payload.sites) &&
    Array.isArray(payload.users) &&
    Array.isArray(payload.approvals) &&
    payload.session &&
    payload.settings;

  const modeLabel = (mode) => (mode === "demo" ? "Demo data" : "My data");
  const activeMode = state.org?.mode === "demo" || state.org?.mode === "real" ? state.org.mode : "blank";
  const todayStamp = new Date().toISOString().slice(0, 10);
  const realSlotExists = storageSlotExists("real") || activeMode === "real";
  const demoSlotExists = INCLUDE_DEMO_DATA && (storageSlotExists("demo") || activeMode === "demo");
  const storageSummary = [
    ["Current mode", activeMode === "blank" ? "Not set up" : modeLabel(activeMode)],
    ["Real slot", realSlotExists ? "present" : "empty"],
    INCLUDE_DEMO_DATA ? ["Demo slot", demoSlotExists ? "present" : "empty"] : ["Build", "Production"],
  ];

  const exportModeState = async (mode) => {
    const payload = activeMode === mode ? state : readStateSlot(mode);
    if (!payload) {
      setSettingsMessage(`${modeLabel(mode)} has no saved state yet.`);
      return;
    }
    const backup = await buildBackupBundle(payload);
    downloadJson(`siteforge-${mode}-export-${todayStamp}.json`, backup);
  };

  const handleImportFile = async (file, mode = activeMode === "demo" ? "demo" : "real") => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const payload = parsed.state || parsed;
      if (!validateImportShape(payload)) {
        setSettingsMessage("Import file does not match SiteForge schema.");
        return;
      }
      if (payload.org?.mode && payload.org.mode !== mode) {
        setSettingsMessage(`This file is a ${payload.org.mode} export. Import it under ${modeLabel(payload.org.mode)} instead.`);
        return;
      }
      setImportCandidate({ mode, payload: { ...payload, org: { ...(payload.org || {}), mode } }, blobs: parsed.blobs || null });
      setSettingsMessage(`${modeLabel(mode)} import validated. Confirm replacement to restore it.`);
    } catch (error) {
      setSettingsMessage(`Import failed: ${error?.message || "Invalid JSON file."}`);
    }
  };

  const clearModeData = (mode) => {
    if (deleteConfirm !== "DELETE") {
      setSettingsMessage(`Type "DELETE" to confirm clearing ${modeLabel(mode)}.`);
      return;
    }
    clearStateSlot(mode);
    deletePersistedAppState(getStateStorageKey(mode)).catch(() => {});
    if (activeMode === mode) {
      actions.resetCurrentMode();
    }
    setDeleteConfirm("");
    setSettingsMessage(`${modeLabel(mode)} cleared. The other workspace was not touched.`);
  };
  const unregisterServiceWorker = async () => {
    try {
      const registrations = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((registrations || []).map((registration) => registration.unregister()));
      const cacheNames = typeof caches !== "undefined" ? await caches.keys() : [];
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      setSettingsMessage("Service worker and offline caches cleared. Reload the app to fetch a clean shell.");
    } catch (error) {
      setSettingsMessage(`Could not clear service worker cache: ${error?.message || "browser support unavailable"}`);
    }
  };

  return (
    <div className="oy fin">
      {settingsMessage ? <div className="notice-banner mb8">{settingsMessage}</div> : null}
      {persistence?.persistenceDegraded || state.persistenceDegraded ? (
        <div className="notice-banner mb8">
          This browser cannot reliably store the current project volume. Use Chrome or enable IndexedDB storage before adding more photos, audio, or PDFs. Your latest work may not be saved.
        </div>
      ) : null}
      <div className="notice-banner mb8">
        Settings are split for backend readiness: organisation settings sync across the company, device settings stay local to this browser, and user settings follow the signed-in person.
      </div>
      <div className="g2 mb8">
        <Card title="Organisation Settings" icon={Icons.briefcase}>
          <div className="g2">
            <div className="ff">
              <label>Trading name</label>
              <input value={companyForm.name} onChange={(event) => setCompanyForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="ff">
              <label>Legal name</label>
              <input value={companyForm.legalName} onChange={(event) => setCompanyForm((current) => ({ ...current, legalName: event.target.value }))} />
            </div>
          </div>
          <div className="g2">
            <div className="ff">
              <label>ABN</label>
              <input value={companyForm.abn} onChange={(event) => setCompanyForm((current) => ({ ...current, abn: event.target.value }))} />
            </div>
            <div className="ff">
              <label>Email</label>
              <input value={companyForm.email} onChange={(event) => setCompanyForm((current) => ({ ...current, email: event.target.value }))} />
            </div>
          </div>
          <div className="ff">
            <label>Address</label>
            <input value={companyForm.address} onChange={(event) => setCompanyForm((current) => ({ ...current, address: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Website</label>
            <input value={companyForm.website} onChange={(event) => setCompanyForm((current) => ({ ...current, website: event.target.value }))} />
          </div>
          <div className="g2">
            <div className="ff">
              <label>Phone</label>
              <input value={companyForm.phone} onChange={(event) => setCompanyForm((current) => ({ ...current, phone: event.target.value }))} />
            </div>
            <div className="ff">
              <label>Default contract type</label>
              <select value={companyForm.defaultContractType} onChange={(event) => setCompanyForm((current) => ({ ...current, defaultContractType: event.target.value }))}>
                {["HIA", "AS4000", "AS2124", "MBA", "Custom"].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="g2">
            <div className="ff">
              <label>Logo</label>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => setCompanyForm((current) => ({ ...current, logoDataUrl: reader.result }));
                  reader.readAsDataURL(file);
                }}
              />
            </div>
          </div>
          {companyForm.logoDataUrl ? <img alt="Company logo preview" src={companyForm.logoDataUrl} className="settings-logo-preview" /> : null}
          <Button tone="bt-p" onClick={saveCompany}>
            Save Company Settings
          </Button>
        </Card>
        <Card title="Device Settings: Integrations" icon={Icons.zap}>
          <div className="ff">
            <label>AI provider</label>
            <select
              value={integrationsForm.aiProvider}
              onChange={(event) =>
                setIntegrationsForm((current) => {
                  const provider = normaliseAiProvider(event.target.value);
                  return {
                    ...current,
                    aiProvider: provider,
                    aiModel: provider === AI_PROVIDERS.OPENAI ? current.openaiModel : current.anthropicModel,
                  };
                })
              }
            >
              <option value={AI_PROVIDERS.ANTHROPIC}>Claude / Anthropic</option>
              <option value={AI_PROVIDERS.OPENAI}>ChatGPT / OpenAI</option>
            </select>
            <div className="xs ct3" style={{ marginTop: 4 }}>Choose whichever API key you have. Keys stay in this browser only.</div>
          </div>
          <div className="ff">
            <label>Claude API key</label>
            <input type="password" value={integrationsForm.anthropicApiKey} onChange={(event) => setIntegrationsForm((current) => ({ ...current, anthropicApiKey: event.target.value }))} placeholder="sk-ant-..." />
            <div className="xs ct3" style={{ marginTop: 4 }}>Works directly from this browser. Get a key at console.anthropic.com.</div>
          </div>
          <div className="ff">
            <label>Claude model</label>
            <input value={integrationsForm.anthropicModel} onChange={(event) => setIntegrationsForm((current) => ({ ...current, anthropicModel: event.target.value, aiModel: current.aiProvider === AI_PROVIDERS.ANTHROPIC ? event.target.value : current.aiModel }))} />
          </div>
          <div className="ff">
            <label>ChatGPT / OpenAI API key</label>
            <input type="password" value={integrationsForm.openaiApiKey} onChange={(event) => setIntegrationsForm((current) => ({ ...current, openaiApiKey: event.target.value }))} placeholder="sk-..." />
            <div className="xs ct3" style={{ marginTop: 4 }}>OpenAI API keys must go through a proxy for browser apps. Get a key at platform.openai.com.</div>
          </div>
          <div className="ff">
            <label>OpenAI model</label>
            <input value={integrationsForm.openaiModel} onChange={(event) => setIntegrationsForm((current) => ({ ...current, openaiModel: event.target.value, aiModel: current.aiProvider === AI_PROVIDERS.OPENAI ? event.target.value : current.aiModel }))} />
          </div>
          <div className="ff">
            <label>OpenAI proxy URL</label>
            <input
              value={integrationsForm.openaiProxyUrl}
              onChange={(event) => setIntegrationsForm((current) => ({ ...current, openaiProxyUrl: event.target.value }))}
              onBlur={(event) => {
                const raw = event.target.value.trim();
                if (!raw) return;
                const cleaned = normaliseOpenAiProxyUrl(raw);
                if (cleaned && cleaned !== raw) {
                  setIntegrationsForm((current) => ({ ...current, openaiProxyUrl: cleaned }));
                }
              }}
              placeholder="https://your-worker.workers.dev"
            />
            <div className="xs ct3" style={{ marginTop: 4 }}>Paste just the worker root URL - no /v1/responses path. e.g. https://siteforge-openai-proxy.your-account.workers.dev</div>
            <div style={{ marginTop: 8 }}>
              <Button small onClick={runProxyVerification} disabled={testingProxy}>
                {testingProxy ? "Verifying..." : "Verify proxy"}
              </Button>
            </div>
          </div>
          {integrationSettings.aiLastTestedAt ? (
            <div className="notice-banner" style={{ marginBottom: 8 }}>
              Last AI test: {new Date(integrationSettings.aiLastTestedAt).toLocaleString("en-AU")} · {integrationSettings.aiLastTestProvider || "AI"} · {integrationSettings.aiLastTestStatus || "unknown"}
              {integrationSettings.aiLastTestMessage ? <div className="xs ct3" style={{ marginTop: 4 }}>{integrationSettings.aiLastTestMessage}</div> : null}
            </div>
          ) : (
            <div className="notice-banner" style={{ marginBottom: 8 }}>AI provider not tested yet.</div>
          )}
          <div className="ff">
            <label>Buildxact API key</label>
            <input type="password" value={integrationsForm.buildxactApiKey} onChange={(event) => setIntegrationsForm((current) => ({ ...current, buildxactApiKey: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Workspace ID</label>
            <input value={integrationsForm.buildxactWorkspaceId} onChange={(event) => setIntegrationsForm((current) => ({ ...current, buildxactWorkspaceId: event.target.value }))} />
          </div>
          <div className="fa" style={{ justifyContent: "flex-start" }}>
            <Button tone="bt-p" onClick={saveIntegrations}>
              Save Integration Settings
            </Button>
            <Button onClick={testAiConnection} disabled={testingAi}>
              {testingAi ? "Testing..." : "Test AI Connection"}
            </Button>
            <Button
              onClick={() => {
                const provider = normaliseAiProvider(integrationsForm.aiProvider);
                if (typeof window !== "undefined") {
                  window.localStorage.removeItem(provider === AI_PROVIDERS.OPENAI ? AI_STORAGE_KEYS.openai : AI_STORAGE_KEYS.anthropic);
                  if (provider === AI_PROVIDERS.OPENAI) window.localStorage.removeItem(AI_STORAGE_KEYS.openaiProxy);
                }
                setIntegrationsForm((current) =>
                  provider === AI_PROVIDERS.OPENAI
                    ? { ...current, openaiApiKey: "", openaiProxyUrl: "" }
                    : { ...current, anthropicApiKey: "" },
                );
                setSettingsMessage(`${provider === AI_PROVIDERS.OPENAI ? "OpenAI" : "Claude"} key cleared from this device.`);
              }}
            >
              Clear Active Provider Key
            </Button>
          </div>
        </Card>
      </div>
      <div className="g2">
        <Card title="Device Settings: Appearance" icon={Icons.eye}>
          <div className="ff">
            <label>Theme</label>
            <select value={appearanceForm.theme} onChange={(event) => setAppearanceForm({ theme: event.target.value })}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>
          <Button tone="bt-p" onClick={saveAppearance}>Save Theme</Button>
        </Card>
        <Card title="User Settings" icon={Icons.users}>
          <div className="g2">
            <div className="ff">
              <label>Display name</label>
              <input value={userForm.displayName} onChange={(event) => setUserForm((current) => ({ ...current, displayName: event.target.value }))} />
            </div>
            <div className="ff">
              <label>Role</label>
              <select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}>
                {["Supervisor", "Project Manager", "Contract Admin", "Director", "Subcontractor", "Client", "Worker"].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="g2">
            <div className="ff">
              <label>Email</label>
              <input value={userForm.email} onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))} />
            </div>
            <div className="ff">
              <label>Phone</label>
              <input value={userForm.phone} onChange={(event) => setUserForm((current) => ({ ...current, phone: event.target.value }))} />
            </div>
          </div>
          <div className="fx" style={{ gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            {["inApp", "email", "teams", "quietHours"].map((key) => (
              <label className="sig-check" key={key}>
                <input type="checkbox" checked={Boolean(notificationForm[key])} onChange={(event) => setNotificationForm((current) => ({ ...current, [key]: event.target.checked }))} />
                {key === "inApp" ? "In-app" : key === "quietHours" ? "Quiet hours" : key}
              </label>
            ))}
          </div>
          <Button tone="bt-p" onClick={saveUserSettings}>Save User Settings</Button>
        </Card>
        {INCLUDE_DEMO_DATA && state.org?.mode === "demo" ? (
          <Card title="Demo Controls" icon={Icons.gear}>
            <div className="sm ct2">Reset the demo data back to the seeded construction scenario at any time.</div>
            <div className="sm ct2" style={{ marginTop: 8 }}>Current simulated time: {derived.currentNow}</div>
            <Button tone="bt-p" onClick={() => actions.resetCurrentMode()} style={{ marginTop: 12 }}>
              Reset Demo
            </Button>
            <div className="fa" style={{ marginTop: 10, justifyContent: "flex-start" }}>
              <Button small icon={Icons.clock} onClick={() => actions.advanceSimulatedTime(1)}>
                +1 day
              </Button>
              <Button small icon={Icons.clock} onClick={() => actions.advanceSimulatedTime(7)}>
                +1 week
              </Button>
              <Button small icon={Icons.clock} onClick={() => actions.advanceSimulatedTime(30)}>
                +1 month
              </Button>
              <Button small onClick={() => actions.runSystemSweep()}>
                Trigger sweep
              </Button>
            </div>
          </Card>
        ) : null}
        <Card title="Data Management" icon={Icons.help}>
          <div className="g2">
            <div className="mini-card">
              <div className="b sm">My data</div>
              <div className="xs ct3">Real company storage. Demo data is rejected on import.</div>
              <div className="fa" style={{ marginTop: 10, justifyContent: "flex-start" }}>
                <Button small onClick={() => exportModeState("real")}>Export My Data</Button>
                <label className="bt small">
                  Import My Data
                  <input
                    type="file"
                    accept="application/json,.json"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      handleImportFile(event.target.files?.[0], "real");
                      event.target.value = "";
                    }}
                  />
                </label>
                <Button small tone="bt-r" onClick={() => clearModeData("real")}>Clear My Data</Button>
              </div>
            </div>
            {INCLUDE_DEMO_DATA ? (
              <div className="mini-card">
                <div className="b sm">Demo data</div>
                <div className="xs ct3">Worked demo storage. Your real data is unaffected.</div>
                <div className="fa" style={{ marginTop: 10, justifyContent: "flex-start" }}>
                  <Button small onClick={() => exportModeState("demo")}>Export Demo</Button>
                  <label className="bt small">
                    Import Demo
                    <input
                      type="file"
                      accept="application/json,.json"
                      style={{ display: "none" }}
                      onChange={(event) => {
                        handleImportFile(event.target.files?.[0], "demo");
                        event.target.value = "";
                      }}
                    />
                  </label>
                  <Button small tone="bt-p" onClick={() => actions.switchToMode("demo")}>Switch to Demo</Button>
                  <Button small tone="bt-r" onClick={() => clearModeData("demo")}>Reset Demo Slot</Button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="mini-card" style={{ marginTop: 10 }}>
            <div className="b sm">Mode switching summary</div>
            {storageSummary.map(([label, value]) => (
              <div className="linked-row" key={label}>
                <span>{label}</span>
                <Badge tone={value === "empty" ? "medium" : "passed"}>{value}</Badge>
              </div>
            ))}
            <div className="linked-row">
              <span>Last saved</span>
              <Badge tone={persistence?.lastPersistedAt ? "passed" : "medium"}>
                {persistence?.lastPersistedAt ? new Date(persistence.lastPersistedAt).toLocaleTimeString("en-AU") : "pending"}
              </Badge>
            </div>
            <div className="linked-row">
              <span>Real key</span>
              <span className="mono xs">{getStateStorageKey("real")}</span>
            </div>
            {INCLUDE_DEMO_DATA ? (
              <div className="linked-row">
                <span>Demo key</span>
                <span className="mono xs">{getStateStorageKey("demo")}</span>
              </div>
            ) : null}
            <div className="linked-row">
              <div>
                <div className="b sm">Confirm destructive actions</div>
                <div className="xs ct3">Type DELETE before clearing either workspace.</div>
              </div>
              <input className="inline-input" style={{ maxWidth: 120 }} value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} />
            </div>
            <Button onClick={unregisterServiceWorker}>Emergency Reset Offline Cache</Button>
          </div>
        </Card>
        <Card title="Billing & Subscription" icon={Icons.dollar}>
          <div className="list-stack">
            {[
              ["Free", "$0/mo", "1 demo project, local-only data"],
              ["Starter", "$49/mo", "Small builder operations layer"],
              ["Pro", "$199/mo", "ClientFlow, Passport, Presence and integrations"],
              ["Enterprise", "Contact", "Backend, SSO, compliance pack and custom retention"],
            ].map(([plan, price, copy]) => (
              <div className="linked-row" key={plan}>
                <div>
                  <div className="b sm">{plan} · {price}</div>
                  <div className="xs ct3">{copy}</div>
                </div>
                <Badge tone={state.billing?.plan === plan ? "passed" : "medium"}>{state.billing?.plan === plan ? "current" : "upgrade"}</Badge>
              </div>
            ))}
          </div>
          <div className="mini-grid" style={{ marginTop: 12 }}>
            <div className="mini-card"><span>Storage</span><b>{state.billing?.usage?.storageMb || 0}MB</b></div>
            <div className="mini-card"><span>AI tokens</span><b>{state.billing?.usage?.aiTokens || 0}</b></div>
            <div className="mini-card"><span>Active projects</span><b>{state.billing?.usage?.activeProjects || 0}</b></div>
          </div>
          <Button style={{ marginTop: 12 }} onClick={() => setSettingsMessage("Billing upgrade flow is scaffolded and waits for Stripe in Tier 12.")}>
            Open Upgrade Page
          </Button>
        </Card>
      </div>
      <Modal open={Boolean(importCandidate)} close={() => setImportCandidate(null)} title="Import SiteForge Data">
        <div className="sm ct2">
          Replace {modeLabel(importCandidate?.mode)} with the imported data? The other workspace will not be touched.
        </div>
        <div className="fa">
          <Button onClick={() => setImportCandidate(null)}>Cancel</Button>
          <Button
            tone="bt-r"
            onClick={async () => {
              if (importCandidate?.blobs) {
                await restoreBackupBlobs(importCandidate.blobs);
              }
              if (importCandidate?.mode === activeMode) {
                actions.importState(importCandidate.payload);
              } else if (importCandidate?.mode) {
                writeStateSlot(importCandidate.mode, importCandidate.payload);
                persistAppState(getStateStorageKey(importCandidate.mode), importCandidate.payload).catch(() => {});
              }
              setImportCandidate(null);
              setSettingsMessage("Imported SiteForge data and referenced photo blobs restored to the selected workspace.");
            }}
          >
            Replace Current State
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function FinancialSummaryPage() {
  const { state } = useSiteForge();
  const financialPulse = state.financialPulse && typeof state.financialPulse === "object" ? state.financialPulse : {};
  const pulse = financialPulse[state.session.period] || financialPulse["This Week"] || Object.values(financialPulse)[0] || {
    revenueRecognised: 0,
    marginAtRisk: 0,
    contingencyConsumed: 0,
    variationExposure: 0,
  };
  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "Revenue Recognised", value: `$${Math.round(pulse.revenueRecognised / 1000)}k`, color: "g" },
          { label: "Margin At Risk", value: `$${Math.round(pulse.marginAtRisk / 1000)}k`, color: "r" },
          { label: "Contingency", value: `$${Math.round(pulse.contingencyConsumed / 1000)}k`, color: "a" },
          { label: "Variation Exposure", value: `$${Math.round(pulse.variationExposure / 1000)}k`, color: "b" },
        ]}
      />
    </div>
  );
}

function CommercialRiskPage() {
  const { state } = useSiteForge();
  const rows = state.approvals.filter((approval) => !["signed", "declined"].includes(approval.status));
  return (
    <div className="oy fin">
      <Card title="Commercial Risk Register" icon={Icons.alert}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Approval</th>
                <th>Site</th>
                <th>Cost</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((approval) => (
                <tr key={approval.id}>
                  <td className="b sm">{approval.title}</td>
                  <td className="xs">{state.sites.find((site) => site.id === approval.siteId)?.name || approval.siteId}</td>
                  <td className="mono xs">${approval.costImpact.toLocaleString()}</td>
                  <td className="mono xs">{approval.timeImpact}d</td>
                  <td>
                    <Badge tone="high">{approval.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SafetyRecordPage() {
  const { state } = useSiteForge();
  return (
    <div className="oy fin">
      <Card title="Portfolio Safety Record" icon={Icons.shield}>
        <div className="list-stack">
          {state.safety.map((entry) => (
            <div className="linked-row" key={entry.id}>
              <div>
                <div className="b sm">{entry.topic}</div>
                <div className="xs ct3">
                  {entry.siteId} · {entry.date}
                </div>
              </div>
              <Badge tone={entry.type === "critical" || entry.type === "incident" ? "critical" : "passed"}>{entry.type}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AuditPage() {
  const { state, derived, actions } = useSiteForge();
  const [selected, setSelected] = useState(null);
  const columns = [
    { key: "timestamp", label: "At", type: "date", filterable: true },
    {
      key: "actor",
      label: "Actor",
      filterable: true,
      render: (_, row) => (
        <div>
          <div className="b sm">{row.actor}</div>
          <div className="xs ct3">{row.actorRole}</div>
        </div>
      ),
    },
    { key: "action", label: "Action", filterable: true },
    {
      key: "entity",
      label: "Entity",
      filterable: true,
      accessor: (row) => `${row.entityType} ${row.entityId}`,
      render: (_, row) => (
        <div className="xs">
          {row.entityType} · {row.entityId}
        </div>
      ),
    },
    { key: "siteId", label: "Site", filterable: true },
    { key: "verification", label: "Integrity", filterable: true, options: ["verified"], render: (value) => <Badge tone="passed">{value}</Badge> },
  ];
  return (
    <div className="oy fin">
      <Card title="Audit Trail" icon={Icons.clipboard}>
        <div className="linked-row" style={{ marginBottom: 12 }}>
          <div>
            <div className="b sm">Chain Verification</div>
            <div className="xs ct3">{derived.auditVerification.summary}</div>
          </div>
          <Badge tone="passed">{derived.auditVerification.status}</Badge>
        </div>
        <div className="fa" style={{ marginBottom: 12, justifyContent: "flex-start" }}>
          <Button onClick={() => exportCsv("siteforge-audit.csv", ["timestamp", "actor", "action"], state.auditTrail.map((entry) => [entry.timestamp, entry.actor, entry.action]))}>
            Export CSV
          </Button>
          <Button
            onClick={async () => {
              const node = document.querySelector(".audit-console");
              if (node) {
                await exportElementToPdf({
                  element: node,
                  filename: "siteforge-audit.pdf",
                  title: "SiteForge Audit Trail",
                  subtitle: derived.auditVerification.summary,
                });
              }
            }}
          >
            Export PDF
          </Button>
          <Button tone="bt-p" onClick={() => actions.verifyIndexedAuditChain()}>
            Verify Chain
          </Button>
        </div>
        <div className="audit-console">
          <DataTable
            storageKey="audit-console"
            columns={columns}
            rows={state.auditTrail}
            onRowClick={(row) => setSelected(row)}
            rowActions={[{ label: "Inspect", onClick: (row) => setSelected(row) }]}
          />
        </div>
      </Card>
      <Modal open={Boolean(selected)} close={() => setSelected(null)} title="Audit Entry Detail" wide>
        {selected ? (
          <div className="payload-grid">
            <pre>{JSON.stringify(selected.before, null, 2)}</pre>
            <pre>{JSON.stringify(selected.after, null, 2)}</pre>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default function OperationsPages({ page }) {
  switch (page) {
    case "portfolio":
      return <PortfolioPage />;
    case "dash":
      return <DashboardPage />;
    case "tasks":
      return <TasksPage />;
    case "probs":
      return <ProblemsPage />;
    case "wf":
      return <WorkforcePage />;
    case "mats":
      return <ProcurementPage />;
    case "rfis":
      return <RfisPage />;
    case "vos":
      return <VariationsPage />;
    case "qa":
      return <QaPage />;
    case "diary":
      return <DiaryPage />;
    case "safety":
      return <SafetyPage />;
    case "docs":
    case "plans":
      return <DocumentsPage />;
    case "sched":
      return <SchedulePage />;
    case "budget":
      return <BudgetPage />;
    case "team":
      return <TeamPage />;
    case "calc":
      return <CalculatorsPage />;
    case "rpts":
      return <ReportsPage />;
    case "admin":
      return <AdminPage />;
    case "financial-summary":
      return <FinancialSummaryPage />;
    case "commercial-risk":
      return <CommercialRiskPage />;
    case "safety-record":
      return <SafetyRecordPage />;
    case "audit":
      return <AuditPage />;
    default:
      return <RestrictedPanel title="Module Not Found" body={`No module is registered for ${page}.`} />;
  }
}
