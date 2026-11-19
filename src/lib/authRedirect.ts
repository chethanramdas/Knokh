const redirectBase = "https://knokh.invalid";

export function safeReturnTo(value: string | null, fallback = "/account"): string {
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) {
    return fallback;
  }
  const url = new URL(value, redirectBase);
  return url.origin === redirectBase && !url.pathname.startsWith("//") ? url.pathname + url.search + url.hash : fallback;
}
