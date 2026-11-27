export const PRODUCTION_CONVEX_ORIGIN =
  "https://agreeable-caterpillar-156.convex.cloud";

export function resolveConvexUrl(hostname: string, configured?: string): string {
  const preview = hostname.endsWith(".pages.dev") || hostname === "localhost" || hostname === "127.0.0.1";
  if (preview && (!configured || configured === PRODUCTION_CONVEX_ORIGIN)) {
    throw new Error("Preview requires an isolated Convex deployment.");
  }
  const url = configured || PRODUCTION_CONVEX_ORIGIN;
  if (new URL(url).protocol !== "https:") throw new Error("Convex requires HTTPS.");
  return url;
}
