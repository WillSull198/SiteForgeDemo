import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { APP_CONFIG } from "./data/seedData";
import "./siteforge.css";

document.title = APP_CONFIG.appTitle;

const PDFJS_VERSION = "3.11.174";

const ensureMeta = (name, content) => {
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = name;
    document.head.appendChild(tag);
  }
  tag.content = content;
};

const ensureLink = (rel, href, extra = {}) => {
  let tag = document.querySelector(`link[rel="${rel}"][href="${href}"]`);
  if (!tag) {
    tag = document.createElement("link");
    tag.rel = rel;
    document.head.appendChild(tag);
  }
  tag.href = href;
  Object.entries(extra).forEach(([key, value]) => {
    tag[key] = value;
  });
};

ensureMeta("description", APP_CONFIG.metaDescription);
ensureMeta("theme-color", "#F7F6F2");
ensureLink("preconnect", "https://fonts.googleapis.com");
ensureLink("preconnect", "https://fonts.gstatic.com", { crossOrigin: "anonymous" });
ensureLink(
  "icon",
  `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill="#0C1118"/>
      <rect x="8" y="8" width="48" height="48" rx="12" fill="#F59E0B"/>
      <text x="32" y="39" font-size="24" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" fill="#060910">SF</text>
    </svg>
  `)}`,
  { type: "image/svg+xml" },
);

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // PWA support is best-effort; the app remains fully usable without SW registration.
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
