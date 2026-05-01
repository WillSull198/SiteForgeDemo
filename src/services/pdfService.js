let cachedScripts = new Map();

function loadScriptOnce(key, src) {
  if (cachedScripts.has(key)) return cachedScripts.get(key);
  const promise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Browser only"));
      return;
    }
    const existing = document.querySelector(`script[data-pdf-script="${key}"]`);
    if (existing) {
      if (existing.dataset.ready === "true") resolve(window);
      else {
        existing.addEventListener("load", () => resolve(window), { once: true });
        existing.addEventListener("error", reject, { once: true });
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.pdfScript = key;
    script.onload = () => {
      script.dataset.ready = "true";
      resolve(window);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  cachedScripts.set(key, promise);
  return promise;
}

export async function ensurePdfTooling() {
  await Promise.all([
    loadScriptOnce("html2canvas", "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
    loadScriptOnce("jspdf", "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
  ]);
  return {
    html2canvas: window.html2canvas,
    jsPDF: window.jspdf?.jsPDF,
  };
}

function pageFooter(doc, page, pageCount, label) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(8);
  doc.setTextColor(110, 115, 122);
  doc.text(`${label} · Generated ${new Date().toLocaleString("en-AU")}`, 14, pageHeight - 10);
  doc.text(`Page ${page} of ${pageCount}`, pageWidth - 30, pageHeight - 10);
}

function stripHtml(value = "") {
  const div = typeof document !== "undefined" ? document.createElement("div") : null;
  if (!div) return String(value).replace(/<[^>]+>/g, " ");
  div.innerHTML = String(value);
  return div.textContent || div.innerText || "";
}

function formatABN(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 ? `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}` : value;
}

export async function generateSignedContractPdfBlob({ contractPack, approval, builder = {}, client = {} }) {
  const { jsPDF } = await ensurePdfTooling();
  if (!jsPDF) throw new Error("PDF tooling unavailable.");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  if (builder.logoDataUrl) {
    try {
      const logoType = /^data:image\/png/i.test(builder.logoDataUrl) ? "PNG" : "JPEG";
      doc.addImage(builder.logoDataUrl, logoType, margin, y, 34, 14);
      y += 18;
    } catch (error) {
      y += 3;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  doc.text(builder.name || builder.companyName || builder.legalName || "SiteForge Builder", margin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  if (builder.abn) {
    doc.text(`ABN: ${formatABN(builder.abn)}`, margin, y);
    y += 4;
  }
  if (builder.address) {
    const addressLines = doc.splitTextToSize(builder.address, contentWidth);
    doc.text(addressLines, margin, y);
    y += addressLines.length * 4;
  }
  doc.setDrawColor(210, 210, 210);
  doc.line(margin, y + 2, pageWidth - margin, y + 2);
  y += 9;

  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(approval?.title || contractPack.template || "Executed Contract", margin, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Client: ${client.primaryContact || client.name || "Client"}`, margin, y);
  y += 5;
  doc.text(`Document: ${contractPack.docId}`, margin, y);
  y += 8;

  const body =
    contractPack.content?.templateBody ||
    (contractPack.content?.sections || [])
      .map((section) => `${section.heading}\n${(section.clauses || []).join("\n\n")}`)
      .join("\n\n");
  const lines = doc.splitTextToSize(stripHtml(body), contentWidth);
  doc.setFontSize(10);
  for (const line of lines) {
    if (y > pageHeight - 28) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += 5;
  }

  const signature = contractPack.signatures?.client;
  if (y > pageHeight - 58) {
    doc.addPage();
    y = margin;
  }
  y += 8;
  doc.setDrawColor(210, 210, 210);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Electronic Signature Record", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Signed by: ${signature?.name || "Pending"}`, margin, y);
  y += 5;
  doc.text(`Date / time: ${signature?.signedAt || "Pending"}`, margin, y);
  y += 5;
  if (signature?.documentHash) {
    doc.text(`Document hash: ${signature.documentHash}`, margin, y);
    y += 5;
  }
  doc.setFontSize(8);
  doc.setTextColor(110, 115, 122);
  doc.text("Signed electronically pursuant to the Electronic Transactions Act 1999 (Cth)", margin, y);

  const totalPages = doc.internal.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    pageFooter(doc, page, totalPages, `${contractPack.docId} · ${approval?.number || approval?.id || "Contract"}`);
  }

  return doc.output("blob");
}

export async function generateTransmittalPdfBlob({ transmittal, documents = [], sender = "SiteForge", site = {} }) {
  const { jsPDF } = await ensurePdfTooling();
  if (!jsPDF) throw new Error("PDF tooling unavailable.");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Document Transmittal", margin, y);
  y += 8;
  doc.setFontSize(11);
  doc.text(transmittal.number || transmittal.id, margin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Project: ${site.name || transmittal.siteId}`, margin, y);
  y += 5;
  doc.text(`From: ${sender}`, margin, y);
  y += 5;
  doc.text(`To: ${(transmittal.recipients || []).map((entry) => entry.name || entry.email || entry.id).join(", ") || "Recipients"}`, margin, y);
  y += 5;
  doc.text(`Purpose: ${transmittal.purpose}`, margin, y);
  y += 8;

  doc.setDrawColor(210, 210, 210);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.text("Documents issued", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  documents.forEach((document, index) => {
    if (y > 270) {
      doc.addPage();
      y = margin;
    }
    const line = `${index + 1}. ${document.title} ${document.rev || ""} - ${document.category || "Document"}`;
    doc.text(doc.splitTextToSize(line, pageWidth - margin * 2), margin, y);
    y += 7;
  });

  y += 6;
  doc.setFontSize(8);
  doc.setTextColor(110, 115, 122);
  doc.text("Recipient acknowledgement is recorded in SiteForge with timestamp and audit evidence.", margin, y);

  const totalPages = doc.internal.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    pageFooter(doc, page, totalPages, transmittal.number || "Transmittal");
  }

  return doc.output("blob");
}

export async function generateOperationsReportPdfBlob({ report, company = {}, site = {} }) {
  const { jsPDF } = await ensurePdfTooling();
  if (!jsPDF) throw new Error("PDF tooling unavailable.");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const writeLine = (text, options = {}) => {
    const size = options.size || 10;
    const font = options.bold ? "bold" : "normal";
    doc.setFont("helvetica", font);
    doc.setFontSize(size);
    doc.setTextColor(options.color || 25, options.color || 25, options.color || 25);
    const lines = doc.splitTextToSize(String(text || ""), contentWidth);
    lines.forEach((line) => {
      if (y > pageHeight - 24) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += options.lineHeight || 5;
    });
  };

  if (company.logoDataUrl) {
    try {
      const logoType = /^data:image\/png/i.test(company.logoDataUrl) ? "PNG" : "JPEG";
      doc.addImage(company.logoDataUrl, logoType, margin, y, 30, 12);
      y += 16;
    } catch {
      y += 2;
    }
  }

  writeLine(company.name || company.legalName || "SiteForge", { size: 16, bold: true, lineHeight: 7 });
  writeLine(report.title, { size: 14, bold: true, lineHeight: 7 });
  writeLine(`${site.name || report.siteName || "Portfolio"} · ${report.period || new Date().toLocaleDateString("en-AU")}`, { size: 9, color: 80 });
  y += 3;
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;

  writeLine(report.summary || "Operations report generated by SiteForge.", { size: 10, lineHeight: 5 });
  y += 4;

  (report.sections || []).forEach((section) => {
    writeLine(section.heading, { size: 12, bold: true, lineHeight: 7 });
    (section.lines || []).forEach((line) => writeLine(`• ${line}`, { size: 10, lineHeight: 5 }));
    if (section.rows?.length) {
      section.rows.forEach((row) => writeLine(`• ${Object.values(row).join(" · ")}`, { size: 9, color: 70, lineHeight: 4.5 }));
    }
    y += 3;
  });

  const totalPages = doc.internal.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    pageFooter(doc, page, totalPages, report.number || report.id || "Operations report");
  }

  return doc.output("blob");
}

export async function exportElementToPdf({
  element,
  filename = "siteforge-export.pdf",
  title = "SiteForge Export",
  subtitle = "",
  watermark = "",
}) {
  if (!element) return;
  const { html2canvas, jsPDF } = await ensurePdfTooling();
  if (!html2canvas || !jsPDF) {
    throw new Error("PDF tooling unavailable.");
  }

  const canvas = await html2canvas(element, { backgroundColor: "#ffffff", scale: 2 });
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const headerHeight = 18;
  const usableWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * usableWidth) / canvas.width;

  let remaining = imgHeight;
  let offset = 0;
  let page = 1;
  const pageCount = Math.max(1, Math.ceil(imgHeight / (pageHeight - headerHeight - 18)));

  while (remaining > 0) {
    if (page > 1) pdf.addPage();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text("SiteForge", margin, 10);
    pdf.setFontSize(11);
    pdf.text(title, margin, 16);
    if (subtitle) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text(subtitle, margin, 21);
    }
    if (watermark) {
      pdf.setTextColor(220, 220, 220);
      pdf.setFontSize(44);
      pdf.text(watermark, pageWidth / 2, pageHeight / 2, { angle: 35, align: "center" });
      pdf.setTextColor(0, 0, 0);
    }

    pdf.addImage(
      imgData,
      "PNG",
      margin,
      headerHeight - offset,
      usableWidth,
      imgHeight,
      undefined,
      "FAST",
    );
    pageFooter(pdf, page, pageCount, title);
    remaining -= pageHeight - headerHeight - 18;
    offset += pageHeight - headerHeight - 18;
    page += 1;
  }

  pdf.save(filename);
}

export function exportCsv(filename, headers, rows) {
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      row
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
