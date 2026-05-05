const CRITICAL_EVENTS = new Set([
  "problem.critical",
  "approval.declined",
  "safety.incident",
  "buildxact.sync-error",
]);

const GROUPS = {
  "approval.created": "Approvals",
  "approval.viewed": "Approvals",
  "approval.question": "Approvals",
  "approval.approved": "Approvals",
  "approval.declined": "Approvals",
  "approval.signed": "Approvals",
  "approval.stalled": "Approvals",
  "approval.internal-review": "Approvals",
  "contract.drafted": "Contracts",
  "contract.review-requested": "Contracts",
  "contract.builder-signed": "Contracts",
  "contract.client-signed": "Contracts",
  "contract.pending-signature": "Contracts",
  "problem.created": "Problems",
  "problem.critical": "Problems",
  "rfi.overdue": "RFIs",
  "rfi.created": "RFIs",
  "procurement.delayed": "Procurement",
  "qa.failed": "QA",
  "safety.incident": "Safety",
  "presence.anomaly": "Presence",
  "passport.access-denied": "Passport",
  "passport.ticket-expiring": "Passport",
  "task.overdue": "Tasks",
  "variation.approved": "Variations",
  "recovery.opportunity": "Recovery",
  "buildxact.sync-error": "Integrations",
};

const SEVERITY = {
  "approval.created": "medium",
  "approval.viewed": "low",
  "approval.question": "high",
  "approval.approved": "high",
  "approval.declined": "critical",
  "approval.signed": "high",
  "approval.stalled": "high",
  "approval.internal-review": "medium",
  "contract.drafted": "medium",
  "contract.review-requested": "medium",
  "contract.builder-signed": "medium",
  "contract.client-signed": "high",
  "contract.pending-signature": "high",
  "problem.created": "medium",
  "problem.critical": "critical",
  "rfi.overdue": "medium",
  "rfi.created": "medium",
  "procurement.delayed": "high",
  "qa.failed": "high",
  "safety.incident": "critical",
  "presence.anomaly": "medium",
  "passport.access-denied": "medium",
  "passport.ticket-expiring": "medium",
  "task.overdue": "medium",
  "variation.approved": "medium",
  "recovery.opportunity": "medium",
  "buildxact.sync-error": "high",
};

const CHANNEL_LABELS = {
  "in-app": "In-app",
  email: "Email",
  teams: "Teams",
  sms: "SMS",
  portal: "Portal",
  "mobile-push": "Mobile Push",
};

const DEFAULT_CHANNELS = {
  "approval.created": ["in-app", "email", "portal"],
  "approval.viewed": ["in-app"],
  "approval.question": ["in-app", "teams"],
  "approval.approved": ["in-app", "email"],
  "approval.declined": ["in-app", "teams", "email"],
  "approval.signed": ["in-app", "email", "portal"],
  "approval.stalled": ["in-app", "teams", "email"],
  "approval.internal-review": ["in-app", "email"],
  "contract.drafted": ["in-app"],
  "contract.review-requested": ["in-app"],
  "contract.builder-signed": ["email", "portal"],
  "contract.client-signed": ["in-app", "email"],
  "contract.pending-signature": ["in-app", "email", "portal"],
  "problem.created": ["in-app"],
  "problem.critical": ["in-app", "teams", "sms"],
  "rfi.overdue": ["in-app"],
  "rfi.created": ["in-app"],
  "procurement.delayed": ["in-app"],
  "qa.failed": ["in-app", "teams"],
  "safety.incident": ["in-app", "email", "sms"],
  "presence.anomaly": ["in-app"],
  "passport.access-denied": ["in-app"],
  "passport.ticket-expiring": ["in-app", "email", "sms"],
  "task.overdue": ["in-app", "mobile-push"],
  "variation.approved": ["in-app"],
  "recovery.opportunity": ["in-app"],
  "buildxact.sync-error": ["in-app", "email"],
};

const prefKeyForChannel = {
  "in-app": "inApp",
  email: "email",
  teams: "teams",
  sms: "sms",
  portal: "portal",
  "mobile-push": "mobilePush",
};

const wait = (ms = 90) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const Services = {
  email: {
    send: async (payload) => {
      await wait();
      return { ok: true, channel: "email", payload };
    },
  },
  teams: {
    notify: async (payload) => {
      await wait();
      return { ok: true, channel: "teams", payload };
    },
  },
  sms: {
    send: async (payload) => {
      await wait();
      return { ok: true, channel: "sms", payload };
    },
  },
  portal: {
    publish: async (payload) => {
      await wait();
      return { ok: true, channel: "portal", payload };
    },
  },
  mobilePush: {
    send: async (payload) => {
      await wait();
      return { ok: true, channel: "mobile-push", payload };
    },
  },
};

const nowStamp = () => {
  const now = typeof window !== "undefined" && window.__siteforgeNow ? new Date(window.__siteforgeNow) : new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
};

const randomId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const parseTime = (value) => {
  if (!value) return 0;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

function isInQuietHours(preferences, currentTime = new Date()) {
  const quietHours = preferences?.quietHours;
  if (!quietHours?.start || !quietHours?.end) {
    return false;
  }

  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const startMinutes = parseTime(quietHours.start);
  const endMinutes = parseTime(quietHours.end);

  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function shouldSendChannel(userOrClient, channel, eventType) {
  const prefs = userOrClient?.notificationPrefs || userOrClient?.notificationPreferences || {};
  const prefKey = prefKeyForChannel[channel];
  const allowed = prefKey ? prefs[prefKey] !== false : true;
  if (!allowed) {
    return false;
  }
  if (isInQuietHours(prefs) && !CRITICAL_EVENTS.has(eventType)) {
    return channel === "in-app" || channel === "portal";
  }
  return true;
}

function buildTitle(eventType, title) {
  return title || eventType.replace(/\./g, " ");
}

export function dispatchNotificationEvent({
  state,
  eventType,
  title,
  body,
  siteId = null,
  entityType = null,
  entityId = null,
  actor = null,
  route = null,
  recipients = [],
}) {
  const now = nowStamp();
  const items = [];
  const eventLog = [];

  recipients.forEach((recipient) => {
    const channels = recipient.channels?.length ? recipient.channels : DEFAULT_CHANNELS[eventType] || ["in-app"];
    const target = recipient.user || recipient.client || null;

    channels.forEach((channel) => {
      if (!shouldSendChannel(target, channel, eventType)) {
        return;
      }

      const item = {
        id: randomId("ntf"),
        eventType,
        channel,
        recipientId: recipient.user?.id || recipient.client?.id || recipient.recipientId || null,
        recipientRole: recipient.user?.role || recipient.role || "External",
        siteId,
        entityType,
        entityId,
        title: buildTitle(eventType, title),
        body,
        severity: SEVERITY[eventType] || "medium",
        readAt: null,
        createdAt: now,
        group: GROUPS[eventType] || "General",
        route,
      };

      items.push(item);

      if (channel === "teams") {
        eventLog.push({
          id: randomId("teams"),
          eventType,
          title: item.title,
          channel: recipient.teamsChannel || "SiteForge Updates",
          status: "queued",
          at: now,
          actor: actor?.name || "System",
        });
      }
    });
  });

  return { items, eventLog };
}

export function groupNotifications(items = []) {
  return items.reduce((groups, item) => {
    if (!groups[item.group]) {
      groups[item.group] = [];
    }
    groups[item.group].push(item);
    return groups;
  }, {});
}

export { CHANNEL_LABELS, DEFAULT_CHANNELS, GROUPS, SEVERITY };
