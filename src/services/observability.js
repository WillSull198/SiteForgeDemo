const sentryDsn = import.meta.env?.VITE_SENTRY_DSN || "";
const posthogKey = import.meta.env?.VITE_POSTHOG_KEY || "";
const posthogHost = import.meta.env?.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let sentryReady = null;
let posthogReady = null;

function loadScriptOnce(key, src) {
  if (typeof window === "undefined") return Promise.resolve(null);
  const existing = document.querySelector(`script[data-siteforge-observability="${key}"]`);
  if (existing) {
    return existing.dataset.ready === "true"
      ? Promise.resolve(window)
      : new Promise((resolve, reject) => {
          existing.addEventListener("load", () => resolve(window), { once: true });
          existing.addEventListener("error", reject, { once: true });
        });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.dataset.siteforgeObservability = key;
    script.onload = () => {
      script.dataset.ready = "true";
      resolve(window);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export function initObservability() {
  if (typeof window === "undefined") return;
  window.__siteforgeObservability = {
    sentryEnabled: Boolean(sentryDsn),
    posthogEnabled: Boolean(posthogKey),
    events: [],
  };
  if (sentryDsn) {
    sentryReady = loadScriptOnce("sentry", "https://browser.sentry-cdn.com/7.120.3/bundle.min.js")
      .then(() => {
        window.Sentry?.init?.({ dsn: sentryDsn, environment: import.meta.env?.MODE || "production" });
      })
      .catch((error) => {
        window.__siteforgeObservability.events.push({ type: "observability-error", provider: "sentry", message: error?.message || "Sentry failed to load" });
      });
  }
  if (posthogKey) {
    posthogReady = loadScriptOnce("posthog", "https://us-assets.i.posthog.com/static/array.js")
      .then(() => {
        window.posthog?.init?.(posthogKey, { api_host: posthogHost, capture_pageview: false, autocapture: false });
      })
      .catch((error) => {
        window.__siteforgeObservability.events.push({ type: "observability-error", provider: "posthog", message: error?.message || "PostHog failed to load" });
      });
  }
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
  if (sentryDsn) {
    Promise.resolve(sentryReady).then(() => window.Sentry?.captureException?.(error, { extra: context })).catch(() => {});
  }
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
  if (posthogKey) {
    Promise.resolve(posthogReady).then(() => window.posthog?.capture?.(event, properties)).catch(() => {});
  }
}
