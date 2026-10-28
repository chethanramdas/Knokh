import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

/* ------------------------------------------------------------------ *
 * Shared value validators
 *
 * MONEY RULE: every monetary value is stored as an INTEGER in minor
 * units (paise / cents) together with its ISO-4217 currency code.
 * Never store a float amount without a currency.
 * ------------------------------------------------------------------ */
export const productStatusValidator = v.union(
  v.literal("draft"),
  v.literal("published"),
  v.literal("unavailable"),
  v.literal("archived"),
);

export const paymentStatusValidator = v.union(
  v.literal("unpaid"),
  v.literal("pending"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("refunded"),
  v.literal("partially_refunded"),
  v.literal("cod_pending"),
);

export const fulfilmentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("forwarded"),
  v.literal("shipped"),
  v.literal("delivered"),
  v.literal("cancelled"),
  v.literal("returned"),
);

const moneyFields = {
  amountMinor: v.number(),
  currency: v.string(),
};

const imageValidator = v.object({
  url: v.string(),
  alt: v.optional(v.string()),
  position: v.optional(v.number()),
});

const addressSnapshotValidator = v.object({
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

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
      phone: v.optional(v.string()),
      defaultCurrency: v.optional(v.string()),
      marketingConsent: v.optional(v.boolean()),
      lastSeenAt: v.optional(v.number()),
      deletedAt: v.optional(v.number()),
    }).index("email", ["email"]), // index for the email. do not remove or modify

    /* ---------------------------- storefront ---------------------------- */

    categories: defineTable({
      name: v.string(),
      slug: v.string(),
      parentId: v.optional(v.id("categories")),
      description: v.optional(v.string()),
      image: v.optional(v.string()),
      icon: v.optional(v.string()),
      position: v.number(),
      featured: v.boolean(),
      status: v.union(v.literal("active"), v.literal("archived")),
      attributes: v.optional(
        v.array(
          v.object({
            key: v.string(),
            label: v.string(),
            options: v.array(v.string()),
          }),
        ),
      ),
      seoTitle: v.optional(v.string()),
      seoDescription: v.optional(v.string()),
    })
      .index("by_slug", ["slug"])
      .index("by_parent", ["parentId", "position"])
      .index("by_position", ["position"]),

    brands: defineTable({
      name: v.string(),
      slug: v.string(),
      logo: v.optional(v.string()),
      description: v.optional(v.string()),
      status: v.union(v.literal("active"), v.literal("archived")),
    })
      .index("by_slug", ["slug"])
      .index("by_name", ["name"]),

    collections: defineTable({
      name: v.string(),
      slug: v.string(),
      description: v.optional(v.string()),
      image: v.optional(v.string()),
      position: v.number(),
      featured: v.boolean(),
      status: v.union(v.literal("active"), v.literal("archived")),
      productIds: v.array(v.id("products")),
      seoTitle: v.optional(v.string()),
      seoDescription: v.optional(v.string()),
    }).index("by_slug", ["slug"]),

    products: defineTable({
      sku: v.string(),
      slug: v.string(),
      name: v.string(),
      searchText: v.optional(v.string()),
      summary: v.optional(v.string()),
      description: v.optional(v.string()),
      brandId: v.optional(v.id("brands")),
      categoryId: v.optional(v.id("categories")),
      subcategoryId: v.optional(v.id("categories")),
      tags: v.optional(v.array(v.string())),
      images: v.array(imageValidator),
      specs: v.optional(
        v.array(v.object({ label: v.string(), value: v.string() })),
      ),
      attributes: v.optional(
        v.array(
          v.object({
            key: v.string(),
            label: v.string(),
            value: v.string(),
          }),
        ),
      ),
      variants: v.optional(
        v.array(
          v.object({
            sku: v.string(),
            name: v.string(),
            options: v.optional(
              v.array(v.object({ name: v.string(), value: v.string() })),
            ),
            priceMinor: v.number(),
            compareAtMinor: v.optional(v.number()),
            costMinor: v.optional(v.number()),
            stock: v.number(),
            weightGrams: v.optional(v.number()),
            supplierVariantId: v.optional(v.string()),
            image: v.optional(v.string()),
          }),
        ),
      ),
      priceMinor: v.number(),
      compareAtMinor: v.optional(v.number()),
      currency: v.string(),
      costMinor: v.optional(v.number()),
      shippingCostMinor: v.optional(v.number()),
      taxRatePercent: v.optional(v.number()),
      stock: v.number(),
      lowStockThreshold: v.optional(v.number()),
      status: productStatusValidator,
      featured: v.optional(v.boolean()),
      // Products created by `seed.seedDemoCatalog` are sample data, never real
      // supplier or sales data. Flagged so admins can purge them in one click.
      isDemo: v.optional(v.boolean()),
      weightGrams: v.optional(v.number()),
      dimensions: v.optional(
        v.object({
          lengthCm: v.number(),
          widthCm: v.number(),
          heightCm: v.number(),
        }),
      ),
      deliveryEstimateDays: v.optional(v.number()),
      shipsTo: v.optional(v.array(v.string())),
      supplierId: v.optional(v.id("suppliers")),
      supplierSku: v.optional(v.string()),
      supplierProductId: v.optional(v.string()),
      sourceUrl: v.optional(v.string()),
      seoTitle: v.optional(v.string()),
      seoDescription: v.optional(v.string()),
      views: v.optional(v.number()),
      unitsSold: v.optional(v.number()),
      ratingAvg: v.optional(v.number()),
      ratingCount: v.optional(v.number()),
      createdBy: v.optional(v.id("users")),
      /** Set when the product was created by a spreadsheet import job. */
      importJobId: v.optional(v.id("import_jobs")),
      updatedAt: v.number(),
    })
      .index("by_slug", ["slug"])
      .index("by_sku", ["sku"])
      .index("by_status", ["status"])
      .index("by_category", ["categoryId", "status"])
      .index("by_subcategory", ["subcategoryId", "status"])
      .index("by_brand", ["brandId", "status"])
      .index("by_supplier", ["supplierId"])
      .index("by_featured", ["featured", "status"])
      .index("by_price", ["status", "priceMinor"])
      .searchIndex("search_text", {
        searchField: "searchText",
        filterFields: ["status", "categoryId", "brandId"],
      }),

    inventory_movements: defineTable({
      productId: v.id("products"),
      variantSku: v.optional(v.string()),
      delta: v.number(),
      reason: v.union(
        v.literal("import"),
        v.literal("order"),
        v.literal("cancel"),
        v.literal("return"),
        v.literal("manual"),
        v.literal("supplier_sync"),
      ),
      note: v.optional(v.string()),
      orderId: v.optional(v.id("orders")),
      actorId: v.optional(v.id("users")),
      createdAt: v.number(),
    })
      .index("by_product", ["productId", "createdAt"])
      .index("by_order", ["orderId"]),

    price_history: defineTable({
      productId: v.id("products"),
      variantSku: v.optional(v.string()),
      oldPriceMinor: v.optional(v.number()),
      newPriceMinor: v.optional(v.number()),
      oldCostMinor: v.optional(v.number()),
      newCostMinor: v.optional(v.number()),
      source: v.string(),
      actorId: v.optional(v.id("users")),
      createdAt: v.number(),
    }).index("by_product", ["productId", "createdAt"]),

    /* --------------------------- customer data --------------------------- */

    profiles: defineTable({
      userId: v.id("users"),
      fullName: v.optional(v.string()),
      phone: v.optional(v.string()),
      defaultCurrency: v.optional(v.string()),
      marketingConsent: v.boolean(),
      accountDeletionRequestedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    addresses: defineTable({
      userId: v.id("users"),
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
      isDefault: v.boolean(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    wishlists: defineTable({
      userId: v.id("users"),
    }).index("by_user", ["userId"]),

    wishlist_items: defineTable({
      wishlistId: v.id("wishlists"),
      userId: v.id("users"),
      productId: v.id("products"),
      addedAt: v.number(),
    })
      .index("by_wishlist", ["wishlistId"])
      .index("by_user_product", ["userId", "productId"]),

    recently_viewed: defineTable({
      ownerKey: v.string(), // userId, or `anon:<uuid>` for guests
      productId: v.id("products"),
      viewedAt: v.number(),
    })
      .index("by_owner", ["ownerKey", "viewedAt"])
      .index("by_owner_product", ["ownerKey", "productId"]),

    carts: defineTable({
      ownerKey: v.string(),
      userId: v.optional(v.id("users")),
      status: v.union(
        v.literal("active"),
        v.literal("saved"),
        v.literal("converted"),
        v.literal("abandoned"),
      ),
      currency: v.string(),
      couponCode: v.optional(v.string()),
      note: v.optional(v.string()),
      updatedAt: v.number(),
      createdAt: v.number(),
    })
      .index("by_owner", ["ownerKey", "status"])
      .index("by_user", ["userId", "status"]),

    cart_items: defineTable({
      cartId: v.id("carts"),
      productId: v.id("products"),
      variantSku: v.optional(v.string()),
      quantity: v.number(),
      addedAt: v.number(),
    })
      .index("by_cart", ["cartId"])
      .index("by_cart_product", ["cartId", "productId", "variantSku"]),

    newsletter_subscribers: defineTable({
      email: v.string(),
      consent: v.boolean(),
      source: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_email", ["email"]),

    /* ------------------------------ orders ------------------------------ */

    orders: defineTable({
      orderNumber: v.string(),
      userId: v.optional(v.id("users")),
      guestEmail: v.optional(v.string()),
      customerName: v.string(),
      currency: v.string(),
      baseCurrency: v.string(),
      exchangeRate: v.number(),
      subtotalMinor: v.number(),
      discountMinor: v.number(),
      shippingMinor: v.number(),
      taxMinor: v.number(),
      dutyMinor: v.number(),
      totalMinor: v.number(),
      totalBaseMinor: v.number(),
      costTotalMinor: v.number(),
      couponCode: v.optional(v.string()),
      cartOwnerKey: v.string(),
      shippingAddress: addressSnapshotValidator,
      billingAddress: v.optional(addressSnapshotValidator),
      shippingMethod: v.object({
        id: v.string(),
        label: v.string(),
        etaDays: v.number(),
        rateMinor: v.number(),
      }),
      paymentMethod: v.union(
        v.literal("online"),
        v.literal("cod"),
        v.literal("bank_transfer"),
      ),
      provider: v.optional(v.string()),
      paymentStatus: paymentStatusValidator,
      fulfilmentStatus: fulfilmentStatusValidator,
      notes: v.optional(v.string()),
      placedAt: v.number(),
      updatedAt: v.number(),
      cancelledAt: v.optional(v.number()),
      cancelReason: v.optional(v.string()),
    })
      .index("by_number", ["orderNumber"])
      .index("by_user", ["userId", "placedAt"])
      .index("by_status", ["fulfilmentStatus", "placedAt"])
      .index("by_payment_status", ["paymentStatus", "placedAt"])
      .index("by_placed", ["placedAt"]),

    order_items: defineTable({
      orderId: v.id("orders"),
      productId: v.id("products"),
      name: v.string(),
      sku: v.string(),
      variantSku: v.optional(v.string()),
      variantName: v.optional(v.string()),
      image: v.optional(v.string()),
      unitPriceMinor: v.number(),
      unitCostMinor: v.number(),
      quantity: v.number(),
      lineTotalMinor: v.number(),
      supplierId: v.optional(v.id("suppliers")),
      supplierSku: v.optional(v.string()),
      supplierProductId: v.optional(v.string()),
      fulfilmentStatus: fulfilmentStatusValidator,
      supplierOrderId: v.optional(v.string()),
    })
      .index("by_order", ["orderId"])
      .index("by_product", ["productId"])
      .index("by_supplier", ["supplierId"]),

    payments: defineTable({
      orderId: v.id("orders"),
      provider: v.string(),
      providerOrderId: v.optional(v.string()),
      providerPaymentId: v.optional(v.string()),
      amountMinor: v.number(),
      currency: v.string(),
      baseAmountMinor: v.number(),
      status: v.union(
        v.literal("created"),
        v.literal("pending"),
        v.literal("authorized"),
        v.literal("captured"),
        v.literal("failed"),
        v.literal("refunded"),
        v.literal("partially_refunded"),
        v.literal("abandoned"),
      ),
      method: v.optional(v.string()),
      feeMinor: v.optional(v.number()),
      netMinor: v.optional(v.number()),
      settlementRef: v.optional(v.string()),
      disputeRef: v.optional(v.string()),
      signatureVerified: v.optional(v.boolean()),
      gatewayResponseSummary: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_order", ["orderId"])
      .index("by_provider_order", ["providerOrderId"])
      .index("by_provider_payment", ["providerPaymentId"])
      .index("by_created", ["createdAt"]),

    payment_events: defineTable({
      provider: v.string(),
      eventId: v.string(), // unique per gateway event -> idempotency key
      eventType: v.string(),
      orderId: v.optional(v.id("orders")),
      paymentId: v.optional(v.id("payments")),
      signatureValid: v.boolean(),
      payloadJson: v.string(),
      processed: v.boolean(),
      processingError: v.optional(v.string()),
      receivedAt: v.number(),
      processedAt: v.optional(v.number()),
    })
      .index("by_event", ["provider", "eventId"])
      .index("by_order", ["orderId"])
      .index("by_received", ["receivedAt"]),

    refunds: defineTable({
      orderId: v.id("orders"),
      paymentId: v.optional(v.id("payments")),
      amountMinor: v.number(),
      currency: v.string(),
      reason: v.string(),
      status: v.union(
        v.literal("requested"),
        v.literal("approved"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("rejected"),
        v.literal("failed"),
      ),
      providerRefundId: v.optional(v.string()),
      requestedBy: v.optional(v.id("users")),
      notes: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_order", ["orderId"]),

    shipments: defineTable({
      orderId: v.id("orders"),
      carrier: v.string(),
      trackingNumber: v.string(),
      trackingUrl: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("label_created"),
        v.literal("in_transit"),
        v.literal("out_for_delivery"),
        v.literal("delivered"),
        v.literal("failed"),
        v.literal("returned"),
      ),
      events: v.array(
        v.object({
          at: v.number(),
          status: v.string(),
          description: v.string(),
        }),
      ),
      estimatedDelivery: v.optional(v.number()),
      shippedAt: v.optional(v.number()),
      deliveredAt: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_order", ["orderId"]),

    return_requests: defineTable({
      orderId: v.id("orders"),
      userId: v.optional(v.id("users")),
      email: v.string(),
      type: v.union(
        v.literal("return"),
        v.literal("refund"),
        v.literal("exchange"),
      ),
      orderItemIds: v.array(v.id("order_items")),
      reason: v.string(),
      description: v.optional(v.string()),
      status: v.union(
        v.literal("requested"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("received"),
        v.literal("completed"),
      ),
      refundId: v.optional(v.id("refunds")),
      createdAt: v.number(),
      resolvedAt: v.optional(v.number()),
    })
      .index("by_order", ["orderId"])
      .index("by_user", ["userId", "createdAt"])
      .index("by_status", ["status", "createdAt"]),

    /* ------------------------------ suppliers ------------------------------ */

    suppliers: defineTable({
      name: v.string(),
      slug: v.string(),
      website: v.optional(v.string()),
      country: v.string(),
      contactEmail: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
      currency: v.string(),
      categories: v.optional(v.array(v.string())),
      apiStatus: v.union(
        v.literal("not_configured"),
        v.literal("pending_credentials"),
        v.literal("connected"),
        v.literal("error"),
        v.literal("disconnected"),
      ),
      connector: v.string(), // connector id implemented in src/convex/suppliers/connectors
      supportsOrderApi: v.boolean(),
      supportsStockSync: v.boolean(),
      supportsPriceSync: v.boolean(),
      supportsProductApi: v.boolean(),
      importMethods: v.array(v.string()),
      processingTimeDays: v.optional(v.number()),
      shippingRegions: v.optional(v.array(v.string())),
      returnPolicy: v.optional(v.string()),
      notes: v.optional(v.string()),
      lastSyncAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_slug", ["slug"])
      .index("by_name", ["name"]),

    supplier_connections: defineTable({
      supplierId: v.id("suppliers"),
      label: v.string(),
      authType: v.union(
        v.literal("api_key"),
        v.literal("oauth"),
        v.literal("feed_url"),
        v.literal("manual"),
      ),
      // Names of the Convex environment variables that must hold the
      // credentials. Secrets themselves are NEVER stored in the database.
      envVars: v.array(v.string()),
      status: v.union(
        v.literal("not_configured"),
        v.literal("pending_credentials"),
        v.literal("connected"),
        v.literal("error"),
        v.literal("disconnected"),
      ),
      lastCheckedAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      createdAt: v.number(),
      revokedAt: v.optional(v.number()),
    })
      .index("by_supplier", ["supplierId"])
      .index("by_status", ["status"]),

    supplier_products: defineTable({
      supplierId: v.id("suppliers"),
      supplierProductId: v.string(),
      supplierSku: v.string(),
      productId: v.optional(v.id("products")),
      title: v.string(),
      costMinor: v.number(),
      currency: v.string(),
      stock: v.number(),
      availability: v.union(
        v.literal("in_stock"),
        v.literal("low_stock"),
        v.literal("out_of_stock"),
        v.literal("discontinued"),
        v.literal("unknown"),
      ),
      shippingEstimateMinor: v.optional(v.number()),
      deliveryEstimateDays: v.optional(v.number()),
      shipsTo: v.optional(v.array(v.string())),
      sourceUrl: v.optional(v.string()),
      lastSyncedAt: v.number(),
      rawSummary: v.optional(v.string()),
    })
      .index("by_supplier_product", ["supplierId", "supplierProductId"])
      .index("by_supplier_sku", ["supplierId", "supplierSku"])
      .index("by_product", ["productId"]),

    supplier_sync_jobs: defineTable({
      supplierId: v.id("suppliers"),
      type: v.union(
        v.literal("stock"),
        v.literal("price"),
        v.literal("full_catalog"),
        v.literal("order_forward"),
        v.literal("health_check"),
      ),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("skipped_not_configured"),
      ),
      scheduledFor: v.number(),
      attempts: v.number(),
      maxAttempts: v.number(),
      lastError: v.optional(v.string()),
      resultSummary: v.optional(v.string()),
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_status", ["status", "scheduledFor"])
      .index("by_supplier", ["supplierId", "createdAt"]),

    supplier_orders: defineTable({
      orderId: v.id("orders"),
      supplierId: v.id("suppliers"),
      orderItemIds: v.array(v.id("order_items")),
      status: v.union(
        v.literal("queued"),
        v.literal("submitted"),
        v.literal("accepted"),
        v.literal("shipped"),
        v.literal("failed"),
        v.literal("needs_manual_fulfilment"),
        v.literal("cancelled"),
      ),
      // Deterministic key prevents duplicate supplier orders when a request or
      // webhook is retried.
      idempotencyKey: v.string(),
      supplierOrderId: v.optional(v.string()),
      requestSummary: v.optional(v.string()),
      responseSummary: v.optional(v.string()),
      attempts: v.number(),
      lastError: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_order", ["orderId"])
      .index("by_idempotency", ["idempotencyKey"])
      .index("by_status", ["status", "createdAt"]),

    /* ------------------------------- imports ------------------------------- */

    import_jobs: defineTable({
      type: v.union(
        v.literal("csv"),
        v.literal("xlsx"),
        v.literal("url"),
        v.literal("supplier_api"),
      ),
      fileName: v.optional(v.string()),
      fileSizeBytes: v.optional(v.number()),
      rowCount: v.number(),
      validRows: v.number(),
      invalidRows: v.number(),
      createdRows: v.number(),
      updatedRows: v.number(),
      skippedRows: v.number(),
      status: v.union(
        v.literal("validating"),
        v.literal("ready"),
        v.literal("importing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("rolled_back"),
      ),
      mode: v.union(
        v.literal("create_only"),
        v.literal("update_only"),
        v.literal("upsert"),
      ),
      publish: v.boolean(),
      supplierId: v.optional(v.id("suppliers")),
      defaultCurrency: v.string(),
      mapping: v.optional(v.record(v.string(), v.string())),
      errorReportCsv: v.optional(v.string()),
      createdBy: v.optional(v.id("users")),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
      rollbackOf: v.optional(v.id("import_jobs")),
      notes: v.optional(v.string()),
    })
      .index("by_status", ["status", "createdAt"])
      .index("by_created", ["createdAt"]),

    import_job_rows: defineTable({
      jobId: v.id("import_jobs"),
      rowNumber: v.number(),
      rawJson: v.string(),
      normalizedJson: v.optional(v.string()),
      status: v.union(
        v.literal("valid"),
        v.literal("invalid"),
        v.literal("imported"),
        v.literal("updated"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
      errors: v.array(v.string()),
      warnings: v.array(v.string()),
      productId: v.optional(v.id("products")),
      sku: v.optional(v.string()),
      supplierSku: v.optional(v.string()),
      previousSnapshot: v.optional(v.string()),
    })
      .index("by_job", ["jobId", "rowNumber"])
      .index("by_job_status", ["jobId", "status"]),

    /* ------------------------- marketing & support ------------------------- */

    coupons: defineTable({
      code: v.string(),
      description: v.optional(v.string()),
      type: v.union(
        v.literal("percent"),
        v.literal("fixed"),
        v.literal("free_shipping"),
      ),
      value: v.number(), // percent (1-100) or minor units for `fixed`
      currency: v.string(),
      minOrderMinor: v.number(),
      maxDiscountMinor: v.optional(v.number()),
      usageLimit: v.optional(v.number()),
      usedCount: v.number(),
      perUserLimit: v.optional(v.number()),
      startsAt: v.optional(v.number()),
      endsAt: v.optional(v.number()),
      status: v.union(
        v.literal("active"),
        v.literal("disabled"),
        v.literal("archived"),
      ),
      appliesToCategoryIds: v.optional(v.array(v.id("categories"))),
      createdAt: v.number(),
    }).index("by_code", ["code"]),

    coupon_redemptions: defineTable({
      couponId: v.id("coupons"),
      code: v.string(),
      userId: v.optional(v.id("users")),
      email: v.string(),
      orderId: v.id("orders"),
      discountMinor: v.number(),
      redeemedAt: v.number(),
    })
      .index("by_coupon", ["couponId"])
      .index("by_order", ["orderId"])
      .index("by_user", ["userId"]),

    reviews: defineTable({
      productId: v.id("products"),
      userId: v.id("users"),
      orderId: v.optional(v.id("orders")),
      rating: v.number(),
      title: v.optional(v.string()),
      body: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
      ),
      createdAt: v.number(),
    })
      .index("by_product", ["productId", "status"])
      .index("by_status", ["status", "createdAt"]),

    notifications: defineTable({
      audience: v.union(v.literal("user"), v.literal("admin")),
      userId: v.optional(v.id("users")),
      type: v.string(),
      title: v.string(),
      body: v.string(),
      link: v.optional(v.string()),
      orderId: v.optional(v.id("orders")),
      readAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_audience", ["audience", "createdAt"]),

    support_tickets: defineTable({
      name: v.string(),
      email: v.string(),
      subject: v.string(),
      message: v.string(),
      topic: v.string(),
      orderNumber: v.optional(v.string()),
      userId: v.optional(v.id("users")),
      status: v.union(
        v.literal("open"),
        v.literal("pending"),
        v.literal("resolved"),
        v.literal("closed"),
      ),
      replies: v.array(
        v.object({
          at: v.number(),
          author: v.string(),
          body: v.string(),
        }),
      ),
      createdAt: v.number(),
    })
      .index("by_status", ["status", "createdAt"])
      .index("by_email", ["email", "createdAt"]),

    audit_logs: defineTable({
      actorId: v.optional(v.id("users")),
      actorEmail: v.optional(v.string()),
      action: v.string(),
      entity: v.string(),
      entityId: v.optional(v.string()),
      summary: v.optional(v.string()),
      metadata: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_created", ["createdAt"])
      .index("by_entity", ["entity", "entityId"])
      .index("by_actor", ["actorId", "createdAt"]),

    /* ---------------------- configuration & analytics ---------------------- */

    site_settings: defineTable({
      key: v.string(),
      value: v.any(),
      updatedAt: v.number(),
      updatedBy: v.optional(v.id("users")),
    }).index("by_key", ["key"]),

    analytics_events: defineTable({
      type: v.union(
        v.literal("page_view"),
        v.literal("product_view"),
        v.literal("add_to_cart"),
        v.literal("checkout_started"),
        v.literal("order_placed"),
        v.literal("search"),
      ),
      path: v.optional(v.string()),
      productId: v.optional(v.id("products")),
      orderId: v.optional(v.id("orders")),
      // Privacy: only a rotating, non-reversible visitor key. No IP, no PII.
      visitorKey: v.optional(v.string()),
      meta: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_type", ["type", "createdAt"])
      .index("by_created", ["createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
