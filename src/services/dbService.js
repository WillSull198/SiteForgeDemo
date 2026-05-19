/* SiteForge audit: Added a production-safe IndexedDB persistence layer for the live
   browser prototype. The app currently uses only the appState store below; the
   per-resource stores are reserved infrastructure for the future resource layer.
   Mode-specific file blobs live separately in siteforge-files-demo/real via
   documentIntelligence.js. */

const DB_NAME = "siteforge-enterprise-db";
const DB_VERSION = 1;

export const DB_STORES = {
  appState: { keyPath: "key" },
  projects: { keyPath: "id", autoIncrement: true }, // reserved
  variations: { keyPath: "id", autoIncrement: true }, // reserved
  approvals: { keyPath: "id", autoIncrement: true }, // reserved
  contracts: { keyPath: "id", autoIncrement: true }, // reserved
  templates: { keyPath: "id", autoIncrement: true }, // reserved
  documents: { keyPath: "id", autoIncrement: true }, // reserved
  photos: { keyPath: "id", autoIncrement: true }, // reserved
  diary: { keyPath: "id", autoIncrement: true }, // reserved
  problems: { keyPath: "id", autoIncrement: true }, // reserved
  rfis: { keyPath: "id", autoIncrement: true }, // reserved
  inspections: { keyPath: "id", autoIncrement: true }, // reserved
  incidents: { keyPath: "id", autoIncrement: true }, // reserved
  plans: { keyPath: "id", autoIncrement: true }, // reserved
  settings: { keyPath: "key" }, // reserved
  auditLog: { keyPath: "id", autoIncrement: true }, // reserved
};

let openPromise = null;

function indexedDbAvailable() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export function openSiteForgeDb() {
  if (!indexedDbAvailable()) {
    return Promise.reject(new Error("IndexedDB is not available in this browser context."));
  }

  if (openPromise) {
    return openPromise;
  }

  openPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      Object.entries(DB_STORES).forEach(([storeName, config]) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, config);
        }
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open SiteForge IndexedDB."));
  });

  return openPromise;
}

function withStore(storeName, mode, handler) {
  return openSiteForgeDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = handler(store);
        let result;

        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error || transaction.error);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || request.error);
        transaction.onabort = () => reject(transaction.error || new Error(`IndexedDB transaction aborted for ${storeName}.`));
      }),
  );
}

export function idbGet(storeName, key) {
  return withStore(storeName, "readonly", (store) => store.get(key));
}

export function idbPut(storeName, value) {
  return withStore(storeName, "readwrite", (store) => store.put(value));
}

export function idbDelete(storeName, key) {
  return withStore(storeName, "readwrite", (store) => store.delete(key));
}

export function idbGetAll(storeName) {
  return withStore(storeName, "readonly", (store) => store.getAll());
}

export function idbClear(storeName) {
  return withStore(storeName, "readwrite", (store) => store.clear());
}

export function loadPersistedAppState(key) {
  return idbGet("appState", key).then((record) => record?.value || null);
}

function warnIfOversizedState(value) {
  if (!import.meta.env.DEV || !value || typeof value !== "object") return;
  try {
    const size = JSON.stringify(value).length;
    if (size <= 2_000_000) return;
    const largest = Object.entries(value)
      .map(([key, item]) => {
        try {
          return [key, JSON.stringify(item).length];
        } catch {
          return [key, 0];
        }
      })
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([key, bytes]) => `${key}: ${bytes.toLocaleString()} bytes`)
      .join(", ");
    console.warn(`[SiteForge] App state is ${size.toLocaleString()} bytes before persistence. Largest keys: ${largest}`);
  } catch {
    // Dev-only diagnostics must never block persistence.
  }
}

export function persistAppState(key, value) {
  warnIfOversizedState(value);
  const updatedAt = new Date().toISOString();
  return idbPut("appState", {
    key,
    value,
    updatedAt,
  }).then(() => ({ key, updatedAt }));
}

export function deletePersistedAppState(key) {
  return idbDelete("appState", key);
}
