export function onRequestGet({ request }) {
  const production = new URL(request.url).hostname === "knokh.com";
  // Private pages can be crawled so robots can see their X-Robots-Tag noindex.
  const robots = production
    ? "User-agent: *\nDisallow:\nSitemap: https://knokh.com/sitemap.xml\n"
    : "User-agent: *\nDisallow: /\n";
  return new Response(robots, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
    },
  });
}
