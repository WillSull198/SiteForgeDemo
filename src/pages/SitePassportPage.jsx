import { useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import FileDropZone from "../components/FileDropZone";
import { useSiteForge } from "../services/siteforgeStore";
import { Icons } from "../components/icons";
import { Badge, Button, Card, MetricGrid, Modal, QrBadge, Tabs } from "../components/ui";

const callNumber = (value) => {
  const numeric = value.replace(/[^\d+]/g, "");
  if (!numeric) return;
  window.location.href = `tel:${numeric}`;
};

export default function SitePassportPage() {
  const { state, actions } = useSiteForge();
  const role = state.session.role;
  const user = state.users.find((entry) => entry.id === state.session.userId);
  const [tab, setTab] = useState(role === "Subcontractor" ? "passport" : "admin");
  const [scanOpen, setScanOpen] = useState(false);
  const [uploadingPassportId, setUploadingPassportId] = useState(null);
  const [selectedPassportId, setSelectedPassportId] = useState(
    state.passports.records.find((record) => record.userId === state.session.userId && record.siteId === state.session.siteId)?.id || state.passports.records[0]?.id,
  );
  const [typedName, setTypedName] = useState(user?.name || "");
  const [fieldDrafts, setFieldDrafts] = useState({});

  const accessConfig = useMemo(
    () => state.passports.siteAccess.find((entry) => entry.siteId === state.session.siteId) || state.passports.siteAccess[0],
    [state.passports.siteAccess, state.session.siteId],
  );
  const sitePassports = useMemo(
    () => state.passports.records.filter((record) => record.siteId === state.session.siteId),
    [state.passports.records, state.session.siteId],
  );
  const selectedPassport = sitePassports.find((record) => record.id === selectedPassportId) || sitePassports[0] || null;
  const ownPassport = state.passports.records.find((record) => record.userId === state.session.userId && record.siteId === state.session.siteId) || selectedPassport;
  const selectedPassportFiles = useMemo(
    () => state.files.records.filter((file) => file.entityType === "passport" && file.entityId === selectedPassport?.id),
    [selectedPassport?.id, state.files.records],
  );
  const ownPassportFiles = useMemo(
    () => state.files.records.filter((file) => file.entityType === "passport" && file.entityId === ownPassport?.id),
    [ownPassport?.id, state.files.records],
  );
  const expiringQueue = useMemo(() => {
    const passportIds = new Set(sitePassports.map((passport) => passport.id));
    return state.passports.expiringTickets
      .filter((ticket) => passportIds.has(ticket.passportId))
      .map((ticket) => {
        const passport = sitePassports.find((entry) => entry.id === ticket.passportId);
        return {
          ...ticket,
          person: passport?.person || ticket.userId,
          company: passport?.company || "",
          blocked: passport?.blockedReasons.some((reason) => reason.toLowerCase().includes("expired")) || false,
        };
      });
  }, [sitePassports, state.passports.expiringTickets]);
  const adminMetrics = [
    { label: "Granted Today", value: state.passports.scanLog.filter((entry) => entry.result === "granted" && entry.siteId === state.session.siteId).length, color: "g" },
    { label: "Blocked", value: state.passports.scanLog.filter((entry) => entry.result === "blocked" && entry.siteId === state.session.siteId).length, color: "r" },
    { label: "Expiring Tickets", value: expiringQueue.length, color: "a" },
    { label: "Profiles", value: sitePassports.length, color: "b" },
  ];

  const acknowledge = (ackId) => {
    if (!ownPassport) return;
    actions.updatePassportAcknowledgement(ownPassport.id, ackId, typedName);
  };

  const uploadFiles = async (passportId, files) => {
    if (!passportId) return;
    setUploadingPassportId(passportId);
    try {
      await actions.uploadPassportFiles(passportId, files);
    } finally {
      setUploadingPassportId(null);
    }
  };

  const renderFileFields = (file) => {
    const entries = Object.entries(file.parsedFields || {});
    if (!entries.length) {
      return <div className="xs ct3">No extracted fields were found for this upload.</div>;
    }
    return (
      <div className="file-field-grid">
        {entries.map(([key, value]) => {
          const draftKey = `${file.id}:${key}`;
          const displayValue = Array.isArray(value) ? value.join(", ") : value ?? "";
          return (
            <div className="file-field-card" key={draftKey}>
              <div className="xs ct3" style={{ textTransform: "uppercase", letterSpacing: ".08em" }}>
                {key.replace(/([A-Z])/g, " $1")}
              </div>
              <input
                value={fieldDrafts[draftKey] ?? displayValue}
                onChange={(event) => setFieldDrafts((current) => ({ ...current, [draftKey]: event.target.value }))}
              />
              <div className="fa" style={{ marginTop: 8 }}>
                <Button
                  small
                  tone={file.confirmedFields?.[key] ? "bt-g" : "bt-p"}
                  onClick={() => actions.confirmFileField(file.id, key, fieldDrafts[draftKey] ?? displayValue)}
                >
                  {file.confirmedFields?.[key] ? "Confirmed" : "Confirm"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (!user && role === "Subcontractor") {
    return (
      <div className="oy fin">
        <div className="restricted">
          <div className="restricted-badge">Session Recovery</div>
          <div className="b md" style={{ marginTop: 8 }}>Passport session unavailable</div>
          <div className="sm ct2" style={{ marginTop: 5 }}>The saved demo state for this user is out of sync. Resetting will restore the seeded passport profiles.</div>
          <Button tone="bt-p" onClick={() => actions.resetDemo()} style={{ marginTop: 12 }}>
            Reset Demo State
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="oy fin">
      <MetricGrid columns={4} items={adminMetrics} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "admin", label: "Site Access Admin" },
          { value: "passport", label: "Passport Profile" },
          { value: "scan", label: "QR Scan Check-In" },
          { value: "emergency", label: "Emergency Info" },
        ]}
      />

      {tab === "admin" ? (
        <div className="g32">
          <Card title="Site Access Control" icon={Icons.qr}>
            <div className="fb mb8">
              <div>
                <div className="b sm">{accessConfig?.policy}</div>
                <div className="xs ct3" style={{ marginTop: 4 }}>
                  Rotating QR: {accessConfig?.rotating ? "Enabled" : "Disabled"}
                </div>
              </div>
              <QrBadge code={accessConfig?.qrCode || "SF-DEMO"} />
            </div>
            <DataTable
              storageKey={`passport-admin-${state.session.siteId}`}
              title="Current site access register"
              rows={sitePassports}
              onRowClick={(row) => setSelectedPassportId(row.id)}
              columns={[
                {
                  key: "person",
                  label: "Person",
                  accessor: (row) => row.person,
                  filterable: true,
                  render: (_, row) => (
                    <div>
                      <div className="b">{row.person}</div>
                      <div className="xs ct3">{row.company}</div>
                    </div>
                  ),
                },
                { key: "role", label: "Role", filterable: true, options: [...new Set(sitePassports.map((passport) => passport.role))] },
                {
                  key: "compliance",
                  label: "Compliance",
                  filterable: true,
                  options: ["Compliant", "Blocked"],
                  accessor: (row) => (row.blockedReasons.length ? "Blocked" : "Compliant"),
                  render: (value) => <Badge tone={value === "Blocked" ? "critical" : "passed"}>{value}</Badge>,
                },
                {
                  key: "blockedReason",
                  label: "Blocked Reason",
                  accessor: (row) => row.blockedReasons[0] || "All good",
                  filterable: true,
                },
              ]}
              rowActions={[
                {
                  label: "Open",
                  onClick: (row) => setSelectedPassportId(row.id),
                },
              ]}
            />
          </Card>

          <div>
            <Card title="Compliance Status" icon={Icons.shield} className="mb8">
              {selectedPassport ? (
                <>
                  <div className="b sm">{selectedPassport.person}</div>
                  <div className="xs ct3">
                    {selectedPassport.role} · {selectedPassport.trade}
                  </div>
                  <div className="fx" style={{ gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                    <Badge tone={selectedPassport.inductionStatus === "complete" ? "passed" : "critical"}>
                      Induction {selectedPassport.inductionStatus}
                    </Badge>
                    <Badge tone={selectedPassport.insuranceStatus === "current" || selectedPassport.insuranceStatus === "n/a" ? "passed" : "critical"}>
                      Insurance {selectedPassport.insuranceStatus}
                    </Badge>
                  </div>
                  <div className="list-stack" style={{ marginTop: 12 }}>
                    {selectedPassport.docs.map((doc) => (
                      <div className="linked-row" key={doc.id}>
                        <div>
                          <div className="b sm">{doc.label}</div>
                          <div className="xs ct3">Requirement status</div>
                        </div>
                        <Badge tone={doc.status === "complete" ? "passed" : "critical"}>{doc.status}</Badge>
                      </div>
                    ))}
                  </div>
                  <FileDropZone
                    title="Upload licence, insurance, or SWMS"
                    subtitle="Drop passport compliance files here to classify, extract, and update access automatically."
                    onFiles={(files) => uploadFiles(selectedPassport.id, files)}
                    loading={uploadingPassportId === selectedPassport.id}
                    small
                  />
                  {selectedPassportFiles.length ? (
                    <div className="list-stack" style={{ marginTop: 10 }}>
                      {selectedPassportFiles.slice(0, 3).map((file) => (
                        <div className="mini-panel" key={file.id}>
                          <div className="linked-row">
                            <div>
                              <div className="b sm">{file.name}</div>
                              <div className="xs ct3">
                                {file.classification} · {Math.round(file.size / 1024)}kb
                              </div>
                            </div>
                            <Button small tone="bt-r" onClick={() => actions.deleteFile(file.id)}>
                              Delete
                            </Button>
                          </div>
                          {renderFileFields(file)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </Card>

            <Card title="Expiring in 30 days" icon={Icons.clock} className="mb8">
              {expiringQueue.length ? (
                <div className="list-stack">
                  {expiringQueue.map((ticket) => (
                    <div className="linked-row" key={ticket.id}>
                      <div>
                        <div className="b sm">{ticket.person}</div>
                        <div className="xs ct3">
                          {ticket.label} · expires {ticket.expiresOn}
                        </div>
                      </div>
                      <Badge tone={ticket.blocked ? "critical" : "high"}>{ticket.blocked ? "Blocked" : "Expiring"}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ct3 sm empty">No expiring tickets for this site in the current demo window.</div>
              )}
            </Card>

            <Card title="Scan Log" icon={Icons.login}>
              <DataTable
                storageKey={`passport-scan-log-${state.session.siteId}`}
                rows={state.passports.scanLog.filter((entry) => entry.siteId === state.session.siteId)}
                columns={[
                  {
                    key: "person",
                    label: "Person",
                    accessor: (row) => sitePassports.find((passport) => passport.id === row.passportId)?.person || row.passportId,
                    filterable: true,
                  },
                  { key: "at", label: "At", filterable: true, type: "date" },
                  {
                    key: "result",
                    label: "Result",
                    filterable: true,
                    options: ["granted", "blocked"],
                    render: (value) => <Badge tone={value === "granted" ? "passed" : "critical"}>{value}</Badge>,
                  },
                  { key: "reason", label: "Reason", filterable: true },
                ]}
                emptyTitle="No scan events yet"
                emptyBody="QR scans will appear here as workers and subcontractors access the site."
              />
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "passport" ? (
        <div className="g2">
          <Card title="Passport Profile" icon={Icons.users}>
            {ownPassport ? (
              <>
                <div className="detail-head">
                  <div>
                    <div className="md bb">{ownPassport.person}</div>
                    <div className="xs ct3">
                      {ownPassport.company} · {ownPassport.trade}
                    </div>
                  </div>
                  <Badge tone={ownPassport.blockedReasons.length ? "critical" : "passed"}>
                    {ownPassport.blockedReasons.length ? "Access blocked" : "Access clear"}
                  </Badge>
                </div>
                <div className="fx" style={{ gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                  {ownPassport.permissions.map((permission) => (
                    <span key={permission} className="tag">
                      {permission}
                    </span>
                  ))}
                </div>
                <div className="list-stack">
                  {ownPassport.docs.map((doc) => (
                    <div className="linked-row" key={doc.id}>
                      <div>
                        <div className="b sm">{doc.label}</div>
                        <div className="xs ct3">Required before unrestricted access</div>
                      </div>
                      <Badge tone={doc.status === "complete" ? "passed" : "critical"}>{doc.status}</Badge>
                    </div>
                  ))}
                </div>
                <FileDropZone
                  title="Upload your passport documents"
                  subtitle="Upload insurance certificates, licences, and SWMS so SiteForge can classify them and update access automatically."
                  onFiles={(files) => uploadFiles(ownPassport.id, files)}
                  loading={uploadingPassportId === ownPassport.id}
                  style={{ marginTop: 12 }}
                />
                {ownPassportFiles.length ? (
                  <div className="list-stack" style={{ marginTop: 12 }}>
                    {ownPassportFiles.map((file) => (
                      <div className="mini-panel" key={file.id}>
                        <div className="linked-row">
                          <div>
                            <div className="b sm">{file.name}</div>
                            <div className="xs ct3">
                              {file.classification} · uploaded {file.uploadedAt}
                            </div>
                          </div>
                          <Button small tone="bt-r" onClick={() => actions.deleteFile(file.id)}>
                            Delete
                          </Button>
                        </div>
                        {renderFileFields(file)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="ct3 sm empty">No passport profile loaded for this role.</div>
            )}
          </Card>

          <Card title="Required Acknowledgements" icon={Icons.clipboard}>
            <div className="ff">
              <label>Typed acknowledgement</label>
              <input value={typedName} onChange={(event) => setTypedName(event.target.value)} />
            </div>
            <div className="list-stack">
              {(ownPassport?.acknowledgements || []).map((ack) => (
                <div className="linked-row" key={ack.id}>
                  <div>
                    <div className="b sm">{ack.label}</div>
                    <div className="xs ct3">Required before access and document release</div>
                  </div>
                  {ack.done ? (
                    <Badge tone="passed">Done</Badge>
                  ) : (
                    <Button small tone="bt-p" onClick={() => acknowledge(ack.id)}>
                      Acknowledge
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "scan" ? (
        <div className="g2">
          <Card title="QR Check-In Screen" icon={Icons.qr}>
            <div className="qr-stage">
              <QrBadge code={accessConfig?.qrCode || "SF-DEMO"} />
              <div className="sm ct2" style={{ marginTop: 12 }}>
                {accessConfig?.dailyBrief}
              </div>
              <Button tone="bt-p" icon={Icons.login} onClick={() => setScanOpen(true)} className="touch-button" style={{ marginTop: 14 }}>
                Simulate Scan
              </Button>
            </div>
          </Card>

          <Card title="Blocked Access Panel" icon={Icons.alert}>
            <div className="list-stack">
              {sitePassports
                .filter((passport) => passport.blockedReasons.length)
                .map((passport) => (
                  <div className="act" key={passport.id}>
                    <div style={{ flex: 1 }}>
                      <div className="b sm">{passport.person}</div>
                      <div className="xs ct3">{passport.blockedReasons.join(" · ")}</div>
                    </div>
                    <Badge tone="critical">Blocked</Badge>
                  </div>
                ))}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "emergency" ? (
        <Card title="Emergency Information" icon={Icons.alert}>
          <div className="g2">
            <div>
              <div className="md bb">Daily Brief</div>
              <div className="sm ct2" style={{ marginTop: 6, lineHeight: 1.6 }}>
                {accessConfig?.dailyBrief}
              </div>
            </div>
            <div>
              <div className="md bb">Contacts & Muster</div>
              <div className="list-stack" style={{ marginTop: 8 }}>
                {(accessConfig?.emergencyContacts || []).map((contact) => (
                  <div className="linked-row" key={contact.label}>
                    <div>
                      <div className="b sm">{contact.label}</div>
                      <div className="xs ct3">{contact.value}</div>
                    </div>
                    <Button small tone="bt-r" onClick={() => callNumber(contact.value)} disabled={!/\d/.test(contact.value)}>
                      {/\d/.test(contact.value) ? "Call" : "View"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <Modal open={scanOpen} close={() => setScanOpen(false)} title="Simulate QR Site Access">
        <div className="ff">
          <label>Person</label>
          <select value={selectedPassportId || ""} onChange={(event) => setSelectedPassportId(event.target.value)}>
            {sitePassports.map((passport) => (
              <option key={passport.id} value={passport.id}>
                {passport.person}
              </option>
            ))}
          </select>
        </div>
        <div className="fa">
          <Button onClick={() => setScanOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            icon={Icons.login}
            onClick={() => {
              actions.scanPassport(state.session.siteId, selectedPassportId);
              setScanOpen(false);
            }}
          >
            Run Scan
          </Button>
        </div>
      </Modal>
    </div>
  );
}
