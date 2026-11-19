import { queueFulfilmentForOrder } from "./lib/fulfilment";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { consumeCart } from "./cart";
import {
  getUser,
  notifyAdmins,
  notifyUser,
  resolveOwnerKey,
  writeAuditLog,
} from "./lib/auth";
import { estimateDelivery, indianPin } from "./lib/delivery";
import { hashOrderToken } from "./lib/orderAccess";
import { convertMinor } from "./lib/money";
import { buildPricedCart } from "./lib/pricing";
import { getSettings } from "./lib/settings";
import { providerAllowed, testGatewayAllowed } from "./lib/paymentMode";
import { generateOrderNumber, isEmailish } from "./lib/util";

const addressValidator = v.object({
  fullName: v.string(),
  phone: v.string(),
  email: v.optional(v.string()),
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  postalCode: v.string(),
  countryCode: v.string(),
  country: v.string(),
});

export type AddressInput = {
  fullName: string;
  phone: string;
  email?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  country: string;
};

export function validateAddress(address: AddressInput): string[] {
  const errors: string[] = [];
  if (address.fullName.trim().length < 2)
    errors.push("Enter the recipient's full name.");
  if (address.phone.replace(/\D/g, "").length < 7) {
    errors.push("Enter a reachable phone number with country code.");
  }
  if (address.line1.trim().length < 3) errors.push("Enter the street address.");
  if (address.city.trim().length < 2) errors.push("Enter the city or town.");
  if (address.state.trim().length < 2)
    errors.push("Enter the state or region.");
  const postal = address.postalCode.trim();
  if (address.countryCode.trim().toUpperCase() !== "IN") {
    errors.push("KNOKH delivers within India.");
  }
  if (!indianPin.test(postal)) {
    errors.push("Enter a valid 6-digit Indian PIN code.");
  }
  const maxLengths = { fullName: 120, phone: 32, email: 254, line1: 160, line2: 160, city: 100, state: 100 };
  for (const [field, limit] of Object.entries(maxLengths)) {
    if ((address[field as keyof AddressInput]?.length ?? 0) > limit) {
      errors.push("An address field exceeds its maximum length.");
      break;
    }
  }
  return errors;
}

export type ShippingOption = {
  id: string;
  label: string;
  etaDays: number;
  rateMinor: number;
};

/** Shipping options are recomputed on the server for every cart total. */
export function shippingOptionsFor(args: {
  rateMinor: number;
  etaDays: number;
  zone: string;
  freeQualified: boolean;
}): ShippingOption[] {
  const standard: ShippingOption = {
    id: "standard",
    label:
      args.zone === "domestic" ? "Standard delivery" : "International standard",
    etaDays: args.etaDays,
    rateMinor: args.freeQualified ? 0 : args.rateMinor,
  };
  if (args.zone !== "domestic") return [standard];
  return [
    standard,
    {
      id: "express",
      label: "Express delivery",
      etaDays: Math.max(1, args.etaDays - 2),
      rateMinor: Math.round(args.rateMinor * 2.2),
    },
  ];
}

export const deliveryEstimate = query({
  args: {
    pin: v.string(),
    method: v.union(v.literal("standard"), v.literal("express")),
  },
  handler: (_ctx, { pin, method }) => estimateDelivery(process.env.KNOKH_DELIVERY_PLAN, pin.trim(), method, Date.now()),
});

export const getCheckoutQuote = query({
  args: {
    guestKey: v.optional(v.string()),
    currency: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    shippingMethodId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user && !args.guestKey) return null;
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const settings = await getSettings(ctx);
    const cart = await ctx.db
      .query("carts")
      .withIndex("by_owner", (q) =>
        q.eq("ownerKey", ownerKey).eq("status", "active"),
      )
      .unique();
    if (!cart) return null;
    const items = await ctx.db
      .query("cart_items")
      .withIndex("by_cart", (q) => q.eq("cartId", cart._id))
      .take(100);

    const countryCode = "IN";
    const currency = "INR";
    const priced = await buildPricedCart(ctx, {
      items,
      settings,
      currency,
      countryCode,
      couponCode: cart.couponCode,
      userId: user?._id,
      email: user?.email,
    });

    const zone = priced.shippingZone;
    const freeQualified =
      !!zone &&
      zone.freeAboveMinor > 0 &&
      priced.subtotalBaseMinor >= zone.freeAboveMinor;
    const options = zone
      ? shippingOptionsFor({
          rateMinor: convertMinor(
            zone.rateMinor,
            settings.commerce.baseCurrency,
            currency,
            settings,
          ),
          etaDays: zone.etaDays,
          zone: zone.zone,
          freeQualified,
        })
      : [];
    const selectedOption =
      options.find((option) => option.id === args.shippingMethodId) ??
      options[0] ??
      null;

    // Provider eligibility is derived from configuration status + destination.
    const onlineProviders = settings.payments.providers
      .filter(providerAllowed)
      .sort((a, b) => Number(b.id === "razorpay") - Number(a.id === "razorpay"))
      .filter((provider) => provider.countries.includes(countryCode))
      .filter((provider) => provider.currencies.includes(currency))
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
        status: "configured" as const,
        docsUrl: provider.docsUrl,
      }));

    return {
      currency,
      countryCode,
      lines: priced.lines,
      itemCount: priced.itemCount,
      subtotalMinor: priced.subtotalMinor,
      discountMinor: priced.discountMinor,
      shippingMinor: selectedOption?.rateMinor ?? 0,
      shippingOptions: options,
      selectedShippingOptionId: selectedOption?.id ?? null,
      taxMinor: priced.taxMinor,
      taxLabel: priced.taxLabel,
      taxInclusive: priced.taxInclusive,
      dutyMinor: priced.dutyMinor,
      totalMinor:
        (selectedOption?.rateMinor ?? 0) +
        (priced.taxInclusive
          ? priced.subtotalMinor - priced.discountMinor
          : priced.subtotalMinor - priced.discountMinor + priced.taxMinor),
      coupon: priced.coupon,
      blockers: priced.blockers,
      zone,
      paymentOptions: {
        online: onlineProviders,
        cod:
          settings.commerce.codEnabled && zone?.codAvailable
            ? { id: "cod", label: "Cash on delivery" }
            : null,
        testGateway: testGatewayAllowed(settings)
          ? {
              id: "test_gateway",
              label: "Test gateway (sandbox, no real money)",
            }
          : null,
      },
      guestCheckoutEnabled: settings.commerce.guestCheckoutEnabled,
      viewerEmail: user?.email ?? null,
    };
  },
});

/**
 * Creates the order. Every money value is computed server-side from the cart;
 * the browser cannot influence a single total. Stock is reserved in the same
 * transaction so two shoppers can never buy the same last unit.
 */
export const placeOrder = mutation({
  args: {
    guestKey: v.optional(v.string()),
    currency: v.optional(v.string()),
    contact: v.object({
      name: v.string(),
      email: v.string(),
      phone: v.string(),
    }),
    shippingAddress: addressValidator,
    shippingMethodId: v.string(),
    paymentMethod: v.union(v.literal("online"), v.literal("cod")),
    providerId: v.optional(v.string()),
    notes: v.optional(v.string()),
    marketingConsent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const settings = await getSettings(ctx);

    const cart = await ctx.db
      .query("carts")
      .withIndex("by_owner", (q) =>
        q.eq("ownerKey", ownerKey).eq("status", "active"),
      )
      .unique();
    if (!cart) throw new Error("Your cart is empty.");

    const items = await ctx.db
      .query("cart_items")
      .withIndex("by_cart", (q) => q.eq("cartId", cart._id))
      .take(100);
    if (items.length === 0) throw new Error("Your cart is empty.");

    const email = args.contact.email.trim().toLowerCase();
    if (email.length > 254 || !isEmailish(email))
      throw new Error("Enter a valid email address for the order updates.");
    if (!user && !settings.commerce.guestCheckoutEnabled) {
      throw new Error(
        "Guest checkout is disabled. Please sign in to continue.",
      );
    }
    const addressErrors = validateAddress(args.shippingAddress);
    if (addressErrors.length > 0) throw new Error(addressErrors.join(" "));

    const countryCode = "IN";
    const currency = "INR";
    if (args.currency && args.currency !== currency) throw new Error("Checkout is available in INR.");
    if (args.contact.name.length > 120 || (args.notes?.length ?? 0) > 1000) {
      throw new Error("Check the length of your contact details and notes.");
    }
    const priced = await buildPricedCart(ctx, {
      items,
      settings,
      currency,
      countryCode,
      couponCode: cart.couponCode,
      userId: user?._id,
      email,
    });
    if (priced.lines.length === 0) throw new Error("Your cart is empty.");
    if (priced.blockers.length > 0) throw new Error(priced.blockers.join(" "));

    const zone = priced.shippingZone;
    if (!zone || !zone.serviceable) {
      throw new Error(
        `We cannot ship to ${args.shippingAddress.country} yet. Choose another destination or contact support.`,
      );
    }

    const freeQualified =
      zone.freeAboveMinor > 0 &&
      priced.subtotalBaseMinor >= zone.freeAboveMinor;
    const options = shippingOptionsFor({
      rateMinor: convertMinor(
        zone.rateMinor,
        settings.commerce.baseCurrency,
        currency,
        settings,
      ),
      etaDays: zone.etaDays,
      zone: zone.zone,
      freeQualified,
    });
    const shippingOption =
      options.find((option) => option.id === args.shippingMethodId);
    if (!shippingOption) throw new Error("Choose a shipping method.");

    const delivery = estimateDelivery(
      process.env.KNOKH_DELIVERY_PLAN, args.shippingAddress.postalCode.trim(), shippingOption.id, Date.now(),
    );
    if (delivery.status === "unsupported") throw new Error("This delivery option is unavailable for the PIN code.");
    if (process.env.KNOKH_DELIVERY_PLAN && delivery.status !== "available") {
      throw new Error("Delivery could not be verified for this PIN code. Contact support.");
    }

    if (args.paymentMethod === "cod") {
      if (!settings.commerce.codEnabled || !zone.codAvailable) {
        throw new Error(
          "Cash on delivery is not available for this destination.",
        );
      }
    }

    let providerId: string | undefined;
    if (args.paymentMethod === "online") {
      providerId = args.providerId;
      const isTestGateway =
        providerId === "test_gateway" && testGatewayAllowed(settings);
      const provider = settings.payments.providers.find(
        (entry) => entry.id === providerId,
      );
      if (!isTestGateway) {
        if (!provider) throw new Error("Choose a payment method.");
        if (!providerAllowed(provider)) throw new Error("This payment method is unavailable.");
        if (!provider.countries.includes(countryCode)) {
          throw new Error(
            `${provider.label} cannot process payments for ${countryCode}.`,
          );
        }
        if (!provider.currencies.includes(currency)) {
          throw new Error(
            `${provider.label} does not support ${currency} payments.`,
          );
        }

      }
    }

    // ---- Stock reservation (atomic with order creation) ----
    for (const line of priced.lines) {
      const product = await ctx.db.get(line.productId);
      if (!product)
        throw new Error("An item in your cart is no longer available.");

      if (line.variantSku) {
        const variants = [...(product.variants ?? [])];
        const index = variants.findIndex(
          (entry) => entry.sku === line.variantSku,
        );
        if (index < 0)
          throw new Error(`${line.name}: the selected variant is gone.`);
        if (variants[index].stock < line.quantity) {
          throw new Error(
            `${line.name}: only ${variants[index].stock} left in stock.`,
          );
        }
        variants[index] = {
          ...variants[index],
          stock: variants[index].stock - line.quantity,
        };
        await ctx.db.patch(product._id, { variants, updatedAt: Date.now() });
      } else {
        if (product.stock < line.quantity) {
          throw new Error(`${line.name}: only ${product.stock} left in stock.`);
        }
        await ctx.db.patch(product._id, {
          stock: product.stock - line.quantity,
          updatedAt: Date.now(),
        });
      }
      await ctx.db.insert("inventory_movements", {
        productId: product._id,
        variantSku: line.variantSku,
        delta: -line.quantity,
        reason: "order",
        note: "Reserved at checkout",
        createdAt: Date.now(),
      });
    }

    const taxMinor = priced.taxMinor;
    const totalMinor = priced.taxInclusive
      ? priced.subtotalMinor -
        priced.discountMinor +
        shippingOption.rateMinor +
        priced.dutyMinor
      : priced.subtotalMinor -
        priced.discountMinor +
        taxMinor +
        shippingOption.rateMinor +
        priced.dutyMinor;

    if (!Number.isSafeInteger(totalMinor) || totalMinor < 0 || (args.paymentMethod === "online" && totalMinor === 0)) {
      throw new Error("The order total is unavailable. Contact support.");
    }
    const guestToken = user ? undefined : crypto.randomUUID();
    const orderNumber = generateOrderNumber();
    const placedAt = Date.now();
    const orderId = await ctx.db.insert("orders", {
      orderNumber,
      userId: user?._id,
      guestEmail: user ? undefined : email,
      customerName: args.contact.name.trim() || args.shippingAddress.fullName,
      currency,
      baseCurrency: settings.commerce.baseCurrency,
      exchangeRate: 1,
      subtotalMinor: priced.subtotalMinor,
      discountMinor: priced.discountMinor,
      shippingMinor: shippingOption.rateMinor,
      taxMinor,
      dutyMinor: priced.dutyMinor,
      totalMinor,
      totalBaseMinor: convertMinor(
        totalMinor,
        currency,
        settings.commerce.baseCurrency,
        settings,
      ),
      costTotalMinor: priced.costTotalBaseMinor,
      couponCode: priced.coupon.valid ? priced.coupon.code : undefined,
      cartOwnerKey: ownerKey,
      guestAccessHash: guestToken ? hashOrderToken(guestToken) : undefined,
      guestAccessExpiresAt: guestToken ? placedAt + 7 * 24 * 60 * 60 * 1000 : undefined,
      shippingAddress: {
        fullName: args.shippingAddress.fullName,
        phone: args.shippingAddress.phone,
        email,
        line1: args.shippingAddress.line1,
        line2: args.shippingAddress.line2,
        city: args.shippingAddress.city,
        state: args.shippingAddress.state,
        postalCode: args.shippingAddress.postalCode.trim(),
        countryCode,
        country: "India",
      },
      shippingMethod: {
        id: shippingOption.id,
        label: shippingOption.label,
        etaDays: shippingOption.etaDays,
        rateMinor: shippingOption.rateMinor,
      },
      deliveryRange: delivery.status === "available" ? delivery.range : undefined,
      paymentMethod: args.paymentMethod,
      provider: args.paymentMethod === "online" ? providerId : undefined,
      paymentStatus: args.paymentMethod === "cod" ? "cod_pending" : "pending",
      fulfilmentStatus: "pending",
      notes: args.notes,
      placedAt,
      updatedAt: placedAt,
    });

    for (const line of priced.lines) {
      await ctx.db.insert("order_items", {
        orderId,
        productId: line.productId,
        name: line.name,
        sku: line.sku,
        variantSku: line.variantSku,
        variantName: line.variantName,
        image: line.image,
        unitPriceMinor: line.unitPriceMinor,
        unitCostMinor: line.unitCostMinor,
        quantity: line.quantity,
        lineTotalMinor: line.lineTotalMinor,
        supplierId: line.supplierId,
        supplierSku: line.supplierSku,
        supplierProductId: line.supplierProductId,
        fulfilmentStatus: "pending",
      });
    }

    // Sales counters, aggregated per product so a product ordered twice in one
    // order is only patched once.
    const unitsByProduct = new Map<string, number>();
    for (const line of priced.lines) {
      const key = String(line.productId);
      unitsByProduct.set(key, (unitsByProduct.get(key) ?? 0) + line.quantity);
    }
    for (const [productId, quantity] of unitsByProduct) {
      const product = await ctx.db.get(productId as Id<"products">);
      if (!product) continue;
      await ctx.db.patch(product._id, {
        unitsSold: (product.unitsSold ?? 0) + quantity,
      });
    }

    // Coupon redemption bookkeeping.
    if (priced.coupon.valid && priced.coupon.code) {
      const coupon = await ctx.db
        .query("coupons")
        .withIndex("by_code", (q) => q.eq("code", priced.coupon.code!))
        .unique();
      if (coupon) {
        await ctx.db.insert("coupon_redemptions", {
          couponId: coupon._id,
          code: coupon.code,
          userId: user?._id,
          email,
          orderId,
          discountMinor: priced.discountMinor,
          redeemedAt: Date.now(),
        });
        await ctx.db.patch(coupon._id, { usedCount: coupon.usedCount + 1 });
      }
    }

    // Payment record (no card data is ever stored).
    let paymentId: Id<"payments"> | undefined;
    if (args.paymentMethod === "online" && providerId) {
      paymentId = await ctx.db.insert("payments", {
        orderId,
        provider: providerId,
        amountMinor: totalMinor,
        currency,
        baseAmountMinor: convertMinor(
          totalMinor,
          currency,
          settings.commerce.baseCurrency,
          settings,
        ),
        status: "created",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    if (args.paymentMethod === "cod") {
      const createdOrder = await ctx.db.get(orderId);
      if (createdOrder) await queueFulfilmentForOrder(ctx, createdOrder);
    }
    await consumeCart(ctx, cart);

    if (args.marketingConsent && user) {
      await ctx.db.patch(user._id, { marketingConsent: true });
    }

    if (user) {
      await notifyUser(ctx, {
        userId: user._id,
        type: "order_placed",
        title: `Order ${orderNumber} received`,
        body:
          args.paymentMethod === "cod"
            ? "We will confirm your cash-on-delivery order shortly."
            : "We are waiting for the payment to be confirmed by the gateway.",
        link: `/account/orders`,
        orderId,
      });
    }

    await notifyAdmins(ctx, {
      type: "new_order",
      title: `New order ${orderNumber}`,
      body: `${args.contact.name} · ${currency} ${(totalMinor / 100).toFixed(2)} · ${args.paymentMethod === "cod" ? "COD" : `online (${providerId})`}`,
      link: `/admin/orders/${orderId}`,
    });

    await writeAuditLog(ctx, {
      actorId: user?._id,
      action: "order.create",
      entity: "orders",
      entityId: String(orderId),
      summary: `Order ${orderNumber} created`,
      metadata: { paymentMethod: args.paymentMethod, totalMinor, currency },
    });

    return {
      orderId,
      guestToken,
      orderNumber,
      totalMinor,
      currency,
      paymentId,
      providerId,
      paymentMethod: args.paymentMethod,
      requiresPayment: args.paymentMethod === "online",
    };
  },
});
