/* SiteForge audit: Added the requested generic IndexedDB CRUD service. The app
   still keeps its fast monolithic demo store, but this service gives upload,
   photo, plan, settings, and future per-module records a clean persistent API. */

const DB_NAME = "siteforge-v2";
const DB_VERSION = 1;

export const STORES = {
  projects: { keyPath: "id" },
  variations: { keyPath: "id" },
  approvals: { keyPath: "id" },
  templates: { keyPath: "id" },
  documents: { keyPath: "id" },
  photos: { keyPath: "id" },
  plans: { keyPath: "id" },
  diary: { keyPath: "id" },
  problems: { keyPath: "id" },
  tasks: { keyPath: "id" },
  rfis: { keyPath: "id" },
  qa: { keyPath: "id" },
  safety: { keyPath: "id" },
  procurement: { keyPath: "id" },
  workforce: { keyPath: "id" },
  settings: { keyPath: "key" },
  audit: { keyPath: "id" },
};

let dbPromise = null;

export function openDB() {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is not available."));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      Object.entries(STORES).forEach(([name, options]) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, options);
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open SiteForge database."));
  });

  return dbPromise;
}

function run(storeName, mode, operation) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = operation(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || transaction.error);
      }),
  );
}

export function getAll(store) {
  return run(store, "readonly", (objectStore) => objectStore.getAll());
}

export function get(store, id) {
  return run(store, "readonly", (objectStore) => objectStore.get(id));
}

export function put(store, record) {
  const now = Date.now();
  const cleanRecord = {
    ...record,
    id: record.id || crypto.randomUUID(),
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
  return run(store, "readwrite", (objectStore) => objectStore.put(cleanRecord)).then(() => cleanRecord);
}

export function remove(store, id) {
  return run(store, "readwrite", (objectStore) => objectStore.delete(id));
}

export function getSetting(key, defaultValue = null) {
  return get("settings", key).then((record) => (record ? record.value : defaultValue));
}

export function setSetting(key, value) {
  return put("settings", { key, value, updatedAt: Date.now() });
}

export function clearStore(store) {
  return run(store, "readwrite", (objectStore) => objectStore.clear());
}
