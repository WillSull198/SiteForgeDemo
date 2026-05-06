// OpenAI proxy for Cloudflare Workers.
// Set OPENAI_API_KEY as a Worker secret.
// SiteForge -> Settings -> AI provider -> OpenAI proxy URL = https://<worker>.workers.dev

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const ok = Boolean(env.OPENAI_API_KEY);
      return new Response(
        JSON.stringify({
          ok,
          secretConfigured: ok,
          service: "siteforge-openai-proxy",
          error: ok ? undefined : "OPENAI_API_KEY secret not set on the worker. Add it under Settings -> Variables and Secrets.",
        }),
        { status: ok ? 200 : 500, headers: { ...corsHeaders(), "Content-Type": "application/json" } },
      );
    }

    if (!url.pathname.startsWith("/v1/")) {
      return new Response(
        JSON.stringify({ error: "This proxy only forwards /v1/* requests to api.openai.com" }),
        { status: 404, headers: { ...corsHeaders(), "Content-Type": "application/json" } },
      );
    }

    const target = `https://api.openai.com${url.pathname}${url.search}`;
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: request.method === "GET" ? undefined : await request.text(),
    });

    const headers = new Headers(upstream.headers);
    Object.entries(corsHeaders()).forEach(([key, value]) => headers.set(key, value));
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
