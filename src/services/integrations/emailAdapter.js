export const emailAdapter = {
  queueClientSummary(approval, client) {
    return {
      status: "ready",
      subject: `[SiteForge] ${approval.type} — ${approval.title}`,
      preview: `To: ${client.email}\n\n${approval.aiDraft.summary}\n\nCost: ${approval.aiDraft.costImpact}\nTime: ${approval.aiDraft.timeImpact}`,
    };
  },
};
