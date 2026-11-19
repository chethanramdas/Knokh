import { createHmac } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";
import { safeReturnTo } from "../src/lib/authRedirect";
import { trustedGoogleEmail } from "../src/convex/auth/google";
import { estimateDelivery } from "../src/convex/lib/delivery";
import { verifyCashfreeSignature } from "../src/convex/lib/gateways";
import { hashOrderToken } from "../src/convex/lib/orderAccess";
import { validateAddress } from "../src/convex/checkout";

const modules = import.meta.glob([
  "../src/convex/**/*.ts",
  "../src/convex/_generated/*.js",
  "!../src/convex/**/*.d.ts",
]);

const address = {
  fullName: "Fixture Customer",
  phone: "9999999999",
  line1: "Fixture address",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
  countryCode: "IN",
  country: "India",
};

afterEach(() => vi.unstubAllEnvs());

test("OAuth destination stays on the storefront and verified Google identities are required", () => {
  expect(safeReturnTo("/checkout?ship=standard#summary")).toBe("/checkout?ship=standard#summary");
  for (const url of ["//outside.invalid", "/\\outside.invalid", "/a/..//outside.invalid", "https://outside.invalid"]) {
    expect(safeReturnTo(url)).toBe("/account");
  }
  expect(trustedGoogleEmail({ email: "CUSTOMER@gmail.com", email_verified: true })).toBe("customer@gmail.com");
  expect(trustedGoogleEmail({ email: "customer@domain.test", email_verified: true, hd: "domain.test" })).toBe("customer@domain.test");
  expect(trustedGoogleEmail({ email: "customer@domain.test", email_verified: true })).toBeNull();
  expect(trustedGoogleEmail({ email: "customer@gmail.com", email_verified: false })).toBeNull();
});

test("Indian PIN ranges follow India time, working days and configured serviceability", () => {
  const plan = JSON.stringify({
    originPin: "110001",
    dispatchDays: 1,
    holidays: ["2026-11-23"],
    lanes: { "560001": { standard: { minDays: 1, maxDays: 3 } } },
  });
  const friday = Date.parse("2026-11-20T10:00:00Z");
  expect(estimateDelivery(plan, "560001", "standard", friday)).toEqual({
    status: "available",
    range: { earliest: "2026-11-25", latest: "2026-11-27" },
  });
  expect(estimateDelivery(plan, "560001", "express", friday)).toEqual({ status: "unsupported" });
  expect(estimateDelivery(plan, "000001", "standard", friday)).toEqual({ status: "invalid" });
  expect(estimateDelivery(undefined, "560001", "standard", friday)).toEqual({ status: "unconfigured" });
  expect(validateAddress(address)).toEqual([]);
  expect(validateAddress({ ...address, countryCode: "US" })).toContain("KNOKH delivers within India.");
});

test("Cashfree verification uses the unchanged timestamp followed by the raw body", () => {
  const timestamp = "1234567890000";
  const body = '{"amount": 10.00}';
  const signature = createHmac("sha256", "fixture").update(timestamp + body).digest("base64");
  expect(verifyCashfreeSignature(body, signature, timestamp, "fixture").valid).toBe(true);
  expect(verifyCashfreeSignature('{"amount":10}', signature, timestamp, "fixture").valid).toBe(false);
});

async function fixture() {
  const t = convexTest(schema, modules);
  const guestToken = crypto.randomUUID();
  const { orderId, paymentId } = await t.run(async (ctx) => {
    const orderId = await ctx.db.insert("orders", {
      orderNumber: "PAYMENT-TEST",
      customerName: address.fullName,
      currency: "INR",
      baseCurrency: "INR",
      exchangeRate: 1,
      subtotalMinor: 10000,
      discountMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      dutyMinor: 0,
      totalMinor: 10000,
      totalBaseMinor: 10000,
      costTotalMinor: 2000,
      cartOwnerKey: "fixture",
      guestEmail: "fixture@example.test",
      guestAccessHash: hashOrderToken(guestToken),
      guestAccessExpiresAt: Date.now() + 60000,
      shippingAddress: address,
      shippingMethod: { id: "standard", label: "Standard", etaDays: 5, rateMinor: 0 },
      paymentMethod: "online",
      provider: "razorpay",
      paymentStatus: "pending",
      fulfilmentStatus: "pending",
      placedAt: 1,
      updatedAt: 1,
    });
    const paymentId = await ctx.db.insert("payments", {
      orderId, provider: "razorpay", providerOrderId: "order_Fixture",
      amountMinor: 10000, currency: "INR", baseAmountMinor: 10000,
      status: "pending", createdAt: 1, updatedAt: 1,
    });
    return { orderId, paymentId };
  });
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "webhook-fixture");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "key-fixture");

  const deliver = (eventId: string, event: string, amount = 10000, refundId?: string) => {
    const rawBody = JSON.stringify({
      event,
      payload: refundId ? {
        refund: { entity: { id: refundId, payment_id: "pay_Fixture", status: "processed", amount, currency: "INR" } },
      } : {
        payment: { entity: {
          id: "pay_Fixture", order_id: "order_Fixture", status: event.slice(8),
          captured: event === "payment.captured", amount, currency: "INR",
        } },
      },
    });
    return t.mutation(internal.payments.processWebhookEvent, {
      provider: "razorpay", rawBody,
      headers: {
        "x-razorpay-event-id": eventId,
        "x-razorpay-signature": createHmac("sha256", "webhook-fixture").update(rawBody).digest("hex"),
      },
    });
  };
  return { t, orderId, paymentId, guestToken, deliver };
}

describe("guest payment and fulfilment", () => {
  test("order IDs and customer email cannot unlock guest order details", async () => {
    const { t, orderId, guestToken } = await fixture();
    expect(await t.query(api.orders.getOrderForCheckout, { orderId })).toBeNull();
    expect(await t.query(api.orders.getOrderDetail, { orderId, email: "fixture@example.test" })).toBeNull();
    expect(await t.query(api.payments.getPaymentForOrder, { orderId, guestToken: crypto.randomUUID() })).toBeNull();
    expect(await t.query(api.orders.getOrderDetail, { orderId, guestToken })).not.toBeNull();
    await t.run((ctx) => ctx.db.patch(orderId, { guestAccessExpiresAt: 1 }));
    expect(await t.query(api.orders.getOrderDetail, { orderId, guestToken })).toBeNull();
  });

  test("callback stays pending, signed mismatched capture is ignored and concurrent replays settle once", async () => {
    const { t, orderId, guestToken, deliver } = await fixture();
    const callback = {
      orderId, providerOrderId: "order_Fixture", providerPaymentId: "pay_Fixture",
      signature: createHmac("sha256", "key-fixture").update("order_Fixture|pay_Fixture").digest("hex"),
    };
    await expect(t.mutation(api.payments.confirmCheckoutResult, callback)).rejects.toThrow("Order not found");
    await expect(t.mutation(api.payments.confirmCheckoutResult, { ...callback, guestToken })).resolves.toMatchObject({ status: "pending" });
    await deliver("mismatch", "payment.captured", 1);
    expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({ paymentStatus: "pending" });

    const deliveries = await Promise.all([
      deliver("capture", "payment.captured"), deliver("capture", "payment.captured"),
    ]);
    expect(deliveries.filter((event) => event.duplicate)).toHaveLength(1);
    await deliver("stale", "payment.failed");
    expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({ paymentStatus: "paid" });
    const records = await t.run((ctx) => ctx.db.query("analytics_events").collect());
    expect(records).toHaveLength(1);
  });

  test("confirmed partial refunds add up exactly once and cannot exceed capture", async () => {
    const { t, orderId, paymentId, deliver } = await fixture();
    await deliver("capture", "payment.captured");
    await deliver("part", "refund.processed", 3000, "rfnd_First");
    await deliver("part-retry", "refund.processed", 3000, "rfnd_First");
    await deliver("excess", "refund.processed", 8000, "rfnd_Excess");
    expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({ paymentStatus: "partially_refunded" });
    await deliver("rest", "refund.processed", 7000, "rfnd_Rest");
    await deliver("late-capture", "payment.captured");
    expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({ paymentStatus: "refunded" });
    expect(await t.run((ctx) => ctx.db.get(paymentId))).toMatchObject({ status: "refunded" });
    const refunds = await t.run((ctx) => ctx.db.query("refunds").collect());
    expect(refunds.map((refund) => refund.amountMinor)).toEqual([3000, 7000]);
  });
});

test("one concurrent payment-session call may reserve a new external gateway order", async () => {
  const { t, paymentId } = await fixture();
  await t.run((ctx) => ctx.db.patch(paymentId, { providerOrderId: undefined }));
  const reserve = () => t.mutation(internal.payments.reserveGatewaySession, { paymentId });
  const result = await Promise.allSettled([reserve(), reserve()]);
  expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  await t.mutation(internal.payments.attachGatewaySession, { paymentId, providerOrderId: "order_Fixture" });
  await expect(reserve()).resolves.toBe("order_Fixture");
});

test("guest checkout rejects non-Indian destinations and consumes the cart only once", async () => {
  const t = convexTest(schema, modules);
  const productId = await t.run((ctx) => ctx.db.insert("products", {
    sku: "SHIPPING-TEST", slug: "shipping-test", name: "Shipping fixture",
    priceMinor: 10000, costMinor: 1000, currency: "INR", stock: 3, images: [],
    status: "published", updatedAt: Date.now(),
  }));
  const guestKey = crypto.randomUUID();
  await t.mutation(api.cart.addToCart, { guestKey, productId, quantity: 1 });
  const args = {
    guestKey, currency: "INR",
    contact: { name: address.fullName, email: "fixture@example.test", phone: address.phone },
    shippingAddress: address, shippingMethodId: "standard", paymentMethod: "cod" as const,
  };
  await expect(t.mutation(api.checkout.placeOrder, {
    ...args, shippingAddress: { ...address, countryCode: "US", country: "United States" },
  })).rejects.toThrow("KNOKH delivers within India");
  const attempts = await Promise.allSettled([
    t.mutation(api.checkout.placeOrder, args), t.mutation(api.checkout.placeOrder, args),
  ]);
  const successful = attempts.filter((item) => item.status === "fulfilled");
  expect(successful).toHaveLength(1);
  const { orderId, guestToken } = successful[0].value;
  expect(guestToken).toBeTruthy();
  expect(await t.query(api.orders.getOrderDetail, { orderId, guestToken })).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get(productId))).toMatchObject({ stock: 2 });
});
