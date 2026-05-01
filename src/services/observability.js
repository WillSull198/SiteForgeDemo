const sentryDsn = import.meta.env?.VITE_SENTRY_DSN || "";
const posthogKey = import.meta.env?.VITE_POSTHOG_KEY || "";

export function initObservability() {
  if (typeof window === "undefined") return;
  window.__siteforgeObservability = {
    sentryEnabled: Boolean(sentryDsn),
    posthogEnabled: Boolean(posthogKey),
    events: [],
  };
}

export function captureException(error, context = {}) {
  if (typeof window === "undefined") return;
  window.__siteforgeObservability = window.__siteforgeObservability || { events: [] };
  window.__siteforgeObservability.events.push({
    type: "exception",
    message: error?.message || String(error),
    context,
    at: new Date().toISOString(),
  });
}

export function track(event, properties = {}) {
  if (typeof window === "undefined") return;
  window.__siteforgeObservability = window.__siteforgeObservability || { events: [] };
  window.__siteforgeObservability.events.push({
    type: "analytics",
    event,
    properties,
    at: new Date().toISOString(),
  });
}
