import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { SiteSettings } from "./config";
import { convertMinor, taxOnMinor } from "./money";

/**
 * Single source of truth for cart / checkout arithmetic.
 *
 * BOTH the cart screen and the order-creation mutation call this, so the amount
 * the customer sees is always the amount the server charges. The browser never
 * sends prices, discounts, taxes or totals — it only sends product ids,
 * variant SKUs and quantities.
 */

export type PricedLine = {
  cartItemId: Id<"cart_items">;
  productId: Id<"products">;
  slug: string;
  name: string;
  sku: string;
  variantSku?: string;
  variantName?: string;
  image?: string;
  quantity: number;
  unitPriceMinor: number;
  unitPriceBaseMinor: number;
  unitCostMinor: number;
  lineTotalMinor: number;
  lineTotalBaseMinor: number;
  available: boolean;
  availableStock: number;
  issue?: string;
  categoryId?: Id<"categories">;
  supplierId?: Id<"suppliers">;
  supplierSku?: string;
  supplierProductId?: string;
  deliveryEstimateDays: number;
};

export type PricedCart = {
  currency: string;
  lines: PricedLine[];
  itemCount: number;
  subtotalMinor: number;
  subtotalBaseMinor: number;
  discountMinor: number;
  shippingMinor: number;
  shippingBaseMinor: number;
  taxMinor: number;
  taxLabel: string;
  taxInclusive: boolean;
  dutyMinor: number;
  totalMinor: number;
  totalBaseMinor: number;
  costTotalBaseMinor: number;
  freeShippingThresholdBaseMinor: number;
  missingForFreeShippingBaseMinor: number;
  coupon: {
    code?: string;
    discountMinor: number;
    valid: boolean;
    message?: string;
  };
  shippingZone: SiteSettings["shippingZones"][number] | null;
  blockers: string[];
};

export type CouponEvaluation = {
  valid: boolean;
  message?: string;
  coupon?: Doc<"coupons">;
  discountBaseMinor: number;
};

export async function evaluateCoupon(
  ctx: QueryCtx | MutationCtx,
  args: {
    code: string;
    subtotalBaseMinor: number;
    settings: SiteSettings;
    categoryIds: Id<"categories">[];
    userId?: Id<"users">;
    email?: string;
    shippingBaseMinor: number;
  },
): Promise<CouponEvaluation> {
  const normalized = args.code.trim().toUpperCase();
  if (!normalized) return { valid: false, discountBaseMinor: 0 };
  const coupon = await ctx.db
    .query("coupons")
    .withIndex("by_code", (q) => q.eq("code", normalized))
    .unique();
  if (!coupon) {
    return { valid: false, message: "That coupon code was not found.", discountBaseMinor: 0 };
  }
  const now = Date.now();
  if (coupon.status !== "active") {
    return { valid: false, coupon, message: "This coupon is no longer active.", discountBaseMinor: 0 };
  }
  if (coupon.startsAt && coupon.startsAt > now) {
    return { valid: false, coupon, message: "This coupon is not active yet.", discountBaseMinor: 0 };
  }
  if (coupon.endsAt && coupon.endsAt < now) {
    return { valid: false, coupon, message: "This coupon has expired.", discountBaseMinor: 0 };
  }
  if (coupon.usageLimit !== undefined && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, coupon, message: "This coupon has reached its usage limit.", discountBaseMinor: 0 };
  }
  if (args.subtotalBaseMinor < coupon.minOrderMinor) {
    return {
      valid: false,
      coupon,
      message: `Minimum order value for this coupon is ${(coupon.minOrderMinor / 100).toFixed(2)} ${coupon.currency}.`,
      discountBaseMinor: 0,
    };
  }
  if (coupon.perUserLimit && coupon.perUserLimit > 0) {
    const key = args.userId ? { userId: args.userId } : { email: args.email ?? "" };
    const redemptions = await ctx.db
      .query("coupon_redemptions")
      .withIndex("by_coupon", (q) => q.eq("couponId", coupon._id))
      .take(500);
    const used = redemptions.filter((redemption) =>
      args.userId
        ? redemption.userId === key.userId
        : redemption.email === key.email,
    ).length;
    if (used >= coupon.perUserLimit) {
      return {
        valid: false,
        coupon,
        message: "You have already used this coupon the maximum number of times.",
        discountBaseMinor: 0,
      };
    }
  }

  let eligibleBase = args.subtotalBaseMinor;
  if (coupon.appliesToCategoryIds && coupon.appliesToCategoryIds.length > 0) {
    const allowed = new Set(coupon.appliesToCategoryIds.map(String));
    eligibleBase = args.categoryIds.some((id) => allowed.has(String(id)))
      ? args.subtotalBaseMinor
      : 0;
    if (eligibleBase === 0) {
      return {
        valid: false,
        coupon,
        message: "This coupon does not apply to the items in your cart.",
        discountBaseMinor: 0,
      };
    }
  }

  let discountBaseMinor = 0;
  if (coupon.type === "percent") {
    discountBaseMinor = Math.round((eligibleBase * coupon.value) / 100);
  } else if (coupon.type === "fixed") {
    discountBaseMinor = Math.min(coupon.value, eligibleBase);
  } else {
    discountBaseMinor = 0; // free_shipping is applied to the shipping line
  }
  if (coupon.maxDiscountMinor && discountBaseMinor > coupon.maxDiscountMinor) {
    discountBaseMinor = coupon.maxDiscountMinor;
  }

  return { valid: true, coupon, discountBaseMinor };
}

export async function buildPricedCart(
  ctx: QueryCtx | MutationCtx,
  args: {
    items: Doc<"cart_items">[];
    settings: SiteSettings;
    currency: string;
    countryCode: string;
    couponCode?: string;
    userId?: Id<"users">;
    email?: string;
  },
): Promise<PricedCart> {
  const baseCurrency = args.settings.commerce.baseCurrency;
  const blockers: string[] = [];
  const lines: PricedLine[] = [];
  const categoryIds: Id<"categories">[] = [];

  for (const item of args.items) {
    const product = await ctx.db.get(item.productId);
    const quantity = Math.max(1, Math.round(item.quantity));
    if (!product || product.status === "archived" || product.status === "draft") {
      blockers.push("An item in your cart is no longer available and was removed.");
      continue;
    }
    const variant = item.variantSku
      ? (product.variants ?? []).find((entry) => entry.sku === item.variantSku)
      : undefined;
    if (item.variantSku && !variant) {
      blockers.push(`${product.name}: the selected variant is no longer offered.`);
      continue;
    }

    const basePriceMinor = variant ? variant.priceMinor : product.priceMinor;
    const availableStock = variant ? variant.stock : product.stock;
    const unitPriceMinor = convertMinor(
      basePriceMinor,
      product.currency,
      args.currency,
      args.settings,
    );
    const available = product.status === "published" && availableStock >= quantity;
    if (product.status !== "published") {
      blockers.push(`${product.name} is not available for sale right now.`);
    } else if (availableStock < quantity) {
      blockers.push(
        availableStock <= 0
          ? `${product.name} just went out of stock.`
          : `Only ${availableStock} left of ${product.name}.`,
      );
    }
    const shipsTo = product.shipsTo ?? [];
    if (shipsTo.length > 0 && !shipsTo.includes(args.countryCode)) {
      blockers.push(`${product.name} cannot be shipped to ${args.countryCode}.`);
    }

    const lineTotalMinor = unitPriceMinor * quantity;
    const lineTotalBaseMinor = basePriceMinor * quantity;
    if (product.categoryId) categoryIds.push(product.categoryId);

    lines.push({
      cartItemId: item._id,
      productId: product._id,
      slug: product.slug,
      name: product.name,
      sku: variant?.sku ?? product.sku,
      variantSku: item.variantSku,
      variantName: variant?.name,
      image: variant?.image ?? product.images?.[0]?.url,
      quantity,
      unitPriceMinor,
      unitPriceBaseMinor: basePriceMinor,
      unitCostMinor: variant?.costMinor ?? product.costMinor ?? 0,
      lineTotalMinor,
      lineTotalBaseMinor,
      available,
      availableStock,
      issue: available ? undefined : "Unavailable",
      categoryId: product.categoryId,
      supplierId: product.supplierId,
      supplierSku: product.supplierSku,
      supplierProductId: product.supplierProductId,
      deliveryEstimateDays: product.deliveryEstimateDays ?? 7,
    });
  }

  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const subtotalBaseMinor = lines.reduce((sum, line) => sum + line.lineTotalBaseMinor, 0);
  const costTotalBaseMinor = lines.reduce(
    (sum, line) => sum + line.unitCostMinor * line.quantity,
    0,
  );

  const zone =
    args.settings.shippingZones.find(
      (entry) => entry.countryCode === args.countryCode.toUpperCase(),
    ) ?? null;

  let shippingBaseMinor = 0;
  let shippingMinor = 0;
  if (lines.length > 0 && zone) {
    if (!zone.serviceable) {
      blockers.push(`We do not currently ship to ${zone.country}.`);
    }
    const qualifiesFree =
      zone.freeAboveMinor > 0 && subtotalBaseMinor >= zone.freeAboveMinor;
    const rateBase = qualifiesFree ? 0 : zone.rateMinor;
    shippingBaseMinor = rateBase;
    shippingMinor = convertMinor(rateBase, baseCurrency, args.currency, args.settings);
  }

  // Coupon (evaluated in base currency so limits are stable across currencies).
  let discountBaseMinor = 0;
  let couponResult: PricedCart["coupon"] = { discountMinor: 0, valid: false };
  if (args.couponCode) {
    const evaluation = await evaluateCoupon(ctx, {
      code: args.couponCode,
      subtotalBaseMinor,
      settings: args.settings,
      categoryIds,
      userId: args.userId,
      email: args.email,
      shippingBaseMinor,
    });
    if (evaluation.valid && evaluation.coupon) {
      discountBaseMinor = evaluation.discountBaseMinor;
      if (evaluation.coupon.type === "free_shipping") {
        shippingBaseMinor = 0;
        shippingMinor = 0;
      }
      couponResult = {
        code: evaluation.coupon.code,
        discountMinor: convertMinor(
          discountBaseMinor,
          baseCurrency,
          args.currency,
          args.settings,
        ),
        valid: true,
      };
    } else {
      couponResult = {
        code: args.couponCode.toUpperCase(),
        discountMinor: 0,
        valid: false,
        message: evaluation.message,
      };
    }
  }

  const discountMinor = convertMinor(
    discountBaseMinor,
    baseCurrency,
    args.currency,
    args.settings,
  );

  const taxableBase = Math.max(0, subtotalBaseMinor - discountBaseMinor);
  const taxRule = args.settings.taxRules.find(
    (rule) => rule.countryCode === args.countryCode.toUpperCase(),
  );
  const taxRatePercent = taxRule?.ratePercent ?? 0;
  const taxInclusive = taxRule?.inclusive ?? false;
  const taxableMinor = convertMinor(
    taxableBase,
    baseCurrency,
    args.currency,
    args.settings,
  );
  const taxMinor = taxOnMinor(taxableMinor, taxRatePercent, taxInclusive);
  // Unpaid duties are never promised as prepaid; the field stays 0 unless the
  // business configures a prepaid duty arrangement.
  const dutyMinor = 0;

  const totalMinor = taxInclusive
    ? taxableMinor + shippingMinor + dutyMinor
    : taxableMinor + taxMinor + shippingMinor + dutyMinor;

  const freeShippingThresholdBaseMinor = zone?.freeAboveMinor ?? 0;

  return {
    currency: args.currency,
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalMinor,
    subtotalBaseMinor,
    discountMinor,
    shippingMinor,
    shippingBaseMinor,
    taxMinor,
    taxLabel: taxRule?.label ?? "Tax",
    taxInclusive,
    dutyMinor,
    totalMinor,
    totalBaseMinor: convertMinor(totalMinor, args.currency, baseCurrency, args.settings),
    costTotalBaseMinor,
    freeShippingThresholdBaseMinor,
    missingForFreeShippingBaseMinor: Math.max(
      0,
      freeShippingThresholdBaseMinor - subtotalBaseMinor,
    ),
    coupon: couponResult,
    shippingZone: zone,
    blockers,
  };
}
