import { useMemo, useState } from "react";
import ContractViewer from "../components/ContractViewer";
import { APP_CONFIG } from "../data/seedData";
import { useSiteForge } from "../services/siteforgeStore";
import { getBlob } from "../services/documentIntelligence";
import { exportElementToPdf } from "../services/pdfService";
import { Icons, renderIcon } from "../components/icons";
import { Badge, Button, Modal } from "../components/ui";

const PORTAL_TABS = [
  { value: "home", label: "Home" },
  { value: "approvals", label: "Approvals" },
  { value: "progress", label: "Project Progress" },
  { value: "documents", label: "Documents & Contracts" },
  { value: "messages", label: "Messages" },
  { value: "profile", label: "Profile" },
];

export default function ClientPortalPage() {
  const { state, actions, derived } = useSiteForge();
  const client = derived.currentClient;
  const route = state.session.route;
  const site = client ? state.sites.find((entry) => entry.id === client.siteId) || state.sites[0] : state.sites[0];
  const schedule = site ? state.schedules.find((entry) => entry.siteId === site.id) || null : null;
  const approvals = client ? state.approvals.filter((approval) => approval.clientId === client.id) : [];
  const contracts = site ? state.contractPacks.filter((pack) => pack.siteId === site.id && approvals.some((approval) => approval.contractPackId === pack.docId)) : [];
  const clientDocs = site ? state.documents.filter((document) => document.siteId === site.id && document.clientVisible) : [];
  const clientMessages = client ? state.messages.filter((thread) => thread.threadId === client.id || approvals.some((approval) => approval.id === thread.threadId)) : [];
  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState("");
  const [typedName, setTypedName] = useState(client?.primaryContact || "");
  const [signatureAck, setSignatureAck] = useState(false);
  const [callbackSlotId, setCallbackSlotId] = useState("");
  const builder = state.settings?.company || state.company || APP_CONFIG.builder;

  const currentPage = route.page || "home";
  const selectedApproval = approvals.find((approval) => approval.id === route.entityId) || approvals[0] || null;
  const selectedContract =
    contracts.find((pack) => pack.docId === route.entityId) ||
    contracts.find((pack) => pack.approvalId === selectedApproval?.id) ||
    contracts[0] ||
    null;

  const openApproval = (approval) => {
    actions.navigate({ kind: "client", clientId: client.id, page: "approvals", entityId: approval.id });
    actions.viewApproval(approval.id);
  };

  const submitDecision = () => {
    if (!selectedApproval || !decision) return;
    if (decision === "call" && callbackSlotId) {
      actions.scheduleCallback(client.id, callbackSlotId, selectedApproval.id, note);
      setDecision(null);
      setNote("");
      setCallbackSlotId("");
      return;
    }
    if (decision === "approve") {
      if (!typedName.trim() || !signatureAck) return;
      const expected = (client.primaryContact || "").trim().toLowerCase();
      if (expected && typedName.trim().toLowerCase() !== expected) {
        setNote((current) => current || `Signature recorded as ${typedName.trim()}; expected portal contact is ${client.primaryContact}.`);
      }
      actions.approveAndSignApproval(selectedApproval.id, typedName.trim(), note);
    } else {
      actions.respondToApproval(selectedApproval.id, decision, note, typedName);
    }
    setDecision(null);
    setNote("");
    setSignatureAck(false);
  };

  const signedPacks = contracts.filter((pack) => pack.status === "signed");
  const pendingPacks = contracts.filter((pack) => pack.status !== "signed");
  const heroApprovalCount = approvals.filter((approval) => ["awaiting-client", "question", "changes-requested", "contract-awaiting-client"].includes(approval.status)).length;
  const availableSlots = state.pmAvailability.filter((slot) => !slot.booked);
  const linkExpired =
    selectedApproval?.portalExpiresAt &&
    Date.parse(`${selectedApproval.portalExpiresAt}T23:59:59`) < Date.now() &&
    !["signed", "declined"].includes(selectedApproval.status);

  const downloadContractPack = async (pack, fallbackElement, subtitle = "") => {
    if (pack?.executedPdfBlobId) {
      const blob = await getBlob(pack.executedPdfBlobId);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${pack.docId}.pdf`;
        anchor.click();
        URL.revokeObjectURL(url);
        return;
      }
    }
    if (fallbackElement) {
      await exportElementToPdf({
        element: fallbackElement,
        filename: `${pack.docId}.pdf`,
        title: pack.docId,
        subtitle,
      });
    }
  };

  if (!client || !site) {
    return (
      <div className="client-shell">
        <div className="client-page">
          <div className="client-panel">
            <h3>Client session unavailable</h3>
            <div className="client-copy">This portal session could not be restored from saved demo state.</div>
            <Button tone="bt-p" onClick={() => actions.resetDemo()} style={{ marginTop: 12 }}>
              Reset Demo State
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (linkExpired) {
    return (
      <div className="client-shell">
        <div className="client-page">
          <div className="client-panel">
            <h3>Approval link expired</h3>
            <div className="client-copy">For security, this ClientFlow magic link has expired. Please ask the builder to resend the approval.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="client-shell">
      <div className="client-topbar">
        <div>
          <div className="client-brand">
            {builder.logoDataUrl ? <img alt={`${builder.name || "Builder"} logo`} src={builder.logoDataUrl} className="client-brand-logo" /> : null}
            {builder.name || APP_CONFIG.builder.name}
          </div>
          <div className="client-project">{site.name}</div>
        </div>
        <div className="fx" style={{ gap: 10, alignItems: "center" }}>
          <div className="client-pill">{client.primaryContact}</div>
          <Button onClick={() => actions.setRole("Supervisor")}>Return to Builder View</Button>
        </div>
      </div>

      <div className="client-nav">
        {PORTAL_TABS.map((tab) => (
          <button
            className={`client-tab ${currentPage === tab.value ? "active" : ""}`.trim()}
            key={tab.value}
            onClick={() => actions.navigate({ kind: "client", clientId: client.id, page: tab.value, entityId: null })}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {currentPage === "home" ? (
        <div className="client-page">
          <div className="client-hero">
            <div>
              <div className="client-kicker">Project Overview</div>
              <h1>{site.name}</h1>
              <p>
                {site.progress}% complete · Estimated completion {site.estimatedCompletion} · Next milestone {site.nextMilestone}
              </p>
              <div className="client-hero-metrics">
                <div className="client-metric">
                  <span>Progress</span>
                  <strong>{site.progress}%</strong>
                </div>
                <div className="client-metric">
                  <span>Next milestone</span>
                  <strong>{site.nextMilestone}</strong>
                </div>
                <div className="client-metric">
                  <span>Est. completion</span>
                  <strong>{site.estimatedCompletion}</strong>
                </div>
              </div>
            </div>
            <div className="client-hero-art">
              <div className="hero-photo-placeholder">{site.heroPhotoLabel}</div>
            </div>
          </div>

          <div className="client-tiles">
            <button className="client-tile" type="button" onClick={() => actions.navigate({ kind: "client", clientId: client.id, page: "approvals", entityId: null })}>
              <div className="client-tile-label">Approvals Awaiting You</div>
              <div className="client-tile-value">{heroApprovalCount}</div>
            </button>
            <button className="client-tile" type="button" onClick={() => actions.navigate({ kind: "client", clientId: client.id, page: "progress", entityId: null })}>
              <div className="client-tile-label">Project Progress</div>
              <div className="client-tile-value">{site.currentPhase}</div>
            </button>
            <button className="client-tile" type="button" onClick={() => actions.navigate({ kind: "client", clientId: client.id, page: "documents", entityId: null })}>
              <div className="client-tile-label">Documents & Contracts</div>
              <div className="client-tile-value">{contracts.length}</div>
            </button>
          </div>

          <div className="g2">
            <div className="client-panel">
              <h3>Recent Builder Updates</h3>
              <div className="client-feed">
                {state.projectLogs
                  .filter((log) => log.siteId === site.id)
                  .slice(0, 5)
                  .map((log) => (
                    <div className="client-feed-item" key={log.id}>
                      <div className="b sm">{log.title}</div>
                      <div className="xs client-muted">{log.at}</div>
                      <div className="sm client-copy">{log.body}</div>
                    </div>
                  ))}
              </div>
            </div>
            <div className="client-panel">
              <h3>Weekly Summary & Photos</h3>
              <div className="client-copy">{derived.weeklyClientSummary}</div>
              <div className="client-photo-row">
                {derived.photoTimeline
                  .filter((photo) => photo.siteId === site.id)
                  .slice(0, 6)
                  .map((photo) => (
                    <div className="client-photo" key={photo.id}>
                      {photo.thumbnailDataUrl ? <img alt={photo.label} src={photo.thumbnailDataUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : photo.label}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {currentPage === "approvals" ? (
        <div className="client-page">
          {!route.entityId ? (
            <div className="client-approval-list">
              {approvals.map((approval) => (
                <button className="client-approval-card" key={approval.id} onClick={() => openApproval(approval)} type="button">
                  <div className="fb" style={{ alignItems: "flex-start", gap: 12 }}>
                    <div>
                      <div className="client-type-chip">{approval.type}</div>
                      <div className="client-card-title">{approval.title}</div>
                      <div className="client-copy" style={{ marginTop: 6 }}>
                        {approval.summary.slice(0, 140)}
                        {approval.summary.length > 140 ? "..." : ""}
                      </div>
                    </div>
                    <div className="tr">
                      <div className={`client-priority ${approval.priority}`}>{approval.priority}</div>
                      <div className="client-impact-value">${approval.costImpact.toLocaleString()}</div>
                      <div className="client-muted">{approval.timeImpact || 0}d</div>
                    </div>
                  </div>
                  <div className="fb" style={{ marginTop: 12 }}>
                    <div className="client-muted">{approval.sentAt || "Drafted"}</div>
                    <div className="client-status">{approval.status}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : selectedApproval ? (
            <div className="client-approval-detail">
              <button className="client-back" type="button" onClick={() => actions.navigate({ kind: "client", clientId: client.id, page: "approvals", entityId: null })}>
                {renderIcon(Icons.back, 14)} Back to approvals
              </button>
              <div className="client-detail-head">
                <div className="client-type-chip">{selectedApproval.type}</div>
                <h1>{selectedApproval.title}</h1>
                <div className="client-muted">
                  Sent {selectedApproval.sentAt || "Draft"} · Status {selectedApproval.status}
                </div>
              </div>

              <div className="client-detail-grid">
                <div>
                  <section className="client-section">
                    <h3>What we're asking for</h3>
                    <p>{selectedApproval.summary}</p>
                  </section>
                  <section className="client-section">
                    <h3>Why this is needed</h3>
                    <p>{selectedApproval.reason}</p>
                  </section>
                  <section className="client-section">
                    <h3>Our recommendation</h3>
                    <p>{selectedApproval.recommendation}</p>
                  </section>
                  <section className="client-section">
                    <h3>Supporting documents</h3>
                    <div className="client-attachments">
                      {(selectedApproval.attachments || []).map((attachment) => (
                        <div className="client-attachment" key={attachment.id}>
                          <div className="b sm">{attachment.name}</div>
                          <div className="xs client-muted">{attachment.kind.toUpperCase()} preview</div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="client-section">
                    <h3>Message history</h3>
                    <div className="client-thread">
                      {(selectedApproval.messageThread || []).map((entry) => (
                        <div className="client-thread-item" key={entry.id}>
                          <div className="b sm">{entry.by}</div>
                          <div className="xs client-muted">{entry.at}</div>
                          <div className="client-copy">{entry.body}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <div>
                  <div className="client-impact-block">
                    <div>
                      <span>Cost impact</span>
                      <strong>${selectedApproval.costImpact.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>Time impact</span>
                      <strong>{selectedApproval.timeImpact || 0} days</strong>
                    </div>
                  </div>

                  {selectedApproval.contractPackId ? (
                    <div className="client-sign-ready">
                      <div className="b sm">Your contract pack is ready for signature</div>
                      <div className="client-copy" style={{ marginTop: 6 }}>
                        Review the formal pack and sign once you are comfortable with the recorded impact.
                      </div>
                      <Button
                        tone="bt-p"
                        icon={Icons.file}
                        onClick={() => actions.navigate({ kind: "client", clientId: client.id, page: "documents", entityId: selectedApproval.contractPackId })}
                        style={{ marginTop: 10 }}
                      >
                        Review Contract Pack
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="client-sticky-footer">
                <Button tone="bt-p" icon={Icons.check} onClick={() => setDecision("approve")}>
                  Approve
                </Button>
                <Button tone="bt-r" icon={Icons.x} onClick={() => setDecision("decline")}>
                  Decline
                </Button>
                <Button icon={Icons.help} onClick={() => setDecision("question")}>
                  Ask Question
                </Button>
                <Button icon={Icons.shuffle} onClick={() => setDecision("change")}>
                  Request Change
                </Button>
                <Button icon={Icons.phone} onClick={() => setDecision("call")}>
                  Request Call
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {currentPage === "progress" ? (
        <div className="client-page">
          <div className="client-panel">
            <h3>Programme Timeline</h3>
            <div className="client-timeline">
              {schedule?.phases.map((phase) => (
                <div className="client-phase" key={phase.id}>
                  <div className="client-phase-label">{phase.label}</div>
                  <div className="client-phase-bar">
                    <div className="client-phase-fill" style={{ width: `${phase.progress}%`, background: phase.color }} />
                  </div>
                  <div className="client-muted">{phase.progress}%</div>
                </div>
              ))}
            </div>
          </div>
          <div className="g2">
            <div className="client-panel">
              <h3>Current Phase</h3>
              <div className="client-copy">{site.currentPhase}</div>
              <div className="client-muted" style={{ marginTop: 8 }}>
                Expected completion {site.estimatedCompletion}
              </div>
            </div>
            <div className="client-panel">
              <h3>Next Two Weeks</h3>
              <div className="client-copy">
                The next work fronts focus on {site.nextMilestone.toLowerCase()}, close-out of active inspections, and release of following trade packages.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {currentPage === "documents" ? (
        <div className="client-page">
          {route.entityId && selectedContract ? (
            <div>
              <button className="client-back" type="button" onClick={() => actions.navigate({ kind: "client", clientId: client.id, page: "documents", entityId: null })}>
                {renderIcon(Icons.back, 14)} Back to documents
              </button>
              <ContractViewer
                contractPack={selectedContract}
                approval={approvals.find((approval) => approval.id === selectedContract.approvalId)}
                site={site}
                client={client}
                role="Client"
                onClientSign={(contractId, name) => actions.signClientContract(contractId, name)}
              />
              <div className="fa" style={{ marginTop: 12 }}>
                <Button
                  tone="bt-p"
                  onClick={async () => {
                    const node = document.querySelector(".contract-viewer");
                    await downloadContractPack(selectedContract, node, `${selectedContract.template} · ${selectedContract.status}`);
                  }}
                >
                  Download PDF
                </Button>
              </div>
            </div>
          ) : (
            <div className="g2">
              <div className="client-panel">
                <h3>Awaiting Signature</h3>
                <div className="client-feed">
                  {pendingPacks.map((pack) => (
                    <div className="client-feed-item" key={pack.docId}>
                      <div className="b sm">{pack.docId}</div>
                      <div className="xs client-muted">{pack.template}</div>
                      <div className="client-copy">Status: {pack.status}</div>
                      <Button small tone="bt-p" onClick={() => actions.navigate({ kind: "client", clientId: client.id, page: "documents", entityId: pack.docId })}>
                        Open
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="client-panel">
                <h3>Signed Packs & Client Documents</h3>
                <div className="client-feed">
                  {signedPacks.map((pack) => (
                    <div className="client-feed-item" key={pack.docId}>
                    <div className="b sm">{pack.docId}</div>
                    <div className="client-copy">{pack.pdfArchiveLabel}</div>
                      <Button
                        small
                        tone="bt-p"
                        onClick={async (event) => {
                          const node = event.currentTarget.closest(".client-feed-item");
                          await downloadContractPack(pack, node, pack.template);
                        }}
                      >
                        Download PDF
                      </Button>
                    </div>
                  ))}
                  {clientDocs.map((document) => (
                    <div className="client-feed-item" key={document.id}>
                      <div className="b sm">{document.title}</div>
                      <div className="xs client-muted">
                        {document.category} · {document.rev}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {currentPage === "messages" ? (
        <div className="client-page">
          <div className="client-panel">
            <h3>Unified Builder Thread</h3>
            <div className="client-thread">
              {clientMessages.flatMap((thread) =>
                thread.messages.map((entry) => (
                  <div className="client-thread-item" key={entry.id}>
                    <div className="b sm">{state.users.find((user) => user.id === entry.by)?.name || "Builder"}</div>
                    <div className="xs client-muted">{entry.at}</div>
                    <div className="client-copy">{entry.body}</div>
                  </div>
                )),
              )}
            </div>
            <div className="client-message-composer">
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Send a general message or reference a specific approval..." />
              <Button
                tone="bt-p"
                icon={Icons.send}
                onClick={() => {
                  actions.addClientMessage(client.id, note);
                  setNote("");
                }}
              >
                Send Message
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {currentPage === "profile" ? (
        <div className="client-page">
          <div className="g2">
            <div className="client-panel">
              <h3>Contact Details</h3>
              <div className="ff">
                <label>Primary contact</label>
                <input value={client.primaryContact} readOnly />
              </div>
              <div className="ff">
                <label>Email</label>
                <input value={client.email} readOnly />
              </div>
              <div className="ff">
                <label>Phone</label>
                <input value={client.phone} readOnly />
              </div>
              <div className="ff">
                <label>Language</label>
                <select
                  value={client.language || APP_CONFIG.clientLanguages?.[0] || "English"}
                  onChange={(event) => actions.updateClientPreferences?.(client.id, { language: event.target.value })}
                >
                  {(APP_CONFIG.clientLanguages || ["English", "Simplified English"]).map((language) => (
                    <option key={language}>{language}</option>
                  ))}
                </select>
              </div>
              <div className="ff">
                <label>Preferred response time</label>
                <select
                  value={client.preferredResponseTime || APP_CONFIG.preferredResponseTimes?.[0] || "24h"}
                  onChange={(event) => actions.updateClientPreferences?.(client.id, { preferredResponseTime: event.target.value })}
                >
                  {(APP_CONFIG.preferredResponseTimes || ["24h", "48h"]).map((time) => (
                    <option key={time}>{time}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="client-panel">
              <h3>Notification Preferences</h3>
              <div className="list-stack">
                {Object.entries(client.notificationPreferences).map(([key, value]) => (
                  <div className="linked-row" key={key}>
                    <div>
                      <div className="b sm">{key}</div>
                      <div className="xs client-muted">Preferred response setting</div>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) =>
                          actions.updateClientPreferences?.(client.id, {
                            notificationPreferences: {
                              ...client.notificationPreferences,
                              [key]: event.target.checked,
                            },
                          })
                        }
                      />
                      <span />
                    </label>
                  </div>
                ))}
              </div>
              <div className="mini-panel" style={{ marginTop: 14 }}>
                <div className="xs ct3">Booked callbacks</div>
                {(state.callbacks || [])
                  .filter((callback) => callback.clientId === client.id)
                  .map((callback) => (
                    <div className="linked-row" key={callback.id} style={{ marginTop: 8 }}>
                      <div>
                        <div className="b sm">{callback.label}</div>
                        <div className="xs client-muted">{callback.notes || "Booked from portal"}</div>
                      </div>
                      <Badge tone="passed">{callback.status}</Badge>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Modal open={Boolean(decision)} close={() => setDecision(null)} title="Record your decision">
        <div className="ff">
          <label>{decision === "approve" ? "Type your full name to sign" : "Typed name"}</label>
          <input value={typedName} onChange={(event) => setTypedName(event.target.value)} />
        </div>
        {decision === "approve" ? (
          <label className="checkline" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={signatureAck} onChange={(event) => setSignatureAck(event.target.checked)} />
            <span>I have read and agree to the terms of this variation and authorise electronic signature under the Electronic Transactions Act 1999 (Cth).</span>
          </label>
        ) : null}
        <div className="ff">
          <label>
            {decision === "decline"
              ? "Reason for decline"
              : decision === "question"
                ? "Question for the builder"
                : decision === "change"
                  ? "Requested change"
                  : decision === "call"
                    ? "Preferred callback note"
                    : "Optional note"}
          </label>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        {decision === "call" ? (
          <div className="ff">
            <label>Available callback slot</label>
            <select value={callbackSlotId} onChange={(event) => setCallbackSlotId(event.target.value)}>
              <option value="">Select a PM time slot</option>
              {availableSlots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="fa">
          <Button onClick={() => setDecision(null)}>Cancel</Button>
          <Button tone="bt-p" onClick={submitDecision} disabled={decision === "approve" && (!typedName.trim() || !signatureAck)}>
            Confirm
          </Button>
        </div>
      </Modal>
    </div>
  );
}
