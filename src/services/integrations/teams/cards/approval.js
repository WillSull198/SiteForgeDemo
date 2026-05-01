export function buildApprovalAdaptiveCard({ approval, client, builder, portalUrl }) {
  return {
    type: "AdaptiveCard",
    version: "1.5",
    $schema: "https://adaptivecards.io/schemas/adaptive-card.json",
    body: [
      {
        type: "TextBlock",
        size: "Large",
        weight: "Bolder",
        text: approval.title || "SiteForge approval",
        wrap: true,
      },
      {
        type: "TextBlock",
        spacing: "Small",
        text: `${builder?.companyName || "SiteForge Builder"} · ${approval.number || approval.id}`,
        isSubtle: true,
      },
      {
        type: "FactSet",
        facts: [
          { title: "Client", value: client?.name || client?.primaryContact || "Client" },
          { title: "Type", value: approval.type || "Approval" },
          { title: "Cost", value: `$${Number(approval.costImpact || 0).toLocaleString("en-AU")}` },
          { title: "Time", value: `${Number(approval.timeImpact || 0)} day(s)` },
          { title: "Status", value: approval.status || "draft" },
        ],
      },
      {
        type: "TextBlock",
        text: approval.summary || approval.reason || "Review this SiteForge approval request.",
        wrap: true,
      },
    ],
    actions: [
      {
        type: "Action.Submit",
        title: "Approve",
        data: { action: "approve", approvalId: approval.id, source: "teams" },
      },
      {
        type: "Action.Submit",
        title: "Decline",
        data: { action: "decline", approvalId: approval.id, source: "teams" },
      },
      {
        type: "Action.Submit",
        title: "Question",
        data: { action: "question", approvalId: approval.id, source: "teams" },
      },
      {
        type: "Action.OpenUrl",
        title: "Open Portal",
        url: portalUrl || approval.portalUrl || "",
      },
    ],
  };
}

export function approvalCardPreviewText(approval) {
  return `${approval.number || approval.id}: ${approval.title} · $${Number(approval.costImpact || 0).toLocaleString("en-AU")} · ${approval.status}`;
}
