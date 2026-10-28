/**
 * Pure helpers for the URL import preview.
 *
 * These are kept database- and network-free so they can be unit-tested
 * directly. The importer is deliberately conservative: it reads a single page,
 * respects robots.txt, never sends credentials, and never attempts to work
 * around a paywall, CAPTCHA or rate limit.
 */

export type FeedItem = {
  supplierSku: string;
  supplierProductId?: string;
  title?: string;
  costMinor?: number;
  currency?: string;
  stock?: number;
  availability?: "in_stock" | "low_stock" | "out_of_stock" | "discontinued" | "unknown";
  shippingEstimateMinor?: number;
  deliveryEstimateDays?: number;
  shipsTo?: string[];
  sourceUrl?: string;
};

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const found = Object.keys(row).find(
      (candidate) => candidate.toLowerCase().replace(/[\s-]+/g, "_") === key,
    );
    if (found !== undefined && row[found] !== "" && row[found] !== null) return row[found];
  }
  return undefined;
}

/**
 * Maps supplier feed rows (JSON or CSV) onto a normalised shape. Feed columns
 * are matched case-insensitively and with either `-` or `_` separators.
 */
export function feedRowsToItems(rows: Record<string, unknown>[]): FeedItem[] {
  return rows
    .map((row) => {
      const sku = pick(row, ["sku", "supplier_sku", "supplier_sku_id", "id", "product_id"]);
      if (!sku) return null;
      const stock = pick(row, ["stock", "quantity", "qty", "inventory", "available_stock"]);
      const days = pick(row, ["delivery_days", "handling_time", "lead_time"]);
      const item: FeedItem = {
        supplierSku: String(sku),
        supplierProductId: pick(row, ["product_id", "supplier_product_id"])
          ? String(pick(row, ["product_id", "supplier_product_id"]))
          : undefined,
        title: pick(row, ["title", "name", "product_name"])
          ? String(pick(row, ["title", "name", "product_name"]))
          : undefined,
        costMinor: toMinor(pick(row, ["cost", "cost_price", "supplier_price", "price"])),
        currency: pick(row, ["currency", "price_currency"])
          ? String(pick(row, ["currency", "price_currency"])).toUpperCase().slice(0, 3)
          : undefined,
        stock: stock === undefined ? undefined : Math.max(0, Math.trunc(Number(stock))),
        shippingEstimateMinor: toMinor(pick(row, ["shipping_cost", "shipping", "freight"])),
        deliveryEstimateDays: days ? Math.max(1, Math.trunc(Number(days))) : undefined,
        sourceUrl: pick(row, ["url", "product_url", "link"])
          ? String(pick(row, ["url", "product_url", "link"]))
          : undefined,
        availability: (() => {
          const raw = pick(row, ["availability", "status", "in_stock"]);
          if (raw === undefined || raw === null) return undefined;
          const text = String(raw).toLowerCase();
          if (["out_of_stock", "out of stock", "false", "0", "no"].includes(text)) {
            return "out_of_stock" as const;
          }
          if (["discontinued", "removed"].includes(text)) return "discontinued" as const;
          if (["low_stock", "low"].includes(text)) return "low_stock" as const;
          return "in_stock" as const;
        })(),
      };
      return item;
    })
    .filter((item): item is FeedItem => item !== null);
}

export type RobotsRules = {
  disallow: string[];
  allow: string[];
  crawlDelaySeconds?: number;
};

/** Parses the `User-agent: *` group of a robots.txt file. */
export function parseRobotsTxt(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [] };
  let inWildcardGroup = false;
  let sawDirectiveInGroup = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      if (value === "*") {
        inWildcardGroup = true;
        sawDirectiveInGroup = false;
      } else if (inWildcardGroup && sawDirectiveInGroup) {
        inWildcardGroup = false;
      } else if (value !== "*") {
        inWildcardGroup = false;
      }
      continue;
    }
    if (!inWildcardGroup) continue;
    if (key === "disallow") {
      rules.disallow.push(value);
      sawDirectiveInGroup = true;
    } else if (key === "allow") {
      rules.allow.push(value);
      sawDirectiveInGroup = true;
    } else if (key === "crawl-delay") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) rules.crawlDelaySeconds = parsed;
      sawDirectiveInGroup = true;
    }
  }
  return rules;
}

/** Longest-match rule wins, mirroring common crawler behaviour. */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  const matches = (pattern: string) => {
    if (!pattern) return -1;
    const cleaned = pattern.replace(/\*$/, "");
    return path.startsWith(cleaned) ? cleaned.length : -1;
  };
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const pattern of rules.allow) bestAllow = Math.max(bestAllow, matches(pattern));
  for (const pattern of rules.disallow) bestDisallow = Math.max(bestDisallow, matches(pattern));
  if (bestDisallow < 0) return true;
  return bestAllow > bestDisallow;
}

export type ProductPreview = {
  title: string;
  description?: string;
  sku?: string;
  priceMinor?: number;
  currency?: string;
  costMinor?: number;
  images: string[];
  brand?: string;
  warnings: string[];
};

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function toMinor(price: unknown): number | undefined {
  if (price === undefined || price === null || price === "") return undefined;
  const numeric = typeof price === "number" ? price : Number(String(price).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return undefined;
  return Math.round(numeric * 100);
}

function imageUrls(value: unknown): string[] {
  return asArray(value)
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "url" in (entry as Record<string, unknown>)) {
        return String((entry as Record<string, unknown>).url ?? "");
      }
      return "";
    })
    .filter((url) => /^https?:\/\//i.test(url));
}

/** Handles schema.org Product objects and simple JSON catalog feeds. */
export function extractProductFromJson(input: unknown): ProductPreview | null {
  if (!input || typeof input !== "object") return null;
  const root = input as Record<string, unknown>;

  // Google-Merchant-style feed arrays.
  if (Array.isArray(input)) {
    const first = input[0];
    return first ? extractProductFromJson(first) : null;
  }
  if (Array.isArray(root.products)) {
    return extractProductFromJson((root.products as unknown[])[0]);
  }
  // JSON-LD graph.
  if (Array.isArray(root["@graph"])) {
    const product = (root["@graph"] as Record<string, unknown>[]).find((node) =>
      String(node["@type"] ?? "").toLowerCase().includes("product"),
    );
    if (product) return extractProductFromJson(product);
  }

  const title = (root.name ?? root.title) as string | undefined;
  if (!title) return null;
  const offers = (asArray(root.offers)[0] ?? {}) as Record<string, unknown>;
  const price = offers.price ?? root.price ?? root.sale_price;
  const currency = (offers.priceCurrency ?? root.currency ?? root.price_currency) as
    | string
    | undefined;
  const warnings: string[] = [];
  if (!price) warnings.push("No price was found in the source data — set it manually.");
  if (!currency) warnings.push("No currency was found in the source data.");

  return {
    title: String(title).slice(0, 200),
    description: (root.description as string | undefined)?.slice(0, 4000),
    sku: (root.sku ?? root.mpn ?? root.productID) as string | undefined,
    priceMinor: toMinor(price),
    currency: currency ? String(currency).toUpperCase().slice(0, 3) : undefined,
    images: imageUrls(root.image ?? root.images),
    brand: (() => {
      const brand = root.brand;
      if (typeof brand === "string") return brand;
      if (brand && typeof brand === "object" && "name" in (brand as Record<string, unknown>)) {
        return String((brand as Record<string, unknown>).name);
      }
      return undefined;
    })(),
    warnings,
  };
}

const META_PATTERN =
  /<meta[^>]+(?:property|name)=["']([^"']+)["'][^>]+content=["']([^"']*)["'][^>]*>/gi;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Extracts a product preview from an HTML page using Open Graph / standard meta
 * tags and any embedded JSON-LD Product block. Only publicly visible metadata
 * is read.
 */
export function extractProductFromHtml(html: string): ProductPreview | null {
  const meta: Record<string, string> = {};
  for (const match of html.matchAll(META_PATTERN)) {
    const key = match[1].toLowerCase();
    if (!(key in meta)) meta[key] = decodeEntities(match[2]);
  }

  const jsonLdBlocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        const preview = extractProductFromJson(candidate);
        if (preview && preview.images.length > 0) {
          return {
            ...preview,
            title: preview.title || meta["og:title"] || "",
          };
        }
      }
      const preview = extractProductFromJson(candidates[0]);
      if (preview) return preview;
    } catch {
      // Corrupt JSON-LD is common; fall through to meta tags.
    }
  }

  const title = meta["og:title"] ?? meta["twitter:title"] ?? meta["title"];
  if (!title) return null;
  const image =
    meta["og:image"] ?? meta["og:image:url"] ?? meta["twitter:image"] ?? undefined;
  const priceText = meta["product:price:amount"] ?? meta["og:price:amount"];
  const currency = meta["product:price:currency"] ?? meta["og:price:currency"];

  const warnings: string[] = [];
  if (!priceText) warnings.push("No price was published on the page — set it manually.");
  if (!currency) warnings.push("No currency was published on the page.");

  return {
    title: title.slice(0, 200),
    description: (meta["og:description"] ?? meta["description"])?.slice(0, 4000),
    priceMinor: toMinor(priceText),
    currency: currency ? currency.toUpperCase().slice(0, 3) : undefined,
    images: image ? [image] : [],
    brand: meta["product:brand"],
    warnings,
  };
}

const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|metadata\.google\.internal)/i;

/** Guards the URL importer against server-side request forgery. */
export function assertFetchableUrl(input: string): { url: URL; error?: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { url: new URL("https://invalid.invalid"), error: "That is not a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { url, error: "Only http(s) URLs can be imported." };
  }
  if (PRIVATE_HOST_PATTERN.test(url.hostname)) {
    return {
      url,
      error: "Requests to private or internal network addresses are not allowed.",
    };
  }
  return { url };
}
