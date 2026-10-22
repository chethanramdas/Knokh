import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAdmin, writeAuditLog } from "./lib/auth";
import {
  IMPORT_TEMPLATE_HEADERS,
  defaultMapping,
  normalizeRow,
  type ImportContext,
  type NormalizedRow,
} from "./lib/spreadsheet";
import { getSettings } from "./lib/settings";
import { normalizeSku, slugify, toCsv } from "./lib/util";

const IMPORT_ERROR_HEADERS = ["row", "sku", "errors", "warnings", "raw"];

type ImportMode = "create_only" | "update_only" | "upsert";

async function buildContext(
  ctx: MutationCtx,
  args: {
    mode: ImportMode;
    publish: boolean;
    defaultCurrency?: string;
  },
): Promise<ImportContext> {
  const settings = await getSettings(ctx);
  const categories = await ctx.db.query("categories").take(300);
  const brands = await ctx.db.query("brands").take(300);
  const products = await ctx.db.query("products").take(1000);
  const existingSkus: Record<string, string> = {};
  for (const product of products) {
    existingSkus[normalizeSku(product.sku)] = String(product._id);
  }
  const defaultCurrency =
    args.defaultCurrency &&
    settings.currencies.some((currency) => currency.code === args.defaultCurrency)
      ? args.defaultCurrency
      : settings.commerce.baseCurrency;

  return {
    allowedCurrencies: settings.currencies
      .filter((currency) => currency.enabled)
      .map((currency) => currency.code),
    defaultCurrency,
    defaultStatus: args.publish ? "published" : "draft",
    mode: args.mode,
    knownCategories: categories.map((category) => ({
      name: category.name,
      slug: category.slug,
    })),
    knownBrands: brands.map((brand) => ({ name: brand.name, slug: brand.slug })),
    existingSkus,
    maxRows: settings.commerce.maxImportRows,
  };
}

/** Validates and stores rows. Invalid rows are always kept and reported. */
async function ingestRows(
  ctx: MutationCtx,
  jobId: Id<"import_jobs">,
  rows: unknown[],
  mapping: Record<string, string>,
  context: ImportContext,
  startingRowNumber: number,
) {
  const settings = await getSettings(ctx);
  void settings;
  let valid = 0;
  let invalid = 0;

  for (let index = 0; index < rows.length; index++) {
    const raw = rows[index];
    const rowNumber = startingRowNumber + index;
    if (!raw || typeof raw !== "object") {
      invalid += 1;
      await ctx.db.insert("import_job_rows", {
        jobId,
        rowNumber,
        rawJson: JSON.stringify(raw ?? null).slice(0, 4000),
        status: "invalid",
        errors: ["Row could not be read as a record."],
        warnings: [],
      });
      continue;
    }
    const rawRecord = raw as Record<string, unknown>;
    const result = normalizeRow(rawRecord, mapping, context, rowNumber);
    if (result.status === "valid" && result.normalized) {
      context.existingSkus[result.normalized.sku] = "pending-in-this-import";
    }
    await ctx.db.insert("import_job_rows", {
      jobId,
      rowNumber,
      rawJson: JSON.stringify(rawRecord).slice(0, 4000),
      normalizedJson: result.normalized ? JSON.stringify(result.normalized) : undefined,
      status: result.status,
      errors: result.errors,
      warnings: result.warnings,
      sku: result.normalized?.sku,
      supplierSku: result.normalized?.supplierSku,
    });
    if (result.status === "valid") valid += 1;
    else invalid += 1;
  }
  return { valid, invalid };
}

export const startImport = mutation({
  args: {
    type: v.union(v.literal("csv"), v.literal("xlsx")),
    fileName: v.string(),
    fileSizeBytes: v.number(),
    rows: v.array(v.any()),
    mapping: v.optional(v.record(v.string(), v.string())),
    mode: v.union(v.literal("create_only"), v.literal("update_only"), v.literal("upsert")),
    publish: v.boolean(),
    supplierId: v.optional(v.id("suppliers")),
    defaultCurrency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const settings = await getSettings(ctx);

    if (args.fileSizeBytes > settings.commerce.maxImportFileBytes) {
      throw new Error(
        `The file is larger than the configured limit of ${Math.round(
          settings.commerce.maxImportFileBytes / (1024 * 1024),
        )} MB. Split it into smaller files.`,
      );
    }
    if (args.rows.length === 0) throw new Error("The file contains no data rows.");
    if (args.rows.length > settings.commerce.maxImportRows) {
      throw new Error(
        `The file has ${args.rows.length} rows, which exceeds the configured limit of ${settings.commerce.maxImportRows}. Split the file and import it in parts.`,
      );
    }

    const headers = Object.keys(args.rows[0] as Record<string, unknown>);
    const mapping = args.mapping ?? defaultMapping(headers);
    if (!mapping.name || !mapping.sku || !mapping.price) {
      throw new Error(
        "Column mapping is incomplete: name, sku and price must all be mapped to a column.",
      );
    }

    const context = await buildContext(ctx, {
      mode: args.mode,
      publish: args.publish,
      defaultCurrency: args.defaultCurrency,
    });

    const jobId = await ctx.db.insert("import_jobs", {
      type: args.type,
      fileName: args.fileName.slice(0, 200),
      fileSizeBytes: args.fileSizeBytes,
      rowCount: args.rows.length,
      validRows: 0,
      invalidRows: 0,
      createdRows: 0,
      updatedRows: 0,
      skippedRows: 0,
      status: "ready",
      mode: args.mode,
      publish: args.publish,
      supplierId: args.supplierId,
      defaultCurrency: context.defaultCurrency,
      mapping,
      createdBy: admin._id,
      createdAt: Date.now(),
    });

    const { valid, invalid } = await ingestRows(ctx, jobId, args.rows, mapping, context, 1);
    await ctx.db.patch(jobId, { validRows: valid, invalidRows: invalid });

    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "import.create",
      entity: "import_jobs",
      entityId: String(jobId),
      summary: `Validated ${args.fileName}: ${valid} valid, ${invalid} invalid row(s)`,
    });

    return { jobId, validRows: valid, invalidRows: invalid, total: args.rows.length };
  },
});

export const commitImportBatch = mutation({
  args: { jobId: v.id("import_jobs"), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Import job not found.");
    if (job.status === "rolled_back") {
      throw new Error("This import was rolled back and cannot be committed again.");
    }
    const batchSize = Math.min(Math.max(args.batchSize ?? 25, 1), 50);

    const pending = await ctx.db
      .query("import_job_rows")
      .withIndex("by_job_status", (q) => q.eq("jobId", job._id).eq("status", "valid"))
      .take(batchSize);

    await ctx.db.patch(job._id, {
      status: "importing",
      startedAt: job.startedAt ?? Date.now(),
    });

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const row of pending) {
      try {
        const normalized = JSON.parse(row.normalizedJson ?? "null") as NormalizedRow | null;
        if (!normalized) {
          await ctx.db.patch(row._id, {
            status: "failed",
            errors: [...row.errors, "Normalised payload was missing."],
          });
          failed += 1;
          continue;
        }
        const outcome = await applyImportRow(ctx, {
          jobId: job._id,
          rowId: row._id,
          normalized,
          publish: job.publish,
          supplierId: job.supplierId,
          actorId: admin._id,
        });
        if (outcome === "created") created += 1;
        else updated += 1;
      } catch (error) {
        failed += 1;
        await ctx.db.patch(row._id, {
          status: "failed",
          errors: [
            ...row.errors,
            error instanceof Error ? error.message : "Unknown import error.",
          ],
        });
      }
    }

    const remaining = await ctx.db
      .query("import_job_rows")
      .withIndex("by_job_status", (q) => q.eq("jobId", job._id).eq("status", "valid"))
      .take(1);

    await ctx.db.patch(job._id, {
      createdRows: job.createdRows + created,
      updatedRows: job.updatedRows + updated,
      skippedRows: job.skippedRows + failed,
    });

    return {
      processed: pending.length,
      created,
      updated,
      failed,
      remaining: remaining.length,
      done: remaining.length === 0,
    };
  },
});

async function applyImportRow(
  ctx: MutationCtx,
  args: {
    jobId: Id<"import_jobs">;
    rowId: Id<"import_job_rows">;
    normalized: NormalizedRow;
    publish: boolean;
    supplierId?: Id<"suppliers">;
    actorId: Id<"users">;
  },
): Promise<"created" | "updated"> {
  const settings = await getSettings(ctx);
  const row = args.normalized;
  const now = Date.now();

  let categoryId: Id<"categories"> | undefined;
  if (row.categorySlug) {
    const category = await ctx.db
      .query("categories")
      .withIndex("by_slug", (q) => q.eq("slug", row.categorySlug!))
      .unique();
    categoryId = category?._id;
  }
  let brandId: Id<"brands"> | undefined;
  if (row.brandSlug) {
    const brand = await ctx.db
      .query("brands")
      .withIndex("by_slug", (q) => q.eq("slug", row.brandSlug!))
      .unique();
    brandId = brand?._id;
  }

  const status = args.publish ? row.status : "draft";
  const searchText = [row.name, row.sku, row.summary, row.description]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1500);

  const existing = row.existingProductId
    ? await ctx.db.get(row.existingProductId as Id<"products">)
    : await ctx.db
        .query("products")
        .withIndex("by_sku", (q) => q.eq("sku", row.sku))
        .unique();

  if (existing && row.action !== "create") {
    const previousSnapshot = JSON.stringify({
      name: existing.name,
      summary: existing.summary,
      description: existing.description,
      priceMinor: existing.priceMinor,
      compareAtMinor: existing.compareAtMinor,
      costMinor: existing.costMinor,
      stock: existing.stock,
      images: existing.images,
      status: existing.status,
      categoryId: existing.categoryId,
      brandId: existing.brandId,
      supplierSku: existing.supplierSku,
      supplierId: existing.supplierId,
    });

    const stockDelta = row.stock - existing.stock;
    await ctx.db.patch(existing._id, {
      name: row.name,
      summary: row.summary,
      description: row.description ?? existing.description,
      priceMinor: row.priceMinor,
      compareAtMinor: row.compareAtMinor,
      costMinor: row.costMinor,
      stock: row.stock,
      images:
        row.images.length > 0
          ? [
              ...existing.images.filter((image) => !row.images.includes(image.url)),
              ...row.images.map((url) => ({ url, alt: row.name, position: 0 })),
            ].slice(0, 8)
          : existing.images,
      status,
      categoryId: categoryId ?? existing.categoryId,
      brandId: brandId ?? existing.brandId,
      supplierId: args.supplierId ?? existing.supplierId,
      supplierSku: row.supplierSku ?? existing.supplierSku,
      supplierProductId: row.supplierProductId ?? existing.supplierProductId,
      weightGrams: row.weightGrams ?? existing.weightGrams,
      deliveryEstimateDays: row.deliveryEstimateDays ?? existing.deliveryEstimateDays,
      shipsTo: row.shipsTo ?? existing.shipsTo,
      tags: row.tags.length > 0 ? row.tags : existing.tags,
      searchText,
      updatedAt: now,
    });

    if (existing.priceMinor !== row.priceMinor || existing.costMinor !== row.costMinor) {
      await ctx.db.insert("price_history", {
        productId: existing._id,
        oldPriceMinor: existing.priceMinor,
        newPriceMinor: row.priceMinor,
        oldCostMinor: existing.costMinor,
        newCostMinor: row.costMinor,
        source: `import:${args.jobId}`,
        actorId: args.actorId,
        createdAt: now,
      });
    }
    if (stockDelta !== 0) {
      await ctx.db.insert("inventory_movements", {
        productId: existing._id,
        delta: stockDelta,
        reason: "import",
        note: "Stock from spreadsheet import",
        actorId: args.actorId,
        createdAt: now,
      });
    }

    await ctx.db.patch(args.rowId, {
      status: "updated",
      productId: existing._id,
      previousSnapshot,
    });
    return "updated";
  }

  // Create a brand new product.
  const slug = await uniqueSlug(ctx, slugify(row.name));
  const productId = await ctx.db.insert("products", {
    name: row.name,
    slug,
    sku: row.sku,
    searchText,
    summary: row.summary,
    description: row.description,
    priceMinor: row.priceMinor,
    compareAtMinor: row.compareAtMinor,
    costMinor: row.costMinor,
    currency: row.currency || settings.commerce.baseCurrency,
    stock: row.stock,
    images: row.images.map((url, index) => ({ url, alt: row.name, position: index })),
    categoryId,
    brandId,
    supplierId: args.supplierId,
    supplierSku: row.supplierSku,
    supplierProductId: row.supplierProductId,
    sourceUrl: undefined,
    weightGrams: row.weightGrams,
    deliveryEstimateDays: row.deliveryEstimateDays ?? 7,
    shipsTo: row.shipsTo,
    tags: row.tags,
    status,
    featured: false,
    isDemo: false,
    unitsSold: 0,
    ratingCount: 0,
    views: 0,
    importJobId: args.jobId,
    createdBy: args.actorId,
    updatedAt: now,
  });

  if (row.stock > 0) {
    await ctx.db.insert("inventory_movements", {
      productId,
      delta: row.stock,
      reason: "import",
      note: "Initial stock from spreadsheet import",
      actorId: args.actorId,
      createdAt: now,
    });
  }
  await ctx.db.insert("price_history", {
    productId,
    newPriceMinor: row.priceMinor,
    newCostMinor: row.costMinor,
    source: `import:${args.jobId}`,
    actorId: args.actorId,
    createdAt: now,
  });
  await ctx.db.patch(args.rowId, { status: "imported", productId });
  return "created";
}

async function uniqueSlug(ctx: MutationCtx, base: string): Promise<string> {
  let candidate = base || `product-${Date.now()}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    const existing = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .unique();
    if (!existing) return candidate;
    candidate = `${base}-${attempt + 2}`;
  }
  return `${base}-${Date.now()}`;
}

export const finalizeImport = mutation({
  args: { jobId: v.id("import_jobs") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Import job not found.");
    const failedRows = await ctx.db
      .query("import_job_rows")
      .withIndex("by_job_status", (q) => q.eq("jobId", job._id).eq("status", "failed"))
      .take(500);
    await ctx.db.patch(job._id, {
      status: failedRows.length > 0 && job.createdRows + job.updatedRows === 0 ? "failed" : "completed",
      finishedAt: Date.now(),
    });
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "import.finalize",
      entity: "import_jobs",
      entityId: String(job._id),
      summary: `Import finished: ${job.createdRows} created, ${job.updatedRows} updated, ${failedRows.length} failed`,
    });
    return { ok: true };
  },
});

/** Undo: created products are deleted, updated products restored. */
export const rollbackImport = mutation({
  args: { jobId: v.id("import_jobs") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Import job not found.");
    const rows = await ctx.db
      .query("import_job_rows")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .take(1000);

    let deleted = 0;
    let restored = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.status === "imported" && row.productId) {
        const product = await ctx.db.get(row.productId);
        // Only roll back products this job actually created.
        if (product && product.importJobId === job._id) {
          await ctx.db.delete(product._id);
          await ctx.db.patch(row._id, { status: "skipped" });
          deleted += 1;
        } else {
          skipped += 1;
        }
      } else if (row.status === "updated" && row.productId && row.previousSnapshot) {
        const snapshot = JSON.parse(row.previousSnapshot);
        await ctx.db.patch(row.productId, { ...snapshot, updatedAt: Date.now() });
        await ctx.db.patch(row._id, { status: "skipped" });
        restored += 1;
      }
    }

    await ctx.db.patch(job._id, { status: "rolled_back", finishedAt: Date.now() });
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "import.rollback",
      entity: "import_jobs",
      entityId: String(job._id),
      summary: `Rolled back: ${deleted} deleted, ${restored} restored, ${skipped} skipped (changed since import)`,
    });
    return { deleted, restored, skipped };
  },
});

export const retryFailedRows = mutation({
  args: { jobId: v.id("import_jobs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Import job not found.");
    const rows = await ctx.db
      .query("import_job_rows")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .take(1000);
    let retried = 0;
    for (const row of rows) {
      if (row.status === "failed") {
        if (!row.normalizedJson) {
          await ctx.db.patch(row._id, {
            status: "invalid",
            errors: [...row.errors, "This row has no normalised data to retry."],
          });
          continue;
        }
        await ctx.db.patch(row._id, { status: "valid", errors: [] });
        retried += 1;
      }
    }
    await ctx.db.patch(job._id, { status: "ready" });
    return { retried };
  },
});

export const listImportJobs = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("import_jobs").order("desc").take(100);
  },
});

export const getImportJob = query({
  args: { jobId: v.id("import_jobs"), onlyIssues: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const rows = await ctx.db
      .query("import_job_rows")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .take(500);
    const filtered = args.onlyIssues
      ? rows.filter((row) => row.status === "invalid" || row.status === "failed")
      : rows;
    return {
      job,
      rows: filtered.slice(0, 200),
      counts: {
        valid: rows.filter((row) => row.status === "valid").length,
        invalid: rows.filter((row) => row.status === "invalid").length,
        imported: rows.filter((row) => row.status === "imported").length,
        updated: rows.filter((row) => row.status === "updated").length,
        failed: rows.filter((row) => row.status === "failed").length,
        total: rows.length,
      },
    };
  },
});

export const importTemplateCsv = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const example = [
      "Wireless Earbuds Pro",
      "KNOKH-EARB-001",
      "Compact true-wireless earbuds",
      "Long description text",
      "2499.00",
      "3499.00",
      "1450.00",
      "INR",
      "25",
      "Electronics and Gadgets",
      "Audio",
      "KNOKH Audio",
      "SUP-EARB-001",
      "SUP-PID-99123",
      "https://example.com/image1.jpg",
      "https://example.com/image2.jpg",
      "",
      "",
      "180",
      "7",
      "IN|US|GB",
      "published",
      "audio|wireless",
    ];
    return {
      csv: toCsv(IMPORT_TEMPLATE_HEADERS, [
        Object.fromEntries(
          IMPORT_TEMPLATE_HEADERS.map((header, index) => [header, example[index]]),
        ),
      ]),
      headers: IMPORT_TEMPLATE_HEADERS,
    };
  },
});

export const importErrorReport = query({
  args: { jobId: v.id("import_jobs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("import_job_rows")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(1000);
    const problems = rows.filter(
      (row) => row.status === "invalid" || row.status === "failed" || row.warnings.length > 0,
    );
    return {
      csv: toCsv(
        IMPORT_ERROR_HEADERS,
        problems.map((row) => ({
          row: row.rowNumber,
          sku: row.sku ?? "",
          errors: row.errors.join(" | "),
          warnings: row.warnings.join(" | "),
          raw: row.rawJson,
        })),
      ),
      count: problems.length,
    };
  },
});

/* ------------------------------------------------------------------ *
 * URL import
 * ------------------------------------------------------------------ */

/**
 * URL import policy, enforced on the server:
 *  - only approved sources (a configured supplier connection whose connector
 *    supports feed/API access) can be imported automatically;
 *  - the fetched page is kept as a *draft* for review;
 *  - robots.txt is respected and no authentication, CAPTCHA or rate limit is
 *    ever bypassed. When a source is not approved the caller gets a clear
 *    explanation plus the supported alternatives.
 */
export const checkUrlImportSupport = query({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    let host = "";
    try {
      host = new URL(args.url).host.toLowerCase();
    } catch {
      return {
        supported: false,
        reason: "That is not a valid http(s) URL.",
        alternatives: ["Upload a CSV/XLSX file", "Create the product manually"],
      };
    }
    const suppliers = await ctx.db.query("suppliers").take(100);
    const connections = await ctx.db.query("supplier_connections").take(200);
    const match = suppliers.find(
      (supplier) =>
        supplier.website &&
        (() => {
          try {
            return new URL(supplier.website).host.toLowerCase() === host;
          } catch {
            return false;
          }
        })(),
    );
    if (!match) {
      return {
        supported: false,
        host,
        reason: `${host} is not one of your configured suppliers, so KNOKH cannot import from it. Automated extraction from arbitrary shops is not permitted and is not implemented.`,
        alternatives: [
          "Add the supplier and connect its API or catalog feed in Admin → Suppliers",
          "Upload the product data as CSV/XLSX",
          "Create the product manually",
        ],
      };
    }
    const connection = connections.find(
      (entry) => entry.supplierId === match._id && !entry.revokedAt,
    );
    const status = connection?.status ?? "not_configured";
    return {
      supported: status === "connected",
      host,
      supplierId: match._id,
      supplierName: match.name,
      connector: match.connector,
      connectionStatus: status,
      reason:
        status === "connected"
          ? "Supplier connection is active. KNOKH will fetch a single page (respecting robots.txt) and create a draft for your review."
          : `The supplier "${match.name}" is registered but its connection status is "${status}". Add the required credentials before importing by URL.`,
      alternatives: [
        "Upload the product data as CSV/XLSX",
        "Create the product manually",
        "Complete the supplier connection in Admin → Suppliers",
      ],
    };
  },
});

export const createDraftFromPreview = mutation({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    sourceUrl: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    sku: v.optional(v.string()),
    costMinor: v.optional(v.number()),
    priceMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    categoryId: v.optional(v.id("categories")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const settings = await getSettings(ctx);
    const sku = normalizeSku(args.sku ?? `URL-${slugify(args.title).slice(0, 24)}-${Date.now() % 100000}`);
    const existing = await ctx.db
      .query("products")
      .withIndex("by_sku", (q) => q.eq("sku", sku))
      .unique();
    if (existing) {
      throw new Error(`SKU ${sku} already exists (product "${existing.name}").`);
    }
    const slug = await uniqueSlug(ctx, slugify(args.title));
    const now = Date.now();
    const productId = await ctx.db.insert("products", {
      name: args.title.slice(0, 200),
      slug,
      sku,
      searchText: `${args.title} ${args.description ?? ""}`.slice(0, 1500),
      description: args.description?.slice(0, 6000),
      summary: args.description?.slice(0, 200),
      priceMinor:
        args.priceMinor ??
        (args.costMinor
          ? Math.round(args.costMinor * (1 + settings.pricing.defaultMarkupPercent / 100))
          : 0),
      costMinor: args.costMinor,
      currency: args.currency ?? settings.commerce.baseCurrency,
      stock: 0,
      images: (args.images ?? []).slice(0, 8).map((url, index) => ({
        url,
        alt: args.title,
        position: index,
      })),
      categoryId: args.categoryId,
      supplierId: args.supplierId,
      sourceUrl: args.sourceUrl,
      // Draft only: a human reviews and publishes it.
      status: "draft",
      featured: false,
      isDemo: false,
      unitsSold: 0,
      ratingCount: 0,
      views: 0,
      deliveryEstimateDays: 7,
      createdBy: admin._id,
      updatedAt: now,
    });
    await writeAuditLog(ctx, {
      actorId: admin._id,
      actorEmail: admin.email,
      action: "import.url_draft",
      entity: "products",
      entityId: String(productId),
      summary: `Draft created from ${args.sourceUrl}`,
    });
    return { productId, sku };
  },
});
