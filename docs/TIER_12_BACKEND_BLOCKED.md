# Tier 12 — Backend-Blocked Decisions

SiteForge is now scaffolded as a local-first operations platform. The following production capabilities should not be built further in the browser-only demo because they require backend credentials, compliance decisions, or third-party platform setup.

## Required Decisions

| Decision | Recommendation | Unlocks |
| --- | --- | --- |
| Real authentication | Supabase Auth with org-scoped roles and row-level security | Multi-user login, role per project, client portal identity, Director authority controls |
| Database/backend | Supabase Postgres plus Storage | Cross-device sync, durable document blobs, audit chain persistence, realtime collaboration |
| Email provider | Resend | ClientFlow magic links, report delivery, support requests, escalation emails |
| SMS provider | Twilio | Urgent escalations, magic-link backup, ticket/COI expiry warnings |
| Buildxact API access | Replace `src/services/integrations/buildxact/client.js` fixtures with signed API calls | Real project/client/supplier/cost-code pull and signed variation push |
| Teams bot deployment | Azure Bot Framework + Teams app manifest | Real adaptive card delivery, Teams approval actions, ChatOps commands |
| Billing | Stripe Billing | Free/Starter/Pro/Enterprise subscriptions and usage metering |
| Mobile wrapper | Capacitor | Native camera, push notifications, app store presence, background sync affordances |
| Compliance pack | AU privacy policy, DPA, pen test plan, SOC 2 roadmap | Enterprise sales, legal review, high-trust client onboarding |

## Do Not Fake These In Frontend

- Do not store production API secrets in IndexedDB or exported JSON.
- Do not send real email/SMS/Teams messages from the browser.
- Do not present local-only audit entries as server-verified compliance evidence.
- Do not claim real Buildxact sync until API credentials and scopes are configured.
- Do not process paid billing states without Stripe webhooks.

## One-File Backend Cutover Points

- `src/services/data/client.supabase.js` — replace the local client when Supabase is configured.
- `src/services/integrations/buildxact/client.js` — swap fixture responses for real Buildxact fetch calls.
- `src/services/integrations/teams/dispatcher.js` — connect outbound events to Azure Bot / Teams webhook delivery.
- `src/services/observability.js` — wire real Sentry and PostHog SDK calls once DSNs/keys are provided.

## Recommended Backend Order

1. Supabase Auth + Postgres + Storage.
2. Resend for ClientFlow magic links and reports.
3. Buildxact real API connector.
4. Teams bot deployment.
5. Stripe billing.
6. Capacitor mobile wrapper.
7. Compliance pack and pen-test readiness.
