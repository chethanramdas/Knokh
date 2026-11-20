import { describe, expect, it } from "vitest";
import { safeReturnTo } from "../src/lib/authRedirect";

describe("sign-in return paths", () => {
  it.each([
    "https://outside.example",
    "//outside.example",
    "/.//outside.example",
    "/%2e//outside.example",
    "/%2foutside.example",
    "/%5coutside.example",
    "/\\outside.example",
    "/auth",
  ])("falls back to the account page for %s", (path) => {
    expect(safeReturnTo(path)).toBe("/account");
  });

  it("preserves a storefront route and its query and fragment", () => {
    expect(safeReturnTo("/checkout?step=address#delivery")).toBe(
      "/checkout?step=address#delivery",
    );
  });
});
