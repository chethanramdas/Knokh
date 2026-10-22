import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getUser, notifyAdmins, notifyUser, writeAuditLog } from "./lib/auth";
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
    preVerified: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<WebhookOutcome> => {
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
      await ctx.db.insert("payment_events", {
        provider: args.provider,
        eventId: `unparseable:${Date.now()}`,
        eventType: "unparseable",
        signatureValid: false,
        payloadJson: args.rawBody.slice(0, 4000),
        processed: false,
        processingError: "Webhook body was not valid JSON.",
        receivedAt: Date.now(),
      });
      return { ok: false, duplicate: false, reason: "Body was not valid JSON." };
    }

    if (!signatureValid) {
      if (args.provider === "razorpay") {
        const check = verifyRazorpaySignature(
          args.rawBody,
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
      // Invalid signatures are recorded for the audit trail but never applied.
      await ctx.db.insert("payment_events", {
        provider: args.provider,
        eventId: parsed.eventId,
        eventType: parsed.eventType,
        signatureValid: false,
        payloadJson: args.rawBody.slice(0, 4000),
        processed: false,
        processingError: failureReason ?? "Signature verification failed.",
        receivedAt: Date.now(),
      });
      return { ok: false, duplicate: false, reason: failureReason };
    }

    const existing = await ctx.db
      .query("payment_events")
      .withIndex("by_event", (q) =>
        q.eq("provider", args.provider).eq("eventId", parsed!.eventId),
      )
      .unique();
    if (existing?.processed) {
      return { ok: true, duplicate: true, status: parsed.status };
    }

    const payment = parsed.providerOrderId
      ? await ctx.db
          .query("payments")
          .withIndex("by_provider_order", (q) =>
            q.eq("providerOrderId", parsed!.providerOrderId),
          )
          .unique()
      : null;

    const order = payment ? await ctx.db.get(payment.orderId) : null;

    const eventId = await ctx.db.insert("payment_events", {
      provider: args.provider,
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      orderId: order?._id,
      paymentId: payment?._id,
      signatureValid: true,
      payloadJson: args.rawBody.slice(0, 4000),
      processed: false,
      receivedAt: Date.now(),
    });

    if (!payment || !order) {
      await ctx.db.patch(eventId, {
        processed: true,
        processedAt: Date.now(),
        processingError:
          "No matching order/payment for this gateway order id (ignored).",
      });
      return { ok: true, duplicate: false, status: parsed.status };
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
        const refundedAmount = parsed.amountMinor ?? 0;
        const fullyRefunded = refundedAmount >= order.totalMinor;
        await ctx.db.patch(payment._id, {
          status: fullyRefunded ? "refunded" : "partially_refunded",
          updatedAt: now,
        });
        await ctx.db.patch(order._id, {
          paymentStatus: fullyRefunded ? "refunded" : "partially_refunded",
          updatedAt: now,
        });
        break;
      }
      default:
        break;
    }

    await ctx.db.patch(eventId, { processed: true, processedAt: Date.now() });
    return { ok: true, duplicate: false, status: parsed.status, orderId: order._id };
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
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    if (order.userId && order.userId !== user?._id && user?.role !== "admin") {
      throw new Error("You cannot confirm payments for this order.");
    }
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_provider_order", (q) =>
        q.eq("providerOrderId", args.providerOrderId),
      )
      .unique();
    if (!payment || payment.orderId !== order._id) {
      throw new Error("That payment does not belong to this order.");
    }

    const check = verifyRazorpayPaymentSignature({
      orderId: args.providerOrderId,
      paymentId: args.providerPaymentId,
      signature: args.signature,
      keySecret: envValue("RAZORPAY_KEY_SECRET"),
    });

    if (!check.valid) {
      await ctx.db.insert("payment_events", {
        provider: payment.provider,
        eventId: `checkout-callback:${args.providerPaymentId}`,
        eventType: "checkout.callback.rejected",
        orderId: order._id,
        paymentId: payment._id,
        signatureValid: false,
        payloadJson: JSON.stringify({
          providerOrderId: args.providerOrderId,
          providerPaymentId: args.providerPaymentId,
        }),
        processed: false,
        processingError: check.reason ?? "Signature mismatch",
        receivedAt: Date.now(),
      });
      throw new Error("Payment verification failed. We did not mark this order as paid.");
    }

    await applyPaidOrder(ctx, {
      order,
      payment,
      providerPaymentId: args.providerPaymentId,
    });
    await writeAuditLog(ctx, {
      actorId: user?._id,
      action: "payment.confirm",
      entity: "payments",
      entityId: String(payment._id),
      summary: `Payment confirmed for ${order.orderNumber}`,
    });
    return { ok: true, orderNumber: order.orderNumber };
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
      payloadJson: args.payloadJson.slice(0, 4000),
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
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) return null;
    const isOwner = order.userId && user?._id === order.userId;
    if (!isOwner && user?.role !== "admin") return null;
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
      testGatewayEnabled: settings.payments.testGatewayEnabled,
    };
  },
});
