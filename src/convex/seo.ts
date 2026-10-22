import { internalQuery, query } from "./_generated/server";
import { getSettings } from "./lib/settings";

/** Public SEO configuration used by the frontend to build meta tags. */
export const getSeoConfig = query({
  args: {},
  handler: async (ctx) => {
    const settings = await getSettings(ctx);
    return {
      siteUrl: settings.seo.siteUrl,
      defaultTitle: settings.seo.defaultTitle,
      defaultDescription: settings.seo.defaultDescription,
      analyticsId: settings.seo.analyticsId,
      brandName: settings.brand.name,
      twitter: settings.seo.organisationTwitter,
    };
  },
});

/**
 * Sitemap data. Only publicly indexable URLs are included: product, category,
 * brand and collection pages plus the static information pages. Account,
 * cart, checkout and admin routes are deliberately excluded.
 */
export const sitemapEntries = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await getSettings(ctx);
    const products = await ctx.db
      .query("products")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .take(2000);
    const categories = await ctx.db.query("categories").take(300);
    const brands = await ctx.db.query("brands").take(300);
    const collections = await ctx.db.query("collections").take(100);

    return {
      siteUrl: settings.seo.siteUrl,
      products: products.map((product) => ({
        slug: product.slug,
        updatedAt: product.updatedAt,
      })),
      categories: categories
        .filter((category) => category.status === "active")
        .map((category) => ({ slug: category.slug })),
      brands: brands
        .filter((brand) => brand.status === "active")
        .map((brand) => ({ slug: brand.slug })),
      collections: collections
        .filter((collection) => collection.status === "active")
        .map((collection) => ({ slug: collection.slug })),
    };
  },
});
