import { enqueueOperation, uuid } from "./syncQueue";

export const DEFAULT_ORG_ID = "org-default";

export const RESOURCE_STORES = [
  "approvals",
  "documents",
  "plans",
  "diary",
  "problems",
  "rfis",
  "tasks",
  "qa",
  "safety",
  "workforce",
  "contracts",
  "templates",
  "photos",
  "notifications",
  "settings",
  "users",
  "clients",
  "sites",
  "projects",
  "suppliers",
  "purchaseOrders",
];

const DB_NAME = "siteforge-data-local";
const DB_VERSION = 1;
const listeners = new EventTarget();
let dbPromise = null;

function openLocalDB() {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is not available."));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      RESOURCE_STORES.forEach((store) => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function withTenant(record, orgId = DEFAULT_ORG_ID) {
  return {
    ...record,
    id: record?.id || uuid(),
    orgId: record?.orgId || orgId,
    updatedAt: new Date().toISOString(),
    createdAt: record?.createdAt || new Date().toISOString(),
  };
}

async function transact(store, mode, callback) {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = callback(tx.objectStore(store));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function emit(resource) {
  listeners.dispatchEvent(new CustomEvent(`resource:${resource}`));
}

export function createLocalResource(resource) {
  return {
    async list({ orgId = DEFAULT_ORG_ID, filter = {} } = {}) {
      const records = await transact(resource, "readonly", (store) => {
        const request = store.getAll();
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      });
      return records.filter((record) => {
        if ((record.orgId || DEFAULT_ORG_ID) !== orgId) return false;
        return Object.entries(filter).every(([key, value]) => value === undefined || record[key] === value);
      });
    },
    async get(id) {
      return transact(resource, "readonly", (store) => {
        const request = store.get(id);
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
      });
    },
    async create(payload) {
      const record = withTenant(payload);
      await transact(resource, "readwrite", (store) => store.put(record));
      await enqueueOperation({ resource, action: "create", payload: record });
      emit(resource);
      return record;
    },
    async update(id, patch) {
      const existing = (await this.get(id)) || { id };
      const record = withTenant({ ...existing, ...patch, id });
      await transact(resource, "readwrite", (store) => store.put(record));
      await enqueueOperation({ resource, action: "update", payload: record });
      emit(resource);
      return record;
    },
    async remove(id) {
      await transact(resource, "readwrite", (store) => store.delete(id));
      await enqueueOperation({ resource, action: "remove", payload: { id } });
      emit(resource);
      return true;
    },
    subscribe(callback) {
      const handler = () => callback();
      listeners.addEventListener(`resource:${resource}`, handler);
      return () => listeners.removeEventListener(`resource:${resource}`, handler);
    },
    async importMany(records = [], { orgId = DEFAULT_ORG_ID } = {}) {
      const scoped = records.map((record) => withTenant(record, orgId));
      await transact(resource, "readwrite", (store) => {
        scoped.forEach((record) => store.put(record));
      });
      emit(resource);
      return scoped.length;
    },
  };
}
