export function safeReturnTo(value: string | null | undefined, fallback = "/account"): string {
  if (!value?.startsWith("/") || /[\\\x00-\x20\x7f]/.test(value)) return fallback;
  const base = "https://redirect.invalid";
  try {
    const url = new URL(value, base);
    if (url.origin !== base || /^\/(?:%2f|%5c)/i.test(url.pathname) || url.pathname === "/auth") {
      return fallback;
    }
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
