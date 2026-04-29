import { useMemo, useState } from "react";
import { Icons, renderIcon } from "./icons";
import { exportElementToPdf } from "../services/pdfService";
import { getBlob } from "../services/documentIntelligence";
import { can, routeKindForRole } from "../services/permissions";
import { Button } from "./ui";

const downloadContract = async (contractPack) => {
  if (!contractPack) return;
  if (contractPack.executedPdfBlobId) {
    const blob = await getBlob(contractPack.executedPdfBlobId);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${contractPack.docId}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }
  }
  const node = document.querySelector(".contract-viewer");
  if (!node) return;
  await exportElementToPdf({
    element: node,
    filename: `${contractPack.docId}.pdf`,
    title: contractPack.docId,
    subtitle: `${contractPack.template} · ${contractPack.status}`,
    watermark: contractPack.status === "signed" ? "" : "DRAFT",
  });
};

const labelForState = (status) => {
  if (status === "contract-drafted") return "Draft";
  if (status === "builder-signature-pending") return "Awaiting Builder";
  if (status === "contract-awaiting-client") return "Awaiting Client";
  if (status === "signed") return "Fully Executed";
  return status;
};

export default function ContractViewer({
  contractPack,
  approval,
  site,
  client,
  role,
  onBuilderSign,
  onClientSign,
  onArchive,
}) {
  const [builderName, setBuilderName] = useState("");
  const [clientName, setClientName] = useState("");
  const [builderAck, setBuilderAck] = useState(false);
  const [clientAck, setClientAck] = useState(false);

  const pageSections = useMemo(() => contractPack?.content?.sections || [], [contractPack]);

  if (!contractPack) {
    return <div className="restricted">Select a contract pack to preview the document.</div>;
  }

  return (
    <div className="contract-shell contract-viewer">
      <div className="contract-toolbar">
        <div>
          <div className="fx" style={{ gap: 6 }}>
            <span className={`bg ${contractPack.status === "signed" ? "passed" : "medium"}`}>{labelForState(contractPack.status)}</span>
            <div className="mono xs ct3">{contractPack.docId}</div>
          </div>
          <div className="md bb" style={{ marginTop: 5 }}>
            {approval?.title || contractPack.template}
          </div>
          <div className="xs ct3" style={{ marginTop: 2 }}>
            {site?.name} · {client?.name || client?.primaryContact}
          </div>
        </div>
        <div className="fx" style={{ gap: 5, flexWrap: "wrap" }}>
          {contractPack.status === "signed" ? (
            <Button small tone="bt-p" icon={Icons.download} onClick={() => downloadContract(contractPack)}>
              Download PDF
            </Button>
          ) : null}
          {can(role, "contracts.archive") ? (
            <Button small icon={Icons.box} onClick={() => onArchive?.(contractPack.docId)}>
              Archive
            </Button>
          ) : null}
        </div>
      </div>

      <div className={`document-view ${contractPack.status === "contract-drafted" ? "draft" : ""}`}>
        <div className="document-watermark">{contractPack.status === "contract-drafted" ? "DRAFT" : ""}</div>
        <div className="document-header">
          <div>
            <div className="document-title">{approval?.type || contractPack.template}</div>
            <div className="document-subtitle">{approval?.title}</div>
          </div>
          <div className="tr">
            <div className="mono xs">Document {contractPack.docId}</div>
            <div className="xs">Project: {site?.name}</div>
            <div className="xs">Client: {client?.primaryContact || client?.name}</div>
          </div>
        </div>

        {pageSections.map((section, index) => (
          <section className="document-section" key={`${section.heading}-${index}`}>
            <h3>{section.heading}</h3>
            {section.clauses.map((clause, clauseIndex) => (
              <p key={`${section.heading}-${clauseIndex}`}>{clause}</p>
            ))}
          </section>
        ))}

        <section className="document-section">
          <h3>Execution</h3>
          <div className="signature-grid">
            <div className="signature-card">
              <div className="xs ct3">Builder Signatory</div>
              {contractPack.signatures.builder ? (
                <>
                  <div className="bb" style={{ marginTop: 8 }}>
                    {contractPack.signatures.builder.name}
                  </div>
                  <div className="xs ct3">{contractPack.signatures.builder.role}</div>
                  <div className="xs ct3" style={{ marginTop: 5 }}>
                    Signed {contractPack.signatures.builder.signedAt}
                  </div>
                </>
              ) : (
                <>
                  <input
                    className="sig-input"
                    placeholder="Typed name"
                    value={builderName}
                    onChange={(event) => setBuilderName(event.target.value)}
                  />
                  <label className="sig-check">
                    <input type="checkbox" checked={builderAck} onChange={(event) => setBuilderAck(event.target.checked)} />
                    I acknowledge this contract is ready to release.
                  </label>
                  {can(role, "contracts.sign_builder") && contractPack.status === "builder-signature-pending" ? (
                    <Button
                      small
                      tone="bt-p"
                      icon={Icons.check}
                      onClick={() => builderName.trim() && builderAck && onBuilderSign?.(contractPack.docId, builderName.trim())}
                    >
                      Sign as Builder
                    </Button>
                  ) : null}
                </>
              )}
            </div>

            <div className="signature-card">
              <div className="xs ct3">Client Signatory</div>
              {contractPack.signatures.client ? (
                <>
                  <div className="bb" style={{ marginTop: 8 }}>
                    {contractPack.signatures.client.name}
                  </div>
                  <div className="xs ct3">{contractPack.signatures.client.role}</div>
                  <div className="xs ct3" style={{ marginTop: 5 }}>
                    Signed {contractPack.signatures.client.signedAt}
                  </div>
                </>
              ) : (
                <>
                  <input className="sig-input" placeholder="Typed name" value={clientName} onChange={(event) => setClientName(event.target.value)} />
                  <label className="sig-check">
                    <input type="checkbox" checked={clientAck} onChange={(event) => setClientAck(event.target.checked)} />
                    I confirm I have read and understand this contract.
                  </label>
                  {routeKindForRole(role) === "client" && contractPack.status === "contract-awaiting-client" ? (
                    <Button
                      small
                      tone="bt-p"
                      icon={Icons.check}
                      onClick={() => clientName.trim() && clientAck && onClientSign?.(contractPack.docId, clientName.trim())}
                    >
                      Sign as Client
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>

        <div className="document-footer">
          <span>SiteForge Contract Studio</span>
          <span>Page 1 of 1</span>
        </div>
      </div>

      <div className="contract-meta-grid">
        <div className="cd">
          <div className="cd-b">
            <div className="xs ct3">Template</div>
            <div className="b sm" style={{ marginTop: 4 }}>
              {contractPack.template}
            </div>
            <div className="xs ct3" style={{ marginTop: 8 }}>
              Created {contractPack.createdAt}
            </div>
          </div>
        </div>
        <div className="cd">
          <div className="cd-b">
            <div className="xs ct3">Attachments</div>
            <div className="sm ct2" style={{ marginTop: 4 }}>
              {(contractPack.attachments || []).length
                ? contractPack.attachments.map((attachment) => attachment.name).join(", ")
                : "No supporting attachments added."}
            </div>
          </div>
        </div>
        <div className="cd">
          <div className="cd-b">
            <div className="xs ct3">Audit Trail</div>
            <div className="sm ct2" style={{ marginTop: 4 }}>
              {(contractPack.auditLog || []).slice(0, 3).map((entry) => (
                <div key={entry.id} style={{ marginBottom: 6 }}>
                  <div className="b sm">{entry.action}</div>
                  <div className="xs ct3">
                    {entry.by} · {entry.at}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {contractPack.status === "signed" ? (
        <div className="executed-banner">
          {renderIcon(Icons.check, 14)}
          <span>
            Contract fully executed. {contractPack.pdfArchiveLabel || "Archive ready"}.
          </span>
        </div>
      ) : null}
    </div>
  );
}
