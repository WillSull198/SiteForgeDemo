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
  const canPmReview = can(role, "clientflow.review_pm");
  const canCaReview = can(role, "clientflow.review_ca");
  const canGenerateContract = can(role, "clientflow.generate_contract");
  const [tab, setTab] = useState("dashboard");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(routeEntityId || derived.currentApproval?.id || state.approvals[0]?.id || null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(defaultForm);
  const [bulkSelectedIds, setBulkSelectedIds] = useState([]);

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

  const bulkSelectedApprovals = useMemo(
    () => siteApprovals.filter((approval) => bulkSelectedIds.includes(approval.id)),
    [bulkSelectedIds, siteApprovals],
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

  const communicationHub = useMemo(() => {
    return Object.entries(groupedByClient).map(([clientName, approvals]) => ({
      clientName,
      approvals,
      messages: approvals
        .flatMap((approval) => (approval.messageThread || []).map((messageEntry) => ({ ...messageEntry, approvalTitle: approval.title, approvalId: approval.id })))
        .sort((left, right) => String(right.at || "").localeCompare(String(left.at || ""))),
      lastContact: approvals
        .flatMap((approval) => approval.messageThread || [])
        .sort((left, right) => String(right.at || "").localeCompare(String(left.at || "")))[0]?.at,
    }));
  }, [groupedByClient]);

  const siteBundles = useMemo(
    () => (state.approvalBundles || []).filter((bundle) => (canSeeAllSites(role) ? true : bundle.siteId === siteId)),
    [role, siteId, state.approvalBundles],
  );
  const recoveryOpportunities = useMemo(
    () =>
      (state.recoveryOpportunities || [])
        .filter((opportunity) => (canSeeAllSites(role) ? true : opportunity.siteId === siteId))
        .filter((opportunity) => !["dismissed", "converted"].includes(opportunity.status)),
    [role, siteId, state.recoveryOpportunities],
  );

  const analytics = useMemo(() => {
    return ["0-7 days", "7-14 days", "14-30 days", "30+ days"].map((bucket) => ({
      bucket,
      count: siteApprovals.filter((approval) => analyticsAging(approval, currentNow) === bucket && !["signed", "declined"].includes(approval.status)).length,
    }));
  }, [currentNow, siteApprovals]);

  const operationalAnalytics = useMemo(() => {
    const signed = siteApprovals.filter((approval) => approval.status === "signed");
    const issued = siteApprovals.filter((approval) => approval.sentAt);
    const recoverable = siteApprovals.filter((approval) => Number(approval.costImpact || 0) > 0);
    const averageResponseHours = issued.length
      ? Math.round(
          issued.reduce((sum, approval) => {
            const sent = Date.parse(String(approval.sentAt || "").replace(" ", "T"));
            const terminal = Date.parse(String(approval.timeline?.find((entry) => ["signed", "approved", "declined"].includes(entry.type))?.at || approval.viewedAt || approval.sentAt).replace(" ", "T"));
            return sum + Math.max(0, (terminal - sent) / 36e5);
          }, 0) / issued.length,
        )
      : 0;
    return {
      averageResponseHours,
      approvalRate: issued.length ? Math.round((siteApprovals.filter((approval) => ["approved", "signed"].includes(approval.status)).length / issued.length) * 100) : 0,
      recoveredValue: signed.reduce((sum, approval) => sum + Number(approval.costImpact || 0), 0),
      pendingValue: siteApprovals.filter((approval) => ["awaiting-client", "question", "changes-requested"].includes(approval.status)).reduce((sum, approval) => sum + Number(approval.costImpact || 0), 0),
      timeToRecoverHours: signed.length
        ? Math.round(
            signed.reduce((sum, approval) => {
              const created = Date.parse(String(approval.timeline?.[0]?.at || approval.sentAt || "").replace(" ", "T"));
              const signedAt = Date.parse(String(approval.timeline?.find((entry) => entry.type === "signed")?.at || approval.sentAt || "").replace(" ", "T"));
              return sum + Math.max(0, (signedAt - created) / 36e5);
            }, 0) / signed.length,
          )
        : 0,
      recoverableCount: recoverable.length,
    };
  }, [siteApprovals]);

  const recoveryAnalytics = useMemo(() => {
    const linked = siteApprovals.filter((approval) => approval.recoveryChain);
    const signed = linked.filter((approval) => approval.status === "signed");
    const signedHours = signed
      .map((approval) => {
        const sourceAt = Date.parse(String(approval.recoveryChain?.sourceEventAt || approval.recoveryChain?.approvalCreatedAt || "").replace(" ", "T"));
        const signedAt = Date.parse(String(approval.recoveryChain?.signedAt || approval.timeline?.find((entry) => entry.type === "signed")?.at || "").replace(" ", "T"));
        return Number.isFinite(sourceAt) && Number.isFinite(signedAt) ? Math.max(0, Math.round((signedAt - sourceAt) / 36e5)) : null;
      })
      .filter((value) => value !== null);
    return {
      chainCount: linked.length,
      signedCount: signed.length,
      recoveredValue: signed.reduce((sum, approval) => sum + Number(approval.costImpact || 0), 0),
      pendingValue: linked.filter((approval) => approval.status !== "signed").reduce((sum, approval) => sum + Number(approval.costImpact || 0), 0),
      averageTimeToRecovery: signedHours.length ? Math.round(signedHours.reduce((sum, value) => sum + value, 0) / signedHours.length) : 0,
    };
  }, [siteApprovals]);

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
            { value: "recovery", label: "Recovery Engine" },
            { value: "bundles", label: "Bundles" },
            { value: "comms", label: "Comms Hub" },
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
            {bulkSelectedIds.length ? (
              <div className="linked-row" style={{ marginBottom: 10 }}>
                <div>
                  <div className="b sm">{bulkSelectedIds.length} approvals selected</div>
                  <div className="xs ct3">Bulk issue sends eligible drafts in one controlled ClientFlow run.</div>
                </div>
                <div className="fx" style={{ gap: 6 }}>
                  <Button small tone="bt-p" onClick={() => actions.bulkIssueApprovals(bulkSelectedIds)}>
                    Issue selected
                  </Button>
                  <Button small onClick={() => actions.createApprovalBundle(bulkSelectedIds)}>
                    Create bundle
                  </Button>
                  <Button small onClick={() => setBulkSelectedIds([])}>
                    Clear
                  </Button>
                </div>
              </div>
            ) : null}
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
                    <Badge tone={["declined", "internal-rejected"].includes(value) ? "critical" : value === "signed" ? "passed" : value === "awaiting-client" ? "medium" : "high"}>
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
                {
                  label: "Select",
                  onClick: (approval) =>
                    setBulkSelectedIds((current) =>
                      current.includes(approval.id) ? current.filter((id) => id !== approval.id) : [...current, approval.id],
                    ),
                },
                { label: "Open", onClick: (approval) => setSelectedId(approval.id) },
                {
                  label: "Submit Review",
                  tone: "bt-p",
                  onClick: (approval) => actions.submitApprovalForInternalReview(approval.id),
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
                      <Button small tone="bt-p" icon={Icons.send} data-testid="approval-submit-pm-review" onClick={() => actions.submitApprovalForInternalReview(selected.id)}>
                        Submit for Review
                      </Button>
                    ) : null}
                    {selected.status === "awaiting-pm" && canPmReview ? (
                      <>
                        <Button small tone="bt-g" icon={Icons.check} data-testid="approval-pm-approve" onClick={() => actions.pmReviewApproval(selected.id, "approve", window.prompt("PM review note", "Approved for Contract Admin review.") || "")}>
                          PM Approve
                        </Button>
                        <Button small tone="bt-r" icon={Icons.x} data-testid="approval-pm-reject" onClick={() => actions.pmReviewApproval(selected.id, "reject", window.prompt("Reason for rejection", "Revise before client issue.") || "")}>
                          PM Reject
                        </Button>
                      </>
                    ) : null}
                    {selected.status === "awaiting-ca" && canCaReview ? (
                      <>
                        <Button small tone="bt-g" icon={Icons.check} data-testid="approval-ca-approve" aria-label="approval-send-client" onClick={() => actions.caReviewApproval(selected.id, "approve", window.prompt("Contract Admin review note", "Approved for client issue.") || "")}>
                          CA Approve + Send
                        </Button>
                        <Button small tone="bt-r" icon={Icons.x} data-testid="approval-ca-reject" onClick={() => actions.caReviewApproval(selected.id, "reject", window.prompt("Reason for rejection", "Revise contract language before issue.") || "")}>
                          CA Reject
                        </Button>
                      </>
                    ) : null}
                    {["draft", "awaiting-pm", "awaiting-ca", "internal-rejected"].includes(selected.status) && canPmReview && canCaReview ? (
                      <Button small tone="bt-p" icon={Icons.zap} data-testid="approval-director-override" onClick={() => actions.directorOverrideApprovalReview(selected.id)}>
                        Director Override
                      </Button>
                    ) : null}
                    {selected.status === "approved" && canGenerateContract ? (
                      <Button small tone="bt-p" icon={Icons.file} data-testid="approval-generate-contract-pack" onClick={() => actions.generateContractFromApproval(selected.id)}>
                        Generate Contract Pack
                      </Button>
                    ) : null}
                    {["awaiting-client", "question", "changes-requested"].includes(selected.status) && canApprove ? (
                      <>
                        <Button small tone="bt-g" icon={Icons.check} data-testid="approval-mark-signed" onClick={() => actions.markApprovalInternal(selected.id, "approved", "Marked approved internally after client confirmation.")}>
                          Mark Approved
                        </Button>
                        <Button small tone="bt-r" icon={Icons.x} data-testid="approval-mark-declined" onClick={() => actions.markApprovalInternal(selected.id, "declined", "Marked declined internally.")}>
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
                        {selected.magicLink ? (
                          <div className="xs ct3" style={{ marginTop: 6 }}>
                            Single-use magic link expires {selected.magicLink.expiresAt}. Email verification and 30-minute portal timeout are enabled.
                          </div>
                        ) : null}
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
                    <Card title="Delivery Channels" icon={Icons.send} className="mb8">
                      <div className="list-stack">
                        {(selected.deliveryQueue || []).length ? (
                          selected.deliveryQueue.map((delivery) => (
                            <div className="linked-row" key={delivery.id}>
                              <div>
                                <div className="b sm">{delivery.channel}</div>
                                <div className="xs ct3">Queued {delivery.queuedAt}</div>
                              </div>
                              <Badge tone={delivery.status === "available" || delivery.status === "sent" ? "passed" : "medium"}>{delivery.status}</Badge>
                            </div>
                          ))
                        ) : (
                          <div className="ct3 sm">Delivery channels are prepared when the approval is sent.</div>
                        )}
                      </div>
                    </Card>
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

                    <Card title="Compliance Trail" icon={Icons.shield} className="mb8">
                      <div className="list-stack">
                        {(selected.complianceTrail || []).slice(-6).reverse().map((event) => (
                          <div className="linked-row" key={event.id}>
                            <div>
                              <div className="b sm">{event.event}</div>
                              <div className="xs ct3">{event.actor} · {event.timestamp}</div>
                              <div className="xs mono ct3">{event.hash}</div>
                            </div>
                            <Badge tone="passed">hashed</Badge>
                          </div>
                        ))}
                        {!(selected.complianceTrail || []).length ? <div className="ct3 sm">No compliance events have been recorded yet.</div> : null}
                      </div>
                      <div className="fa" style={{ justifyContent: "flex-start", marginTop: 10 }}>
                        <Button small onClick={() => actions.verifyApprovalComplianceTrail(selected.id)}>
                          Verify trail
                        </Button>
                        {selected.complianceVerification ? <Badge tone={selected.complianceVerification.status === "verified" ? "passed" : "critical"}>{selected.complianceVerification.status}</Badge> : null}
                      </div>
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
            <div className="g2" style={{ marginBottom: 12 }}>
              <div className="si b">
                <div className="sl">Avg response</div>
                <div className="sv">{operationalAnalytics.averageResponseHours}h</div>
                <div className="ss">Sent to first terminal action</div>
              </div>
              <div className="si b">
                <div className="sl">Time to recover</div>
                <div className="sv">{operationalAnalytics.timeToRecoverHours}h</div>
                <div className="ss">Source event to signed approval</div>
              </div>
              <div className="si b">
                <div className="sl">Pending value</div>
                <div className="sv">${Math.round(operationalAnalytics.pendingValue).toLocaleString()}</div>
                <div className="ss">Awaiting client response</div>
              </div>
              <div className="si b">
                <div className="sl">Approval rate</div>
                <div className="sv">{operationalAnalytics.approvalRate}%</div>
                <div className="ss">Issued approvals approved or signed</div>
              </div>
            </div>
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

      {tab === "recovery" ? (
        <div className="g23">
          <Card
            title="Field-to-Commercial Recovery"
            icon={Icons.zap}
            right={
              <Button small tone="bt-p" icon={Icons.search} onClick={() => actions.detectRecoveryOpportunities(siteId)}>
                Sweep Site Events
              </Button>
            }
          >
            <div className="g2" style={{ marginBottom: 12 }}>
              <div className="si b">
                <div className="sl">Linked chains</div>
                <div className="sv">{recoveryAnalytics.chainCount}</div>
                <div className="ss">Site events connected to ClientFlow</div>
              </div>
              <div className="si b">
                <div className="sl">Recovered</div>
                <div className="sv">${Math.round(recoveryAnalytics.recoveredValue).toLocaleString()}</div>
                <div className="ss">Signed recovery value</div>
              </div>
              <div className="si b">
                <div className="sl">Pending exposure</div>
                <div className="sv">${Math.round(recoveryAnalytics.pendingValue).toLocaleString()}</div>
                <div className="ss">Draft / issued recovery chain value</div>
              </div>
              <div className="si b">
                <div className="sl">Avg time-to-recover</div>
                <div className="sv">{recoveryAnalytics.averageTimeToRecovery}h</div>
                <div className="ss">Source event to signed approval</div>
              </div>
            </div>
            <div className="list-stack">
              {recoveryOpportunities.length ? (
                recoveryOpportunities.map((opportunity) => (
                  <div className="act" key={opportunity.id}>
                    <div style={{ flex: 1 }}>
                      <div className="b sm">{opportunity.title}</div>
                      <div className="xs ct3">
                        {opportunity.chainType} · source {opportunity.sourceType} · detected {opportunity.detectedAt}
                      </div>
                      <div className="sm ct2" style={{ marginTop: 4 }}>{opportunity.reason}</div>
                    </div>
                    <div className="tr">
                      <Badge tone={Number(opportunity.costImpact || 0) > 0 ? "high" : "medium"}>
                        ${Number(opportunity.costImpact || 0).toLocaleString()} · {opportunity.timeImpact || 0}d
                      </Badge>
                      <div className="fx" style={{ gap: 4, justifyContent: "flex-end", marginTop: 8 }}>
                        <Button small tone="bt-p" onClick={() => actions.raiseRecoveryApproval({ opportunityId: opportunity.id })}>
                          Raise Approval
                        </Button>
                        <Button small onClick={() => actions.dismissRecoveryOpportunity(opportunity.id, "Reviewed and not commercially recoverable.")}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="ct3 sm empty">Run a sweep to find diary rain days, problem impacts, RFI scope changes, procurement delays, safety delays, drawing revisions, and forecast rain events that have not reached ClientFlow.</div>
              )}
            </div>
          </Card>
          <Card title="Recovery chains covered" icon={Icons.link}>
            <div className="list-stack">
              {[
                "Diary -> Variation",
                "Diary -> Rain Day",
                "Problem -> Variation",
                "Problem -> Delay Notice",
                "RFI -> Variation",
                "RFI -> EOT",
                "Procurement Delay -> EOT",
                "Safety Incident -> Delay Notice",
                "Drawing Revision -> Variation",
                "Weather Forecast -> Rain Day",
              ].map((chain) => (
                <div className="linked-row" key={chain}>
                  <span>{chain}</span>
                  <Badge tone="passed">one-click</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "bundles" ? (
        <div className="g2">
          <Card title="Approval Bundles" icon={Icons.link}>
            <div className="list-stack">
              {siteBundles.length ? (
                siteBundles.map((bundle) => {
                  const approvals = siteApprovals.filter((approval) => bundle.approvalIds.includes(approval.id));
                  const signed = approvals.filter((approval) => approval.status === "signed").length;
                  const declined = approvals.filter((approval) => approval.status === "declined").length;
                  const status = declined ? "partial" : signed === approvals.length ? "all signed" : "in progress";
                  return (
                    <div className="act" key={bundle.id}>
                      <div style={{ flex: 1 }}>
                        <div className="b sm">{bundle.number} · {bundle.title}</div>
                        <div className="xs ct3">{approvals.length} approvals · {state.clients.find((client) => client.id === bundle.clientId)?.name}</div>
                        <div className="sm ct2" style={{ marginTop: 4 }}>
                          Single operational package for related commercial approvals from the same site event.
                        </div>
                      </div>
                      <div className="tr">
                        <Badge tone={status === "all signed" ? "passed" : status === "partial" ? "high" : "medium"}>{status}</Badge>
                        <div className="xs ct3">{bundle.createdAt}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="ct3 sm empty">Select two or more approvals in the register, then choose "Create bundle".</div>
              )}
            </div>
          </Card>
          <Card title="Bundle Rules" icon={Icons.shield}>
            <div className="list-stack">
              <div className="linked-row"><span>One portal package can represent variation + EOT + clarification.</span><Badge tone="passed">operational</Badge></div>
              <div className="linked-row"><span>Each approval keeps its own signature and hash trail.</span><Badge tone="passed">auditable</Badge></div>
              <div className="linked-row"><span>Buildxact receives signed outcomes individually.</span><Badge tone="medium">cost boundary</Badge></div>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "comms" ? (
        <div className="g2">
          {communicationHub.map((thread) => (
            <Card title={thread.clientName} icon={Icons.chat} key={thread.clientName}>
              <div className="linked-row" style={{ marginBottom: 10 }}>
                <div>
                  <div className="b sm">{thread.approvals.length} approvals</div>
                  <div className="xs ct3">Last contact {thread.lastContact || "No messages yet"}</div>
                </div>
                <Badge tone={thread.messages.length ? "medium" : "low"}>{thread.messages.length} messages</Badge>
              </div>
              <div className="list-stack">
                {thread.messages.slice(0, 8).map((entry) => (
                  <div className="act" key={entry.id}>
                    <div style={{ flex: 1 }}>
                      <div className="b sm">{entry.by}</div>
                      <div className="xs ct3">{entry.approvalTitle} · {entry.at}</div>
                      <div className="sm ct2" style={{ marginTop: 4 }}>{entry.body}</div>
                    </div>
                    <Button small onClick={() => setSelectedId(entry.approvalId)}>
                      Open
                    </Button>
                  </div>
                ))}
                {!thread.messages.length ? <div className="ct3 sm empty">No client messages yet.</div> : null}
              </div>
            </Card>
          ))}
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
          <Button tone="bt-p" icon={Icons.plus} data-testid="approval-create-draft" onClick={createApproval}>
            Create Draft
          </Button>
        </div>
      </Modal>
    </div>
  );
}
