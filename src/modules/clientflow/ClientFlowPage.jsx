import React, { useMemo, useState } from "react";
import { Icons, renderIcon } from "../../components/icons";
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
} from "../../components/ui";
import { getLinkedRecord } from "../../services/fieldCommercialEngine";

const BUILDER_ROLES = new Set(["Supervisor", "Project Manager", "Contract Admin", "Director"]);

function approvalResolve(store, link) {
  return getLinkedRecord({ ...store.data, plans: store.plans }, link.type, link.id);
}

export function ClientFlowPage({ store }) {
  const { data, actions, session, derived, pending } = store;
  const [tab, setTab] = useState("builder");
  const [createOpen, setCreateOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [form, setForm] = useState({
    type: "Variation",
    title: "",
    sourceType: "issue",
    sourceId: "",
    clientId: derived.site.clientId,
    priority: "medium",
    costImpact: "",
    timeImpact: "",
    recommendation: "",
  });

  const approvals = useMemo(
    () => data.approvals.filter((approval) => approval.siteId === derived.site.id),
    [data.approvals, derived.site.id],
  );
  const selected = approvals.find((approval) => approval.id === session.activeApprovalId) || approvals[0];
  const client = data.clients.find((entry) => entry.id === selected?.clientId) || data.clients.find((entry) => entry.siteId === derived.site.id);
  const canBuild = BUILDER_ROLES.has(session.role);
  const stalled = approvals.filter((approval) => ["stalled", "awaiting-client", "question"].includes(approval.status));
  const inbox = approvals.filter((approval) => approval.clientId === client?.id);
  const sourceOptions = derived.createFromOptions;
  const source = sourceOptions.find((option) => option.type === form.sourceType && String(option.id) === String(form.sourceId));

  const draftPreview = source
    ? {
        summary: `${form.type} request created from ${source.label}. The goal is to compress event-to-recovery time while keeping the client decision trail clean and contract-ready.`,
        reason: `${source.label} now requires a formal client response so site, programme, and commercial outcomes stay aligned.`,
        costImpact: form.costImpact ? `$${Number(form.costImpact).toLocaleString()} additional impact.` : `Source impact: ${source.impact}`,
        timeImpact: form.timeImpact ? `${form.timeImpact} day programme effect.` : "No direct time impact entered yet.",
        recommendation:
          form.recommendation || "Recommend client review within 24 hours so linked trades, procurement, and programme updates can proceed without drift.",
      }
    : null;

  return (
    <div className="oy fin">
      <MetricGrid
        columns={5}
        items={[
          { label: "Awaiting Client", value: approvals.filter((approval) => approval.status === "awaiting-client").length, color: "a" },
          { label: "Stalled", value: approvals.filter((approval) => approval.status === "stalled").length, color: "r" },
          { label: "Approved Value", value: `$${(approvals.filter((approval) => approval.status === "approved").reduce((sum, approval) => sum + approval.costImpact, 0) / 1e3).toFixed(1)}k`, color: "g" },
          { label: "Time At Risk", value: `${approvals.filter((approval) => approval.status !== "approved").reduce((sum, approval) => sum + approval.timeImpact, 0)}d`, color: "o" },
          { label: "Portal Questions", value: approvals.filter((approval) => approval.status === "question").length, color: "b" },
        ]}
      />

      <div className="fb mb8">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "builder", label: "Builder Dashboard" },
            { value: "inbox", label: "Client Inbox" },
            { value: "stalled", label: "Stalled" },
            { value: "analytics", label: "Analytics" },
            { value: "portal", label: "Client Portal" },
          ]}
        />
        {canBuild ? (
          <Button tone="bt-p" icon={Icons.plus} onClick={() => setCreateOpen(true)}>
            New Approval
          </Button>
        ) : null}
      </div>

      {tab === "builder" ? (
        canBuild ? (
          <BuilderDashboard store={store} approvals={approvals} selected={selected} client={client} comment={comment} setComment={setComment} />
        ) : (
          <RestrictedPanel title="Builder approvals dashboard" body="Supervisor, PM, contract admin, and director roles can create and manage ClientFlow requests." />
        )
      ) : null}

      {tab === "inbox" ? <ClientInbox approvals={inbox} clients={data.clients} onSelect={actions.setActiveApproval} /> : null}
      {tab === "stalled" ? <StalledApprovals approvals={stalled} onSelect={actions.setActiveApproval} /> : null}
      {tab === "analytics" ? <ApprovalAnalytics approvals={approvals} teamsLayer={data.teamsLayer} /> : null}
      {tab === "portal" ? <ClientPortal approval={selected} client={client} actions={actions} pending={pending} /> : null}

      <Modal open={createOpen} close={() => setCreateOpen(false)} title="Create ClientFlow Request" wide>
        <div className="g2">
          <div>
            <div className="ff">
              <label>Approval Type</label>
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                {store.config.approvalTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="ff">
              <label>Create From</label>
              <select
                value={form.sourceId}
                onChange={(event) => {
                  const next = sourceOptions.find((option) => String(option.id) === event.target.value);
                  setForm({
                    ...form,
                    sourceId: event.target.value,
                    sourceType: next?.type || form.sourceType,
                    title: next ? `${form.type} — ${next.label}` : form.title,
                  });
                }}
              >
                <option value="">Select linked source</option>
                {sourceOptions.map((option) => (
                  <option key={`${option.type}-${option.id}`} value={option.id}>
                    {option.type} · {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="ff">
              <label>Title</label>
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </div>
            <div className="g2">
              <div className="ff">
                <label>Client</label>
                <select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}>
                  {data.clients.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ff">
                <label>Priority</label>
                <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
                  {store.config.priorities.map((priority) => (
                    <option key={priority.value} value={priority.value}>
                      {priority.value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="g2">
              <div className="ff">
                <label>Cost Impact ($)</label>
                <input type="number" value={form.costImpact} onChange={(event) => setForm({ ...form, costImpact: event.target.value })} />
              </div>
              <div className="ff">
                <label>Time Impact (days)</label>
                <input type="number" value={form.timeImpact} onChange={(event) => setForm({ ...form, timeImpact: event.target.value })} />
              </div>
            </div>
            <div className="ff">
              <label>Recommendation</label>
              <textarea value={form.recommendation} onChange={(event) => setForm({ ...form, recommendation: event.target.value })} />
            </div>
          </div>
          <div className="hero-panel">
            <h3 className="cam b sm fx mb4">{renderIcon(Icons.zap, 13)} AI Assist Draft</h3>
            {draftPreview ? (
              <div className="list-stack">
                <div className="draft-row">
                  <div className="xs ct3">Plain-English Summary</div>
                  <div className="sm ct2">{draftPreview.summary}</div>
                </div>
                <div className="draft-row">
                  <div className="xs ct3">Reason for Change</div>
                  <div className="sm ct2">{draftPreview.reason}</div>
                </div>
                <div className="draft-row">
                  <div className="xs ct3">Cost Impact</div>
                  <div className="sm ct2">{draftPreview.costImpact}</div>
                </div>
                <div className="draft-row">
                  <div className="xs ct3">Time Impact</div>
                  <div className="sm ct2">{draftPreview.timeImpact}</div>
                </div>
                <div className="draft-row">
                  <div className="xs ct3">Recommendation</div>
                  <div className="sm ct2">{draftPreview.recommendation}</div>
                </div>
              </div>
            ) : (
              <div className="ct3 sm empty">Choose a linked source to generate the draft pack.</div>
            )}
          </div>
        </div>
        <div className="fa">
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            disabled={!source}
            onClick={async () => {
              if (!form.title.trim() || !source) return;
              await actions.createApproval({
                siteId: derived.site.id,
                clientId: form.clientId,
                type: form.type,
                title: form.title,
                sourceType: source?.type || form.sourceType,
                sourceId: source?.id || form.sourceId,
                sourceLabel: source?.label,
                priority: form.priority,
                costImpact: Number(form.costImpact || 0),
                timeImpact: Number(form.timeImpact || 0),
                recommendation: form.recommendation,
                createdBy: "Dave Mitchell",
                ownerRole: session.role,
              });
              setForm({
                type: "Variation",
                title: "",
                sourceType: "issue",
                sourceId: "",
                clientId: derived.site.clientId,
                priority: "medium",
                costImpact: "",
                timeImpact: "",
                recommendation: "",
              });
              setCreateOpen(false);
            }}
          >
            Create Approval
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function BuilderDashboard({ store, approvals, selected, client, comment, setComment }) {
  const { actions, pending } = store;

  return (
    <div className="g32">
      <Card title="Approvals Queue" icon={Icons.briefcase}>
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Type</th>
              <th>Cost</th>
              <th>Time</th>
              <th>Status</th>
              <th>Teams</th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((approval) => (
              <tr key={approval.id} onClick={() => actions.setActiveApproval(approval.id)} style={{ cursor: "pointer", background: selected?.id === approval.id ? "var(--s2)" : "" }}>
                <td>
                  <div className="b">{approval.title}</div>
                  <div className="xs ct3">{approval.createdBy} · {approval.createdAt}</div>
                </td>
                <td className="xs">{approval.type}</td>
                <td className="mono xs">${approval.costImpact.toLocaleString()}</td>
                <td className="mono xs">{approval.timeImpact}d</td>
                <td><Badge tone={approval.status}>{approval.status}</Badge></td>
                <td><Badge tone={approval.notification.teams === "sent" ? "low" : "medium"}>{approval.notification.teams}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div>
        {selected ? (
          <>
            <Card className="mb8">
              <DetailHeader
                title={selected.title}
                subtitle={`${client?.name || "Client"} · ${selected.type}`}
                badges={[
                  { tone: selected.priority, label: selected.priority },
                  { tone: selected.status, label: selected.status },
                  { tone: "high", label: `$${selected.costImpact.toLocaleString()}` },
                  { tone: "medium", label: `${selected.timeImpact}d` },
                ]}
                actions={[
                  { label: "Reminder", small: true, onClick: () => actions.sendApprovalReminder(selected.id) },
                  { label: "Approve", tone: "bt-g", small: true, onClick: () => actions.updateApprovalStatus(selected.id, "approved", "Approved by builder on client confirmation.") },
                  { label: "Decline", tone: "bt-r", small: true, onClick: () => actions.updateApprovalStatus(selected.id, "declined", "Marked declined.") },
                ]}
              />
              <div className="g2 detail-grid">
                <div className="detail-pane">
                  <div className="xs ct3">AI Summary</div>
                  <div className="sm ct2" style={{ marginTop: 3 }}>{selected.aiDraft.summary}</div>
                  <div className="xs ct3" style={{ marginTop: 10 }}>Reason</div>
                  <div className="sm ct2" style={{ marginTop: 3 }}>{selected.aiDraft.reason}</div>
                  <div className="xs ct3" style={{ marginTop: 10 }}>Attachments Summary</div>
                  <div className="sm ct2" style={{ marginTop: 3 }}>{selected.attachmentsSummary}</div>
                </div>
                <div className="detail-pane">
                  <div className="xs ct3">Outbound States</div>
                  <div className="fx" style={{ gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                    <Badge tone="medium">Portal {selected.notification.portal}</Badge>
                    <Badge tone="low">Email {selected.notification.email}</Badge>
                    <Badge tone="medium">Teams {selected.notification.teams}</Badge>
                    <Badge tone="high">Escalation {selected.notification.escalationStatus}</Badge>
                  </div>
                  <div className="xs ct3" style={{ marginTop: 10 }}>Recommendation</div>
                  <div className="sm ct2" style={{ marginTop: 3 }}>{selected.recommendation}</div>
                </div>
              </div>
              <div className="mi" style={{ marginTop: 10 }}>
                <input value={comment} placeholder="Add builder comment..." onChange={(event) => setComment(event.target.value)} />
                <Button
                  small
                  tone="bt-p"
                  icon={Icons.send}
                  onClick={() => {
                    if (!comment.trim()) return;
                    actions.addApprovalComment(selected.id, "Dave Mitchell", "Supervisor", comment);
                    setComment("");
                  }}
                  disabled={pending[`approval-comment-${selected.id}`]}
                />
              </div>
            </Card>

            <div className="g2">
              <Card title="Timeline" icon={Icons.clock}>
                <Timeline entries={selected.timeline} />
              </Card>
              <Card title="Contract Pack Preview" icon={Icons.file}>
                <div className="fx" style={{ gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                  <Badge tone="medium">{selected.contractPack.version}</Badge>
                  <Badge tone={selected.contractPack.signatureStatus === "signed" ? "low" : "high"}>{selected.contractPack.signatureStatus}</Badge>
                  <Badge tone="medium">{selected.contractPack.finalPackageStatus}</Badge>
                </div>
                <div className="list-stack">
                  {selected.contractPack.sections.map((section) => (
                    <div className="linked-row" key={section}>
                      <div className="sm">{section}</div>
                      <span className="xs ct3">ready</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="mb8" />
            <LinkedRecordsPanel records={selected.source ? [selected.source] : []} resolveRecord={(link) => approvalResolve(store, link)} />
          </>
        ) : (
          <Card title="Approval Detail">
            <div className="ct3 sm empty">Select an approval.</div>
          </Card>
        )}
      </div>
    </div>
  );
}

function ClientInbox({ approvals, clients, onSelect }) {
  return (
    <div className="g2">
      <Card title="Inbox" icon={Icons.bell}>
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Request</th>
              <th>Status</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((approval) => {
              const client = clients.find((entry) => entry.id === approval.clientId);
              return (
                <tr key={approval.id} onClick={() => onSelect(approval.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <div className="b">{client?.name}</div>
                    <div className="xs ct3">{client?.preferredChannel}</div>
                  </td>
                  <td className="sm">{approval.title}</td>
                  <td><Badge tone={approval.status}>{approval.status}</Badge></td>
                  <td className="mono xs">{approval.dueAt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card title="Response States" icon={Icons.chat}>
        <div className="list-stack">
          {approvals.map((approval) => (
            <div className="linked-row" key={approval.id}>
              <div>
                <div className="b sm">{approval.title}</div>
                <div className="act-t">{approval.notification.portal} · {approval.notification.email} · {approval.notification.teams}</div>
              </div>
              <Badge tone={approval.clientResponse?.state || approval.status}>{approval.clientResponse?.state || approval.status}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function StalledApprovals({ approvals, onSelect }) {
  return (
    <div className="g2">
      <Card title="Stalled Dashboard" icon={Icons.alert}>
        <div className="list-stack">
          {approvals.map((approval) => (
            <div className="linked-row clickable" key={approval.id} onClick={() => onSelect(approval.id)}>
              <div>
                <div className="b sm">{approval.title}</div>
                <div className="act-t">{approval.type} · {approval.notification.escalationStatus}</div>
              </div>
              <div className="tr">
                <Badge tone={approval.status}>{approval.status}</Badge>
                <div className="xs ct3" style={{ marginTop: 3 }}>{approval.timeImpact}d / ${approval.costImpact.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Escalation Playbook" icon={Icons.trending}>
        <div className="list-stack">
          <div className="draft-row">
            <div className="xs ct3">24h no response</div>
            <div className="sm ct2">Push Teams escalation, keep portal open, queue email-ready reminder.</div>
          </div>
          <div className="draft-row">
            <div className="xs ct3">Client question raised</div>
            <div className="sm ct2">Route to PM or CA with AI summary and linked source pack.</div>
          </div>
          <div className="draft-row">
            <div className="xs ct3">Programme impact active</div>
            <div className="sm ct2">Surface time-at-risk badge on command centre and schedule screen.</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ApprovalAnalytics({ approvals, teamsLayer }) {
  const avgApprovalHours = approvals.length
    ? Math.round(
        approvals.reduce((sum, approval) => sum + (approval.status === "approved" ? 18 : approval.status === "stalled" ? 36 : 24), 0) / approvals.length,
      )
    : 0;

  return (
    <div className="g23">
      <div>
        <MetricGrid
          columns={4}
          items={[
            { label: "Avg Turnaround", value: `${avgApprovalHours}h`, color: "b" },
            { label: "Questions Raised", value: approvals.filter((approval) => approval.status === "question").length, color: "o" },
            { label: "Signed Packs", value: approvals.filter((approval) => approval.contractPack.signatureStatus === "signed").length, color: "g" },
            { label: "Escalations", value: teamsLayer.escalationQueue.length, color: "r" },
          ]}
        />
        <Card title="Approval Analytics" icon={Icons.bar}>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Count</th>
                <th>Approved Value</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(approvals.map((approval) => approval.type))).map((type) => {
                const group = approvals.filter((approval) => approval.type === type);
                return (
                  <tr key={type}>
                    <td className="b sm">{type}</td>
                    <td className="mono">{group.length}</td>
                    <td className="mono">${group.filter((approval) => approval.status === "approved").reduce((sum, approval) => sum + approval.costImpact, 0).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
      <Card title="Teams Action Layer" icon={Icons.chat}>
        <div className="list-stack">
          {teamsLayer.notifications.map((event) => (
            <div className="linked-row" key={event.id}>
              <div>
                <div className="b sm">{event.summary}</div>
                <div className="act-t">{event.channel}</div>
              </div>
              <Badge tone={event.status === "sent" ? "low" : "medium"}>{event.status}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ClientPortal({ approval, client, actions, pending }) {
  if (!approval || !client) {
    return (
      <Card title="Client Portal">
        <div className="ct3 sm empty">Select an approval to preview the client experience.</div>
      </Card>
    );
  }

  return (
    <div className="portal-shell">
      <div className="portal-brand">
        <div>
          <div className="portal-kicker">Client portal preview</div>
          <div className="portal-title">{client.brand}</div>
          <div className="portal-subtitle">{client.primaryContact} · {client.email}</div>
        </div>
        <Badge tone={approval.status}>{approval.status}</Badge>
      </div>
      <div className="portal-body">
        <div className="portal-summary">
          <div className="xs ct3">Approval Request</div>
          <h3>{approval.title}</h3>
          <p>{approval.aiDraft.summary}</p>
          <div className="portal-metrics">
            <div>
              <span>Cost</span>
              <strong>${approval.costImpact.toLocaleString()}</strong>
            </div>
            <div>
              <span>Time</span>
              <strong>{approval.timeImpact}d</strong>
            </div>
            <div>
              <span>Pack</span>
              <strong>{approval.contractPack.version}</strong>
            </div>
          </div>
        </div>
        <div className="portal-actions">
          <Button tone="bt-g" onClick={() => actions.updateApprovalStatus(approval.id, "approved", "Approved via client portal.")} disabled={pending[`approval-status-${approval.id}`]}>
            Approve
          </Button>
          <Button tone="bt-r" onClick={() => actions.updateApprovalStatus(approval.id, "declined", "Declined via client portal.")}>
            Decline
          </Button>
          <Button onClick={() => actions.updateApprovalStatus(approval.id, "change-requested", "Client requested amendment via portal.")}>
            Request Change
          </Button>
          <Button onClick={() => actions.updateApprovalStatus(approval.id, "question", "Client asked a question via portal.")}>
            Ask Question
          </Button>
          <Button tone="bt-p" onClick={() => actions.addApprovalComment(approval.id, client.primaryContact, "Client", "Please arrange a call to walk me through the programme impact.")}>
            Request Call
          </Button>
        </div>
      </div>
    </div>
  );
}
