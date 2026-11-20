import { writeFile } from "node:fs/promises";

if (process.env.CF_PAGES === "1" && process.env.CF_PAGES_BRANCH === "main") {
  try {
    const response = await fetch("https://agreeable-caterpillar-156.convex.site/sitemap.xml", {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/xml")) {
      throw new Error("Convex did not return sitemap XML");
    }
    const xml = await response.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
    if (
      !xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') ||
      !urls.some(([, url]) => url === "https://knokh.com/") ||
      urls.some(([, url]) => !url.startsWith("https://knokh.com/"))
    ) throw new Error("Unexpected sitemap content");
    await writeFile(new URL("../dist/__sitemap-snapshot.xml", import.meta.url), xml);
    console.log(`Saved a sitemap snapshot with ${urls.length} canonical URLs.`);
  } catch (error) {
    console.warn("Skipping the sitemap snapshot:", error instanceof Error ? error.message : "Unknown error");
  }
}
