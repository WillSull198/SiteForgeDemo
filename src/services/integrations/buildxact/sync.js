import projects from "./fixtures/projects.json";
import suppliers from "./fixtures/suppliers.json";
import costCodes from "./fixtures/costCodes.json";
import schedule from "./fixtures/schedule.json";
import {
  mapBuildxactClient,
  mapBuildxactCostCode,
  mapBuildxactProjectToSite,
  mapBuildxactScheduleMilestone,
  mapBuildxactSupplier,
  mapSignedApprovalToBuildxactVariation,
} from "./mapping";

const nowIso = () => new Date().toISOString();
const idFor = (prefix, value) => `${prefix}-${String(value || "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

export function buildBuildxactPullSnapshot({ orgId = "org-default" } = {}) {
  const mappedSites = projects.map((project) => mapBuildxactProjectToSite(project, orgId));
  const mappedClients = projects.map((project) => mapBuildxactClient(project.client || {}, orgId));
  const projectLookup = new Map(projects.map((project, index) => [project.id, mappedSites[index].id]));

  return {
    sites: mappedSites,
    clients: mappedClients,
    suppliers: suppliers.map((supplier) => mapBuildxactSupplier(supplier, orgId)),
    costCodes: costCodes.map((code) => mapBuildxactCostCode(code, orgId)),
    scheduleMilestones: schedule.map((milestone) => mapBuildxactScheduleMilestone(milestone, projectLookup, orgId)),
    pulledAt: nowIso(),
  };
}

export function upsertByBuildxactId(existing = [], incoming = []) {
  const byId = new Map(existing.map((item) => [item.buildxactId || item.id, item]));
  incoming.forEach((item) => {
    const key = item.buildxactId || item.id;
    byId.set(key, { ...(byId.get(key) || {}), ...item });
  });
  return Array.from(byId.values());
}

export function createBuildxactSyncHistory({ type, reference, siteId, status = "success", payloadSize = "4 KB", error = null }) {
  return {
    id: idFor("bx", `${type}-${reference}-${Date.now()}`),
    type,
    reference,
    siteId,
    payloadSize,
    status,
    duration: status === "success" ? "mock 420ms" : "manual review",
    at: nowIso(),
    error: error || undefined,
  };
}

export function createSignedApprovalPushPayload({ approval, site, client, contractPack, costCode }) {
  return mapSignedApprovalToBuildxactVariation({ approval, site, client, contractPack, costCode });
}

export function createAttachmentPayload({ approval, site, contractPack }) {
  return {
    idempotencyKey: `${contractPack?.docId || approval.id}-attachment`,
    projectId: site?.buildxactId || site?.code || site?.id,
    contractPackId: contractPack?.docId,
    approvalId: approval.id,
    executedPdfBlobId: contractPack?.executedPdfBlobId,
    documentTitle: `${approval.number || approval.id} signed contract pack`,
    signedAt: contractPack?.signatures?.client?.signedAt,
  };
}
