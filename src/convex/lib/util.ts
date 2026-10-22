/** Small shared helpers for the KNOKH backend. */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export function normalizeSku(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9\-_.]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Parses "1,299.50", "₹1299", "1299.5" → 129950 minor units. */
export function parsePriceToMinor(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.round(input * 100);
  }
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[^0-9.\-]/g, "").trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function parseIntSafe(input: unknown, fallback = 0): number {
  if (typeof input === "number" && Number.isFinite(input)) return Math.trunc(input);
  if (typeof input === "string") {
    const value = Number(input.replace(/[^0-9.\-]/g, ""));
    if (Number.isFinite(value)) return Math.trunc(value);
  }
  return fallback;
}

export function parseBool(input: unknown, fallback = false): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input !== 0;
  if (typeof input === "string") {
    const value = input.trim().toLowerCase();
    if (["true", "1", "yes", "y", "draft", "published"].includes(value)) {
      return value === "draft" ? fallback : true;
    }
    if (["false", "0", "no", "n", "archived", "unpublished"].includes(value)) {
      return false;
    }
  }
  return fallback;
}

export function isEmailish(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(input.trim());
}

export function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(
  headers: string[],
  rows: Array<Record<string, unknown>>,
): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  return lines.join("\r\n");
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Human-order-friendly, collision-resistant order number. */
export function generateOrderNumber(): string {
  const now = new Date();
  const stamp =
    String(now.getUTCFullYear()).slice(2) +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0");
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `KN-${stamp}-${random}`;
}

export function money0(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

export function daysFromNow(days: number): number {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}
