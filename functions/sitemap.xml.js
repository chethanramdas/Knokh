import { PRODUCTION_CONVEX_ORIGIN } from "../src/lib/deployment.ts";

export async function onRequestGet({ request }) {
  if (new URL(request.url).hostname !== "knokh.com") {
    return new Response(null, {
      status: 404,
      headers: { "X-Robots-Tag": "noindex" },
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const origin = PRODUCTION_CONVEX_ORIGIN.replace(/\.cloud$/, ".site");
    const response = await fetch(`${origin}/sitemap.xml`, {
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/xml" },
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
    console.warn("Sitemap upstream returned an unexpected response", response.status);
  } catch (error) {
    console.warn("Sitemap upstream request failed", error instanceof Error ? error.name : "UnknownError");
  } finally {
    clearTimeout(timeout);
  }
  return new Response("Sitemap temporarily unavailable.", { status: 503 });
}
