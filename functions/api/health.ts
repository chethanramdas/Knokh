interface Env { DB?: D1Database }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.DB) {
    return Response.json(
      { ok: false, service: "knokh-api", database: "not_configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await env.DB.prepare("SELECT 1 AS ready").first<{ ready: number }>();
    return Response.json(
      { ok: result?.ready === 1, service: "knokh-api", database: "connected" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, service: "knokh-api", database: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
};
