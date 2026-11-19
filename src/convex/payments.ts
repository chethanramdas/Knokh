import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getUser, notifyAdmins, notifyUser } from "./lib/auth";
import { queueFulfilmentForOrder } from "./lib/fulfilment";
import {
  envValue,
  parseCashfreeWebhook,
  parseRazorpayWebhook,
  verifyCashfreeSignature,
  verifyRazorpayPaymentSignature,
  verifyRazorpaySignature,
  type NormalizedWebhook,
} from "./lib/gateways";
import { canViewOrder } from "./lib/checkoutAccess";
import { getSettings } from "./lib/settings";

export type WebhookOutcome = {
  ok: boolean;
  duplicate: boolean;
  reason?: string;
  status?: NormalizedWebhook["status"];
  orderId?: Id<"orders">;
};

/**
 * Marks an order paid and starts fulfilment. Kept separate from the webhook
 * bookkeeping so all providers share the same state and fulfilment guard.
 */
async function applyPaidOrder(
  ctx: MutationCtx,
  args: {
    order: Doc<"orders">;
    payment: Doc<"payments">;
    providerPaymentId?: string;
    method?: string;
    feeMinor?: number;
  },
): Promise<void> {
  if (hasFinalPayment(args.order, args.payment) ||
      args.order.fulfilmentStatus === "cancelled" || args.order.fulfilmentStatus === "returned") return;
  const now = Date.now();
  await ctx.db.patch(args.payment._id, {
    status: "captured",
    providerPaymentId: args.providerPaymentId ?? args.payment.providerPaymentId,
    method: args.method ?? args.payment.method,
    feeMinor: args.feeMinor ?? args.payment.feeMinor,
    netMinor:
      args.feeMinor !== undefined
        ? args.payment.amountMinor - args.feeMinor
        : args.payment.netMinor,
    signatureVerified: true,
    updatedAt: now,
  });

  const alreadyPaid = args.order.paymentStatus === "paid";
  await ctx.db.patch(args.order._id, {
    paymentStatus: "paid",
    fulfilmentStatus:
      args.order.fulfilmentStatus === "pending"
        ? "processing"
        : args.order.fulfilmentStatus,
    updatedAt: now,
  });

  if (!alreadyPaid) {
    await queueFulfilmentForOrder(ctx, { ...args.order, paymentStatus: "paid" });
    if (args.order.userId) {
      await notifyUser(ctx, {
        userId: args.order.userId,
        type: "payment_captured",
        title: `Payment received for ${args.order.orderNumber}`,
        body: "Your order is confirmed and is being prepared for dispatch.",
        link: `/account/orders`,
        orderId: args.order._id,
      });
    }
    await notifyAdmins(ctx, {
      type: "payment_captured",
      title: `Payment received · ${args.order.orderNumber}`,
      body: `Settled via ${args.payment.provider}. Fulfilment has been queued.`,
      link: `/admin/orders/${args.order._id}`,
    });
    await ctx.db.insert("analytics_events", {
      type: "order_placed",
      orderId: args.order._id,
      createdAt: now,
    });
  }
}

function hasFinalPayment(order: Doc<"orders">, payment: Doc<"payments">) {
  return ["paid", "refunded", "partially_refunded"].includes(order.paymentStatus) ||
    ["captured", "refunded", "partially_refunded", "abandoned"].includes(payment.status);
}

async function reconcileRazorpayRefund(
  ctx: MutationCtx, order: Doc<"orders">, payment: Doc<"payments">, event: NormalizedWebhook,
): Promise<string | undefined> {
  const { refundId, refundReceipt, amountMinor } = event;
  if (!refundId || !/^rfnd_[a-zA-Z0-9]+$/.test(refundId) ||
      amountMinor === undefined || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
      event.currency !== payment.currency || event.providerPaymentId !== payment.providerPaymentId ||
      !["paid", "partially_refunded", "refunded"].includes(order.paymentStatus)) {
    return "Refund evidence did not match a captured payment.";
  }
  const known = await ctx.db.query("refunds").withIndex("by_gateway_refund", (q) =>
    q.eq("providerRefundId", refundId),
  ).first();
  if (known && (known.orderId !== order._id || known.amountMinor !== amountMinor)) {
    return "Gateway refund ID was already linked to a different transaction.";
  }
  if (known?.status === "completed") return;

  const internalId = typeof refundReceipt === "string" ? ctx.db.normalizeId("refunds", refundReceipt) : null;
  const local = known ?? (internalId ? await ctx.db.get(internalId) : null);
  if (local && (local.orderId !== order._id || local.amountMinor !== amountMinor ||
      local.status !== "processing" || (local.paymentId && local.paymentId !== payment._id))) {
    return "Refund does not match the reserved refund.";
  }
  const refunds = await ctx.db.query("refunds").withIndex("by_order", (q) =>
    q.eq("orderId", order._id),
  ).collect();
  const completed = refunds.filter((row) => row.status === "completed")
    .reduce((sum, row) => sum + row.amountMinor, 0) + amountMinor;
  if (!Number.isSafeInteger(completed) || completed > payment.amountMinor || completed > order.totalMinor) {
    return "Cumulative refunds exceed the captured amount. Reconciliation required.";
  }
  const patch = {
    paymentId: payment._id, providerRefundId: refundId, status: "completed" as const, updatedAt: Date.now(),
  };
  if (local) await ctx.db.patch(local._id, patch);
  else await ctx.db.insert("refunds", {
    ...patch, orderId: order._id, currency: payment.currency, amountMinor,
    reason: "Processed by Razorpay", createdAt: patch.updatedAt,
  });
  const status = completed === payment.amountMinor ? "refunded" : "partially_refunded";
  await ctx.db.patch(payment._id, { status, updatedAt: patch.updatedAt });
  await ctx.db.patch(order._id, { paymentStatus: status, updatedAt: patch.updatedAt });
}

/**
 * Webhook entry point. Verification happens first, then a unique
 * (provider, eventId) row acts as the idempotency guard, so a replayed or
 * duplicated gateway event can never fulfil an order twice.
 */
export const processWebhookEvent = internalMutation({
  args: {
    provider: v.string(),
    rawBody: v.string(),
    headers: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args): Promise<WebhookOutcome> => {
    const check = args.provider === "razorpay"
      ? verifyRazorpaySignature(args.rawBody, args.headers["x-razorpay-signature"], envValue("RAZORPAY_WEBHOOK_SECRET"))
      : args.provider === "cashfree"
        ? verifyCashfreeSignature(args.rawBody, args.headers["x-webhook-signature"],
            args.headers["x-webhook-timestamp"], envValue("CASHFREE_CLIENT_SECRET"))
        : { valid: false };
    if (!check.valid) return { ok: false, duplicate: false, reason: "Signature verification failed." };

    let payload: unknown;
    try { payload = JSON.parse(args.rawBody); }
    catch { return { ok: false, duplicate: false, reason: "Invalid webhook payload." }; }
    const parsed = args.provider === "razorpay"
      ? parseRazorpayWebhook(payload, args.headers)
      : parseCashfreeWebhook(payload);
    if (!parsed.eventId || parsed.eventId.length > 256) {
      return { ok: false, duplicate: false, reason: "Missing or invalid event ID." };
    }
    // Historical duplicates must not poison the deduplication query.
    const rows = await ctx.db.query("payment_events").withIndex("by_event", (q) =>
      q.eq("provider", args.provider).eq("eventId", parsed.eventId),
    ).collect();
    if (rows.some((row) => row.signatureValid && row.processed)) {
      return { ok: true, duplicate: true, status: parsed.status };
    }
    if (parsed.status === "ignored") return { ok: true, duplicate: false, status: "ignored" };

    const matches = parsed.status === "refunded" && typeof parsed.providerPaymentId === "string"
      ? await ctx.db.query("payments").withIndex("by_provider_payment", (q) =>
          q.eq("providerPaymentId", parsed.providerPaymentId),
        ).collect()
      : typeof parsed.providerOrderId === "string"
        ? await ctx.db.query("payments").withIndex("by_provider_order", (q) =>
            q.eq("providerOrderId", parsed.providerOrderId),
          ).collect()
        : [];
    const candidates = matches.filter((row) => row.provider === args.provider);
    const payment = candidates.length === 1 ? candidates[0] : undefined;
    const order = payment ? await ctx.db.get(payment.orderId) : null;
    if (!payment || !order || order.provider !== args.provider) {
      return { ok: false, duplicate: false, reason: "Matching payment is unavailable; retry or reconcile." };
    }
    const eventId = await ctx.db.insert("payment_events", {
      provider: args.provider, eventId: parsed.eventId, eventType: parsed.eventType.slice(0, 80),
      orderId: order._id, paymentId: payment._id, signatureValid: true,
      payloadJson: "{}", processed: true, receivedAt: Date.now(), processedAt: Date.now(),
    });
    const reject = async (reason: string): Promise<WebhookOutcome> => {
      await ctx.db.patch(eventId, { processingError: reason });
      return { ok: true, duplicate: false, status: "ignored" };
    };
    if (parsed.status !== "refunded" &&
        (!Number.isSafeInteger(parsed.amountMinor) || parsed.amountMinor !== payment.amountMinor ||
        payment.amountMinor !== order.totalMinor || parsed.currency !== payment.currency ||
        payment.currency !== order.currency || typeof parsed.providerPaymentId !== "string" ||
        !parsed.providerPaymentId || (args.provider === "razorpay" && !/^pay_[a-zA-Z0-9]+$/.test(parsed.providerPaymentId)))) {
      return reject("Gateway amount, currency or payment identity did not match.");
    }
    if (parsed.status !== "refunded" && hasFinalPayment(order, payment)) {
      if (parsed.status === "captured" && parsed.providerPaymentId !== payment.providerPaymentId) {
        return reject("A second captured payment requires reconciliation.");
      }
      return { ok: true, duplicate: false, status: "ignored" };
    }
    if (order.fulfilmentStatus === "cancelled" || order.fulfilmentStatus === "returned") {
      if (parsed.status !== "refunded") return reject("Payment received on a closed order. Reconciliation required.");
    }

    const now = Date.now();
    switch (parsed.status) {
      case "captured":
        await applyPaidOrder(ctx, {
          order,
          payment,
          providerPaymentId: parsed.providerPaymentId,
          method: parsed.method,
          feeMinor: parsed.feeMinor,
        });
        break;
      case "authorized":
        await ctx.db.patch(payment._id, {
          status: "authorized",
          providerPaymentId: parsed.providerPaymentId,
          method: parsed.method,
          updatedAt: now,
        });
        break;
      case "failed":
        // Separate attempts can share a provider order. Keep a known authorization intact.
        if (payment.status !== "authorized") {
          await ctx.db.patch(payment._id, { status: "failed", updatedAt: now });
          await ctx.db.patch(order._id, { paymentStatus: "failed", updatedAt: now });
        }
        break;
      case "refunded": {
        if (args.provider !== "razorpay") return reject("Legacy provider refund requires manual reconciliation.");
        const error = await reconcileRazorpayRefund(ctx, order, payment, parsed);
        if (error) return reject(error);
        break;
      }
      default:
        break;
    }

    return { ok: true, duplicate: false, status: parsed.status, orderId: order._id };
  },
});

export const beginGatewaySession = internalMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const payment = await ctx.db.get(paymentId);
    const order = payment ? await ctx.db.get(payment.orderId) : null;
    if (!payment || !order || hasFinalPayment(order, payment) ||
        order.fulfilmentStatus !== "pending") return { status: "unavailable" as const };
    if (payment.providerOrderId) {
      return { status: "existing" as const, providerOrderId: payment.providerOrderId };
    }
    if (payment.sessionStartedAt) return { status: "reconcile" as const };
    await ctx.db.patch(payment._id, { sessionStartedAt: Date.now() });
    return { status: "create" as const };
  },
});

export const attachGatewaySession = internalMutation({
  args: { paymentId: v.id("payments"), providerOrderId: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment?.sessionStartedAt || payment.providerOrderId) {
      throw new Error("The payment session is already assigned.");
    }
    await ctx.db.patch(args.paymentId, {
      providerOrderId: args.providerOrderId, status: "pending", updatedAt: Date.now(),
    });
  },
});

export const recordGatewayError = internalMutation({
  args: { paymentId: v.id("payments"), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, {
      gatewayResponseSummary: args.message.slice(0, 500), updatedAt: Date.now(),
    });
  },
});

/** The browser callback authenticates a checkout result. Only capture evidence settles it. */
export const confirmCheckoutResult = mutation({
  args: {
    orderId: v.id("orders"),
    guestToken: v.optional(v.string()),
    providerOrderId: v.string(),
    providerPaymentId: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    const user = await getUser(ctx);
    if (!order || !canViewOrder(order, user, args.guestToken)) throw new ConvexError("Order not found.");
    const payment = await ctx.db.query("payments").withIndex("by_order", (q) =>
      q.eq("orderId", order._id),
    ).first();
    if (!payment || payment.provider !== "razorpay" || payment.providerOrderId !== args.providerOrderId ||
        !/^pay_[a-zA-Z0-9]{1,100}$/.test(args.providerPaymentId) || !/^[a-f0-9]{64}$/.test(args.signature)) {
      throw new ConvexError("Payment verification failed.");
    }
    const check = verifyRazorpayPaymentSignature({
      orderId: payment.providerOrderId, paymentId: args.providerPaymentId,
      signature: args.signature, keySecret: envValue("RAZORPAY_KEY_SECRET"),
    });
    if (!check.valid) throw new ConvexError("Payment verification failed.");
    return { status: order.paymentStatus };
  },
});

/** Internal lookup used by the payment actions. */
export const getOrderPayment = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args): Promise<Doc<"payments"> | null> => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .take(5);
    return payments[0] ?? null;
  },
});

/**
 * Applies a PayPal event that has already been verified against PayPal's
 * verify-webhook-signature API (see paymentsActions.handlePaypalWebhook). The
 * unique event id keeps this idempotent.
 */
export const processPaypalEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    status: v.union(
      v.literal("captured"),
      v.literal("failed"),
      v.literal("ignored"),
    ),
    orderId: v.optional(v.id("orders")),
    amountMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    providerPaymentId: v.optional(v.string()),
    payloadJson: v.string(),
  },
  handler: async (ctx, args): Promise<WebhookOutcome> => {
    const existing = await ctx.db
      .query("payment_events")
      .withIndex("by_event", (q) =>
        q.eq("provider", "paypal").eq("eventId", args.eventId),
      )
      .unique();
    if (existing?.processed) return { ok: true, duplicate: true };

    const eventId = await ctx.db.insert("payment_events", {
      provider: "paypal",
      eventId: args.eventId,
      eventType: args.eventType,
      orderId: args.orderId,
      signatureValid: true,
      payloadJson: "{}",
      processed: false,
      receivedAt: Date.now(),
    });

    if (!args.orderId || args.status === "ignored") {
      await ctx.db.patch(eventId, { processed: true, processedAt: Date.now() });
      return { ok: true, duplicate: false, status: "ignored" };
    }

    const order = await ctx.db.get(args.orderId);
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId!))
      .take(1);
    if (!order || payment[0]?.provider !== "paypal" || order.provider !== "paypal") {
      await ctx.db.patch(eventId, {
        processed: true,
        processedAt: Date.now(),
        processingError: "No matching order/payment (ignored).",
      });
      return { ok: true, duplicate: false, status: "ignored" };
    }

    if (args.status === "captured" && args.amountMinor === payment[0].amountMinor &&
        args.currency === payment[0].currency && args.providerPaymentId) {
      await applyPaidOrder(ctx, {
        order,
        payment: payment[0],
        providerPaymentId: args.providerPaymentId,
        method: "paypal",
      });
    } else if (args.status === "failed" && !hasFinalPayment(order, payment[0])) {
      await ctx.db.patch(payment[0]._id, { status: "failed", updatedAt: Date.now() });
      await ctx.db.patch(order._id, { paymentStatus: "failed", updatedAt: Date.now() });
    }
    await ctx.db.patch(eventId, { processed: true, processedAt: Date.now() });
    return { ok: true, duplicate: false, status: args.status, orderId: order._id };
  },
});

export const getPaymentForOrder = query({
  args: { orderId: v.id("orders"), guestToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order || !canViewOrder(order, user, args.guestToken)) return null;
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .take(10);
    const events = user?.role === "admin" ? await ctx.db
      .query("payment_events")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .take(25) : [];
    const settings = await getSettings(ctx);
    return {
      payments: payments.map((payment) => ({
        _id: payment._id,
        provider: payment.provider,
        status: payment.status,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        method: payment.method,
        providerOrderId: payment.providerOrderId,
        providerPaymentId: payment.providerPaymentId,
        signatureVerified: payment.signatureVerified,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      })),
      events: events.map((event) => ({
        _id: event._id,
        provider: event.provider,
        eventType: event.eventType,
        signatureValid: event.signatureValid,
        processed: event.processed,
        processingError: event.processingError,
        receivedAt: event.receivedAt,
      })),
      testGatewayEnabled: settings.payments.testGatewayEnabled,
    };
  },
});

export const reserveRazorpayRefund = internalMutation({
  args: { refundId: v.id("refunds") },
  handler: async (ctx, { refundId }) => {
    const refund = await ctx.db.get(refundId);
    if (!refund || !["approved", "processing", "completed"].includes(refund.status) ||
        !Number.isSafeInteger(refund.amountMinor) || refund.amountMinor <= 0) {
      throw new Error("Approve the refund before submitting it.");
    }
    const order = await ctx.db.get(refund.orderId);
    const payment = await ctx.db.query("payments").withIndex("by_order", (q) =>
      q.eq("orderId", refund.orderId),
    ).first();
    if (!order || order.provider !== "razorpay" || !payment || payment.provider !== "razorpay" ||
        !payment.providerPaymentId || !/^pay_[a-zA-Z0-9]+$/.test(payment.providerPaymentId) ||
        !["captured", "partially_refunded", "refunded"].includes(payment.status) ||
        refund.currency !== payment.currency || payment.currency !== order.currency) {
      throw new Error("No verified Razorpay capture matches the refund.");
    }
    if (refund.providerRefundId) return { existingId: refund.providerRefundId, amountMinor: refund.amountMinor };
    if (refund.status === "completed") throw new Error("This refund is already completed.");
    const refunds = await ctx.db.query("refunds").withIndex("by_order", (q) =>
      q.eq("orderId", order._id),
    ).collect();
    const reserved = refunds.filter((row) =>
      row._id !== refundId && ["processing", "completed"].includes(row.status),
    ).reduce((sum, row) => sum + row.amountMinor, 0) + refund.amountMinor;
    if (!Number.isSafeInteger(reserved) || reserved > payment.amountMinor || reserved > order.totalMinor) {
      throw new Error("The refund exceeds the remaining captured amount.");
    }
    await ctx.db.patch(refundId, { paymentId: payment._id, status: "processing", updatedAt: Date.now() });
    return { providerPaymentId: payment.providerPaymentId, amountMinor: refund.amountMinor };
  },
});

export const attachGatewayRefund = internalMutation({
  args: { refundId: v.id("refunds"), providerRefundId: v.string() },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (!refund || (refund.status !== "processing" && refund.status !== "completed") ||
        (refund.providerRefundId && refund.providerRefundId !== args.providerRefundId)) {
      throw new Error("Refund reference requires reconciliation.");
    }
    await ctx.db.patch(args.refundId, { providerRefundId: args.providerRefundId, updatedAt: Date.now() });
  },
});
