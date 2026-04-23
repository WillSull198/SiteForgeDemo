const COLLECTIONS = {
  issue: "problems",
  problem: "problems",
  rfi: "rfis",
  variation: "variations",
  "variation-draft": "variations",
  approval: "approvals",
  task: "tasks",
  material: "materials",
  qa: "qa",
  diary: "diary",
  safety: "safety",
  plan: "plans",
  presence: "presence",
  "procurement-delay": "materials",
};

const isOpenIssue = (problem) => problem.st === "open";
const activeRiskStatuses = new Set(["awaiting-client", "stalled", "question", "awaiting-signature"]);

export function getLinkedCollectionName(type) {
  return COLLECTIONS[type];
}

export function getLinkedRecord(state, type, id) {
  if (type === "plan") {
    return state.plans.find((item) => item.id === id);
  }
  if (type === "presence") {
    return state.presence.attendance.find((item) => item.id === id);
  }
  const collection = COLLECTIONS[type];
  if (!collection || !state[collection]) {
    return null;
  }
  return state[collection].find((item) => item.id === id);
}

export function buildCreateFromOptions(state, siteId) {
  const siteFilter = (record) => !record.siteId || record.siteId === siteId;
  return [
    ...state.problems.filter(siteFilter).map((problem) => ({
      type: "issue",
      id: problem.id,
      label: problem.title,
      siteId: problem.siteId,
      impact: `${problem.cost > 0 ? `$${problem.cost.toLocaleString()}` : "$0"} / ${problem.days || 0}d`,
    })),
    ...state.diary
      .filter((entry) => siteFilter(entry) && entry.weatherEvent)
      .map((entry) => ({
        type: "diary",
        id: entry.id,
        label: `Weather event ${entry.date}`,
        siteId: entry.siteId,
        impact: entry.delays,
      })),
    ...state.rfis.filter(siteFilter).map((rfi) => ({
      type: "rfi",
      id: rfi.id,
      label: `${rfi.num} ${rfi.title}`,
      siteId: rfi.siteId,
      impact: `${rfi.cost ? `$${rfi.cost}` : "$0"} / ${rfi.days || 0}d`,
    })),
    ...state.materials
      .filter((material) => siteFilter(material) && ["pending", "ordered", "in-transit"].includes(material.st))
      .map((material) => ({
        type: "material",
        id: material.id,
        label: material.item,
        siteId: material.siteId,
        impact: `${material.st} · ETA ${material.eta || "TBC"}`,
      })),
    ...state.tasks.filter(siteFilter).map((task) => ({
      type: "task",
      id: task.id,
      label: task.title,
      siteId: task.siteId,
      impact: `${task.trade} · ${task.st}`,
    })),
    ...state.variations.filter(siteFilter).map((variation) => ({
      type: "variation-draft",
      id: variation.id,
      label: variation.title,
      siteId: variation.siteId,
      impact: `$${variation.val.toLocaleString()}`,
    })),
  ];
}

export function buildFieldCommercialModel(state) {
  const siteMetrics = state.sites.map((site) => {
    const siteIssues = state.problems.filter((problem) => problem.siteId === site.id && isOpenIssue(problem));
    const siteApprovals = state.approvals.filter((approval) => approval.siteId === site.id);
    const siteVariations = state.variations.filter((variation) => variation.siteId === site.id);
    const siteQaFailures = state.qa.filter((entry) => entry.siteId === site.id && entry.st === "failed");
    const siteProcurementDelays = state.materials.filter(
      (material) => material.siteId === site.id && ["pending", "ordered", "in-transit"].includes(material.st),
    );
    const stalledApprovals = siteApprovals.filter((approval) => activeRiskStatuses.has(approval.status));
    const costExposure =
      siteIssues.reduce((total, problem) => total + (problem.cost || 0), 0) +
      stalledApprovals.reduce((total, approval) => total + (approval.costImpact || 0), 0);
    const timeExposure =
      siteIssues.reduce((total, problem) => total + (problem.days || 0), 0) +
      stalledApprovals.reduce((total, approval) => total + (approval.timeImpact || 0), 0);
    const marginAtRisk = Math.round(costExposure * site.marginTarget);
    const affectedTrades = [
      ...new Set(
        [
          ...state.tasks.filter((task) => task.siteId === site.id && task.linkedRecords?.length).map((task) => task.trade),
          ...state.qa.filter((entry) => entry.siteId === site.id && entry.st === "failed").map((entry) => entry.trade),
          ...siteVariations.map((variation) => variation.trade).filter(Boolean),
        ].filter(Boolean),
      ),
    ];

    return {
      siteId: site.id,
      costExposure,
      timeExposure,
      marginAtRisk,
      affectedTrades,
      stalledApprovals: stalledApprovals.length,
      procurementRisks: siteProcurementDelays.length,
      qaFailures: siteQaFailures.length,
      risk: costExposure > 10000 || timeExposure >= 3 ? "high" : costExposure > 3000 ? "medium" : "low",
    };
  });

  const directorRisk = {
    totalCostExposure: siteMetrics.reduce((total, entry) => total + entry.costExposure, 0),
    totalTimeExposure: siteMetrics.reduce((total, entry) => total + entry.timeExposure, 0),
    marginAtRisk: siteMetrics.reduce((total, entry) => total + entry.marginAtRisk, 0),
    stalledApprovals: siteMetrics.reduce((total, entry) => total + entry.stalledApprovals, 0),
    attendanceAnomalies: state.presence.attendance.filter((entry) => entry.anomalies.length > 0).length,
  };

  const approvalAnalytics = {
    awaitingClient: state.approvals.filter((approval) => approval.status === "awaiting-client").length,
    stalled: state.approvals.filter((approval) => approval.status === "stalled").length,
    approvedValue: state.approvals
      .filter((approval) => approval.status === "approved")
      .reduce((total, approval) => total + approval.costImpact, 0),
    timeAtRisk: state.approvals
      .filter((approval) => activeRiskStatuses.has(approval.status))
      .reduce((total, approval) => total + approval.timeImpact, 0),
  };

  return {
    siteMetrics,
    directorRisk,
    approvalAnalytics,
  };
}

export function summarizeLinkedImpacts(state, source) {
  if (!source) {
    return [];
  }

  const impacts = [];

  if (source.type === "issue") {
    impacts.push({ label: "Commercial exposure", value: source.cost ? `$${source.cost.toLocaleString()}` : "$0" });
    impacts.push({ label: "Programme risk", value: `${source.days || 0}d` });
  }

  if (source.type === "material") {
    impacts.push({ label: "Schedule risk", value: source.eta ? `ETA ${source.eta}` : "ETA TBC" });
    impacts.push({ label: "Recovery", value: source.st === "in-transit" ? "Partial" : "Not started" });
  }

  if (source.type === "diary" && source.weatherEvent) {
    impacts.push({ label: "Potential approval", value: "Rain day / EOT" });
    impacts.push({ label: "Recovery", value: "Awaiting client approval" });
  }

  if (source.type === "qa") {
    impacts.push({ label: "Rework risk", value: source.st === "failed" ? "High" : "Low" });
  }

  return impacts;
}
