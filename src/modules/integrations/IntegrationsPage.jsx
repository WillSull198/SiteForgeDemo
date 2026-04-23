import React, { useState } from "react";
import { Icons, renderIcon } from "../../components/icons";
import { Badge, Button, Card, MetricGrid, Tabs } from "../../components/ui";

export function IntegrationsPage({ store }) {
  const { data, actions } = store;
  const [tab, setTab] = useState("teams");
  const buildxactErrors = data.buildxact.syncHistory.filter((entry) => entry.state === "error").length;

  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "Teams Notifications", value: data.teamsLayer.notifications.length, color: "b" },
          { label: "Open Escalations", value: data.teamsLayer.escalationQueue.filter((entry) => entry.status !== "closed").length, color: "o" },
          { label: "Buildxact Errors", value: buildxactErrors, color: buildxactErrors ? "r" : "g" },
          { label: "Outbound Actions", value: data.teamsLayer.outboundLog.length, color: "p" },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "teams", label: "Teams Action Layer" },
          { value: "buildxact", label: "Buildxact Connector" },
          { value: "settings", label: "Integration Settings" },
        ]}
      />

      {tab === "teams" ? <TeamsActionLayer teamsLayer={data.teamsLayer} /> : null}
      {tab === "buildxact" ? <BuildxactConnector store={store} actions={actions} /> : null}
      {tab === "settings" ? <IntegrationSettings store={store} /> : null}
    </div>
  );
}

function TeamsActionLayer({ teamsLayer }) {
  return (
    <div className="g23">
      <div>
        <Card title="Notification Centre" icon={Icons.chat} className="mb8">
          <table>
            <thead>
              <tr>
                <th>Entity</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {teamsLayer.notifications.map((event) => (
                <tr key={event.id}>
                  <td className="sm">{event.summary}</td>
                  <td className="xs">{event.channel}</td>
                  <td><Badge tone={event.status === "sent" ? "low" : event.status === "escalated" ? "high" : "medium"}>{event.status}</Badge></td>
                  <td className="mono xs">{event.sentAt || "Queued"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Outbound Action Log" icon={Icons.send}>
          <table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Adapter</th>
                <th>Entity</th>
                <th>State</th>
                <th>At</th>
              </tr>
            </thead>
            <tbody>
              {teamsLayer.outboundLog.map((entry) => (
                <tr key={entry.id}>
                  <td className="b sm">{entry.target}</td>
                  <td className="xs">{entry.adapter}</td>
                  <td className="xs">{entry.entityType} · {entry.entityId}</td>
                  <td><Badge tone={entry.state === "success" ? "low" : entry.state === "queued" ? "medium" : "high"}>{entry.state}</Badge></td>
                  <td className="mono xs">{entry.at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card title="Escalation Queue" icon={Icons.alert}>
        <div className="list-stack">
          {teamsLayer.escalationQueue.map((entry) => (
            <div className="linked-row" key={entry.id}>
              <div>
                <div className="b sm">{entry.reason}</div>
                <div className="act-t">{entry.entityType} · {entry.entityId} · owner {entry.owner}</div>
                <div className="xs ct2" style={{ marginTop: 2 }}>{entry.nextAction}</div>
              </div>
              <Badge tone={entry.status === "open" ? "high" : "medium"}>{entry.status}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function BuildxactConnector({ store, actions }) {
  const { data } = store;
  return (
    <div className="g23">
      <div>
        <Card title="Outbound Payload Previews" icon={Icons.file} className="mb8">
          <div className="list-stack">
            {data.buildxact.outboundPayloads.map((payload) => (
              <div className="payload-preview" key={payload.id}>
                <div className="fb">
                  <div className="b sm">{payload.type}</div>
                  <div className="xs ct3">entity {payload.entityId}</div>
                </div>
                <pre>{JSON.stringify(payload.preview, null, 2)}</pre>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Sync History" icon={Icons.shuffle}>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>State</th>
                <th>Retries</th>
                <th>Message</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.buildxact.syncHistory.map((entry) => (
                <tr key={entry.id}>
                  <td className="b sm">{entry.type}</td>
                  <td><Badge tone={entry.state === "success" ? "low" : entry.state === "queued" ? "medium" : "high"}>{entry.state}</Badge></td>
                  <td className="mono">{entry.retries}</td>
                  <td className="xs">{entry.message}</td>
                  <td>
                    {entry.state === "error" ? (
                      <Button small tone="bt-p" onClick={() => actions.retryBuildxactSync(entry.id)}>
                        Retry
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card title="Connector Settings" icon={Icons.gear}>
        <div className="list-stack">
          {Object.entries(data.buildxact.settings).map(([key, value]) => (
            <div className="linked-row" key={key}>
              <div>
                <div className="b sm">{key}</div>
                <div className="act-t">{Array.isArray(value) ? "mapping set" : String(value)}</div>
              </div>
              <Badge tone={typeof value === "boolean" ? (value ? "low" : "high") : "medium"}>{typeof value === "boolean" ? (value ? "enabled" : "disabled") : "configured"}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function IntegrationSettings({ store }) {
  const { data } = store;
  return (
    <div className="g2">
      <Card title="Adapters" icon={Icons.link}>
        <div className="list-stack">
          <div className="linked-row">
            <div>
              <div className="b sm">Email Adapter</div>
              <div className="act-t">emailAdapter.queueClientSummary</div>
            </div>
            <Badge tone="low">ready</Badge>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">Teams Adapter</div>
              <div className="act-t">teamsAdapter.sendApprovalSummary / escalate</div>
            </div>
            <Badge tone="low">ready</Badge>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">E-Sign Adapter</div>
              <div className="act-t">esignAdapter.generateSignaturePack</div>
            </div>
            <Badge tone="medium">mock</Badge>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">Buildxact Adapter</div>
              <div className="act-t">buildxactAdapter.sync / previewVariation / previewLabourExport</div>
            </div>
            <Badge tone="medium">connector</Badge>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">Presence Adapter</div>
              <div className="act-t">presenceAdapter.scoreAttendance</div>
            </div>
            <Badge tone="low">scoring</Badge>
          </div>
        </div>
      </Card>
      <Card title="Integration Summary" icon={Icons.bar}>
        <div className="info-grid">
          <div className="info-row">
            <span className="ct3 xs">Teams notifications</span>
            <span className="mono b">{data.teamsLayer.notifications.length}</span>
          </div>
          <div className="info-row">
            <span className="ct3 xs">Buildxact payloads</span>
            <span className="mono b">{data.buildxact.outboundPayloads.length}</span>
          </div>
          <div className="info-row">
            <span className="ct3 xs">Contract packs</span>
            <span className="mono b">{data.contractPacks.length}</span>
          </div>
          <div className="info-row">
            <span className="ct3 xs">Error states</span>
            <span className="mono b crd">{data.buildxact.syncHistory.filter((entry) => entry.state === "error").length}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
