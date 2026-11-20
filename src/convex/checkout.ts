import { queueFulfilmentForOrder } from "./lib/fulfilment";
import { ConvexError, v } from "convex/values";
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
import { convertMinor } from "./lib/money";
import { buildPricedCart } from "./lib/pricing";
import { getSettings } from "./lib/settings";
import { deliveryEstimate, indiaPin } from "./lib/delivery";
import { guestCheckoutSecret, guestOrderToken } from "./lib/checkoutAccess";
import { checkoutProviderEnabled } from "./lib/paymentMode";
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
  if (address.countryCode.trim().toUpperCase() !== "IN") {
    errors.push("KNOKH ships within India only.");
  } else if (!indiaPin.test(address.postalCode.trim())) {
    errors.push("Enter a valid 6-digit Indian PIN code.");
  }
  if (Object.values(address).some((value) => (value?.length ?? 0) > 254)) {
    errors.push("One or more address fields are too long.");
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
  return args.zone === "domestic" ? [standard] : [];
}

export const estimateDelivery = query({
  args: { pin: v.string() },
  handler: async (ctx, { pin }) => {
    const settings = await getSettings(ctx);
    if (!settings.shippingZones.some((zone) => zone.countryCode === "IN" && zone.serviceable)) {
      return { status: "unconfigured" as const };
    }
    return deliveryEstimate(pin.trim(), Date.now(), process.env.KNOKH_DELIVERY_CONFIG);
  },
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

    const onlineProviders = settings.payments.providers
      .filter((provider) => checkoutProviderEnabled(provider.id, settings))
      .map((provider) => ({ id: provider.id, label: provider.label, status: "configured" as const,
        missingEnvVars: [] as string[], docsUrl: provider.docsUrl }));
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
        (selectedOption?.rateMinor ?? 0) + priced.dutyMinor +
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
        testGateway: null,
      },
      guestCheckoutEnabled: settings.commerce.guestCheckoutEnabled && !!guestCheckoutSecret(),
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
    requestId: v.string(),
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

    if (!/^[a-f0-9-]{36}$/i.test(args.requestId)) throw new ConvexError("Invalid checkout request.");
    const guestSecret = user ? undefined : guestCheckoutSecret();
    if (!user && (!settings.commerce.guestCheckoutEnabled || !guestSecret)) {
      throw new ConvexError("Guest checkout is unavailable. Sign in to continue.");
    }
    const previous = await ctx.db.query("orders").withIndex("by_checkout_request", (q) =>
      q.eq("cartOwnerKey", ownerKey).eq("checkoutRequestId", args.requestId),
    ).unique();
    if (previous) {
      if (guestSecret && (previous.guestAccessExpiresAt ?? 0) <= Date.now()) {
        throw new ConvexError("This checkout request expired.");
      }
      return {
        orderId: previous._id,
        orderNumber: previous.orderNumber,
        totalMinor: previous.totalMinor,
        currency: previous.currency,
        providerId: previous.provider,
        paymentMethod: previous.paymentMethod,
        requiresPayment: previous.paymentMethod === "online",
        guestToken: guestSecret ? guestOrderToken(previous, guestSecret) : undefined,
      };
    }

    const recentOrders = await ctx.db.query("orders").withIndex("by_checkout_owner_time", (q) =>
      q.eq("cartOwnerKey", ownerKey).gte("placedAt", Date.now() - 60 * 60 * 1000),
    ).take(5);
    if (recentOrders.length >= 5) {
      throw new ConvexError("You have placed several orders recently. Please wait or contact support.");
    }

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
    if (!isEmailish(email))
      throw new Error("Enter a valid email address for the order updates.");
    const addressErrors = validateAddress(args.shippingAddress);
    if (addressErrors.length > 0) throw new ConvexError(addressErrors.join(" "));
    if (args.contact.name.length > 254 || (args.notes?.length ?? 0) > 1000 || email.length > 254) {
      throw new ConvexError("One or more checkout fields are too long.");
    }
    const pin = args.shippingAddress.postalCode.trim();
    const delivery = deliveryEstimate(pin, Date.now(), process.env.KNOKH_DELIVERY_CONFIG);
    if (delivery.status !== "available") {
      throw new ConvexError(delivery.status === "unsupported"
        ? "We do not currently deliver to this PIN code."
        : "Delivery estimates are temporarily unavailable. Please contact support.");
    }

    const countryCode = "IN";
    const currency = "INR";
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

    if (args.paymentMethod === "cod") {
      if (!settings.commerce.codEnabled || !zone.codAvailable) {
        throw new Error(
          "Cash on delivery is not available for this destination.",
        );
      }
    }

    const providerId = args.paymentMethod === "online" ? args.providerId : undefined;
    if (args.paymentMethod === "online" && (!providerId || !checkoutProviderEnabled(providerId, settings))) {
      throw new ConvexError("This online payment method is unavailable.");
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

    if (!Number.isSafeInteger(totalMinor) || totalMinor < 0 ||
        (args.paymentMethod === "online" && totalMinor === 0)) {
      throw new ConvexError("The order total could not be verified.");
    }
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
      checkoutRequestId: args.requestId,
      guestAccessExpiresAt: guestSecret ? placedAt + 24 * 60 * 60 * 1000 : undefined,
      shippingAddress: {
        fullName: args.shippingAddress.fullName,
        phone: args.shippingAddress.phone,
        email,
        line1: args.shippingAddress.line1,
        line2: args.shippingAddress.line2,
        city: args.shippingAddress.city,
        state: args.shippingAddress.state,
        postalCode: pin,
        countryCode,
        country: "India",
      },
      shippingMethod: {
        id: shippingOption.id,
        label: shippingOption.label,
        etaDays: shippingOption.etaDays,
        rateMinor: shippingOption.rateMinor,
        estimatedFrom: delivery.earliest,
        estimatedTo: delivery.latest,
      },
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
    if (args.paymentMethod === "online" && providerId) {
      await ctx.db.insert("payments", {
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
      actorEmail: email,
      action: "order.create",
      entity: "orders",
      entityId: String(orderId),
      summary: `Order ${orderNumber} created`,
      metadata: { paymentMethod: args.paymentMethod, totalMinor, currency },
    });

    return {
      orderId,
      orderNumber,
      totalMinor,
      currency,
      providerId,
      paymentMethod: args.paymentMethod,
      requiresPayment: args.paymentMethod === "online",
      guestToken: guestSecret ? guestOrderToken({ _id: orderId, cartOwnerKey: ownerKey }, guestSecret) : undefined,
    };
  },
});
