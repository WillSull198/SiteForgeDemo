import React, { useMemo, useState } from "react";
import { Icons, renderIcon } from "../../components/icons";
import { Badge, Button, Card, DetailHeader, MetricGrid, QrBadge, RestrictedPanel, Tabs } from "../../components/ui";

const ADMIN_ROLES = new Set(["Supervisor", "Project Manager", "Director"]);

export function SitePassportPage({ store }) {
  const { data, actions, derived, session } = store;
  const [tab, setTab] = useState("admin");
  const [scanTarget, setScanTarget] = useState(session.activePassportId);
  const siteAccess = data.passport.siteAccess.find((entry) => entry.siteId === derived.site.id);
  const passports = data.passport.passports.filter((entry) => entry.siteId === derived.site.id);
  const selected = passports.find((entry) => entry.id === session.activePassportId) || passports[0];
  const lastScan = data.passport.scanEvents.find((event) => event.passportId === scanTarget && event.siteId === derived.site.id);
  const canAdmin = ADMIN_ROLES.has(session.role);

  const complianceCounts = useMemo(
    () => ({
      complete: passports.filter((entry) => entry.inductionStatus === "complete" && entry.blockedReasons.length === 0).length,
      blocked: passports.filter((entry) => entry.blockedReasons.length > 0).length,
      conditional: passports.filter((entry) => entry.requiredAcknowledgements.some((ack) => !ack.done) && entry.blockedReasons.length === 0).length,
    }),
    [passports],
  );

  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "Passport Profiles", value: passports.length, color: "b" },
          { label: "Compliant", value: complianceCounts.complete, color: "g" },
          { label: "Conditional", value: complianceCounts.conditional, color: "o" },
          { label: "Blocked", value: complianceCounts.blocked, color: "r" },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "admin", label: "Access Admin" },
          { value: "profiles", label: "Passport Profiles" },
          { value: "scan", label: "QR Scan / Check-In" },
        ]}
      />

      {tab === "admin" ? (
        canAdmin ? (
          !siteAccess ? (
            <Card title="Site Access Control" icon={Icons.qr}>
              <div className="ct3 sm empty">No site access policy has been seeded for this project yet.</div>
            </Card>
          ) : (
            <div className="g32">
              <Card title="Site Access Control" icon={Icons.qr}>
                <div className="g2 detail-grid">
                  <div className="detail-pane">
                    <div className="xs ct3">Current site QR</div>
                    <QrBadge code={siteAccess?.qrCode || "N/A"} />
                    <div className="fx" style={{ gap: 5, marginTop: 10 }}>
                      <Badge tone={siteAccess?.rotating ? "low" : "medium"}>{siteAccess?.rotating ? "Rotating" : "Static"}</Badge>
                      <Button small onClick={() => actions.rotateSiteQr(derived.site.id)}>
                        Rotate QR
                      </Button>
                    </div>
                  </div>
                  <div className="detail-pane">
                    <div className="xs ct3">Access Policy</div>
                    <div className="sm ct2" style={{ marginTop: 4 }}>{siteAccess?.accessPolicy}</div>
                    <div className="xs ct3" style={{ marginTop: 10 }}>Required documents</div>
                    <div className="fx" style={{ gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                      {siteAccess?.requiredDocs.map((doc) => (
                        <Badge tone="medium" key={doc}>{doc}</Badge>
                      ))}
                    </div>
                    <div className="xs ct3" style={{ marginTop: 10 }}>Daily brief</div>
                    <div className="sm ct2" style={{ marginTop: 4 }}>{siteAccess?.dailyBrief}</div>
                  </div>
                </div>
              </Card>

              <div className="mb8" />

              <div className="g2">
                <Card title="Compliance Status" icon={Icons.clipboard}>
                  <table>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Role</th>
                        <th>Compliance</th>
                        <th>Access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {passports.map((passport) => (
                        <tr key={passport.id} onClick={() => actions.setActivePassport(passport.id)} style={{ cursor: "pointer" }}>
                          <td>
                            <div className="b">{passport.person}</div>
                            <div className="xs ct3">{passport.company}</div>
                          </td>
                          <td className="xs">{passport.role}</td>
                          <td>
                            <Badge tone={passport.blockedReasons.length ? "high" : passport.requiredAcknowledgements.some((ack) => !ack.done) ? "medium" : "low"}>
                              {passport.blockedReasons.length ? "blocked" : passport.requiredAcknowledgements.some((ack) => !ack.done) ? "conditional" : "complete"}
                            </Badge>
                          </td>
                          <td className="xs">{passport.accessLevel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>

                <Card title="Emergency Information" icon={Icons.alert}>
                  <div className="list-stack">
                    {siteAccess?.emergencyContacts.map((entry) => (
                      <div className="linked-row" key={entry.label}>
                        <div>
                          <div className="xs ct3">{entry.label}</div>
                          <div className="b sm">{entry.value}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="xs ct3" style={{ marginTop: 10 }}>Active alerts</div>
                  <div className="fx" style={{ gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                    {siteAccess?.alerts.map((alert) => (
                      <Badge tone="high" key={alert}>{alert}</Badge>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )
        ) : (
          <RestrictedPanel title="Site access administration" body="Supervisor, PM, and director roles can manage QR rotation and site access policy." />
        )
      ) : null}

      {tab === "profiles" ? <PassportProfiles store={store} passports={passports} selected={selected} /> : null}
      {tab === "scan" ? <ScanScreen store={store} passports={passports} siteAccess={siteAccess} scanTarget={scanTarget} setScanTarget={setScanTarget} lastScan={lastScan} /> : null}
    </div>
  );
}

function PassportProfiles({ store, passports, selected }) {
  const { actions } = store;

  return (
    <div className="g32">
      <Card title="Profiles" icon={Icons.users}>
        <div className="list-stack">
          {passports.map((passport) => (
            <div className="linked-row clickable" key={passport.id} onClick={() => actions.setActivePassport(passport.id)}>
              <div>
                <div className="b sm">{passport.person}</div>
                <div className="act-t">{passport.company} · {passport.role}</div>
              </div>
              <Badge tone={passport.blockedReasons.length ? "high" : passport.requiredAcknowledgements.some((ack) => !ack.done) ? "medium" : "low"}>
                {passport.blockedReasons.length ? "blocked" : passport.requiredAcknowledgements.some((ack) => !ack.done) ? "conditional" : "clear"}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
      <div>
        {selected ? (
          <>
            <Card className="mb8">
              <DetailHeader
                title={selected.person}
                subtitle={`${selected.company} · ${selected.role} · ${selected.trade}`}
                badges={[
                  { tone: selected.inductionStatus === "complete" ? "low" : "high", label: `induction ${selected.inductionStatus}` },
                  { tone: selected.insuranceStatus === "current" || selected.insuranceStatus === "n/a" ? "low" : "high", label: `insurance ${selected.insuranceStatus}` },
                  { tone: selected.accessLevel === "full" ? "low" : "medium", label: selected.accessLevel },
                ]}
              />
              <div className="g2 detail-grid">
                <div className="detail-pane">
                  <div className="xs ct3">Site access permissions</div>
                  <div className="fx" style={{ gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                    {selected.permissions.map((permission) => (
                      <Badge tone="medium" key={permission}>{permission}</Badge>
                    ))}
                  </div>
                  <div className="xs ct3" style={{ marginTop: 10 }}>Tickets / licences</div>
                  <div className="sm ct2" style={{ marginTop: 4 }}>{selected.tickets.join(", ") || "None recorded"}</div>
                  <div className="xs ct3" style={{ marginTop: 10 }}>Retention / privacy</div>
                  <div className="sm ct2" style={{ marginTop: 4 }}>
                    Disclosed consent: {selected.consent.disclosed ? "Yes" : "No"} · signed {selected.consent.signedAt} · {selected.consent.retention}
                  </div>
                </div>
                <div className="detail-pane">
                  <div className="xs ct3">Assigned tasks</div>
                  <div className="sm ct2" style={{ marginTop: 4 }}>
                    {selected.assignedTasks.length ? selected.assignedTasks.join(", ") : "No assigned tasks"}
                  </div>
                  <div className="xs ct3" style={{ marginTop: 10 }}>Blocked access reasons</div>
                  <div className="sm ct2" style={{ marginTop: 4 }}>
                    {selected.blockedReasons.length ? selected.blockedReasons.join(", ") : "None"}
                  </div>
                </div>
              </div>
            </Card>

            <div className="g2">
              <Card title="Required Acknowledgements" icon={Icons.check}>
                <div className="list-stack">
                  {selected.requiredAcknowledgements.map((ack) => (
                    <div className="linked-row" key={ack.id}>
                      <div>
                        <div className="b sm">{ack.label}</div>
                        <div className="act-t">{ack.done ? "Acknowledged" : "Outstanding"}</div>
                      </div>
                      {ack.done ? (
                        <Badge tone="low">done</Badge>
                      ) : (
                        <Button small tone="bt-p" onClick={() => actions.acknowledgePassport(selected.id, ack.id)}>
                          Capture
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Compliance Documents" icon={Icons.file}>
                <div className="list-stack">
                  {selected.docs.map((doc) => (
                    <div className="linked-row" key={doc.name}>
                      <div className="b sm">{doc.name}</div>
                      <Badge tone={doc.status === "complete" ? "low" : doc.status === "pending" ? "medium" : "high"}>{doc.status}</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        ) : (
          <Card title="Passport Detail">
            <div className="ct3 sm empty">Select a passport profile.</div>
          </Card>
        )}
      </div>
    </div>
  );
}

function ScanScreen({ store, passports, siteAccess, scanTarget, setScanTarget, lastScan }) {
  const { actions } = store;
  const selected = passports.find((entry) => entry.id === scanTarget) || passports[0];

  if (!siteAccess || passports.length === 0 || !selected) {
    return (
      <Card title="QR Check-In" icon={Icons.qr}>
        <div className="ct3 sm empty">No passport profiles or QR access settings are available for this site yet.</div>
      </Card>
    );
  }

  return (
    <div className="g23">
      <div>
        <Card title="QR Check-In" icon={Icons.qr}>
          <div className="g2 detail-grid">
            <div className="detail-pane">
              <div className="xs ct3">Scan target</div>
              <select value={scanTarget || ""} onChange={(event) => setScanTarget(event.target.value)} style={{ marginTop: 6 }}>
                {passports.map((passport) => (
                  <option key={passport.id} value={passport.id}>
                    {passport.person} · {passport.role}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: 10 }}>
                <QrBadge code={siteAccess?.qrCode || "N/A"} />
              </div>
              <div className="fa" style={{ justifyContent: "flex-start", marginTop: 10 }}>
                <Button tone="bt-p" onClick={() => actions.scanPassport({ passportId: selected.id, siteId: selected.siteId })}>
                  Scan / Check In
                </Button>
              </div>
            </div>
            <div className="detail-pane">
              <div className="xs ct3">Daily brief</div>
              <div className="sm ct2" style={{ marginTop: 4 }}>{siteAccess?.dailyBrief}</div>
              <div className="xs ct3" style={{ marginTop: 10 }}>Emergency contacts</div>
              <div className="list-stack" style={{ marginTop: 6 }}>
                {siteAccess?.emergencyContacts.map((contact) => (
                  <div className="linked-row" key={contact.label}>
                    <div>
                      <div className="xs ct3">{contact.label}</div>
                      <div className="b sm">{contact.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div>
        <Card title="Access Result" icon={Icons.login} className="mb8">
          {selected ? (
            <>
              <DetailHeader
                title={selected.person}
                subtitle={`${selected.company} · ${selected.role}`}
                badges={[
                  { tone: selected.blockedReasons.length ? "high" : selected.requiredAcknowledgements.some((ack) => !ack.done) ? "medium" : "low", label: selected.blockedReasons.length ? "access denied" : selected.requiredAcknowledgements.some((ack) => !ack.done) ? "conditional access" : "clear to enter" },
                ]}
              />
              <div className="sm ct2">
                {selected.blockedReasons.length
                  ? `Access blocked because ${selected.blockedReasons.join(", ")}.`
                  : selected.requiredAcknowledgements.some((ack) => !ack.done)
                    ? "Access is conditional. Required acknowledgements remain outstanding."
                    : "All required documents are complete and role-based information has been released."}
              </div>
              <div className="xs ct3" style={{ marginTop: 10 }}>Role-based information delivery</div>
              <div className="fx" style={{ gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                {selected.permissions.map((permission) => (
                  <Badge tone="medium" key={permission}>{permission}</Badge>
                ))}
              </div>
            </>
          ) : (
            <div className="ct3 sm empty">Select a profile to scan.</div>
          )}
        </Card>
        <Card title="Latest Scan Event" icon={Icons.clock}>
          {lastScan ? (
            <div className="list-stack">
              <div className="draft-row">
                <div className="xs ct3">Result</div>
                <div className="sm ct2">
                  <Badge tone={lastScan.result === "granted" ? "low" : lastScan.result === "conditional" ? "medium" : "high"}>{lastScan.result}</Badge>
                </div>
              </div>
              <div className="draft-row">
                <div className="xs ct3">Timestamp</div>
                <div className="sm ct2">{lastScan.at}</div>
              </div>
              <div className="draft-row">
                <div className="xs ct3">QR code</div>
                <div className="sm ct2 mono">{lastScan.qr}</div>
              </div>
            </div>
          ) : (
            <div className="ct3 sm empty">No scan recorded yet for this person.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
