export function safeReturnTo(
  value: string | null | undefined,
  fallback = "/account",
): string {
  if (
    !value?.startsWith("/") ||
    value.includes("\\") ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    )
  )
    return fallback;
  const base = "https://redirect.invalid";
  try {
    const url = new URL(value, base);
    if (
      url.origin !== base ||
      url.pathname.startsWith("//") ||
      /^\/(?:%2f|%5c)/i.test(url.pathname) ||
      url.pathname === "/auth"
    ) {
      return fallback;
    }
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
