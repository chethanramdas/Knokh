import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  getUser,
  notifyAdmins,
  requireUser,
  writeAuditLog,
} from "./lib/auth";
import { canViewOrder } from "./lib/checkoutAccess";
import { isEmailish, money0 } from "./lib/util";

const ORDER_STATUSES = [
  "pending",
  "processing",
  "forwarded",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;

function customerShipment(shipment: Doc<"shipments">) {
  let trackingUrl: string | undefined;
  if (shipment.trackingUrl) {
    try {
      const url = new URL(shipment.trackingUrl);
      if (url.protocol === "https:" && !url.username && !url.password) {
        trackingUrl = url.href;
      }
    } catch {
      // Invalid legacy links remain in staff records.
    }
  }
  return {
    _id: shipment._id,
    carrier: shipment.carrier,
    trackingNumber: shipment.trackingNumber,
    trackingUrl,
    status: shipment.status,
    events: shipment.events,
    estimatedDelivery: shipment.estimatedDelivery,
    shippedAt: shipment.shippedAt,
    deliveredAt: shipment.deliveredAt,
  };
}

export const getOrderForCheckout = query({
  args: { orderId: v.id("orders"), guestToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    const user = await getUser(ctx);
    if (!order || !canViewOrder(order, user, args.guestToken)) return null;
    return {
      _id: order._id, orderNumber: order.orderNumber, provider: order.provider,
      currency: order.currency, totalMinor: order.totalMinor,
    };
  },
});

export const getOrderDetail = query({
  args: { orderId: v.id("orders"), guestToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    const user = await getUser(ctx);
    if (!order || !canViewOrder(order, user, args.guestToken)) return null;
    const items = await ctx.db
      .query("order_items")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(100);
    const shipments = await ctx.db
      .query("shipments")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(10);
    const refunds = await ctx.db
      .query("refunds")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(10);
    const returnRequests = await ctx.db
      .query("return_requests")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(10);
    const isAdmin = user?.role === "admin";
    const supplierOrders = isAdmin
      ? await ctx.db
          .query("supplier_orders")
          .withIndex("by_order", (q) => q.eq("orderId", order._id))
          .take(10)
      : [];
    const suppliers = await Promise.all(
      supplierOrders.map((entry) => ctx.db.get(entry.supplierId)),
    );

    const customerOrder = {
      _id: order._id,
      orderNumber: order.orderNumber,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      shippingMinor: order.shippingMinor,
      taxMinor: order.taxMinor,
      dutyMinor: order.dutyMinor,
      totalMinor: order.totalMinor,
      couponCode: order.couponCode,
      shippingAddress: order.shippingAddress,
      shippingMethod: order.shippingMethod,
      paymentMethod: order.paymentMethod,
      provider: order.provider,
      paymentStatus: order.paymentStatus,
      fulfilmentStatus: order.fulfilmentStatus,
      placedAt: order.placedAt,
    };
    return {
      order: {
        ...customerOrder,
        customerName: isAdmin ? order.customerName : undefined,
        guestEmail: isAdmin ? order.guestEmail : undefined,
        notes: isAdmin ? order.notes : undefined,
        baseCurrency: isAdmin ? order.baseCurrency : order.currency,
        costTotalMinor: isAdmin ? order.costTotalMinor : undefined,
      },
      items: items.map((item) => ({
        _id: item._id,
        productId: item.productId,
        name: item.name,
        sku: item.sku,
        variantSku: item.variantSku,
        variantName: item.variantName,
        image: item.image,
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        lineTotalMinor: item.lineTotalMinor,
        fulfilmentStatus: item.fulfilmentStatus,
        supplierSku: isAdmin ? item.supplierSku : undefined,
        unitCostMinor: isAdmin ? item.unitCostMinor : undefined,
      })),
      shipments: isAdmin ? shipments : shipments.map(customerShipment),
      refunds: refunds.map((refund) => ({
        _id: refund._id,
        amountMinor: refund.amountMinor,
        currency: refund.currency,
        reason: isAdmin ? refund.reason : undefined,
        status: refund.status,
        providerRefundId: isAdmin ? refund.providerRefundId : undefined,
      })),
      returnRequests: returnRequests.map((request) => ({
        _id: request._id,
        type: request.type,
        reason: request.reason,
        status: request.status,
      })),
      fulfilment: supplierOrders.map((entry, index) => ({
        supplierId: entry.supplierId,
        supplierName: suppliers[index]?.name ?? "Unknown supplier",
        status: entry.status,
        note: entry.responseSummary,
        updatedAt: entry.updatedAt,
      })),
    };
  },
});

export const myOrders = query({
  args: {
    status: v.optional(v.union(...ORDER_STATUSES.map((status) => v.literal(status)))),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 100));
    const search = args.search?.trim().toLowerCase();
    return orders
      .filter((order) => (args.status ? order.fulfilmentStatus === args.status : true))
      .filter((order) =>
        search
          ? order.orderNumber.toLowerCase().includes(search) ||
            order.customerName.toLowerCase().includes(search)
          : true,
      )
      .map((order) => ({
        _id: order._id,
        orderNumber: order.orderNumber,
        placedAt: order.placedAt,
        shippingMethod: { label: order.shippingMethod.label },
        fulfilmentStatus: order.fulfilmentStatus,
        paymentStatus: order.paymentStatus,
        currency: order.currency,
        totalMinor: order.totalMinor,
      }));
  },
});

export const lookupGuestOrder = query({
  args: { orderNumber: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_number", (q) => q.eq("orderNumber", args.orderNumber.trim().toUpperCase()))
      .unique();
    if (!order || order.userId) return null;
    const expected = (order.shippingAddress.email ?? order.guestEmail ?? "").toLowerCase();
    if (!isEmailish(args.email) || expected !== args.email.trim().toLowerCase()) {
      // Never reveal whether the order number exists.
      return null;
    }
    return {
      orderNumber: order.orderNumber,
      fulfilmentStatus: order.fulfilmentStatus,
      paymentStatus: order.paymentStatus,
      totalMinor: order.totalMinor,
      currency: order.currency,
      placedAt: order.placedAt,
    };
  },
});

export const cancelOrder = mutation({
  args: { orderId: v.id("orders"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    if (order.userId !== user._id && user.role !== "admin") {
      throw new Error("You cannot modify this order.");
    }
    if (["shipped", "delivered", "cancelled", "returned"].includes(order.fulfilmentStatus)) {
      throw new Error(
        `This order is already ${order.fulfilmentStatus} and can no longer be cancelled. Please raise a return request instead.`,
      );
    }
    const now = Date.now();
    await ctx.db.patch(order._id, {
      fulfilmentStatus: "cancelled",
      cancelledAt: now,
      cancelReason: args.reason,
      updatedAt: now,
    });

    // Release reserved stock so unsold units are sellable again.
    const items = await ctx.db
      .query("order_items")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(100);
    for (const item of items) {
      const product = await ctx.db.get(item.productId);
      if (!product) continue;
      if (item.variantSku) {
        const variants = (product.variants ?? []).map((variant) =>
          variant.sku === item.variantSku
            ? { ...variant, stock: variant.stock + item.quantity }
            : variant,
        );
        await ctx.db.patch(product._id, { variants, updatedAt: now });
      } else {
        await ctx.db.patch(product._id, {
          stock: product.stock + item.quantity,
          updatedAt: now,
        });
      }
      await ctx.db.patch(item._id, { fulfilmentStatus: "cancelled" });
      await ctx.db.insert("inventory_movements", {
        productId: product._id,
        variantSku: item.variantSku,
        delta: item.quantity,
        reason: "cancel",
        note: `Order ${order.orderNumber} cancelled`,
        orderId: order._id,
        actorId: user._id,
        createdAt: now,
      });
    }

    // A paid order needs a refund, which a human must approve.
    if (order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded") {
      const refunds = await ctx.db.query("refunds").withIndex("by_order", (q) =>
        q.eq("orderId", order._id),
      ).collect();
      const remaining = order.totalMinor - refunds
        .filter((refund) => !["failed", "rejected"].includes(refund.status))
        .reduce((sum, refund) => sum + refund.amountMinor, 0);
      if (remaining > 0) await ctx.db.insert("refunds", {
        orderId: order._id,
        amountMinor: remaining,
        currency: order.currency,
        reason: args.reason ? `Order cancelled: ${args.reason}` : "Order cancelled",
        status: "requested",
        requestedBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
    }

    await notifyAdmins(ctx, {
      type: "order_cancelled",
      title: `Order ${order.orderNumber} cancelled`,
      body: `${user.email ?? "customer"} cancelled the order. Stock has been released.`,
      link: `/admin/orders/${order._id}`,
    });
    await writeAuditLog(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "order.cancel",
      entity: "orders",
      entityId: String(order._id),
      summary: `Cancelled ${order.orderNumber}`,
    });
    return { ok: true };
  },
});

export const requestReturn = mutation({
  args: {
    orderId: v.id("orders"),
    orderItemIds: v.array(v.id("order_items")),
    type: v.union(v.literal("return"), v.literal("refund"), v.literal("exchange")),
    reason: v.string(),
    description: v.optional(v.string()),
    guestToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    if (!canViewOrder(order, user, args.guestToken)) throw new Error("Order not found.");
    if (args.reason.trim().length < 3 || args.reason.length > 254 || (args.description?.length ?? 0) > 2000) {
      throw new Error("Describe the issue in the available space.");
    }

    const items = await ctx.db
      .query("order_items")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(100);
    const validIds = args.orderItemIds.filter((id) =>
      items.some((item) => item._id === id),
    );
    if (validIds.length === 0) {
      throw new Error("Select at least one item to return.");
    }

    const now = Date.now();
    const requestId = await ctx.db.insert("return_requests", {
      orderId: order._id,
      userId: order.userId,
      email: (order.shippingAddress.email ?? order.guestEmail ?? "").toLowerCase(),
      type: args.type,
      orderItemIds: validIds,
      reason: args.reason,
      description: args.description,
      status: "requested",
      createdAt: now,
    });
    await notifyAdmins(ctx, {
      type: "return_request",
      title: `Return requested · ${order.orderNumber}`,
      body: `${validIds.length} item(s): ${args.reason}`,
      link: `/admin/orders/${order._id}`,
    });
    await writeAuditLog(ctx, {
      actorId: user?._id,
      action: "order.return_request",
      entity: "return_requests",
      entityId: String(requestId),
      summary: `Return requested for ${order.orderNumber}`,
    });
    return { ok: true, requestId };
  },
});

export const listMyReturns = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const requests = await ctx.db
      .query("return_requests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
    const out = [];
    for (const request of requests) {
      const order = await ctx.db.get(request.orderId);
      out.push({
        ...request,
        orderNumber: order?.orderNumber ?? "—",
        currency: order?.currency ?? "INR",
      });
    }
    return out;
  },
});

export const getTracking = query({
  args: { orderId: v.id("orders"), guestToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    const user = await getUser(ctx);
    if (!order || !canViewOrder(order, user, args.guestToken)) return null;
    const shipments = await ctx.db
      .query("shipments")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(10);
    const items = await ctx.db
      .query("order_items")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(100);
    return {
      orderNumber: order.orderNumber,
      fulfilmentStatus: order.fulfilmentStatus,
      shippingMethod: order.shippingMethod,
      shippingAddress: order.shippingAddress,
      placedAt: order.placedAt,
      estimatedDelivery: order.placedAt + order.shippingMethod.etaDays * 86400000,
      shipments: user?.role === "admin" ? shipments : shipments.map(customerShipment),
      items: items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        fulfilmentStatus: item.fulfilmentStatus,
      })),
      summary: `${items.length} item line(s) · ${money0(order.totalMinor)} ${order.currency}`,
    };
  },
});

export const submitReview = mutation({
  args: {
    productId: v.id("products"),
    rating: v.number(),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.rating < 1 || args.rating > 5) {
      throw new Error("Choose a rating between 1 and 5.");
    }
    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_product", (q) =>
        q.eq("productId", args.productId).eq("status", "approved"),
      )
      .take(200);
    if (existing.some((review) => review.userId === user._id)) {
      throw new Error("You have already reviewed this product.");
    }
    // Reviews are published only after a human approves them, so no fabricated
    // or automatically generated rating can appear on the storefront.
    const reviewId = await ctx.db.insert("reviews", {
      productId: args.productId,
      userId: user._id,
      rating: Math.round(args.rating),
      title: args.title?.slice(0, 120),
      body: args.body?.slice(0, 2000),
      status: "pending",
      createdAt: Date.now(),
    });
    await notifyAdmins(ctx, {
      type: "review_pending",
      title: "New review awaiting moderation",
      body: `${user.email ?? "customer"} rated a product ${Math.round(args.rating)}/5.`,
      link: `/admin/reviews`,
    });
    return { reviewId, status: "pending" as const };
  },
});

export const myReviews = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(200);
    return reviews.filter((review) => review.userId === user._id);
  },
});

