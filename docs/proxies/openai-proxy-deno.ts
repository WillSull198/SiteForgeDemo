// OpenAI proxy for Deno Deploy.
// Add OPENAI_API_KEY as an environment variable.
// Use the deployed URL as the SiteForge OpenAI proxy URL.

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const secretConfigured = Boolean(Deno.env.get("OPENAI_API_KEY"));

  if (request.method === "GET" && url.pathname === "/health") {
    return new Response(
      JSON.stringify({
        ok: secretConfigured,
        secretConfigured,
        service: "siteforge-openai-proxy",
        error: secretConfigured ? undefined : "OPENAI_API_KEY secret not set in Deno Deploy environment variables.",
      }),
      { status: secretConfigured ? 200 : 500, headers: { ...corsHeaders(), "Content-Type": "application/json" } },
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
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    },
    body: request.method === "GET" ? undefined : await request.text(),
  });

  const headers = new Headers(upstream.headers);
  Object.entries(corsHeaders()).forEach(([key, value]) => headers.set(key, value));
  return new Response(upstream.body, { status: upstream.status, headers });
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
