/**
 * Provider-agnostic payment gateway layer.
 *
 * Every adapter verifies webhook signatures exactly as the provider documents:
 *  - Razorpay: HMAC-SHA256 **hex** of the raw body with the webhook secret,
 *    sent in `X-Razorpay-Signature`. Duplicate events are identified with the
 *    `x-razorpay-event-id` header.
 *    https://razorpay.com/docs/webhooks/validate-test
 *  - Cashfree: `base64(HMAC-SHA256(<x-webhook-timestamp>.<raw body>, client
 *    secret))`, sent in `x-webhook-signature`.
 *    https://www.cashfree.com/docs/api-reference/payments/latest/webhooks/signature-verification
 *  - PayPal: order id + capture verification against the PayPal API (no HMAC
 *    body signature); implemented in paymentsActions.ts. Webhook authenticity is
 *    checked with the configured `PAYPAL_WEBHOOK_ID` verification call.
 *
 * Nothing here stores card data, and no secret is ever returned to a client.
 */

import { hmacBase64, hmacHex, safeEqual } from "./hmac";

export type ProviderId = "razorpay" | "cashfree" | "paypal" | "test_gateway";

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
};

export type SignatureCheck = { valid: boolean; reason?: string };

export function envValue(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value : undefined;
}

export function providerConfigured(envVars: string[]): boolean {
  return envVars.every((key) => Boolean(envValue(key)));
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
  payload: any,
  headers: Record<string, string>,
): NormalizedWebhook {
  const event = String(payload?.event ?? "unknown");
  const payment = payload?.payload?.payment?.entity;
  const refund = payload?.payload?.refund?.entity;
  const eventId =
    headers["x-razorpay-event-id"] ??
    `${event}:${payment?.id ?? refund?.id ?? payload?.created_at ?? Date.now()}`;
  const status: NormalizedWebhook["status"] = event.startsWith("payment.captured")
    ? "captured"
    : event.startsWith("payment.authorized")
      ? "authorized"
      : event.startsWith("payment.failed")
        ? "failed"
        : event.startsWith("refund")
          ? "refunded"
          : "ignored";
  return {
    eventId,
    eventType: event,
    providerOrderId: payment?.order_id ?? refund?.payment_id,
    providerPaymentId: payment?.id,
    amountMinor: payment?.amount ?? refund?.amount,
    currency: payment?.currency,
    method: payment?.method,
    feeMinor: payment?.fee,
    refundId: refund?.id,
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
  const expected = hmacBase64(secret, `${timestamp}.${rawBody}`);
  return safeEqual(expected, signature.trim())
    ? { valid: true }
    : { valid: false, reason: "Webhook signature mismatch." };
}

export function parseCashfreeWebhook(payload: any): NormalizedWebhook {
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

/* ------------------------------- Test gateway ------------------------------ */

/**
 * The built-in test gateway is NOT a payment provider and moves no money. It is
 * a signed sandbox that lets the full order → session → signed webhook →
 * verification → fulfilment pipeline be exercised before merchant approval.
 * It signs payloads with `TEST_GATEWAY_WEBHOOK_SECRET` using the same
 * HMAC-SHA256 scheme as Razorpay so the verification code path is identical.
 */
export function testGatewaySecret(): string | undefined {
  return envValue("TEST_GATEWAY_WEBHOOK_SECRET");
}

export function signTestGatewayPayload(rawBody: string, secret: string): string {
  return hmacHex(secret, rawBody);
}

export function verifyTestGatewaySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined,
): SignatureCheck {
  if (!secret) {
    return {
      valid: false,
      reason:
        "TEST_GATEWAY_WEBHOOK_SECRET is not configured on the deployment, so the test gateway cannot be used.",
    };
  }
  if (!signature) return { valid: false, reason: "Missing signature header." };
  const expected = hmacHex(secret, rawBody);
  return safeEqual(expected, signature.trim())
    ? { valid: true }
    : { valid: false, reason: "Webhook signature mismatch." };
}

export function parseTestGatewayWebhook(payload: any): NormalizedWebhook {
  const status: NormalizedWebhook["status"] =
    payload?.status === "captured"
      ? "captured"
      : payload?.status === "failed"
        ? "failed"
        : payload?.status === "refunded"
          ? "refunded"
          : "ignored";
  return {
    eventId: String(payload?.eventId ?? ""),
    eventType: String(payload?.eventType ?? `payment.${payload?.status ?? "unknown"}`),
    providerOrderId: payload?.orderId,
    providerPaymentId: payload?.paymentId,
    amountMinor: payload?.amountMinor,
    currency: payload?.currency,
    method: payload?.method ?? "test",
    status,
  };
}
