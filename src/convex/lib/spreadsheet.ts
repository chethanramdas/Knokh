/**
 * Pure spreadsheet (CSV / XLSX) row normalisation.
 *
 * This module is deliberately free of database access so the validation rules
 * can be unit-tested directly (`tests/imports.test.ts`). Nothing here silently
 * discards a row: every skipped value is reported as an error or a warning.
 */

import { isValidUrl, normalizeSku, parseBool, parseIntSafe, parsePriceToMinor } from "./util";

export const IMPORT_FIELDS = [
  "name",
  "sku",
  "summary",
  "description",
  "price",
  "compare_at",
  "cost",
  "currency",
  "stock",
  "category",
  "subcategory",
  "brand",
  "supplier_sku",
  "supplier_product_id",
  "image_url",
  "image_urls",
  "variant_name",
  "variant_option",
  "weight_g",
  "delivery_days",
  "ships_to",
  "status",
  "tags",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export const REQUIRED_FIELDS: ImportField[] = ["name", "sku", "price"];

export const IMPORT_TEMPLATE_HEADERS = [
  "name",
  "sku",
  "summary",
  "description",
  "price",
  "compare_at",
  "cost",
  "currency",
  "stock",
  "category",
  "subcategory",
  "brand",
  "supplier_sku",
  "supplier_product_id",
  "image_url",
  "image_urls",
  "variant_name",
  "variant_option",
  "weight_g",
  "delivery_days",
  "ships_to",
  "status",
  "tags",
];

export type ImportContext = {
  allowedCurrencies: string[];
  defaultCurrency: string;
  defaultStatus: "draft" | "published" | "unavailable";
  /** What to do when a SKU already exists. */
  mode: "create_only" | "update_only" | "upsert";
  knownCategories: { name: string; slug: string }[];
  knownBrands: { name: string; slug: string }[];
  /** SKU -> productId already in the database (for duplicate handling). */
  existingSkus: Record<string, string>;
  maxRows: number;
};

export type NormalizedRow = {
  name: string;
  sku: string;
  summary?: string;
  description?: string;
  priceMinor: number;
  compareAtMinor?: number;
  costMinor?: number;
  currency: string;
  stock: number;
  /** Resolved during the commit phase from the category/brand slug. */
  categorySlug?: string;
  categoryName?: string;
  subcategoryName?: string;
  brandSlug?: string;
  brandName?: string;
  supplierSku?: string;
  supplierProductId?: string;
  images: string[];
  variantName?: string;
  variantOption?: string;
  weightGrams?: number;
  deliveryEstimateDays?: number;
  shipsTo?: string[];
  status: "draft" | "published" | "unavailable";
  tags: string[];
  /** Which action the commit phase should take for this row. */
  action: "create" | "update" | "skip";
  existingProductId?: string;
};

export type RowResult = {
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized: NormalizedRow | null;
  errors: string[];
  warnings: string[];
  status: "valid" | "invalid";
};

const EMPTY = new Set(["", "n/a", "na", "null", "undefined", "-"]);

function value(raw: Record<string, unknown>, mapping: Record<string, string>, field: ImportField) {
  const column = mapping[field];
  if (!column) return undefined;
  const cell = raw[column];
  if (cell === undefined || cell === null) return undefined;
  const text = String(cell).trim();
  if (EMPTY.has(text.toLowerCase())) return undefined;
  return text;
}

export function normalizeRow(
  raw: Record<string, unknown>,
  mapping: Record<string, string>,
  context: ImportContext,
  rowNumber: number,
): RowResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = value(raw, mapping, "name");
  const rawSku = value(raw, mapping, "sku");
  const priceRaw = value(raw, mapping, "price");

  if (!name) errors.push("name is required.");
  if (!rawSku) errors.push("sku is required.");
  if (!priceRaw) errors.push("price is required.");

  const priceMinor = priceRaw ? parsePriceToMinor(priceRaw) : null;
  if (priceRaw && (priceMinor === null || priceMinor <= 0)) {
    errors.push(`price "${priceRaw}" is not a valid amount greater than zero.`);
  }

  const currencyRaw = (value(raw, mapping, "currency") ?? context.defaultCurrency).toUpperCase();
  const currency = context.allowedCurrencies.includes(currencyRaw)
    ? currencyRaw
    : context.defaultCurrency;
  if (currencyRaw !== currency) {
    warnings.push(
      `currency "${currencyRaw}" is not enabled on this store; used ${currency} instead.`,
    );
  }

  const compareRaw = value(raw, mapping, "compare_at");
  let compareAtMinor = compareRaw ? parsePriceToMinor(compareRaw) : null;
  if (compareAtMinor !== null && priceMinor !== null && compareAtMinor <= priceMinor) {
    warnings.push(
      `compare_at (${compareRaw}) is not above the selling price, so it was ignored.`,
    );
    compareAtMinor = null;
  } else if (compareRaw && compareAtMinor === null) {
    warnings.push(`compare_at "${compareRaw}" is not a valid amount and was ignored.`);
  }

  const costRaw = value(raw, mapping, "cost");
  let costMinor = costRaw ? parsePriceToMinor(costRaw) : null;
  if (costRaw && (costMinor === null || costMinor < 0)) {
    warnings.push(`cost "${costRaw}" is not a valid amount and was ignored.`);
    costMinor = null;
  }

  const stockRaw = value(raw, mapping, "stock");
  const stock = stockRaw ? parseIntSafe(stockRaw, 0) : 0;
  if (stockRaw && parseIntSafe(stockRaw, -1) < 0) {
    warnings.push(`stock "${stockRaw}" is negative; stored as 0.`);
  }

  const categoryName = value(raw, mapping, "category");
  const subcategoryName = value(raw, mapping, "subcategory");
  const categoryMatch = categoryName
    ? context.knownCategories.find(
        (category) =>
          category.name.toLowerCase() === categoryName.toLowerCase() ||
          category.slug === categoryName.toLowerCase(),
      )
    : undefined;
  if (categoryName && !categoryMatch) {
    warnings.push(
      `category "${categoryName}" does not exist; the product is imported without a category so you can assign it later.`,
    );
  }

  const brandName = value(raw, mapping, "brand");
  const brandMatch = brandName
    ? context.knownBrands.find(
        (brand) =>
          brand.name.toLowerCase() === brandName.toLowerCase() ||
          brand.slug === brandName.toLowerCase(),
      )
    : undefined;
  if (brandName && !brandMatch) {
    warnings.push(`brand "${brandName}" does not exist; imported without a brand.`);
  }

  const images: string[] = [];
  const single = value(raw, mapping, "image_url");
  if (single) {
    if (isValidUrl(single)) images.push(single);
    else warnings.push(`image_url "${single}" is not a valid http(s) URL and was skipped.`);
  }
  const multiple = value(raw, mapping, "image_urls");
  if (multiple) {
    for (const candidate of multiple.split(/[|;,]\s*/)) {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      if (isValidUrl(trimmed)) {
        if (!images.includes(trimmed)) images.push(trimmed);
      } else {
        warnings.push(`image URL "${trimmed}" is not valid and was skipped.`);
      }
    }
  }

  const statusRaw = value(raw, mapping, "status");
  let status: NormalizedRow["status"] = context.defaultStatus;
  if (statusRaw) {
    const lowered = statusRaw.toLowerCase();
    if (["draft", "published", "unavailable"].includes(lowered)) {
      status = lowered as NormalizedRow["status"];
    } else if (parseBool(statusRaw)) {
      status = context.defaultStatus;
    } else {
      warnings.push(`status "${statusRaw}" was not recognised; used ${context.defaultStatus}.`);
    }
  }

  const shipsToRaw = value(raw, mapping, "ships_to");
  const shipsTo = shipsToRaw
    ? shipsToRaw
        .split(/[|;,]\s*/)
        .map((code) => code.trim().toUpperCase())
        .filter((code) => /^[A-Z]{2}$/.test(code))
    : undefined;

  const weightRaw = value(raw, mapping, "weight_g");
  const weightGrams = weightRaw ? parseIntSafe(weightRaw, 0) : undefined;

  const sku = rawSku ? normalizeSku(rawSku) : "";

  // Duplicate handling policy (never silent, never destructive):
  //  - brand new SKU            → create
  //  - existing SKU + upsert    → update
  //  - existing SKU + create_only → invalid row (reported, not silently skipped)
  let action: NormalizedRow["action"] = "create";
  let existingProductId: string | undefined;
  if (sku && context.existingSkus[sku]) {
    existingProductId = context.existingSkus[sku];
    action = context.mode === "create_only" ? "skip" : "update";
    if (context.mode === "create_only") {
      errors.push(
        `SKU ${sku} already exists. This import is set to "create only", so the row was not applied. Choose the upsert mode to update existing products.`,
      );
    } else if (context.mode === "update_only") {
      warnings.push(`SKU ${sku} exists and will be updated.`);
    } else {
      warnings.push(`SKU ${sku} exists and will be updated.`);
    }
  } else if (context.mode === "update_only") {
    errors.push(
      `SKU ${sku || "(missing)"} does not exist. This import is set to "update only", so new products cannot be created.`,
    );
  }

  if (errors.length > 0) {
    return { rowNumber, raw, normalized: null, errors, warnings, status: "invalid" };
  }

  const normalized: NormalizedRow = {
    name: name!.trim().slice(0, 200),
    sku,
    summary: value(raw, mapping, "summary")?.slice(0, 400),
    description: value(raw, mapping, "description")?.slice(0, 6000),
    priceMinor: priceMinor!,
    compareAtMinor: compareAtMinor ?? undefined,
    costMinor: costMinor ?? undefined,
    currency,
    stock: Math.max(0, stock),
    categorySlug: categoryMatch?.slug,
    categoryName: categoryMatch?.name ?? categoryName,
    subcategoryName,
    brandSlug: brandMatch?.slug,
    brandName: brandMatch?.name ?? brandName,
    supplierSku: value(raw, mapping, "supplier_sku")
      ? normalizeSku(value(raw, mapping, "supplier_sku")!)
      : undefined,
    supplierProductId: value(raw, mapping, "supplier_product_id"),
    images,
    variantName: value(raw, mapping, "variant_name"),
    variantOption: value(raw, mapping, "variant_option"),
    weightGrams: weightGrams && weightGrams > 0 ? weightGrams : undefined,
    deliveryEstimateDays: (() => {
      const days = value(raw, mapping, "delivery_days");
      if (!days) return undefined;
      const parsed = parseIntSafe(days, 0);
      return parsed > 0 ? parsed : undefined;
    })(),
    shipsTo: shipsTo && shipsTo.length > 0 ? shipsTo : undefined,
    status,
    tags: (value(raw, mapping, "tags") ?? "")
      .split(/[|;,]\s*/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    action,
    existingProductId,
  };

  return { rowNumber, raw, normalized, errors, warnings, status: "valid" };
}

/** Sensible default column mapping: a header named like the field maps to it. */
export function defaultMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of IMPORT_FIELDS) {
    const match = headers.find(
      (header) =>
        header.toLowerCase().replace(/[\s-]+/g, "_") === field ||
        header.toLowerCase() === field,
    );
    if (match) mapping[field] = match;
  }
  return mapping;
}
