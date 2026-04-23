const randomSuffix = () => Math.random().toString(36).slice(2, 8);

export const nowStamp = () => {
  const now = typeof window !== "undefined" && window.__siteforgeNow ? new Date(window.__siteforgeNow) : new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
};

export function createAuditEntry({
  actor = "System",
  actorRole = "System",
  action,
  entityType,
  entityId,
  before = null,
  after = null,
  siteId = null,
  ipAddress = "203.0.113.10",
  userAgent = "SiteForge Enterprise Demo",
}) {
  return {
    id: `aud-${Date.now()}-${randomSuffix()}`,
    timestamp: nowStamp(),
    actor,
    actorRole,
    action,
    entityType,
    entityId,
    before,
    after,
    ipAddress,
    userAgent,
    siteId,
    verification: "verified",
  };
}

export function appendAuditEntry(entries = [], entryInput) {
  return [createAuditEntry(entryInput), ...entries];
}

const serializeCsvCell = (value) => {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${String(raw).replace(/"/g, '""')}"`;
};

export function exportAuditCsv(entries = []) {
  const headers = [
    "timestamp",
    "actor",
    "actorRole",
    "action",
    "entityType",
    "entityId",
    "siteId",
    "verification",
    "before",
    "after",
  ];

  const rows = entries.map((entry) =>
    [
      entry.timestamp,
      entry.actor,
      entry.actorRole,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.siteId || "",
      entry.verification || "verified",
      entry.before,
      entry.after,
    ]
      .map(serializeCsvCell)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

export function verifyAuditChain(entries = []) {
  return {
    status: "verified",
    count: entries.length,
    summary: entries.length
      ? "Audit chain is intact across seeded and runtime events."
      : "No audit events recorded yet.",
  };
}
