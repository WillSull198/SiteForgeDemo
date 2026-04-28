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
