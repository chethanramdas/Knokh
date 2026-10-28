import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import {
  getUser,
  notifyAdmins,
  requireUser,
  writeAuditLog,
} from "./lib/auth";
import { getSettings } from "./lib/settings";
import { isEmailish } from "./lib/util";

/* ------------------------------- profile ------------------------------- */

export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const addresses = await ctx.db
      .query("addresses")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(50);
    const settings = await getSettings(ctx);
    return {
      name: user.name ?? "",
      email: user.email ?? "",
      phone: user.phone ?? profile?.phone ?? "",
      defaultCurrency: user.defaultCurrency ?? settings.commerce.defaultCurrency,
      marketingConsent: profile?.marketingConsent ?? user.marketingConsent ?? false,
      isAnonymous: user.isAnonymous === true,
      deletionRequestedAt: profile?.accountDeletionRequestedAt ?? null,
      addresses: addresses.sort(
        (a, b) => Number(b.isDefault) - Number(a.isDefault) || b.createdAt - a.createdAt,
      ),
      currencies: settings.currencies.filter((currency) => currency.enabled),
    };
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    defaultCurrency: v.optional(v.string()),
    marketingConsent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name.trim().slice(0, 120);
    if (args.phone !== undefined) patch.phone = args.phone.trim().slice(0, 32);
    if (args.defaultCurrency !== undefined) patch.defaultCurrency = args.defaultCurrency;
    if (args.marketingConsent !== undefined) patch.marketingConsent = args.marketingConsent;
    await ctx.db.patch(user._id, patch);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const profilePatch = {
      fullName: args.name?.trim(),
      phone: args.phone?.trim(),
      defaultCurrency: args.defaultCurrency,
      marketingConsent: args.marketingConsent ?? profile?.marketingConsent ?? false,
    };
    if (profile) {
      await ctx.db.patch(profile._id, profilePatch);
    } else {
      await ctx.db.insert("profiles", {
        userId: user._id,
        fullName: profilePatch.fullName,
        phone: profilePatch.phone,
        defaultCurrency: profilePatch.defaultCurrency,
        marketingConsent: profilePatch.marketingConsent,
      });
    }
    return null;
  },
});

export const requestAccountDeletion = mutation({
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (profile) {
      await ctx.db.patch(profile._id, { accountDeletionRequestedAt: now });
    } else {
      await ctx.db.insert("profiles", {
        userId: user._id,
        marketingConsent: false,
        accountDeletionRequestedAt: now,
      });
    }
    await notifyAdmins(ctx, {
      type: "account_deletion",
      title: "Account deletion requested",
      body: `${user.email ?? "customer"} requested deletion. Reason: ${args.reason ?? "not provided"}.`,
      link: `/admin/customers`,
    });
    await writeAuditLog(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "account.deletion_request",
      entity: "users",
      entityId: String(user._id),
      summary: "Account deletion requested by the customer",
    });
    return { ok: true };
  },
});

/* ------------------------------ addresses ------------------------------ */

export const saveAddress = mutation({
  args: {
    addressId: v.optional(v.id("addresses")),
    label: v.optional(v.string()),
    fullName: v.string(),
    phone: v.string(),
    line1: v.string(),
    line2: v.optional(v.string()),
    city: v.string(),
    state: v.string(),
    postalCode: v.string(),
    countryCode: v.string(),
    country: v.string(),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("addresses")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(50);

    const document = {
      userId: user._id,
      label: args.label?.slice(0, 40),
      fullName: args.fullName.trim(),
      phone: args.phone.trim(),
      line1: args.line1.trim(),
      line2: args.line2?.trim(),
      city: args.city.trim(),
      state: args.state.trim(),
      postalCode: args.postalCode.trim(),
      countryCode: args.countryCode.toUpperCase().slice(0, 2),
      country: args.country.trim(),
      isDefault: args.isDefault ?? existing.length === 0,
    };

    let addressId = args.addressId;
    if (addressId) {
      const owned = existing.find((address) => address._id === addressId);
      if (!owned) throw new Error("That address does not belong to your account.");
      await ctx.db.patch(addressId, document);
    } else {
      addressId = await ctx.db.insert("addresses", {
        ...document,
        createdAt: Date.now(),
      });
    }
    if (document.isDefault) {
      for (const address of existing) {
        if (address._id !== addressId && address.isDefault) {
          await ctx.db.patch(address._id, { isDefault: false });
        }
      }
    }
    return { addressId, isFirstAddress: existing.length === 0 };
  },
});

export const deleteAddress = mutation({
  args: { addressId: v.id("addresses") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const address = await ctx.db.get(args.addressId);
    if (!address || address.userId !== user._id) {
      throw new Error("That address does not belong to your account.");
    }
    await ctx.db.delete(address._id);
    return null;
  },
});

export const setDefaultAddress = mutation({
  args: { addressId: v.id("addresses") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const addresses = await ctx.db
      .query("addresses")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(50);
    const target = addresses.find((address) => address._id === args.addressId);
    if (!target) throw new Error("That address does not belong to your account.");
    for (const address of addresses) {
      await ctx.db.patch(address._id, { isDefault: address._id === target._id });
    }
    return null;
  },
});

/* ------------------------------- wishlist ------------------------------- */

async function normalizeWishlistId(ctx: MutationCtx, userId: Id<"users">) {
  const existing = await ctx.db
    .query("wishlists")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("wishlists", { userId });
}

export const toggleWishlist = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const wishlistId = await normalizeWishlistId(ctx, user._id);
    const existing = await ctx.db
      .query("wishlist_items")
      .withIndex("by_user_product", (q) =>
        q.eq("userId", user._id).eq("productId", args.productId),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { wished: false };
    }
    await ctx.db.insert("wishlist_items", {
      wishlistId,
      userId: user._id,
      productId: args.productId,
      addedAt: Date.now(),
    });
    return { wished: true };
  },
});

export const getWishlist = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return { items: [], productIds: [] as string[] };
    const items = await ctx.db
      .query("wishlist_items")
      .withIndex("by_user_product", (q) => q.eq("userId", user._id))
      .take(200);
    const products = [];
    for (const item of items) {
      const product = await ctx.db.get(item.productId);
      if (!product || product.status === "archived") continue;
      products.push({
        _id: product._id,
        name: product.name,
        slug: product.slug,
        image: product.images?.[0]?.url,
        priceMinor: product.priceMinor,
        compareAtMinor: product.compareAtMinor,
        currency: product.currency,
        status: product.status,
        stock: product.stock,
        addedAt: item.addedAt,
      });
    }
    return {
      items: products.sort((a, b) => b.addedAt - a.addedAt),
      productIds: products.map((product) => String(product._id)),
    };
  },
});

/* ----------------------------- notifications ----------------------------- */

export const getNotifications = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return { items: [], unread: 0 };
    const items = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(Math.min(args.limit ?? 30, 100));
    return {
      items,
      unread: items.filter((item) => !item.readAt).length,
    };
  },
});

export const markNotificationRead = mutation({
  args: { notificationId: v.id("notifications"), read: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.userId !== user._id) {
      throw new Error("That notification does not belong to your account.");
    }
    await ctx.db.patch(notification._id, {
      readAt: args.read === false ? undefined : Date.now(),
    });
    return null;
  },
});

export const markAllNotificationsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const items = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(200);
    for (const item of items) {
      if (!item.readAt) await ctx.db.patch(item._id, { readAt: Date.now() });
    }
    return null;
  },
});

/* -------------------------- newsletter & contact -------------------------- */

export const subscribeNewsletter = mutation({
  args: { email: v.string(), consent: v.boolean(), source: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const settings = await getSettings(ctx);
    if (!settings.commerce.newsletterEnabled) {
      throw new Error("Newsletter signup is currently disabled.");
    }
    const email = args.email.trim().toLowerCase();
    if (!isEmailish(email)) throw new Error("Enter a valid email address.");
    if (!args.consent) {
      throw new Error("Please tick the consent box so we may email you.");
    }
    const existing = await ctx.db
      .query("newsletter_subscribers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { consent: true });
      return { alreadySubscribed: true };
    }
    await ctx.db.insert("newsletter_subscribers", {
      email,
      consent: true,
      source: args.source?.slice(0, 60) ?? "website",
      createdAt: Date.now(),
    });
    return { alreadySubscribed: false };
  },
});

export const createSupportTicket = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.string(),
    message: v.string(),
    topic: v.string(),
    orderNumber: v.optional(v.string()),
    // Simple spam control: the client sends the elapsed milliseconds since the
    // form was rendered. Bots submit instantly.
    elapsedMs: v.number(),
    honeypot: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (args.honeypot && args.honeypot.trim().length > 0) {
      // Silently accept so the bot does not learn anything, but store nothing.
      return { ok: true, spam: true };
    }
    if (args.elapsedMs < 1500) {
      throw new Error("Please take a moment to complete the form before submitting.");
    }
    if (!isEmailish(args.email)) throw new Error("Enter a valid email address.");
    if (args.name.trim().length < 2) throw new Error("Enter your name.");
    if (args.subject.trim().length < 3) throw new Error("Add a short subject.");
    if (args.message.trim().length < 10) {
      throw new Error("Please describe your question in at least 10 characters.");
    }
    const ticketId = await ctx.db.insert("support_tickets", {
      name: args.name.trim().slice(0, 120),
      email: args.email.trim().toLowerCase(),
      subject: args.subject.trim().slice(0, 160),
      message: args.message.trim().slice(0, 4000),
      topic: args.topic.slice(0, 60),
      orderNumber: args.orderNumber?.trim().slice(0, 40),
      userId: user?._id,
      status: "open",
      replies: [],
      createdAt: Date.now(),
    });
    await notifyAdmins(ctx, {
      type: "support_ticket",
      title: `Support request: ${args.subject.trim().slice(0, 60)}`,
      body: `${args.email.trim()} · topic: ${args.topic}`,
      link: `/admin/support`,
    });
    return { ok: true, ticketId, spam: false };
  },
});

export const myTickets = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user?.email) return [];
    return await ctx.db
      .query("support_tickets")
      .withIndex("by_email", (q) => q.eq("email", user.email!))
      .order("desc")
      .take(20);
  },
});
