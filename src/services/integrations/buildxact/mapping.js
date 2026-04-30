const localIdFromBuildxact = (prefix, id) => `${prefix}_${String(id || "").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;

export function mapBuildxactClient(record, orgId = "org-default") {
  return {
    id: localIdFromBuildxact("client", record.id),
    orgId,
    buildxactId: record.id,
    name: record.name,
    primaryContact: record.primaryContact,
    email: record.email,
    phone: record.phone,
    source: "buildxact",
    lastSyncedAt: new Date().toISOString(),
  };
}

export function mapBuildxactProjectToSite(record, orgId = "org-default") {
  const client = mapBuildxactClient(record.client || {}, orgId);
  return {
    id: localIdFromBuildxact("site", record.id),
    orgId,
    buildxactId: record.id,
    code: record.code,
    name: record.name,
    address: record.address,
    contractValue: record.contractValue,
    contractType: record.contractType,
    status: record.status,
    clientId: client.id,
    forecastMargin: 18,
    committed: 0,
    marginAtRisk: 0,
    source: "buildxact",
    lastSyncedAt: new Date().toISOString(),
  };
}

export function mapBuildxactSupplier(record, orgId = "org-default") {
  return {
    id: localIdFromBuildxact("supplier", record.id),
    orgId,
    buildxactId: record.id,
    name: record.name,
    trade: record.trade,
    email: record.email,
    phone: record.phone,
    status: record.status,
    readOnly: true,
    source: "buildxact",
    lastSyncedAt: new Date().toISOString(),
  };
}

export function mapBuildxactCostCode(record, orgId = "org-default") {
  return {
    id: localIdFromBuildxact("cost", record.id),
    orgId,
    buildxactId: record.id,
    code: record.code,
    name: record.name,
    category: record.category,
    siteforgeTag: record.siteforgeTag,
    readOnly: true,
    source: "buildxact",
  };
}

export function mapBuildxactScheduleMilestone(record, projectLookup, orgId = "org-default") {
  return {
    id: localIdFromBuildxact("milestone", record.id),
    orgId,
    buildxactId: record.id,
    buildxactProjectId: record.projectId,
    siteId: projectLookup.get(record.projectId),
    name: record.name,
    date: record.date,
    status: record.status,
    readOnly: true,
    source: "buildxact",
  };
}

export function mapSignedApprovalToBuildxactVariation({ approval, site, client, contractPack, costCode }) {
  return {
    idempotencyKey: approval.id,
    projectId: site?.buildxactId || site?.code || site?.id,
    clientId: client?.buildxactId || client?.id,
    number: approval.number || approval.id,
    title: approval.title,
    description: approval.summary,
    reason: approval.reason,
    value: Number(approval.costImpact || 0),
    days: Number(approval.timeImpact || 0),
    status: "client-signed",
    costCode: costCode?.code || "BX-5600",
    evidence: {
      contractPackId: contractPack?.docId,
      executedPdfBlobId: contractPack?.executedPdfBlobId,
      signedAt: contractPack?.signatures?.client?.signedAt,
      signer: contractPack?.signatures?.client?.name,
      documentHash: contractPack?.signatures?.client?.hash,
    },
  };
}
