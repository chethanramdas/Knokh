import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../src/convex/_generated/api";
import { deliveryEstimate } from "../src/convex/lib/delivery";
import { safeReturnTo } from "../src/lib/authRedirect";
import schema from "../src/convex/schema";

const modules = import.meta.glob([
  "../src/convex/**/*.ts",
  "../src/convex/_generated/*.js",
  "!../src/convex/**/*.d.ts",
]);
const config = JSON.stringify({
  originPin: "560001",
  carrier: "Fixture carrier",
  dispatchDays: 1,
  nonWorkingWeekdays: [0, 6],
  holidays: ["2026-11-23"],
  destinations: { "110001": { minDays: 1, maxDays: 2 } },
});
const secret = "checkout-test".repeat(4);
const signature = (text: string) =>
  createHmac("sha256", secret).update(text).digest("hex");
const guestKey = "g".repeat(32);
const contact = {
  name: "Test Shopper",
  email: "guest@example.test",
  phone: "9999999999",
};
const shippingAddress = {
  fullName: contact.name,
  phone: contact.phone,
  line1: "Fixture address",
  city: "Delhi",
  state: "Delhi",
  postalCode: "110001",
  countryCode: "IN",
  country: "India",
};

beforeEach(() => {
  vi.stubEnv("KNOKH_DELIVERY_CONFIG", config);
  vi.stubEnv("KNOKH_GUEST_CHECKOUT_SECRET", secret);
  vi.stubEnv("KNOKH_PAYMENT_MODE", "sandbox");
  vi.stubEnv("SITE_URL", "https://knokh-isolated-test.pages.dev");
  vi.stubEnv(
    "KNOKH_SANDBOX_SITE_ORIGIN",
    "https://knokh-isolated-test.pages.dev",
  );
  vi.stubEnv("CONVEX_SITE_URL", "https://checkout-fixture.convex.site");
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_fixture");
  vi.stubEnv("RAZORPAY_KEY_SECRET", secret);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", secret);
});
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = convexTest(schema, modules);
  const product = await t.run(async (ctx) => {
    await ctx.db.insert("site_settings", {
      key: "global",
      value: {
        payments: {
          providers: [{ id: "razorpay", enabled: true, label: "Razorpay" }],
        },
      },
      updatedAt: Date.now(),
    });
    return ctx.db.insert("products", {
      sku: "CHECKOUT-FIXTURE",
      slug: "checkout-fixture",
      name: "Checkout fixture",
      images: [],
      priceMinor: 50000,
      costMinor: 12000,
      stock: 20,
      currency: "INR",
      status: "published",
      updatedAt: Date.now(),
    });
  });
  await t.mutation(api.cart.addToCart, { guestKey, productId: product });
  const input = {
    contact,
    shippingAddress,
    guestKey,
    requestId: crypto.randomUUID(),
    shippingMethodId: "standard",
    paymentMethod: "online" as const,
    providerId: "razorpay",
  };
  return { t, input };
}

function paymentEvent(event: string, amount: number, currency = "INR") {
  return JSON.stringify({
    event,
    payload: {
      payment: {
        entity: {
          id: "pay_fixture",
          order_id: "order_fixture",
          amount,
          currency,
          status: event.split(".")[1],
          method: "upi",
        },
      },
    },
  });
}

describe("India delivery and safe redirects", () => {
  test("India date calculation skips configured holidays and weekends", () => {
    expect(
      deliveryEstimate("110001", Date.parse("2026-11-20T10:00:00Z"), config),
    ).toEqual({
      status: "available",
      earliest: "2026-11-25",
      latest: "2026-11-26",
    });
    expect(deliveryEstimate("090001", 0, config).status).toBe("invalid");
    expect(deliveryEstimate("560002", 0, config).status).toBe("unsupported");
    expect(deliveryEstimate("560002", 0, undefined).status).toBe(
      "unconfigured",
    );
  });
  test.each([
    "https://other.invalid",
    "//other.invalid",
    "/\\other.invalid",
    "/..//other.invalid",
    "/%5cother.invalid",
  ])("rejects a redirect outside the storefront (%s)", (url) => {
    expect(safeReturnTo(url)).toBe("/account");
  });
  test("preserves a same-site path, query and anchor", () => {
    expect(safeReturnTo("/account/orders?tab=recent#list")).toBe(
      "/account/orders?tab=recent#list",
    );
  });
});

describe("isolated checkout and signed payment lifecycle", () => {
  test("rejects unsupported addresses and key modes before it creates an order", async () => {
    const { t, input } = await fixture();
    await expect(
      t.mutation(api.checkout.placeOrder, {
        ...input,
        shippingAddress: { ...shippingAddress, countryCode: "CA" },
      }),
    ).rejects.toThrow(/India only/);
    await expect(
      t.mutation(api.checkout.placeOrder, {
        ...input,
        shippingAddress: { ...shippingAddress, postalCode: "560002" },
      }),
    ).rejects.toThrow(/do not currently deliver/);
    vi.stubEnv("KNOKH_PAYMENT_MODE", "live");
    await expect(t.mutation(api.checkout.placeOrder, input)).rejects.toThrow(
      /unavailable/,
    );
    vi.stubEnv("KNOKH_PAYMENT_MODE", "sandbox");
    vi.stubEnv(
      "CONVEX_SITE_URL",
      "https://agreeable-caterpillar-156.convex.site",
    );
    await expect(t.mutation(api.checkout.placeOrder, input)).rejects.toThrow(
      /unavailable/,
    );
    expect(await t.run((ctx) => ctx.db.query("orders").collect())).toEqual([]);
  });

  test("deduplicates concurrent checkout and isolates guest order access", async () => {
    const { t, input } = await fixture();
    const [first, second] = await Promise.all([
      t.mutation(api.checkout.placeOrder, input),
      t.mutation(api.checkout.placeOrder, input),
    ]);
    expect(first).toEqual(second);
    expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(
      1,
    );
    const args = { orderId: first.orderId };
    expect(await t.query(api.orders.getOrderForCheckout, args)).toBeNull();
    expect(
      await t.query(api.payments.getPaymentForOrder, {
        ...args,
        guestToken: "wrong",
      }),
    ).toBeNull();
    const detail = await t.query(api.orders.getOrderDetail, {
      ...args,
      guestToken: first.guestToken,
    });
    expect(detail?.order).toMatchObject({
      currency: "INR",
      shippingAddress,
      paymentStatus: "pending",
    });
    expect(detail?.order.shippingMethod.estimatedFrom).toMatch(
      /^\d{4}-\d\d-\d\d$/,
    );
    expect(detail?.order).not.toHaveProperty("cartOwnerKey");

    const adminId = await t.run((ctx) =>
      ctx.db.insert("users", { role: "admin" }),
    );
    const admin = t.withIdentity({
      subject: adminId,
      issuer: "https://qa.invalid",
    });
    await expect(
      admin.mutation(api.admin.updateOrderStatus, {
        orderId: first.orderId,
        paymentStatus: "paid",
      }),
    ).rejects.toThrow(/payment provider/);
    await t.run((ctx) =>
      ctx.db.patch(first.orderId, { guestAccessExpiresAt: Date.now() - 1 }),
    );
    expect(
      await t.query(api.orders.getOrderDetail, {
        ...args,
        guestToken: first.guestToken,
      }),
    ).toBeNull();
  });

  test("verifies capture amount, deduplicates concurrent events and reconciles partial and full refunds", async () => {
    const { t, input } = await fixture();
    const { orderId, guestToken } = await t.mutation(api.checkout.placeOrder, {
      ...input,
      currency: "USD",
    });
    const order = (await t.run((ctx) => ctx.db.get(orderId)))!;
    expect(order.currency).toBe("INR");
    expect(order.totalMinor).toBe(55900);
    const payment = (await t.query(internal.payments.getOrderPayment, {
      orderId,
    }))!;
    const first = await t.mutation(internal.payments.beginGatewaySession, {
      paymentId: payment._id,
    });
    const concurrent = await t.mutation(internal.payments.beginGatewaySession, {
      paymentId: payment._id,
    });
    expect(first.status).toBe("create");
    expect(concurrent.status).toBe("reconcile");
    await t.mutation(internal.payments.attachGatewaySession, {
      paymentId: payment._id,
      providerOrderId: "order_fixture",
    });
    const callback = await t.mutation(api.payments.confirmCheckoutResult, {
      orderId,
      guestToken,
      providerOrderId: "order_fixture",
      providerPaymentId: "pay_fixture",
      signature: signature("order_fixture|pay_fixture"),
    });
    expect(callback.status).toBe("pending");

    async function webhook(id: string, body: string, digest = signature(body)) {
      return t.mutation(internal.payments.processWebhookEvent, {
        provider: "razorpay",
        rawBody: body,
        headers: {
          "x-razorpay-event-id": id,
          "x-razorpay-signature": digest,
        },
      });
    }
    const status = async () =>
      (await t.run((ctx) => ctx.db.get(orderId)))?.paymentStatus;
    const capture = paymentEvent("payment.captured", order.totalMinor);
    expect((await webhook("bad-signature", capture, "invalid")).ok).toBe(false);
    await webhook(
      "wrong-currency",
      paymentEvent("payment.captured", order.totalMinor, "USD"),
    );
    await webhook(
      "wrong-amount",
      paymentEvent("payment.captured", order.totalMinor - 1),
    );
    expect(await status()).toBe("pending");
    const rawRequest = await t.fetch("/payments/webhook/razorpay", {
      method: "POST",
      body: " " + capture,
      headers: {
        "x-razorpay-event-id": "raw-byte-check",
        "x-razorpay-signature": signature(capture),
      },
    });
    expect(rawRequest.status).toBe(400);
    const results = await Promise.all([
      webhook("capture", capture),
      webhook("capture", capture),
    ]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    const acceptedReplay = await t.fetch("/payments/webhook/razorpay", {
      method: "POST",
      body: capture,
      headers: {
        "x-razorpay-event-id": "capture",
        "x-razorpay-signature": signature(capture),
      },
    });
    expect(acceptedReplay.status).toBe(200);
    expect(await acceptedReplay.json()).toMatchObject({ duplicate: true });
    await webhook(
      "late-failure",
      paymentEvent("payment.failed", order.totalMinor),
    );
    expect(await status()).toBe("paid");

    const refund = (id: string, amount: number) =>
      JSON.stringify({
        event: "refund.processed",
        payload: {
          refund: {
            entity: {
              id,
              payment_id: "pay_fixture",
              currency: "INR",
              amount,
              status: "processed",
            },
          },
        },
      });
    await webhook("refund-one", refund("rfnd_first", 500));
    await webhook("refund-duplicate", refund("rfnd_first", 500));
    expect(await status()).toBe("partially_refunded");
    await webhook("refund-over-limit", refund("rfnd_over", order.totalMinor));
    expect(await status()).toBe("partially_refunded");
    await webhook("refund-rest", refund("rfnd_rest", order.totalMinor - 500));
    await webhook("late-capture", capture);
    expect(await status()).toBe("refunded");
    const refunds = await t.run((ctx) => ctx.db.query("refunds").collect());
    expect(refunds).toHaveLength(2);
    expect(refunds.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(
      order.totalMinor,
    );
    const logs = await t.run((ctx) => ctx.db.query("payment_events").collect());
    expect(logs.every((entry) => entry.payloadJson === "{}")).toBe(true);
  });
});
