import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { getUser, resolveOwnerKey } from "./lib/auth";
import type { SiteSettings } from "./lib/config";
import { discountPercent } from "./lib/money";
import { getSettings, providerRuntimeStatus } from "./lib/settings";

/**
 * Catalog reads are bounded per request so a single query can never scan an
 * unbounded table. See README → "Catalog scanning limits" for how to raise the
 * window (denormalised filter tables / larger Convex search indexes).
 */
const SCAN_LIMIT = 600;
const MAX_PER_PAGE = 48;

export const productStatusFilter = v.union(
  v.literal("draft"),
  v.literal("published"),
  v.literal("unavailable"),
  v.literal("archived"),
);

type SerializedProduct = {
  _id: Id<"products">;
  sku: string;
  slug: string;
  name: string;
  summary?: string;
  image?: string;
  images: { url: string; alt?: string }[];
  priceMinor: number;
  compareAtMinor?: number;
  discountPercent: number | null;
  currency: string;
  stock: number;
  inStock: boolean;
  status: Doc<"products">["status"];
  badge?: string;
  categoryId?: Id<"categories">;
  subcategoryId?: Id<"categories">;
  brandId?: Id<"brands">;
  ratingAvg?: number;
  ratingCount: number;
  unitsSold: number;
  isDemo: boolean;
  deliveryEstimateDays: number;
  shipsTo: string[];
  hasVariants: boolean;
  variantCount: number;
  supplierId?: Id<"suppliers">;
  sourceUrl?: string;
  updatedAt: number;
};

function serializeProduct(product: Doc<"products">): SerializedProduct {
  const variants = product.variants ?? [];
  const stock = product.stock + variants.reduce((sum, variant) => sum + Math.max(0, variant.stock), 0);
  const ratingCount = product.ratingCount ?? 0;
  return {
    _id: product._id,
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    summary: product.summary,
    image: product.images?.[0]?.url,
    images: (product.images ?? []).map((image) => ({
      url: image.url,
      alt: image.alt,
    })),
    priceMinor: product.priceMinor,
    compareAtMinor: product.compareAtMinor,
    discountPercent: discountPercent(product.priceMinor, product.compareAtMinor),
    currency: product.currency,
    stock,
    inStock: stock > 0 && product.status === "published",
    status: product.status,
    badge: product.featured ? "Featured" : undefined,
    categoryId: product.categoryId,
    subcategoryId: product.subcategoryId,
    brandId: product.brandId,
    ratingAvg: ratingCount > 0 ? product.ratingAvg : undefined,
    ratingCount,
    unitsSold: product.unitsSold ?? 0,
    isDemo: product.isDemo === true,
    deliveryEstimateDays: product.deliveryEstimateDays ?? 7,
    shipsTo: product.shipsTo ?? [],
    hasVariants: variants.length > 0,
    variantCount: variants.length,
    supplierId: product.supplierId,
    sourceUrl: product.sourceUrl,
    updatedAt: product.updatedAt,
  };
}

/* ---------------------------- configuration ---------------------------- */

/** Public, secret-free configuration for the storefront. */
export const getStoreConfig = query({
  args: {},
  handler: async (ctx) => {
    const settings = await getSettings(ctx);
    const user = await getUser(ctx);
    const providers = settings.payments.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      enabled: provider.enabled,
      status: providerRuntimeStatus(provider.envVars),
      countries: provider.countries,
      currencies: provider.currencies,
      docsUrl: provider.docsUrl,
      missingEnvVars: provider.envVars,
    }));
    return {
      brand: settings.brand,
      contact: settings.contact,
      commerce: settings.commerce,
      seo: settings.seo,
      pricing: {
        minimumMarginPercent: settings.pricing.minimumMarginPercent,
        defaultMarkupPercent: settings.pricing.defaultMarkupPercent,
      },
      currencies: settings.currencies,
      shippingZones: settings.shippingZones,
      taxRules: settings.taxRules,
      homepage: settings.homepage
        .filter((section) => section.enabled)
        .sort((a, b) => a.position - b.position),
      payments: {
        providers,
        codEnabled: settings.commerce.codEnabled,
        testGatewayEnabled: settings.payments.testGatewayEnabled,
      },
      viewer: {
        isSignedIn: user !== null,
        isAdmin: user?.role === "admin",
        name: user?.name ?? null,
        email: user?.email ?? null,
        defaultCurrency: user?.defaultCurrency ?? settings.commerce.defaultCurrency,
      },
    };
  },
});

/** Admin-only: which env vars are still missing before a provider can run. */
export const paymentProviderStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (user?.role !== "admin") return [];
    const settings = await getSettings(ctx);
    return settings.payments.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      docsUrl: provider.docsUrl,
      enabled: provider.enabled,
      status: providerRuntimeStatus(provider.envVars),
      missing: provider.envVars.filter((key) => !process.env[key]),
      configuredVars: provider.envVars.filter((key) => Boolean(process.env[key])),
    }));
  },
});

/* ------------------------------ categories ------------------------------ */

export const listCategories = query({
  args: { withCounts: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const categories = await ctx.db
      .query("categories")
      .withIndex("by_position")
      .take(300);
    const active = categories.filter((category) => category.status === "active");

    let counts = new Map<string, number>();
    if (args.withCounts) {
      const products = await ctx.db
        .query("products")
        .withIndex("by_status", (q) => q.eq("status", "published"))
        .take(SCAN_LIMIT);
      counts = products.reduce((map, product) => {
        const keys = [product.categoryId, product.subcategoryId].filter(
          Boolean,
        ) as string[];
        for (const key of keys) {
          map.set(key, (map.get(key) ?? 0) + 1);
        }
        return map;
      }, new Map<string, number>());
    }

    return active.map((category) => ({
      _id: category._id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId ?? null,
      description: category.description,
      image: category.image,
      icon: category.icon,
      featured: category.featured,
      position: category.position,
      productCount: counts.get(category._id) ?? 0,
      attributes: category.attributes ?? [],
    }));
  },
});

export const getCategoryBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const category = await ctx.db
      .query("categories")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!category || category.status !== "active") return null;
    const children = await ctx.db
      .query("categories")
      .withIndex("by_parent", (q) => q.eq("parentId", category._id))
      .take(100);
    const attributes = category.attributes ?? [];
    const attributeOptions = await Promise.all(
      attributes.map(async (attribute) => {
        const products = await ctx.db
          .query("products")
          .withIndex("by_category", (q) =>
            q.eq("categoryId", category._id).eq("status", "published"),
          )
          .take(SCAN_LIMIT);
        const values = new Set<string>();
        for (const product of products) {
          const match = (product.attributes ?? []).find(
            (entry) => entry.key === attribute.key,
          );
          if (match?.value) values.add(match.value);
        }
        return {
          key: attribute.key,
          label: attribute.label,
          values: [...values].sort(),
        };
      }),
    );
    return {
      ...category,
      children: children
        .filter((child) => child.status === "active")
        .sort((a, b) => a.position - b.position)
        .map((child) => ({
          _id: child._id,
          name: child.name,
          slug: child.slug,
          image: child.image,
        })),
      attributeOptions,
    };
  },
});

export const listBrands = query({
  args: {},
  handler: async (ctx) => {
    const brands = await ctx.db.query("brands").take(300);
    return brands
      .filter((brand) => brand.status === "active")
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getBrandBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("brands")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

export const listCollections = query({
  args: {},
  handler: async (ctx) => {
    const collections = await ctx.db.query("collections").take(100);
    return collections
      .filter((collection) => collection.status === "active")
      .sort((a, b) => a.position - b.position);
  },
});

export const getCollectionBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const collection = await ctx.db
      .query("collections")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!collection || collection.status !== "active") return null;
    return collection;
  },
});

/* ------------------------------- products ------------------------------- */

const sortValidator = v.union(
  v.literal("newest"),
  v.literal("price_asc"),
  v.literal("price_desc"),
  v.literal("popular"),
  v.literal("rating"),
);

export type ProductQueryArgs = {
  q?: string;
  categorySlug?: string;
  subcategorySlug?: string;
  brandSlug?: string;
  collectionSlug?: string;
  attributeKey?: string;
  attributeValue?: string;
  minMinor?: number;
  maxMinor?: number;
  inStockOnly?: boolean;
  onSaleOnly?: boolean;
  minRating?: number;
  sort?: "newest" | "price_asc" | "price_desc" | "popular" | "rating";
  page?: number;
  perPage?: number;
};

async function resolveCatalogFilters(ctx: QueryCtx, args: ProductQueryArgs) {
  let categoryId: Id<"categories"> | undefined;
  let subcategoryId: Id<"categories"> | undefined;
  if (args.subcategorySlug) {
    const category = await ctx.db
      .query("categories")
      .withIndex("by_slug", (q) => q.eq("slug", args.subcategorySlug!))
      .unique();
    subcategoryId = category?._id;
  } else if (args.categorySlug) {
    const category = await ctx.db
      .query("categories")
      .withIndex("by_slug", (q) => q.eq("slug", args.categorySlug!))
      .unique();
    if (category) {
      // Include products assigned to direct children as well.
      categoryId = category._id;
    }
  }
  let brandId: Id<"brands"> | undefined;
  if (args.brandSlug) {
    const brand = await ctx.db
      .query("brands")
      .withIndex("by_slug", (q) => q.eq("slug", args.brandSlug!))
      .unique();
    brandId = brand?._id;
  }
  let collection: Doc<"collections"> | null = null;
  if (args.collectionSlug) {
    collection = await ctx.db
      .query("collections")
      .withIndex("by_slug", (q) => q.eq("slug", args.collectionSlug!))
      .unique();
  }
  return { categoryId, subcategoryId, brandId, collection };
}

export const listProducts = query({
  args: {
    q: v.optional(v.string()),
    categorySlug: v.optional(v.string()),
    subcategorySlug: v.optional(v.string()),
    brandSlug: v.optional(v.string()),
    collectionSlug: v.optional(v.string()),
    attributeKey: v.optional(v.string()),
    attributeValue: v.optional(v.string()),
    minMinor: v.optional(v.number()),
    maxMinor: v.optional(v.number()),
    inStockOnly: v.optional(v.boolean()),
    onSaleOnly: v.optional(v.boolean()),
    minRating: v.optional(v.number()),
    sort: v.optional(sortValidator),
    page: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const perPage = Math.min(Math.max(args.perPage ?? 24, 1), MAX_PER_PAGE);
    const page = Math.max(args.page ?? 1, 1);
    const filters = await resolveCatalogFilters(ctx, args);

    const term = args.q?.trim();
    let candidates: Doc<"products">[];

    if (term) {
      candidates = await ctx.db
        .query("products")
        .withSearchIndex("search_text", (q) => {
          let search = q.search("searchText", term).eq("status", "published");
          if (filters.brandId) search = search.eq("brandId", filters.brandId);
          if (filters.categoryId)
            search = search.eq("categoryId", filters.categoryId);
          return search;
        })
        .take(SCAN_LIMIT);
    } else if (filters.collection) {
      candidates = [];
      for (const productId of filters.collection.productIds.slice(0, SCAN_LIMIT)) {
        const product = await ctx.db.get(productId);
        if (product) candidates.push(product);
      }
    } else if (filters.categoryId) {
      const direct = await ctx.db
        .query("products")
        .withIndex("by_category", (q) =>
          q.eq("categoryId", filters.categoryId!).eq("status", "published"),
        )
        .take(SCAN_LIMIT);
      const children = await ctx.db
        .query("categories")
        .withIndex("by_parent", (q) => q.eq("parentId", filters.categoryId!))
        .take(50);
      const nested: Doc<"products">[] = [];
      for (const child of children) {
        const items = await ctx.db
          .query("products")
          .withIndex("by_subcategory", (q) =>
            q.eq("subcategoryId", child._id).eq("status", "published"),
          )
          .take(SCAN_LIMIT);
        nested.push(...items);
      }
      candidates = [...direct, ...nested];
    } else if (filters.brandId) {
      candidates = await ctx.db
        .query("products")
        .withIndex("by_brand", (q) =>
          q.eq("brandId", filters.brandId!).eq("status", "published"),
        )
        .take(SCAN_LIMIT);
    } else {
      candidates = await ctx.db
        .query("products")
        .withIndex("by_status", (q) => q.eq("status", "published"))
        .take(SCAN_LIMIT);
    }

    const seen = new Set<string>();
    let products = candidates.filter((product) => {
      if (seen.has(product._id)) return false;
      seen.add(product._id);
      return product.status === "published";
    });

    if (filters.subcategoryId) {
      products = products.filter(
        (product) => product.subcategoryId === filters.subcategoryId,
      );
    }
    if (args.attributeKey && args.attributeValue) {
      products = products.filter((product) =>
        (product.attributes ?? []).some(
          (attribute) =>
            attribute.key === args.attributeKey &&
            attribute.value === args.attributeValue,
        ),
      );
    }
    if (args.minMinor !== undefined) {
      products = products.filter((product) => product.priceMinor >= args.minMinor!);
    }
    if (args.maxMinor !== undefined) {
      products = products.filter((product) => product.priceMinor <= args.maxMinor!);
    }
    if (args.inStockOnly) {
      products = products.filter(
        (product) =>
          product.stock +
            (product.variants ?? []).reduce((sum, variant) => sum + variant.stock, 0) >
          0,
      );
    }
    if (args.onSaleOnly) {
      products = products.filter(
        (product) =>
          product.compareAtMinor !== undefined &&
          product.compareAtMinor > product.priceMinor,
      );
    }
    if (args.minRating) {
      products = products.filter(
        (product) =>
          (product.ratingCount ?? 0) > 0 &&
          (product.ratingAvg ?? 0) >= args.minRating!,
      );
    }

    const sort = args.sort ?? "newest";
    products.sort((a, b) => {
      switch (sort) {
        case "price_asc":
          return a.priceMinor - b.priceMinor;
        case "price_desc":
          return b.priceMinor - a.priceMinor;
        case "popular":
          return (b.unitsSold ?? 0) - (a.unitsSold ?? 0);
        case "rating":
          return (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
        default:
          return b._creationTime - a._creationTime;
      }
    });

    const total = products.length;
    const start = (page - 1) * perPage;
    const items = products.slice(start, start + perPage).map(serializeProduct);

    return {
      items,
      total,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      hasMore: start + perPage < total,
      scannedLimitReached: candidates.length >= SCAN_LIMIT,
    };
  },
});

export const getProductBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const product = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!product || product.status === "archived") return null;

    const [category, subcategory, brandPojo, supplier] = await Promise.all([
      product.categoryId ? ctx.db.get(product.categoryId) : null,
      product.subcategoryId ? ctx.db.get(product.subcategoryId) : null,
      product.brandId ? ctx.db.get(product.brandId) : null,
      product.supplierId ? ctx.db.get(product.supplierId) : null,
    ]);

    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_product", (q) =>
        q.eq("productId", product._id).eq("status", "approved"),
      )
      .take(20);

    const settings = await getSettings(ctx);

    return {
      product: {
        ...serializeProduct(product),
        description: product.description,
        specs: product.specs ?? [],
        attributes: product.attributes ?? [],
        variants: product.variants ?? [],
        weightGrams: product.weightGrams,
        dimensions: product.dimensions,
        tags: product.tags ?? [],
        seoTitle: product.seoTitle,
        seoDescription: product.seoDescription,
        supplierSku: product.supplierSku,
        supplierName: supplier?.name,
        views: product.views ?? 0,
      },
      category: category
        ? { name: category.name, slug: category.slug }
        : null,
      subcategory: subcategory
        ? { name: subcategory.name, slug: subcategory.slug }
        : null,
      brand: brandPojo
        ? { name: brandPojo.name, slug: brandPojo.slug, logo: brandPojo.logo }
        : null,
      reviews: reviews.map((review) => ({
        _id: review._id,
        rating: review.rating,
        title: review.title,
        body: review.body,
        createdAt: review.createdAt,
      })),
      reviewsEnabled: settings.commerce.reviewsEnabled,
    };
  },
});

export const getRelatedProducts = query({
  args: { productId: v.id("products"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (!product) return [];
    const limit = Math.min(args.limit ?? 8, 12);
    const pool = product.categoryId
      ? await ctx.db
          .query("products")
          .withIndex("by_category", (q) =>
            q.eq("categoryId", product.categoryId!).eq("status", "published"),
          )
          .take(SCAN_LIMIT)
      : await ctx.db
          .query("products")
          .withIndex("by_status", (q) => q.eq("status", "published"))
          .take(SCAN_LIMIT);
    return pool
      .filter((item) => item._id !== product._id)
      .sort(
        (a, b) =>
          Number(b.brandId === product.brandId) -
          Number(a.brandId === product.brandId),
      )
      .slice(0, limit)
      .map(serializeProduct);
  },
});

export const searchSuggestions = query({
  args: { term: v.string() },
  handler: async (ctx, args) => {
    const term = args.term.trim();
    if (term.length < 2) return { products: [], categories: [] };
    const products = await ctx.db
      .query("products")
      .withSearchIndex("search_text", (q) =>
        q.search("searchText", term).eq("status", "published"),
      )
      .take(6);
    const allCategories = await ctx.db.query("categories").take(300);
    const categories = allCategories
      .filter(
        (category) =>
          category.status === "active" &&
          category.name.toLowerCase().includes(term.toLowerCase()),
      )
      .slice(0, 4)
      .map((category) => ({
        name: category.name,
        slug: category.slug,
        image: category.image,
      }));
    return {
      products: products.map((product) => ({
        _id: product._id,
        name: product.name,
        slug: product.slug,
        image: product.images?.[0]?.url,
        priceMinor: product.priceMinor,
        currency: product.currency,
      })),
      categories,
    };
  },
});

/* ------------------------------ home rows ------------------------------ */

async function rowFor(
  ctx: QueryCtx,
  source: string,
  limit: number,
): Promise<SerializedProduct[]> {
  const published = await ctx.db
    .query("products")
    .withIndex("by_status", (q) => q.eq("status", "published"))
    .take(SCAN_LIMIT);

  switch (source) {
    case "new_arrivals":
      return published
        .sort((a, b) => b._creationTime - a._creationTime)
        .slice(0, limit)
        .map(serializeProduct);
    case "best_sellers":
      return published
        .filter((product) => (product.unitsSold ?? 0) > 0)
        .sort((a, b) => (b.unitsSold ?? 0) - (a.unitsSold ?? 0))
        .slice(0, limit)
        .map(serializeProduct);
    case "trending": {
      const score = (product: Doc<"products">) =>
        (product.views ?? 0) + (product.unitsSold ?? 0) * 3;
      const hasSignal = published.some((product) => score(product) > 0);
      // With no real views or sales yet there is nothing to rank, so fall back
      // to the newest products instead of inventing a trend.
      const ranked = hasSignal
        ? [...published].sort((a, b) => score(b) - score(a))
        : [...published].sort((a, b) => b._creationTime - a._creationTime);
      return ranked.slice(0, limit).map(serializeProduct);
    }
    case "deals":
      return published
        .filter(
          (product) =>
            product.compareAtMinor !== undefined &&
            product.compareAtMinor > product.priceMinor,
        )
        .sort((a, b) => {
          const da = discountPercent(a.priceMinor, a.compareAtMinor) ?? 0;
          const db = discountPercent(b.priceMinor, b.compareAtMinor) ?? 0;
          return db - da;
        })
        .slice(0, limit)
        .map(serializeProduct);
    case "featured":
      return published
        .filter((product) => product.featured)
        .slice(0, limit)
        .map(serializeProduct);
    default:
      return published.slice(0, limit).map(serializeProduct);
  }
}

export const getHomeData = query({
  args: {},
  handler: async (ctx) => {
    const settings: SiteSettings = await getSettings(ctx);
    const sections = settings.homepage
      .filter((section) => section.enabled)
      .sort((a, b) => a.position - b.position);

    const rows: Record<
      string,
      { title: string; subtitle?: string; items: SerializedProduct[]; ctaLabel?: string; ctaHref?: string }
    > = {};
    for (const section of sections) {
      if (section.type !== "product_row") continue;
      rows[section.id] = {
        title: section.title,
        subtitle: section.subtitle,
        items: await rowFor(ctx, section.source ?? "new_arrivals", section.limit ?? 8),
        ctaLabel: section.ctaLabel,
        ctaHref: section.ctaHref,
      };
    }

    const categories = (await ctx.db.query("categories").take(300))
      .filter((category) => category.status === "active" && !category.parentId)
      .sort((a, b) => a.position - b.position)
      .slice(0, 12)
      .map((category) => ({
        _id: category._id,
        name: category.name,
        slug: category.slug,
        image: category.image,
        icon: category.icon,
      }));

    const collections = (await ctx.db.query("collections").take(50))
      .filter((collection) => collection.status === "active" && collection.featured)
      .sort((a, b) => a.position - b.position)
      .slice(0, 6)
      .map((collection) => ({
        _id: collection._id,
        name: collection.name,
        slug: collection.slug,
        image: collection.image,
        description: collection.description,
      }));

    const brands = (await ctx.db.query("brands").take(100))
      .filter((brand) => brand.status === "active")
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 12)
      .map((brand) => ({
        _id: brand._id,
        name: brand.name,
        slug: brand.slug,
        logo: brand.logo,
      }));

    const brandCount = await ctx.db.query("brands").take(1);
    void brandCount;

    return { sections, rows, categories, collections, brands };
  },
});

/* ---------------------------- recently viewed ---------------------------- */

export const recordProductView = mutation({
  args: { slug: v.string(), guestKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const product = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!product) return null;
    const user = await getUser(ctx);

    await ctx.db.patch(product._id, { views: (product.views ?? 0) + 1 });

    if (user || args.guestKey) {
      const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
      const existing = await ctx.db
        .query("recently_viewed")
        .withIndex("by_owner_product", (q) =>
          q.eq("ownerKey", ownerKey).eq("productId", product._id),
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { viewedAt: Date.now() });
      } else {
        await ctx.db.insert("recently_viewed", {
          ownerKey,
          productId: product._id,
          viewedAt: Date.now(),
        });
      }
    }
    return product._id;
  },
});

export const getRecentlyViewed = query({
  args: { guestKey: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user && !args.guestKey) return [];
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const entries = await ctx.db
      .query("recently_viewed")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(Math.min(args.limit ?? 8, 20));
    const products: SerializedProduct[] = [];
    for (const entry of entries) {
      const product = await ctx.db.get(entry.productId);
      if (product && product.status === "published") {
        products.push(serializeProduct(product));
      }
    }
    return products;
  },
});

export const trackEvent = mutation({
  args: {
    type: v.union(
      v.literal("page_view"),
      v.literal("product_view"),
      v.literal("add_to_cart"),
      v.literal("checkout_started"),
      v.literal("order_placed"),
      v.literal("search"),
    ),
    path: v.optional(v.string()),
    productId: v.optional(v.id("products")),
    visitorKey: v.optional(v.string()),
    meta: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Privacy: no IP address, no user agent, no cross-site identifier is stored.
    await ctx.db.insert("analytics_events", {
      type: args.type,
      path: args.path?.slice(0, 200),
      productId: args.productId,
      visitorKey: args.visitorKey?.slice(0, 64),
      meta: args.meta?.slice(0, 300),
      createdAt: Date.now(),
    });
    return null;
  },
});
