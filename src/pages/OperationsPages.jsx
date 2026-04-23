/* SiteForge audit: Repaired live operations workflows for project creation,
   diary-to-variation conversion, variation template selection, document preview,
   plan search, annotations, and settings persistence. */

import { useEffect, useMemo, useState } from "react";
import { flagBudgetAnomaly, suggestRFI } from "../services/aiDraftService";
import DataTable from "../components/DataTable";
import FileDropZone from "../components/FileDropZone";
import { exportCsv, exportElementToPdf } from "../services/pdfService";
import { previewPdf } from "../services/documentIntelligence";
import { useSiteForge } from "../services/siteforgeStore";
import { Icons } from "../components/icons";
import {
  Badge,
  Button,
  Card,
  DetailHeader,
  LinkedRecordsPanel,
  MetricGrid,
  Modal,
  RestrictedPanel,
  Tabs,
  Timeline,
} from "../components/ui";

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
    { label: "Contract Value", value: `$${(state.sites.reduce((sum, site) => sum + site.contractValue, 0) / 1e6).toFixed(1)}M`, color: "a" },
    { label: "Margin At Risk", value: `$${Math.round(state.sites.reduce((sum, site) => sum + site.marginAtRisk, 0) / 1000)}k`, color: "r" },
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
                <div className="mono b">${Math.round(site.contractValue / 1000)}k</div>
              </div>
              <div>
                <div className="xs ct3">Margin at risk</div>
                <div className="mono b">${site.marginAtRisk.toLocaleString()}</div>
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
  const siteApprovals = state.approvals.filter((approval) => approval.siteId === site.id);
  const todaysCrew = state.presence.records.filter((record) => record.siteId === site.id && record.status === "verified-on-site");
  const openProblems = state.problems.filter((problem) => problem.siteId === site.id && ["open", "under-review"].includes(problem.status));
  const arrivingToday = state.procurement.filter((item) => item.siteId === site.id && item.eta === new Date().toISOString().slice(0, 10));
  const qaDue = state.qa.filter((entry) => entry.siteId === site.id && entry.date === new Date().toISOString().slice(0, 10));
  const siteMetric = derived.metrics.siteMetrics.find((metric) => metric.siteId === site.id);
  const openRainEvent = state.diary.find((entry) => entry.siteId === site.id && entry.rainEvent);

  const quickActions =
    role === "Supervisor"
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
                ? actions.createApprovalFromSource({ sourceType: "problem", sourceId: openProblems[0].id, approvalType: "Variation", handUp: true })
                : actions.navigate({ kind: "internal", siteId: site.id, page: "probs", entityId: null }),
          },
        ]
      : [
          { label: "New Approval", icon: Icons.flag, onClick: () => actions.navigate({ kind: "internal", siteId: site.id, page: "clientflow", entityId: null }) },
          { label: "Open Schedule", icon: Icons.cal, onClick: () => actions.navigate({ kind: "internal", siteId: site.id, page: "sched", entityId: null }) },
          { label: "Open Budget", icon: Icons.dollar, onClick: () => actions.navigate({ kind: "internal", siteId: site.id, page: "budget", entityId: null }) },
        ];

  const metrics =
    role === "Project Manager"
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
                  <Button small tone="bt-p" onClick={() => actions.createApprovalFromSource({ sourceType: "problem", sourceId: problem.id, approvalType: "Variation", handUp: role === "Supervisor" })}>
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
  const siteId = state.session.siteId;
  const [selectedId, setSelectedId] = useState(state.problems.find((problem) => problem.siteId === siteId)?.id || null);
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", costImpact: "", timeImpact: "" });
  const problems = state.problems.filter((problem) => problem.siteId === siteId);
  const selected = problems.find((problem) => problem.id === selectedId) || problems[0];

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div className="fx" style={{ gap: 6 }}>
          <Badge tone="critical">{problems.filter((problem) => problem.priority === "critical").length} critical</Badge>
          <Badge tone="medium">{problems.filter((problem) => problem.status === "open").length} open</Badge>
        </div>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
          Report Problem
        </Button>
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
                  {
                    label: "Raise Approval",
                    tone: "bt-p",
                    icon: Icons.link,
                    onClick: () => actions.createApprovalFromSource({ sourceType: "problem", sourceId: selected.id, approvalType: "Variation", handUp: state.session.role === "Supervisor" }),
                  },
                  {
                    label: "Suggest RFI",
                    icon: Icons.help,
                    onClick: () => {
                      const suggestion = suggestRFI(selected);
                      actions.createRfi({
                        title: suggestion.title,
                        description: suggestion.description,
                        to: suggestion.recommendedRecipient,
                        trade: "General",
                      });
                    },
                  },
                  {
                    label: selected.status === "resolved" ? "Reopen" : "Resolve",
                    tone: selected.status === "resolved" ? "" : "bt-g",
                    onClick: () => actions.setProblemStatus(selected.id, selected.status === "resolved" ? "open" : "resolved"),
                  },
                ]}
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
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addProblem(form);
              setOpen(false);
              setForm({ title: "", description: "", priority: "medium", costImpact: "", timeImpact: "" });
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
    "verified",
    "invoice-received",
    "paid",
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
      render: (value) => <Badge tone={["delayed", "escalated"].includes(value) ? "critical" : ["delivered", "verified", "paid"].includes(value) ? "passed" : "medium"}>{value}</Badge>,
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
          { label: "Delay", tone: "bt-r", when: (row) => !["paid", "verified"].includes(row.status), onClick: (row) => actions.transitionProcurement(row.id, "delayed") },
          { label: "Draft EOT", tone: "bt-p", when: (row) => ["delayed", "escalated"].includes(row.status), onClick: (row) => actions.createEotFromProcurement(row.id) },
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
                <Badge tone={rfi.status === "overdue" ? "critical" : rfi.status === "responded" ? "passed" : "medium"}>{rfi.status}</Badge>
              </button>
            ))}
          </div>
        </Card>
        {selected ? (
          <Card title="RFI Detail" icon={Icons.file}>
            <DetailHeader
              title={`${selected.number} ${selected.title}`}
              subtitle={`${selected.trade} · Due ${selected.dueDate}`}
              badges={[{ label: selected.status, tone: selected.status === "overdue" ? "critical" : "medium" }]}
              actions={[
                { label: "Convert to Variation", tone: "bt-p", icon: Icons.shuffle, onClick: () => actions.createVariationFromRfi(selected.id) },
                { label: "Close", tone: "", icon: Icons.check, onClick: () => actions.closeRfi(selected.id) },
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

function VariationsPage() {
  const { state, actions } = useSiteForge();
  const siteId = state.session.siteId;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", reason: "", value: "", days: "", trade: "General", priority: "medium", templateId: "" });
  const variations = state.variations.filter((variation) => variation.siteId === siteId);
  const variationTemplates = state.contractTemplates.filter((template) => template.status !== "archived" && ["Variation", "Scope Clarification", "Selection Upgrade"].includes(template.type));

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div className="fx" style={{ gap: 6 }}>
          <Badge tone="medium">{variations.filter((variation) => variation.status === "submitted").length} submitted</Badge>
          <Badge tone="passed">{variations.filter((variation) => variation.status === "signed").length} signed</Badge>
        </div>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setOpen(true)}>
          New Variation
        </Button>
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
                    <Badge tone={variation.status === "signed" ? "passed" : variation.status === "submitted" ? "medium" : "high"}>{variation.status}</Badge>
                  </td>
                  <td>
                    {variation.status === "submitted" && state.session.role !== "Supervisor" ? (
                      <Button small tone="bt-p" onClick={() => actions.sendVariationToClient(variation.id, variation.templateId)}>
                        Send to Client
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={open} close={() => setOpen(false)} title="Create Variation Draft">
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
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.createVariationDraft(form);
              setOpen(false);
              setForm({ title: "", description: "", reason: "", value: "", days: "", trade: "General", priority: "medium", templateId: "" });
            }}
          >
            Save Draft
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
  const [form, setForm] = useState({ title: "", type: "Hold Point", trade: "General", date: "", totalCount: "", notes: "" });
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
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addQaRecord(form);
              setOpen(false);
              setForm({ title: "", type: "Hold Point", trade: "General", date: "", totalCount: "", notes: "" });
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
  const [form, setForm] = useState({ date: "", weather: "", crew: "", summary: "", safety: "", delays: "", rainEvent: false });
  const [variationForm, setVariationForm] = useState({ title: "", description: "", value: "", days: "", reason: "", trade: "General", priority: "medium", templateId: "" });
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
          <div className="fx" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <Badge tone="medium">{entry.weather}</Badge>
            <Badge tone="passed">{entry.crew} crew</Badge>
            {entry.rainEvent ? (
              <Button small tone="bt-p" onClick={() => actions.createRainDayClaim(entry.id)}>
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
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addDiaryEntry(form);
              setOpen(false);
              setForm({ date: "", weather: "", crew: "", summary: "", safety: "", delays: "", rainEvent: false });
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
        <div className="fa">
          <Button onClick={() => setVariationEntry(null)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              if (!variationEntry) return;
              actions.createVariationFromDiary(variationEntry.id, variationForm);
              setVariationEntry(null);
            }}
          >
            Create Variation Draft
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
  const [form, setForm] = useState({ topic: "", type: "toolbox", acknowledgementRequired: false });
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
        <div className="fa">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addSafetyRecord(form);
              setOpen(false);
              setForm({ topic: "", type: "toolbox", acknowledgementRequired: false });
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
  const [planQuery, setPlanQuery] = useState("");
  const [planResults, setPlanResults] = useState([]);
  const [annotation, setAnnotation] = useState({ locationRef: "", note: "" });
  const documents = state.documents.filter((document) => document.siteId === siteId && !document.archived);
  const archived = state.documents.filter((document) => document.siteId === siteId && document.archived);
  const selected = documents.find((document) => document.id === selectedId) || documents[0] || null;
  const selectedFile = selected?.fileId ? state.files.records.find((file) => file.id === selected.fileId) : null;
  const searchPlan = () => {
    if (!selected || !planQuery.trim()) return;
    const haystack = `${selected.title} ${selected.tags?.join(" ") || ""} ${selected.impactAnalysis?.summary || ""} ${selectedFile?.extractedText || ""}`;
    const lower = haystack.toLowerCase();
    const tokens = planQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const score = tokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
    if (!score) {
      setPlanResults([
        {
          page: "Annotation fallback",
          excerpt: "No extractable text match was found. Add a plan note or describe the room/zone so SiteForge can keep the search context for future uploads.",
        },
      ]);
      return;
    }
    const firstToken = tokens.find((token) => lower.includes(token));
    const index = Math.max(0, lower.indexOf(firstToken) - 80);
    setPlanResults([
      {
        page: selectedFile?.type?.includes("pdf") ? "Page 1" : selected.rev,
        excerpt: haystack.slice(index, index + 220).trim(),
      },
    ]);
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
                            <Button small onClick={() => actions.addConversationMessage("document-reminder", selected.id, [userId], `Please acknowledge ${selected.title} ${selected.rev} before next site entry.`)}>
                              Send Reminder
                            </Button>
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
                </div>
                {previewHtml ? <div className="document-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} /> : <div className="xs ct3">Open a PDF or uploaded image to preview it here.</div>}
              </div>
              <div className="mini-panel" style={{ marginTop: 12 }}>
                <div className="xs ct3 mb4">AI plan search</div>
                <div className="fx" style={{ gap: 6 }}>
                  <input className="inline-input" value={planQuery} onChange={(event) => setPlanQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchPlan()} />
                  <Button small tone="bt-p" onClick={searchPlan}>
                    Search
                  </Button>
                </div>
                <div className="list-stack" style={{ marginTop: 8 }}>
                  {planResults.map((result, index) => (
                    <div className="linked-row" key={`${result.page}-${index}`}>
                      <div>
                        <div className="b sm">{result.page}</div>
                        <div className="xs ct3">{result.excerpt}</div>
                      </div>
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
  const users = state.users.filter((user) => user.siteIds?.includes(siteId) || user.role === "Director");
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
  const { state, derived } = useSiteForge();
  const site = derived.currentSite;
  const siteMetric = derived.metrics.siteMetrics.find((metric) => metric.siteId === site.id);

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
    </div>
  );
}

function AdminPage() {
  const { actions, derived, state } = useSiteForge();
  const [companyForm, setCompanyForm] = useState({
    name: state.settings?.company?.name || state.company?.name || "",
    legalName: state.settings?.company?.legalName || state.company?.legalName || "",
    abn: state.settings?.company?.abn || state.company?.abn || "",
    address: state.settings?.company?.address || state.company?.address || "",
    phone: state.settings?.company?.phone || state.company?.phone || "",
    email: state.settings?.company?.email || state.company?.email || "",
    logoDataUrl: state.settings?.company?.logoDataUrl || "",
  });
  const [integrationsForm, setIntegrationsForm] = useState({
    anthropicApiKey: state.settings?.integrations?.anthropicApiKey || "",
    buildxactApiKey: state.settings?.integrations?.buildxactApiKey || "",
    buildxactWorkspaceId: state.settings?.integrations?.buildxactWorkspaceId || "",
  });
  return (
    <div className="oy fin">
      <div className="g2 mb8">
        <Card title="Company Settings" icon={Icons.briefcase}>
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
          <div className="g2">
            <div className="ff">
              <label>Phone</label>
              <input value={companyForm.phone} onChange={(event) => setCompanyForm((current) => ({ ...current, phone: event.target.value }))} />
            </div>
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
          <Button tone="bt-p" onClick={() => actions.updateSettings("company", companyForm)}>
            Save Company Settings
          </Button>
        </Card>
        <Card title="Integration Settings" icon={Icons.zap}>
          <div className="ff">
            <label>Claude API key</label>
            <input type="password" value={integrationsForm.anthropicApiKey} onChange={(event) => setIntegrationsForm((current) => ({ ...current, anthropicApiKey: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Buildxact API key</label>
            <input type="password" value={integrationsForm.buildxactApiKey} onChange={(event) => setIntegrationsForm((current) => ({ ...current, buildxactApiKey: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Workspace ID</label>
            <input value={integrationsForm.buildxactWorkspaceId} onChange={(event) => setIntegrationsForm((current) => ({ ...current, buildxactWorkspaceId: event.target.value }))} />
          </div>
          <Button tone="bt-p" onClick={() => actions.updateSettings("integrations", integrationsForm)}>
            Save Integration Settings
          </Button>
        </Card>
      </div>
      <div className="g2">
        <Card title="Demo Controls" icon={Icons.gear}>
          <div className="sm ct2">Reset the demo data back to the seeded construction scenario at any time.</div>
          <div className="sm ct2" style={{ marginTop: 8 }}>Current simulated time: {derived.currentNow}</div>
          <Button tone="bt-p" onClick={() => actions.resetDemo()} style={{ marginTop: 12 }}>
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
        <Card title="Shortcuts & Demo Flags" icon={Icons.help}>
          <div className="list-stack">
            <div className="linked-row">
              <div>
                <div className="b sm">⌘K / Ctrl+K</div>
                <div className="xs ct3">Global search</div>
              </div>
            </div>
            <div className="linked-row">
              <div>
                <div className="b sm">N</div>
                <div className="xs ct3">Context-aware new action</div>
              </div>
            </div>
            <div className="linked-row">
              <div>
                <div className="b sm">?</div>
                <div className="xs ct3">Shortcuts overlay</div>
              </div>
            </div>
            <div className="linked-row">
              <div>
                <div className="b sm">Demo Mode</div>
                <div className="xs ct3">Fake live events are currently {state.demo.mode ? "enabled" : "disabled"}.</div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function FinancialSummaryPage() {
  const { state } = useSiteForge();
  const pulse = state.financialPulse[state.session.period] || state.financialPulse["This Week"] || Object.values(state.financialPulse)[0];
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
          <Button tone="bt-p" onClick={() => actions.runSystemSweep()}>
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
