import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet as robots } from "../functions/robots.txt.js";
import { onRequestGet as sitemap } from "../functions/sitemap.xml.js";
import schema from "../src/convex/schema";
import { breadcrumbJsonLd, productJsonLd } from "../src/lib/seo";

const fixture = {
  name: "Canvas bag",
  sku: "BAG-01",
  image: "/images/bag.jpg",
  priceMinor: 12550,
  currency: "INR",
  inStock: false,
  path: "/product/canvas-bag",
};

afterEach(() => vi.unstubAllGlobals());

describe("product metadata", () => {
  it("uses catalog price, availability, SKU and absolute images", () => {
    expect(productJsonLd(fixture)).toMatchObject({
      name: fixture.name,
      sku: fixture.sku,
      image: ["https://knokh.com/images/bag.jpg"],
      offers: {
        price: "125.50",
        priceCurrency: "INR",
        availability: "https://schema.org/OutOfStock",
        url: "https://knokh.com/product/canvas-bag",
      },
    });
    expect(productJsonLd(fixture)).not.toHaveProperty("aggregateRating");
  });

  it("omits unsafe or malformed image URLs", () => {
    expect(productJsonLd({ ...fixture, image: "javascript:void(0)" }).image).toBeUndefined();
    expect(productJsonLd({ ...fixture, image: "https://[" }).image).toBeUndefined();
  });

  it("uses ordered absolute breadcrumb links", () => {
    expect(breadcrumbJsonLd([{ name: fixture.name, path: fixture.path }])).toEqual({
      "@type": "BreadcrumbList",
      itemListElement: [{
        "@type": "ListItem", position: 1, name: fixture.name,
        item: "https://knokh.com/product/canvas-bag",
      }],
    });
  });
});

describe("Pages crawler endpoints", () => {
  it("publishes the canonical sitemap location and permits noindex to be seen", async () => {
    const response = robots({ request: new Request("https://knokh.com/robots.txt") });
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("Sitemap: https://knokh.com/sitemap.xml");
    expect(body).not.toContain("Disallow: /");
  });

  it("keeps preview out of search and skips the production sitemap upstream", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const preview = "https://test.knokh-preview.pages.dev";
    expect(await robots({ request: new Request(preview + "/robots.txt") }).text()).toContain("Disallow: /");
    expect((await sitemap({ request: new Request(preview + "/sitemap.xml") })).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves the production XML and rejects an upstream HTML fallback", async () => {
    const request = new Request("https://knokh.com/sitemap.xml");
    const xml = '<?xml version="1.0"?><urlset><url><loc>https://knokh.com/product/canvas-bag</loc></url></urlset>';
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(xml, { headers: { "content-type": "application/xml" } }))
      .mockResolvedValueOnce(new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetch);
    const response = await sitemap({ request });
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(await response.text()).toBe(xml);
    expect(fetch).toHaveBeenCalledWith(
      "https://agreeable-caterpillar-156.convex.site/sitemap.xml",
      expect.objectContaining({ redirect: "error" }),
    );
    expect((await sitemap({ request })).status).toBe(503);
  });
});

it("serves a canonical sitemap from Convex for published catalog records only", async () => {
  const modules = import.meta.glob([
    "../src/convex/**/*.ts", "../src/convex/_generated/*.js", "!../src/convex/**/*.d.ts",
  ]);
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const fields = {
      name: "Canvas bag", images: [], priceMinor: 12550, costMinor: 5000,
      stock: 1, currency: "INR", updatedAt: Date.UTC(2026, 10, 20),
    };
    await ctx.db.insert("products", {
      ...fields, sku: "PUBLIC", slug: "canvas-&-bag", status: "published",
    });
    await ctx.db.insert("products", {
      ...fields, sku: "PRIVATE", slug: "unpublished-bag", status: "draft",
    });
  });

  const response = await t.fetch("/sitemap.xml");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/xml");
  const xml = await response.text();
  expect(xml).toContain("<loc>https://knokh.com/product/canvas-%26-bag</loc>");
  expect(xml).toContain("<lastmod>2026-11-20</lastmod>");
  expect(xml).not.toMatch(/unpublished-bag|<loc>https:\/\/knokh\.com\/(auth|checkout|account|admin|search)\b/);
});
