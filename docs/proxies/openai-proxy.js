// OpenAI proxy for Cloudflare Workers.
// Set OPENAI_API_KEY as a Worker secret.
// SiteForge -> Settings -> AI provider -> OpenAI proxy URL = https://<worker>.workers.dev

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
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
