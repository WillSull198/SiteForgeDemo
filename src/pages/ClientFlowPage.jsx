import { useEffect, useMemo, useState } from "react";
import AIBlock from "../components/AIBlock";
import DataTable from "../components/DataTable";
import { useSiteForge } from "../services/siteforgeStore";
import { can, canSeeAllSites, mustHandUpForApproval } from "../services/permissions";
import { Icons, renderIcon } from "../components/icons";
import {
  Badge,
  Button,
  Card,
  DetailHeader,
  LinkedRecordsPanel,
  MetricGrid,
  Modal,
  Tabs,
  Timeline,
} from "../components/ui";

const CREATE_OPTIONS = [
  { value: "blank", label: "Type a fresh approval (no source)" },
  { value: "problem", label: "Problem / Issue" },
  { value: "diary", label: "Diary weather event" },
  { value: "rfi", label: "RFI" },
  { value: "procurement", label: "Procurement delay" },
  { value: "task", label: "Task" },
  { value: "variation", label: "Variation draft" },
  { value: "safety", label: "Safety event" },
];

const analyticsAging = (approval, currentNow = Date.now()) => {
  const sent = approval.sentAt ? new Date(approval.sentAt.replace(" ", "T")) : null;
  if (!sent || Number.isNaN(sent.getTime())) {
    return "Draft";
  }
  const hours = (currentNow - sent.getTime()) / 36e5;
  if (hours < 24 * 7) return "0-7 days";
  if (hours < 24 * 14) return "7-14 days";
  if (hours < 24 * 30) return "14-30 days";
  return "30+ days";
};

const defaultForm = {
  sourceType: "blank",
  sourceId: "",
  approvalType: "Variation",
  title: "",
  clientId: "",
  description: "",
  reason: "",
  costImpact: "",
  timeImpactDays: "",
  templateId: "",
};

export default function ClientFlowPage() {
  const { state, actions, derived } = useSiteForge();
  const role = state.session.role;
  const siteId = state.session.siteId;
  const routeEntityId = state.session.route?.entityId;
  const currentNow = Date.parse((state.demo.simulatedNow || "").replace(" ", "T")) || Date.now();
  const canView = can(role, "clientflow.view");
  const canCreateApproval = can(role, "clientflow.create");
  const canSend = can(role, "clientflow.send");
  const canApprove = can(role, "clientflow.approve");
  const canGenerateContract = can(role, "clientflow.generate_contract");
  const [tab, setTab] = useState("dashboard");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(routeEntityId || derived.currentApproval?.id || state.approvals[0]?.id || null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(defaultForm);

  const siteApprovals = useMemo(
    () =>
      state.approvals
        .filter((approval) => (canSeeAllSites(role) ? true : approval.siteId === siteId))
        .sort((left, right) => (right.sentAt || right.timeline?.[0]?.at || "").localeCompare(left.sentAt || left.timeline?.[0]?.at || "")),
    [role, siteId, state.approvals],
  );

  const selected = useMemo(
    () => siteApprovals.find((approval) => approval.id === selectedId) || siteApprovals[0] || null,
    [selectedId, siteApprovals],
  );

  useEffect(() => {
    if (selected?.id) {
      setSelectedId(selected.id);
    }
  }, [selected?.id]);

  useEffect(() => {
    if (routeEntityId) {
      setSelectedId(routeEntityId);
      const routed = state.approvals.find((approval) => approval.id === routeEntityId);
      if (routed?.siteId && routed.siteId !== siteId && !canSeeAllSites(role)) {
        actions.setSite(routed.siteId);
      }
    }
  }, [actions, role, routeEntityId, siteId, state.approvals]);

  const sourceOptions = useMemo(() => {
    const collections = {
      problem: state.problems,
      diary: state.diary.filter((entry) => entry.rainEvent),
      rfi: state.rfis,
      procurement: state.procurement.filter((item) => ["delayed", "escalated", "pending"].includes(item.status)),
      task: state.tasks,
      variation: state.variations,
      safety: state.safety.filter((entry) => entry.type === "critical" || entry.type === "incident"),
    };
    return (collections[form.sourceType] || [])
      .filter((item) => item.siteId === siteId || canSeeAllSites(role))
      .map((item) => ({
        id: item.id,
        label: item.title || item.item || item.number || item.topic || item.date,
      }));
  }, [form.sourceType, role, siteId, state]);

  const clientOptions = useMemo(() => {
    const allowedSiteIds = canSeeAllSites(role) ? state.sites.map((site) => site.id) : [siteId];
    const clientIds = new Set(state.sites.filter((site) => allowedSiteIds.includes(site.id)).map((site) => site.clientId).filter(Boolean));
    return state.clients.filter((client) => clientIds.has(client.id) || canSeeAllSites(role));
  }, [role, siteId, state.clients, state.sites]);

  const templateOptions = useMemo(
    () =>
      state.contractTemplates.filter(
        (template) => template.status !== "archived" && (!template.type || template.type === form.approvalType || (form.approvalType === "Variation" && /variation/i.test(template.type))),
      ),
    [form.approvalType, state.contractTemplates],
  );

  const metrics = useMemo(() => {
    const awaiting = siteApprovals.filter((approval) => approval.status === "awaiting-client").length;
    const stalled = siteApprovals.filter((approval) => ["question", "changes-requested", "contract-awaiting-client"].includes(approval.status)).length;
    const drafted = siteApprovals.filter((approval) => approval.status === "contract-drafted").length;
    const signedValue = siteApprovals
      .filter((approval) => approval.status === "signed")
      .reduce((sum, approval) => sum + (approval.costImpact || 0), 0);
    return [
      { label: "Awaiting Client", value: awaiting, color: "a" },
      { label: "Stalled", value: stalled, color: "r" },
      { label: "Contract Drafted", value: drafted, color: "b" },
      { label: "Signed Value", value: `$${Math.round(signedValue / 1000)}k`, color: "g" },
    ];
  }, [siteApprovals]);

  const createApproval = () => {
    if (!canCreateApproval) return;
    if (form.sourceType === "blank") {
      if (!form.title.trim() || !form.clientId || !form.description.trim() || !form.reason.trim() || form.costImpact === "") return;
      actions.createApprovalFromBlank({
        approvalType: form.approvalType,
        clientId: form.clientId,
        title: form.title.trim(),
        description: form.description.trim(),
        reason: form.reason.trim(),
        costImpact: form.costImpact,
        timeImpactDays: form.timeImpactDays,
        templateId: form.templateId || null,
      });
      setCreateOpen(false);
      setForm(defaultForm);
      return;
    }
    if (!form.sourceId) return;
    actions.createApprovalFromSource({
      sourceType: form.sourceType,
      sourceId: form.sourceId,
      approvalType: form.approvalType,
      handUp: mustHandUpForApproval(role),
    });
    setCreateOpen(false);
    setForm(defaultForm);
  };

  const groupedByClient = useMemo(() => {
    return siteApprovals.reduce((groups, approval) => {
      const client = state.clients.find((entry) => entry.id === approval.clientId);
      const key = client?.name || "Unknown client";
      if (!groups[key]) groups[key] = [];
      groups[key].push(approval);
      return groups;
    }, {});
  }, [siteApprovals, state.clients]);

  const analytics = useMemo(() => {
    return ["0-7 days", "7-14 days", "14-30 days", "30+ days"].map((bucket) => ({
      bucket,
      count: siteApprovals.filter((approval) => analyticsAging(approval, currentNow) === bucket && !["signed", "declined"].includes(approval.status)).length,
    }));
  }, [currentNow, siteApprovals]);

  if (!canView) {
    return <div className="restricted">This role cannot access the internal ClientFlow workspace.</div>;
  }

  return (
    <div className="oy fin">
      <MetricGrid columns={4} items={metrics} />

      <div className="fb mb8">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "dashboard", label: "Builder Dashboard" },
            { value: "inbox", label: "Client Inbox View" },
            { value: "stalled", label: "Stalled Approvals" },
            { value: "analytics", label: "Analytics" },
          ]}
        />
        {canCreateApproval ? (
          <Button tone="bt-p" icon={Icons.plus} onClick={() => setCreateOpen(true)}>
            New Approval
          </Button>
        ) : (
          <Badge tone="medium">Draft hand-up only</Badge>
        )}
      </div>

      {tab === "dashboard" ? (
        <div className="g32">
          <Card title="Approvals Register" icon={Icons.flag}>
            <DataTable
              storageKey={`clientflow-register-${role}-${siteId}`}
              rows={siteApprovals}
              onRowClick={(approval) => setSelectedId(approval.id)}
              columns={[
                {
                  key: "title",
                  label: "Approval",
                  filterable: true,
                  render: (_, approval) => (
                    <div>
                      <div className="b">{approval.title}</div>
                      <div className="xs ct3">{approval.summary.slice(0, 100)}</div>
                    </div>
                  ),
                },
                { key: "type", label: "Type", filterable: true, options: [...new Set(siteApprovals.map((approval) => approval.type))] },
                {
                  key: "costImpact",
                  label: "Cost",
                  type: "number",
                  filterable: true,
                  render: (value) => <span className="mono xs">${Number(value || 0).toLocaleString()}</span>,
                },
                {
                  key: "timeImpact",
                  label: "Time",
                  type: "number",
                  filterable: true,
                  render: (value) => <span className="mono xs">{value || 0}d</span>,
                },
                {
                  key: "status",
                  label: "Status",
                  filterable: true,
                  options: [...new Set(siteApprovals.map((approval) => approval.status))],
                  render: (value) => (
                    <Badge tone={value === "declined" ? "critical" : value === "signed" ? "passed" : value === "awaiting-client" ? "medium" : "high"}>
                      {value}
                    </Badge>
                  ),
                },
                {
                  key: "ownerId",
                  label: "Owner",
                  filterable: true,
                  accessor: (approval) => state.users.find((user) => user.id === approval.ownerId)?.name || "PM",
                },
              ]}
              rowActions={[
                { label: "Open", onClick: (approval) => setSelectedId(approval.id) },
                {
                  label: "Send",
                  tone: "bt-p",
                  onClick: (approval) => actions.sendApproval(approval.id),
                  when: (approval) => approval.status === "draft" && canSend,
                },
                {
                  label: "Withdraw",
                  tone: "bt-r",
                  onClick: (approval) => actions.withdrawApproval(approval.id),
                  when: (approval) => approval.status === "awaiting-client",
                },
                {
                  label: "Resend",
                  onClick: (approval) => actions.resendApproval(approval.id),
                  when: (approval) => ["question", "changes-requested"].includes(approval.status),
                },
                {
                  label: "Archive",
                  onClick: (approval) => actions.archiveApproval(approval.id),
                  when: (approval) => ["signed", "declined", "withdrawn"].includes(approval.status),
                },
              ]}
            />
          </Card>

          {selected ? (
            <div>
              <Card
                title="Approval Detail"
                icon={Icons.file}
                right={
                  <div className="fx" style={{ gap: 4, flexWrap: "wrap" }}>
                    {selected.status === "draft" && canSend ? (
                      <Button small tone="bt-p" icon={Icons.send} onClick={() => actions.sendApproval(selected.id)}>
                        Send to Client
                      </Button>
                    ) : null}
                    {selected.status === "approved" && canGenerateContract ? (
                      <Button small tone="bt-p" icon={Icons.file} onClick={() => actions.generateContractFromApproval(selected.id)}>
                        Generate Contract Pack
                      </Button>
                    ) : null}
                    {["awaiting-client", "question", "changes-requested"].includes(selected.status) && canApprove ? (
                      <>
                        <Button small tone="bt-g" icon={Icons.check} onClick={() => actions.markApprovalInternal(selected.id, "approved", "Marked approved internally after client confirmation.")}>
                          Mark Approved
                        </Button>
                        <Button small tone="bt-r" icon={Icons.x} onClick={() => actions.markApprovalInternal(selected.id, "declined", "Marked declined internally.")}>
                          Mark Declined
                        </Button>
                      </>
                    ) : null}
                    {selected.status === "awaiting-client" ? (
                      <Button small icon={Icons.shuffle} onClick={() => actions.sendDirectorEscalation(selected.siteId, selected.title)}>
                        Escalate
                      </Button>
                    ) : null}
                  </div>
                }
              >
                <DetailHeader
                  title={selected.title}
                  subtitle={`${selected.type} · ${state.clients.find((client) => client.id === selected.clientId)?.name}`}
                  badges={[
                    { label: selected.status, tone: selected.status === "signed" ? "passed" : selected.status === "declined" ? "critical" : "medium" },
                    { label: `$${selected.costImpact.toLocaleString()}`, tone: selected.costImpact > 0 ? "high" : "low" },
                    { label: `${selected.timeImpact || 0}d`, tone: selected.timeImpact ? "medium" : "low" },
                  ]}
                />
                <div className="g2">
                  <div>
                    <div className="clientflow-copy">
                      <div className="cf-section">
                        <div className="cf-heading">What we're asking for</div>
                        <div className="sm ct2">{selected.summary}</div>
                      </div>
                      <div className="cf-section">
                        <div className="cf-heading">Why this is needed</div>
                        <div className="sm ct2">{selected.reason}</div>
                      </div>
                      <div className="cf-section">
                        <div className="cf-heading">Recommendation</div>
                        <div className="sm ct2">{selected.recommendation}</div>
                      </div>
                    </div>

                    <AIBlock
                      title="AI Assist Panel"
                      data={selected.aiDraft}
                      onRegenerate={() =>
                        actions.updateApprovalDraft(selected.id, {
                          aiDraft: {
                            ...selected.aiDraft,
                            summary: `${selected.aiDraft.summary} Regenerated to sharpen programme and recovery language.`,
                          },
                        })
                      }
                      onSave={(data) => actions.updateApprovalDraft(selected.id, { aiDraft: data, summary: data.summary, reason: data.reason, recommendation: data.recommendation })}
                    />
                    {selected.portalUrl ? (
                      <Card title="Client Portal Link" icon={Icons.link} className="mb8">
                        <div className="sm ct2" style={{ wordBreak: "break-all" }}>{selected.portalUrl}</div>
                        <div className="fa" style={{ justifyContent: "flex-start", marginTop: 10 }}>
                          <Button small tone="bt-p" onClick={() => navigator.clipboard?.writeText(selected.portalUrl)}>
                            Copy Link
                          </Button>
                          <Button small onClick={() => window.open(selected.portalUrl, "_blank", "noopener,noreferrer")}>
                            Open Portal
                          </Button>
                        </div>
                      </Card>
                    ) : null}
                  </div>

                  <div>
                    <Card title="Thread" icon={Icons.chat}>
                      <div className="mt" style={{ maxHeight: 220 }}>
                        {(selected.messageThread || []).length ? (
                          selected.messageThread.map((entry) => (
                            <div key={entry.id} className={`mm ${String(entry.role).toLowerCase() === "client" ? "them" : "me"}`}>
                              <div className="mf">{entry.by}</div>
                              <div>{entry.body}</div>
                              <div className="mt2">{entry.at}</div>
                            </div>
                          ))
                        ) : (
                          <div className="ct3 sm empty">No messages on this approval yet.</div>
                        )}
                      </div>
                      <div className="mi" style={{ paddingLeft: 0, paddingRight: 0 }}>
                        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Add a message to the approval thread..." />
                        <Button
                          small
                          tone="bt-p"
                          icon={Icons.send}
                          onClick={() => {
                            actions.addApprovalMessage(selected.id, message);
                            setMessage("");
                          }}
                        >
                          Send
                        </Button>
                      </div>
                    </Card>

                    <Card title="Status Timeline" icon={Icons.clock} className="mb8">
                      <Timeline entries={(selected.timeline || []).map((entry) => ({ actor: entry.actor, role: entry.role, at: entry.at, text: entry.text }))} />
                    </Card>

                    <LinkedRecordsPanel records={selected.linkedRecords} resolveRecord={derived.resolveRecord} />
                  </div>
                </div>
              </Card>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "inbox" ? (
        <div className="g2">
          {Object.entries(groupedByClient).map(([clientName, approvals]) => (
            <Card title={clientName} key={clientName} icon={Icons.users}>
              <div className="list-stack">
                {approvals.map((approval) => (
                  <div className="act" key={approval.id}>
                    <div style={{ flex: 1 }}>
                      <div className="b sm">{approval.title}</div>
                      <div className="xs ct3">
                        {approval.type} · {approval.sentAt || "Draft not sent"}
                      </div>
                      <div className="sm ct2" style={{ marginTop: 4 }}>
                        {approval.summary}
                      </div>
                    </div>
                    <div className="tr">
                      <div className="mono b">${approval.costImpact.toLocaleString()}</div>
                      <Badge tone={approval.status === "signed" ? "passed" : approval.status === "declined" ? "critical" : "medium"}>{approval.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "stalled" ? (
        <div className="g2">
          <Card title="Awaiting Client or Change" icon={Icons.alert}>
            <div className="list-stack">
              {siteApprovals
                .filter((approval) => ["awaiting-client", "question", "changes-requested", "contract-awaiting-client"].includes(approval.status))
                .map((approval) => (
                  <div className="act" key={approval.id}>
                    <div style={{ flex: 1 }}>
                      <div className="b sm">{approval.title}</div>
                      <div className="xs ct3">
                        {analyticsAging(approval, currentNow)} · {approval.type}
                      </div>
                      <div className="sm ct2" style={{ marginTop: 4 }}>
                        {approval.reason}
                      </div>
                    </div>
                    <div className="fx" style={{ gap: 4 }}>
                      <Badge tone="high">{approval.status}</Badge>
                      <Button small onClick={() => actions.sendDirectorEscalation(approval.siteId, approval.title)}>
                        Teams Escalate
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          </Card>
          <Card title="Approval-to-Contract Readiness" icon={Icons.file}>
            <div className="list-stack">
              {siteApprovals.map((approval) => (
                <div className="act" key={approval.id}>
                  <div style={{ flex: 1 }}>
                    <div className="b sm">{approval.title}</div>
                    <div className="xs ct3">
                      Contract: {approval.contractPackId ? approval.contractPackId : "Not generated"}
                    </div>
                  </div>
                  <span className={`bg ${approval.contractPackId ? "passed" : "medium"}`}>{approval.contractPackId ? "ready" : "pending"}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "analytics" ? (
        <div className="g23">
          <Card title="Approval Analytics" icon={Icons.bar}>
            <div className="g2">
              {analytics.map((row) => (
                <div className="si b" key={row.bucket}>
                  <div className="sl">{row.bucket}</div>
                  <div className="sv">{row.count}</div>
                  <div className="ss">Open approvals in this ageing bucket</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Client Response Performance" icon={Icons.trending}>
            <div className="bb-row">
              <div className="bb-l">Avg response time</div>
              <div className="bb-t">
                <div className="bb-f" style={{ width: `${Math.min(100, derived.metrics.portfolio.clientVelocityHours * 3)}%`, background: "var(--gn)" }} />
              </div>
              <div className="bb-v">{derived.metrics.portfolio.clientVelocityHours}h</div>
            </div>
            <div className="bb-row">
              <div className="bb-l">Recovered value</div>
              <div className="bb-t">
                <div
                  className="bb-f"
                  style={{
                    width: `${Math.min(100, siteApprovals.filter((approval) => approval.status === "signed").reduce((sum, approval) => sum + approval.costImpact, 0) / 200)}%`,
                    background: "var(--am)",
                  }}
                />
              </div>
              <div className="bb-v">
                $
                {siteApprovals
                  .filter((approval) => approval.status === "signed")
                  .reduce((sum, approval) => sum + approval.costImpact, 0)
                  .toLocaleString()}
              </div>
            </div>
            <div className="bb-row">
              <div className="bb-l">Conversion rate</div>
              <div className="bb-t">
                <div
                  className="bb-f"
                  style={{
                    width: `${Math.min(100, Math.round((siteApprovals.filter((approval) => ["approved", "signed"].includes(approval.status)).length / Math.max(1, siteApprovals.length)) * 100))}%`,
                    background: "var(--cy)",
                  }}
                />
              </div>
              <div className="bb-v">
                {Math.round((siteApprovals.filter((approval) => ["approved", "signed"].includes(approval.status)).length / Math.max(1, siteApprovals.length)) * 100)}%
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      <Modal open={createOpen} close={() => setCreateOpen(false)} title="Create ClientFlow Approval" wide>
        <div className="g2">
          <div className="ff">
            <label>Create From</label>
            <select value={form.sourceType} onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value, sourceId: "" }))}>
              {CREATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Approval Type</label>
            <select value={form.approvalType} onChange={(event) => setForm((current) => ({ ...current, approvalType: event.target.value }))}>
              {state.approvalTypes?.map?.((type) => (
                <option key={type}>{type}</option>
              )) ||
                ["Variation", "Rain Day", "Extension of Time", "Delay Notice", "Selection Upgrade", "Price Escalation"].map((type) => (
                  <option key={type}>{type}</option>
                ))}
            </select>
          </div>
        </div>
        {form.sourceType === "blank" ? (
          <>
            <div className="g2">
              <div className="ff">
                <label>Title</label>
                <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Waterproofing upgrade" />
              </div>
              <div className="ff">
                <label>Client</label>
                <select value={form.clientId} onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))}>
                  <option value="">Select client</option>
                  {clientOptions.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.primaryContact || client.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="ff">
              <label>Description</label>
              <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe the client-facing variation or approval request." />
            </div>
            <div className="ff">
              <label>Reason</label>
              <textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Why this approval is required." />
            </div>
            <div className="g2">
              <div className="ff">
                <label>Estimated cost</label>
                <input type="number" value={form.costImpact} onChange={(event) => setForm((current) => ({ ...current, costImpact: event.target.value }))} />
              </div>
              <div className="ff">
                <label>Time impact days</label>
                <input type="number" value={form.timeImpactDays} onChange={(event) => setForm((current) => ({ ...current, timeImpactDays: event.target.value }))} />
              </div>
            </div>
            <div className="ff">
              <label>Template</label>
              <select value={form.templateId} onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value }))}>
                <option value="">Auto select best template</option>
                {templateOptions.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <div className="ff">
            <label>Source Record</label>
            <select value={form.sourceId} onChange={(event) => setForm((current) => ({ ...current, sourceId: event.target.value }))}>
              <option value="">Select source</option>
              {sourceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="fa">
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button tone="bt-p" icon={Icons.plus} onClick={createApproval}>
            Create Draft
          </Button>
        </div>
      </Modal>
    </div>
  );
}
