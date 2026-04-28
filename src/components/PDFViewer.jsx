/* SiteForge audit: Added a real PDF.js full-screen viewer for uploaded plans:
   canvas rendering, page navigation, zoom, download, escape close, and loading
   states. This replaces first-page-only previews for plan review workflows. */

import { useEffect, useRef, useState } from "react";
import { getStoredFileBlob, loadPdfJs } from "../services/documentIntelligence";
import { Icons, renderIcon } from "./icons";

export default function PDFViewer({ fileMeta, onClose }) {
  const canvasRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.35);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let loadedPdf = null;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const blob = fileMeta?.blob || (fileMeta?.id ? await getStoredFileBlob(fileMeta.id) : null);
        if (!blob) throw new Error("The PDF file is not available in IndexedDB.");
        const pdfjs = await loadPdfJs();
        const data = await blob.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data }).promise;
        loadedPdf = pdf;
        if (cancelled) {
          pdf.destroy?.();
          return;
        }
        if (!cancelled) {
          setPdfDoc(pdf);
          setPageNum(1);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Unable to render this PDF.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      loadedPdf?.destroy?.();
    };
  }, [fileMeta]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    async function renderPage() {
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (cancelled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const task = page.render({ canvasContext: context, viewport });
        await task.promise;
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError.message || "Unable to render this PDF page.");
        }
      }
    }
    renderPage();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNum, scale]);

  const download = async () => {
    const blob = fileMeta?.blob || (fileMeta?.id ? await getStoredFileBlob(fileMeta.id) : null);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileMeta.name || "siteforge-plan.pdf";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pdf-viewer-overlay">
      <div className="pdf-toolbar">
        <button type="button" onClick={onClose}>{renderIcon(Icons.x, 14)} Close</button>
        <button type="button" disabled={!pdfDoc || pageNum <= 1} onClick={() => setPageNum((page) => Math.max(1, page - 1))}>‹</button>
        <span>{pageNum} / {pdfDoc?.numPages || "-"}</span>
        <button type="button" disabled={!pdfDoc || pageNum >= pdfDoc.numPages} onClick={() => setPageNum((page) => Math.min(pdfDoc.numPages, page + 1))}>›</button>
        <button type="button" onClick={() => setScale((value) => Math.max(0.6, value - 0.2))}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => setScale((value) => Math.min(2.4, value + 0.2))}>+</button>
        <button type="button" onClick={download}>{renderIcon(Icons.download, 14)} Download</button>
      </div>
      <div className="pdf-canvas-container">
        {loading ? <div className="pdf-skeleton">Loading drawing...</div> : null}
        {error ? <div className="pdf-error">{error}</div> : null}
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
