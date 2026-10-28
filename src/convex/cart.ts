import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getUser, resolveOwnerKey } from "./lib/auth";
import { buildPricedCart } from "./lib/pricing";
import { getSettings } from "./lib/settings";

const MAX_QTY = 20;

async function findActiveCart(ctx: MutationCtx, ownerKey: string) {
  return await ctx.db
    .query("carts")
    .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey).eq("status", "active"))
    .unique();
}

/**
 * Cart items are looked up by cart and compared in memory so that a missing
 * `variantSku` (no variant selected) is matched exactly like a set one.
 */
async function findCartItem(
  ctx: MutationCtx,
  cartId: Id<"carts">,
  productId: Id<"products">,
  variantSku?: string,
) {
  const items = await ctx.db
    .query("cart_items")
    .withIndex("by_cart", (q) => q.eq("cartId", cartId))
    .take(100);
  return (
    items.find(
      (item) => item.productId === productId && item.variantSku === variantSku,
    ) ?? null
  );
}

async function getOrCreateCart(
  ctx: MutationCtx,
  ownerKey: string,
  userId: Id<"users"> | undefined,
  currency: string,
) {
  const existing = await findActiveCart(ctx, ownerKey);
  if (existing) {
    if (currency && existing.currency !== currency) {
      await ctx.db.patch(existing._id, { currency, updatedAt: Date.now() });
      return { ...existing, currency };
    }
    if (userId && existing.userId !== userId) {
      await ctx.db.patch(existing._id, { userId, updatedAt: Date.now() });
    }
    return existing;
  }
  const cartId = await ctx.db.insert("carts", {
    ownerKey,
    userId,
    status: "active",
    currency,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  });
  const created = await ctx.db.get(cartId);
  return created!;
}

/** Live cart for the storefront (guest key or signed-in user). */
export const getCart = query({
  args: {
    guestKey: v.optional(v.string()),
    currency: v.optional(v.string()),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user && !args.guestKey) return null;
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const settings = await getSettings(ctx);
    const cart = await ctx.db
      .query("carts")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey).eq("status", "active"))
      .unique();
    if (!cart) return null;

    const items = await ctx.db
      .query("cart_items")
      .withIndex("by_cart", (q) => q.eq("cartId", cart._id))
      .order("asc")
      .take(100);

    const currency = args.currency || cart.currency;
    const priced = await buildPricedCart(ctx, {
      items,
      settings,
      currency,
      countryCode: (args.countryCode || "IN").toUpperCase(),
      couponCode: cart.couponCode,
      userId: user?._id,
      email: user?.email,
    });
    return { cartId: cart._id, note: cart.note, ...priced };
  },
});

export const getCartCount = query({
  args: { guestKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user && !args.guestKey) return 0;
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const cart = await ctx.db
      .query("carts")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey).eq("status", "active"))
      .unique();
    if (!cart) return 0;
    const items = await ctx.db
      .query("cart_items")
      .withIndex("by_cart", (q) => q.eq("cartId", cart._id))
      .take(100);
    return items.reduce((sum, item) => sum + item.quantity, 0);
  },
});

export const addToCart = mutation({
  args: {
    guestKey: v.optional(v.string()),
    productId: v.id("products"),
    variantSku: v.optional(v.string()),
    quantity: v.optional(v.number()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const settings = await getSettings(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("That product no longer exists.");
    if (product.status !== "published") {
      throw new Error("This product is not available for sale yet.");
    }

    const variant = args.variantSku
      ? (product.variants ?? []).find((entry) => entry.sku === args.variantSku)
      : undefined;
    if (args.variantSku && !variant) {
      throw new Error("That variant is no longer offered.");
    }
    const availableStock = variant ? variant.stock : product.stock;
    if (availableStock <= 0) {
      throw new Error("This item is out of stock.");
    }

    const cart = await getOrCreateCart(
      ctx,
      ownerKey,
      user?._id,
      args.currency || settings.commerce.defaultCurrency,
    );
    const existing = await findCartItem(
      ctx,
      cart._id,
      args.productId,
      args.variantSku,
    );

    const requested = Math.max(1, Math.round(args.quantity ?? 1));
    const nextQuantity = Math.min(
      MAX_QTY,
      availableStock,
      (existing?.quantity ?? 0) + requested,
    );

    if (existing) {
      await ctx.db.patch(existing._id, { quantity: nextQuantity });
    } else {
      await ctx.db.insert("cart_items", {
        cartId: cart._id,
        productId: args.productId,
        variantSku: args.variantSku,
        quantity: nextQuantity,
        addedAt: Date.now(),
      });
    }
    await ctx.db.patch(cart._id, { updatedAt: Date.now(), status: "active" });
    return { cartId: cart._id, quantity: nextQuantity, capped: nextQuantity < requested + (existing?.quantity ?? 0) };
  },
});

export const updateCartItem = mutation({
  args: {
    guestKey: v.optional(v.string()),
    cartItemId: v.id("cart_items"),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const item = await ctx.db.get(args.cartItemId);
    if (!item) throw new Error("That cart item no longer exists.");
    const cart = await ctx.db.get(item.cartId);
    if (!cart || cart.ownerKey !== ownerKey) {
      throw new Error("That cart item does not belong to you.");
    }
    if (args.quantity <= 0) {
      await ctx.db.delete(item._id);
      await ctx.db.patch(cart._id, { updatedAt: Date.now() });
      return { removed: true };
    }
    const product = await ctx.db.get(item.productId);
    if (!product) {
      await ctx.db.delete(item._id);
      return { removed: true };
    }
    const variant = item.variantSku
      ? (product.variants ?? []).find((entry) => entry.sku === item.variantSku)
      : undefined;
    const availableStock = variant ? variant.stock : product.stock;
    const quantity = Math.max(1, Math.min(MAX_QTY, Math.floor(args.quantity), availableStock));
    if (quantity <= 0) {
      await ctx.db.delete(item._id);
      return { removed: true };
    }
    await ctx.db.patch(item._id, { quantity });
    await ctx.db.patch(cart._id, { updatedAt: Date.now() });
    return { quantity, capped: quantity < args.quantity };
  },
});

export const removeCartItem = mutation({
  args: { guestKey: v.optional(v.string()), cartItemId: v.id("cart_items") },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const item = await ctx.db.get(args.cartItemId);
    if (!item) return null;
    const cart = await ctx.db.get(item.cartId);
    if (!cart || cart.ownerKey !== ownerKey) {
      throw new Error("That cart item does not belong to you.");
    }
    await ctx.db.delete(item._id);
    await ctx.db.patch(cart._id, { updatedAt: Date.now() });
    return null;
  },
});

export const clearCart = mutation({
  args: { guestKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const cart = await findActiveCart(ctx, ownerKey);
    if (!cart) return null;
    const items = await ctx.db
      .query("cart_items")
      .withIndex("by_cart", (q) => q.eq("cartId", cart._id))
      .take(100);
    for (const item of items) await ctx.db.delete(item._id);
    await ctx.db.patch(cart._id, { updatedAt: Date.now(), couponCode: undefined });
    return null;
  },
});

export const applyCoupon = mutation({
  args: { guestKey: v.optional(v.string()), code: v.string() },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const cart = await findActiveCart(ctx, ownerKey);
    if (!cart) throw new Error("Your cart is empty.");
    const code = args.code.trim().toUpperCase();
    await ctx.db.patch(cart._id, {
      couponCode: code || undefined,
      updatedAt: Date.now(),
    });
    // The cart query re-evaluates the coupon and reports whether it applied.
    return { code };
  },
});

export const setCartCurrency = mutation({
  args: { guestKey: v.optional(v.string()), currency: v.string() },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const cart = await findActiveCart(ctx, ownerKey);
    if (!cart) return null;
    await ctx.db.patch(cart._id, { currency: args.currency, updatedAt: Date.now() });
    return null;
  },
});

/** Saved carts: park the current cart and start a fresh one. */
export const saveCartForLater = mutation({
  args: { guestKey: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const cart = await findActiveCart(ctx, ownerKey);
    if (!cart) throw new Error("Your cart is empty.");
    await ctx.db.patch(cart._id, {
      status: "saved",
      note: args.note,
      updatedAt: Date.now(),
    });
    return cart._id;
  },
});

export const listSavedCarts = query({
  args: { guestKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user && !args.guestKey) return [];
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const carts = await ctx.db
      .query("carts")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey).eq("status", "saved"))
      .take(20);
    const out = [];
    for (const cart of carts) {
      const items = await ctx.db
        .query("cart_items")
        .withIndex("by_cart", (q) => q.eq("cartId", cart._id))
        .take(50);
      const lines = [];
      for (const item of items) {
        const product = await ctx.db.get(item.productId);
        if (!product) continue;
        lines.push({
          productId: product._id,
          name: product.name,
          slug: product.slug,
          image: product.images?.[0]?.url,
          quantity: item.quantity,
          currency: product.currency,
        });
      }
      out.push({
        cartId: cart._id,
        note: cart.note,
        updatedAt: cart.updatedAt,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        lines,
      });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const restoreSavedCart = mutation({
  args: { guestKey: v.optional(v.string()), cartId: v.id("carts") },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const saved = await ctx.db.get(args.cartId);
    if (!saved || saved.ownerKey !== ownerKey || saved.status !== "saved") {
      throw new Error("That saved cart could not be found.");
    }
    const current = await findActiveCart(ctx, ownerKey);
    if (current) {
      const items = await ctx.db
        .query("cart_items")
        .withIndex("by_cart", (q) => q.eq("cartId", current._id))
        .take(100);
      for (const item of items) await ctx.db.delete(item._id);
      await ctx.db.delete(current._id);
    }
    await ctx.db.patch(saved._id, { status: "active", updatedAt: Date.now() });
    return saved._id;
  },
});

export const deleteSavedCart = mutation({
  args: { guestKey: v.optional(v.string()), cartId: v.id("carts") },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const saved = await ctx.db.get(args.cartId);
    if (!saved || saved.ownerKey !== ownerKey) {
      throw new Error("That saved cart could not be found.");
    }
    const items = await ctx.db
      .query("cart_items")
      .withIndex("by_cart", (q) => q.eq("cartId", saved._id))
      .take(100);
    for (const item of items) await ctx.db.delete(item._id);
    await ctx.db.delete(saved._id);
    return null;
  },
});

/**
 * Called by the client right after sign-in so the guest cart follows the user
 * into their account instead of being stranded under the anonymous key.
 */
export const adoptGuestCart = mutation({
  args: { guestKey: v.string() },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return null;
    const guestOwner = resolveOwnerKey(null, args.guestKey);
    const userOwner = resolveOwnerKey(user._id, undefined);
    const guestCart = await ctx.db
      .query("carts")
      .withIndex("by_owner", (q) => q.eq("ownerKey", guestOwner).eq("status", "active"))
      .unique();
    if (!guestCart) return null;

    const userCart = await ctx.db
      .query("carts")
      .withIndex("by_owner", (q) => q.eq("ownerKey", userOwner).eq("status", "active"))
      .unique();

    const guestItems = await ctx.db
      .query("cart_items")
      .withIndex("by_cart", (q) => q.eq("cartId", guestCart._id))
      .take(100);

    if (!userCart) {
      await ctx.db.patch(guestCart._id, {
        ownerKey: userOwner,
        userId: user._id,
        updatedAt: Date.now(),
      });
      return guestCart._id;
    }

    for (const item of guestItems) {
      const existing = await findCartItem(
        ctx,
        userCart._id,
        item.productId,
        item.variantSku,
      );
      if (existing) {
        await ctx.db.patch(existing._id, {
          quantity: Math.min(MAX_QTY, existing.quantity + item.quantity),
        });
        await ctx.db.delete(item._id);
      } else {
        await ctx.db.patch(item._id, { cartId: userCart._id });
      }
    }
    await ctx.db.delete(guestCart._id);
    await ctx.db.patch(userCart._id, { updatedAt: Date.now() });
    return userCart._id;
  },
});

/** Used by the checkout mutation after an order is placed. */
export async function consumeCart(
  ctx: MutationCtx,
  cart: Doc<"carts">,
): Promise<void> {
  const items = await ctx.db
    .query("cart_items")
    .withIndex("by_cart", (q) => q.eq("cartId", cart._id))
    .take(100);
  for (const item of items) await ctx.db.delete(item._id);
  await ctx.db.patch(cart._id, {
    status: "converted",
    couponCode: undefined,
    updatedAt: Date.now(),
  });
}
