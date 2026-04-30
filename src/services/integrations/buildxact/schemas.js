export const BUILDXACT_ENTITY_SCHEMAS = {
  project: ["id", "code", "name", "address", "contractValue", "contractType", "status", "client"],
  client: ["id", "name", "primaryContact", "email", "phone"],
  supplier: ["id", "name", "trade", "email", "phone", "status"],
  costCode: ["id", "code", "name", "category", "siteforgeTag"],
  scheduleMilestone: ["id", "projectId", "name", "date", "status"],
  variationPush: ["idempotencyKey", "projectId", "number", "title", "value", "days", "status", "costCode", "evidence"],
};

export const SYNC_ENTITY_TOGGLES = {
  projects: "Projects",
  clients: "Clients",
  suppliers: "Suppliers",
  costCodes: "Cost codes",
  schedule: "Schedule milestones",
  variations: "Signed variations",
  documents: "Signed contract packs",
  timeline: "Approval timeline notes",
};

export const CONFLICT_POLICY = {
  project: {
    contractValue: "buildxact",
    status: "buildxact",
    approvalStatus: "siteforge",
    signatures: "siteforge",
    audit: "siteforge",
  },
  variation: {
    value: "buildxact-until-client-signed",
    approvalStatus: "siteforge",
    signedPdf: "siteforge",
    notes: "merge",
  },
};
