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
import { getAuthUserId } from "@convex-dev/auth/server";
import { envValue, signTestGatewayPayload } from "./lib/gateways";
import { providerRuntimeStatus } from "./lib/settings";

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

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

export const createPaymentSession = action({
  args: {
    orderId: v.id("orders"),
    origin: v.string(),
  },
  handler: async (ctx, args): Promise<SessionResult> => {
    const userId = await getAuthUserId(ctx);
    const order: Doc<"orders"> | null = await ctx.runQuery(
      api.orders.getOrderForCheckout,
      { orderId: args.orderId },
    );
    if (!order) throw new Error("Order not found.");
    if (order.userId && order.userId !== userId) {
      throw new Error("You cannot pay for this order.");
    }
    const settings: SiteSettings = await ctx.runQuery(internal.settings.read, {});
    const providerId: string | undefined = order.provider;
    if (!providerId) throw new Error("This order has no online payment method.");

    const payment: Doc<"payments"> | null = await ctx.runQuery(
      internal.payments.getOrderPayment,
      { orderId: args.orderId },
    );
    if (!payment) throw new Error("No payment record exists for this order.");

    const siteOrigin =
      settings.seo.siteUrl && settings.seo.siteUrl.startsWith("http")
        ? settings.seo.siteUrl.replace(/\/$/, "")
        : args.origin.replace(/\/$/, "");
    const returnUrl = `${siteOrigin}/checkout/return?orderId=${args.orderId}`;

    let result: SessionResult;

    if (providerId === "test_gateway") {
      if (!settings.payments.testGatewayEnabled) {
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
      const response = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: jsonHeaders({
          Authorization:
            "Basic " + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64"),
        }),
        body: JSON.stringify({
          amount: order.totalMinor,
          currency: order.currency,
          receipt: order.orderNumber,
          notes: { knokhOrderId: String(order._id) },
        }),
      });
      const payload = await readJson(response);
      if (!response.ok || !payload.id) {
        await ctx.runMutation(internal.payments.recordGatewayError, {
          paymentId: payment._id,
          message: `Razorpay order creation failed (HTTP ${response.status}): ${JSON.stringify(payload).slice(0, 300)}`,
        });
        throw new Error(
          `Razorpay rejected the order creation request (HTTP ${response.status}). ${payload?.error?.description ?? ""}`.trim(),
        );
      }
      result = {
        provider: "razorpay",
        providerOrderId: String(payload.id),
        clientPayload: {
          key: env.RAZORPAY_KEY_ID,
          razorpayOrderId: payload.id,
          amountMinor: payload.amount,
          currency: payload.currency,
          name: settings.brand.name,
          description: `Order ${order.orderNumber}`,
          website: settings.seo.siteUrl || undefined,
        },
        nextStep:
          "Load checkout.js and open the Razorpay standard checkout with this payload, then verify the returned signature on our server.",
      };
    } else if (providerId === "cashfree") {
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
          "x-api-version": env.CASHFREE_ENV === "production" ? "2025-01-01" : "2023-08-01",
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
      if (!response.ok || !payload.payment_session_id) {
        await ctx.runMutation(internal.payments.recordGatewayError, {
          paymentId: payment._id,
          message: `Cashfree order creation failed (HTTP ${response.status}): ${JSON.stringify(payload).slice(0, 300)}`,
        });
        throw new Error(
          `Cashfree rejected the order creation request (HTTP ${response.status}). ${payload?.message ?? ""}`.trim(),
        );
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
    } else if (providerId === "paypal") {
      const env = requireEnv([
        "PAYPAL_CLIENT_ID",
        "PAYPAL_CLIENT_SECRET",
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
        throw new Error(
          `PayPal authentication failed (HTTP ${tokenResponse.status}). Check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.`,
        );
      }
      const orderResponse = await fetch(`${apiBase}/v2/checkout/orders`, {
        method: "POST",
        headers: jsonHeaders({
          Authorization: `Bearer ${tokenPayload.access_token}`,
        }),
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              custom_id: String(order._id),
              amount: {
                currency_code: order.currency,
                value: (order.totalMinor / 100).toFixed(2),
              },
            },
          ],
          application_context: {
            brand_name: settings.brand.name,
            return_url: returnUrl,
            cancel_url: `${siteOrigin}/cart`,
          },
        }),
      });
      const payload = await readJson(orderResponse);
      if (!orderResponse.ok || !payload.id) {
        throw new Error(
          `PayPal order creation failed (HTTP ${orderResponse.status}). ${JSON.stringify(payload).slice(0, 200)}`,
        );
      }
      const approve = (payload.links ?? []).find(
        (link: { rel: string; href: string }) => link.rel === "approve",
      );
      result = {
        provider: "paypal",
        providerOrderId: String(payload.id),
        clientPayload: {
          paypalOrderId: payload.id,
          approveUrl: approve?.href,
        },
        nextStep:
          "Redirect the buyer to the PayPal approval URL, then capture on return and confirm through the verified webhook.",
      };
    } else {
      const provider = settings.payments.providers.find((entry) => entry.id === providerId);
      const status = provider ? providerRuntimeStatus(provider.envVars) : "pending_credentials";
      throw new Error(
        `The "${providerId}" payment adapter has no implementation in this deployment (status: ${status}). Choose another payment method.`,
      );
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
    outcome: v.union(v.literal("captured"), v.literal("failed")),
  },
  handler: async (ctx, args): Promise<WebhookOutcome> => {
    const settings: SiteSettings = await ctx.runQuery(internal.settings.read, {});
    if (!settings.payments.testGatewayEnabled) {
      throw new Error("The test gateway is disabled, so simulated payments are refused.");
    }
    const secret = requireEnv(["TEST_GATEWAY_WEBHOOK_SECRET"])
      .TEST_GATEWAY_WEBHOOK_SECRET;
    const order: Doc<"orders"> | null = await ctx.runQuery(
      api.orders.getOrderForCheckout,
      { orderId: args.orderId },
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

/** Records a refund. Live gateway refunds require the provider credentials. */
export const requestRefund = action({
  args: {
    orderId: v.id("orders"),
    amountMinor: v.number(),
    reason: v.string(),
    refundId: v.optional(v.id("refunds")),
  },
  handler: async (ctx, args): Promise<RefundActionResult> => {
    const adminEmail: Doc<"users"> | null = await ctx.runQuery(api.users.currentUser);
    if (!adminEmail || adminEmail.role !== "admin") {
      throw new Error("Admin access required.");
    }
    const order: Doc<"orders"> | null = await ctx.runQuery(
      api.orders.getOrderForCheckout,
      { orderId: args.orderId },
    );
    if (!order) throw new Error("Order not found.");
    const payment: Doc<"payments"> | null = await ctx.runQuery(
      internal.payments.getOrderPayment,
      { orderId: args.orderId },
    );
    if (!payment) {
      return {
        ok: false,
        message:
          "There is no payment record for this order, so no gateway refund is possible. Record the refund manually.",
      };
    }
    if (args.amountMinor <= 0 || args.amountMinor > order.totalMinor) {
      throw new Error("Refund amount must be greater than zero and no more than the order total.");
    }

    if (payment.provider === "razorpay") {
      const env = requireEnv(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
      if (!payment.providerPaymentId) {
        return { ok: false, message: "Razorpay payment id is not recorded for this order yet." };
      }
      const response: Response = await fetch(
        `https://api.razorpay.com/v1/payments/${payment.providerPaymentId}/refund`,
        {
          method: "POST",
          headers: jsonHeaders({
            Authorization:
              "Basic " +
              Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64"),
          }),
          body: JSON.stringify({ amount: args.amountMinor, notes: { reason: args.reason } }),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return {
          ok: false,
          message: `Razorpay refund failed (HTTP ${response.status}): ${payload?.error?.description ?? "unknown error"}`,
        };
      }
      return { ok: true, providerRefundId: String(payload.id), message: "Refund accepted by Razorpay." };
    }

    if (payment.provider === "cashfree") {
      const env = requireEnv([
        "CASHFREE_CLIENT_ID",
        "CASHFREE_CLIENT_SECRET",
        "CASHFREE_ENV",
      ]);
      const baseUrl =
        env.CASHFREE_ENV === "production"
          ? "https://api.cashfree.com/pg"
          : "https://sandbox.cashfree.com/pg";
      const response: Response = await fetch(`${baseUrl}/orders/${order.orderNumber}/refunds`, {
        method: "POST",
        headers: jsonHeaders({
          "x-client-id": env.CASHFREE_CLIENT_ID,
          "x-client-secret": env.CASHFREE_CLIENT_SECRET,
          "x-api-version": env.CASHFREE_ENV === "production" ? "2025-01-01" : "2023-08-01",
        }),
        body: JSON.stringify({
          refund_id: `knokh_${order.orderNumber}_${Date.now()}`,
          refund_amount: Number((args.amountMinor / 100).toFixed(2)),
          refund_note: args.reason.slice(0, 100),
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        return {
          ok: false,
          message: `Cashfree refund failed (HTTP ${response.status}): ${payload?.message ?? "unknown error"}`,
        };
      }
      return {
        ok: true,
        providerRefundId: String(payload.cf_refund_id ?? payload.refund_id ?? ""),
        message: "Refund accepted by Cashfree.",
      };
    }

    return {
      ok: false,
      message:
        payment.provider === "test_gateway"
          ? "The test gateway is a sandbox and cannot issue real refunds. Mark the refund as completed manually."
          : `Automatic refunds are not implemented for the "${payment.provider}" adapter. Process this refund in the provider dashboard and record it here.`,
    };
  },
});
