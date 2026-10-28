import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { notifyAdmins, requireAdmin, writeAuditLog } from "./lib/auth";
import type { FeedItem } from "./lib/feed";
import { getSettings } from "./lib/settings";
import { normalizeSku, slugify } from "./lib/util";

/**
 * Supplier connector registry.
 *
 * `implemented: true` means the connector has working code in this repository
 * and is exercised by the sync/fulfilment actions. Everything else is a
 * documented placeholder: the interface exists, credentials are declared, and
 * calling it returns an explicit "pending" error instead of pretending to work.
 */
export const CONNECTORS = [
  {
    id: "manual",
    label: "Manual / email fulfilment",
    implemented: true,
    supportsProductApi: false,
    supportsOrderApi: false,
    supportsStockSync: false,
    supportsPriceSync: false,
    importMethods: ["csv", "xlsx", "url"],
    authType: "manual" as const,
    envVars: [] as string[],
    setup:
      "No credentials required. Orders for this supplier are queued as manual fulfilment tasks and you add the shipment tracking yourself.",
  },
  {
    id: "feed_url",
    label: "Catalog feed (JSON/CSV feed URL)",
    implemented: true,
    supportsProductApi: false,
    supportsOrderApi: false,
    supportsStockSync: true,
    supportsPriceSync: true,
    importMethods: ["feed", "csv", "xlsx"],
    authType: "feed_url" as const,
    envVars: ["SUPPLIER_FEED_URL", "SUPPLIER_FEED_TOKEN"],
    setup:
      "Set SUPPLIER_FEED_URL to the catalog feed you are authorised to consume (and SUPPLIER_FEED_TOKEN if the feed requires a bearer token). The scheduled sync reads cost and stock only — retail prices are never overwritten.",
  },
  {
    id: "cjdropshipping",
    label: "CJdropshipping",
    implemented: false,
    supportsProductApi: true,
    supportsOrderApi: true,
    supportsStockSync: true,
    supportsPriceSync: true,
    importMethods: ["api", "csv", "xlsx"],
    authType: "api_key" as const,
    envVars: ["CJ_EMAIL", "CJ_API_KEY", "CJ_ACCESS_TOKEN"],
    setup:
      "Register an app in the CJdropshipping developer portal, then set CJ_EMAIL, CJ_API_KEY and the access token in the deployment environment. The connector interface is in place; the request layer must be completed and tested against your account before orders can be forwarded automatically.",
  },
  {
    id: "aliexpress",
    label: "AliExpress (authorised affiliate/open platform)",
    implemented: false,
    supportsProductApi: true,
    supportsOrderApi: false,
    supportsStockSync: false,
    supportsPriceSync: false,
    importMethods: ["api", "csv"],
    authType: "oauth" as const,
    envVars: ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET", "ALIEXPRESS_ACCESS_TOKEN"],
    setup:
      "Requires an approved AliExpress open-platform application. Product data may only be used within the terms of your agreement. Not implemented in this codebase — use CSV/XLSX or your own feed until approval and testing are complete.",
  },
  {
    id: "dsers",
    label: "DSers-supported channels",
    implemented: false,
    supportsProductApi: false,
    supportsOrderApi: false,
    supportsStockSync: false,
    supportsPriceSync: false,
    importMethods: ["csv", "xlsx"],
    authType: "manual" as const,
    envVars: [],
    setup:
      "DSers is built for Shopify and WooCommerce stores and has no public API for a custom storefront like KNOKH. Use the DSers/CSV export and the spreadsheet importer instead.",
  },
  {
    id: "india_fulfilment",
    label: "Indian fulfilment provider (3PL with API)",
    implemented: false,
    supportsProductApi: false,
    supportsOrderApi: true,
    supportsStockSync: false,
    supportsPriceSync: false,
    importMethods: ["api", "csv"],
    authType: "api_key" as const,
    envVars: ["THREEPL_API_KEY", "THREEPL_ACCOUNT_ID"],
    setup:
      "Add the provider's API key and account id. The order-forwarding interface is implemented; the provider-specific request mapping must be completed against their sandbox before enabling it.",
  },
];

export const listConnectors = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return CONNECTORS.map((connector) => ({
      ...connector,
      envStatus: connector.envVars.map((key) => ({
        key,
        configured: Boolean(process.env[key]),
      })),
    }));
  },
});

export const listSuppliers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const suppliers = await ctx.db.query("suppliers").order("desc").take(100);
    const out = [];
    for (const supplier of suppliers) {
      const connections = await ctx.db
        .query("supplier_connections")
        .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
        .take(10);
      const mappings = await ctx.db
        .query("supplier_products")
        .withIndex("by_supplier_sku", (q) => q.eq("supplierId", supplier._id))
        .take(500);
      const jobs = await ctx.db
        .query("supplier_sync_jobs")
        .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
        .order("desc")
        .take(5);
      const supplierOrders = await ctx.db
        .query("supplier_orders")
        .withIndex("by_status", (q) => q.eq("status", "needs_manual_fulfilment"))
        .take(200);
      out.push({
        ...supplier,
        connections: connections.map((connection) => ({
          ...connection,
          envStatus: connection.envVars.map((key) => ({
            key,
            configured: Boolean(process.env[key]),
          })),
        })),
        mappedProducts: mappings.filter((mapping) => mapping.productId).length,
        unmappedProducts: mappings.filter((mapping) => !mapping.productId).length,
        recentJobs: jobs,
        manualFulfilmentTasks: supplierOrders.filter(
          (entry) => entry.supplierId === supplier._id,
        ).length,
        connectorImplemented:
          CONNECTORS.find((connector) => connector.id === supplier.connector)?.implemented ??
          false,
        connectorLabel:
          CONNECTORS.find((connector) => connector.id === supplier.connector)?.label ??
          supplier.connector,
      });
    }
    return out;
  },
});

export const saveSupplier = mutation({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    name: v.string(),
    website: v.optional(v.string()),
    country: v.string(),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    currency: v.string(),
    connector: v.string(),
    categories: v.optional(v.array(v.string())),
    processingTimeDays: v.optional(v.number()),
    shippingRegions: v.optional(v.array(v.string())),
    returnPolicy: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const connector = CONNECTORS.find((entry) => entry.id === args.connector);
    if (!connector) throw new Error(`Unknown connector "${args.connector}".`);

    const document = {
      name: args.name.trim(),
      slug: slugify(args.name),
      website: args.website,
      country: args.country.toUpperCase().slice(0, 2),
      contactEmail: args.contactEmail,
      contactPhone: args.contactPhone,
      currency: args.currency.toUpperCase().slice(0, 3),
      categories: args.categories,
      connector: connector.id,
      supportsProductApi: connector.supportsProductApi,
      supportsOrderApi: connector.supportsOrderApi,
      supportsStockSync: connector.supportsStockSync,
      supportsPriceSync: connector.supportsPriceSync,
      importMethods: connector.importMethods,
      processingTimeDays: args.processingTimeDays,
      shippingRegions: args.shippingRegions,
      returnPolicy: args.returnPolicy,
      notes: args.notes,
      lastSyncAt: undefined as number | undefined,
    };

    if (args.supplierId) {
      await ctx.db.patch(args.supplierId, document);
      return { supplierId: args.supplierId };
    }
    const supplierId = await ctx.db.insert("suppliers", {
      ...document,
      apiStatus: connector.envVars.length === 0 ? "connected" : "pending_credentials",
      createdAt: Date.now(),
    });
    // Declare the connection immediately, with the env var NAMES only.
    await ctx.db.insert("supplier_connections", {
      supplierId,
      label: connector.label,
      authType: connector.authType,
      envVars: connector.envVars,
      status: connector.envVars.length === 0 ? "connected" : "pending_credentials",
      createdAt: Date.now(),
    });
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "supplier.create",
      entity: "suppliers",
      entityId: String(supplierId),
      summary: `Added supplier ${document.name} (${connector.label})`,
    });
    return { supplierId };
  },
});

/** Re-checks configuration without making any network call. */
export const checkSupplierConnection = mutation({
  args: { supplierId: v.id("suppliers") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier) throw new Error("Supplier not found.");
    const connections = await ctx.db
      .query("supplier_connections")
      .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
      .take(10);
    const connector = CONNECTORS.find((entry) => entry.id === supplier.connector);
    const missing = (connector?.envVars ?? []).filter((key) => !process.env[key]);
    const status =
      missing.length === 0 ? ("connected" as const) : ("pending_credentials" as const);
    for (const connection of connections) {
      await ctx.db.patch(connection._id, {
        status,
        lastCheckedAt: Date.now(),
        lastError:
          missing.length === 0
            ? undefined
            : `Missing environment variable(s): ${missing.join(", ")}`,
      });
    }
    await ctx.db.patch(supplier._id, { apiStatus: status });
    return { status, missing, connectorImplemented: connector?.implemented ?? false };
  },
});

export const disconnectSupplier = mutation({
  args: { supplierId: v.id("suppliers") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const connections = await ctx.db
      .query("supplier_connections")
      .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId))
      .take(10);
    for (const connection of connections) {
      await ctx.db.patch(connection._id, {
        status: "disconnected",
        revokedAt: Date.now(),
      });
    }
    await ctx.db.patch(args.supplierId, { apiStatus: "disconnected" });
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "supplier.disconnect",
      entity: "suppliers",
      entityId: String(args.supplierId),
      summary: "Supplier connection revoked; rotate the credentials in the provider dashboard.",
    });
    return { ok: true };
  },
});

export const listSupplierProducts = query({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    onlyUnmapped: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = args.supplierId
      ? await ctx.db
          .query("supplier_products")
          .withIndex("by_supplier_sku", (q) => q.eq("supplierId", args.supplierId!))
          .take(500)
      : await ctx.db.query("supplier_products").take(500);
    const filtered = args.onlyUnmapped ? rows.filter((row) => !row.productId) : rows;
    const out = [];
    for (const row of filtered) {
      const product = row.productId ? await ctx.db.get(row.productId) : null;
      out.push({
        ...row,
        productName: product?.name,
        productSlug: product?.slug,
        marginPercent:
          product && product.costMinor && product.costMinor > 0
            ? Math.round(((product.priceMinor - product.costMinor) / product.priceMinor) * 100)
            : null,
      });
    }
    return out;
  },
});

/** Maps a supplier SKU onto a catalog product (or clears the mapping). */
export const mapSupplierProduct = mutation({
  args: {
    supplierProductId: v.id("supplier_products"),
    productId: v.optional(v.id("products")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const supplierProduct = await ctx.db.get(args.supplierProductId);
    if (!supplierProduct) throw new Error("Supplier product not found.");
    if (args.productId) {
      const product = await ctx.db.get(args.productId);
      if (!product) throw new Error("Product not found.");
      await ctx.db.patch(product._id, {
        supplierId: supplierProduct.supplierId,
        supplierSku: supplierProduct.supplierSku,
        supplierProductId: supplierProduct.supplierProductId,
        costMinor: supplierProduct.costMinor,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("price_history", {
        productId: product._id,
        oldCostMinor: product.costMinor,
        newCostMinor: supplierProduct.costMinor,
        source: "supplier_mapping",
        actorId: admin._id,
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(supplierProduct._id, { productId: args.productId });
    return { ok: true };
  },
});

export const queueSyncJob = mutation({
  args: {
    supplierId: v.id("suppliers"),
    type: v.union(
      v.literal("stock"),
      v.literal("price"),
      v.literal("full_catalog"),
      v.literal("order_forward"),
      v.literal("health_check"),
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier) throw new Error("Supplier not found.");
    const connector = CONNECTORS.find((entry) => entry.id === supplier.connector);
    const missing = (connector?.envVars ?? []).filter((key) => !process.env[key]);
    const jobId = await ctx.db.insert("supplier_sync_jobs", {
      supplierId: supplier._id,
      type: args.type,
      status: !connector?.implemented || missing.length > 0
        ? "skipped_not_configured"
        : "queued",
      scheduledFor: Date.now(),
      attempts: 0,
      maxAttempts: 3,
      lastError:
        !connector?.implemented
          ? `The "${connector?.label ?? supplier.connector}" connector is not implemented in this codebase yet.`
          : missing.length > 0
            ? `Missing environment variable(s): ${missing.join(", ")}`
            : undefined,
      resultSummary: undefined,
      createdAt: Date.now(),
    });
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "supplier.sync_queue",
      entity: "supplier_sync_jobs",
      entityId: String(jobId),
      summary: `${args.type} sync queued for ${supplier.name}`,
    });
    return { jobId, skipped: !connector?.implemented || missing.length > 0, missing };
  },
});

export const listSyncJobs = query({
  args: { supplierId: v.optional(v.id("suppliers")) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.supplierId) {
      return await ctx.db
        .query("supplier_sync_jobs")
        .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId!))
        .order("desc")
        .take(50);
    }
    return await ctx.db.query("supplier_sync_jobs").order("desc").take(100);
  },
});

export const listSupplierOrders = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("supplier_orders").order("desc").take(200);
    const out = [];
    for (const row of rows) {
      const order = await ctx.db.get(row.orderId);
      const supplier = await ctx.db.get(row.supplierId);
      out.push({
        ...row,
        orderNumber: order?.orderNumber ?? "—",
        supplierName: supplier?.name ?? "—",
        customer: order?.customerName ?? "—",
      });
    }
    return out;
  },
});

/**
 * Marks a supplier order as submitted manually (no API available). This is the
 * safe path for suppliers whose connector has no automated order API.
 */
export const completeManualFulfilment = mutation({
  args: {
    supplierOrderId: v.id("supplier_orders"),
    supplierOrderIdReference: v.optional(v.string()),
    carrier: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    trackingUrl: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const supplierOrder = await ctx.db.get(args.supplierOrderId);
    if (!supplierOrder) throw new Error("Supplier order not found.");
    const now = Date.now();
    await ctx.db.patch(supplierOrder._id, {
      status: args.trackingNumber ? "shipped" : "submitted",
      supplierOrderId: args.supplierOrderIdReference,
      responseSummary:
        args.note ??
        `Manually fulfilled by ${admin.email ?? "admin"}${args.trackingNumber ? ` · tracking ${args.trackingNumber}` : ""}`,
      attempts: supplierOrder.attempts + 1,
      updatedAt: now,
    });

    for (const itemId of supplierOrder.orderItemIds) {
      await ctx.db.patch(itemId, {
        fulfilmentStatus: args.trackingNumber ? "shipped" : "forwarded",
        supplierOrderId: args.supplierOrderIdReference,
      });
    }

    if (args.trackingNumber && args.carrier) {
      const existing = await ctx.db
        .query("shipments")
        .withIndex("by_order", (q) => q.eq("orderId", supplierOrder.orderId))
        .take(1);
      const event = {
        at: now,
        status: "in_transit",
        description: `Manually booked with ${args.carrier}`,
      };
      if (existing.length > 0) {
        await ctx.db.patch(existing[0]._id, {
          carrier: args.carrier,
          trackingNumber: args.trackingNumber,
          trackingUrl: args.trackingUrl,
          status: "in_transit",
          events: [...existing[0].events, event],
          shippedAt: now,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("shipments", {
          orderId: supplierOrder.orderId,
          carrier: args.carrier,
          trackingNumber: args.trackingNumber,
          trackingUrl: args.trackingUrl,
          status: "in_transit",
          events: [event],
          shippedAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.patch(supplierOrder.orderId, {
        fulfilmentStatus: "shipped",
        updatedAt: now,
      });
    }

    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "supplier_order.manual_fulfil",
      entity: "supplier_orders",
      entityId: String(supplierOrder._id),
      summary: args.trackingNumber
        ? `Marked shipped with ${args.carrier} ${args.trackingNumber}`
        : "Marked as submitted to the supplier",
    });
    return { ok: true };
  },
});

export const unmappedProductAlerts = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const products = await ctx.db.query("products").take(1000);
    return products
      .filter((product) => !product.supplierId)
      .slice(0, 50)
      .map((product) => ({
        _id: product._id,
        name: product.name,
        sku: product.sku,
        status: product.status,
        isDemo: product.isDemo === true,
      }));
  },
});

/* ------------------------------------------------------------------ *
 * Sync result application (called by the supplier sync action)
 * ------------------------------------------------------------------ */

export type { FeedItem };

/**
 * Applies a supplier feed to the catalog.
 *
 * Hard rule: a sync updates supplier COST, STOCK and availability only. The
 * retail price (`priceMinor`) is never touched, so a supplier price change can
 * never silently alter what a customer pays.
 */
export const applyFeedItems = internalMutation({
  args: {
    jobId: v.id("supplier_sync_jobs"),
    supplierId: v.id("suppliers"),
    items: v.array(v.any()),
    updateCost: v.boolean(),
    updateStock: v.boolean(),
  },
  handler: async (ctx, args) => {
    const settings = await getSettings(ctx);
    const items = args.items as FeedItem[];
    let costChanges = 0;
    let stockChanges = 0;
    let hidden = 0;
    let unmatched = 0;
    const priceAlerts: string[] = [];
    const now = Date.now();

    for (const item of items) {
      if (!item?.supplierSku) continue;
      const supplierSku = normalizeSku(item.supplierSku);
      const existing = await ctx.db
        .query("supplier_products")
        .withIndex("by_supplier_sku", (q) =>
          q.eq("supplierId", args.supplierId).eq("supplierSku", supplierSku),
        )
        .unique();

      const product = existing?.productId
        ? await ctx.db.get(existing.productId)
        : await ctx.db
            .query("products")
            .withIndex("by_sku", (q) => q.eq("sku", supplierSku))
            .unique();

      const availability =
        item.availability ??
        (item.stock === undefined
          ? "unknown"
          : item.stock <= 0
            ? "out_of_stock"
            : item.stock <= 5
              ? "low_stock"
              : "in_stock");

      if (existing) {
        await ctx.db.patch(existing._id, {
          title: item.title ?? existing.title,
          costMinor: item.costMinor ?? existing.costMinor,
          currency: item.currency ?? existing.currency,
          stock: item.stock ?? existing.stock,
          availability,
          shippingEstimateMinor: item.shippingEstimateMinor ?? existing.shippingEstimateMinor,
          deliveryEstimateDays: item.deliveryEstimateDays ?? existing.deliveryEstimateDays,
          shipsTo: item.shipsTo ?? existing.shipsTo,
          sourceUrl: item.sourceUrl ?? existing.sourceUrl,
          lastSyncedAt: now,
        });
      } else {
        await ctx.db.insert("supplier_products", {
          supplierId: args.supplierId,
          supplierProductId: item.supplierProductId ?? supplierSku,
          supplierSku,
          productId: product?._id,
          title: item.title ?? product?.name ?? supplierSku,
          costMinor: item.costMinor ?? 0,
          currency: item.currency ?? settings.commerce.baseCurrency,
          stock: item.stock ?? 0,
          availability,
          shippingEstimateMinor: item.shippingEstimateMinor,
          deliveryEstimateDays: item.deliveryEstimateDays,
          shipsTo: item.shipsTo,
          sourceUrl: item.sourceUrl,
          lastSyncedAt: now,
        });
      }

      if (!product) {
        unmatched += 1;
        continue;
      }

      const patch: Record<string, unknown> = { updatedAt: now };
      if (
        args.updateCost &&
        item.costMinor !== undefined &&
        item.costMinor !== product.costMinor
      ) {
        patch.costMinor = item.costMinor;
        costChanges += 1;
        const margin =
          product.priceMinor > 0
            ? Math.round(((product.priceMinor - item.costMinor) / product.priceMinor) * 100)
            : 0;
        if (margin < settings.pricing.minimumMarginPercent) {
          priceAlerts.push(
            `${product.name}: margin is now ${margin}% after the supplier cost changed to ${(item.costMinor / 100).toFixed(2)} ${product.currency}.`,
          );
        }
      }
      if (args.updateStock && item.stock !== undefined && item.stock !== product.stock) {
        patch.stock = item.stock;
        stockChanges += 1;
        await ctx.db.insert("inventory_movements", {
          productId: product._id,
          delta: item.stock - product.stock,
          reason: "supplier_sync",
          note: `Supplier feed sync (${supplierSku})`,
          createdAt: now,
        });
      }
      if (
        settings.commerce.autoHideUnavailable &&
        availability === "out_of_stock" &&
        product.status === "published"
      ) {
        patch.status = "unavailable";
        hidden += 1;
      } else if (
        availability === "in_stock" &&
        product.status === "unavailable"
      ) {
        patch.status = "published";
      }
      await ctx.db.patch(product._id, patch);
      if (patch.costMinor !== undefined) {
        await ctx.db.insert("price_history", {
          productId: product._id,
          oldCostMinor: product.costMinor,
          newCostMinor: patch.costMinor as number,
          source: "supplier_sync",
          createdAt: now,
        });
      }
    }

    await ctx.db.patch(args.jobId, {
      status: "succeeded",
      finishedAt: now,
      attempts: 1,
      resultSummary: `${items.length} feed row(s): ${costChanges} cost change(s), ${stockChanges} stock change(s), ${unmatched} unmatched, ${hidden} hidden.`,
    });
    await ctx.db.patch(args.supplierId, { lastSyncAt: now });
    if (priceAlerts.length > 0) {
      await notifyAdmins(ctx, {
        type: "supplier_price_alert",
        title: "Supplier cost changes reduced your margin",
        body: priceAlerts.slice(0, 5).join(" "),
        link: "/admin/products",
      });
    }
    return { costChanges, stockChanges, unmatched, hidden, priceAlerts: priceAlerts.length };
  },
});

export const markSyncJobResult = internalMutation({
  args: {
    jobId: v.id("supplier_sync_jobs"),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("skipped_not_configured"),
    ),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    await ctx.db.patch(job._id, {
      status: args.status,
      attempts: job.attempts + 1,
      resultSummary: args.summary ?? job.resultSummary,
      lastError: args.error,
      finishedAt: Date.now(),
    });
    return null;
  },
});

export type SupplierDoc = Doc<"suppliers">;
export type SupplierId = Id<"suppliers">;
export type SupplierProductRow = Doc<"supplier_products">;
