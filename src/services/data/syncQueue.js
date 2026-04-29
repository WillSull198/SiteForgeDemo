const DB_NAME = "siteforge-sync-queue";
const DB_VERSION = 1;
const STORE = "operations";
const listeners = new EventTarget();

let dbPromise = null;

export function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
      (Number(char) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(char) / 4)))).toString(16),
    );
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openQueueDB() {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is not available."));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function readAll() {
  try {
    const db = await openQueueDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    return [];
  }
}

async function putOperation(operation) {
  const db = await openQueueDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(operation);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function emitStatus(status) {
  listeners.dispatchEvent(new CustomEvent("sync:status", { detail: status }));
}

export async function getSyncStatus() {
  const items = await readAll();
  const stuck = items.filter((item) => item.status === "failed");
  const pending = items.filter((item) => item.status === "pending" || item.status === "syncing");
  return {
    state: stuck.length ? "stuck" : pending.length ? "syncing" : "synced",
    pending: pending.length,
    stuck: stuck.length,
    total: items.length,
    lastOperationAt: items[0]?.updatedAt || items[0]?.createdAt || null,
  };
}

export function subscribeSyncStatus(callback) {
  const handler = (event) => callback(event.detail);
  listeners.addEventListener("sync:status", handler);
  getSyncStatus().then(callback);
  return () => listeners.removeEventListener("sync:status", handler);
}

export async function enqueueOperation({ resource, action, payload }) {
  const operation = {
    id: uuid(),
    resource,
    action,
    payload,
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "pending",
  };
  await putOperation(operation);
  emitStatus(await getSyncStatus());
  return processSyncQueue();
}

export async function processSyncQueue() {
  const items = await readAll();
  const pending = items.filter((item) => item.status === "pending");
  for (const item of pending) {
    const syncing = { ...item, status: "syncing", attempts: item.attempts + 1, updatedAt: new Date().toISOString() };
    await putOperation(syncing);
    try {
      await putOperation({ ...syncing, status: "synced", updatedAt: new Date().toISOString() });
    } catch (error) {
      await putOperation({
        ...syncing,
        status: syncing.attempts >= 5 ? "failed" : "pending",
        lastError: error?.message || "Sync failed",
        updatedAt: new Date().toISOString(),
      });
    }
  }
  const status = await getSyncStatus();
  emitStatus(status);
  return status;
}
