import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { notifyAdmins } from "./auth";

/**
 * Supplier fulfilment queue.
 *
 * An order is never forwarded to a supplier until its payment is settled (or it
 * is a permitted COD order). Forwarding is queued with a deterministic
 * idempotency key so retries and duplicate webhooks can never create a second
 * supplier order.
 *
 * Automated submission only happens for suppliers whose connector is marked
 * `connected` AND that advertise an order API. Everything else is created as a
 * `needs_manual_fulfilment` task with an explicit reason, never as a silent
 * success.
 */
export async function queueFulfilmentForOrder(
  ctx: MutationCtx,
  order: Doc<"orders">,
): Promise<{ queued: number; manual: number; unmapped: number }> {
  const items = await ctx.db
    .query("order_items")
    .withIndex("by_order", (q) => q.eq("orderId", order._id))
    .take(100);

  const bySupplier = new Map<string, Doc<"order_items">[]>();
  let unmapped = 0;
  for (const item of items) {
    if (!item.supplierId) {
      unmapped += 1;
      continue;
    }
    const key = String(item.supplierId);
    bySupplier.set(key, [...(bySupplier.get(key) ?? []), item]);
  }

  let queued = 0;
  let manual = 0;

  for (const [supplierId, supplierItems] of bySupplier) {
    const supplier = await ctx.db.get(supplierId as Id<"suppliers">);
    if (!supplier) {
      unmapped += supplierItems.length;
      continue;
    }
    const idempotencyKey = `${order._id}:${supplier._id}`;
    const existing = await ctx.db
      .query("supplier_orders")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) continue;

    const canAutomate =
      supplier.apiStatus === "connected" && supplier.supportsOrderApi;
    const status = canAutomate ? "queued" : "needs_manual_fulfilment";

    await ctx.db.insert("supplier_orders", {
      orderId: order._id,
      supplierId: supplier._id,
      orderItemIds: supplierItems.map((item) => item._id),
      status,
      idempotencyKey,
      attempts: 0,
      requestSummary: undefined,
      responseSummary: canAutomate
        ? undefined
        : `Manual fulfilment required: supplier "${supplier.name}" has no configured order API connection (status: ${supplier.apiStatus}).`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    if (canAutomate) {
      queued += 1;
      await ctx.db.insert("supplier_sync_jobs", {
        supplierId: supplier._id,
        type: "order_forward",
        status: "queued",
        scheduledFor: Date.now(),
        attempts: 0,
        maxAttempts: 3,
        resultSummary: `Order ${order.orderNumber}`,
        createdAt: Date.now(),
      });
    } else {
      manual += 1;
    }
  }

  if (manual > 0 || unmapped > 0) {
    await notifyAdmins(ctx, {
      type: "fulfilment_task",
      title: `Order ${order.orderNumber} needs manual attention`,
      body: `${manual} supplier group(s) have no automated connection${
        unmapped > 0 ? `, and ${unmapped} item(s) are not mapped to a supplier` : ""
      }.`,
      link: `/admin/orders/${order._id}`,
    });
  }

  return { queued, manual, unmapped };
}

/** Canonical supplier-order status for a shipment update. */
export function shipmentStatusFromSupplier(status: string): Doc<"shipments">["status"] {
  switch (status) {
    case "shipped":
    case "in_transit":
      return "in_transit";
    case "out_for_delivery":
      return "out_for_delivery";
    case "delivered":
      return "delivered";
    case "returned":
      return "returned";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}
