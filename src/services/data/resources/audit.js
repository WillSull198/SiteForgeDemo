import { enqueueOperation, uuid } from "../syncQueue";

const DB_NAME = "siteforge-audit";
const DB_VERSION = 1;
const STORE = "entries";
const RETENTION_DAYS = 2557;
let dbPromise = null;

function openAuditDB() {
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

async function sha256(value) {
  const raw = new TextEncoder().encode(value);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", raw);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `fallback-${Math.abs(hash).toString(16)}`;
}

async function allEntries() {
  const db = await openAuditDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result || []).sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp))));
    request.onerror = () => reject(request.error);
  });
}

async function putEntry(entry) {
  const db = await openAuditDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteEntry(id) {
  const db = await openAuditDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function pruneRetention(entries) {
  const threshold = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const stale = entries.filter((entry) => new Date(entry.timestamp).getTime() < threshold);
  await Promise.all(stale.map((entry) => deleteEntry(entry.id)));
}

export const Audit = {
  async list({ filter = {}, limit = 100, cursor = null } = {}) {
    const entries = (await allEntries()).reverse();
    const filtered = entries.filter((entry) => Object.entries(filter).every(([key, value]) => value === undefined || entry[key] === value));
    const start = cursor ? Math.max(0, filtered.findIndex((entry) => entry.id === cursor) + 1) : 0;
    return {
      rows: filtered.slice(start, start + limit),
      cursor: filtered[start + limit]?.id || null,
    };
  },
  async get(id) {
    return (await allEntries()).find((entry) => entry.id === id) || null;
  },
  async create(payload) {
    const entries = await allEntries();
    await pruneRetention(entries);
    const previous = entries[entries.length - 1] || null;
    const entry = {
      ...payload,
      id: payload.id || uuid(),
      orgId: payload.orgId || "org-default",
      timestamp: payload.timestamp || new Date().toISOString(),
      previousHash: previous?.hash || "genesis",
    };
    entry.hash = await sha256(`${entry.previousHash}|${entry.action}|${entry.actor}|${entry.timestamp}|${JSON.stringify(entry.after ?? entry.payload ?? {})}`);
    await putEntry(entry);
    await enqueueOperation({ resource: "audit", action: "create", payload: entry });
    return entry;
  },
  async update(id, patch) {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await putEntry(updated);
    await enqueueOperation({ resource: "audit", action: "update", payload: updated });
    return updated;
  },
  async remove(id) {
    await deleteEntry(id);
    await enqueueOperation({ resource: "audit", action: "remove", payload: { id } });
    return true;
  },
  subscribe(callback) {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("storage", callback);
    return () => window.removeEventListener("storage", callback);
  },
  async verify() {
    const entries = await allEntries();
    let previousHash = "genesis";
    for (const entry of entries) {
      const expected = await sha256(`${previousHash}|${entry.action}|${entry.actor}|${entry.timestamp}|${JSON.stringify(entry.after ?? entry.payload ?? {})}`);
      if (entry.previousHash !== previousHash || entry.hash !== expected) {
        return { status: "broken", count: entries.length, summary: `Audit chain break detected at ${entry.id}.` };
      }
      previousHash = entry.hash;
    }
    return {
      status: "verified",
      count: entries.length,
      summary: entries.length ? `Audit chain verified across ${entries.length} indexed entries.` : "No indexed audit entries recorded yet.",
    };
  },
};
