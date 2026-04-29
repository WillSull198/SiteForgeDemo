import { useEffect, useMemo, useState } from "react";
import ContractViewer from "../components/ContractViewer";
import FileDropZone from "../components/FileDropZone";
import { useSiteForge } from "../services/siteforgeStore";
import { getBlob } from "../services/documentIntelligence";
import { exportElementToPdf } from "../services/pdfService";
import { can } from "../services/permissions";
import { Icons } from "../components/icons";
import { Badge, Button, Card, Modal, Tabs } from "../components/ui";

const KNOWN_MERGE_TOKENS = [
  "project.name",
  "client.name",
  "builder.name",
  "builder.abn",
  "site.address",
  "approval.cost",
  "approval.days",
  "approval.summary",
  "approval.reason",
  "approval.number",
  "signature.client",
  "date.today",
];

export default function ContractStudio() {
  const { state, actions } = useSiteForge();
  const role = state.session.role;
  const [tab, setTab] = useState("review");
  const [selectedTemplateId, setSelectedTemplateId] = useState(state.contractTemplates[0]?.id || null);
  const [selectedContractId, setSelectedContractId] = useState(state.contractPacks[0]?.docId || null);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [attachmentName, setAttachmentName] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [templateDraft, setTemplateDraft] = useState("");
  const [templateForm, setTemplateForm] = useState({
    name: "",
    type: "Variation",
    branding: "",
    sourceContent: "",
  });
  const [clauseForm, setClauseForm] = useState({ title: "", text: "", tags: "commercial" });
  const [tokenAliases, setTokenAliases] = useState({});

  const templates = state.contractTemplates;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || templates[0];
  const reviewQueue = state.contractPacks.filter((pack) => pack.status !== "signed");
  const archive = state.contractPacks.filter((pack) => pack.status === "signed");
  const selectedContract = state.contractPacks.find((pack) => pack.docId === selectedContractId) || state.contractPacks[0] || null;
  const selectedApproval = state.approvals.find((approval) => approval.id === selectedContract?.approvalId) || null;
  const selectedSite = state.sites.find((site) => site.id === selectedContract?.siteId) || null;
  const selectedClient = state.clients.find((client) => client.id === selectedApproval?.clientId) || null;

  const canAdmin = can(role, "contracts.edit_draft");
  const canBuilderReview = can(role, "contracts.sign_builder");

  const clauseSuggestions = useMemo(() => {
    if (!selectedTemplate) return [];
    return state.clauseLibrary.filter((clause) =>
      selectedTemplate.clauses.some((templateClause) =>
        templateClause.toLowerCase().includes(clause.title.split(" ")[0].toLowerCase()) ||
        clause.text.toLowerCase().includes(selectedTemplate.type.toLowerCase().split(" ")[0]),
      ),
    );
  }, [selectedTemplate, state.clauseLibrary]);

  useEffect(() => {
    setTemplateDraft(selectedTemplate?.sourceContent || selectedTemplate?.clauses?.join("\n") || "");
    setTokenAliases(selectedTemplate?.tokenAliases || {});
  }, [selectedTemplate]);

  const buildPrintNode = (pack) => {
    const approval = state.approvals.find((entry) => entry.id === pack.approvalId);
    const site = state.sites.find((entry) => entry.id === pack.siteId);
    const client = state.clients.find((entry) => entry.id === approval?.clientId);
    const node = document.createElement("div");
    node.className = "contract-viewer";
    node.style.position = "fixed";
    node.style.left = "-9999px";
    node.style.top = "0";
    node.style.width = "900px";
    node.innerHTML = `
      <div class="document-view ${pack.status === "contract-drafted" ? "draft" : ""}">
        <div class="document-watermark">${pack.status === "contract-drafted" ? "DRAFT" : ""}</div>
        <div class="document-header">
          <div>
            <div class="document-title">${approval?.type || pack.template}</div>
            <div class="document-subtitle">${approval?.title || pack.template}</div>
          </div>
          <div class="tr">
            <div class="mono xs">Document ${pack.docId}</div>
            <div class="xs">Project: ${site?.name || "-"}</div>
            <div class="xs">Client: ${client?.primaryContact || client?.name || "-"}</div>
          </div>
        </div>
        ${(pack.content?.sections || [])
          .map(
            (section) => `
              <section class="document-section">
                <h3>${section.heading}</h3>
                ${section.clauses.map((clause) => `<p>${clause}</p>`).join("")}
              </section>
            `,
          )
          .join("")}
        <div class="document-footer">
          <span>SiteForge Contract Studio</span>
          <span>${pack.docId}</span>
        </div>
      </div>
    `;
    document.body.appendChild(node);
    return node;
  };

  const downloadContractPdf = async (pack) => {
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
    const activeNode = document.querySelector(".contract-viewer");
    const useActiveNode = activeNode && selectedContract?.docId === pack.docId;
    const node = useActiveNode ? activeNode : buildPrintNode(pack);
    try {
      await exportElementToPdf({
        element: node,
        filename: `${pack.docId}.pdf`,
        title: pack.docId,
        subtitle: `${pack.template} · ${pack.status}`,
        watermark: pack.status === "signed" ? "" : "DRAFT",
      });
    } finally {
      if (!useActiveNode) {
        node.remove();
      }
    }
  };

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "review", label: "Pending Review" },
            { value: "templates", label: "Template Library" },
            { value: "clauses", label: "Clause Library" },
            { value: "archive", label: "Signed Archive" },
          ]}
        />
        <div className="fx" style={{ gap: 6 }}>
          <Badge tone={canAdmin ? "passed" : "medium"}>{canAdmin ? "Full authority" : "Review only"}</Badge>
        </div>
      </div>

      {tab === "review" ? (
        <div className="g32">
          <Card title="Review Queue" icon={Icons.file}>
            <div className="list-stack">
              {reviewQueue.map((pack) => {
                const approval = state.approvals.find((item) => item.id === pack.approvalId);
                return (
                  <div className="act" key={pack.docId}>
                    <button className="text-button" type="button" onClick={() => setSelectedContractId(pack.docId)}>
                      <div className="b sm">{pack.docId}</div>
                      <div className="xs ct3">
                        {approval?.title} · {pack.status}
                      </div>
                    </button>
                    <Badge tone={pack.status === "contract-drafted" ? "medium" : pack.status === "builder-signature-pending" ? "high" : "passed"}>
                      {pack.status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </Card>

          <div>
            <Card title="Contract Preview" icon={Icons.book}>
              {selectedContract ? (
                <div className="ff">
                  <label>Template</label>
                  <select value={selectedContract.templateId || ""} onChange={(event) => actions.assignTemplateToContract(selectedContract.docId, event.target.value)}>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <ContractViewer
                contractPack={selectedContract}
                approval={selectedApproval}
                site={selectedSite}
                client={selectedClient}
                role={role}
                onBuilderSign={(contractId, name) => actions.signBuilderContract(contractId, name)}
                onArchive={(contractId) => actions.archiveContract(contractId)}
              />
            </Card>
            {selectedContract ? (
              <Card title="Review Actions" icon={Icons.check} className="mb8" bodyClassName="contract-actions-card">
                <div className="ff">
                  <label>Review note or PM request</label>
                  <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
                </div>
                <div className="fa">
                  <Button icon={Icons.download} onClick={() => selectedContract && downloadContractPdf(selectedContract)}>
                    Download PDF
                  </Button>
                  <Button icon={Icons.plus} onClick={() => setAttachmentOpen(true)}>
                    Add Attachment
                  </Button>
                  {canAdmin ? (
                    <>
                      <Button icon={Icons.alert} onClick={() => actions.requestContractChanges(selectedContract.docId, reviewNote || "Please update the commercial wording before release.")}>
                        Request PM Changes
                      </Button>
                      <Button tone="bt-p" icon={Icons.check} onClick={() => actions.approveContractDraft(selectedContract.docId)}>
                        Approve Draft
                      </Button>
                    </>
                  ) : null}
                  {canBuilderReview && selectedContract.status === "builder-signature-pending" ? (
                    <Button tone="bt-p" icon={Icons.check} onClick={() => actions.signBuilderContract(selectedContract.docId)}>
                      Sign Builder Side
                    </Button>
                  ) : null}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "templates" ? (
        <div className="g32">
          <Card title="Template Library" icon={Icons.file}>
            <div className="fa" style={{ marginBottom: 12, justifyContent: "flex-start" }}>
              <Button tone="bt-p" icon={Icons.plus} onClick={() => setTemplateOpen(true)}>
                New Template
              </Button>
            </div>
            <FileDropZone
              label="Upload Template"
              description="Drop DOCX, TXT, MD or PDF templates. Merge fields will be detected automatically and saved for reuse."
              onFiles={async (files) => {
                if (files?.length) {
                  const templateIds = await actions.uploadTemplateFiles(files);
                  if (templateIds?.[0]) {
                    setSelectedTemplateId(templateIds[0]);
                    setTab("templates");
                  }
                }
              }}
            />
            <div className="list-stack">
              {templates.map((template) => (
                <div className="act" key={template.id}>
                  <button className="text-button" type="button" onClick={() => setSelectedTemplateId(template.id)}>
                    <div className="b sm">{template.name}</div>
                    <div className="xs ct3">
                      {template.type} · {template.version}
                    </div>
                  </button>
                  <Badge tone="passed">{template.status}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card title={selectedTemplate?.name || "Template Preview"} icon={Icons.book}>
            {selectedTemplate ? (
              <>
                <div className="client-copy">{selectedTemplate.branding}</div>
                <div className="list-stack" style={{ marginTop: 10 }}>
                  {(selectedTemplate.mergeTokens || []).length ? (
                    (selectedTemplate.mergeTokens || []).map((token) => {
                      const mapped = tokenAliases[token] || token;
                      const known = KNOWN_MERGE_TOKENS.includes(mapped);
                      return (
                        <div className="linked-row" key={token}>
                          <div>
                            <div className="b sm">{`{{${token}}}`}</div>
                            <div className="xs ct3">{known ? `Maps to ${mapped}` : "Unknown token - map before activating"}</div>
                          </div>
                          <div className="fx" style={{ gap: 6 }}>
                            <Badge tone={known ? "passed" : "high"}>{known ? "Matched" : "Needs mapping"}</Badge>
                            <select
                              className="inline-input"
                              value={tokenAliases[token] || (KNOWN_MERGE_TOKENS.includes(token) ? token : "")}
                              onChange={(event) =>
                                setTokenAliases((current) => {
                                  const next = { ...current };
                                  if (event.target.value) next[token] = event.target.value;
                                  else delete next[token];
                                  return next;
                                })
                              }
                            >
                              <option value="">Leave unresolved</option>
                              {KNOWN_MERGE_TOKENS.map((knownToken) => (
                                <option key={knownToken} value={knownToken}>
                                  {knownToken}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="xs ct3">No merge tokens detected in this template.</div>
                  )}
                </div>
                <div className="ff" style={{ marginTop: 12 }}>
                  <label>Template body</label>
                  <textarea
                    value={templateDraft}
                    onChange={(event) => setTemplateDraft(event.target.value)}
                  />
                </div>
                <div className="fa" style={{ justifyContent: "flex-start" }}>
                  <Button
                    small
                    tone="bt-p"
                    onClick={() =>
                      actions.saveTemplateVersion(selectedTemplate.id, {
                        sourceContent: templateDraft,
                        clauses: templateDraft.split("\n").filter(Boolean),
                        branding: selectedTemplate.branding,
                        tokenAliases,
                        status: "active",
                      })
                    }
                  >
                    Save New Version
                  </Button>
                  <Button small onClick={() => actions.duplicateEntity("template", selectedTemplate.id)}>
                    Duplicate
                  </Button>
                  <Button small tone="bt-r" onClick={() => actions.archiveEntity("template", selectedTemplate.id)}>
                    Archive
                  </Button>
                </div>
                <div className="list-stack" style={{ marginTop: 10 }}>
                  {selectedTemplate.clauses.map((clause, index) => (
                    <div className="act" key={`${selectedTemplate.id}-${index}`}>
                      <div className="xs ct3">{index + 1}</div>
                      <div className="sm ct2">{clause}</div>
                    </div>
                  ))}
                </div>
                <div className="mini-panel" style={{ marginTop: 12 }}>
                  <div className="xs ct3">Template Marketplace</div>
                  <div className="fx" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {state.templateMarketplace.map((item) => (
                      <span className="tag" key={item.id}>
                        {item.name} · {item.status}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="xs ct3" style={{ marginTop: 12 }}>
                  Version history
                </div>
                <div className="list-stack" style={{ marginTop: 8 }}>
                  {selectedTemplate.versionHistory.map((entry) => (
                    <div className="linked-row" key={entry.id}>
                      <div>
                        <div className="b sm">{entry.version}</div>
                        <div className="xs ct3">
                          {entry.at} · {entry.by}
                        </div>
                      </div>
                      <Badge tone="medium">Saved</Badge>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "clauses" ? (
        <div className="g2">
          <Card title="Suggested Clauses" icon={Icons.plus}>
            <div className="list-stack">
              {clauseSuggestions.map((clause) => (
                <div className="act" key={clause.id}>
                  <div style={{ flex: 1 }}>
                    <div className="b sm">{clause.title}</div>
                    <div className="sm ct2">{clause.text}</div>
                  </div>
                  <Button
                    small
                    tone="bt-p"
                    onClick={() =>
                      selectedContract &&
                      actions.editContractClause(
                        selectedContract.docId,
                        2,
                        (selectedContract.content.sections[2]?.clauses?.length || 1) - 1,
                        `${selectedContract.content.sections[2]?.clauses?.join(" ")} ${clause.text}`,
                      )
                    }
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Clause Library" icon={Icons.clipboard}>
            <div className="ff">
              <label>New clause title</label>
              <input value={clauseForm.title} onChange={(event) => setClauseForm((current) => ({ ...current, title: event.target.value }))} />
            </div>
            <div className="ff">
              <label>Clause text</label>
              <textarea value={clauseForm.text} onChange={(event) => setClauseForm((current) => ({ ...current, text: event.target.value }))} />
            </div>
            <div className="fa" style={{ justifyContent: "flex-start" }}>
              <Button
                small
                tone="bt-p"
                onClick={() => {
                  actions.createClause({ title: clauseForm.title, text: clauseForm.text, tags: clauseForm.tags.split(",").map((item) => item.trim()) });
                  setClauseForm({ title: "", text: "", tags: "commercial" });
                }}
              >
                Add Clause
              </Button>
            </div>
            <div className="list-stack">
              {state.clauseLibrary.map((clause) => (
                <div className="act" key={clause.id}>
                  <div>
                    <div className="b sm">{clause.title}</div>
                    <div className="sm ct2">{clause.text}</div>
                    <div className="fx" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {(clause.tags || []).map((tag) => (
                        <span className="tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "archive" ? (
        <Card title="Executed Contract Archive" icon={Icons.download}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Approval</th>
                  <th>Status</th>
                  <th>Signed</th>
                  <th>Archive</th>
                </tr>
              </thead>
              <tbody>
                {archive.map((pack) => (
                  <tr key={pack.docId}>
                    <td className="mono xs">{pack.docId}</td>
                    <td className="b sm">{state.approvals.find((approval) => approval.id === pack.approvalId)?.title}</td>
                    <td>
                      <Badge tone="passed">{pack.status}</Badge>
                    </td>
                    <td className="xs">{pack.signatures.client?.signedAt}</td>
                    <td>
                      <Button small tone="bt-p" onClick={() => downloadContractPdf(pack)}>
                        Download PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Modal open={attachmentOpen} close={() => setAttachmentOpen(false)} title="Add Supporting Attachment">
        <div className="ff">
          <label>Attachment Name</label>
          <input value={attachmentName} onChange={(event) => setAttachmentName(event.target.value)} placeholder="e.g. Revised supplier quote.pdf" />
        </div>
        <div className="fa">
          <Button onClick={() => setAttachmentOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              if (selectedContract && attachmentName.trim()) {
                actions.addContractAttachment(selectedContract.docId, attachmentName.trim());
              }
              setAttachmentOpen(false);
              setAttachmentName("");
            }}
          >
            Add Attachment
          </Button>
        </div>
      </Modal>
      <Modal open={templateOpen} close={() => setTemplateOpen(false)} title="New Template" wide>
        <div className="g2">
          <div className="ff">
            <label>Name</label>
            <input value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Approval Type</label>
            <select value={templateForm.type} onChange={(event) => setTemplateForm((current) => ({ ...current, type: event.target.value }))}>
              {["Variation", "Rain Day", "Extension of Time", "Delay Notice", "Selection Upgrade", "Price Escalation", "Scope Clarification"].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="ff">
          <label>Branding</label>
          <input value={templateForm.branding} onChange={(event) => setTemplateForm((current) => ({ ...current, branding: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Rich Text / Template Body</label>
          <textarea
            value={templateForm.sourceContent}
            onChange={(event) => setTemplateForm((current) => ({ ...current, sourceContent: event.target.value }))}
            placeholder={"SiteForge template\n{{client.name}}\n{{site.name}}\n{{approval.summary}}"}
          />
        </div>
        <div className="fx" style={{ gap: 6, flexWrap: "wrap" }}>
          {(templateForm.sourceContent.match(/\{\{([^}]+)\}\}/g) || []).map((token) => (
            <span className="tag" key={token}>
              {token}
            </span>
          ))}
        </div>
        <div className="fa">
          <Button onClick={() => setTemplateOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.createTemplate(templateForm);
              setTemplateOpen(false);
              setTemplateForm({ name: "", type: "Variation", branding: "", sourceContent: "" });
            }}
          >
            Save Template
          </Button>
        </div>
      </Modal>
    </div>
  );
}
