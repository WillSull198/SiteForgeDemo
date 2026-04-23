import { useMemo, useState } from "react";
import { APP_CONFIG } from "../data/seedData";
import { Icons } from "../components/icons";
import DataTable from "../components/DataTable";
import { Badge, Button, Card, MetricGrid, Modal, RestrictedPanel, Tabs } from "../components/ui";
import { useSiteForge } from "../services/siteforgeStore";
import { can } from "../services/permissions";

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
  const [tab, setTab] = useState("teams");
  const [payloadPreview, setPayloadPreview] = useState(null);

  const metrics = [
    { label: "Teams Events", value: state.notifications.eventLog.length, color: "b" },
    { label: "Queued Syncs", value: state.buildxact.queue.filter((item) => item.status === "pending").length, color: "a" },
    { label: "Sync Errors", value: state.buildxact.syncHistory.filter((item) => item.status === "error").length, color: "r" },
    { label: "Buildxact", value: state.buildxact.connection.status, color: "g" },
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
          { value: "teams", label: "Teams Action Layer" },
          { value: "buildxact", label: "Buildxact Connector" },
          { value: "history", label: "Sync History" },
        ]}
      />

      {tab === "teams" ? (
        <div className="g2">
          <Card title="Teams Notification Centre" icon={Icons.chat}>
            <DataTable
              storageKey="teams-event-log"
              rows={state.notifications.eventLog}
              columns={[
                { key: "title", label: "Event", filterable: true },
                { key: "channel", label: "Channel", filterable: true, options: [...new Set(state.notifications.eventLog.map((event) => event.channel))] },
                { key: "at", label: "At", filterable: true, type: "date" },
                {
                  key: "status",
                  label: "Status",
                  filterable: true,
                  options: [...new Set(state.notifications.eventLog.map((event) => event.status))],
                  render: (value) => <Badge tone={value === "queued" ? "medium" : "passed"}>{value}</Badge>,
                },
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
              ]}
            />
          </Card>
        </div>
      ) : null}

      {tab === "buildxact" ? (
        <div className="g32" style={{ marginTop: 10 }}>
          <Card title="Buildxact Settings" icon={Icons.gear}>
            <div className="g2">
              <div className="ff">
                <label>Connection Status</label>
                <div className="linked-row">
                  <div>
                    <div className="b sm">{state.buildxact.connection.status}</div>
                    <div className="xs ct3">Workspace {state.buildxact.connection.workspaceId}</div>
                  </div>
                  <Button small tone="bt-p" onClick={() => actions.testBuildxactConnection()}>
                    Test
                  </Button>
                </div>
              </div>
              <div className="ff">
                <label>API Key</label>
                <input
                  value={state.buildxact.connection.apiKeyMasked}
                  onChange={(event) => actions.updateBuildxactSettings({ connection: { apiKeyMasked: event.target.value } })}
                />
              </div>
            </div>
            <div className="g2">
              {Object.entries(state.buildxact.toggles).map(([key, enabled]) => (
                <div className="linked-row" key={key}>
                  <div>
                    <div className="b sm">{key}</div>
                    <div className="xs ct3">Sync frequency {state.buildxact.syncFrequency[key]}</div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => actions.updateBuildxactSettings({ toggles: { [key]: event.target.checked } })}
                    />
                    <span />
                  </label>
                </div>
              ))}
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
                    label: "Trigger",
                    onClick: (item) => actions.triggerSyncQueueItem(item.id),
                    when: (item) => item.status === "pending",
                  },
                ]}
              />
            </Card>

            <Card title="Cost Code Mapping" icon={Icons.box}>
              <div className="list-stack">
                {APP_CONFIG.costCodes.map((code) => (
                  <div className="linked-row" key={code.local}>
                    <div>
                      <div className="b sm">{code.local}</div>
                      <div className="xs ct3">{code.remote}</div>
                    </div>
                    <Badge tone="passed">Mapped</Badge>
                  </div>
                ))}
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
