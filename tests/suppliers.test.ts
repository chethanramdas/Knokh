import { describe, test, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseProductSpreadsheet } from "../src/lib/importFile";
import { convexTest } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";
import { queueFulfilmentForOrder } from "../src/convex/lib/fulfilment";
import { connectionReadiness } from "../src/convex/lib/supplierConnectors";
import { parseCsvRecords } from "../src/convex/lib/supplierFeed";
import { feedRowsToItems } from "../src/convex/lib/feed";
import { supplierContribution } from "../src/convex/lib/money";
import {
  isPublicAddress,
  validatePublicHttps,
} from "../src/convex/lib/publicHttp";
const modules = import.meta.glob([
  "../src/convex/**/*.ts",
  "../src/convex/_generated/*.js",
  "!../src/convex/**/*.d.ts",
]);
const supplier = (name: string, connector = "manual") => ({
  name,
  slug: name.toLowerCase(),
  country: "IN",
  currency: "INR",
  connector,
  apiStatus: "connected" as const,
  supportsOrderApi: false,
  supportsStockSync: connector === "feed_url",
  supportsPriceSync: connector === "feed_url",
  supportsProductApi: false,
  importMethods: ["csv", "xlsx"],
  createdAt: Date.now(),
});
const product = (sku: string) => ({
  sku,
  slug: sku.toLowerCase(),
  name: sku,
  priceMinor: 10000,
  costMinor: 2000,
  currency: "INR",
  stock: 8,
  images: [],
  status: "published" as const,
  updatedAt: Date.now(),
});
const address = {
  fullName: "Test Customer",
  phone: "0000000000",
  line1: "Test address",
  city: "Test City",
  state: "Test State",
  postalCode: "000000",
  countryCode: "IN",
  country: "India",
};
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      email: "owner@example.test",
      emailVerificationTime: 1,
      role: "admin",
    });
    const customer = await ctx.db.insert("users", {
      email: "customer@example.test",
      emailVerificationTime: 1,
    });
    const a = await ctx.db.insert("suppliers", supplier("A"));
    const b = await ctx.db.insert("suppliers", supplier("B"));
    const p = await ctx.db.insert("products", {
      ...product("P1"),
      supplierId: a,
      supplierSku: "SUP1",
    });
    const order = await ctx.db.insert("orders", {
      orderNumber: "TEST-1",
      customerName: "Test Customer",
      currency: "INR",
      baseCurrency: "INR",
      exchangeRate: 1,
      subtotalMinor: 20000,
      discountMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      dutyMinor: 0,
      totalMinor: 20000,
      totalBaseMinor: 20000,
      costTotalMinor: 4000,
      cartOwnerKey: "test",
      shippingAddress: address,
      shippingMethod: { id: "test", label: "Test", etaDays: 5, rateMinor: 0 },
      paymentMethod: "online",
      paymentStatus: "paid",
      fulfilmentStatus: "pending",
      placedAt: 1,
      updatedAt: 1,
    });
    const item = (supplierId: typeof a, sku: string) => ({
      orderId: order,
      productId: p,
      name: sku,
      sku,
      unitPriceMinor: 10000,
      unitCostMinor: 2000,
      quantity: 1,
      lineTotalMinor: 10000,
      supplierId,
      supplierSku: sku,
      fulfilmentStatus: "pending" as const,
    });
    const ia = await ctx.db.insert("order_items", item(a, "SUP1"));
    const ib = await ctx.db.insert("order_items", item(b, "SUP2"));
    return { owner, customer, a, b, p, order, ia, ib };
  });
  return {
    t,
    ids,
    admin: t.withIdentity({
      subject: ids.owner,
      issuer: "https://test.invalid",
    }),
    customer: t.withIdentity({
      subject: ids.customer,
      issuer: "https://test.invalid",
    }),
  };
}
describe("supplier safety", () => {
  test("customer COD checkout reserves stock and creates one manual supplier task", async () => {
    const { t, ids, customer, admin } = await fixture();
    await customer.mutation(api.cart.addToCart, {
      productId: ids.p,
      quantity: 2,
    });
    const quote = await customer.query(api.checkout.getCheckoutQuote, {
      countryCode: "IN",
      currency: "INR",
    });
    expect(quote?.blockers).toHaveLength(0);
    const args = {
      contact: {
        name: "Fixture Customer",
        email: "customer@example.test",
        phone: "0000000000",
      },
      shippingAddress: { ...address, postalCode: "560001" },
      shippingMethodId: "standard",
      paymentMethod: "cod" as const,
      currency: "INR",
    };
    const result = await customer.mutation(api.checkout.placeOrder, args);
    expect(result.totalMinor).toBe(quote?.totalMinor);
    expect((await t.run((ctx) => ctx.db.get(ids.p)))?.stock).toBe(6);
    const tasks = await t.run((ctx) =>
      ctx.db
        .query("supplier_orders")
        .withIndex("by_order", (q) => q.eq("orderId", result.orderId))
        .collect(),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("needs_manual_fulfilment");
    await expect(
      customer.mutation(api.checkout.placeOrder, args),
    ).rejects.toThrow(/cart is empty/);
    await admin.mutation(api.suppliers.completeManualFulfilment, {
      supplierOrderId: tasks[0]._id,
      supplierOrderIdReference: "FIXTURE-EXTERNAL-ORDER",
    });
    expect(
      (await t.run((ctx) => ctx.db.get(result.orderId)))?.fulfilmentStatus,
    ).toBe("processing");
  });
  test("real CSV and XLSX bytes import through the supplier preview and commit path", async () => {
    for (const kind of ["csv", "xlsx"] as const) {
      const { t, ids, admin } = await fixture();
      const sku = kind.toUpperCase() + "-FIXTURE";
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet([
          {
            name: "Import fixture",
            sku,
            price: "120.00",
            stock: "3",
            currency: "INR",
          },
        ]),
        "Products",
      );
      const bytes = XLSX.write(workbook, {
        type: "array",
        bookType: kind,
      }) as ArrayBuffer;
      const rows = parseProductSpreadsheet(bytes, {
        maxBytes: 1_000_000,
        maxRows: 100,
      });
      expect(() =>
        parseProductSpreadsheet(bytes, { maxBytes: 1, maxRows: 100 }),
      ).toThrow(/size limit/);
      const result = await admin.mutation(api.imports.startImport, {
        type: kind,
        fileName: `fixture.${kind}`,
        fileSizeBytes: bytes.byteLength,
        rows,
        mode: "create_only",
        publish: false,
        supplierId: ids.a,
      });
      expect(result).toMatchObject({ validRows: 1, invalidRows: 0 });
      expect(
        (
          await admin.mutation(api.imports.commitImportBatch, {
            jobId: result.jobId,
          })
        ).created,
      ).toBe(1);
      const item = await t.run((ctx) =>
        ctx.db
          .query("products")
          .withIndex("by_sku", (q) => q.eq("sku", sku))
          .unique(),
      );
      expect(item).toMatchObject({
        priceMinor: 12000,
        stock: 3,
        status: "draft",
        supplierId: ids.a,
      });
    }
  });
  test("scheduled worker skips unsupported operations without supplier network calls", async () => {
    const { t, ids } = await fixture();
    const jobId = await t.run((ctx) =>
      ctx.db.insert("supplier_sync_jobs", {
        supplierId: ids.a,
        type: "order_forward",
        status: "queued",
        scheduledFor: 1,
        attempts: 0,
        maxAttempts: 3,
        createdAt: 1,
      }),
    );
    const result = await t.action(internal.suppliersActions.runDueSyncJobs, {});
    expect(result.processed).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe(
      "skipped_not_configured",
    );
  });

  test("manual is ready; configuration presence never verifies an API", () => {
    for (const id of ["manual", "qikink", "deodap"])
      expect(connectionReadiness(id, () => false).status).toBe("connected");
    for (const id of ["dsers", "cjdropshipping", "feed_url", "unknown"])
      expect(connectionReadiness(id, () => true).status).not.toBe("connected");
    expect(
      connectionReadiness("feed_url", (k) => k === "SUPPLIER_FEED_URL").missing,
    ).toEqual([]);
  });
  test("rejects signed-out and customer supplier writes and forwarding actions", async () => {
    const { t, ids, customer } = await fixture();
    await expect(
      t.mutation(api.suppliers.saveSupplier, {
        name: "Test",
        country: "IN",
        currency: "INR",
        connector: "manual",
      }),
    ).rejects.toThrow(/signed in/);
    await expect(
      customer.mutation(api.suppliers.queueSyncJob, {
        supplierId: ids.a,
        type: "stock",
      }),
    ).rejects.toThrow(/Admin access/);
    const so = await t.run((ctx) =>
      ctx.db.insert("supplier_orders", {
        orderId: ids.order,
        supplierId: ids.a,
        orderItemIds: [ids.ia],
        status: "needs_manual_fulfilment",
        idempotencyKey: "test",
        attempts: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await expect(
      customer.action(api.suppliersActions.forwardSupplierOrder, {
        supplierOrderId: so,
      }),
    ).rejects.toThrow(/Admin access/);
  });
  test("manual and unimplemented connectors cannot enter the stock worker", async () => {
    const { t, ids, admin } = await fixture();
    const result = await admin.mutation(api.suppliers.queueSyncJob, {
      supplierId: ids.a,
      type: "full_catalog",
    });
    expect(result.skipped).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(result.jobId)))?.status).toBe(
      "skipped_not_configured",
    );
  });
  test("paid order routing is grouped and idempotent; unpaid orders never route", async () => {
    const { t, ids } = await fixture();
    const route = () =>
      t.run(async (ctx) =>
        queueFulfilmentForOrder(ctx, (await ctx.db.get(ids.order))!),
      );
    expect(await route()).toMatchObject({ queued: 0, manual: 2 });
    expect(await route()).toMatchObject({ queued: 0, manual: 0 });
    expect(
      await t.run((ctx) => ctx.db.query("supplier_orders").collect()),
    ).toHaveLength(2);
    await t.run((ctx) => ctx.db.patch(ids.order, { paymentStatus: "pending" }));
    expect(await route()).toMatchObject({ manual: 0 });
  });
  test("split shipments stay separate, aggregate status is accurate, and retry is harmless", async () => {
    const { t, ids, admin } = await fixture();
    await t.run(async (ctx) =>
      queueFulfilmentForOrder(ctx, (await ctx.db.get(ids.order))!),
    );
    const groups = await t.run((ctx) =>
      ctx.db.query("supplier_orders").collect(),
    );
    const args = {
      supplierOrderId: groups[0]._id,
      supplierOrderIdReference: "SUP-ORDER-A",
      carrier: "Test Carrier",
      trackingNumber: "TRACK-A",
    };
    await admin.mutation(api.suppliers.completeManualFulfilment, args);
    expect(
      (await t.run((ctx) => ctx.db.get(ids.order)))?.fulfilmentStatus,
    ).toBe("processing");
    await admin.mutation(api.suppliers.completeManualFulfilment, args);
    expect(
      await t.run((ctx) => ctx.db.query("shipments").collect()),
    ).toHaveLength(1);
    await admin.mutation(api.suppliers.completeManualFulfilment, {
      ...args,
      supplierOrderId: groups[1]._id,
      supplierOrderIdReference: "SUP-ORDER-B",
      trackingNumber: "TRACK-B",
    });
    expect(
      (await t.run((ctx) => ctx.db.get(ids.order)))?.fulfilmentStatus,
    ).toBe("shipped");
    const shipments = await t.run((ctx) => ctx.db.query("shipments").collect());
    expect(shipments).toHaveLength(2);
    expect(new Set(shipments.map((x) => x.trackingNumber)).size).toBe(2);
  });
  test("cancelled and unpaid orders cannot be marked submitted", async () => {
    const { t, ids, admin } = await fixture();
    await t.run(async (ctx) =>
      queueFulfilmentForOrder(ctx, (await ctx.db.get(ids.order))!),
    );
    const group = (
      await t.run((ctx) => ctx.db.query("supplier_orders").collect())
    )[0];
    await t.run((ctx) => ctx.db.patch(ids.order, { paymentStatus: "pending" }));
    await expect(
      admin.mutation(api.suppliers.completeManualFulfilment, {
        supplierOrderId: group._id,
        supplierOrderIdReference: "TEST",
      }),
    ).rejects.toThrow(/Payment/);
    await t.run((ctx) =>
      ctx.db.patch(ids.order, {
        paymentStatus: "paid",
        fulfilmentStatus: "cancelled",
      }),
    );
    await expect(
      admin.mutation(api.suppliers.completeManualFulfilment, {
        supplierOrderId: group._id,
        supplierOrderIdReference: "TEST",
      }),
    ).rejects.toThrow(/Cancelled/);
  });
  test("feed changes stay scoped and cannot restore checkout deductions or change selling prices", async () => {
    const { t, ids } = await fixture();
    const { jobId } = await t.run(async (ctx) => {
      await ctx.db.patch(ids.a, {
        connector: "feed_url",
        apiStatus: "not_configured",
      });
      await ctx.db.insert("supplier_products", {
        supplierId: ids.a,
        supplierProductId: "1",
        supplierSku: "SUP1",
        productId: ids.p,
        title: "Test",
        costMinor: 2000,
        currency: "INR",
        stock: 10,
        stockBaselineKnown: true,
        availability: "in_stock",
        lastSyncedAt: 1,
      });
      return {
        jobId: await ctx.db.insert("supplier_sync_jobs", {
          supplierId: ids.a,
          type: "full_catalog",
          status: "queued",
          scheduledFor: 1,
          attempts: 0,
          maxAttempts: 3,
          createdAt: 1,
        }),
      };
    });
    expect(
      await t.mutation(internal.suppliers.claimSyncJob, {
        jobId,
        supplierId: ids.a,
      }),
    ).toBe(true);
    expect(
      await t.mutation(internal.suppliers.claimSyncJob, {
        jobId,
        supplierId: ids.a,
      }),
    ).toBe(false);
    const result = await t.mutation(internal.suppliers.applyFeedItems, {
      jobId,
      supplierId: ids.a,
      items: [
        { supplierSku: "SUP1", costMinor: 2500, stock: 10, currency: "INR" },
        { supplierSku: "P1", stock: 100, currency: "INR" },
      ],
      updateStock: true,
      updateCost: true,
    });
    expect(result.unmatched).toBe(1);
    const p = await t.run((ctx) => ctx.db.get(ids.p));
    expect(p).toMatchObject({ priceMinor: 10000, costMinor: 2500, stock: 8 });
    await t.mutation(internal.suppliers.applyFeedItems, {
      jobId,
      supplierId: ids.a,
      items: [{ supplierSku: "SUP1", stock: 50, currency: "INR" }],
      updateStock: true,
      updateCost: true,
    });
    expect((await t.run((ctx) => ctx.db.get(ids.p)))?.stock).toBe(8);
  });
  test("price-only feeds preserve publication and stock, while malformed batches roll back", async () => {
    const { t, ids } = await fixture();
    const makeJob = () =>
      t.run(async (ctx) => {
        await ctx.db.patch(ids.a, { connector: "feed_url" });
        return ctx.db.insert("supplier_sync_jobs", {
          supplierId: ids.a,
          type: "price",
          status: "running",
          scheduledFor: 1,
          attempts: 0,
          maxAttempts: 3,
          createdAt: 1,
        });
      });
    const jobId = await makeJob();
    await t.mutation(internal.suppliers.applyFeedItems, {
      jobId,
      supplierId: ids.a,
      items: [
        {
          supplierSku: "SUP1",
          costMinor: 3000,
          stock: 0,
          availability: "out_of_stock",
          currency: "INR",
        },
      ],
      updateCost: true,
      updateStock: false,
    });
    expect(await t.run((ctx) => ctx.db.get(ids.p))).toMatchObject({
      stock: 8,
      status: "published",
      costMinor: 3000,
    });
    const duplicateJob = await makeJob();
    await expect(
      t.mutation(internal.suppliers.applyFeedItems, {
        jobId: duplicateJob,
        supplierId: ids.a,
        items: [
          { supplierSku: "SUP1", stock: 0 },
          { supplierSku: "SUP1", stock: 10 },
        ],
        updateCost: false,
        updateStock: true,
      }),
    ).rejects.toThrow(/duplicate/);
    expect((await t.run((ctx) => ctx.db.get(ids.p)))?.stock).toBe(8);
    await expect(
      t.mutation(internal.suppliers.applyFeedItems, {
        jobId: duplicateJob,
        supplierId: ids.a,
        items: [{ supplierSku: "SUP1", currency: "USD", costMinor: 1 }],
        updateCost: true,
        updateStock: true,
      }),
    ).rejects.toThrow(/currency/);
  });
  test("mapping rejects cross-currency costs and unmapping clears product routing", async () => {
    const { t, ids, admin } = await fixture();
    const mapping = await t.run((ctx) =>
      ctx.db.insert("supplier_products", {
        supplierId: ids.a,
        supplierProductId: "1",
        supplierSku: "SUP1",
        title: "Test",
        costMinor: 100,
        currency: "USD",
        stock: 1,
        availability: "in_stock",
        lastSyncedAt: 1,
      }),
    );
    await expect(
      admin.mutation(api.suppliers.mapSupplierProduct, {
        supplierProductId: mapping,
        productId: ids.p,
      }),
    ).rejects.toThrow(/currencies/);
    await t.run((ctx) => ctx.db.patch(mapping, { currency: "INR" }));
    await admin.mutation(api.suppliers.mapSupplierProduct, {
      supplierProductId: mapping,
      productId: ids.p,
    });
    await admin.mutation(api.suppliers.mapSupplierProduct, {
      supplierProductId: mapping,
    });
    expect(
      (await t.run((ctx) => ctx.db.get(ids.p)))?.supplierId,
    ).toBeUndefined();
  });
  test("imports reject duplicate SKUs before commit and never store a fake product id", async () => {
    const { t, ids, admin } = await fixture();
    const result = await admin.mutation(api.imports.startImport, {
      type: "csv",
      fileName: "fixture.csv",
      fileSizeBytes: 100,
      rows: [
        { name: "New", sku: "NEW", price: "100", stock: "2" },
        { name: "Duplicate", sku: "NEW", price: "200", stock: "2" },
      ],
      mode: "upsert",
      publish: false,
      supplierId: ids.a,
    });
    expect(result).toMatchObject({ validRows: 1, invalidRows: 1 });
    await admin.mutation(api.imports.commitImportBatch, {
      jobId: result.jobId,
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("products")
          .withIndex("by_sku", (q) => q.eq("sku", "NEW"))
          .collect(),
      ),
    ).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(result.jobId)))?.status).toBe(
      "completed",
    );
  });
});
describe("feed and pricing boundaries", () => {
  test("CSV supports multiline text, escaped quotes and BOM; rejects malformed input", () => {
    expect(
      parseCsvRecords('\ufeffSKU,Name\r\nA,"First\nsecond ""quoted"" line"')[0],
    ).toEqual({ SKU: "A", Name: 'First\nsecond "quoted" line' });
    expect(() => parseCsvRecords("SKU,SKU\nA,B")).toThrow();
    expect(() => parseCsvRecords('SKU,Name\nA,"unterminated')).toThrow();
  });
  test("unknown availability remains unknown and invalid numeric fields fail closed", () => {
    expect(
      feedRowsToItems([{ sku: "A", availability: "mystery" }])[0].availability,
    ).toBe("unknown");
    for (const stock of ["NaN", "1.5", "-1", "Infinity"])
      expect(() => feedRowsToItems([{ sku: "A", stock }])).toThrow();
  });
  test("contribution includes shipping, fees, returns reserve and tax; zero price is finite", () => {
    expect(
      supplierContribution(100000, 40000, 6000, 2000, 5000, 10000),
    ).toEqual({ contributionMinor: 37000, marginPercent: 37 });
    expect(supplierContribution(0, 100, 0, 0, 0).marginPercent).toBe(0);
    expect(() => supplierContribution(1.5, 0, 0, 0, 0)).toThrow();
  });
  test("network guard rejects loopback, metadata, private DNS, credentials and unsafe protocols", () => {
    for (const url of [
      "http://example.com",
      "https://127.0.0.1",
      "https://[::1]",
      "https://169.254.169.254",
      "https://user:secret@example.com",
      "https://example.com:8443",
      "https://svc.local",
    ])
      expect(() => validatePublicHttps(url)).toThrow();
    for (const ip of [
      "10.0.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "2002:a00:1::",
      "2001:db8::1",
      "2001::1",
    ])
      expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(
      validatePublicHttps("https://example.com/catalog.csv").hostname,
    ).toBe("example.com");
  });
});
