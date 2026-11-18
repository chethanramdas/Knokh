import { describe, expect, test } from "vitest";
import { createCartSession } from "../src/lib/cartSession";
import { convexTest } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";
const modules = import.meta.glob(["../src/convex/**/*.ts", "../src/convex/_generated/*.js", "!../src/convex/**/*.d.ts"]);
const valid = "d".repeat(32);
describe("production missing guest session regression", () => {
  test.each([null, "", "bad_key", "anon:legacy-key", "x".repeat(65)])("initializes a valid session from %s before calling the unchanged production cart API", async (initial) => {
    let saved = initial;
    const storage = { getItem: () => saved, setItem: (_: string, value: string) => { saved = value; } };
    const session = createCartSession(() => storage, "guest", () => valid);
    const t = convexTest(schema, modules);
    const productId = await t.run(ctx => ctx.db.insert("products", {
      sku: "REGRESSION", slug: "regression", name: "Regression fixture", images: [],
      priceMinor: 10000, currency: "INR", stock: 5, status: "published", updatedAt: 1,
    }));
    await expect(t.mutation(api.cart.addToCart, { productId })).rejects.toThrow(/valid cart session key/);
    await t.mutation(api.cart.addToCart, { productId, guestKey: session() });
    expect(saved).toBe(valid);
    expect(await t.query(api.cart.getCartCount, { guestKey: session() })).toBe(1);
    const refreshSession = createCartSession(() => storage, "guest", () => "e".repeat(32));
    expect((await t.query(api.cart.getCart, { guestKey: refreshSession() }))?.subtotalMinor).toBe(10000);
  });
  test("does not replace a valid existing cart key", () => {
    const session = createCartSession(() => ({ getItem: () => valid, setItem() {} }), "guest", () => "e".repeat(32));
    expect(session()).toBe(valid);
  });
  test("keeps a stable memory session when storage is unavailable", () => {
    let generated = 0;
    const session = createCartSession(() => { throw new Error("blocked"); }, "guest", () => { generated++; return valid; });
    expect(session()).toBe(valid);
    expect(session()).toBe(valid);
    expect(generated).toBe(1);
  });
});
