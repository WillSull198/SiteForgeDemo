// OpenAI proxy for Vercel Edge Functions.
// Set OPENAI_API_KEY in Vercel project environment variables.
// Deploy this as an Edge route, then use that route as the SiteForge OpenAI proxy URL.

export const config = { runtime: "edge" };

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const target = `https://api.openai.com${url.pathname}${url.search}`;
  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: request.method === "GET" ? undefined : await request.text(),
  });

  const headers = new Headers(upstream.headers);
  Object.entries(corsHeaders()).forEach(([key, value]) => headers.set(key, value));
  return new Response(upstream.body, { status: upstream.status, headers });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
