export const COMPLIANCE_DOC_TYPES = [
  "Form 4",
  "Public Liability Insurance",
  "Workers Comp",
  "Trade Licence",
  "SWMS",
  "QBCC Licence",
  "White Card",
  "Other",
];

export const REQUIRED_COMPLIANCE_DOCS = [
  { docType: "Public Liability Insurance", scope: "company", mandatory: true },
  { docType: "Workers Comp", scope: "company", mandatory: true },
  { docType: "Trade Licence", scope: "company", mandatory: true },
  { docType: "SWMS", scope: "site", mandatory: true },
  { docType: "White Card", scope: "worker", mandatory: true },
  { docType: "QBCC Licence", scope: "company", trades: ["builder", "carpentry", "waterproofing", "plumbing", "electrical"], mandatory: false },
  { docType: "Form 4", scope: "job-stage", trades: ["concrete", "formwork", "steel fixing", "structural"], mandatory: true },
];

export function normaliseTrade(value = "") {
  return String(value).toLowerCase().trim();
}

export function requiredDocsForTrade(trade = "") {
  const normalised = normaliseTrade(trade);
  return REQUIRED_COMPLIANCE_DOCS.filter((requirement) => {
    if (!requirement.trades?.length) return true;
    return requirement.trades.some((item) => normalised.includes(item));
  });
}

export function daysUntilDate(dateValue) {
  if (!dateValue) return null;
  const parsed = Date.parse(dateValue);
  if (!Number.isFinite(parsed)) return null;
  return Math.ceil((parsed - Date.now()) / 86400000);
}

export function complianceStatusFor(doc) {
  if (!doc) return "missing";
  if (doc.status === "rejected") return "rejected";
  if (!doc.reviewedAt && doc.status !== "valid" && doc.status !== "expiring-soon" && doc.status !== "expired") return "pending-review";
  const days = daysUntilDate(doc.expiryDate);
  if (days !== null && days < 0) return "expired";
  if (days !== null && days <= 30) return "expiring-soon";
  return doc.reviewedAt || doc.status === "valid" ? "valid" : "pending-review";
}

export function complianceTone(status) {
  if (status === "valid") return "passed";
  if (status === "pending-review" || status === "expiring-soon") return "medium";
  if (status === "missing" || status === "expired" || status === "rejected") return "critical";
  return "medium";
}

export function complianceLabel(status, doc = null) {
  if (status === "valid") return doc?.expiryDate ? `Valid until ${doc.expiryDate}` : "Valid";
  if (status === "expiring-soon") return `Expiring in ${daysUntilDate(doc?.expiryDate)} days`;
  if (status === "expired") return "Expired";
  if (status === "pending-review") return "Pending builder review";
  if (status === "rejected") return `Rejected${doc?.rejectionReason ? ` - ${doc.rejectionReason}` : ""}`;
  return "Not provided";
}
