import { expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";
const modules = import.meta.glob(["../src/convex/**/*.ts", "../src/convex/_generated/*.js", "!../src/convex/**/*.d.ts"]);

test("support tickets belong to the authenticated account, never an email claim", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ({ db }) => {
    const owner = await db.insert("users", { email: "same@example.test" });
    const other = await db.insert("users", { email: "same@example.test" });
    const ticket = { name: "Test", email: "same@example.test", subject: "Help", message: "Private issue", topic: "order", status: "open" as const, replies: [], createdAt: 1 };
    const owned = await db.insert("support_tickets", { ...ticket, userId: owner });
    await db.insert("support_tickets", { ...ticket, userId: other });
    await db.insert("support_tickets", ticket);
    return { owner, owned };
  });
  const customer = t.withIdentity({ subject: ids.owner });
  expect((await customer.query(api.account.myTickets, {})).map((x) => x._id)).toEqual([ids.owned]);
  expect(await t.query(api.account.myTickets, {})).toEqual([]);
});

test("wishlist hides unpublished products and refuses new draft additions", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ({ db }) => {
    const user = await db.insert("users", {});
    const product = await db.insert("products", { sku: "PRIVATE", slug: "private", name: "Draft", images: [], priceMinor: 100, currency: "INR", stock: 1, status: "draft", updatedAt: 1 });
    const wishlistId = await db.insert("wishlists", { userId: user });
    await db.insert("wishlist_items", { userId: user, wishlistId, productId: product, addedAt: 1 });
    return { user, product };
  });
  const customer = t.withIdentity({ subject: ids.user });
  expect((await customer.query(api.account.getWishlist, {})).items).toEqual([]);
  await expect(customer.mutation(api.account.toggleWishlist, { productId: ids.product })).rejects.toThrow("not available");
  await t.run(async ({ db }) => { await db.patch(ids.product, { status: "published" }); });
  expect((await customer.query(api.account.getWishlist, {})).items).toHaveLength(1);
});
