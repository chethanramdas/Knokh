import { useEffect } from "react";
import { BRAND } from "./brand";

function setMeta(attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function setCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}

export type PageMeta = {
  title: string;
  description?: string;
  /** Relative path used to build the canonical URL. */
  path?: string;
  siteUrl?: string;
  image?: string;
  /** Private pages (cart, checkout, account, admin) are never indexed. */
  noIndex?: boolean;
  /** JSON-LD structured data for this page. */
  jsonLd?: Record<string, unknown> | null;
};

/**
 * Applies page metadata. Everything here is presentation only — the same data
 * is also rendered into the sitemap by the Convex HTTP routes.
 */
export function usePageMeta(meta: PageMeta) {
  useEffect(() => {
    const title = meta.title.includes(BRAND.name)
      ? meta.title
      : `${meta.title} | ${BRAND.name}`;
    document.title = title;
    setMeta("property", "og:title", title);
    setMeta("name", "twitter:title", title);

    const description = meta.description ?? BRAND.description;
    setMeta("name", "description", description);
    setMeta("property", "og:description", description);

    const base = (meta.siteUrl ?? "").replace(/\/$/, "");
    const canonical =
      base && meta.path ? `${base}${meta.path}` : `${window.location.origin}${meta.path ?? window.location.pathname}`;
    setCanonical(canonical);
    setMeta("property", "og:url", canonical);
    setMeta("property", "og:type", meta.path?.startsWith("/product/") ? "product" : "website");

    if (meta.image) {
      setMeta("property", "og:image", meta.image);
      setMeta("name", "twitter:image", meta.image);
    }

    setMeta("name", "robots", meta.noIndex ? "noindex, nofollow" : "index, follow");

    const scriptId = "knokh-json-ld";
    document.getElementById(scriptId)?.remove();
    if (meta.jsonLd) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.id = scriptId;
      script.textContent = JSON.stringify(meta.jsonLd);
      document.head.appendChild(script);
    }
  }, [
    meta.title,
    meta.description,
    meta.path,
    meta.siteUrl,
    meta.image,
    meta.noIndex,
    meta.jsonLd,
  ]);
}

/** Product structured data. Values come straight from the real catalog record. */
export function productJsonLd(args: {
  name: string;
  description?: string;
  sku: string;
  image?: string;
  priceMinor: number;
  currency: string;
  inStock: boolean;
  siteUrl?: string;
  path: string;
  ratingAvg?: number;
  ratingCount?: number;
  brandName?: string;
}): Record<string, unknown> {
  const base = (args.siteUrl ?? "").replace(/\/$/, "");
  const json: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: args.name,
    sku: args.sku,
    description: args.description,
    image: args.image ? [args.image] : undefined,
    offers: {
      "@type": "Offer",
      price: (args.priceMinor / 100).toFixed(2),
      priceCurrency: args.currency,
      availability: args.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: base ? `${base}${args.path}` : undefined,
    },
  };
  if (args.brandName) json.brand = { "@type": "Brand", name: args.brandName };
  // Ratings are only published when real, approved reviews exist.
  if (args.ratingAvg && args.ratingCount && args.ratingCount > 0) {
    json.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: args.ratingAvg,
      reviewCount: args.ratingCount,
    };
  }
  return json;
}
