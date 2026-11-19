"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";

import { action, internalAction } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import type { SiteSettings } from "./lib/config";


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
import { envValue } from "./lib/gateways";
import { checkoutProviderEnabled } from "./lib/paymentMode";

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
  id?: string; amount?: number; currency?: string; payment_id?: string;
  access_token?: string; verification_status?: string;
};

async function readJson(response: Response): Promise<GatewayResponse> {
  try {
    return (await response.json()) ?? {};
  } catch {
    return {};
  }
}

export const createPaymentSession = action({
  args: { orderId: v.id("orders"), guestToken: v.optional(v.string()) },
  handler: async (ctx, args): Promise<SessionResult> => {
    const order: { orderNumber: string; provider?: string; currency: string; totalMinor: number } | null =
      await ctx.runQuery(api.orders.getOrderForCheckout, args);
    if (!order || order.provider !== "razorpay" || order.currency !== "INR" ||
        !Number.isSafeInteger(order.totalMinor) || order.totalMinor <= 0) {
      throw new Error("This order is unavailable for online payment.");
    }
    const settings: SiteSettings = await ctx.runQuery(internal.settings.read, {});
    if (!checkoutProviderEnabled("razorpay", settings)) throw new Error("Online payment is unavailable.");
    const payment: Doc<"payments"> | null = await ctx.runQuery(internal.payments.getOrderPayment, {
      orderId: args.orderId,
    });
    if (!payment || payment.amountMinor !== order.totalMinor || payment.currency !== order.currency ||
        payment.provider !== order.provider) throw new Error("The payment could not be verified.");

    const gate = await ctx.runMutation(internal.payments.beginGatewaySession, { paymentId: payment._id });
    const env = requireEnv(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
    let providerOrderId: string;
    if (gate.status === "existing") {
      providerOrderId = gate.providerOrderId;
    } else if (gate.status === "create") {
      try {
        const response = await razorpayRequest(env, "orders", {
          amount: order.totalMinor, currency: order.currency, receipt: order.orderNumber,
        });
        const payload = await readJson(response);
        if (!response.ok || !payload.id || !/^order_[a-zA-Z0-9]+$/.test(payload.id) ||
            payload.amount !== order.totalMinor || payload.currency !== order.currency) {
          throw new Error(`Razorpay order creation returned HTTP ${response.status} or mismatched order data.`);
        }
        providerOrderId = payload.id;
        await ctx.runMutation(internal.payments.attachGatewaySession, { paymentId: payment._id, providerOrderId });
      } catch {
        await ctx.runMutation(internal.payments.recordGatewayError, {
          paymentId: payment._id, message: "Gateway order creation requires reconciliation by receipt.",
        });
        throw new Error("We could not confirm the payment session. Check order status or contact support before retrying.");
      }
    } else {
      throw new Error("A payment session is unavailable or still being prepared. Check your order status.");
    }
    return {
      provider: "razorpay",
      providerOrderId,
      clientPayload: {
        key: env.RAZORPAY_KEY_ID, razorpayOrderId: providerOrderId,
        amountMinor: order.totalMinor, currency: order.currency,
        name: settings.brand.name, description: `Order ${order.orderNumber}`,
      },
      nextStep: "Open Razorpay checkout and wait for verified capture.",
    };
  },
});

function razorpayRequest(
  env: Record<string, string>, path: string, body: object, additionalHeaders: Record<string, string> = {},
) {
  return fetch(`https://api.razorpay.com/v1/${path}`, {
    method: "POST",
    headers: jsonHeaders({
      Authorization: "Basic " + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64"),
      ...additionalHeaders,
    }),
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
}

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
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const tokenPayload = await readJson(tokenResponse);
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error("PayPal webhook verification failed: could not authenticate.");
    }
    let event: {
      id?: string;
      event_type?: string;
      resource?: {
        custom_id?: string; purchase_units?: { custom_id?: string }[];
        id?: string; amount?: { value?: string; currency_code?: string };
      };
    };
    try { event = JSON.parse(args.rawBody); }
    catch { return { ok: false, reason: "Invalid PayPal payload." }; }
    if (!event?.id || !event.event_type) return { ok: false, reason: "Invalid PayPal event." };
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
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
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
      payloadJson: "{}",
    });
  },
});

/** Uses a reserved refund record as the durable provider idempotency key. */
export const requestRefund = action({
  args: { refundId: v.id("refunds") },
  handler: async (ctx, { refundId }): Promise<RefundActionResult> => {
    const admin: Doc<"users"> | null = await ctx.runQuery(api.users.currentUser);
    if (admin?.role !== "admin") throw new Error("Admin access required.");
    const settings: SiteSettings = await ctx.runQuery(internal.settings.read, {});
    if (!checkoutProviderEnabled("razorpay", settings)) {
      throw new Error("Razorpay is unavailable. Escalate this refund to payment operations.");
    }
    const env = requireEnv(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
    const refund = await ctx.runMutation(internal.payments.reserveRazorpayRefund, { refundId });
    if (refund.existingId) {
      return { ok: true, providerRefundId: refund.existingId, message: "Refund already submitted." };
    }
    if (!refund.providerPaymentId) throw new Error("No verified Razorpay capture was found.");
    try {
      const response = await razorpayRequest(env, `payments/${refund.providerPaymentId}/refund`, {
        amount: refund.amountMinor,
        receipt: refundId,
      }, { "X-Refund-Idempotency": refundId });
      const payload = await readJson(response);
      if (!response.ok || !payload.id || !/^rfnd_[a-zA-Z0-9]+$/.test(payload.id) ||
          payload.amount !== refund.amountMinor || payload.payment_id !== refund.providerPaymentId) {
        return { ok: false, message: "Refund status is unknown. Reconcile the existing refund before submitting another." };
      }
      await ctx.runMutation(internal.payments.attachGatewayRefund, { refundId, providerRefundId: payload.id });
      return { ok: true, providerRefundId: payload.id, message: "Refund submitted. Awaiting Razorpay confirmation." };
    } catch {
      return { ok: false, message: "Refund status is unknown. Reconcile the existing refund before submitting another." };
    }
  },
});
