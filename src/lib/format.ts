/** Display-only formatting helpers. All amounts are integer minor units. */

export type CurrencyConfig = {
  code: string;
  symbol: string;
  name: string;
  rateToBase: number;
  enabled: boolean;
  decimals: number;
};

export function formatMoney(
  amountMinor: number,
  currency: CurrencyConfig | undefined,
  fallbackCode = "INR",
): string {
  const decimals = currency?.decimals ?? 2;
  const value = (amountMinor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (!currency) return `${fallbackCode} ${value}`;
  return `${currency.symbol}${value}`;
}

/** Converts a base-currency minor amount into the selected display currency. */
export function convertMinor(
  amountMinor: number,
  from: CurrencyConfig | undefined,
  to: CurrencyConfig | undefined,
): number {
  if (!from || !to || from.code === to.code) return Math.round(amountMinor);
  const inBase = (amountMinor / 100) * from.rateToBase;
  return Math.round((inBase / to.rateToBase) * 100);
}

export function formatDate(value: number | string | undefined): string {
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: number | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function truncate(value: string, length = 120): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1)}…`;
}

/** Download a generated text file (CSV exports, error reports, templates). */
export function downloadTextFile(
  filename: string,
  contents: string,
  mime = "text/csv;charset=utf-8",
): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
