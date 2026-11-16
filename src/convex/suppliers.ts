import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { notifyAdmins, requireAdmin, writeAuditLog } from "./lib/auth";
import type { FeedItem } from "./lib/feed";
import { getSettings } from "./lib/settings";
import { marginPercent } from "./lib/money";
import { normalizeSku, slugify } from "./lib/util";

/**
 * Supplier connector registry.
 *
 * `implemented: true` means the connector has working code in this repository
 * and is exercised by the sync/fulfilment actions. Everything else is a
 * documented placeholder: the interface exists, credentials are declared, and
 * calling it returns an explicit "pending" error instead of pretending to work.
 */
export { CONNECTORS } from "./lib/supplierConnectors";
import {
  CONNECTORS,
  connectionReadiness,
  isManualConnector,
} from "./lib/supplierConnectors";

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
        .withIndex("by_status", (q) =>
          q.eq("status", "needs_manual_fulfilment"),
        )
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
        unmappedProducts: mappings.filter((mapping) => !mapping.productId)
          .length,
        recentJobs: jobs,
        manualFulfilmentTasks: supplierOrders.filter(
          (entry) => entry.supplierId === supplier._id,
        ).length,
        connectorImplemented:
          CONNECTORS.find((connector) => connector.id === supplier.connector)
            ?.implemented ?? false,
        connectorLabel:
          CONNECTORS.find((connector) => connector.id === supplier.connector)
            ?.label ?? supplier.connector,
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
  returns: v.object({ supplierId: v.id("suppliers") }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const connector = CONNECTORS.find((entry) => entry.id === args.connector);
    if (!connector) throw new Error(`Unknown connector "${args.connector}".`);

    if (!args.name.trim() || args.name.trim().length > 160)
      throw new Error("Supplier name must be 1–160 characters.");
    if (!/^[A-Za-z]{2}$/.test(args.country))
      throw new Error("Country must be a two-letter ISO code.");
    if (!/^[A-Za-z]{3}$/.test(args.currency))
      throw new Error("Currency must be a three-letter ISO code.");
    if (args.website && !/^https:\/\//i.test(args.website))
      throw new Error("Supplier website must use HTTPS.");
    const readiness = connectionReadiness(connector.id, (key) =>
      Boolean(process.env[key]),
    );
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
    };

    if (args.supplierId) {
      const previous = await ctx.db.get(args.supplierId);
      if (!previous) throw new Error("Supplier not found.");
      await ctx.db.patch(args.supplierId, {
        ...document,
        ...(previous.connector !== connector.id
          ? { apiStatus: readiness.status }
          : {}),
      });
      if (previous.connector !== connector.id) {
        const connections = await ctx.db
          .query("supplier_connections")
          .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId!))
          .take(10);
        for (const connection of connections)
          await ctx.db.patch(connection._id, {
            label: connector.label,
            authType: connector.authType,
            envVars: connector.envVars,
            status: readiness.status,
            lastError: readiness.message,
            revokedAt: undefined,
          });
      }
      await writeAuditLog(ctx, {
        actorId: admin._id,
        actorEmail: admin.email,
        action: "supplier.update",
        entity: "suppliers",
        entityId: String(args.supplierId),
        summary: `Updated supplier ${document.name}`,
      });
      return { supplierId: args.supplierId };
    }
    const supplierId = await ctx.db.insert("suppliers", {
      ...document,
      apiStatus: readiness.status,
      createdAt: Date.now(),
    });
    // Declare the connection immediately, with the env var NAMES only.
    await ctx.db.insert("supplier_connections", {
      supplierId,
      label: connector.label,
      authType: connector.authType,
      envVars: connector.envVars,
      status: readiness.status,
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
  returns: v.object({
    status: v.union(
      v.literal("connected"),
      v.literal("pending_credentials"),
      v.literal("not_configured"),
    ),
    missing: v.array(v.string()),
    message: v.string(),
    connectorImplemented: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier) throw new Error("Supplier not found.");
    const connections = await ctx.db
      .query("supplier_connections")
      .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
      .take(10);
    const connector = CONNECTORS.find(
      (entry) => entry.id === supplier.connector,
    );
    const readiness = connectionReadiness(supplier.connector, (key) =>
      Boolean(process.env[key]),
    );
    const { status, missing, message } = readiness;
    for (const connection of connections) {
      await ctx.db.patch(connection._id, {
        status,
        lastCheckedAt: Date.now(),
        lastError: isManualConnector(supplier.connector) ? undefined : message,
        revokedAt: undefined,
      });
    }
    await ctx.db.patch(supplier._id, { apiStatus: status });
    return {
      status,
      missing,
      message,
      connectorImplemented: connector?.implemented ?? false,
    };
  },
});

export const disconnectSupplier = mutation({
  args: { supplierId: v.id("suppliers") },
  returns: v.object({ ok: v.boolean() }),
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
      summary:
        "Supplier connection revoked; rotate the credentials in the provider dashboard.",
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
          .withIndex("by_supplier_sku", (q) =>
            q.eq("supplierId", args.supplierId!),
          )
          .take(500)
      : await ctx.db.query("supplier_products").take(500);
    const filtered = args.onlyUnmapped
      ? rows.filter((row) => !row.productId)
      : rows;
    const out = [];
    for (const row of filtered) {
      const product = row.productId ? await ctx.db.get(row.productId) : null;
      out.push({
        ...row,
        productName: product?.name,
        productSlug: product?.slug,
        marginPercent:
          product && product.costMinor !== undefined
            ? Math.round(
                marginPercent(
                  product.priceMinor,
                  product.costMinor + (product.shippingCostMinor ?? 0),
                ),
              )
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
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const supplierProduct = await ctx.db.get(args.supplierProductId);
    if (!supplierProduct) throw new Error("Supplier product not found.");
    if (args.productId) {
      const product = await ctx.db.get(args.productId);
      if (!product) throw new Error("Product not found.");
      if (product.currency !== supplierProduct.currency)
        throw new Error(
          "Supplier and product currencies must match before mapping costs.",
        );
      const currentMappings = await ctx.db
        .query("supplier_products")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .take(2);
      if (currentMappings.some((m) => m._id !== supplierProduct._id))
        throw new Error(
          "Unmap the previous supplier SKU before remapping this product.",
        );
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
    if (!args.productId && supplierProduct.productId) {
      const previousProduct = await ctx.db.get(supplierProduct.productId);
      if (
        previousProduct?.supplierId === supplierProduct.supplierId &&
        previousProduct.supplierSku === supplierProduct.supplierSku
      )
        await ctx.db.patch(previousProduct._id, {
          supplierId: undefined,
          supplierSku: undefined,
          supplierProductId: undefined,
          updatedAt: Date.now(),
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
  returns: v.object({
    jobId: v.id("supplier_sync_jobs"),
    skipped: v.boolean(),
    missing: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier) throw new Error("Supplier not found.");
    const connector = CONNECTORS.find(
      (entry) => entry.id === supplier.connector,
    );
    const missing = (connector?.envVars ?? []).filter(
      (key) => !process.env[key],
    );
    const skipped =
      supplier.apiStatus === "disconnected" ||
      supplier.connector !== "feed_url" ||
      missing.length > 0 ||
      !["stock", "price", "full_catalog"].includes(args.type);
    const jobId = await ctx.db.insert("supplier_sync_jobs", {
      supplierId: supplier._id,
      type: args.type,
      status: skipped ? "skipped_not_configured" : "queued",
      scheduledFor: Date.now(),
      attempts: 0,
      maxAttempts: 3,
      lastError:
        skipped && missing.length === 0
          ? "Only a configured, active catalog feed supports stock, price or catalog sync. Manual suppliers do not have automatic sync."
          : !connector?.implemented
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
    return { jobId, skipped, missing };
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
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const supplierOrder = await ctx.db.get(args.supplierOrderId);
    if (!supplierOrder) throw new Error("Supplier order not found.");
    const order = await ctx.db.get(supplierOrder.orderId);
    if (
      !order ||
      order.fulfilmentStatus === "cancelled" ||
      order.fulfilmentStatus === "returned" ||
      supplierOrder.status === "cancelled"
    )
      throw new Error("Cancelled or returned orders cannot be submitted.");
    if (
      order.paymentStatus !== "paid" &&
      !(order.paymentMethod === "cod" && order.paymentStatus === "cod_pending")
    )
      throw new Error("Payment must be confirmed before supplier submission.");
    const tracking = args.trackingNumber?.trim();
    const carrier = args.carrier?.trim();
    const reference =
      args.supplierOrderIdReference?.trim() || supplierOrder.supplierOrderId;
    if (!!tracking !== !!carrier)
      throw new Error("Provide both carrier and tracking number.");
    if (!tracking && !reference)
      throw new Error(
        "Record the supplier's order reference before marking it submitted.",
      );
    if (args.trackingUrl && !/^https:\/\//i.test(args.trackingUrl))
      throw new Error("Tracking URL must use HTTPS.");
    if (
      !["queued", "needs_manual_fulfilment", "submitted", "shipped"].includes(
        supplierOrder.status,
      )
    )
      throw new Error(
        "This supplier order cannot be manually changed in its current state.",
      );
    const existingShipment = await ctx.db
      .query("shipments")
      .withIndex("by_supplier_order", (q) =>
        q.eq("supplierOrderId", supplierOrder._id),
      )
      .unique();
    if (supplierOrder.status === "shipped") {
      if (
        existingShipment &&
        existingShipment.trackingNumber === tracking &&
        existingShipment.carrier === carrier
      )
        return { ok: true };
      throw new Error(
        "This supplier order is already shipped; use order shipment management for corrections.",
      );
    }
    if (
      supplierOrder.status === "submitted" &&
      !tracking &&
      reference === supplierOrder.supplierOrderId
    )
      return { ok: true };
    const now = Date.now();
    await ctx.db.patch(supplierOrder._id, {
      status: tracking ? "shipped" : "submitted",
      supplierOrderId: reference,
      responseSummary:
        args.note?.slice(0, 500) ||
        (tracking
          ? `Shipped with ${carrier}`
          : "Manually submitted to supplier"),
      attempts: supplierOrder.attempts + 1,
      updatedAt: now,
    });
    for (const itemId of supplierOrder.orderItemIds) {
      const item = await ctx.db.get(itemId);
      if (
        !item ||
        item.orderId !== order._id ||
        item.supplierId !== supplierOrder.supplierId
      )
        throw new Error("Supplier order contains an invalid item mapping.");
      await ctx.db.patch(itemId, {
        fulfilmentStatus: tracking ? "shipped" : "forwarded",
        supplierOrderId: reference,
      });
    }
    if (tracking && carrier) {
      await ctx.db.insert("shipments", {
        orderId: order._id,
        supplierOrderId: supplierOrder._id,
        carrier,
        trackingNumber: tracking,
        trackingUrl: args.trackingUrl,
        status: "in_transit",
        events: [
          {
            at: now,
            status: "in_transit",
            description: `Manually booked with ${carrier}`,
          },
        ],
        shippedAt: now,
        updatedAt: now,
      });
    }
    const allItems = await ctx.db
      .query("order_items")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(101);
    if (allItems.length > 100)
      throw new Error(
        "Order exceeds the supported item limit; review manually.",
      );
    const allShipped =
      allItems.length > 0 &&
      allItems.every((item) =>
        ["shipped", "delivered"].includes(item.fulfilmentStatus),
      );
    await ctx.db.patch(order._id, {
      fulfilmentStatus: allShipped ? "shipped" : "processing",
      updatedAt: now,
    });

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
    items: v.array(
      v.object({
        supplierSku: v.string(),
        supplierProductId: v.optional(v.string()),
        title: v.optional(v.string()),
        costMinor: v.optional(v.number()),
        currency: v.optional(v.string()),
        stock: v.optional(v.number()),
        availability: v.optional(
          v.union(
            v.literal("in_stock"),
            v.literal("low_stock"),
            v.literal("out_of_stock"),
            v.literal("discontinued"),
            v.literal("unknown"),
          ),
        ),
        shippingEstimateMinor: v.optional(v.number()),
        deliveryEstimateDays: v.optional(v.number()),
        shipsTo: v.optional(v.array(v.string())),
        sourceUrl: v.optional(v.string()),
      }),
    ),
    updateCost: v.boolean(),
    updateStock: v.boolean(),
  },
  returns: v.object({
    costChanges: v.number(),
    stockChanges: v.number(),
    unmatched: v.number(),
    hidden: v.number(),
    priceAlerts: v.number(),
  }),
  handler: async (ctx, args) => {
    const settings = await getSettings(ctx);
    const supplier = await ctx.db.get(args.supplierId);
    const job = await ctx.db.get(args.jobId);
    if (
      !supplier ||
      !job ||
      job.supplierId !== supplier._id ||
      supplier.connector !== "feed_url" ||
      supplier.apiStatus === "disconnected"
    )
      throw new Error("Feed job does not match an active feed supplier.");
    if (job.status === "succeeded")
      return {
        costChanges: 0,
        stockChanges: 0,
        unmatched: 0,
        hidden: 0,
        priceAlerts: 0,
      };
    if (args.items.length > 250)
      throw new Error("Feed batches are limited to 250 rows.");
    const items = args.items as FeedItem[];
    const seenSkus = new Set<string>();
    for (const item of items) {
      const sku = normalizeSku(item.supplierSku);
      if (!sku || seenSkus.has(sku))
        throw new Error("Feed contains an empty or duplicate supplier SKU.");
      seenSkus.add(sku);
    }
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

      const candidate = existing?.productId
        ? await ctx.db.get(existing.productId)
        : await ctx.db
            .query("products")
            .withIndex("by_supplier_sku", (q) =>
              q
                .eq("supplierId", args.supplierId)
                .eq("supplierSku", supplierSku),
            )
            .unique();
      const product =
        candidate?.supplierId === args.supplierId ? candidate : null;
      const currency = item.currency ?? existing?.currency ?? supplier.currency;
      if (
        currency !== supplier.currency ||
        (product && currency !== product.currency)
      )
        throw new Error(
          "Feed currency differs from the mapped product or supplier. No implicit conversion is permitted.",
        );
      for (const value of [
        item.costMinor,
        item.stock,
        item.shippingEstimateMinor,
      ])
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
          throw new Error(
            "Feed amounts and quantities must be non-negative safe integers.",
          );

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
          currency,
          stock: args.updateStock
            ? (item.stock ?? existing.stock)
            : existing.stock,
          stockBaselineKnown:
            args.updateStock && item.stock !== undefined
              ? true
              : existing.stockBaselineKnown,
          availability,
          shippingEstimateMinor:
            item.shippingEstimateMinor ?? existing.shippingEstimateMinor,
          deliveryEstimateDays:
            item.deliveryEstimateDays ?? existing.deliveryEstimateDays,
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
          currency,
          stock: item.stock ?? 0,
          stockBaselineKnown: item.stock !== undefined,
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
            ? Math.round(
                ((product.priceMinor - item.costMinor) / product.priceMinor) *
                  100,
              )
            : 0;
        if (margin < settings.pricing.minimumMarginPercent) {
          priceAlerts.push(
            `${product.name}: margin is now ${margin}% after the supplier cost changed to ${(item.costMinor / 100).toFixed(2)} ${product.currency}.`,
          );
        }
      }
      if (args.updateStock && item.stock !== undefined) {
        // Conservative delta accounting preserves local checkout deductions.
        // First sync cannot increase existing saleable stock without a baseline.
        const knownBaseline =
          existing &&
          (existing.stockBaselineKnown === true ||
            (existing.stockBaselineKnown === undefined &&
              existing.availability !== "unknown"));
        const saleable = knownBaseline
          ? Math.min(
              item.stock,
              Math.max(0, product.stock + item.stock - existing.stock),
            )
          : Math.min(product.stock, item.stock);
        patch.stock = saleable;
        stockChanges += saleable === product.stock ? 0 : 1;
        if (saleable !== product.stock)
          await ctx.db.insert("inventory_movements", {
            productId: product._id,
            delta: saleable - product.stock,
            reason: "supplier_sync",
            note: `Supplier feed sync (${supplierSku})`,
            createdAt: now,
          });
      }
      if (
        args.updateStock &&
        settings.commerce.autoHideUnavailable &&
        ["out_of_stock", "discontinued"].includes(availability) &&
        product.status === "published"
      ) {
        patch.status = "unavailable";
        hidden += 1;
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
      attempts: job.attempts + 1,
      resultSummary: `${items.length} feed row(s): ${costChanges} cost change(s), ${stockChanges} stock change(s), ${unmatched} unmatched, ${hidden} hidden.`,
    });
    await ctx.db.patch(args.supplierId, {
      lastSyncAt: now,
      apiStatus: "connected",
    });
    const connections = await ctx.db
      .query("supplier_connections")
      .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId))
      .take(10);
    for (const connection of connections)
      await ctx.db.patch(connection._id, {
        status: "connected",
        lastCheckedAt: now,
        lastError: undefined,
      });
    if (priceAlerts.length > 0) {
      await notifyAdmins(ctx, {
        type: "supplier_price_alert",
        title: "Supplier cost changes reduced your margin",
        body: priceAlerts.slice(0, 5).join(" "),
        link: "/admin/products",
      });
    }
    return {
      costChanges,
      stockChanges,
      unmatched,
      hidden,
      priceAlerts: priceAlerts.length,
    };
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
  returns: v.null(),
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

/** Atomic job claim makes cron overlaps and retries harmless. */
export const claimSyncJob = internalMutation({
  args: { jobId: v.id("supplier_sync_jobs"), supplierId: v.id("suppliers") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const supplier = await ctx.db.get(args.supplierId);
    if (
      !job ||
      !supplier ||
      job.supplierId !== supplier._id ||
      job.status !== "queued" ||
      job.scheduledFor > Date.now() ||
      !["stock", "price", "full_catalog"].includes(job.type) ||
      job.attempts >= job.maxAttempts ||
      supplier.connector !== "feed_url" ||
      supplier.apiStatus === "disconnected"
    )
      return false;
    await ctx.db.patch(job._id, { status: "running", startedAt: Date.now() });
    return true;
  },
});
