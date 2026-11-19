import { isReservedRefund, readOrderRefunds, reconcileRefundTotals } from "./lib/refunds";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getUser, notifyAdmins, notifyUser } from "./lib/auth";
import { queueFulfilmentForOrder } from "./lib/fulfilment";
import {
  envValue,
  parseCashfreeWebhook,
  parseRazorpayWebhook,
  parseTestGatewayWebhook,
  verifyCashfreeSignature,
  verifyRazorpayPaymentSignature,
  verifyRazorpaySignature,
  verifyTestGatewaySignature,
  type NormalizedWebhook,
} from "./lib/gateways";
import { canAccessOrder } from "./lib/orderAccess";
import { testGatewayAllowed } from "./lib/paymentMode";
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
 * bookkeeping so it can also be reached from the (signature-verified) checkout
 * callback.
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
  if (["captured", "refunded", "partially_refunded"].includes(args.payment.status) ||
      ["paid", "refunded", "partially_refunded"].includes(args.order.paymentStatus)) return;
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
    if (args.order.fulfilmentStatus !== "cancelled") {
      await queueFulfilmentForOrder(ctx, { ...args.order, paymentStatus: "paid" });
    }
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

/**
 * Webhook entry point. Verification happens first, then a unique
 * (provider, eventId) row acts as the idempotency guard, so a replayed or
 * duplicated gateway event can never fulfil an order twice.
 */
export const processWebhookEvent = internalMutation({
  args: {
    provider: v.string(),
    rawBody: v.string(),
    rawBytes: v.optional(v.bytes()),
    headers: v.record(v.string(), v.string()),
    preVerified: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<WebhookOutcome> => {
    if (args.provider === "test_gateway" && !testGatewayAllowed(await getSettings(ctx))) {
      return { ok: false, duplicate: false, reason: "Sandbox payment disabled." };
    }
    let signatureValid = args.preVerified === true;
    let failureReason: string | undefined;
    let parsed: NormalizedWebhook | null = null;

    const payload = (() => {
      try {
        return JSON.parse(args.rawBody);
      } catch {
        return null;
      }
    })();

    if (!payload) {
      return { ok: false, duplicate: false, reason: "Body was not valid JSON." };
    }

    if (!signatureValid) {
      if (args.provider === "razorpay") {
        const check = verifyRazorpaySignature(
          args.rawBytes ? new Uint8Array(args.rawBytes) : args.rawBody,
          args.headers["x-razorpay-signature"],
          envValue("RAZORPAY_WEBHOOK_SECRET"),
        );
        signatureValid = check.valid;
        failureReason = check.reason;
      } else if (args.provider === "cashfree") {
        const check = verifyCashfreeSignature(
          args.rawBody,
          args.headers["x-webhook-signature"],
          args.headers["x-webhook-timestamp"],
          envValue("CASHFREE_CLIENT_SECRET"),
        );
        signatureValid = check.valid;
        failureReason = check.reason;
      } else if (args.provider === "test_gateway") {
        const check = verifyTestGatewaySignature(
          args.rawBody,
          args.headers["x-test-signature"],
          envValue("TEST_GATEWAY_WEBHOOK_SECRET"),
        );
        signatureValid = check.valid;
        failureReason = check.reason;
      } else {
        failureReason = `Unsupported webhook provider "${args.provider}".`;
      }
    }

    parsed =
      args.provider === "razorpay"
        ? parseRazorpayWebhook(payload, args.headers)
        : args.provider === "cashfree"
          ? parseCashfreeWebhook(payload)
          : parseTestGatewayWebhook(payload);

    if (!signatureValid) {
      return { ok: false, duplicate: false, reason: failureReason };
    }

    const existing = await ctx.db
      .query("payment_events")
      .withIndex("by_event", (q) =>
        q.eq("provider", args.provider).eq("eventId", parsed!.eventId),
      )
      .filter((q) => q.eq(q.field("signatureValid"), true))
      .first();
    if (existing?.processed) {
      return { ok: true, duplicate: true, status: parsed.status };
    }

    const payment = parsed.status === "refunded" && parsed.providerPaymentId
      ? await ctx.db.query("payments").withIndex("by_provider_payment", (q) => q.eq("providerPaymentId", parsed!.providerPaymentId)).first()
      : parsed.providerOrderId
      ? await ctx.db
          .query("payments")
          .withIndex("by_provider_order", (q) =>
            q.eq("providerOrderId", parsed!.providerOrderId),
          )
          .unique()
      : null;

    const order = payment ? await ctx.db.get(payment.orderId) : null;

    const eventId = existing?._id ?? await ctx.db.insert("payment_events", {
      provider: args.provider,
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      orderId: order?._id,
      paymentId: payment?._id,
      signatureValid: true,
      payloadJson: "{}",
      processed: false,
      receivedAt: Date.now(),
    });

    if (!payment || !order) {
      if (parsed.status === "captured" || parsed.status === "refunded") {
        return { ok: false, duplicate: false, reason: "Payment mapping is pending.", status: parsed.status };
      }

      await ctx.db.patch(eventId, {
        processed: true,
        processedAt: Date.now(),
        processingError:
          "No matching order/payment for this gateway order id (ignored).",
      });
      return { ok: true, duplicate: false, status: parsed.status };
    }

    const settled = ["captured", "refunded", "partially_refunded"].includes(payment.status) ||
      ["paid", "refunded", "partially_refunded"].includes(order.paymentStatus);
    const mismatched = payment.provider !== args.provider || order.provider !== args.provider ||
      (parsed.status === "captured" && (
        !parsed.providerPaymentId || !Number.isSafeInteger(parsed.amountMinor) ||
        parsed.amountMinor !== payment.amountMinor || parsed.amountMinor !== order.totalMinor ||
        parsed.currency !== payment.currency || parsed.currency !== order.currency
      ));
    if (mismatched || (settled && ["authorized", "failed"].includes(parsed.status))) {
      await ctx.db.patch(eventId, {
        processed: true,
        processedAt: Date.now(),
        processingError: mismatched ? "Payment details did not match the order." : "Stale payment event ignored.",
      });
      return { ok: true, duplicate: false, status: "ignored" };
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
          method: parsed.method,
          updatedAt: now,
        });
        break;
      case "failed":
        await ctx.db.patch(payment._id, { status: "failed", updatedAt: now });
        await ctx.db.patch(order._id, {
          paymentStatus: "failed",
          updatedAt: now,
        });
        if (order.userId) {
          await notifyUser(ctx, {
            userId: order.userId,
            type: "payment_failed",
            title: `Payment failed for ${order.orderNumber}`,
            body: "The gateway did not confirm the payment. No fulfilment has started; you can retry payment from your order.",
            link: `/account/orders`,
            orderId: order._id,
          });
        }
        break;
      case "refunded": {
        const amount = parsed.amountMinor;
        const gatewayId = parsed.refundId;
        if (args.provider !== "razorpay" || !settled || !gatewayId ||
            !/^rfnd_[A-Za-z0-9]+$/.test(gatewayId) || typeof amount !== "number" ||
            !Number.isSafeInteger(amount) || amount <= 0 ||
            (parsed.currency && parsed.currency !== payment.currency)) {
          await ctx.db.patch(eventId, { processingError: "Refund did not match a captured payment." });
          break;
        }

        const refunds = await readOrderRefunds(ctx, order._id);
        const matching = refunds.find((refund) => refund.providerRefundId === gatewayId) ??
          refunds.find((refund) => refund._id === parsed.internalRefundId && refund.paymentId === payment._id &&
            !refund.providerRefundId && refund.status === "processing");
        if (matching?.status === "completed") break;
        const completed = refunds.filter((refund) => refund.status === "completed")
          .reduce((sum, refund) => sum + refund.amountMinor, 0);
        if (completed + amount > payment.amountMinor || completed + amount > order.totalMinor ||
            (matching && (matching.amountMinor !== amount || (matching.paymentId && matching.paymentId !== payment._id)))) {
          await ctx.db.patch(eventId, { processingError: "Refund totals require reconciliation." });
          break;
        }
        if (matching) {
          await ctx.db.patch(matching._id, { paymentId: payment._id, providerRefundId: gatewayId, status: "completed", updatedAt: now });
        } else {
          await ctx.db.insert("refunds", {
            orderId: order._id,
            paymentId: payment._id,
            providerRefundId: gatewayId,
            amountMinor: amount,
            currency: payment.currency,
            reason: "Provider confirmed refund",
            status: "completed",
            createdAt: now,
            updatedAt: now,
          });
        }
        await reconcileRefundTotals(ctx, order, payment);
        break;
      }
      default:
        break;
    }

    await ctx.db.patch(eventId, { orderId: order._id, paymentId: payment._id, processed: true, processedAt: Date.now() });
    return { ok: true, duplicate: false, status: parsed.status, orderId: order._id };
  },
});

export const reserveGatewaySession = internalMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const payment = await ctx.db.get(paymentId);
    if (!payment) throw new Error("Payment not found.");
    const order = await ctx.db.get(payment.orderId);
    if (!order || order.fulfilmentStatus === "cancelled" || !["pending", "failed"].includes(order.paymentStatus)) {
      throw new Error("This order is no longer payable.");
    }
    if (payment.providerOrderId) return payment.providerOrderId;
    if (payment.gatewaySessionStartedAt) {
      throw new Error("Payment setup is pending. Contact support with your order number before trying again.");
    }
    await ctx.db.patch(paymentId, { gatewaySessionStartedAt: Date.now() });
    return null;
  },
});

/** Records the gateway order/session created by the payment action. */
export const attachGatewaySession = internalMutation({
  args: {
    paymentId: v.id("payments"),
    providerOrderId: v.string(),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new Error("Payment not found.");
    if (payment.providerOrderId && payment.providerOrderId !== args.providerOrderId) {
      throw new Error("This payment already has a gateway order.");
    }
    if (payment.providerOrderId) return null;
    await ctx.db.patch(args.paymentId, {
      providerOrderId: args.providerOrderId,
      status: "pending",
      gatewayResponseSummary: args.summary,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const recordGatewayError = internalMutation({
  args: { paymentId: v.id("payments"), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, {
      status: "failed",
      gatewayResponseSummary: args.message.slice(0, 500),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Verifies the checkout callback signature for Razorpay-style redirects.
 * An order is never marked paid from a success URL alone.
 */
export const confirmCheckoutResult = mutation({
  args: {
    orderId: v.id("orders"),
    providerOrderId: v.string(),
    providerPaymentId: v.string(),
    signature: v.string(),
    guestToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order || !canAccessOrder(order, await getUser(ctx), args.guestToken)) {
      throw new Error("Order not found.");
    }
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_provider_order", (q) =>
        q.eq("providerOrderId", args.providerOrderId),
      )
      .unique();
    if (!payment || payment.provider !== "razorpay" || payment.orderId !== order._id) {
      throw new Error("That payment does not belong to this order.");
    }

    const check = verifyRazorpayPaymentSignature({
      orderId: args.providerOrderId,
      paymentId: args.providerPaymentId,
      signature: args.signature,
      keySecret: envValue("RAZORPAY_KEY_SECRET"),
    });

    if (!check.valid) {
      throw new Error("Payment verification failed. We did not mark this order as paid.");
    }

    return { ok: true, orderNumber: order.orderNumber, status: order.paymentStatus };
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
    if (!order || payment.length === 0) {
      await ctx.db.patch(eventId, {
        processed: true,
        processedAt: Date.now(),
        processingError: "No matching order/payment (ignored).",
      });
      return { ok: true, duplicate: false, status: "ignored" };
    }

    if (args.status === "captured") {
      await applyPaidOrder(ctx, {
        order,
        payment: payment[0],
        providerPaymentId: args.providerPaymentId,
        method: "paypal",
      });
    } else {
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
    if (!order) return null;
    if (!canAccessOrder(order, user, args.guestToken)) return null;
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .take(10);
    const events = await ctx.db
      .query("payment_events")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .take(25);
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
      testGatewayEnabled: testGatewayAllowed(settings),
    };
  },
});

export const reserveRefund = internalMutation({
  args: { orderId: v.id("orders"), refundId: v.id("refunds"), amountMinor: v.number() },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (!refund || refund.orderId !== args.orderId || !Number.isSafeInteger(args.amountMinor) ||
        args.amountMinor <= 0 || refund.amountMinor !== args.amountMinor) {
      throw new Error("The refund does not match the requested order and amount.");
    }

    const order = await ctx.db.get(args.orderId);
    const payment = await ctx.db.query("payments")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId)).first();
    if (!order || !payment || payment.provider !== "razorpay" || order.provider !== "razorpay" ||
        payment.currency !== "INR" || refund.currency !== payment.currency ||
        !["captured", "partially_refunded", "refunded"].includes(payment.status) ||
        !payment.providerPaymentId || !/^pay_[A-Za-z0-9]+$/.test(payment.providerPaymentId) ||
        (refund.paymentId && refund.paymentId !== payment._id)) {
      throw new Error("A matching captured Razorpay payment could not be found.");
    }
    if (refund.providerRefundId) {
      return { providerPaymentId: payment.providerPaymentId, providerRefundId: refund.providerRefundId };
    }
    if (!["approved", "processing"].includes(refund.status)) throw new Error("Approve the refund first.");
    const refunds = await readOrderRefunds(ctx, order._id);
    const reserved = refunds.filter(isReservedRefund).reduce((sum, item) => sum + item.amountMinor, 0);
    if (reserved > order.totalMinor || reserved > payment.amountMinor) throw new Error("Refund totals require reconciliation.");
    await ctx.db.patch(refund._id, { paymentId: payment._id, status: "processing", updatedAt: Date.now() });
    return { providerPaymentId: payment.providerPaymentId };
  },
});

export const attachProviderRefund = internalMutation({
  args: { refundId: v.id("refunds"), providerRefundId: v.string() },
  handler: async (ctx, { refundId, providerRefundId }) => {
    const refund = await ctx.db.get(refundId);
    if (!refund || (refund.providerRefundId && refund.providerRefundId !== providerRefundId)) {
      throw new Error("The refund reference requires reconciliation.");
    }
    if (!refund.providerRefundId) await ctx.db.patch(refundId, { providerRefundId, updatedAt: Date.now() });
  },
});
