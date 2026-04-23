export const teamsAdapter = {
  sendApprovalSummary(approval, client) {
    return {
      status: "sent",
      channel: client.preferredChannel === "Teams" ? "Client Approvals" : "PM Escalations",
      payload: {
        headline: approval.title,
        summary: approval.aiDraft.summary,
        costImpact: approval.costImpact,
        timeImpact: approval.timeImpact,
        approvalId: approval.id,
      },
    };
  },
  escalate(entity, reason) {
    return {
      status: "escalated",
      reason,
      payload: {
        entityType: entity.type || "approval",
        entityId: entity.id,
        summary: entity.title || entity.label,
      },
    };
  },
};
