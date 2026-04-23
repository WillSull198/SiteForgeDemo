import { useMemo, useState } from "react";
import { useSiteForge } from "../services/siteforgeStore";
import { exportElementToPdf } from "../services/pdfService";
import { Icons } from "../components/icons";
import { Badge, Button, Card, Modal } from "../components/ui";

const TABS = [
  { value: "jobs", label: "My Jobs" },
  { value: "rfis", label: "My RFIs" },
  { value: "invoices", label: "My Invoices" },
  { value: "induction", label: "Induction Status" },
  { value: "passport", label: "Site Passport" },
  { value: "messages", label: "Messages" },
];

export default function SubcontractorPortal() {
  const { state, actions } = useSiteForge();
  const route = state.session.route;
  const user = state.users.find((entry) => entry.id === state.session.userId);
  const companyId = user?.companyId;
  const siteId = user?.siteIds?.[0] || state.session.siteId;
  const [rfiOpen, setRfiOpen] = useState(false);
  const [variationOpen, setVariationOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [rfiForm, setRfiForm] = useState({ title: "", description: "", to: "Project Manager", priority: "medium" });
  const [variationForm, setVariationForm] = useState({ title: "", value: "", days: "", description: "" });
  const [invoiceForm, setInvoiceForm] = useState({ number: "", value: "", notes: "" });

  const jobs = useMemo(() => state.tasks.filter((task) => task.companyId === companyId && task.siteId === siteId), [companyId, siteId, state.tasks]);
  const rfis = useMemo(() => state.rfis.filter((rfi) => rfi.scopeCompanyId === companyId), [companyId, state.rfis]);
  const invoices = useMemo(() => state.invoices.filter((invoice) => invoice.companyId === companyId), [companyId, state.invoices]);
  const passport = user ? state.passports.records.find((record) => record.userId === user.id && record.siteId === siteId) : null;
  const threads = user ? state.messages.filter((thread) => thread.participants?.includes(user.id)) : [];

  const currentPage = route.page || "jobs";

  if (!user) {
    return (
      <div className="subbie-shell">
        <div className="client-page">
          <div className="client-panel">
            <h3>Subcontractor session unavailable</h3>
            <div className="client-copy">This subcontractor view needs a clean user session to render properly.</div>
            <Button tone="bt-p" onClick={() => actions.resetDemo()} style={{ marginTop: 12 }}>
              Reset Demo State
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="subbie-shell">
      <div className="subbie-topbar">
        <div>
          <div className="client-brand">Subcontractor Workspace</div>
          <div className="client-project">
            {user.name} · {user.company}
          </div>
        </div>
        <Button onClick={() => actions.setRole("Supervisor")}>Internal View</Button>
      </div>

      <div className="client-nav">
        {TABS.map((tab) => (
          <button
            className={`client-tab ${currentPage === tab.value ? "active" : ""}`.trim()}
            key={tab.value}
            onClick={() => actions.navigate({ kind: "subcontractor", userId: user.id, page: tab.value, entityId: null })}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="client-page">
        {currentPage === "jobs" ? (
          <div className="g2">
            <Card title="My Jobs" icon={Icons.check}>
              <div className="list-stack">
                {jobs.map((job) => (
                  <div className="act" key={job.id}>
                    <div style={{ flex: 1 }}>
                      <div className="b sm">{job.title}</div>
                      <div className="xs ct3">
                        {job.trade} · Due {job.dueDate}
                      </div>
                      <div className="sm ct2" style={{ marginTop: 4 }}>
                        {job.description}
                      </div>
                    </div>
                    <div className="fx" style={{ gap: 4, flexWrap: "wrap" }}>
                      <Badge tone={job.status === "done" ? "passed" : "medium"}>{job.status}</Badge>
                      {job.status === "todo" ? (
                        <Button small tone="bt-p" onClick={() => actions.updateTaskStatus(job.id, "in-progress")}>
                          Start
                        </Button>
                      ) : null}
                      {job.status !== "done" ? (
                        <Button small tone="bt-g" onClick={() => actions.updateTaskStatus(job.id, "done")}>
                          Complete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <div className="fa" style={{ marginTop: 10 }}>
                <Button icon={Icons.help} onClick={() => setRfiOpen(true)}>
                  Raise RFI
                </Button>
                <Button tone="bt-p" icon={Icons.shuffle} onClick={() => setVariationOpen(true)}>
                  Submit Variation Request
                </Button>
              </div>
            </Card>

            <Card title="Required Safety Acknowledgements" icon={Icons.shield}>
              <div className="list-stack">
                {state.toolboxTalks
                  .filter((talk) => talk.requiredFor.includes(user.id))
                  .map((talk) => {
                    const done = talk.acknowledgements.some((ack) => ack.userId === user.id);
                    return (
                      <div className="linked-row" key={talk.id}>
                        <div>
                          <div className="b sm">{talk.title}</div>
                          <div className="xs ct3">{talk.date}</div>
                        </div>
                        {done ? (
                          <Badge tone="passed">Acknowledged</Badge>
                        ) : (
                          <Button small tone="bt-p" onClick={() => actions.acknowledgeToolboxTalk(talk.id, user.id, user.name)}>
                            Acknowledge
                          </Button>
                        )}
                      </div>
                    );
                  })}
                {state.swms
                  .filter((swms) => swms.requiredForCompanyIds.includes(companyId))
                  .map((swms) => (
                    <div className="linked-row" key={swms.id}>
                      <div>
                        <div className="b sm">{swms.title}</div>
                        <div className="xs ct3">Required SWMS</div>
                      </div>
                      <Badge tone={swms.acknowledgedBy.includes(user.id) ? "passed" : "high"}>
                        {swms.acknowledgedBy.includes(user.id) ? "Acknowledged" : "Pending"}
                      </Badge>
                    </div>
                  ))}
              </div>
            </Card>
          </div>
        ) : null}

        {currentPage === "rfis" ? (
          <Card title="My RFIs" icon={Icons.help}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {rfis.map((rfi) => (
                    <tr key={rfi.id}>
                      <td className="mono xs">{rfi.number}</td>
                      <td>
                        <div className="b sm">{rfi.title}</div>
                        <div className="xs ct3">{rfi.description}</div>
                      </td>
                      <td>
                        <Badge tone={rfi.status === "responded" ? "passed" : rfi.status === "overdue" ? "critical" : "medium"}>{rfi.status}</Badge>
                      </td>
                      <td className="xs">{rfi.dueDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {currentPage === "invoices" ? (
          <Card title="My Invoices" icon={Icons.dollar}>
            <div className="fa" style={{ marginBottom: 10, justifyContent: "flex-start" }}>
              <Button tone="bt-p" icon={Icons.plus} onClick={() => setInvoiceOpen(true)}>
                New Invoice
              </Button>
            </div>
            <div className="list-stack">
              {invoices.map((invoice) => (
                <div className="linked-row" key={invoice.id}>
                  <div>
                    <div className="b sm">{invoice.number}</div>
                    <div className="xs ct3">
                      {invoice.siteId} · {invoice.period}
                    </div>
                  </div>
                  <div className="fx" style={{ gap: 6 }}>
                    <span className="mono b">${invoice.value.toLocaleString()}</span>
                    <Badge tone={invoice.status === "approved" || invoice.status === "paid" ? "passed" : invoice.status === "submitted" || invoice.status === "under-review" ? "medium" : "low"}>{invoice.status}</Badge>
                    {invoice.status === "draft" ? (
                      <Button small tone="bt-p" onClick={() => actions.setInvoiceStatus(invoice.id, "submitted")}>
                        Submit
                      </Button>
                    ) : null}
                    {invoice.status === "submitted" ? (
                      <Button small onClick={() => actions.setInvoiceStatus(invoice.id, "under-review")}>
                        Review
                      </Button>
                    ) : null}
                    {invoice.status === "under-review" ? (
                      <Button small tone="bt-g" onClick={() => actions.setInvoiceStatus(invoice.id, "approved")}>
                        Approve
                      </Button>
                    ) : null}
                    {invoice.status === "approved" ? (
                      <Button small onClick={() => actions.setInvoiceStatus(invoice.id, "paid")}>
                        Paid
                      </Button>
                    ) : null}
                    <Button
                      small
                      onClick={async (event) => {
                        const node = event.currentTarget.closest(".linked-row");
                        if (node) {
                          await exportElementToPdf({
                            element: node,
                            filename: `${invoice.number}.pdf`,
                            title: invoice.number,
                            subtitle: `${invoice.period} · ${invoice.status}`,
                          });
                        }
                      }}
                    >
                      PDF
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {currentPage === "induction" ? (
          <Card title="Induction Status" icon={Icons.login}>
            {passport ? (
              <div className="list-stack">
                {passport.docs.map((doc) => (
                  <div className="linked-row" key={doc.id}>
                    <div>
                      <div className="b sm">{doc.label}</div>
                      <div className="xs ct3">Site access requirement</div>
                    </div>
                    <Badge tone={doc.status === "complete" ? "passed" : "critical"}>{doc.status}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ct3 sm empty">No induction record loaded.</div>
            )}
          </Card>
        ) : null}

        {currentPage === "passport" ? (
          <Card title="My Site Passport" icon={Icons.qr}>
            {passport ? (
              <>
                <div className="b sm">{passport.person}</div>
                <div className="xs ct3">
                  {passport.company} · {passport.trade}
                </div>
                <div className="fx" style={{ gap: 4, flexWrap: "wrap", marginTop: 10 }}>
                  {passport.permissions.map((permission) => (
                    <span className="tag" key={permission}>
                      {permission}
                    </span>
                  ))}
                </div>
                <div className="list-stack" style={{ marginTop: 12 }}>
                  {passport.acknowledgements.map((ack) => (
                    <div className="linked-row" key={ack.id}>
                      <div>
                        <div className="b sm">{ack.label}</div>
                        <div className="xs ct3">Acknowledgement capture</div>
                      </div>
                      {ack.done ? (
                        <Badge tone="passed">Done</Badge>
                      ) : (
                        <Button small tone="bt-p" onClick={() => actions.updatePassportAcknowledgement(passport.id, ack.id, user.name)}>
                          Acknowledge
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </Card>
        ) : null}

        {currentPage === "messages" ? (
          <Card title="Messages" icon={Icons.chat}>
            <div className="client-thread">
              {threads.flatMap((thread) =>
                thread.messages.map((entry) => (
                  <div className="client-thread-item" key={entry.id}>
                    <div className="b sm">{state.users.find((person) => person.id === entry.by)?.name || "Builder"}</div>
                    <div className="xs client-muted">{entry.at}</div>
                    <div className="client-copy">{entry.body}</div>
                  </div>
                )),
              )}
            </div>
            <div className="client-message-composer">
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Send a message to the builder..." />
              <Button
                tone="bt-p"
                icon={Icons.send}
                onClick={() => {
                  actions.addConversationMessage("subcontractor", companyId, [user.id, "u_pm_1"], message);
                  setMessage("");
                }}
              >
                Send
              </Button>
            </div>
          </Card>
        ) : null}
      </div>

      <Modal open={rfiOpen} close={() => setRfiOpen(false)} title="Raise RFI">
        <div className="ff">
          <label>Title</label>
          <input value={rfiForm.title} onChange={(event) => setRfiForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={rfiForm.description} onChange={(event) => setRfiForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Send To</label>
          <input value={rfiForm.to} onChange={(event) => setRfiForm((current) => ({ ...current, to: event.target.value }))} />
        </div>
        <div className="fa">
          <Button onClick={() => setRfiOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.createRfi({ ...rfiForm, siteId, trade: user.trade, linkedRecords: jobs[0] ? [{ type: "task", id: jobs[0].id, label: jobs[0].title, siteId }] : [] });
              setRfiOpen(false);
              setRfiForm({ title: "", description: "", to: "Project Manager", priority: "medium" });
            }}
          >
            Submit RFI
          </Button>
        </div>
      </Modal>

      <Modal open={variationOpen} close={() => setVariationOpen(false)} title="Submit Variation Request">
        <div className="ff">
          <label>Title</label>
          <input value={variationForm.title} onChange={(event) => setVariationForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Value</label>
            <input value={variationForm.value} onChange={(event) => setVariationForm((current) => ({ ...current, value: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Days</label>
            <input value={variationForm.days} onChange={(event) => setVariationForm((current) => ({ ...current, days: event.target.value }))} />
          </div>
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={variationForm.description} onChange={(event) => setVariationForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="fa">
          <Button onClick={() => setVariationOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.createVariationDraft({
                siteId,
                title: variationForm.title,
                value: variationForm.value,
                days: variationForm.days,
                priority: "medium",
                trade: user.trade,
                sourceType: "subcontractor-request",
                sourceId: companyId,
                linkedRecords: jobs[0] ? [{ type: "task", id: jobs[0].id, label: jobs[0].title, siteId }] : [],
              });
              actions.addConversationMessage(
                "variation-request",
                companyId,
                [user.id, "u_pm_1"],
                `${variationForm.title}: ${variationForm.description || "Variation request submitted for PM review."}`,
              );
              setVariationOpen(false);
              setVariationForm({ title: "", value: "", days: "", description: "" });
            }}
          >
            Send to PM Review
          </Button>
        </div>
      </Modal>
      <Modal open={invoiceOpen} close={() => setInvoiceOpen(false)} title="Create Invoice">
        <div className="ff">
          <label>Invoice Number</label>
          <input value={invoiceForm.number} onChange={(event) => setInvoiceForm((current) => ({ ...current, number: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Value</label>
          <input value={invoiceForm.value} onChange={(event) => setInvoiceForm((current) => ({ ...current, value: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Notes</label>
          <textarea value={invoiceForm.notes} onChange={(event) => setInvoiceForm((current) => ({ ...current, notes: event.target.value }))} />
        </div>
        <div className="fa">
          <Button onClick={() => setInvoiceOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.createInvoiceDraft({
                companyId,
                siteId,
                number: invoiceForm.number,
                value: invoiceForm.value,
                notes: invoiceForm.notes,
              });
              setInvoiceOpen(false);
              setInvoiceForm({ number: "", value: "", notes: "" });
            }}
          >
            Save Draft
          </Button>
        </div>
      </Modal>
    </div>
  );
}
