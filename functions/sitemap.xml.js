import { PRODUCTION_CONVEX_ORIGIN } from "../src/lib/deployment.ts";

export async function onRequestGet({ request }) {
  if (new URL(request.url).hostname !== "knokh.com") {
    return new Response(null, {
      status: 404,
      headers: { "X-Robots-Tag": "noindex" },
    });
  }
  try {
    const origin = PRODUCTION_CONVEX_ORIGIN.replace(/\.cloud$/, ".site");
    const response = await fetch(`${origin}/sitemap.xml`, {
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (
      response.ok &&
      response.headers.get("Content-Type")?.startsWith("application/xml")
    ) {
      return new Response(response.body, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
  } catch {
    // The catalog endpoint can be retried without serving a false sitemap.
  }
  return new Response("Sitemap temporarily unavailable.", { status: 503 });
}
