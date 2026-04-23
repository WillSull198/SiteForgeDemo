import React, { useState } from "react";
import { Icons, renderIcon } from "../../components/icons";
import { Badge, Button, Card, DetailHeader, MetricGrid, RestrictedPanel, Tabs, Timeline } from "../../components/ui";

const VIEW_ROLES = new Set(["Supervisor", "Project Manager", "Director"]);

export function PresencePage({ store }) {
  const { data, derived, session, actions } = store;
  const [tab, setTab] = useState("overview");
  const [overrideNote, setOverrideNote] = useState("");

  if (!VIEW_ROLES.has(session.role)) {
    return (
      <RestrictedPanel
        title="Attendance Intelligence"
        body="Presence verification is available only to approved supervisory roles because it contains payroll-confidence and attendance exception data."
      />
    );
  }

  const attendance = data.presence.attendance.filter((entry) => entry.siteId === derived.site.id);
  const selected = attendance.find((entry) => entry.id === session.activePresenceId) || attendance[0];
  const events = data.presence.events.filter((event) => event.siteId === derived.site.id && event.person === selected?.person);

  return (
    <div className="oy fin">
      <MetricGrid
        columns={5}
        items={[
          { label: "Verified", value: attendance.filter((entry) => entry.status === "verified-on-site").length, color: "g" },
          { label: "Exceptions", value: attendance.filter((entry) => entry.anomalies.length > 0).length, color: "r" },
          { label: "Payroll Ready", value: attendance.filter((entry) => entry.payrollState === "ready").length, color: "b" },
          { label: "Review Hold", value: attendance.filter((entry) => entry.payrollState !== "ready").length, color: "o" },
          { label: "Consent Mode", value: data.presence.privacy.mode === "disclosed-consent" ? "Disclosed" : "Review", color: "p" },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview", label: "Overview" },
          { value: "anomalies", label: "Anomalies" },
          { value: "payroll", label: "Payroll Confidence" },
          { value: "privacy", label: "Privacy" },
        ]}
      />

      {tab === "overview" ? (
        <div className="g32">
          <Card title="Attendance Confidence" icon={Icons.eye}>
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Status</th>
                  <th>Signals</th>
                  <th>Confidence</th>
                  <th>Payroll</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((entry) => (
                  <tr key={entry.id} onClick={() => actions.setActivePresence(entry.id)} style={{ cursor: "pointer", background: selected?.id === entry.id ? "var(--s2)" : "" }}>
                    <td>
                      <div className="b">{entry.person}</div>
                      <div className="xs ct3">{entry.supervisorNotes}</div>
                    </td>
                    <td>
                      <Badge tone={entry.confidence > 80 ? "low" : entry.confidence > 60 ? "medium" : "high"}>{entry.status}</Badge>
                    </td>
                    <td className="xs">{entry.signals.join(", ")}</td>
                    <td className="mono b">{entry.confidence}%</td>
                    <td><Badge tone={entry.payrollState === "ready" ? "low" : entry.payrollState === "review" ? "medium" : "high"}>{entry.payrollState}</Badge></td>
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
                    title={selected.person}
                    subtitle={`${selected.status} · ${selected.confidence}% confidence`}
                    badges={[
                      { tone: selected.confidence > 80 ? "low" : selected.confidence > 60 ? "medium" : "high", label: `${selected.confidence}% confidence` },
                      { tone: selected.payrollState === "ready" ? "low" : selected.payrollState === "review" ? "medium" : "high", label: selected.payrollState },
                    ]}
                    actions={[
                      { label: "Supervisor Override", tone: "bt-p", small: true, onClick: () => actions.addPresenceOverride(selected.id, overrideNote || "Supervisor confirmed presence on site.") },
                    ]}
                  />
                  <div className="xs ct3">Exception notes</div>
                  <div className="sm ct2" style={{ marginTop: 4 }}>{selected.anomalies.length ? selected.anomalies.join(" · ") : "No anomalies."}</div>
                  <div className="mi" style={{ marginTop: 10 }}>
                    <input value={overrideNote} onChange={(event) => setOverrideNote(event.target.value)} placeholder="Add disclosed supervisor note..." />
                    <Button small tone="bt-p" onClick={() => actions.addPresenceOverride(selected.id, overrideNote || "Supervisor confirmed presence on site.")}>
                      Apply
                    </Button>
                  </div>
                </Card>
                <Card title="Attendance Timeline" icon={Icons.clock}>
                  <Timeline
                    entries={events.map((event) => ({
                      at: event.at,
                      actor: event.signal,
                      role: event.state,
                      text: event.value,
                    }))}
                  />
                </Card>
              </>
            ) : (
              <Card title="Attendance Detail">
                <div className="ct3 sm empty">Select an attendance record.</div>
              </Card>
            )}
          </div>
        </div>
      ) : null}

      {tab === "anomalies" ? <AnomalyDashboard attendance={attendance} onSelect={actions.setActivePresence} /> : null}
      {tab === "payroll" ? <PayrollConfidence store={store} attendance={attendance} /> : null}
      {tab === "privacy" ? <PrivacyPanel store={store} /> : null}
    </div>
  );
}

function AnomalyDashboard({ attendance, onSelect }) {
  return (
    <div className="g2">
      <Card title="Exception List" icon={Icons.alert}>
        <div className="list-stack">
          {attendance.filter((entry) => entry.anomalies.length > 0).map((entry) => (
            <div className="linked-row clickable" key={entry.id} onClick={() => onSelect(entry.id)}>
              <div>
                <div className="b sm">{entry.person}</div>
                <div className="act-t">{entry.anomalies.join(" · ")}</div>
              </div>
              <Badge tone={entry.confidence < 60 ? "high" : "medium"}>{entry.confidence}%</Badge>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Anomaly Logic" icon={Icons.link}>
        <div className="list-stack">
          <div className="draft-row">
            <div className="xs ct3">Signed in but not verified</div>
            <div className="sm ct2">Sign-in captured without geofence, beacon, or disclosed supervisor override.</div>
          </div>
          <div className="draft-row">
            <div className="xs ct3">Present but not signed in</div>
            <div className="sm ct2">Spatial signal exists without a sign-in event, prompting attendance reconciliation.</div>
          </div>
          <div className="draft-row">
            <div className="xs ct3">Left before sign-out</div>
            <div className="sm ct2">Boundary exit or missing follow-up signal indicates an incomplete attendance trail.</div>
          </div>
          <div className="draft-row">
            <div className="xs ct3">Overlapping presence</div>
            <div className="sm ct2">Two site presence windows overlap and require foreman confirmation before payroll release.</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PayrollConfidence({ store, attendance }) {
  const { data, actions } = store;

  return (
    <div className="g23">
      <Card title="Payroll Export State" icon={Icons.download}>
        <table>
          <thead>
            <tr>
              <th>Week</th>
              <th>State</th>
              <th>Ready</th>
              <th>Review</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.presence.exports.map((entry) => (
              <tr key={entry.id}>
                <td className="mono b">{entry.week}</td>
                <td><Badge tone={entry.state === "sent" ? "low" : entry.state === "draft" ? "medium" : "high"}>{entry.state}</Badge></td>
                <td className="mono">{entry.readyCount}</td>
                <td className="mono">{entry.reviewCount}</td>
                <td>
                  <div className="fx" style={{ gap: 3, flexWrap: "wrap" }}>
                    <Button small onClick={() => actions.markPayrollExport(entry.id, "draft")}>Draft</Button>
                    <Button small tone="bt-g" onClick={() => actions.markPayrollExport(entry.id, "queued")}>Queue</Button>
                    <Button small tone="bt-p" onClick={() => actions.markPayrollExport(entry.id, "sent")}>Send</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Confidence Rules" icon={Icons.bar}>
        <div className="info-grid">
          <div className="info-row">
            <span className="ct3 xs">Average confidence</span>
            <span className="mono b">{Math.round(attendance.reduce((sum, entry) => sum + entry.confidence, 0) / attendance.length)}%</span>
          </div>
          <div className="info-row">
            <span className="ct3 xs">Ready for payroll</span>
            <span className="mono b cgn">{attendance.filter((entry) => entry.payrollState === "ready").length}</span>
          </div>
          <div className="info-row">
            <span className="ct3 xs">Review required</span>
            <span className="mono b cam">{attendance.filter((entry) => entry.payrollState !== "ready").length}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PrivacyPanel({ store }) {
  const { data, actions } = store;
  const privacy = data.presence.privacy;

  return (
    <div className="g2">
      <Card title="Privacy Settings" icon={Icons.shield}>
        <div className="list-stack">
          <div className="linked-row">
            <div>
              <div className="b sm">Geofence verification</div>
              <div className="act-t">Used for disclosed attendance confidence only.</div>
            </div>
            <Button small onClick={() => actions.updatePresencePrivacy({ geofence: !privacy.geofence })}>
              {privacy.geofence ? "On" : "Off"}
            </Button>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">BLE / beacon placeholder</div>
              <div className="act-t">Optional disclosed secondary site presence signal.</div>
            </div>
            <Button small onClick={() => actions.updatePresencePrivacy({ beacon: !privacy.beacon })}>
              {privacy.beacon ? "On" : "Off"}
            </Button>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">Retention</div>
              <div className="act-t">{privacy.retentionDays} days</div>
            </div>
            <Button small onClick={() => actions.updatePresencePrivacy({ retentionDays: privacy.retentionDays === 90 ? 60 : 90 })}>
              Toggle
            </Button>
          </div>
        </div>
      </Card>
      <Card title="Disclosure Notice" icon={Icons.book}>
        <div className="sm ct2">{privacy.note}</div>
      </Card>
    </div>
  );
}
