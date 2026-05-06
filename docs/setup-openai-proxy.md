# SiteForge OpenAI Proxy Setup

OpenAI API keys must not be exposed directly in browser fetches. SiteForge can use Claude directly from the browser, but OpenAI needs a tiny proxy that adds the `Authorization` header server-side and returns CORS headers.

## Cloudflare Workers

1. Create a Cloudflare Worker.
2. Paste `docs/proxies/openai-proxy.js`.
3. Add a secret named `OPENAI_API_KEY`.
4. Deploy the Worker.
5. Open `https://<your-worker>.workers.dev/health`.
6. Confirm it returns `{"ok":true,"secretConfigured":true,"service":"siteforge-openai-proxy"}`.
7. In SiteForge, open Settings -> Device Settings: Integrations.
8. Select `ChatGPT / OpenAI`.
9. Paste your OpenAI key into the OpenAI key field.
10. Paste the Worker URL into `OpenAI proxy URL`.
11. Click `Verify proxy`, then save and click `Test AI Connection`.

## Vercel Edge

1. Add `docs/proxies/openai-proxy-vercel.js` to an Edge Function route.
2. Set `OPENAI_API_KEY` in Vercel environment variables.
3. Deploy.
4. Use the deployed route as the SiteForge OpenAI proxy URL.

## Deno Deploy

1. Create a Deno Deploy project.
2. Paste `docs/proxies/openai-proxy-deno.ts`.
3. Set `OPENAI_API_KEY`.
4. Deploy.
5. Use the deployed URL as the SiteForge OpenAI proxy URL.

## Expected Result

The SiteForge test should show `OpenAI API key works.` Routine assistant calls in demo mode still skip external AI. Real-mode assistant, plan search, and AI draft upgrades can use OpenAI through the proxy.

Before production, restrict `Access-Control-Allow-Origin` in the proxy templates from `*` to the deployed SiteForge domain.
