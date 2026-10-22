import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getUser, notifyUser, requireAdmin, requireUser, writeAuditLog } from "./lib/auth";
import { marginPercent, priceFromCost } from "./lib/money";
import { getSettings, writeSettings } from "./lib/settings";
import { normalizeSku, slugify, toCsv } from "./lib/util";

/* --------------------------------------------------------------------- *
 * Bootstrap
 * --------------------------------------------------------------------- */

/**
 * The first signed-in user may claim the admin role, and only while no admin
 * exists. After that, admins are promoted deliberately by another admin.
 */
async function countAdmins(ctx: MutationCtx | QueryCtx) {
  const admins = await ctx.db
    .query("users")
    .filter((q) => q.eq(q.field("role"), "admin"))
    .take(1);
  return admins.length;
}

export const claimFirstAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if ((await countAdmins(ctx)) > 0) {
      throw new Error(
        "An administrator already exists. Ask an existing admin to grant you access.",
      );
    }
    if (user.isAnonymous) {
      throw new Error(
        "Sign in with an email address before claiming the administrator role.",
      );
    }
    await ctx.db.patch(user._id, { role: "admin" });
    await writeAuditLog(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "admin.bootstrap",
      entity: "users",
      entityId: String(user._id),
      summary: "First administrator claimed the role",
    });
    return { ok: true };
  },
});

export const adminStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    const admins = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), "admin"))
      .take(1);
    return {
      hasAdmin: admins.length > 0,
      isAdmin: user?.role === "admin",
      canClaim: admins.length === 0 && !!user && !user.isAnonymous,
    };
  },
});

export const listAdminUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(200);
    return users.map((user) => ({
      _id: user._id,
      name: user.name ?? "",
      email: user.email ?? "",
      role: user.role ?? "user",
      isAnonymous: user.isAnonymous === true,
      createdAt: user._creationTime,
    }));
  },
});

export const setUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("user"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (admin._id === args.userId && args.role !== "admin") {
      throw new Error("You cannot remove your own administrator role.");
    }
    await ctx.db.patch(args.userId, { role: args.role });
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "user.role_change",
      entity: "users",
      entityId: String(args.userId),
      summary: `Role set to ${args.role}`,
    });
    return null;
  },
});

/* --------------------------------------------------------------------- *
 * Dashboard
 * --------------------------------------------------------------------- */

export const getOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const orders = await ctx.db.query("orders").order("desc").take(200);
    const products = await ctx.db.query("products").take(1000);
    const suppliers = await ctx.db.query("suppliers").take(100);
    const syncJobs = await ctx.db
      .query("supplier_sync_jobs")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .take(50);
    const importJobs = await ctx.db
      .query("import_jobs")
      .order("desc")
      .take(50);
    const recentAudit = await ctx.db
      .query("audit_logs")
      .withIndex("by_created")
      .order("desc")
      .take(20);

    const paidOrders = orders.filter((order) => order.paymentStatus === "paid");
    const salesBaseMinor = paidOrders.reduce(
      (sum, order) => sum + order.totalBaseMinor,
      0,
    );
    const costBaseMinor = paidOrders.reduce(
      (sum, order) => sum + order.costTotalMinor,
      0,
    );
    const refunds = await ctx.db.query("refunds").take(200);
    const refundedBaseMinor = refunds
      .filter((refund) => refund.status === "completed")
      .reduce((sum, refund) => sum + refund.amountMinor, 0);

    const unitsByProduct = new Map<string, number>();
    // Only the most recent 60 orders are scanned for the best-seller widget so
    // the dashboard query stays fast as the store grows.
    for (const order of orders.slice(0, 60)) {
      const items = await ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .take(50);
      for (const item of items) {
        const key = String(item.productId);
        unitsByProduct.set(key, (unitsByProduct.get(key) ?? 0) + item.quantity);
      }
    }
    const bestSellers = [];
    for (const [productId, units] of [...unitsByProduct.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)) {
      const product = await ctx.db.get(productId as Id<"products">);
      if (product) bestSellers.push({ name: product.name, slug: product.slug, units });
    }

    const settings = await getSettings(ctx);
    const lowStock = products
      .filter((product) => product.stock <= (product.lowStockThreshold ?? 5))
      .slice(0, 10)
      .map((product) => ({
        _id: product._id,
        name: product.name,
        sku: product.sku,
        stock: product.stock,
        status: product.status,
      }));

    const belowMargin = products
      .filter((product) => {
        const cost = product.costMinor ?? 0;
        if (cost <= 0) return false;
        return (
          marginPercent(product.priceMinor, cost) <
          settings.pricing.minimumMarginPercent
        );
      })
      .slice(0, 10)
      .map((product) => ({
        _id: product._id,
        name: product.name,
        sku: product.sku,
        marginPercent: Math.round(marginPercent(product.priceMinor, product.costMinor ?? 0)),
        priceMinor: product.priceMinor,
        costMinor: product.costMinor ?? 0,
        currency: product.currency,
      }));

    const currency = settings.commerce.baseCurrency;
    return {
      currency,
      counts: {
        orders: orders.length,
        paidOrders: paidOrders.length,
        pendingFulfilment: orders.filter((order) =>
          ["pending", "processing", "forwarded"].includes(order.fulfilmentStatus),
        ).length,
        products: products.length,
        published: products.filter((product) => product.status === "published").length,
        drafts: products.filter((product) => product.status === "draft").length,
        customers: (await ctx.db.query("users").take(1000)).length,
        suppliers: suppliers.length,
        configuredSuppliers: suppliers.filter(
          (supplier) => supplier.apiStatus === "connected",
        ).length,
        syncFailures: syncJobs.length,
        importFailures: importJobs.filter((job) => job.status === "failed").length,
        openTickets: (
          await ctx.db
            .query("support_tickets")
            .withIndex("by_status", (q) => q.eq("status", "open"))
            .take(100)
        ).length,
        pendingReturns: (
          await ctx.db
            .query("return_requests")
            .withIndex("by_status", (q) => q.eq("status", "requested"))
            .take(100)
        ).length,
        pendingReviews: (
          await ctx.db
            .query("reviews")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .take(100)
        ).length,
      },
      finance: {
        grossSalesBaseMinor: salesBaseMinor,
        refundedBaseMinor,
        netSalesBaseMinor: salesBaseMinor - refundedBaseMinor,
        costOfGoodsBaseMinor: costBaseMinor,
        // Clearly an estimate, not an audited financial result: it excludes
        // payment fees and ad spend until those are recorded.
        estimatedGrossProfitBaseMinor: salesBaseMinor - costBaseMinor - refundedBaseMinor,
      },
      bestSellers,
      lowStock,
      belowMargin,
      recentActivity: recentAudit.map((entry) => ({
        _id: entry._id,
        action: entry.action,
        summary: entry.summary ?? entry.entity,
        actorEmail: entry.actorEmail ?? "system",
        createdAt: entry.createdAt,
      })),
      recentImportJobs: importJobs.slice(0, 5).map((job) => ({
        _id: job._id,
        type: job.type,
        status: job.status,
        fileName: job.fileName,
        createdRows: job.createdRows,
        invalidRows: job.invalidRows,
        createdAt: job.createdAt,
      })),
    };
  },
});

/* --------------------------------------------------------------------- *
 * Products
 * --------------------------------------------------------------------- */

const variantInput = v.object({
  sku: v.string(),
  name: v.string(),
  options: v.optional(v.array(v.object({ name: v.string(), value: v.string() }))),
  priceMinor: v.number(),
  compareAtMinor: v.optional(v.number()),
  costMinor: v.optional(v.number()),
  stock: v.number(),
  weightGrams: v.optional(v.number()),
  supplierVariantId: v.optional(v.string()),
  image: v.optional(v.string()),
});

export const listProductsAdmin = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    page: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const perPage = Math.min(Math.max(args.perPage ?? 25, 1), 100);
    const page = Math.max(args.page ?? 1, 1);
    let products = await ctx.db.query("products").order("desc").take(600);
    if (args.status && args.status !== "all") {
      products = products.filter((product) => product.status === args.status);
    }
    const search = args.search?.trim().toLowerCase();
    if (search) {
      products = products.filter(
        (product) =>
          product.name.toLowerCase().includes(search) ||
          product.sku.toLowerCase().includes(search) ||
          (product.supplierSku ?? "").toLowerCase().includes(search),
      );
    }
    const total = products.length;
    const items = products.slice((page - 1) * perPage, page * perPage).map((product) => ({
      _id: product._id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      status: product.status,
      priceMinor: product.priceMinor,
      compareAtMinor: product.compareAtMinor,
      costMinor: product.costMinor,
      currency: product.currency,
      stock: product.stock,
      image: product.images?.[0]?.url,
      supplierSku: product.supplierSku,
      supplierId: product.supplierId,
      isDemo: product.isDemo === true,
      updatedAt: product.updatedAt,
      marginPercent:
        product.costMinor && product.costMinor > 0
          ? Math.round(marginPercent(product.priceMinor, product.costMinor))
          : null,
    }));
    return {
      items,
      total,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  },
});

export const getProductAdmin = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) return null;
    const movements = await ctx.db
      .query("inventory_movements")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .order("desc")
      .take(25);
    const history = await ctx.db
      .query("price_history")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .order("desc")
      .take(25);
    const supplierProduct = await ctx.db
      .query("supplier_products")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .unique();
    const settings = await getSettings(ctx);
    const suggestedPriceMinor =
      product.costMinor && product.costMinor > 0
        ? priceFromCost(
            product.costMinor,
            settings.pricing.defaultMarkupPercent,
            settings.pricing.rounding,
          )
        : null;
    return { product, movements, history, supplierProduct, suggestedPriceMinor };
  },
});

export const createProduct = mutation({
  args: {
    name: v.string(),
    sku: v.string(),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    priceMinor: v.number(),
    compareAtMinor: v.optional(v.number()),
    costMinor: v.optional(v.number()),
    stock: v.number(),
    categoryId: v.optional(v.id("categories")),
    subcategoryId: v.optional(v.id("categories")),
    brandId: v.optional(v.id("brands")),
    supplierId: v.optional(v.id("suppliers")),
    supplierSku: v.optional(v.string()),
    supplierProductId: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    images: v.optional(v.array(v.object({ url: v.string(), alt: v.optional(v.string()) }))),
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("unavailable"),
      v.literal("archived"),
    ),
    variants: v.optional(v.array(variantInput)),
    specs: v.optional(v.array(v.object({ label: v.string(), value: v.string() }))),
    attributes: v.optional(
      v.array(v.object({ key: v.string(), label: v.string(), value: v.string() })),
    ),
    weightGrams: v.optional(v.number()),
    dimensions: v.optional(
      v.object({
        lengthCm: v.number(),
        widthCm: v.number(),
        heightCm: v.number(),
      }),
    ),
    deliveryEstimateDays: v.optional(v.number()),
    shipsTo: v.optional(v.array(v.string())),
    seoTitle: v.optional(v.string()),
    seoDescription: v.optional(v.string()),
    featured: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const sku = normalizeSku(args.sku || args.name);
    await ensureUniqueSku(ctx, sku);
    const settings = await getSettings(ctx);
    const baseCurrency = settings.commerce.baseCurrency;

    const productId = await ctx.db.insert("products", {
      name: args.name.trim(),
      slug: await ensureUniqueSlug(ctx, slugify(args.name), null),
      sku,
      searchText: searchTextFor(args.name, sku, args.summary, args.description),
      summary: args.summary,
      description: args.description,
      priceMinor: args.priceMinor,
      compareAtMinor: args.compareAtMinor,
      currency: baseCurrency,
      costMinor: args.costMinor,
      stock: Math.max(0, Math.round(args.stock)),
      categoryId: args.categoryId,
      subcategoryId: args.subcategoryId,
      brandId: args.brandId,
      supplierId: args.supplierId,
      supplierSku: args.supplierSku ? normalizeSku(args.supplierSku) : undefined,
      supplierProductId: args.supplierProductId,
      sourceUrl: args.sourceUrl,
      images: (args.images ?? []).map((image, index) => ({
        url: image.url,
        alt: image.alt ?? args.name,
        position: index,
      })),
      variants: args.variants,
      specs: args.specs,
      attributes: args.attributes,
      weightGrams: args.weightGrams,
      dimensions: args.dimensions,
      deliveryEstimateDays: args.deliveryEstimateDays ?? 7,
      shipsTo: args.shipsTo,
      seoTitle: args.seoTitle,
      seoDescription: args.seoDescription,
      featured: args.featured ?? false,
      status: args.status,
      createdBy: admin._id,
      updatedAt: Date.now(),
    });

    if (args.stock > 0) {
      await ctx.db.insert("inventory_movements", {
        productId,
        delta: Math.round(args.stock),
        reason: "manual",
        note: "Initial stock on product creation",
        actorId: admin._id,
        createdAt: Date.now(),
      });
    }
    await ctx.db.insert("price_history", {
      productId,
      newPriceMinor: args.priceMinor,
      newCostMinor: args.costMinor,
      source: "admin_create",
      actorId: admin._id,
      createdAt: Date.now(),
    });
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "product.create",
      entity: "products",
      entityId: String(productId),
      summary: `Created ${args.name}`,
    });
    return { productId };
  },
});

export const updateProduct = mutation({
  args: {
    productId: v.id("products"),
    patch: v.object({
      name: v.optional(v.string()),
      summary: v.optional(v.string()),
      description: v.optional(v.string()),
      priceMinor: v.optional(v.number()),
      compareAtMinor: v.optional(v.number()),
      costMinor: v.optional(v.number()),
      stock: v.optional(v.number()),
      lowStockThreshold: v.optional(v.number()),
      categoryId: v.optional(v.id("categories")),
      subcategoryId: v.optional(v.id("categories")),
      brandId: v.optional(v.id("brands")),
      supplierId: v.optional(v.id("suppliers")),
      supplierSku: v.optional(v.string()),
      status: v.optional(
        v.union(
          v.literal("draft"),
          v.literal("published"),
          v.literal("unavailable"),
          v.literal("archived"),
        ),
      ),
      featured: v.optional(v.boolean()),
      images: v.optional(v.array(v.object({ url: v.string(), alt: v.optional(v.string()) }))),
      specs: v.optional(v.array(v.object({ label: v.string(), value: v.string() }))),
      attributes: v.optional(
        v.array(v.object({ key: v.string(), label: v.string(), value: v.string() })),
      ),
      variants: v.optional(v.array(variantInput)),
      deliveryEstimateDays: v.optional(v.number()),
      shipsTo: v.optional(v.array(v.string())),
      seoTitle: v.optional(v.string()),
      seoDescription: v.optional(v.string()),
      weightGrams: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Product not found.");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const p = args.patch;

    if (p.name !== undefined) {
      patch.name = p.name.trim();
      patch.slug = await ensureUniqueSlug(ctx, slugify(p.name), product._id);
    }
    for (const key of [
      "summary",
      "description",
      "compareAtMinor",
      "lowStockThreshold",
      "categoryId",
      "subcategoryId",
      "brandId",
      "supplierId",
      "deliveryEstimateDays",
      "shipsTo",
      "seoTitle",
      "seoDescription",
      "weightGrams",
      "featured",
    ] as const) {
      if (p[key] !== undefined) patch[key] = p[key];
    }
    if (p.supplierSku !== undefined) {
      patch.supplierSku = p.supplierSku ? normalizeSku(p.supplierSku) : undefined;
    }
    if (p.priceMinor !== undefined) patch.priceMinor = p.priceMinor;
    if (p.costMinor !== undefined) patch.costMinor = p.costMinor;
    if (p.status !== undefined) patch.status = p.status;
    if (p.images !== undefined) {
      patch.images = p.images.map((image, index) => ({
        url: image.url,
        alt: image.alt ?? p.name ?? product.name,
        position: index,
      }));
    }
    if (p.specs !== undefined) patch.specs = p.specs;
    if (p.attributes !== undefined) patch.attributes = p.attributes;
    if (p.variants !== undefined) patch.variants = p.variants;

    if (p.stock !== undefined) {
      const delta = Math.round(p.stock) - product.stock;
      patch.stock = Math.round(p.stock);
      if (delta !== 0) {
        await ctx.db.insert("inventory_movements", {
          productId: product._id,
          delta,
          reason: "manual",
          note: "Stock corrected in admin",
          actorId: admin._id,
          createdAt: Date.now(),
        });
      }
    }

    const nextName = (patch.name as string | undefined) ?? product.name;
    const nextSku = product.sku;
    patch.searchText = searchTextFor(
      nextName,
      nextSku,
      (patch.summary as string | undefined) ?? product.summary,
      (patch.description as string | undefined) ?? product.description,
    );

    await ctx.db.patch(product._id, patch);

    if (p.priceMinor !== undefined || p.costMinor !== undefined) {
      await ctx.db.insert("price_history", {
        productId: product._id,
        oldPriceMinor: product.priceMinor,
        newPriceMinor: p.priceMinor ?? product.priceMinor,
        oldCostMinor: product.costMinor,
        newCostMinor: p.costMinor ?? product.costMinor,
        source: "admin_update",
        actorId: admin._id,
        createdAt: Date.now(),
      });
    }
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "product.update",
      entity: "products",
      entityId: String(product._id),
      summary: `Updated ${nextName}`,
      metadata: { fields: Object.keys(patch) },
    });
    return { ok: true };
  },
});

export const bulkUpdateProducts = mutation({
  args: {
    productIds: v.array(v.id("products")),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("published"),
        v.literal("unavailable"),
        v.literal("archived"),
      ),
    ),
    featured: v.optional(v.boolean()),
    categoryId: v.optional(v.id("categories")),
    markupPercent: v.optional(v.number()),
    applyRounding: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const settings = await getSettings(ctx);
    let updated = 0;
    for (const productId of args.productIds) {
      const product = await ctx.db.get(productId);
      if (!product) continue;
      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      if (args.status) patch.status = args.status;
      if (args.featured !== undefined) patch.featured = args.featured;
      if (args.categoryId) patch.categoryId = args.categoryId;
      if (args.markupPercent !== undefined) {
        if (!product.costMinor || product.costMinor <= 0) continue;
        patch.priceMinor = priceFromCost(
          product.costMinor,
          args.markupPercent,
          args.applyRounding === false ? "none" : settings.pricing.rounding,
        );
      }
      await ctx.db.patch(productId, patch);
      if (patch.priceMinor !== undefined) {
        await ctx.db.insert("price_history", {
          productId,
          oldPriceMinor: product.priceMinor,
          newPriceMinor: patch.priceMinor as number,
          source: "bulk_markup",
          actorId: admin._id,
          createdAt: Date.now(),
        });
      }
      updated += 1;
    }
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "product.bulk_update",
      entity: "products",
      summary: `Bulk updated ${updated} product(s)`,
    });
    return { updated };
  },
});

export const adjustStock = mutation({
  args: {
    productId: v.id("products"),
    variantSku: v.optional(v.string()),
    delta: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Product not found.");
    const delta = Math.round(args.delta);
    if (delta === 0) return { stock: product.stock };

    if (args.variantSku) {
      const variants = [...(product.variants ?? [])];
      const index = variants.findIndex((variant) => variant.sku === args.variantSku);
      if (index < 0) throw new Error("Variant not found.");
      const next = Math.max(0, variants[index].stock + delta);
      variants[index] = { ...variants[index], stock: next };
      await ctx.db.patch(product._id, { variants, updatedAt: Date.now() });
      await ctx.db.insert("inventory_movements", {
        productId: product._id,
        variantSku: args.variantSku,
        delta,
        reason: "manual",
        note: args.note,
        actorId: admin._id,
        createdAt: Date.now(),
      });
      return { stock: next };
    }

    const next = Math.max(0, product.stock + delta);
    await ctx.db.patch(product._id, { stock: next, updatedAt: Date.now() });
    await ctx.db.insert("inventory_movements", {
      productId: product._id,
      delta,
      reason: "manual",
      note: args.note,
      actorId: admin._id,
      createdAt: Date.now(),
    });
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "inventory.adjust",
      entity: "products",
      entityId: String(product._id),
      summary: `Stock ${delta > 0 ? "+" : ""}${delta} → ${next}`,
    });
    return { stock: next };
  },
});

/** Exports the whole catalog as CSV for spreadsheet editing or backup. */
export const exportProductsCsv = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const products = await ctx.db.query("products").take(1000);
    const rows = [];
    for (const product of products) {
      const category = product.categoryId ? await ctx.db.get(product.categoryId) : null;
      const brand = product.brandId ? await ctx.db.get(product.brandId) : null;
      const supplier = product.supplierId ? await ctx.db.get(product.supplierId) : null;
      rows.push({
        sku: product.sku,
        name: product.name,
        slug: product.slug,
        status: product.status,
        price: (product.priceMinor / 100).toFixed(2),
        compare_at: product.compareAtMinor
          ? (product.compareAtMinor / 100).toFixed(2)
          : "",
        cost: product.costMinor ? (product.costMinor / 100).toFixed(2) : "",
        currency: product.currency,
        stock: product.stock,
        category: category?.name ?? "",
        brand: brand?.name ?? "",
        supplier: supplier?.name ?? "",
        supplier_sku: product.supplierSku ?? "",
        image_url: product.images?.[0]?.url ?? "",
        description: (product.description ?? "").replace(/\s+/g, " ").slice(0, 500),
      });
    }
    const csv = toCsv(
      [
        "sku",
        "name",
        "slug",
        "status",
        "price",
        "compare_at",
        "cost",
        "currency",
        "stock",
        "category",
        "brand",
        "supplier",
        "supplier_sku",
        "image_url",
        "description",
      ],
      rows,
    );
    return { csv, count: rows.length };
  },
});

/* --------------------------------------------------------------------- *
 * Categories, brands, collections
 * --------------------------------------------------------------------- */

export const listCategoriesAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const categories = await ctx.db.query("categories").withIndex("by_position").take(300);
    const products = await ctx.db.query("products").take(1000);
    return categories.map((category) => ({
      ...category,
      productCount: products.filter(
        (product) =>
          product.categoryId === category._id || product.subcategoryId === category._id,
      ).length,
    }));
  },
});

export const saveCategory = mutation({
  args: {
    categoryId: v.optional(v.id("categories")),
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    icon: v.optional(v.string()),
    position: v.optional(v.number()),
    featured: v.optional(v.boolean()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    attributes: v.optional(
      v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          options: v.array(v.string()),
        }),
      ),
    ),
    seoTitle: v.optional(v.string()),
    seoDescription: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const existing = await ctx.db.query("categories").withIndex("by_position").take(300);
    const document = {
      name: args.name.trim(),
      slug: slugify(args.name),
      parentId: args.parentId,
      description: args.description,
      image: args.image,
      icon: args.icon,
      position: args.position ?? existing.length,
      featured: args.featured ?? false,
      status: args.status ?? ("active" as const),
      attributes: args.attributes,
      seoTitle: args.seoTitle,
      seoDescription: args.seoDescription,
    };
    if (args.categoryId) {
      await ctx.db.patch(args.categoryId, document);
      await writeAuditLog(ctx, {
        actorId: admin._id,
        actorEmail: admin.email,
        action: "category.update",
        entity: "categories",
        entityId: String(args.categoryId),
        summary: `Updated category ${document.name}`,
      });
      return { categoryId: args.categoryId };
    }
    const duplicate = existing.find((category) => category.slug === document.slug);
    if (duplicate) {
      throw new Error(`A category with the slug "${document.slug}" already exists.`);
    }
    const categoryId = await ctx.db.insert("categories", document);
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "category.create",
      entity: "categories",
      entityId: String(categoryId),
      summary: `Created category ${document.name}`,
    });
    return { categoryId };
  },
});

export const reorderCategory = mutation({
  args: { categoryId: v.id("categories"), position: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.categoryId, { position: args.position });
    return null;
  },
});

export const listBrandsAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("brands").take(300);
  },
});

export const saveBrand = mutation({
  args: {
    brandId: v.optional(v.id("brands")),
    name: v.string(),
    logo: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const document = {
      name: args.name.trim(),
      slug: slugify(args.name),
      logo: args.logo,
      description: args.description,
      status: args.status ?? ("active" as const),
    };
    if (args.brandId) {
      await ctx.db.patch(args.brandId, document);
      return { brandId: args.brandId };
    }
    const brandId = await ctx.db.insert("brands", document);
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "brand.create",
      entity: "brands",
      entityId: String(brandId),
      summary: `Created brand ${document.name}`,
    });
    return { brandId };
  },
});

export const listCollectionsAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("collections").take(100);
  },
});

export const saveCollection = mutation({
  args: {
    collectionId: v.optional(v.id("collections")),
    name: v.string(),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    position: v.optional(v.number()),
    featured: v.optional(v.boolean()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    productIds: v.array(v.id("products")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const document = {
      name: args.name.trim(),
      slug: slugify(args.name),
      description: args.description,
      image: args.image,
      position: args.position ?? 0,
      featured: args.featured ?? false,
      status: args.status ?? ("active" as const),
      productIds: args.productIds,
    };
    if (args.collectionId) {
      await ctx.db.patch(args.collectionId, document);
      return { collectionId: args.collectionId };
    }
    const collectionId = await ctx.db.insert("collections", document);
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "collection.create",
      entity: "collections",
      entityId: String(collectionId),
      summary: `Created collection ${document.name}`,
    });
    return { collectionId };
  },
});

/* --------------------------------------------------------------------- *
 * Orders, shipments, refunds
 * --------------------------------------------------------------------- */

export const listOrdersAdmin = query({
  args: {
    status: v.optional(v.string()),
    paymentStatus: v.optional(v.string()),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const perPage = Math.min(Math.max(args.perPage ?? 25, 1), 100);
    const page = Math.max(args.page ?? 1, 1);
    let orders = await ctx.db.query("orders").order("desc").take(600);
    if (args.status && args.status !== "all") {
      orders = orders.filter((order) => order.fulfilmentStatus === args.status);
    }
    if (args.paymentStatus && args.paymentStatus !== "all") {
      orders = orders.filter((order) => order.paymentStatus === args.paymentStatus);
    }
    const search = args.search?.trim().toLowerCase();
    if (search) {
      orders = orders.filter(
        (order) =>
          order.orderNumber.toLowerCase().includes(search) ||
          order.customerName.toLowerCase().includes(search) ||
          (order.shippingAddress.email ?? order.guestEmail ?? "")
            .toLowerCase()
            .includes(search),
      );
    }
    const total = orders.length;
    const pageItems = orders.slice((page - 1) * perPage, page * perPage);
    const items = [];
    for (const order of pageItems) {
      const lines = await ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .take(50);
      items.push({
        _id: order._id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        email: order.shippingAddress.email ?? order.guestEmail ?? "",
        placedAt: order.placedAt,
        totalMinor: order.totalMinor,
        currency: order.currency,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        provider: order.provider,
        fulfilmentStatus: order.fulfilmentStatus,
        country: order.shippingAddress.countryCode,
        itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      });
    }
    return { items, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  },
});

export const updateOrderStatus = mutation({
  args: {
    orderId: v.id("orders"),
    fulfilmentStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("forwarded"),
        v.literal("shipped"),
        v.literal("delivered"),
        v.literal("cancelled"),
        v.literal("returned"),
      ),
    ),
    paymentStatus: v.optional(
      v.union(
        v.literal("unpaid"),
        v.literal("pending"),
        v.literal("paid"),
        v.literal("failed"),
        v.literal("refunded"),
        v.literal("partially_refunded"),
        v.literal("cod_pending"),
      ),
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.fulfilmentStatus) patch.fulfilmentStatus = args.fulfilmentStatus;
    if (args.paymentStatus) patch.paymentStatus = args.paymentStatus;
    if (args.notes !== undefined) patch.notes = args.notes;
    await ctx.db.patch(order._id, patch);

    if (args.fulfilmentStatus) {
      const items = await ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .take(100);
      for (const item of items) {
        await ctx.db.patch(item._id, { fulfilmentStatus: args.fulfilmentStatus });
      }
    }
    if (order.userId && args.fulfilmentStatus) {
      await notifyUser(ctx, {
        userId: order.userId,
        type: "order_status",
        title: `Order ${order.orderNumber} is now ${args.fulfilmentStatus}`,
        body: "Track the latest progress from your orders page.",
        link: `/account/orders/${order._id}`,
        orderId: order._id,
      });
    }
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "order.status_update",
      entity: "orders",
      entityId: String(order._id),
      summary: `Order ${order.orderNumber} → ${JSON.stringify(patch)}`,
    });
    return { ok: true };
  },
});

export const addShipment = mutation({
  args: {
    orderId: v.id("orders"),
    carrier: v.string(),
    trackingNumber: v.string(),
    trackingUrl: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("label_created"),
        v.literal("in_transit"),
        v.literal("out_for_delivery"),
        v.literal("delivered"),
        v.literal("failed"),
        v.literal("returned"),
      ),
    ),
    estimatedDelivery: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    const now = Date.now();
    const status = args.status ?? "label_created";
    const existing = await ctx.db
      .query("shipments")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(1);

    const event = {
      at: now,
      status,
      description: `Shipment ${status.replace(/_/g, " ")} via ${args.carrier}`,
    };

    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, {
        carrier: args.carrier,
        trackingNumber: args.trackingNumber,
        trackingUrl: args.trackingUrl,
        status,
        estimatedDelivery: args.estimatedDelivery,
        events: [...existing[0].events, event],
        shippedAt: status === "in_transit" ? now : existing[0].shippedAt,
        deliveredAt: status === "delivered" ? now : existing[0].deliveredAt,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("shipments", {
        orderId: order._id,
        carrier: args.carrier,
        trackingNumber: args.trackingNumber,
        trackingUrl: args.trackingUrl,
        status,
        events: [event],
        estimatedDelivery: args.estimatedDelivery,
        shippedAt: status === "in_transit" ? now : undefined,
        deliveredAt: status === "delivered" ? now : undefined,
        updatedAt: now,
      });
    }

    const fulfilmentStatus =
      status === "delivered" ? "delivered" : status === "returned" ? "returned" : "shipped";
    await ctx.db.patch(order._id, { fulfilmentStatus, updatedAt: now });
    const items = await ctx.db
      .query("order_items")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(100);
    for (const item of items) {
      await ctx.db.patch(item._id, { fulfilmentStatus });
    }
    if (order.userId) {
      await notifyUser(ctx, {
        userId: order.userId,
        type: "shipment_update",
        title: `Order ${order.orderNumber} update`,
        body: `${args.carrier}: ${status.replace(/_/g, " ")}. Tracking ${args.trackingNumber}.`,
        link: `/account/orders/${order._id}`,
        orderId: order._id,
      });
    }
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "order.shipment",
      entity: "orders",
      entityId: String(order._id),
      summary: `Shipment ${status} (${args.carrier} ${args.trackingNumber})`,
    });
    return { ok: true };
  },
});

export const createRefund = mutation({
  args: {
    orderId: v.id("orders"),
    amountMinor: v.number(),
    reason: v.string(),
    status: v.optional(
      v.union(
        v.literal("requested"),
        v.literal("approved"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("rejected"),
        v.literal("failed"),
      ),
    ),
    providerRefundId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    if (args.amountMinor <= 0 || args.amountMinor > order.totalMinor) {
      throw new Error("Refund amount must be between 0 and the order total.");
    }
    const now = Date.now();
    const refundId = await ctx.db.insert("refunds", {
      orderId: order._id,
      amountMinor: args.amountMinor,
      currency: order.currency,
      reason: args.reason,
      status: args.status ?? "requested",
      providerRefundId: args.providerRefundId,
      requestedBy: admin._id,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "refund.create",
      entity: "refunds",
      entityId: String(refundId),
      summary: `Refund ${(args.amountMinor / 100).toFixed(2)} ${order.currency} for ${order.orderNumber}`,
    });
    return { refundId };
  },
});

export const setRefundStatus = mutation({
  args: {
    refundId: v.id("refunds"),
    status: v.union(
      v.literal("requested"),
      v.literal("approved"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("rejected"),
      v.literal("failed"),
    ),
    providerRefundId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const refund = await ctx.db.get(args.refundId);
    if (!refund) throw new Error("Refund not found.");
    await ctx.db.patch(refund._id, {
      status: args.status,
      providerRefundId: args.providerRefundId ?? refund.providerRefundId,
      notes: args.notes ?? refund.notes,
      updatedAt: Date.now(),
    });
    const order = await ctx.db.get(refund.orderId);
    if (order && args.status === "completed") {
      const refunds = await ctx.db
        .query("refunds")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .take(50);
      const completed = refunds
        .filter((entry) => entry.status === "completed")
        .reduce((sum, entry) => sum + entry.amountMinor, 0);
      await ctx.db.patch(order._id, {
        paymentStatus: completed >= order.totalMinor ? "refunded" : "partially_refunded",
        updatedAt: Date.now(),
      });
      if (order.userId) {
        await notifyUser(ctx, {
          userId: order.userId,
          type: "refund_update",
          title: `Refund ${args.status} for ${order.orderNumber}`,
          body: `${(refund.amountMinor / 100).toFixed(2)} ${order.currency}`,
          link: `/account/orders/${order._id}`,
          orderId: order._id,
        });
      }
    }
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "refund.status",
      entity: "refunds",
      entityId: String(refund._id),
      summary: `Refund marked ${args.status}`,
    });
    return { ok: true };
  },
});

export const listRefundsAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const refunds = await ctx.db.query("refunds").order("desc").take(200);
    const out = [];
    for (const refund of refunds) {
      const order = await ctx.db.get(refund.orderId);
      out.push({
        ...refund,
        orderNumber: order?.orderNumber ?? "—",
        email: order?.shippingAddress.email ?? order?.guestEmail ?? "",
      });
    }
    return out;
  },
});

/* --------------------------------------------------------------------- *
 * Reviews, support, coupons, settings, audit
 * --------------------------------------------------------------------- */

export const listReviewsAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const reviews = await ctx.db.query("reviews").order("desc").take(200);
    const out = [];
    for (const review of reviews) {
      const product = await ctx.db.get(review.productId);
      out.push({
        ...review,
        productName: product?.name ?? "Deleted product",
        productSlug: product?.slug ?? "",
      });
    }
    return out;
  },
});

export const moderateReview = mutation({
  args: {
    reviewId: v.id("reviews"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("Review not found.");
    await ctx.db.patch(review._id, { status: args.status });

    if (args.status === "approved") {
      const approved = await ctx.db
        .query("reviews")
        .withIndex("by_product", (q) =>
          q.eq("productId", review.productId).eq("status", "approved"),
        )
        .take(500);
      const ratingCount = approved.length;
      const ratingAvg =
        approved.reduce((sum, entry) => sum + entry.rating, 0) / Math.max(1, ratingCount);
      await ctx.db.patch(review.productId, {
        ratingCount,
        ratingAvg: Math.round(ratingAvg * 10) / 10,
      });
    }
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "review.moderate",
      entity: "reviews",
      entityId: String(review._id),
      summary: `Review ${args.status}`,
    });
    return { ok: true };
  },
});

export const listSupportTickets = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("support_tickets").order("desc").take(200);
  },
});

export const updateSupportTicket = mutation({
  args: {
    ticketId: v.id("support_tickets"),
    status: v.optional(
      v.union(
        v.literal("open"),
        v.literal("pending"),
        v.literal("resolved"),
        v.literal("closed"),
      ),
    ),
    reply: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket) throw new Error("Ticket not found.");
    await ctx.db.patch(ticket._id, {
      status: args.status ?? ticket.status,
      replies: args.reply
        ? [
            ...ticket.replies,
            { at: Date.now(), author: `admin:${admin.email ?? "admin"}`, body: args.reply },
          ]
        : ticket.replies,
    });
    return { ok: true };
  },
});

export const listCouponsAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("coupons").order("desc").take(200);
  },
});

export const saveCoupon = mutation({
  args: {
    couponId: v.optional(v.id("coupons")),
    code: v.string(),
    description: v.optional(v.string()),
    type: v.union(v.literal("percent"), v.literal("fixed"), v.literal("free_shipping")),
    value: v.number(),
    minOrderMinor: v.number(),
    maxDiscountMinor: v.optional(v.number()),
    usageLimit: v.optional(v.number()),
    perUserLimit: v.optional(v.number()),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("disabled"), v.literal("archived")),
    appliesToCategoryIds: v.optional(v.array(v.id("categories"))),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const settings = await getSettings(ctx);
    const code = args.code.trim().toUpperCase();
    if (code.length < 3) throw new Error("Coupon codes need at least 3 characters.");
    if (args.type === "percent" && (args.value <= 0 || args.value > 90)) {
      throw new Error("A percentage discount must be between 1% and 90%.");
    }
    if (args.type === "fixed" && args.value <= 0) {
      throw new Error("A fixed discount must be greater than zero.");
    }
    const document = {
      code,
      description: args.description,
      type: args.type,
      value: Math.round(args.value),
      currency: settings.commerce.baseCurrency,
      minOrderMinor: Math.max(0, Math.round(args.minOrderMinor)),
      maxDiscountMinor: args.maxDiscountMinor,
      usageLimit: args.usageLimit,
      usedCount: 0,
      perUserLimit: args.perUserLimit,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      status: args.status,
      appliesToCategoryIds: args.appliesToCategoryIds,
      createdAt: Date.now(),
    };
    if (args.couponId) {
      const existing = await ctx.db.get(args.couponId);
      await ctx.db.patch(args.couponId, {
        ...document,
        usedCount: existing?.usedCount ?? 0,
      });
      return { couponId: args.couponId };
    }
    const duplicate = await ctx.db
      .query("coupons")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (duplicate) throw new Error(`Coupon ${code} already exists.`);
    const couponId = await ctx.db.insert("coupons", document);
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "coupon.create",
      entity: "coupons",
      entityId: String(couponId),
      summary: `Created coupon ${code}`,
    });
    return { couponId };
  },
});

export const getSettingsAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const settings = await getSettings(ctx);
    // Report configuration status without ever revealing a secret value.
    const providers = settings.payments.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      enabled: provider.enabled,
      countries: provider.countries,
      currencies: provider.currencies,
      docsUrl: provider.docsUrl,
      envVars: provider.envVars.map((key) => ({
        key,
        configured: Boolean(process.env[key]),
      })),
    }));
    return {
      settings,
      providers,
      testGatewaySecretConfigured: Boolean(process.env.TEST_GATEWAY_WEBHOOK_SECRET),
    };
  },
});

export const saveSettings = mutation({
  args: { patch: v.any() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const next = await writeSettings(ctx, args.patch, admin._id);
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "settings.update",
      entity: "site_settings",
      entityId: "global",
      summary: "Updated site settings",
      metadata: { sections: Object.keys(args.patch ?? {}) },
    });
    return { ok: true, settings: next };
  },
});

export const listAuditLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("audit_logs")
      .withIndex("by_created")
      .order("desc")
      .take(Math.min(args.limit ?? 100, 500));
  },
});

export const listAdminNotifications = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("notifications")
      .withIndex("by_audience", (q) => q.eq("audience", "admin"))
      .order("desc")
      .take(100);
  },
});

export const listCustomersAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(300);
    const out = [];
    for (const user of users) {
      const orders = await ctx.db
        .query("orders")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(100);
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();
      out.push({
        _id: user._id,
        name: user.name ?? "—",
        email: user.email ?? "—",
        role: user.role ?? "user",
        isAnonymous: user.isAnonymous === true,
        orders: orders.length,
        lifetimeValueBaseMinor: orders
          .filter((order) => order.paymentStatus === "paid")
          .reduce((sum, order) => sum + order.totalBaseMinor, 0),
        deletionRequested: Boolean(profile?.accountDeletionRequestedAt),
        createdAt: user._creationTime,
      });
    }
    return out;
  },
});

/* --------------------------------------------------------------------- *
 * Helpers
 * --------------------------------------------------------------------- */

function searchTextFor(
  name: string,
  sku: string,
  summary?: string,
  description?: string,
): string {
  return [name, sku, summary, (description ?? "").slice(0, 400)]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1500);
}

async function ensureUniqueSku(ctx: MutationCtx, sku: string): Promise<void> {
  const existing = await ctx.db
    .query("products")
    .withIndex("by_sku", (q) => q.eq("sku", sku))
    .unique();
  if (existing) {
    throw new Error(`SKU ${sku} already exists (product "${existing.name}").`);
  }
}

async function ensureUniqueSlug(
  ctx: MutationCtx,
  slug: string,
  ignoreId: Id<"products"> | null,
): Promise<string> {
  let candidate = slug || `product-${Date.now()}`;
  let suffix = 1;
  for (;;) {
    const existing = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .unique();
    if (!existing || existing._id === ignoreId) return candidate;
    suffix += 1;
    candidate = `${slug}-${suffix}`;
    if (suffix > 500) return `${slug}-${Date.now()}`;
  }
}
