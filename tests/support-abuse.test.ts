import { expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";
const modules = import.meta.glob([
  "../src/convex/**/*.ts",
  "../src/convex/_generated/*.js",
  "!../src/convex/**/*.d.ts",
]);
const input = {
  name: "Test Customer",
  email: "test@example.test",
  subject: "Order help",
  message: "Please help with this order.",
  topic: "order",
  elapsedMs: 2000,
};
test("direct guest calls are limited by normalized email", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 5; i++)
    await t.mutation(api.account.createSupportTicket, input);
  await expect(
    t.mutation(api.account.createSupportTicket, {
      ...input,
      email: " TEST@EXAMPLE.TEST ",
    }),
  ).rejects.toThrow("Too many support");
  expect(
    await t.run(
      async ({ db }) => (await db.query("support_tickets").collect()).length,
    ),
  ).toBe(5);
});
test("changing email cannot bypass an authenticated account limit", async () => {
  const t = convexTest(schema, modules);
  const user = await t.run(({ db }) => db.insert("users", {}));
  const customer = t.withIdentity({ subject: user });
  for (let i = 0; i < 5; i++)
    await customer.mutation(api.account.createSupportTicket, {
      ...input,
      email: `customer${i}@example.test`,
    });
  await expect(
    customer.mutation(api.account.createSupportTicket, input),
  ).rejects.toThrow("Too many support");
});
test.each([
  { message: "x".repeat(4001) },
  { subject: "x".repeat(161) },
  { elapsedMs: Infinity },
])("rejects oversized or invalid direct submissions", async (patch) => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.account.createSupportTicket, { ...input, ...patch }),
  ).rejects.toThrow();
  expect(
    await t.run(
      async ({ db }) => (await db.query("support_tickets").collect()).length,
    ),
  ).toBe(0);
});
test("old tickets do not permanently lock out a customer", async () => {
  const t = convexTest(schema, modules);
  await t.run(async ({ db }) => {
    for (let i = 0; i < 5; i++)
      await db.insert("support_tickets", {
        name: input.name,
        email: input.email,
        subject: input.subject,
        message: input.message,
        topic: input.topic,
        status: "open",
        replies: [],
        createdAt: Date.now() - 3600001,
      });
  });
  expect((await t.mutation(api.account.createSupportTicket, input)).ok).toBe(
    true,
  );
});
