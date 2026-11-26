/**
 * Provider-agnostic payment gateway layer.
 *
 * Every adapter verifies webhook signatures exactly as the provider documents:
 *  - Razorpay: HMAC-SHA256 **hex** of the raw body with the webhook secret,
 *    sent in `X-Razorpay-Signature`. Duplicate events are identified with the
 *    `x-razorpay-event-id` header.
 *    https://razorpay.com/docs/webhooks/validate-test
 *  - Cashfree: `base64(HMAC-SHA256(<x-webhook-timestamp><raw body>, client
 *    secret))`, sent in `x-webhook-signature`.
 *    https://www.cashfree.com/docs/api-reference/payments/latest/webhooks/signature-verification
 *  - PayPal: order id + capture verification against the PayPal API (no HMAC
 *    body signature); implemented in paymentsActions.ts. Webhook authenticity is
 *    checked with the configured `PAYPAL_WEBHOOK_ID` verification call.
 *
 * Nothing here stores card data, and no secret is ever returned to a client.
 */

import { hmacBase64, hmacHex, safeEqual } from "./hmac";

export type NormalizedWebhook = {
  eventId: string;
  eventType: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  amountMinor?: number;
  currency?: string;
  method?: string;
  status: "captured" | "authorized" | "failed" | "refunded" | "ignored";
  feeMinor?: number;
  refundId?: string;
  refundReceipt?: string;
};

export type SignatureCheck = { valid: boolean; reason?: string };

export function envValue(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value : undefined;
}

/* -------------------------------- Razorpay -------------------------------- */

export function verifyRazorpaySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined,
): SignatureCheck {
  if (!secret) return { valid: false, reason: "RAZORPAY_WEBHOOK_SECRET is not configured." };
  if (!signature) return { valid: false, reason: "Missing X-Razorpay-Signature header." };
  const expected = hmacHex(secret, rawBody);
  return safeEqual(expected, signature.trim())
    ? { valid: true }
    : { valid: false, reason: "Webhook signature mismatch." };
}

/**
 * Checkout callback signature: HMAC-SHA256(`${order_id}|${payment_id}`) — this is
 * what proves the browser did not fabricate a successful payment.
 * https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/#step-3-verify-payment-signature
 */
export function verifyRazorpayPaymentSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string | undefined;
}): SignatureCheck {
  if (!args.keySecret) {
    return { valid: false, reason: "RAZORPAY_KEY_SECRET is not configured." };
  }
  const expected = hmacHex(args.keySecret, `${args.orderId}|${args.paymentId}`);
  return safeEqual(expected, args.signature.trim())
    ? { valid: true }
    : { valid: false, reason: "Payment signature mismatch." };
}

export function parseRazorpayWebhook(
  body: unknown,
  headers: Record<string, string>,
): NormalizedWebhook {
  const payload = body as {
    event?: unknown;
    payload?: {
      payment?: { entity?: {
        id?: string; order_id?: string; amount?: number; currency?: string;
        status?: string; method?: string; fee?: number;
      } };
      refund?: { entity?: {
        id?: string; payment_id?: string; amount?: number; currency?: string;
        status?: string; receipt?: string;
      } };
    };
  } | null;
  const event = typeof payload?.event === "string" ? payload.event : "unknown";
  const payment = payload?.payload?.payment?.entity;
  const refund = payload?.payload?.refund?.entity;
  const status: NormalizedWebhook["status"] = event === "payment.captured" && payment?.status === "captured"
    ? "captured"
    : event === "payment.authorized" && payment?.status === "authorized"
      ? "authorized"
      : event === "payment.failed" && payment?.status === "failed"
        ? "failed"
        : event === "refund.processed" && refund?.status === "processed"
          ? "refunded"
          : "ignored";
  const isRefund = status === "refunded";
  return {
    eventId: headers["x-razorpay-event-id"] ?? "",
    eventType: event,
    providerOrderId: typeof payment?.order_id === "string" ? payment.order_id : undefined,
    providerPaymentId: isRefund ? refund?.payment_id : payment?.id,
    amountMinor: isRefund ? refund?.amount : payment?.amount,
    currency: isRefund ? refund?.currency : payment?.currency,
    method: typeof payment?.method === "string" ? payment.method : undefined,
    feeMinor: Number.isSafeInteger(payment?.fee) ? payment?.fee : undefined,
    refundId: isRefund ? refund?.id : undefined,
    refundReceipt: isRefund ? refund?.receipt : undefined,
    status,
  };
}

/* -------------------------------- Cashfree -------------------------------- */

export function verifyCashfreeSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  secret: string | undefined,
): SignatureCheck {
  if (!secret) return { valid: false, reason: "CASHFREE_CLIENT_SECRET is not configured." };
  if (!signature || !timestamp) {
    return { valid: false, reason: "Missing x-webhook-signature or x-webhook-timestamp." };
  }
  const expected = hmacBase64(secret, `${timestamp}${rawBody}`);
  return safeEqual(expected, signature.trim())
    ? { valid: true }
    : { valid: false, reason: "Webhook signature mismatch." };
}

export function parseCashfreeWebhook(body: unknown): NormalizedWebhook {
  const payload = body as {
    type?: string; event_time?: string;
    data?: {
      order?: { order_id?: string };
      payment?: { cf_payment_id?: string | number; payment_amount?: number; payment_currency?: string; payment_group?: string; payment_time?: string };
      refund?: { cf_refund_id?: string | number };
    };
  } | null;
  const type = String(payload?.type ?? "unknown");
  const data = payload?.data ?? {};
  const status: NormalizedWebhook["status"] =
    type === "PAYMENT_SUCCESS_WEBHOOK"
      ? "captured"
      : type === "PAYMENT_FAILED_WEBHOOK"
        ? "failed"
        : type.startsWith("REFUND")
          ? "refunded"
          : "ignored";
  const order = data.order ?? {};
  const payment = data.payment ?? {};
  const refund = data.refund ?? {};
  return {
    eventId: `${type}:${payment.cf_payment_id ?? refund.cf_refund_id ?? order.order_id ?? ""}:${payload?.data?.payment?.payment_time ?? payload?.event_time ?? ""}`,
    eventType: type,
    providerOrderId: order.order_id,
    providerPaymentId: payment.cf_payment_id ? String(payment.cf_payment_id) : undefined,
    amountMinor: payment.payment_amount !== undefined
      ? Math.round(Number(payment.payment_amount) * 100)
      : undefined,
    currency: payment.payment_currency,
    method: payment.payment_group,
    refundId: refund.cf_refund_id ? String(refund.cf_refund_id) : undefined,
    status,
  };
}
