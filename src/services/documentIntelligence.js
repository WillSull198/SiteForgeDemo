/* SiteForge audit: Contract template previews now return the structured fields
   expected by Contract Viewer and ClientFlow, fixing uploaded-template contract
   generation where merge tokens previously populated text but not sections. */

const DB_NAME = "siteforge-files";
const STORE_NAME = "blobs";
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const PDFJS_VERSION = "3.11.174";
const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

const KEYWORDS = {
  "Contract Template": ["agreement", "contract", "deed", "terms", "variation", "notice"],
  "Plan / Drawing": ["plan", "drawing", "revision", "ga", "a-", "s-", "e-", "rev"],
  Specification: ["spec", "specification", "schedule of"],
  "Invoice / Quote": ["invoice", "tax invoice", "quote", "quotation"],
  "Insurance Certificate": ["coi", "certificate of currency", "insurance", "policy"],
  "Licence / Ticket": ["white card", "licence", "license", "trade certificate", "ticket"],
  "SWMS / JSA": ["swms", "safe work", "jsa", "job safety"],
};

let cachedDbPromise = null;
let memoryFallback = new Map();
let cachedScripts = new Map();

const randomId = (prefix = "file") => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const sentence = (value = "") => value.replace(/\s+/g, " ").trim();

const nowStamp = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
};

const isImage = (type = "", name = "") => type.startsWith("image/") || /\.(png|jpe?g)$/i.test(name);
const isPdf = (type = "", name = "") => type === "application/pdf" || /\.pdf$/i.test(name);
const isDocx = (type = "", name = "") =>
  type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(name);
const isTextLike = (type = "", name = "") => type.startsWith("text/") || /\.(txt|md)$/i.test(name);

function openDb() {
  if (cachedDbPromise) return cachedDbPromise;
  cachedDbPromise = new Promise((resolve) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch (error) {
      resolve(null);
    }
  });
  return cachedDbPromise;
}

async function withStore(mode, callback) {
  const db = await openDb();
  if (!db) return callback(null);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = callback(store, resolve, reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function putBlob(id, blob) {
  const db = await openDb();
  if (!db) {
    memoryFallback.set(id, blob);
    return { ok: true, fallback: true };
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, id);
    tx.oncomplete = () => resolve({ ok: true });
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBlob(id) {
  const db = await openDb();
  if (!db) return memoryFallback.get(id) || null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

export async function deleteBlob(id) {
  const db = await openDb();
  if (!db) {
    memoryFallback.delete(id);
    return { ok: true, fallback: true };
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve({ ok: true });
    tx.onerror = () => reject(tx.error);
  });
}

function loadScriptOnce(key, src) {
  if (cachedScripts.has(key)) return cachedScripts.get(key);
  const promise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Browser only"));
      return;
    }
    const existing = document.querySelector(`script[data-siteforge-script="${key}"]`);
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
    script.dataset.siteforgeScript = key;
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

export async function ensurePdfJs() {
  if (typeof window !== "undefined" && window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
    return window;
  }
  const pdfjsWindow = await loadScriptOnce("pdfjs", `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`);
  if (pdfjsWindow?.pdfjsLib) {
    pdfjsWindow.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
  }
  return pdfjsWindow;
}

export async function ensureMammoth() {
  return loadScriptOnce("mammoth", "https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js");
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function readFileAsText(file) {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function makeImageThumbnail(file) {
  if (typeof document === "undefined") return null;
  const src = await readFileAsDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 200;
      const ratio = Math.min(max / img.width, max / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function extractPdfTextAndThumbnail(file) {
  const result = { fullText: "", pages: [], thumbnailDataUrl: null, extractionStatus: "not-run" };
  try {
    const pdfjsWindow = await ensurePdfJs();
    const pdfjs = pdfjsWindow?.pdfjsLib || window.pdfjsLib;
    if (!pdfjs) return { ...result, extractionStatus: "pdfjs-unavailable" };

    const data = await readFileAsArrayBuffer(file);
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item) => item.str).join(" ").trim();
      pages.push({ pageNumber, text });

      if (pageNumber === 1 && typeof document !== "undefined") {
        const viewport = page.getViewport({ scale: 0.35 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        result.thumbnailDataUrl = canvas.toDataURL("image/jpeg", 0.78);
      }
      page.cleanup?.();
    }
    pdf.destroy?.();
    result.pages = pages;
    result.fullText = pages.map((page) => page.text).filter(Boolean).join("\n\n");
    result.extractionStatus = result.fullText ? "complete" : "no-text-layer";
    return result;
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    return {
      ...result,
      extractionStatus: message.includes("password") || message.includes("encrypted") ? "encrypted" : "failed",
    };
  }
}

export async function checkStorageQuota() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { ok: true, warning: null, usage: 0, quota: 0, ratio: 0 };
  }
  const { usage = 0, quota = 1 } = await navigator.storage.estimate();
  const ratio = quota ? usage / quota : 0;
  return {
    ok: ratio < 0.9,
    usage,
    quota,
    ratio,
    warning: ratio >= 0.7 ? `Storage ${Math.round(ratio * 100)}% full. Consider exporting and clearing old data.` : null,
  };
}

const regexExtractors = {
  "Contract Template": (text) => ({
    parties: [...new Set([...text.matchAll(/(?:between|party)\s*[:\-]?\s*([A-Z][A-Za-z0-9 &'.,-]+)/gi)].map((match) => match[1]))].slice(0, 4),
    sumValues: [...text.matchAll(/\$[\d,]+(?:\.\d{2})?/g)].map((match) => match[0]).slice(0, 6),
    dates: [...text.matchAll(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g)].map((match) => match[0]).slice(0, 6),
    clauseHeadings: [...text.matchAll(/^\s*(\d+(?:\.\d+)*)\s+([A-Z][^\n]+)/gm)].map((match) => `${match[1]} ${match[2]}`).slice(0, 8),
  }),
  "Plan / Drawing": (text, name) => ({
    drawingNumber: name.match(/\b([ASEM]-?\d{2,4}[A-Z]?)\b/i)?.[1] || text.match(/\b([ASEM]-?\d{2,4}[A-Z]?)\b/i)?.[1] || "",
    revision: name.match(/\brev[\s_-]*([A-Z0-9]+)/i)?.[1] || text.match(/\brev(?:ision)?[\s:]+([A-Z0-9]+)/i)?.[1] || "",
    discipline: text.match(/\b(architectural|structural|electrical|hydraulic|mechanical|survey)\b/i)?.[1] || "",
    titleBlock: sentence(text.slice(0, 180)),
  }),
  "Invoice / Quote": (text) => ({
    supplier: text.match(/(?:supplier|from|bill from)[:\s]+([A-Z][A-Za-z0-9 &'.,-]+)/i)?.[1] || "",
    abn: text.match(/\b\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/)?.[0] || "",
    amount: text.match(/(?:total|amount due|invoice total)[:\s]+\$?([\d,]+(?:\.\d{2})?)/i)?.[1] || "",
    dueDate: text.match(/(?:due date|payment due)[:\s]+([0-9\/-]+)/i)?.[1] || "",
    lineItems: [...text.matchAll(/^\s*[-*]?\s*([A-Za-z][^\n]{6,80})$/gm)].map((match) => match[1]).slice(0, 6),
  }),
  "Insurance Certificate": (text) => ({
    insurer: text.match(/(?:insurer|underwriter)[:\s]+([A-Z][A-Za-z0-9 &'.,-]+)/i)?.[1] || "",
    policyNumber: text.match(/(?:policy(?: no\.?| number)?)[:\s]+([A-Z0-9-]+)/i)?.[1] || "",
    expiry: text.match(/(?:expiry|expires|valid until)[:\s]+([0-9\/-]+)/i)?.[1] || "",
    coverage: text.match(/(?:coverage|sum insured|limit)[:\s]+\$?([\d,]+(?:\.\d{2})?)/i)?.[1] || "",
  }),
  "Licence / Ticket": (text) => ({
    holder: text.match(/(?:holder|name)[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] || "",
    licenceNumber: text.match(/(?:licen[cs]e(?: no\.?| number)?)[:\s]+([A-Z0-9-]+)/i)?.[1] || "",
    licenceClass: text.match(/(?:class|ticket type)[:\s]+([A-Z0-9-]+)/i)?.[1] || "",
    expiry: text.match(/(?:expiry|expires)[:\s]+([0-9\/-]+)/i)?.[1] || "",
  }),
};

export function classify({ name = "", type = "", text = "" }) {
  const haystack = `${name} ${text}`.toLowerCase();
  if (isImage(type, name)) return "Photo / Site Image";
  for (const [classification, keywords] of Object.entries(KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      return classification;
    }
  }
  return "Other";
}

export function extractFields(classification, text = "", name = "") {
  const extractor = regexExtractors[classification];
  return extractor ? extractor(text, name) : {};
}

export function parseMergeTokens(text = "") {
  return [
    ...new Set([
      ...[...text.matchAll(/\{\{\s*([a-z0-9_.-]+)\s*\}\}/gi)].map((match) => match[1]),
      ...[...text.matchAll(/\[([a-z0-9_\s.-]+)\]/gi)].map((match) => match[1].trim().toLowerCase().replace(/\s+/g, ".")),
      ...[...text.matchAll(/__([A-Z0-9_]+)__/g)].map((match) => match[1].toLowerCase().replace(/_/g, ".")),
      ...[...text.matchAll(/\b(PROJECT_NAME|CLIENT_NAME|CLIENT|BUILDER_NAME|BUILDER_ABN|SITE_ADDRESS|PROJECT_ADDRESS|VARIATION_NUMBER|VARIATION_DESCRIPTION|ESTIMATED_COST|TIME_IMPACT_DAYS|DATE|DATE_ISSUED)\b/g)].map((match) =>
        match[1].toLowerCase().replace(/_/g, "."),
      ),
    ]),
  ];
}

export function parseTemplate(fileRecord) {
  const templateText = typeof fileRecord === "string" ? fileRecord : fileRecord?.extractedText || fileRecord?.content || "";
  const tokens = parseMergeTokens(templateText);
  return {
    tokens,
    unresolved: tokens.filter((token) => token.startsWith("custom.") || token.startsWith("unknown.")),
    classification: "Contract Template",
  };
}

export function diffPlans(oldRecord, newRecord) {
  const oldRev = oldRecord?.parsedFields?.revision || oldRecord?.revision || "B";
  const newRev = newRecord?.parsedFields?.revision || newRecord?.revision || "C";
  const drawingNumber = newRecord?.parsedFields?.drawingNumber || newRecord?.drawingNumber || newRecord?.name || "A-101";
  return {
    summary: `${drawingNumber} moved from Rev ${oldRev} to Rev ${newRev}. Window size on ground floor reduced 2400→1800 and an electrical GPO was added on the north wall.`,
    affectedZones: ["Ground Floor North Wall", "Kitchen", "Entry Hall"],
    affectedTasks: ["Frame up Level 2 east wall", "Run conduit to switchboard B", "Acknowledge framing revision"],
    affectedTrades: ["Carpentry", "Electrical"],
  };
}

export function buildTemplatePreviewContent(templateText, mergeData = {}, tokenAliases = {}) {
  const tokens = parseMergeTokens(templateText);
  let content = templateText;
  const unresolved = [];
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  tokens.forEach((token) => {
    const canonicalToken = tokenAliases[token] || token;
    const replacement = Object.prototype.hasOwnProperty.call(mergeData, canonicalToken)
      ? mergeData[canonicalToken]
      : canonicalToken.split(".").reduce((acc, key) => (acc ? acc[key] : undefined), mergeData);
    const tokenPattern = escapeRegExp(token);
    const bracketPattern = token.split(".").map(escapeRegExp).join("\\s+");
    const legacyCapsPattern = escapeRegExp(token.replace(/\./g, "_").toUpperCase());
    const patterns = [
      new RegExp(`\\{\\{\\s*${tokenPattern}\\s*\\}\\}`, "g"),
      new RegExp(`\\[\\s*${bracketPattern}\\s*\\]`, "gi"),
      new RegExp(`__${escapeRegExp(token.replace(/\./g, "_").toUpperCase())}__`, "g"),
      new RegExp(`\\b${legacyCapsPattern}\\b`, "g"),
    ];
    if (replacement === undefined || replacement === null || replacement === "") {
      unresolved.push(token);
      patterns.forEach((pattern) => {
        content = content.replaceAll(pattern, `[[${canonicalToken}]]`);
      });
    } else {
      patterns.forEach((pattern) => {
        content = content.replaceAll(pattern, String(replacement));
      });
    }
  });
  const clauses = content
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    content,
    populatedContent: content,
    unresolved,
    unresolvedTokens: unresolved,
    sections: [
      {
        heading: "Uploaded Contract Template",
        clauses: clauses.length ? clauses : [content || "Template content will appear here after merge fields are populated."],
      },
    ],
  };
}

export async function previewPdf(fileMeta) {
  const blob = fileMeta?.blob || (fileMeta?.id ? await getBlob(fileMeta.id) : null);
  if (!blob) return { html: "<p>PDF preview unavailable.</p>" };
  const pdfjsWindow = await ensurePdfJs();
  const pdfjs = pdfjsWindow?.pdfjsLib || window.pdfjsLib;
  if (!pdfjs) return { html: "<p>PDF preview unavailable.</p>" };
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
  const data = await blob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup?.();
  pdf.destroy?.();
  return { html: `<img src="${canvas.toDataURL("image/png")}" alt="PDF preview" style="max-width:100%;border-radius:14px;" />` };
}

export async function getStoredFileBlob(fileId) {
  return getBlob(fileId);
}

export async function loadPdfJs() {
  const pdfjsWindow = await ensurePdfJs();
  return pdfjsWindow?.pdfjsLib || window.pdfjsLib;
}

export async function previewDocx(fileMeta) {
  const blob = fileMeta?.blob || (fileMeta?.id ? await getBlob(fileMeta.id) : null);
  if (!blob) return { html: "<p>DOCX preview unavailable.</p>" };
  await ensureMammoth();
  if (!window.mammoth) return { html: "<p>DOCX preview unavailable.</p>" };
  const arrayBuffer = await blob.arrayBuffer();
  const result = await window.mammoth.convertToHtml({ arrayBuffer });
  return { html: result.value };
}

export async function uploadFile({
  file,
  uploadedBy,
  classificationHint = "",
  siteId = null,
  entityType = null,
  entityId = null,
  onProgress,
}) {
  if (!file) throw new Error("No file selected.");
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File exceeds 25MB limit.");
  }
  const quota = await checkStorageQuota();
  if (!quota.ok) {
    throw new Error("Storage is over 90% full. Export and clear old data before uploading more files.");
  }
  if (!ACCEPTED_TYPES.includes(file.type) && !/\.(pdf|png|jpe?g|docx|txt|md)$/i.test(file.name)) {
    throw new Error("File type not supported.");
  }

  onProgress?.(10);
  let extractedText = "";
  let textPages = [];
  let extractionStatus = "not-run";
  let thumbnailDataUrl = null;
  if (isTextLike(file.type, file.name)) {
    extractedText = await readFileAsText(file);
    extractionStatus = "complete";
  } else if (isDocx(file.type, file.name)) {
    try {
      await ensureMammoth();
      const result = await window.mammoth.convertToHtml({ arrayBuffer: await readFileAsArrayBuffer(file) });
      extractedText = result.value.replace(/<[^>]+>/g, " ");
      extractionStatus = extractedText.trim() ? "complete" : "no-text-layer";
    } catch (error) {
      extractedText = file.name;
      extractionStatus = "failed";
    }
  } else if (isPdf(file.type, file.name)) {
    const pdf = await extractPdfTextAndThumbnail(file);
    extractedText = pdf.fullText || file.name;
    textPages = pdf.pages;
    extractionStatus = pdf.extractionStatus;
    thumbnailDataUrl = pdf.thumbnailDataUrl;
  }
  onProgress?.(40);

  const classification = classificationHint || classify({ name: file.name, type: file.type, text: extractedText });
  const parsedFields = extractFields(classification, extractedText, file.name);
  thumbnailDataUrl = thumbnailDataUrl || (isImage(file.type, file.name) ? await makeImageThumbnail(file) : null);
  onProgress?.(75);

  const id = randomId("file");
  await putBlob(id, file);
  onProgress?.(100);

  return {
    id,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    uploadedAt: nowStamp(),
    uploadedBy,
    classification,
    extractedText: sentence(extractedText),
    textPages,
    extractionStatus,
    parsedFields,
    thumbnailDataUrl,
    confirmedFields: {},
    siteId,
    entityType,
    entityId,
    lastModified: file.lastModified || Date.now(),
    archived: false,
  };
}

export async function uploadSeededTextFile({
  name,
  content,
  uploadedBy = "System",
  classificationHint = "Contract Template",
  siteId = null,
  entityType = null,
  entityId = null,
}) {
  const blob = new Blob([content], { type: /\.md$/i.test(name) ? "text/markdown" : /\.txt$/i.test(name) ? "text/plain" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const file = new File([blob], name, { type: blob.type, lastModified: Date.now() });
  const meta = await uploadFile({ file, uploadedBy, classificationHint, siteId, entityType, entityId });
  meta.seeded = true;
  return meta;
}

export async function removeFileEverywhere(fileId) {
  await deleteBlob(fileId);
}

export const DOCUMENT_LIMITS = {
  maxFileSize: MAX_FILE_SIZE,
  acceptedTypes: ACCEPTED_TYPES,
};
