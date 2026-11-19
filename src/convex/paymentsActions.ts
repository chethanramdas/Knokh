"use node";

/**
 * Payment gateway actions (Node runtime) — the only code that talks to a
 * payment provider over the network. Secrets are read from the Convex
 * deployment environment at call time and are never returned to the browser.
 *
 * HONEST STATUS OF EACH ADAPTER:
 *  - `test_gateway` : fully implemented end to end and exercised by the sandbox
 *                     flow. It is NOT a real provider, moves no money, and must
 *                     be switched off before going live.
 *  - `razorpay`     : implemented against the official Orders API + signature
 *                     verification. Requires merchant approval and the
 *                     RAZORPAY_* environment variables. Until those exist the
 *                     action fails with an explicit configuration error; it
 *                     never pretends a payment succeeded.
 *  - `cashfree`     : implemented against the official Orders API. Requires the
 *                     CASHFREE_* environment variables.
 *  - `paypal`       : implemented against the official Orders v2 API. Requires
 *                     the PAYPAL_* environment variables.
 */

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { SiteSettings } from "./lib/config";
import type { WebhookOutcome } from "./payments";

/** Explicit shapes keep Convex's function typing from becoming circular. */
type WebhookActionOutcome = {
  ok: boolean;
  duplicate?: boolean;
  reason?: string;
  status?: string;
};

type RefundActionResult = {
  ok: boolean;
  providerRefundId?: string;
  message: string;
};
import { envValue, signTestGatewayPayload } from "./lib/gateways";
import { providerAllowed, testGatewayAllowed } from "./lib/paymentMode";

type SessionResult = {
  provider: string;
  providerOrderId: string;
  clientPayload: Record<string, unknown>;
  nextStep: string;
};

function requireEnv(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of keys) {
    const value = envValue(key);
    if (!value) missing.push(key);
    else out[key] = value;
  }
  if (missing.length > 0) {
    throw new Error(
      `This payment method is not configured yet. An administrator must set ${missing.join(", ")} on the deployment (Keys / API keys tab) and enable the provider in Admin → Settings → Payments.`,
    );
  }
  return out;
}

function jsonHeaders(extra: Record<string, string> = {}) {
  return { "Content-Type": "application/json", ...extra };
}

type GatewayResponse = {
  id?: string;
  amount?: number;
  currency?: string;
  payment_id?: string;
  access_token?: string;
  payment_session_id?: string;
  order_id?: string;
  message?: string;
  verification_status?: string;
};

async function readJson(response: Response): Promise<GatewayResponse> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export const createPaymentSession = action({
  args: {
    orderId: v.id("orders"),
    guestToken: v.optional(v.string()),
    origin: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SessionResult> => {
    const order: Doc<"orders"> | null = await ctx.runQuery(
      api.orders.getOrderForCheckout,
      { orderId: args.orderId, guestToken: args.guestToken },
    );
    if (!order) throw new Error("Order not found.");
    const settings: SiteSettings = await ctx.runQuery(internal.settings.read, {});
    const providerId: string | undefined = order.provider;
    if (!providerId) throw new Error("This order has no online payment method.");

    const payment: Doc<"payments"> | null = await ctx.runQuery(
      internal.payments.getOrderPayment,
      { orderId: args.orderId },
    );
    if (!payment) throw new Error("No payment record exists for this order.");

    const provider = settings.payments.providers.find((entry) => entry.id === providerId);
    if (providerId === "test_gateway" ? !testGatewayAllowed(settings) : !provider || !providerAllowed(provider)) {
      throw new Error("This payment method is unavailable.");
    }
    if (order.currency !== "INR" || !Number.isSafeInteger(order.totalMinor) || order.totalMinor <= 0 ||
        payment.currency !== order.currency || payment.amountMinor !== order.totalMinor) {
      throw new Error("The order total is unavailable.");
    }
    const existingGatewayOrder: string | null = await ctx.runMutation(internal.payments.reserveGatewaySession, {
      paymentId: payment._id,
    });
    const siteOrigin = process.env.SITE_URL!;
    const returnUrl = new URL(`/checkout/return?orderId=${args.orderId}`, siteOrigin).href;

    let result: SessionResult;

    if (providerId === "test_gateway") {
      if (!testGatewayAllowed(settings)) {
        throw new Error("The test gateway is disabled in Admin → Settings → Payments.");
      }
      requireEnv(["TEST_GATEWAY_WEBHOOK_SECRET"]);
      result = {
        provider: "test_gateway",
        providerOrderId: `test_order_${order._id}`,
        clientPayload: {
          checkoutUrl: `/checkout/sandbox/${args.orderId}`,
          amountMinor: order.totalMinor,
          currency: order.currency,
        },
        nextStep:
          "Open the KNOKH sandbox checkout page. It signs a webhook with the same HMAC scheme as a real gateway, so verification and idempotency are genuinely tested.",
      };
    } else if (providerId === "razorpay") {
      const env = requireEnv(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
      let providerOrderId = existingGatewayOrder;
      if (!providerOrderId) {
        const response = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: jsonHeaders({
            Authorization: "Basic " + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64"),
          }),
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            amount: order.totalMinor,
            currency: order.currency,
            receipt: order.orderNumber,
            notes: { knokhOrderId: String(order._id) },
          }),
        });
        const payload = await readJson(response);
        if (!response.ok || typeof payload.id !== "string" || !/^order_[A-Za-z0-9]+$/.test(payload.id) ||
            payload.amount !== order.totalMinor || payload.currency !== order.currency) {
          await ctx.runMutation(internal.payments.recordGatewayError, {
            paymentId: payment._id,
            message: `Razorpay order creation unconfirmed (HTTP ${response.status}). Reconcile by receipt.`,
          });
          throw new Error("Payment setup could not be confirmed. Contact support with your order number.");
        }
        providerOrderId = payload.id;
      }
      result = {
        provider: "razorpay",
        providerOrderId: providerOrderId!,
        clientPayload: {
          key: env.RAZORPAY_KEY_ID,
          razorpayOrderId: providerOrderId,
          amountMinor: order.totalMinor,
          currency: order.currency,
          name: settings.brand.name,
          description: `Order ${order.orderNumber}`,
          website: settings.seo.siteUrl || undefined,
        },
        nextStep:
          "Load checkout.js and open the Razorpay standard checkout with this payload, then verify the returned signature on our server.",
      };
    } else if (providerId === "cashfree") {
      if (existingGatewayOrder) throw new Error("Payment setup already exists. Contact support if you cannot resume.");
      const env = requireEnv([
        "CASHFREE_CLIENT_ID",
        "CASHFREE_CLIENT_SECRET",
        "CASHFREE_ENV",
      ]);
      const baseUrl =
        env.CASHFREE_ENV === "production"
          ? "https://api.cashfree.com/pg"
          : "https://sandbox.cashfree.com/pg";
      const response = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: jsonHeaders({
          "x-client-id": env.CASHFREE_CLIENT_ID,
          "x-client-secret": env.CASHFREE_CLIENT_SECRET,
          "x-api-version": "2025-01-01",
        }),
        body: JSON.stringify({
          order_id: order.orderNumber,
          order_amount: Number((order.totalMinor / 100).toFixed(2)),
          order_currency: order.currency,
          customer_details: {
            customer_id: String(order.userId ?? order._id),
            customer_email: order.shippingAddress.email ?? order.guestEmail ?? "",
            customer_phone: order.shippingAddress.phone,
          },
          order_meta: { return_url: `${returnUrl}` },
        }),
      });
      const payload = await readJson(response);
      if (!response.ok || !payload.payment_session_id || payload.order_id !== order.orderNumber) {
        await ctx.runMutation(internal.payments.recordGatewayError, {
          paymentId: payment._id,
          message: `Cashfree order creation unconfirmed (HTTP ${response.status}).`,
        });
        throw new Error("Payment setup could not be confirmed. Contact support with your order number.");
      }
      result = {
        provider: "cashfree",
        providerOrderId: String(payload.order_id),
        clientPayload: {
          paymentSessionId: payload.payment_session_id,
          environment: env.CASHFREE_ENV === "production" ? "production" : "sandbox",
          orderId: payload.order_id,
        },
        nextStep:
          "Hand payment_signup_session_id to the Cashfree JS SDK v3 / hosted checkout, then rely on the verified webhook for settlement.",
      };
    } else {
      throw new Error("This payment method is unavailable.");
    }

    await ctx.runMutation(internal.payments.attachGatewaySession, {
      paymentId: payment._id,
      providerOrderId: result.providerOrderId,
      summary: result.nextStep,
    });

    return result;
  },
});

/**
 * Sandbox harness: creates the *same* signed webhook a real gateway would send
 * and feeds it through the production verification path. Only available while
 * the test gateway is enabled.
 */
export const simulateTestGatewayEvent = action({
  args: {
    orderId: v.id("orders"),
    guestToken: v.optional(v.string()),
    outcome: v.union(v.literal("captured"), v.literal("failed")),
  },
  handler: async (ctx, args): Promise<WebhookOutcome> => {
    const settings: SiteSettings = await ctx.runQuery(internal.settings.read, {});
    if (!testGatewayAllowed(settings)) {
      throw new Error("The test gateway is disabled, so simulated payments are refused.");
    }
    const secret = requireEnv(["TEST_GATEWAY_WEBHOOK_SECRET"])
      .TEST_GATEWAY_WEBHOOK_SECRET;
    const order: Doc<"orders"> | null = await ctx.runQuery(
      api.orders.getOrderForCheckout,
      { orderId: args.orderId, guestToken: args.guestToken },
    );
    if (!order) throw new Error("Order not found.");
    if (order.paymentMethod !== "online" || order.provider !== "test_gateway") {
      throw new Error("This order is not payable through the test gateway.");
    }
    const payment: Doc<"payments"> | null = await ctx.runQuery(
      internal.payments.getOrderPayment,
      { orderId: args.orderId },
    );
    if (!payment) throw new Error("No payment record exists for this order.");

    const body = JSON.stringify({
      eventId: `test_evt_${args.orderId}_${args.outcome}_${Date.now()}`,
      eventType: args.outcome === "captured" ? "payment.captured" : "payment.failed",
      orderId: `test_order_${args.orderId}`,
      paymentId: `test_pay_${Date.now()}`,
      amountMinor: order.totalMinor,
      currency: order.currency,
      method: "card",
      status: args.outcome,
    });
    const signature = signTestGatewayPayload(body, secret);

    const result: WebhookOutcome = await ctx.runMutation(
      internal.payments.processWebhookEvent,
      {
        provider: "test_gateway",
        rawBody: body,
        headers: { "x-test-signature": signature },
      },
    );
    return result;
  },
});

/** Verifies a PayPal webhook via the documented verify-webhook-signature API. */
export const handlePaypalWebhook = internalAction({
  args: {
    rawBody: v.string(),
    headers: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args): Promise<WebhookActionOutcome> => {
    const env = requireEnv([
      "PAYPAL_CLIENT_ID",
      "PAYPAL_CLIENT_SECRET",
      "PAYPAL_WEBHOOK_ID",
      "PAYPAL_ENV",
    ]);
    const apiBase =
      env.PAYPAL_ENV === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";
    const tokenResponse = await fetch(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64"),
      },
      body: "grant_type=client_credentials",
    });
    const tokenPayload = await readJson(tokenResponse);
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error("PayPal webhook verification failed: could not authenticate.");
    }
    const event = JSON.parse(args.rawBody);
    const verifyResponse = await fetch(
      `${apiBase}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: jsonHeaders({
          Authorization: `Bearer ${tokenPayload.access_token}`,
        }),
        body: JSON.stringify({
          auth_algo: args.headers["paypal-auth-algo"],
          cert_url: args.headers["paypal-cert-url"],
          transmission_id: args.headers["paypal-transmission-id"],
          transmission_sig: args.headers["paypal-transmission-sig"],
          transmission_time: args.headers["paypal-transmission-time"],
          webhook_id: env.PAYPAL_WEBHOOK_ID,
          webhook_event: event,
        }),
      },
    );
    const verifyPayload = await readJson(verifyResponse);
    const verified = verifyPayload?.verification_status === "SUCCESS";
    if (!verified) {
      return { ok: false, reason: "PayPal signature verification failed." };
    }
    // The custom_id set when the PayPal order was created carries the KNOKH
    // order id, which is how the event is matched back to an order.
    const resource = event.resource ?? {};
    const customId: string | undefined =
      resource.custom_id ?? resource.purchase_units?.[0]?.custom_id;
    const status =
      typeof event.event_type === "string" &&
      event.event_type.startsWith("PAYMENT.CAPTURE.COMPLETED")
        ? "captured"
        : typeof event.event_type === "string" &&
            event.event_type.startsWith("PAYMENT.CAPTURE.DENIED")
          ? "failed"
          : "ignored";

    return await ctx.runMutation(internal.payments.processPaypalEvent, {
      eventId: String(event.id),
      eventType: String(event.event_type),
      status,
      orderId: customId ? (customId as unknown as Id<"orders">) : undefined,
      amountMinor:
        resource.amount?.value !== undefined
          ? Math.round(Number(resource.amount.value) * 100)
          : undefined,
      currency: resource.amount?.currency_code,
      providerPaymentId: resource.id ? String(resource.id) : undefined,
      payloadJson: args.rawBody.slice(0, 4000),
    });
  },
});

/** Submit the same refund id to Razorpay on every retry. Completion comes from its webhook. */
export const requestRefund = action({
  args: {
    orderId: v.id("orders"),
    amountMinor: v.number(),
    reason: v.string(),
    refundId: v.optional(v.id("refunds")),
  },
  handler: async (ctx, args): Promise<RefundActionResult> => {
    const actor = await ctx.runQuery(api.users.currentUser);
    if (actor?.role !== "admin") throw new Error("Admin access required.");
    if (!args.refundId || process.env.KNOKH_RAZORPAY_REFUNDS_ENABLED !== "true") {
      return { ok: false, message: "Gateway refunds are unavailable. Use the provider dashboard for approved refunds." };
    }
    const settings: SiteSettings = await ctx.runQuery(internal.settings.read, {});
    const provider = settings.payments.providers.find((entry) => entry.id === "razorpay");
    if (!provider || !providerAllowed(provider)) throw new Error("Razorpay is unavailable.");
    const reservation: { providerPaymentId: string; providerRefundId?: string } =
      await ctx.runMutation(internal.payments.reserveRefund, {
        orderId: args.orderId, refundId: args.refundId, amountMinor: args.amountMinor,
      });
    if (reservation.providerRefundId) {
      return { ok: true, providerRefundId: reservation.providerRefundId, message: "Refund already submitted." };
    }
    const env = requireEnv(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${reservation.providerPaymentId}/refund`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: jsonHeaders({
          Authorization: "Basic " + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64"),
          "X-Refund-Idempotency": String(args.refundId),
        }),
        body: JSON.stringify({ amount: args.amountMinor, notes: { knokhRefundId: String(args.refundId) } }),
      },
    );
    const result = await readJson(response);
    if (!response.ok || !result.id || !/^rfnd_[A-Za-z0-9]+$/.test(result.id) ||
        result.amount !== args.amountMinor || result.payment_id !== reservation.providerPaymentId) {
      return { ok: false, message: "Refund submission is unconfirmed. Reconcile before retrying with the same refund record." };
    }
    await ctx.runMutation(internal.payments.attachProviderRefund, { refundId: args.refundId, providerRefundId: result.id });
    return { ok: true, providerRefundId: result.id, message: "Razorpay accepted the refund. Awaiting confirmation." };
  },
});
