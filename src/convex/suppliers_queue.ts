import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/** Queued sync jobs that are due, with their supplier's connector id. */
export const dueSyncJobs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const queued = await ctx.db
      .query("supplier_sync_jobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(20);
    const out = [];
    for (const job of queued) {
      if (job.scheduledFor > now) continue;
      const supplier = await ctx.db.get(job.supplierId);
      if (!supplier) continue;
      if (supplier.apiStatus === "disconnected") continue;
      out.push({
        _id: job._id,
        supplierId: job.supplierId,
        connector: supplier.connector,
        type: job.type,
      });
    }
    return out;
  },
});

export const supplierOrderDetails = internalQuery({
  args: { supplierOrderId: v.id("supplier_orders") },
  handler: async (ctx, args) => {
    const supplierOrder = await ctx.db.get(args.supplierOrderId);
    if (!supplierOrder) return null;
    const supplier = await ctx.db.get(supplierOrder.supplierId);
    if (!supplier) return null;
    const order = await ctx.db.get(supplierOrder.orderId);
    const items = [];
    for (const itemId of supplierOrder.orderItemIds) {
      const item = await ctx.db.get(itemId);
      if (item) {
        items.push({
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          supplierSku: item.supplierSku,
        });
      }
    }
    return {
      connector: supplier.connector,
      supplierName: supplier.name,
      apiStatus: supplier.apiStatus,
      orderNumber: order?.orderNumber ?? "—",
      shippingAddress: order?.shippingAddress ?? null,
      items,
      alreadySubmitted: !["queued", "needs_manual_fulfilment"].includes(supplierOrder.status),
    };
  },
});

export const markManualFulfilment = internalMutation({
  args: { supplierOrderId: v.id("supplier_orders"), reason: v.string() },
  handler: async (ctx, args) => {
    const supplierOrder = await ctx.db.get(args.supplierOrderId);
    if (!supplierOrder) return null;
    await ctx.db.patch(supplierOrder._id, {
      status: "needs_manual_fulfilment",
      responseSummary: args.reason,
      attempts: supplierOrder.attempts + 1,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Cron: retire carts that have been untouched for a long time. */
export const retireStaleCarts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const active = await ctx.db.query("carts").take(500);
    let retired = 0;
    for (const cart of active) {
      if (cart.status === "active" && cart.updatedAt < cutoff) {
        await ctx.db.patch(cart._id, { status: "abandoned" });
        retired += 1;
      }
    }
    return { retired };
  },
});
