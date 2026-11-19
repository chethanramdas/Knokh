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

    const canonical = new URL(meta.path ?? window.location.pathname, "https://knokh.com").href;
    setCanonical(canonical);
    setMeta("property", "og:url", canonical);
    setMeta("property", "og:type", meta.path?.startsWith("/product/") ? "product" : "website");

    let imageUrl = "https://knokh.com/knokh-logo.png";
    if (meta.image) {
      try {
        const image = new URL(meta.image, canonical);
        if (image.protocol === "https:") imageUrl = image.href;
      } catch {
        // Use the default social image if a catalog image URL is malformed.
      }
    }
    setMeta("property", "og:image", imageUrl);
    setMeta("name", "twitter:image", imageUrl);
    setMeta("name", "twitter:description", description);

    setMeta("name", "robots", (meta.noIndex || window.location.hostname !== "knokh.com") ? "noindex, nofollow" : "index, follow");

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
  const url = new URL(args.path, "https://knokh.com").href;
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
      url,
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


export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(({ name, path }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: new URL(path, "https://knokh.com").href,
    })),
  };
}
