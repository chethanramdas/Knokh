import { ConvexError, v } from "convex/values";
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

/** Exact indexed identity keeps variants separate and serializes concurrent adds. */
async function findCartItem(
  ctx: MutationCtx,
  cartId: Id<"carts">,
  productId: Id<"products">,
  variantSku?: string,
) {
  return await ctx.db
    .query("cart_items")
    .withIndex("by_cart_product", (q) => q.eq("cartId", cartId).eq("productId", productId).eq("variantSku", variantSku))
    .unique();
}

function availableStock(product: Doc<"products">, variantSku?: string): number {
  if (product.status !== "published") throw new ConvexError("This product is not available for sale right now.");
  const variants = product.variants ?? [];
  const variant = variantSku ? variants.find((entry) => entry.sku === variantSku) : undefined;
  if (variantSku && !variant) throw new ConvexError("That variant is no longer offered.");
  if (variants.length && !variant) throw new ConvexError("Please choose a product option before adding it to your cart.");
  const stock = variant ? variant.stock : product.stock;
  if (!Number.isFinite(stock) || stock < 1) throw new ConvexError("This item is out of stock.");
  return Math.floor(stock);
}

function validateQuantity(quantity: number, allowZero = false) {
  if (!Number.isSafeInteger(quantity) || quantity < (allowZero ? 0 : 1)) {
    throw new ConvexError("Please enter a valid whole-number quantity.");
  }
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
  returns: v.number(),
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
    let count = 0;
    for (const item of items) {
      const product = await ctx.db.get(item.productId);
      // Match priced-cart visibility without deleting legacy/orphaned rows.
      if (!product || product.status === "archived" || product.status === "draft") continue;
      if (item.variantSku && !(product.variants ?? []).some(variant => variant.sku === item.variantSku)) continue;
      count += item.quantity;
    }
    return count;
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
  returns: v.object({ cartId: v.id("carts"), quantity: v.number(), capped: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const settings = await getSettings(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new ConvexError("That product no longer exists.");
    const stock = availableStock(product, args.variantSku);
    const requested = args.quantity ?? 1;
    validateQuantity(requested);

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

    const nextQuantity = Math.min(
      MAX_QTY,
      stock,
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
  returns: v.union(v.object({ removed: v.literal(true) }), v.object({ quantity: v.number(), capped: v.boolean() })),
  handler: async (ctx, args) => {
    validateQuantity(args.quantity, true);
    const user = await getUser(ctx);
    const ownerKey = resolveOwnerKey(user?._id ?? null, args.guestKey);
    const item = await ctx.db.get(args.cartItemId);
    if (!item) throw new ConvexError("That cart item no longer exists.");
    const cart = await ctx.db.get(item.cartId);
    if (!cart || cart.ownerKey !== ownerKey) {
      throw new ConvexError("That cart item does not belong to you.");
    }
    if (args.quantity <= 0) {
      await ctx.db.delete(item._id);
      await ctx.db.patch(cart._id, { updatedAt: Date.now() });
      return { removed: true as const };
    }
    const product = await ctx.db.get(item.productId);
    if (!product) throw new ConvexError("That product no longer exists. Please remove it from your cart.");
    const stock = availableStock(product, item.variantSku);
    const quantity = Math.min(MAX_QTY, args.quantity, stock);
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
      throw new ConvexError("That cart item does not belong to you.");
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
    if (!cart) throw new ConvexError("Your cart is empty.");
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
    if (!cart) throw new ConvexError("Your cart is empty.");
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
      throw new ConvexError("That saved cart could not be found.");
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
      throw new ConvexError("That saved cart could not be found.");
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
  returns: v.union(v.null(), v.id("carts")),
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
      for (const item of guestItems) {
        const product = await ctx.db.get(item.productId);
        if (!product) continue;
        let stock: number;
        try { stock = availableStock(product, item.variantSku); }
        catch { continue; } // Preserve unavailable items; the cart shows a blocker.
        await ctx.db.patch(item._id, { quantity: Math.min(MAX_QTY, stock, item.quantity) });
      }
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
      const product = await ctx.db.get(item.productId);
      // Keep unavailable legacy lines for review; never silently discard customer items.
      let limit = MAX_QTY;
      if (product) {
        try { limit = Math.min(limit, availableStock(product, item.variantSku)); }
        catch { /* The priced cart blocks checkout until unavailable lines are resolved. */ }
      }
      const quantity = Math.min(limit, (existing?.quantity ?? 0) + item.quantity);
      if (existing) {
        await ctx.db.patch(existing._id, { quantity });
        // Retain the original line on the archived guest cart as migration history.
      } else {
        await ctx.db.patch(item._id, { cartId: userCart._id, quantity });
      }
    }
    await ctx.db.patch(guestCart._id, { status: "abandoned", updatedAt: Date.now() });
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
