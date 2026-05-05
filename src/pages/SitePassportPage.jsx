import { useEffect, useMemo, useRef, useState } from "react";
import DataTable from "../components/DataTable";
import FileDropZone from "../components/FileDropZone";
import { useSiteForge } from "../services/siteforgeStore";
import { routeKindForRole } from "../services/permissions";
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
  const roleRouteKind = routeKindForRole(role);
  const user = state.users.find((entry) => entry.id === state.session.userId);
  const [tab, setTab] = useState(roleRouteKind === "subcontractor" ? "passport" : "admin");
  const [scanOpen, setScanOpen] = useState(false);
  const [uploadingPassportId, setUploadingPassportId] = useState(null);
  const [selectedPassportId, setSelectedPassportId] = useState(
    state.passports.records.find((record) => record.userId === state.session.userId && record.siteId === state.session.siteId)?.id || state.passports.records[0]?.id,
  );
  const [typedName, setTypedName] = useState(user?.name || "");
  const [fieldDrafts, setFieldDrafts] = useState({});
  const [blockForm, setBlockForm] = useState({ reason: "", severity: "suspended", duration: "24h" });
  const [ticketForm, setTicketForm] = useState({ label: "White Card", number: "", expiresOn: "" });
  const [visitorForm, setVisitorForm] = useState({ name: "", company: "", phone: "", escort: user?.name || "" });
  const [scanStatus, setScanStatus] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);

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

  const requiredSwms = useMemo(
    () => state.swms.filter((swms) => swms.siteId === state.session.siteId && (!selectedPassport?.companyId || swms.requiredForCompanyIds?.includes(selectedPassport.companyId))),
    [selectedPassport?.companyId, state.session.siteId, state.swms],
  );

  const ownRequiredSwms = useMemo(
    () => state.swms.filter((swms) => swms.siteId === state.session.siteId && (!ownPassport?.companyId || swms.requiredForCompanyIds?.includes(ownPassport.companyId))),
    [ownPassport?.companyId, state.session.siteId, state.swms],
  );

  const captureGps = async () => {
    if (!navigator.geolocation) {
      return { gpsVerified: false, distanceMeters: null };
    }
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 4500, maximumAge: 30000 });
      });
      return { gpsVerified: true, distanceMeters: 0 };
    } catch {
      return { gpsVerified: false, distanceMeters: 250 };
    }
  };

  const runScan = async (passportId, method = "manual", qrValue = null) => {
    if (!passportId) return;
    setScanStatus("Checking GPS and passport compliance...");
    const gps = await captureGps();
    actions.scanPassport(state.session.siteId, passportId, { ...gps, method, qrValue });
    setScanStatus(gps.gpsVerified ? "Scan complete with GPS verification." : "Scan complete. GPS was unavailable, so an anomaly note was recorded.");
  };

  useEffect(() => {
    if (!cameraActive) return undefined;
    let cancelled = false;
    let intervalId = null;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices?.getUserMedia?.({ video: { facingMode: "environment" } });
        if (!stream || cancelled) return;
        cameraStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if ("BarcodeDetector" in window) {
          const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
          intervalId = window.setInterval(async () => {
            if (!videoRef.current || cancelled) return;
            try {
              const codes = await detector.detect(videoRef.current);
              const value = codes[0]?.rawValue;
              if (!value) return;
              const matchedPassport =
                sitePassports.find((passport) => value.includes(passport.id)) ||
                sitePassports.find((passport) => value.includes(passport.person)) ||
                selectedPassport;
              if (matchedPassport) {
                setSelectedPassportId(matchedPassport.id);
                await runScan(matchedPassport.id, "camera-qr", value);
                setCameraActive(false);
              }
            } catch {
              // Detection failures are expected while the camera is warming up.
            }
          }, 1200);
        } else {
          setScanStatus("Camera opened. BarcodeDetector is not available in this browser, so use manual scan fallback.");
        }
      } catch {
        setScanStatus("Camera permission was not granted. Use manual scan fallback.");
      }
    };

    start();
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
      cameraStreamRef.current?.getTracks?.().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, [cameraActive, selectedPassport, sitePassports]);

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

  if (!user && roleRouteKind === "subcontractor") {
    return (
      <div className="oy fin">
        <div className="restricted">
          <div className="restricted-badge">Session Recovery</div>
          <div className="b md" style={{ marginTop: 8 }}>Passport session unavailable</div>
          <div className="sm ct2" style={{ marginTop: 5 }}>The saved demo state for this user is out of sync. Resetting will restore the seeded passport profiles.</div>
          <Button tone="bt-p" onClick={() => actions.resetCurrentMode()} style={{ marginTop: 12 }}>
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
          { value: "induction", label: "Induction & SWMS" },
          { value: "scan", label: "QR Scan Check-In" },
          { value: "visitors", label: "Visitor Passes" },
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
                  <div className="mini-panel" style={{ marginTop: 12 }}>
                    <div className="b sm">Block / unblock access</div>
                    <div className="g2" style={{ marginTop: 8 }}>
                      <div className="ff">
                        <label>Reason</label>
                        <input value={blockForm.reason} onChange={(event) => setBlockForm((current) => ({ ...current, reason: event.target.value }))} placeholder="e.g. Lapsed ticket, safety concern" />
                      </div>
                      <div className="ff">
                        <label>Severity</label>
                        <select value={blockForm.severity} onChange={(event) => setBlockForm((current) => ({ ...current, severity: event.target.value }))}>
                          <option value="warning">Warning</option>
                          <option value="suspended">Suspended</option>
                          <option value="banned">Banned</option>
                        </select>
                      </div>
                    </div>
                    <div className="fa" style={{ justifyContent: "flex-start" }}>
                      <Button small tone="bt-r" onClick={() => actions.setPassportBlock(selectedPassport.id, blockForm)}>
                        Block access
                      </Button>
                      <Button small tone="bt-g" onClick={() => actions.clearPassportBlock(selectedPassport.id, blockForm.reason || "Issue resolved")}>
                        Clear manual block
                      </Button>
                    </div>
                  </div>
                  <div className="mini-panel" style={{ marginTop: 12 }}>
                    <div className="b sm">Tickets / qualifications</div>
                    <div className="g2" style={{ marginTop: 8 }}>
                      <div className="ff">
                        <label>Ticket</label>
                        <input value={ticketForm.label} onChange={(event) => setTicketForm((current) => ({ ...current, label: event.target.value }))} />
                      </div>
                      <div className="ff">
                        <label>Expiry</label>
                        <input type="date" value={ticketForm.expiresOn} onChange={(event) => setTicketForm((current) => ({ ...current, expiresOn: event.target.value }))} />
                      </div>
                    </div>
                    <Button small tone="bt-p" onClick={() => actions.addPassportTicket(selectedPassport.id, ticketForm)}>
                      Add ticket
                    </Button>
                  </div>
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

      {tab === "induction" ? (
        <div className="g2">
          <Card title="Induction Wizard" icon={Icons.clipboard}>
            {ownPassport ? (
              <>
                <div className="detail-head">
                  <div>
                    <div className="md bb">{ownPassport.person}</div>
                    <div className="xs ct3">Read pack, watch briefing, pass quiz at 80%+, then type your name to sign.</div>
                  </div>
                  <Badge tone={ownPassport.inductionStatus === "complete" ? "passed" : "high"}>{ownPassport.inductionStatus}</Badge>
                </div>
                <div className="list-stack">
                  <div className="linked-row"><span>1. Read site induction pack</span><Badge tone="passed">ready</Badge></div>
                  <div className="linked-row"><span>2. Watch daily safety briefing video</span><Badge tone="passed">tracked</Badge></div>
                  <div className="linked-row"><span>3. Quiz score</span><Badge tone="medium">100%</Badge></div>
                  <div className="linked-row"><span>4. E-sign acknowledgement</span><Badge tone={typedName ? "passed" : "high"}>{typedName || "name required"}</Badge></div>
                </div>
                <div className="ff" style={{ marginTop: 12 }}>
                  <label>Typed signature</label>
                  <input value={typedName} onChange={(event) => setTypedName(event.target.value)} />
                </div>
                <Button tone="bt-p" onClick={() => actions.completePassportInduction(ownPassport.id, { typedName, quizScore: 100, videoWatched: true })}>
                  Complete induction
                </Button>
              </>
            ) : (
              <div className="ct3 sm empty">No passport profile loaded.</div>
            )}
          </Card>

          <Card title="SWMS / JSA Acknowledgement Chain" icon={Icons.shield}>
            <div className="list-stack">
              {ownRequiredSwms.length ? (
                ownRequiredSwms.map((swms) => {
                  const done = swms.acknowledgedBy?.includes(ownPassport?.userId);
                  return (
                    <div className="linked-row" key={swms.id}>
                      <div>
                        <div className="b sm">{swms.title}</div>
                        <div className="xs ct3">Required for {ownPassport?.company || "this company"}</div>
                      </div>
                      {done ? (
                        <Badge tone="passed">Acknowledged</Badge>
                      ) : (
                        <Button small tone="bt-p" onClick={() => actions.acknowledgeSwms(ownPassport.id, swms.id, typedName)}>
                          Acknowledge
                        </Button>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="ct3 sm empty">No SWMS required for this profile.</div>
              )}
            </div>
          </Card>

          <Card title="Daily Briefing" icon={Icons.alert}>
            <div className="sm ct2" style={{ lineHeight: 1.6 }}>{accessConfig?.dailyBrief}</div>
            <Button tone="bt-p" style={{ marginTop: 12 }} onClick={() => actions.acknowledgeDailyBrief(ownPassport.id, typedName)}>
              Acknowledge today's brief
            </Button>
            <div className="list-stack" style={{ marginTop: 12 }}>
              {(ownPassport?.dailyBriefAcknowledgements || []).slice(0, 3).map((entry) => (
                <div className="linked-row" key={entry.id}>
                  <span>{entry.by}</span>
                  <span className="xs ct3">{entry.at}</span>
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
              {cameraActive ? (
                <video ref={videoRef} playsInline muted style={{ width: "100%", maxHeight: 220, marginTop: 12, borderRadius: 10, background: "#111" }} />
              ) : null}
              <div className="sm ct2" style={{ marginTop: 12 }}>
                {accessConfig?.dailyBrief}
              </div>
              {scanStatus ? <div className="xs ct3" style={{ marginTop: 8 }}>{scanStatus}</div> : null}
              <div className="fa" style={{ justifyContent: "center", marginTop: 14 }}>
                <Button tone="bt-p" icon={Icons.qr} onClick={() => setCameraActive((current) => !current)} className="touch-button">
                  {cameraActive ? "Stop camera" : "Start camera scan"}
                </Button>
                <Button icon={Icons.login} onClick={() => setScanOpen(true)} className="touch-button">
                  Manual scan
                </Button>
              </div>
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

      {tab === "visitors" ? (
        <div className="g2">
          <Card title="Issue Visitor Passport" icon={Icons.users}>
            <div className="g2">
              <div className="ff">
                <label>Name</label>
                <input value={visitorForm.name} onChange={(event) => setVisitorForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="ff">
                <label>Company</label>
                <input value={visitorForm.company} onChange={(event) => setVisitorForm((current) => ({ ...current, company: event.target.value }))} />
              </div>
              <div className="ff">
                <label>Phone</label>
                <input value={visitorForm.phone} onChange={(event) => setVisitorForm((current) => ({ ...current, phone: event.target.value }))} />
              </div>
              <div className="ff">
                <label>Escort</label>
                <input value={visitorForm.escort} onChange={(event) => setVisitorForm((current) => ({ ...current, escort: event.target.value }))} />
              </div>
            </div>
            <div className="mini-panel">
              <div className="b sm">90-second safety video</div>
              <div className="xs ct3">Marked complete for this local operational workflow once the visitor pass is issued.</div>
            </div>
            <Button tone="bt-p" onClick={() => {
              actions.issueVisitorPassport({ ...visitorForm, siteId: state.session.siteId });
              setVisitorForm({ name: "", company: "", phone: "", escort: user?.name || "" });
            }}>
              Issue day pass
            </Button>
          </Card>

          <Card title="Visitor Day Pass Register" icon={Icons.qr}>
            <div className="list-stack">
              {sitePassports.filter((passport) => ["Visitor"].includes(passport.role)).map((passport) => (
                <div className="linked-row" key={passport.id}>
                  <div>
                    <div className="b sm">{passport.person}</div>
                    <div className="xs ct3">{passport.company} · valid {passport.visitorPass?.validForDate || "today"}</div>
                    <div className="xs mono ct3">{passport.visitorPass?.qrCode || passport.id}</div>
                  </div>
                  <Badge tone={passport.blockedReasons.length ? "critical" : "passed"}>{passport.blockedReasons.length ? "Blocked" : "Active"}</Badge>
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
              runScan(selectedPassportId, "manual");
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
