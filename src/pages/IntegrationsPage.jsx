import { useMemo, useState } from "react";
import { Icons } from "../components/icons";
import DataTable from "../components/DataTable";
import { Badge, Button, Card, MetricGrid, Modal, RestrictedPanel, Tabs } from "../components/ui";
import { useSiteForge } from "../services/siteforgeStore";
import { can } from "../services/permissions";
import { SYNC_ENTITY_TOGGLES } from "../services/integrations/buildxact/schemas";
import { getStoredAiConfig } from "../services/aiService";

const copyJson = async (payload) => {
  if (!payload) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }
};

const downloadJson = (name, payload) => {
  if (!payload) return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name || "payload"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export default function IntegrationsPage() {
  const { state, actions } = useSiteForge();
  const role = state.session.role;
  const canView = can(role, "integrations.view");
  const [tab, setTab] = useState("status");
  const [payloadPreview, setPayloadPreview] = useState(null);
  const [slashCommand, setSlashCommand] = useState("/siteforge approvals stalled");
  const integrationSettings = state.device?.settings?.integrations || state.settings?.integrations || {};
  const aiConfig = getStoredAiConfig(integrationSettings);
  const aiConnected = aiConfig.provider === "openai" ? Boolean(aiConfig.openaiKey) : Boolean(aiConfig.anthropicKey);
  const aiProviderLabel = aiConfig.provider === "openai" ? "ChatGPT / OpenAI" : "Claude / Anthropic";
  const aiStatusLabel = !aiConnected
    ? "not configured"
    : integrationSettings.aiLastTestStatus === "ok"
      ? "configured + last test ok"
      : integrationSettings.aiLastTestStatus === "failed"
        ? "configured + test failed"
        : "configured + untested";

  const metrics = [
    { label: "Email Queue", value: state.emailQueue?.filter((item) => item.status === "queued").length || 0, color: "b" },
    { label: "SMS Queue", value: state.smsQueue?.filter((item) => item.status === "queued").length || 0, color: "a" },
    { label: "Teams Queue", value: state.teamsQueue?.filter((item) => item.status === "queued").length || 0, color: "p" },
    { label: "Buildxact Pushes", value: state.buildxact.queue.filter((item) => ["pending", "queued", "read-only"].includes(item.status)).length, color: "a" },
    { label: "Sync Errors", value: state.buildxact.syncHistory.filter((item) => item.status === "error").length, color: "r" },
  ];

  const failedHistory = useMemo(() => state.buildxact.syncHistory.filter((item) => item.status === "error"), [state.buildxact.syncHistory]);

  if (!canView) {
    return <RestrictedPanel title="Integration Settings" body="Only Contract Admin and Director roles can view outbound connector settings." />;
  }

  return (
    <div className="oy fin">
      <MetricGrid columns={4} items={metrics} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "status", label: "Status" },
          { value: "email", label: "Email Queue" },
          { value: "sms", label: "SMS Queue" },
          { value: "teams", label: "Teams Action Layer" },
          { value: "buildxact", label: "Buildxact Connector" },
          { value: "history", label: "Sync History" },
        ]}
      />

      {tab === "status" ? (
        <div className="g2">
          <Card title="Integration Status" icon={Icons.gear}>
            {[
              ["Buildxact", state.buildxact.connection.status || "disconnected", "Connect Buildxact"],
              ["AI Provider", `${aiProviderLabel} · ${aiStatusLabel}`, "Add API key"],
              ["Email", integrationSettings.emailProvider || "queued-only", "Open email queue"],
              ["SMS", integrationSettings.smsProvider || "queued-only", "Open SMS queue"],
              ["Microsoft Teams", state.teams?.connected ? "connected" : "disconnected", "Open Teams queue"],
            ].map(([name, status, action]) => (
              <div className="linked-row" key={name}>
                <div>
                  <div className="b sm">{name}</div>
                  <div className="xs ct3">{status}</div>
                </div>
                <Badge tone={String(status).includes("connected") ? "passed" : String(status).includes("queued") ? "medium" : "critical"}>{status}</Badge>
                <Button
                  small
                  onClick={() =>
                    name === "AI Provider"
                      ? actions.navigate({ kind: "internal", siteId: state.session.siteId, page: "admin", entityId: null })
                      : setTab(name === "Email" ? "email" : name === "SMS" ? "sms" : name === "Microsoft Teams" ? "teams" : name === "Buildxact" ? "buildxact" : "buildxact")
                  }
                >
                  {action}
                </Button>
              </div>
            ))}
          </Card>
          <Card title="Queue Policy" icon={Icons.send}>
            <p className="sm ct2">No external delivery is simulated. When a provider is disconnected, SiteForge stores the exact payload locally with status, recipient, timestamp and manual-send controls.</p>
            <div className="linked-row"><span>Queued email payloads</span><Badge tone="medium">{state.emailQueue?.length || 0}</Badge></div>
            <div className="linked-row"><span>Queued SMS payloads</span><Badge tone="medium">{state.smsQueue?.length || 0}</Badge></div>
            <div className="linked-row"><span>Queued Teams payloads</span><Badge tone="medium">{state.teamsQueue?.length || 0}</Badge></div>
            <div className="linked-row"><span>Queued Buildxact pushes</span><Badge tone="medium">{state.buildxact.pendingPushes?.length || state.buildxact.queue.length}</Badge></div>
          </Card>
        </div>
      ) : null}

      {tab === "email" ? (
        <Card title="Email Queue" icon={Icons.send}>
          <DataTable
            storageKey="email-queue"
            rows={state.emailQueue || []}
            columns={[
              { key: "type", label: "Type", filterable: true },
              { key: "subject", label: "Subject", filterable: true },
              { key: "createdAt", label: "Queued", type: "date", filterable: true },
              { key: "status", label: "Status", filterable: true, render: (value) => <Badge tone={value === "sent" ? "passed" : value === "failed" ? "critical" : "medium"}>{value}</Badge> },
            ]}
            rowActions={[
              { label: "Payload", onClick: (item) => setPayloadPreview({ type: item.type, reference: item.id, current: item, previous: null }) },
              { label: "Mark sent", onClick: (item) => actions.markExternalQueueItemSent("emailQueue", item.id), when: (item) => item.status !== "sent" },
              { label: "Delete", tone: "bt-r", onClick: (item) => window.confirm("Delete this queued email?") && actions.deleteExternalQueueItem("emailQueue", item.id) },
            ]}
          />
        </Card>
      ) : null}

      {tab === "sms" ? (
        <Card title="SMS Queue" icon={Icons.phone}>
          <DataTable
            storageKey="sms-queue"
            rows={state.smsQueue || []}
            columns={[
              { key: "type", label: "Type", filterable: true },
              { key: "body", label: "Message", filterable: true },
              { key: "createdAt", label: "Queued", type: "date", filterable: true },
              { key: "status", label: "Status", filterable: true, render: (value) => <Badge tone={value === "sent" ? "passed" : value === "failed" ? "critical" : "medium"}>{value}</Badge> },
            ]}
            rowActions={[
              { label: "Payload", onClick: (item) => setPayloadPreview({ type: item.type, reference: item.id, current: item, previous: null }) },
              { label: "Mark sent", onClick: (item) => actions.markExternalQueueItemSent("smsQueue", item.id), when: (item) => item.status !== "sent" },
              { label: "Delete", tone: "bt-r", onClick: (item) => window.confirm("Delete this queued SMS?") && actions.deleteExternalQueueItem("smsQueue", item.id) },
            ]}
          />
        </Card>
      ) : null}

      {tab === "teams" ? (
        <div className="g2">
          <Card title="Teams Setup" icon={Icons.chat}>
            <div className="linked-row">
              <div>
                <div className="b sm">{state.teams?.botName || "SiteForge Bot"}</div>
                <div className="xs ct3">
                  OAuth: {state.teams?.oauthStatus || "mocked"} · Tenant: {state.teams?.tenantName || "Demo Microsoft 365 Tenant"}
                </div>
              </div>
              <div className="fx" style={{ gap: 6 }}>
                <Badge tone={state.teams?.connected ? "passed" : "medium"}>{state.teams?.connected ? "connected" : "queue-only"}</Badge>
                <Button small tone="bt-p" onClick={() => actions.connectTeamsMock()}>
                  Configure Teams
                </Button>
                <Button small onClick={() => actions.sendTeamsTestMessage()}>
                  Send Test
                </Button>
              </div>
            </div>
            <div className="g2" style={{ marginTop: 12 }}>
              {Object.entries(state.teams?.channelMap || {}).map(([eventType, channel]) => (
                <label className="ff" key={eventType}>
                  <span>{eventType}</span>
                  <input value={channel} onChange={(event) => actions.updateTeamsChannelMap(eventType, event.target.value)} />
                </label>
              ))}
            </div>
          </Card>

          <Card title="ChatOps Commands" icon={Icons.zap}>
            <div className="mi" style={{ paddingLeft: 0, paddingRight: 0 }}>
              <input value={slashCommand} onChange={(event) => setSlashCommand(event.target.value)} placeholder="/siteforge approvals stalled" />
              <Button small tone="bt-p" onClick={() => actions.runTeamsSlashCommand(slashCommand)}>
                Run
              </Button>
            </div>
            <div className="list-stack" style={{ marginTop: 10 }}>
              {(state.teams?.commandLog || []).slice(0, 5).map((entry) => (
                <div className="linked-row" key={entry.id}>
                  <div>
                    <div className="b sm">{entry.command}</div>
                    <div className="xs ct3">{entry.response.title} · {entry.at}</div>
                    <div className="sm ct2" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{entry.response.body}</div>
                  </div>
                  <Badge tone={entry.response.status === "error" ? "critical" : "passed"}>{entry.response.status}</Badge>
                </div>
              ))}
              {!(state.teams?.commandLog || []).length ? <div className="ct3 sm empty">Run a slash command to preview ChatOps responses.</div> : null}
            </div>
          </Card>

          <Card title="Teams Notification Centre" icon={Icons.chat}>
            <DataTable
              storageKey="teams-event-log"
              rows={state.teams?.outbound || state.notifications.eventLog}
              columns={[
                { key: "title", label: "Event", filterable: true },
                { key: "eventType", label: "Type", filterable: true, options: [...new Set((state.teams?.outbound || []).map((event) => event.eventType))] },
                { key: "channel", label: "Channel", filterable: true, options: [...new Set((state.teams?.outbound || []).map((event) => event.channel))] },
                { key: "at", label: "At", filterable: true, type: "date" },
                {
                  key: "status",
                  label: "Status",
                  filterable: true,
                  options: [...new Set((state.teams?.outbound || []).map((event) => event.status))],
                  render: (value) => <Badge tone={value === "error" ? "critical" : value === "queued" ? "medium" : "passed"}>{value}</Badge>,
                },
              ]}
              rowActions={[
                {
                  label: "Payload",
                  onClick: (event) => setPayloadPreview({ type: event.eventType || "teams", reference: event.id, current: event.payload || event, previous: null }),
                  when: (event) => Boolean(event.payload),
                },
              ]}
            />
          </Card>

          <Card title="Teams Queue" icon={Icons.send}>
            <DataTable
              storageKey="teams-queue"
              rows={state.teamsQueue || []}
              columns={[
                { key: "type", label: "Type", filterable: true },
                { key: "channel", label: "Channel", filterable: true },
                { key: "createdAt", label: "Queued", type: "date", filterable: true },
                {
                  key: "status",
                  label: "Status",
                  filterable: true,
                  render: (value) => <Badge tone={value === "sent" ? "passed" : value === "failed" ? "critical" : "medium"}>{value}</Badge>,
                },
              ]}
              rowActions={[
                { label: "Payload", onClick: (item) => setPayloadPreview({ type: item.type, reference: item.id, current: item.payload || item, previous: null }) },
                { label: "Mark sent", onClick: (item) => actions.markExternalQueueItemSent("teamsQueue", item.id), when: (item) => item.status !== "sent" },
                { label: "Delete", tone: "bt-r", onClick: (item) => window.confirm("Delete this queued Teams payload?") && actions.deleteExternalQueueItem("teamsQueue", item.id) },
              ]}
            />
          </Card>

          <Card title="Escalation Queue" icon={Icons.alert}>
            <DataTable
              storageKey="teams-escalation-queue"
              rows={state.approvals.filter((approval) => ["awaiting-client", "question", "changes-requested"].includes(approval.status))}
              columns={[
                { key: "title", label: "Approval", filterable: true },
                { key: "status", label: "Status", filterable: true, options: ["awaiting-client", "question", "changes-requested"] },
                { key: "sentAt", label: "Sent", filterable: true, type: "date" },
                { key: "siteId", label: "Site", filterable: true, options: [...new Set(state.approvals.map((approval) => approval.siteId))] },
              ]}
              rowActions={[
                {
                  label: "Escalate",
                  onClick: (approval) => actions.sendDirectorEscalation(approval.siteId, approval.title),
                },
                {
                  label: "Teams Card",
                  tone: "bt-p",
                  onClick: (approval) => actions.queueTeamsApprovalCard(approval.id),
                },
                {
                  label: "Teams Approve",
                  tone: "bt-g",
                  onClick: (approval) => actions.handleTeamsApprovalAction({ approvalId: approval.id, action: "approve", signerName: "Teams PM" }),
                },
              ]}
            />
          </Card>
        </div>
      ) : null}

      {tab === "buildxact" ? (
        <div className="g32" style={{ marginTop: 10 }}>
          <Card title="Buildxact Settings" icon={Icons.gear}>
            {state.buildxact.connection.status !== "connected" ? (
              <div className="callout warning" style={{ marginBottom: 12 }}>
                Buildxact is disconnected. Projects, clients, cost codes and signed variations will not sync externally. Signed outcomes are retained in the queue below until you connect.
              </div>
            ) : null}
            {state.buildxact.readOnlyMode ? (
              <div className="callout warning" style={{ marginBottom: 12 }}>
                Read-only mode is active. SiteForge will pull Buildxact context but signed variations and contract packs remain queued locally.
              </div>
            ) : null}
            <div className="g2">
              <div className="ff">
                <label>Connection Status</label>
                <div className="linked-row">
                  <div>
                    <div className="b sm">{state.buildxact.connection.status}</div>
                    <div className="xs ct3">Workspace {state.buildxact.connection.workspaceId}</div>
                    <div className="xs ct3">Last sync {state.buildxact.lastSyncAt || "Not reconciled yet"}</div>
                  </div>
                  <div className="fx" style={{ gap: 6 }}>
                    <Button small onClick={() => actions.testBuildxactConnection()}>
                      Test
                    </Button>
                    <Button small tone="bt-p" onClick={() => actions.reconcileBuildxactNow()}>
                      Reconcile now
                    </Button>
                  </div>
                </div>
              </div>
              <div className="ff">
                <label>API Key</label>
                <input
                  value={state.buildxact.connection.apiKeyMasked}
                  placeholder="Paste Buildxact API key when available"
                  onChange={(event) => actions.updateBuildxactSettings({ connection: { apiKeyMasked: event.target.value } })}
                />
              </div>
              <div className="ff">
                <label>Workspace ID</label>
                <input
                  value={state.buildxact.connection.workspaceId}
                  placeholder="Buildxact workspace ID"
                  onChange={(event) => actions.updateBuildxactSettings({ connection: { workspaceId: event.target.value } })}
                />
              </div>
            </div>
            <div className="linked-row" style={{ marginTop: 10 }}>
              <div>
                <div className="b sm">Read-only mode</div>
                <div className="xs ct3">Pull projects, clients, suppliers, cost codes, and schedule without pushing signed outcomes back.</div>
              </div>
              <label className="switch">
                <input type="checkbox" checked={state.buildxact.readOnlyMode} onChange={(event) => actions.setBuildxactReadOnly(event.target.checked)} />
                <span />
              </label>
            </div>
            <div className="linked-row" style={{ marginTop: 10 }}>
              <div>
                <div className="b sm">Webhook endpoint</div>
                <div className="xs ct3" style={{ wordBreak: "break-all" }}>{state.buildxact.webhookEndpoint}</div>
              </div>
              <Button small onClick={() => navigator.clipboard?.writeText(state.buildxact.webhookEndpoint)}>
                Copy
              </Button>
            </div>
            <div className="g2">
              {Object.entries(SYNC_ENTITY_TOGGLES).map(([key, label]) => {
                const enabled = Boolean((state.buildxact.entitySync || state.buildxact.toggles || {})[key]);
                return (
                <div className="linked-row" key={key}>
                  <div>
                    <div className="b sm">{label}</div>
                    <div className="xs ct3">Sync frequency {state.buildxact.syncFrequency[key]}</div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => actions.updateBuildxactSettings({ entitySync: { [key]: event.target.checked }, toggles: { [key]: event.target.checked } })}
                    />
                    <span />
                  </label>
                </div>
                );
              })}
            </div>
          </Card>

          <div>
            <Card title="Outbound Queue" icon={Icons.send} className="mb8">
              <DataTable
                storageKey="buildxact-queue"
                rows={state.buildxact.queue}
                columns={[
                  { key: "type", label: "Type", filterable: true, options: [...new Set(state.buildxact.queue.map((item) => item.type))] },
                  { key: "reference", label: "Reference", filterable: true },
                  { key: "siteId", label: "Site", filterable: true, options: [...new Set(state.buildxact.queue.map((item) => item.siteId))] },
                  { key: "payloadSize", label: "Payload", filterable: true },
                  {
                    key: "status",
                    label: "Status",
                    filterable: true,
                    options: [...new Set(state.buildxact.queue.map((item) => item.status))],
                    render: (value) => <Badge tone={value === "sent" ? "passed" : value === "error" ? "critical" : "medium"}>{value}</Badge>,
                  },
                ]}
                rowActions={[
                  {
                    label: "Payload",
                    onClick: (item) => setPayloadPreview(state.buildxact.payloadPreviews.find((payload) => payload.reference === item.reference) || null),
                  },
                  {
                    label: "Trigger",
                    onClick: (item) => actions.triggerSyncQueueItem(item.id),
                    when: (item) => item.status === "pending",
                  },
                ]}
              />
            </Card>

            <Card title="Cost Code Mapping" icon={Icons.box}>
              <div className="list-stack">
                {state.buildxact.costCodes.map((code) => (
                  <div className="linked-row" key={code.id || code.local}>
                    <div>
                      <div className="b sm">{code.code || code.local}</div>
                      <div className="xs ct3">{code.name || code.remote}</div>
                    </div>
                    <Badge tone="passed">Mapped</Badge>
                  </div>
                ))}
                {!state.buildxact.costCodes.length ? <div className="ct3 sm empty">No Buildxact cost codes are loaded. Connect Buildxact before mapping signed outcomes.</div> : null}
              </div>
            </Card>
            <Card title="Buildxact Source Context" icon={Icons.grid} style={{ marginTop: 8 }}>
              <div className="list-stack">
                <div className="linked-row"><span>Suppliers</span><Badge tone="medium">{state.buildxact.suppliers.length}</Badge></div>
                <div className="linked-row"><span>Cost codes</span><Badge tone="medium">{state.buildxact.costCodes.length}</Badge></div>
                <div className="linked-row"><span>Schedule milestones</span><Badge tone="medium">{state.buildxact.scheduleMilestones.length}</Badge></div>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "history" ? (
        <Card title="Sync History" icon={Icons.clock} className="mb8" style={{ marginTop: 10 }}>
          <DataTable
            storageKey="buildxact-sync-history"
            rows={state.buildxact.syncHistory}
            columns={[
              { key: "type", label: "Type", filterable: true, options: [...new Set(state.buildxact.syncHistory.map((entry) => entry.type))] },
              { key: "reference", label: "Reference", filterable: true },
              {
                key: "status",
                label: "Status",
                filterable: true,
                options: [...new Set(state.buildxact.syncHistory.map((entry) => entry.status))],
                render: (value) => <Badge tone={value === "success" ? "passed" : value === "error" ? "critical" : "medium"}>{value}</Badge>,
              },
              { key: "duration", label: "Duration", filterable: true },
              { key: "at", label: "At", filterable: true, type: "date" },
            ]}
            rowActions={[
              {
                label: "Payload",
                onClick: (entry) => setPayloadPreview(state.buildxact.payloadPreviews.find((payload) => payload.reference === entry.reference) || null),
              },
              {
                label: "Retry",
                tone: "bt-r",
                onClick: (entry) => actions.retryBuildxactSync(entry.id),
                when: (entry) => entry.status === "error",
              },
            ]}
          />
          {failedHistory.length ? (
            <Button tone="bt-p" icon={Icons.shuffle} onClick={() => actions.retryAllFailedSyncs()} style={{ marginTop: 10 }}>
              Retry All Failed
            </Button>
          ) : null}
          {state.buildxact.manualReview?.length ? (
            <Card title="Manual Review" icon={Icons.alert} style={{ marginTop: 10 }}>
              <DataTable
                storageKey="buildxact-manual-review"
                rows={state.buildxact.manualReview}
                columns={[
                  { key: "type", label: "Type", filterable: true },
                  { key: "reference", label: "Reference", filterable: true },
                  { key: "reason", label: "Reason", filterable: true },
                  { key: "createdAt", label: "Created", type: "date", filterable: true },
                ]}
              />
            </Card>
          ) : null}
        </Card>
      ) : null}

      <Modal open={Boolean(payloadPreview)} close={() => setPayloadPreview(null)} title="Outbound Payload Preview" wide>
        {payloadPreview ? (
          <>
            <div className="linked-row">
              <div>
                <div className="b sm">{payloadPreview.type}</div>
                <div className="xs ct3">{payloadPreview.reference}</div>
              </div>
              <div className="fx" style={{ gap: 6 }}>
                <Button small onClick={() => downloadJson(payloadPreview.reference, payloadPreview.current)}>
                  Download
                </Button>
                <Button small tone="bt-p" onClick={() => copyJson(payloadPreview.current)}>
                  Copy JSON
                </Button>
              </div>
            </div>
            <div className="payload-grid">
              <pre>{JSON.stringify(payloadPreview.current, null, 2)}</pre>
              <pre>{JSON.stringify(payloadPreview.previous, null, 2)}</pre>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
