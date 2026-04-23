import { useMemo, useState } from "react";
import { useSiteForge } from "../services/siteforgeStore";
import { can } from "../services/permissions";
import DataTable from "../components/DataTable";
import { Badge, Button, Card, MetricGrid, RestrictedPanel, Tabs } from "../components/ui";
import { Icons } from "../components/icons";

export default function PresencePage() {
  const { state, actions } = useSiteForge();
  const role = state.session.role;
  const siteId = state.session.siteId;
  const canView = can(role, "presence.view");
  const canResolve = can(role, "presence.resolve_anomaly");
  const [tab, setTab] = useState("overview");

  const records = useMemo(
    () => state.presence.records.filter((record) => (role === "Director" ? true : record.siteId === siteId)),
    [role, siteId, state.presence.records],
  );
  const anomalies = records.filter((record) => record.anomalyFlags?.length);
  const timeline = state.presence.events.filter((event) => (role === "Director" ? true : event.siteId === siteId)).slice(0, 10);
  const payrollExports = state.presence.exports.filter((entry) => (role === "Director" ? true : entry.siteId === siteId));
  const metrics = [
    { label: "Verified On Site", value: records.filter((record) => record.status === "verified-on-site").length, color: "g" },
    { label: "Anomalies", value: anomalies.length, color: "r" },
    { label: "Payroll Confidence", value: `${Math.round(records.reduce((sum, record) => sum + record.confidence, 0) / Math.max(1, records.length))}%`, color: "b" },
    { label: "Exports", value: payrollExports.length, color: "a" },
  ];

  if (!canView) {
    return <RestrictedPanel title="Attendance Intelligence" body="This role does not have access to disclosed presence verification." />;
  }

  return (
    <div className="oy fin">
      <div className="banner-info">
        <div className="b sm">Disclosed presence verification</div>
        <div className="xs ct2" style={{ marginTop: 4 }}>
          Presence verification is permission-based and used only for payroll confidence, attendance validation, and anomaly detection.
        </div>
      </div>

      <MetricGrid columns={4} items={metrics} />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview", label: "Overview" },
          { value: "anomaly", label: "Anomaly Dashboard" },
          { value: "timeline", label: "Attendance Timeline" },
          { value: "privacy", label: "Privacy Settings" },
        ]}
      />

      {tab === "overview" ? (
        <div className="g32">
          <Card title="Attendance Intelligence" icon={Icons.eye}>
            <DataTable
              storageKey={`presence-records-${role}-${siteId}`}
              rows={records}
              columns={[
                {
                  key: "person",
                  label: "Person",
                  filterable: true,
                  render: (_, record) => (
                    <div>
                      <div className="b">{record.person}</div>
                      <div className="xs ct3">{record.siteId}</div>
                    </div>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  filterable: true,
                  options: [...new Set(records.map((record) => record.status))],
                  render: (value) => <Badge tone={value === "verified-on-site" ? "passed" : "high"}>{value}</Badge>,
                },
                {
                  key: "signals",
                  label: "Signals",
                  accessor: (record) => record.signals.join(", "),
                  filterable: true,
                },
                {
                  key: "confidence",
                  label: "Confidence",
                  type: "number",
                  filterable: true,
                  render: (value) => <span className="mono xs">{value}%</span>,
                },
                {
                  key: "payrollState",
                  label: "Payroll",
                  filterable: true,
                  options: [...new Set(records.map((record) => record.payrollState))],
                  render: (value) => (
                    <Badge tone={value === "ready" ? "passed" : value === "hold" ? "critical" : "medium"}>{value}</Badge>
                  ),
                },
              ]}
              rowActions={[
                {
                  label: "Verify",
                  tone: "bt-g",
                  onClick: (record) => actions.resolvePresence(record.id, "verify", "Verified by supervisor review."),
                  when: () => canResolve,
                },
                {
                  label: "Hold",
                  tone: "bt-r",
                  onClick: (record) => actions.resolvePresence(record.id, "hold", "Hold for payroll review."),
                  when: () => canResolve,
                },
              ]}
              bulkActions={[
                {
                  label: "Mark Ready",
                  tone: "bt-g",
                  onClick: (ids) => ids.forEach((id) => actions.resolvePresence(id, "verify", "Bulk verified from overview.")),
                },
              ]}
            />
          </Card>

          <div>
            <Card title="Anomaly Dashboard" icon={Icons.alert} className="mb8">
              <div className="list-stack">
                {anomalies.map((record) => (
                  <div className="act" key={record.id}>
                    <div style={{ flex: 1 }}>
                      <div className="b sm">{record.person}</div>
                      <div className="xs ct3">{record.anomalyFlags.join(" · ")}</div>
                      <div className="sm ct2" style={{ marginTop: 4 }}>
                        {record.supervisorNotes}
                      </div>
                    </div>
                    <Badge tone="critical">{record.confidence}%</Badge>
                  </div>
                ))}
              </div>
              <Button tone="bt-p" icon={Icons.bell} onClick={() => actions.triggerPresenceDigest()} style={{ marginTop: 10 }}>
                Send Daily Digest
              </Button>
            </Card>

            <Card title="Payroll Confidence Export" icon={Icons.download}>
              <div className="list-stack">
                {payrollExports.map((entry) => (
                  <div className="linked-row" key={entry.id}>
                    <div>
                      <div className="b sm">{entry.period}</div>
                      <div className="xs ct3">
                        Verified {entry.verifiedHours}h · Flagged {entry.flaggedHours}h
                      </div>
                    </div>
                    <Badge tone={entry.confidence >= 85 ? "passed" : "high"}>{entry.confidence}%</Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "anomaly" ? (
        <Card title="Anomaly Dashboard" icon={Icons.alert} style={{ marginTop: 10 }}>
          <div className="list-stack">
            {anomalies.map((record) => (
              <div className="act" key={record.id}>
                <div style={{ flex: 1 }}>
                  <div className="b sm">{record.person}</div>
                  <div className="xs ct3">{record.anomalyFlags.join(" · ")}</div>
                  <div className="sm ct2" style={{ marginTop: 4 }}>{record.supervisorNotes}</div>
                </div>
                <div className="fx" style={{ gap: 6 }}>
                  <Badge tone="critical">{record.confidence}%</Badge>
                  {canResolve ? (
                    <Button small tone="bt-g" onClick={() => actions.resolvePresence(record.id, "verify", "Verified from anomaly dashboard.")}>
                      Resolve
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === "timeline" ? (
        <Card title="Attendance Timeline" icon={Icons.clock} style={{ marginTop: 10 }}>
          <DataTable
            storageKey={`presence-timeline-${role}-${siteId}`}
            rows={timeline}
            columns={[
              { key: "signal", label: "Signal", filterable: true },
              { key: "at", label: "At", filterable: true, type: "date" },
              { key: "note", label: "Note", filterable: true },
              {
                key: "state",
                label: "State",
                filterable: true,
                options: [...new Set(timeline.map((event) => event.state))],
                render: (value) => <Badge tone={value === "inside" || value === "captured" ? "passed" : "critical"}>{value}</Badge>,
              },
            ]}
          />
        </Card>
      ) : null}

      {tab === "privacy" ? (
        <Card title="Privacy Settings" icon={Icons.shield} style={{ marginTop: 10 }}>
          <div className="sm ct2" style={{ lineHeight: 1.7 }}>
            {state.presence.privacy.note}
          </div>
          <div className="linked-row" style={{ marginTop: 12 }}>
            <div>
              <div className="b sm">Retention</div>
              <div className="xs ct3">Attendance signal retention window</div>
            </div>
            <Badge tone="medium">{state.presence.privacy.retentionDays} days</Badge>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">Mode</div>
              <div className="xs ct3">Disclosure model</div>
            </div>
            <Badge tone="passed">{state.presence.privacy.mode}</Badge>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
