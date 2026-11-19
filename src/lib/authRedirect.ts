const redirectBase = "https://knokh.invalid";

export function safeReturnTo(value: string | null, fallback = "/account"): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 32 || code === 127) return fallback;
  }
  const url = new URL(value, redirectBase);
  return url.origin === redirectBase && !url.pathname.startsWith("//") ? url.pathname + url.search + url.hash : fallback;
}
