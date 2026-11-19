import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export function isReservedRefund(refund: Doc<"refunds">) {
  return ["requested", "approved", "processing", "completed"].includes(refund.status);
}

export async function readOrderRefunds(ctx: MutationCtx, orderId: Id<"orders">) {
  return await ctx.db.query("refunds").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
}

export async function reconcileRefundTotals(
  ctx: MutationCtx, order: Doc<"orders">, payment?: Doc<"payments"> | null,
) {
  const refunds = await readOrderRefunds(ctx, order._id);
  const completed = refunds.filter((refund) => refund.status === "completed")
    .reduce((sum, refund) => sum + refund.amountMinor, 0);
  if (completed <= 0 || completed > order.totalMinor) throw new Error("Refund total requires reconciliation.");
  const status = completed === order.totalMinor ? "refunded" : "partially_refunded";
  const updatedAt = Date.now();
  await ctx.db.patch(order._id, { paymentStatus: status, updatedAt });
  if (payment) await ctx.db.patch(payment._id, { status, updatedAt });
}
