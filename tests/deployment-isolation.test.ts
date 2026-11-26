import { describe, expect, test } from "vitest";
import { PRODUCTION_CONVEX_ORIGIN, resolveConvexUrl } from "../src/lib/deployment";

describe("deployment isolation", () => {
  test.each(["preview.knokh-preview.pages.dev", "localhost", "127.0.0.1"])("%s cannot silently use production", (host) => {
    expect(() => resolveConvexUrl(host)).toThrow("isolated");
    expect(() => resolveConvexUrl(host, PRODUCTION_CONVEX_ORIGIN)).toThrow("isolated");
    expect(resolveConvexUrl(host, "https://test.convex.cloud")).toBe("https://test.convex.cloud");
  });
  test("production preserves its established deployment", () => {
    expect(resolveConvexUrl("knokh.com")).toBe(PRODUCTION_CONVEX_ORIGIN);
  });
  test("rejects insecure backend URLs", () => {
    expect(() => resolveConvexUrl("knokh.com", "http://test.convex.cloud")).toThrow("HTTPS");
  });
});
