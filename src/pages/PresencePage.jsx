import { useMemo, useState } from "react";
import { useSiteForge } from "../services/siteforgeStore";
import { can, canSeeAllSites } from "../services/permissions";
import DataTable from "../components/DataTable";
import { Badge, Button, Card, MetricGrid, RestrictedPanel, Tabs } from "../components/ui";
import { Icons } from "../components/icons";

export default function PresencePage() {
  const { state, actions } = useSiteForge();
  const role = state.session.role;
  const siteId = state.session.siteId;
  const canView = can(role, "presence.view");
  const canResolve = can(role, "presence.resolve_anomaly");
  const canExport = can(role, "presence.export_payroll");
  const [tab, setTab] = useState("overview");
  const [noticeForm, setNoticeForm] = useState({
    noticeIssuedAt: new Date().toISOString().slice(0, 10),
    noticeDocumentName: "NSW WSA 2005 presence disclosure notice.pdf",
  });
  const [optOutReason, setOptOutReason] = useState("");

  const records = useMemo(
    () => state.presence.records.filter((record) => (canSeeAllSites(role) ? true : record.siteId === siteId)),
    [role, siteId, state.presence.records],
  );
  const currentUserRecords = records.filter((record) => record.userId === state.session.userId);
  const anomalies = records.filter((record) => record.anomalyFlags?.length);
  const timeline = state.presence.events.filter((event) => (canSeeAllSites(role) ? true : event.siteId === siteId)).slice(0, 10);
  const payrollExports = state.presence.exports.filter((entry) => (canSeeAllSites(role) ? true : entry.siteId === siteId));
  const complianceRows = state.presence.siteCompliance.filter((entry) => (canSeeAllSites(role) ? true : entry.siteId === siteId));
  const activeCompliance = state.presence.siteCompliance.find((entry) => entry.siteId === siteId);
  const openReviews = state.presence.reviewQueue.filter((entry) => entry.status === "open" && (canSeeAllSites(role) ? true : entry.siteId === siteId));
  const openChallenges = state.presence.challenges.filter((entry) => entry.status === "open" && (canSeeAllSites(role) ? true : entry.siteId === siteId));
  const optOutRequests = state.presence.optOutRequests.filter((entry) => ["review", "compliance-review"].includes(entry.status) && (canSeeAllSites(role) ? true : entry.siteId === siteId));
  const metrics = [
    { label: "Verified On Site", value: records.filter((record) => record.status === "verified-on-site").length, color: "g" },
    { label: "Anomalies", value: anomalies.length, color: "r" },
    { label: "Payroll Confidence", value: `${Math.round(records.reduce((sum, record) => sum + record.confidence, 0) / Math.max(1, records.length))}%`, color: "b" },
    { label: "Compliance Reviews", value: openReviews.length + openChallenges.length + optOutRequests.length, color: "a" },
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
          { value: "compliance", label: "Compliance Gate" },
          { value: "anomaly", label: "Anomaly Dashboard" },
          { value: "exports", label: "Payroll Export" },
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
                {
                  label: "Close record",
                  tone: "bt-s",
                  onClick: (record) => actions.signOutPresence({ recordId: record.id, manualClose: true }),
                  when: (record) => canResolve && !record.finish,
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
              {canExport ? (
                <Button tone="bt-p" icon={Icons.download} onClick={() => actions.generatePresencePayrollExport({ siteId })} style={{ marginTop: 10 }}>
                  Generate Evidence Export
                </Button>
              ) : null}
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "compliance" ? (
        <div className="g32">
          <Card title="14-day notice gate" icon={Icons.shield} style={{ marginTop: 10 }}>
            <div className="form-grid two">
              <label className="form-group">
                <span className="form-label">Notice issued date</span>
                <input
                  className="form-input"
                  type="date"
                  value={noticeForm.noticeIssuedAt}
                  onChange={(event) => setNoticeForm((current) => ({ ...current, noticeIssuedAt: event.target.value }))}
                />
              </label>
              <label className="form-group">
                <span className="form-label">Notice document</span>
                <input
                  className="form-input"
                  value={noticeForm.noticeDocumentName}
                  onChange={(event) => setNoticeForm((current) => ({ ...current, noticeDocumentName: event.target.value }))}
                />
              </label>
            </div>
            <div className="linked-row">
              <div>
                <div className="b sm">Current site status</div>
                <div className="xs ct3">
                  Activation date: {activeCompliance?.activationDate || "Not issued"} · Notice: {activeCompliance?.noticeDocumentName || "No document"}
                </div>
              </div>
              <Badge tone={activeCompliance?.enabled ? "passed" : activeCompliance?.status === "ready-to-activate" ? "medium" : "high"}>
                {activeCompliance?.status || "not-issued"}
              </Badge>
            </div>
            <div className="fx" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <Button tone="bt-p" icon={Icons.file} onClick={() => actions.configurePresenceNotice(siteId, { ...noticeForm, confirmedNoticeIssued: true })}>
                Record Notice
              </Button>
              <Button tone="bt-g" icon={Icons.check} onClick={() => actions.activatePresenceForSite(siteId)}>
                Activate Presence
              </Button>
              <Button tone="bt-s" icon={Icons.alert} onClick={() => actions.runPresenceAnomalyScan(siteId)}>
                Run Anomaly Scan
              </Button>
            </div>
          </Card>

          <Card title="Compliance dashboard" icon={Icons.eye} style={{ marginTop: 10 }}>
            <DataTable
              storageKey={`presence-compliance-${role}-${siteId}`}
              rows={complianceRows}
              columns={[
                { key: "siteId", label: "Site", filterable: true },
                { key: "status", label: "Status", filterable: true, render: (value) => <Badge tone={value === "active" ? "passed" : "medium"}>{value}</Badge> },
                { key: "noticeIssuedAt", label: "Notice Issued", type: "date", filterable: true },
                { key: "activationDate", label: "Activation", type: "date", filterable: true },
                { key: "noticeDocumentName", label: "Document", filterable: true },
              ]}
            />
            <div className="mini-grid" style={{ marginTop: 12 }}>
              <div className="mini-card"><span>Open anomaly reviews</span><b>{openReviews.length}</b></div>
              <div className="mini-card"><span>Worker challenges</span><b>{openChallenges.length}</b></div>
              <div className="mini-card"><span>Opt-out requests</span><b>{optOutRequests.length}</b></div>
            </div>
          </Card>
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
                    <Button small tone="bt-g" onClick={() => actions.resolvePresence(record.id, "verify", "Verified from anomaly dashboard.", { reason: "Manual compliance review completed." })}>
                      Resolve
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === "exports" ? (
        <Card title="Payroll Evidence Exports" icon={Icons.download} style={{ marginTop: 10 }}>
          <div className="fx" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {canExport ? (
              <Button tone="bt-p" icon={Icons.download} onClick={() => actions.generatePresencePayrollExport({ siteId })}>
                Generate Current Site Export
              </Button>
            ) : null}
            <Button tone="bt-s" icon={Icons.search} onClick={() => actions.runPresenceAnomalyScan(siteId)}>
              Refresh Confidence
            </Button>
          </div>
          <DataTable
            storageKey={`presence-exports-${role}-${siteId}`}
            rows={payrollExports}
            columns={[
              { key: "period", label: "Period", filterable: true },
              { key: "state", label: "State", filterable: true, render: (value) => <Badge tone={value === "ready" ? "passed" : "high"}>{value}</Badge> },
              { key: "verifiedHours", label: "Verified Hours", type: "number", filterable: true },
              { key: "flaggedHours", label: "Flagged Hours", type: "number", filterable: true },
              { key: "confidence", label: "Confidence", type: "number", render: (value) => <span className="mono xs">{value}%</span> },
              { key: "generatedAt", label: "Generated", type: "date", filterable: true },
            ]}
          />
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
          <div className="linked-row">
            <div>
              <div className="b sm">My disclosed records</div>
              <div className="xs ct3">Workers can view captured data and challenge disputed entries.</div>
            </div>
            <Badge tone="medium">{currentUserRecords.length} records</Badge>
          </div>
          <div className="list-stack" style={{ marginTop: 10 }}>
            {currentUserRecords.slice(0, 5).map((record) => (
              <div className="linked-row" key={record.id}>
                <div>
                  <div className="b sm">{record.status}</div>
                  <div className="xs ct3">{record.start || "No timestamp"} · {record.anomalyFlags?.join(" · ") || "No flags"}</div>
                </div>
                <Button small tone="bt-s" onClick={() => actions.challengePresenceRecord(record.id, "Worker challenged this disclosed attendance record.")}>
                  Challenge
                </Button>
              </div>
            ))}
          </div>
          <label className="form-group" style={{ marginTop: 14 }}>
            <span className="form-label">Opt-out review reason</span>
            <textarea
              className="form-textarea"
              value={optOutReason}
              onChange={(event) => setOptOutReason(event.target.value)}
              placeholder="Explain the privacy or operational concern for compliance review."
            />
          </label>
          <div className="fx" style={{ gap: 8, flexWrap: "wrap" }}>
            <Button tone="bt-s" icon={Icons.download} onClick={() => actions.requestPresenceDataExport(state.session.userId, siteId)}>
              Request My Data Export
            </Button>
            <Button tone="bt-r" icon={Icons.shield} onClick={() => actions.requestPresenceOptOut({ siteId, reason: optOutReason })}>
              Request Opt-out Review
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
