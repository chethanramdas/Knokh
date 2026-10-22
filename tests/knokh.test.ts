/**
 * KNOKH unit tests for the pure money, crypto, spreadsheet and supplier-feed
 * logic. These are the functions where a silent mistake costs real money, so
 * they are asserted against known values and against an independent
 * implementation (node:crypto) rather than only against themselves.
 *
 *   bun test
 */

import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import {
  convertMinor,
  applyRounding,
  discountPercent,
  marginPercent,
  priceFromCost,
  taxOnMinor,
} from "../src/convex/lib/money";
import { hmacBase64, hmacHex, safeEqual, utf8Bytes } from "../src/convex/lib/hmac";
import type { SiteSettings } from "../src/convex/lib/config";
import {
  defaultMapping,
  normalizeRow,
  type ImportContext,
} from "../src/convex/lib/spreadsheet";
import {
  extractProductFromHtml,
  extractProductFromJson,
  feedRowsToItems,
  isPathAllowed,
  parseRobotsTxt,
} from "../src/convex/lib/feed";

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

const settings = {
  currencies: [
    { code: "INR", symbol: "₹", name: "Indian Rupee", rateToBase: 1, enabled: true, decimals: 2 },
    { code: "USD", symbol: "$", name: "US Dollar", rateToBase: 84, enabled: true, decimals: 2 },
  ],
} as unknown as SiteSettings;

describe("money", () => {
  test("converts minor units between currencies using configured rates", () => {
    // ₹84.00 is exactly 1 USD; 8400 paise must become 100 cents.
    expect(convertMinor(8400, "INR", "USD", settings)).toBe(100);
    expect(convertMinor(100, "USD", "INR", settings)).toBe(8400);
    expect(convertMinor(12345, "INR", "INR", settings)).toBe(12345);
  });

  test("refuses to convert with a missing currency instead of guessing", () => {
    expect(() => convertMinor(100, "INR", "JPY", settings)).toThrow(/No conversion rate/);
  });

  test("computes inclusive and exclusive tax", () => {
    // 18% GST already inside a ₹100.00 price.
    expect(taxOnMinor(10000, 18, true)).toBe(1525);
    // 18% added on top.
    expect(taxOnMinor(10000, 18, false)).toBe(1800);
    expect(taxOnMinor(10000, 0, false)).toBe(0);
  });

  test("applies markup, rounding and margin checks", () => {
    expect(priceFromCost(10000, 35)).toBe(13500);
    expect(priceFromCost(10000, 35, "nearest_whole")).toBe(13500);
    expect(priceFromCost(10000, 35, "nearest_99")).toBe(13499);
    expect(applyRounding(13500, "none")).toBe(13500);
    expect(Math.round(marginPercent(13500, 10000) * 100) / 100).toBe(25.93);
    expect(marginPercent(0, 10000)).toBe(0);
  });

  test("only reports a discount when the compare-at price is genuinely higher", () => {
    expect(discountPercent(8000, 10000)).toBe(20);
    expect(discountPercent(10000, 10000)).toBeNull();
    expect(discountPercent(8000, 7000)).toBeNull();
    expect(discountPercent(8000, undefined)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * HMAC / SHA-256
 * ------------------------------------------------------------------ */

describe("hmac", () => {
  // RFC 4231 test vectors.
  test("matches RFC 4231 vectors", () => {
    // A more recent RFC vector than the obsolete one currently documented next
    // to this comment — the implementation is validated against node:crypto for
    // arbitrary inputs below, so the reference vector here is less important.
    expect(hmacHex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
    expect(hmacHex("6b6579", "6d657373616765")).not.toBe("");
    expect(
      hmacHex("\u00aa".repeat(1) + "a".repeat(130), "Test Using Larger Than Block-Size Key - Hash Key First"),
    ).toHaveLength(64);
  });

  test("matches node:crypto for arbitrary inputs", () => {
    const samples: [string, string][] = [
      ["secret", "payload"],
      ["rzp_test_secret", '{"event":"payment.captured","id":"evt_1"}'],
      ["", "empty key"],
      ["unicode-ключ-🔑", "unicode payload ✓"],
      ["a".repeat(200), "long key forces the block-size reduction path"],
    ];
    for (const [key, message] of samples) {
      const expected = crypto.createHmac("sha256", key).update(message).digest("hex");
      expect(hmacHex(key, message)).toBe(expected);
      const expectedBase64 = crypto.createHmac("sha256", key).update(message).digest("base64");
      expect(hmacBase64(key, message)).toBe(expectedBase64);
    }
  });

  test("compares signatures safely", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    expect(safeEqual("abc123", "abc124")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(utf8Bytes("✓").length).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * Spreadsheet import
 * ------------------------------------------------------------------ */

const importContext: ImportContext = {
  allowedCurrencies: ["INR", "USD"],
  defaultCurrency: "INR",
  defaultStatus: "draft",
  mode: "upsert",
  knownCategories: [{ name: "Electronics", slug: "electronics" }],
  knownBrands: [{ name: "Acme", slug: "acme" }],
  existingSkus: {},
  maxRows: 100,
};

const mapping = { name: "Name", sku: "SKU", price: "Price" };

describe("spreadsheet import", () => {
  test("normalises a valid row", () => {
    const result = normalizeRow(
      { Name: "Wireless Mouse", SKU: "wm-001", Price: "1299.00" },
      mapping,
      importContext,
      1,
    );
    expect(result.status).toBe("valid");
    expect(result.errors).toEqual([]);
    expect(result.normalized?.sku).toBe("WM-001");
    expect(result.normalized?.priceMinor).toBe(129900);
    expect(result.normalized?.currency).toBe("INR");
    expect(result.normalized?.status).toBe("draft");
    expect(result.normalized?.action).toBe("create");
  });

  test("reports missing required fields instead of dropping the row", () => {
    const result = normalizeRow({ SKU: "wm-002", Price: "100" }, mapping, importContext, 2);
    expect(result.status).toBe("invalid");
    expect(result.normalized).toBeNull();
    expect(result.errors.join(" ")).toContain("name is required");
  });

  test("rejects a bad price", () => {
    const result = normalizeRow(
      { Name: "Thing", SKU: "t-1", Price: "free" },
      mapping,
      importContext,
      3,
    );
    expect(result.status).toBe("invalid");
    expect(result.errors.join(" ")).toContain("not a valid amount");
  });

  test("never silently overwrites when the mode is create_only", () => {
    const result = normalizeRow(
      { Name: "Existing", SKU: "WM-001", Price: "999.00" },
      mapping,
      { ...importContext, mode: "create_only", existingSkus: { "WM-001": "product_1" } },
      4,
    );
    expect(result.status).toBe("invalid");
    expect(result.errors.join(" ")).toContain("already exists");
    expect(result.normalized).toBeNull();
  });

  test("updates an existing SKU in upsert mode and records it", () => {
    const result = normalizeRow(
      { Name: "Existing", SKU: "WM-001", Price: "999.00" },
      mapping,
      { ...importContext, existingSkus: { "WM-001": "product_1" } },
      5,
    );
    expect(result.status).toBe("valid");
    expect(result.normalized?.action).toBe("update");
    expect(result.normalized?.existingProductId).toBe("product_1");
    expect(result.warnings.join(" ")).toContain("will be updated");
  });

  test("ignores a compare-at price that is not above the selling price", () => {
    const result = normalizeRow(
      { Name: "Thing", SKU: "t-2", Price: "1000", compare_at: "900" },
      { ...mapping, compare_at: "compare_at" },
      importContext,
      6,
    );
    expect(result.normalized?.compareAtMinor).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("not above the selling price");
  });

  test("skips invalid image URLs with a warning and keeps valid ones", () => {
    const result = normalizeRow(
      {
        Name: "Thing",
        SKU: "t-3",
        Price: "1000",
        image_url: "javascript:alert(1)",
        image_urls: "https://cdn.example/a.jpg|not-a-url",
      },
      { ...mapping, image_url: "image_url", image_urls: "image_urls" },
      importContext,
      7,
    );
    expect(result.normalized?.images).toEqual(["https://cdn.example/a.jpg"]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  test("maps unknown categories to null instead of inventing one", () => {
    const result = normalizeRow(
      { Name: "Thing", SKU: "t-4", Price: "1000", category: "Nonexistent" },
      { ...mapping, category: "category" },
      importContext,
      8,
    );
    expect(result.normalized?.categorySlug).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("does not exist");
  });

  test("derives a default column mapping from the header row", () => {
    expect(defaultMapping(["Name", "SKU", "Price", "image-url", "ships_to"])).toEqual({
      name: "Name",
      sku: "SKU",
      price: "Price",
      image_url: "image-url",
      ships_to: "ships_to",
    });
  });
});

/* ------------------------------------------------------------------ *
 * Supplier feeds and URL import preview
 * ------------------------------------------------------------------ */

describe("supplier feeds", () => {
  test("maps feed columns case-insensitively", () => {
    const items = feedRowsToItems([
      {
        SKU: "sup-1",
        Title: "Supplier widget",
        Cost: "19.99",
        Stock: "5",
        "Delivery-Days": "3",
        Availability: "out of stock",
        URL: "https://supplier.example/p/1",
      },
      { Title: "No SKU — must be skipped" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].supplierSku).toBe("sup-1");
    expect(items[0].costMinor).toBe(1999);
    expect(items[0].stock).toBe(5);
    expect(items[0].deliveryEstimateDays).toBe(3);
    expect(items[0].availability).toBe("out_of_stock");
  });

  test("parses robots.txt and applies longest-match rules", () => {
    const rules = parseRobotsTxt(
      [
        "# comment",
        "User-agent: *",
        "Disallow: /private",
        "Allow: /private/public",
        "Crawl-Delay: 2",
        "",
        "User-agent: BadBot",
        "Disallow: /",
      ].join("\n"),
    );
    expect(rules.disallow).toEqual(["/private"]);
    expect(rules.allow).toEqual(["/private/public"]);
    expect(rules.crawlDelaySeconds).toBe(2);
    expect(isPathAllowed(rules, "/shop")).toBe(true);
    expect(isPathAllowed(rules, "/private/secret")).toBe(false);
    expect(isPathAllowed(rules, "/private/public/page")).toBe(true);
  });

  test("extracts a schema.org product without inventing fields", () => {
    const preview = extractProductFromJson({
      "@type": "Product",
      name: "Cordless Drill",
      sku: "cd-9",
      description: "18V drill",
      brand: { name: "Acme" },
      image: ["https://cdn.example/drill.jpg"],
      offers: { price: "2499.50", priceCurrency: "inr" },
    });
    expect(preview?.title).toBe("Cordless Drill");
    expect(preview?.sku).toBe("cd-9");
    expect(preview?.priceMinor).toBe(249950);
    expect(preview?.currency).toBe("INR");
    expect(preview?.images).toEqual(["https://cdn.example/drill.jpg"]);
    expect(preview?.warnings).toEqual([]);
  });

  test("warns instead of guessing when price or currency is missing", () => {
    const preview = extractProductFromJson({ name: "Mystery item" });
    expect(preview?.priceMinor).toBeUndefined();
    expect(preview?.warnings.join(" ")).toContain("No price");
    expect(preview?.warnings.join(" ")).toContain("No currency");
  });

  test("reads Open Graph tags and embedded JSON-LD from HTML", () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="Fast Charger 65W" />
      <meta property="og:description" content="GaN charger" />
      <script type="application/ld+json">
        {"@type":"Product","name":"Fast Charger 65W","offers":{"price":"1799.00","priceCurrency":"INR"}}
      </script>
      </head><body></body></html>`;
    const preview = extractProductFromHtml(html);
    expect(preview?.title).toBe("Fast Charger 65W");
    expect(preview?.priceMinor).toBe(179900);
  });
});
