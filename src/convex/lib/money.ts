/**
 * Money + pricing helpers.
 *
 * Canonical rule for the whole codebase: amounts are integers in MINOR units
 * (paise for INR, cents for USD) and always carry an ISO-4217 currency code.
 * Floats are only ever used transiently while converting or applying markup,
 * and the result is rounded back to an integer minor amount immediately.
 */

import type { SiteSettings } from "./config";

export function toMinor(amount: number, decimals = 2): number {
  return Math.round(amount * 10 ** decimals);
}

export function fromMinor(amountMinor: number, decimals = 2): number {
  return amountMinor / 10 ** decimals;
}

/**
 * Convert a minor amount between two currencies using the rates configured in
 * site settings. `rateToBase` = how many base-currency units one unit of the
 * currency is worth.
 */
export function convertMinor(
  amountMinor: number,
  fromCode: string,
  toCode: string,
  settings: SiteSettings,
): number {
  if (fromCode === toCode) return Math.round(amountMinor);
  const from = settings.currencies.find((c) => c.code === fromCode);
  const to = settings.currencies.find((c) => c.code === toCode);
  if (!from || !to) {
    // Fail loudly rather than silently returning a wrong amount.
    throw new Error(
      `No conversion rate configured for ${fromCode} → ${toCode}. Add it in Admin → Settings → Currencies.`,
    );
  }
  const inBase = (amountMinor / 100) * from.rateToBase;
  const converted = inBase / to.rateToBase;
  return Math.round(converted * 100);
}

export type RoundingMode = "none" | "nearest_99" | "nearest_whole";

export function applyRounding(amountMinor: number, mode: RoundingMode | string): number {
  if (mode === "nearest_whole") {
    return Math.round(amountMinor / 100) * 100;
  }
  if (mode === "nearest_99") {
    // ₹X99 ending, rounded up to the next hundred.
    const hundreds = Math.ceil(amountMinor / 100);
    return (hundreds - 1) * 100 + 99;
  }
  return Math.round(amountMinor);
}

/** Suggested retail price from supplier cost using a markup percentage. */
export function priceFromCost(
  costMinor: number,
  markupPercent: number,
  rounding: RoundingMode | string = "none",
): number {
  const raw = costMinor * (1 + markupPercent / 100);
  return applyRounding(Math.round(raw), rounding);
}

export function marginPercent(priceMinor: number, costMinor: number): number {
  if (priceMinor <= 0) return 0;
  return ((priceMinor - costMinor) / priceMinor) * 100;
}

export function discountPercent(
  priceMinor: number,
  compareAtMinor?: number,
): number | null {
  if (!compareAtMinor || compareAtMinor <= priceMinor) return null;
  return Math.round(((compareAtMinor - priceMinor) / compareAtMinor) * 100);
}

/**
 * Tax on a line total.
 * - inclusive: the price already contains the tax, so we only report the
 *   portion (this is how Indian GST-inclusive catalog pricing works).
 * - exclusive: tax is added on top.
 * Returns the tax amount in minor units.
 */
export function taxOnMinor(
  lineTotalMinor: number,
  ratePercent: number,
  inclusive: boolean,
): number {
  if (ratePercent <= 0) return 0;
  if (inclusive) {
    return Math.round(lineTotalMinor - lineTotalMinor / (1 + ratePercent / 100));
  }
  return Math.round(lineTotalMinor * (ratePercent / 100));
}

export function formatMinor(
  amountMinor: number,
  currencyCode: string,
  settings: SiteSettings,
): string {
  const config = settings.currencies.find((c) => c.code === currencyCode);
  const symbol = config?.symbol ?? "";
  const decimals = config?.decimals ?? 2;
  const value = (amountMinor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol}${value}`;
}
