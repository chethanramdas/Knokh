export async function onRequestGet({ request }: { request: Request }) {
  if (new URL(request.url).hostname !== "knokh.com") {
    return new Response("Sitemap is available on knokh.com.", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex" },
    });
  }

  try {
    const upstream = await fetch("https://agreeable-caterpillar-156.convex.site/sitemap.xml", {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (upstream.ok && upstream.headers.get("Content-Type")?.startsWith("application/xml")) {
      return new Response(upstream.body, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
  } catch {
    // Give crawlers a retryable response when the catalog backend is unavailable.
  }
  return new Response("Sitemap temporarily unavailable.", {
    status: 503,
    headers: { "Retry-After": "300" },
  });
}
