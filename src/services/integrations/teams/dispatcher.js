import { buildApprovalAdaptiveCard } from "./cards/approval";

export const DEFAULT_TEAMS_CHANNEL_MAP = {
  "approval.sent": "Client Approvals",
  "approval.signed": "Builder PM Channel",
  "approval.stalled": "PM Escalations",
  "approval.declined": "PM Escalations",
  "safety.critical": "Director Alerts",
  "presence.anomaly": "Supervisor Alerts",
  "contract.client-signed": "Contract Admin",
};

export function createTeamsEvent({ eventType, title, body, channel, payload = null, status = "queued" }) {
  return {
    eventType,
    title,
    body,
    channel,
    payload,
    status,
    at: new Date().toISOString(),
  };
}

export function buildTeamsApprovalDispatch({ approval, client, builder, channel }) {
  const card = buildApprovalAdaptiveCard({ approval, client, builder, portalUrl: approval.portalUrl });
  return createTeamsEvent({
    eventType: "approval.card",
    title: `Teams approval card - ${approval.number || approval.id}`,
    body: approval.title,
    channel,
    payload: card,
  });
}

export function handleTeamsSlashCommand(command = "", state = {}) {
  const normalized = command.trim().replace(/^\/siteforge\s*/i, "").trim();
  const approvals = state.approvals || [];
  if (!normalized || /^help$/i.test(normalized)) {
    return {
      title: "SiteForge Teams commands",
      body: "Try: /siteforge approvals stalled, /siteforge variation CF-001, or /siteforge raise variation Riverside waterproofing upgrade.",
      status: "ok",
    };
  }
  if (/^approvals stalled/i.test(normalized)) {
    const stalled = approvals.filter((approval) => ["awaiting-client", "question", "changes-requested", "contract-awaiting-client"].includes(approval.status));
    return {
      title: `${stalled.length} stalled approvals`,
      body: stalled.slice(0, 5).map((approval) => `${approval.number || approval.id}: ${approval.title}`).join("\n") || "No stalled approvals.",
      status: "ok",
    };
  }
  const variationMatch = normalized.match(/^(variation|approval)\s+([\w-]+)/i);
  if (variationMatch) {
    const approval = approvals.find((item) => item.number === variationMatch[2] || item.id === variationMatch[2]);
    return {
      title: approval ? `${approval.number || approval.id} · ${approval.status}` : "Approval not found",
      body: approval ? `${approval.title}\n${approval.summary || approval.reason || ""}` : "No matching SiteForge approval was found.",
      status: approval ? "ok" : "not-found",
    };
  }
  if (/^raise variation/i.test(normalized)) {
    return {
      title: "Variation draft captured",
      body: "SiteForge would create a draft ClientFlow approval from this Teams command once the real bot is connected.",
      status: "queued",
    };
  }
  return {
    title: "Command not recognised",
    body: "Use /siteforge help to see available commands.",
    status: "error",
  };
}
