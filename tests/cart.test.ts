import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";
import { createCartSession, isValidCartSessionKey } from "../src/lib/cartSession";
import { cartErrorMessage } from "../src/lib/cartErrors";

const modules = import.meta.glob([
  "../src/convex/**/*.ts", "../src/convex/_generated/*.js", "!../src/convex/**/*.d.ts",
]);
const guestKey = "a".repeat(32);
const otherGuest = "b".repeat(32);
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", { email: "cart@example.test", emailVerificationTime: 1 });
    const product = await ctx.db.insert("products", {
      sku: "CART-TEST", slug: "cart-test", name: "Cart test", images: [],
      priceMinor: 8400, costMinor: 4200, stock: 8, currency: "INR", status: "published", updatedAt: 1,
    });
    return { user, product };
  });
  return { t, ids, customer: t.withIdentity({ subject: ids.user, issuer: "https://test.invalid" }) };
}

// The production request c54004551fc55340 failed in resolveOwnerKey before any DB writes.
describe("cart session regression", () => {
  test.each([null, "", "bad_key", "anon:legacy-key", "x".repeat(65)])("repairs malformed or absent storage (%s) before the first mutation", async (stored) => {
    let value = stored;
    const storage = { getItem: () => value, setItem: (_: string, next: string) => { value = next; } };
    const getSession = createCartSession(() => storage, "guest", () => guestKey);
    const { t, ids } = await fixture();
    await expect(t.mutation(api.cart.addToCart, { productId: ids.product })).rejects.toThrow(/cart session is not ready/);
    await t.mutation(api.cart.addToCart, { guestKey: getSession(), productId: ids.product });
    expect(getSession()).toBe(guestKey);
    expect(value).toBe(guestKey);
    expect(await t.query(api.cart.getCartCount, { guestKey })).toBe(1);
  });
  test("preserves a valid existing session and survives a new session manager (refresh)", () => {
    let value = otherGuest;
    const storage = { getItem: () => value, setItem: (_: string, next: string) => { value = next; } };
    expect(createCartSession(() => storage, "guest", () => guestKey)()).toBe(otherGuest);
    expect(createCartSession(() => storage, "guest", () => guestKey)()).toBe(otherGuest);
  });
  test("uses a stable memory key when storage throws, including repeated initialization", () => {
    let calls = 0;
    const getSession = createCartSession(() => { throw new Error("storage blocked"); }, "guest", () => { calls++; return guestKey; });
    expect(getSession()).toBe(guestKey);
    expect(getSession()).toBe(guestKey);
    expect(calls).toBe(1);
    expect(isValidCartSessionKey(guestKey)).toBe(true);
    expect(isValidCartSessionKey("user:other-customer")).toBe(false);
  });
  test("surfaces only intentional public errors", () => {
    expect(cartErrorMessage(new ConvexError("Out of stock"))).toBe("Out of stock");
    expect(cartErrorMessage(new Error("secret stack trace"))).not.toContain("secret");
  });
});

describe("cart operations and ownership", () => {
  test("guest adds, updates, counts and prices persist across queries", async () => {
    const { t, ids } = await fixture();
    const added = await t.mutation(api.cart.addToCart, { guestKey, productId: ids.product, quantity: 2 });
    const first = await t.query(api.cart.getCart, { guestKey, currency: "INR", countryCode: "IN" });
    expect(first?.cartId).toBe(added.cartId);
    expect(first?.subtotalMinor).toBe(16800);
    expect(first?.itemCount).toBe(2);
    const itemId = first!.lines[0].cartItemId;
    await t.mutation(api.cart.updateCartItem, { guestKey, cartItemId: itemId, quantity: 3 });
    expect(await t.query(api.cart.getCartCount, { guestKey })).toBe(3);
    await t.mutation(api.cart.updateCartItem, { guestKey, cartItemId: itemId, quantity: 1 });
    expect((await t.query(api.cart.getCart, { guestKey }))?.subtotalMinor).toBe(8400);
    await t.mutation(api.cart.removeCartItem, { guestKey, cartItemId: itemId });
    expect(await t.query(api.cart.getCartCount, { guestKey })).toBe(0);
    await t.mutation(api.cart.addToCart, { guestKey, productId: ids.product });
    await t.mutation(api.cart.clearCart, { guestKey });
    expect(await t.query(api.cart.getCartCount, { guestKey })).toBe(0);
  });
  test("orphaned rows do not inflate the visible cart count and are retained", async () => {
    const { t, ids } = await fixture();
    await t.mutation(api.cart.addToCart, { guestKey, productId: ids.product, quantity: 3 });
    const itemId = (await t.query(api.cart.getCart, { guestKey }))!.lines[0].cartItemId;
    await t.run(ctx => ctx.db.delete(ids.product));
    expect(await t.query(api.cart.getCartCount, { guestKey })).toBe(0);
    expect((await t.query(api.cart.getCart, { guestKey }))?.lines).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.get(itemId))).not.toBeNull();
  });
  test("signed-in carts work without guest keys and reject other owners", async () => {
    const { t, ids, customer } = await fixture();
    await customer.mutation(api.cart.addToCart, { productId: ids.product });
    const cart = await customer.query(api.cart.getCart, {});
    expect(cart?.itemCount).toBe(1);
    expect(await t.query(api.cart.getCartCount, { guestKey })).toBe(0);
    await expect(t.mutation(api.cart.removeCartItem, { guestKey, cartItemId: cart!.lines[0].cartItemId })).rejects.toThrow(/does not belong to you/);
    await expect(t.mutation(api.cart.updateCartItem, { guestKey, cartItemId: cart!.lines[0].cartItemId, quantity: 3 })).rejects.toThrow(/does not belong to you/);
  });
  test("repeated and concurrent adds update one indexed line and one active cart", async () => {
    const { t, ids } = await fixture();
    await Promise.all(Array.from({ length: 4 }, () => t.mutation(api.cart.addToCart, { guestKey, productId: ids.product })));
    const cart = await t.query(api.cart.getCart, { guestKey });
    expect(cart?.itemCount).toBe(4);
    expect(cart?.lines).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("carts").withIndex("by_owner", q => q.eq("ownerKey", `anon:${guestKey}`).eq("status", "active")).take(2))).toHaveLength(1);
  });
  test("stock and per-item limits cap both adds and updates", async () => {
    const { t, ids } = await fixture();
    const result = await t.mutation(api.cart.addToCart, { guestKey, productId: ids.product, quantity: 100 });
    expect(result).toMatchObject({ quantity: 8, capped: true });
    const cart = await t.query(api.cart.getCart, { guestKey });
    await t.run(ctx => ctx.db.patch(ids.product, { stock: 100 }));
    expect(await t.mutation(api.cart.updateCartItem, { guestKey, cartItemId: cart!.lines[0].cartItemId, quantity: 30 })).toEqual({ quantity: 20, capped: true });
    await t.run(ctx => ctx.db.patch(ids.product, { stock: 0 }));
    await expect(t.mutation(api.cart.updateCartItem, { guestKey, cartItemId: cart!.lines[0].cartItemId, quantity: 1 })).rejects.toThrow(/out of stock/);
    expect((await t.query(api.cart.getCart, { guestKey }))?.lines[0].quantity).toBe(20);
    expect((await t.query(api.cart.getCart, { guestKey }))?.blockers.length).toBeGreaterThan(0);
  });
  test.each([0, -1, 1.5, NaN, Infinity])("rejects invalid add quantity %s transactionally", async quantity => {
    const { t, ids } = await fixture();
    await expect(t.mutation(api.cart.addToCart, { guestKey, productId: ids.product, quantity })).rejects.toThrow(/whole-number/);
    expect(await t.query(api.cart.getCartCount, { guestKey })).toBe(0);
  });
  test("zero quantity removes a line; negative and fractional updates fail", async () => {
    const { t, ids } = await fixture();
    await t.mutation(api.cart.addToCart, { guestKey, productId: ids.product });
    const itemId = (await t.query(api.cart.getCart, { guestKey }))!.lines[0].cartItemId;
    for (const quantity of [-1, 1.5]) await expect(t.mutation(api.cart.updateCartItem, { guestKey, cartItemId: itemId, quantity })).rejects.toThrow(/whole-number/);
    expect(await t.mutation(api.cart.updateCartItem, { guestKey, cartItemId: itemId, quantity: 0 })).toEqual({ removed: true });
  });
  test("unpublished, deleted, missing variants and stock errors are public ConvexErrors", async () => {
    const { t, ids } = await fixture();
    await t.run(ctx => ctx.db.patch(ids.product, { status: "draft" }));
    await expect(t.mutation(api.cart.addToCart, { guestKey, productId: ids.product })).rejects.toThrow(/not available for sale/);
    await t.run(ctx => ctx.db.patch(ids.product, { status: "published", variants: [{ sku: "SMALL", name: "Small", priceMinor: 4200, stock: 2 }] }));
    await expect(t.mutation(api.cart.addToCart, { guestKey, productId: ids.product })).rejects.toThrow(/choose a product option/);
    await expect(t.mutation(api.cart.addToCart, { guestKey, productId: ids.product, variantSku: "GONE" })).rejects.toThrow(/no longer offered/);
    await t.run(ctx => ctx.db.delete(ids.product));
    await expect(t.mutation(api.cart.addToCart, { guestKey, productId: ids.product })).rejects.toThrow(/no longer exists/);
  });
  test("variants use their own stock and prices and remain separate lines", async () => {
    const { t, ids } = await fixture();
    await t.run(ctx => ctx.db.patch(ids.product, { variants: [
      { sku: "SMALL", name: "Small", priceMinor: 4200, stock: 2 },
      { sku: "LARGE", name: "Large", priceMinor: 8400, stock: 4 },
    ] }));
    await t.mutation(api.cart.addToCart, { guestKey, productId: ids.product, variantSku: "SMALL", quantity: 5 });
    await t.mutation(api.cart.addToCart, { guestKey, productId: ids.product, variantSku: "LARGE" });
    const cart = await t.query(api.cart.getCart, { guestKey });
    expect(cart?.lines).toHaveLength(2);
    expect(cart?.subtotalMinor).toBe(16800);
    expect(cart?.itemCount).toBe(3);
  });
  test("missing settings use defaults and server-calculated currency conversion", async () => {
    const { t, ids } = await fixture();
    await t.mutation(api.cart.addToCart, { guestKey, productId: ids.product, currency: "USD" });
    const cart = await t.query(api.cart.getCart, { guestKey, currency: "USD", countryCode: "US" });
    expect(cart?.currency).toBe("USD");
    expect(cart?.subtotalMinor).toBe(100); // Default rate: INR84 = USD1.
    expect(Number.isInteger(cart?.totalMinor)).toBe(true);
  });
});

describe("guest to account migration", () => {
  test("adopts a guest cart once, caps to current stock and preserves its ID", async () => {
    const { t, ids, customer } = await fixture();
    const added = await t.mutation(api.cart.addToCart, { guestKey, productId: ids.product, quantity: 6 });
    await t.run(ctx => ctx.db.patch(ids.product, { stock: 3 }));
    expect(await customer.mutation(api.cart.adoptGuestCart, { guestKey })).toBe(added.cartId);
    expect((await customer.query(api.cart.getCart, {}))?.itemCount).toBe(3);
    expect(await customer.mutation(api.cart.adoptGuestCart, { guestKey })).toBeNull();
    expect(await t.query(api.cart.getCartCount, { guestKey })).toBe(0);
  });
  test("merges overlapping lines safely, caps stock and retains the original guest cart", async () => {
    const { t, ids, customer } = await fixture();
    const guest = await t.mutation(api.cart.addToCart, { guestKey, productId: ids.product, quantity: 5 });
    const account = await customer.mutation(api.cart.addToCart, { productId: ids.product, quantity: 5 });
    expect(await customer.mutation(api.cart.adoptGuestCart, { guestKey })).toBe(account.cartId);
    const merged = await customer.query(api.cart.getCart, {});
    expect(merged?.itemCount).toBe(8);
    expect(merged?.lines).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.get(guest.cartId))).toMatchObject({ status: "abandoned" });
    await customer.mutation(api.cart.adoptGuestCart, { guestKey });
    expect((await customer.query(api.cart.getCart, {}))?.itemCount).toBe(8);
  });
});
