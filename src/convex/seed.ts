import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { getSettings } from "./lib/settings";
import { normalizeSku, slugify } from "./lib/util";

/* ------------------------------------------------------------------ *
 * Foundation data
 *
 * Categories, brands and supplier records are real configuration and safe to
 * seed. The demo catalog below is sample data, flagged `isDemo: true`, and can
 * be removed in one click from the admin dashboard.
 * ------------------------------------------------------------------ */

const CATEGORY_TREE: {
  name: string;
  icon: string;
  children: string[];
  attributes?: { key: string; label: string; options: string[] }[];
}[] = [
  {
    name: "Electronics and Gadgets",
    icon: "Cpu",
    children: ["Audio", "Chargers and Power", "Smart Home", "Computer Accessories"],
    attributes: [{ key: "warranty", label: "Warranty", options: ["6 months", "1 year", "2 years"] }],
  },
  { name: "Fashion and Clothing", icon: "Shirt", children: ["Men", "Women", "Kids", "Winter Wear"], attributes: [{ key: "size", label: "Size", options: ["XS", "S", "M", "L", "XL", "XXL"] }] },
  {
    name: "Shoes and Accessories",
    icon: "Footprints",
    children: ["Sneakers", "Formal Shoes", "Bags", "Watches"],
    attributes: [{ key: "size", label: "Shoe size", options: ["UK 6", "UK 7", "UK 8", "UK 9", "UK 10"] }],
  },
  { name: "Home and Kitchen", icon: "CookingPot", children: ["Cookware", "Home Decor", "Storage", "Bedding"] },
  { name: "Beauty and Personal Care", icon: "Sparkles", children: ["Skin Care", "Hair Care", "Grooming", "Fragrance"] },
  { name: "Fitness and Sports Accessories", icon: "Dumbbell", children: ["Home Gym", "Yoga", "Sports Gear", "Cycling"] },
  { name: "Toys and Games", icon: "ToyBrick", children: ["Building Sets", "Board Games", "Outdoor Play", "Learning"] },
  { name: "Travel and Lifestyle", icon: "Luggage", children: ["Luggage", "Travel Accessories", "Camping"] },
  { name: "Office and Stationery", icon: "Briefcase", children: ["Desk Organisers", "Notebooks", "Printing", "Office Electronics"] },
  { name: "Automotive Accessories", icon: "Car", children: ["Car Care", "Interior", "Tools", "Bike Accessories"] },
  { name: "Outdoor Products", icon: "Tent", children: ["Lighting", "Adventure Gear", "Garden"] },
];

const DEMO_BRANDS = [
  "KNOKH Basics",
  "Northline",
  "Kiran Home",
  "Trailhead",
  "Aura Living",
  "Voltway",
];

type DemoProduct = {
  name: string;
  category: string;
  subcategory?: string;
  price: number;
  compareAt?: number;
  cost: number;
  stock: number;
  brand: string;
  summary: string;
};

const DEMO_PRODUCTS: DemoProduct[] = [
  { name: "Voltway 65W GaN Fast Charger", category: "Electronics and Gadgets", subcategory: "Chargers and Power", price: 2499, compareAt: 3499, cost: 1180, stock: 42, brand: "Voltway", summary: "Dual USB-C GaN charger with laptop-grade output." },
  { name: "Voltway Wireless Earbuds ANC", category: "Electronics and Gadgets", subcategory: "Audio", price: 3299, compareAt: 4999, cost: 1520, stock: 30, brand: "Voltway", summary: "Active noise cancelling earbuds with 34-hour case battery." },
  { name: "Northline Bluetooth Party Speaker", category: "Electronics and Gadgets", subcategory: "Audio", price: 4799, cost: 2350, stock: 18, brand: "Northline", summary: "20W portable speaker with IPX6 splash resistance." },
  { name: "Voltway Smart Wi-Fi Plug (2 pack)", category: "Electronics and Gadgets", subcategory: "Smart Home", price: 1899, cost: 820, stock: 55, brand: "Voltway", summary: "16A smart plugs with scheduling and energy metering." },
  { name: "Northline Laptop Sleeve 14\"", category: "Electronics and Gadgets", subcategory: "Computer Accessories", price: 1299, compareAt: 1799, cost: 520, stock: 64, brand: "Northline", summary: "Water-resistant padded sleeve with accessory pocket." },
  { name: "KNOKH Basics Cotton Crew T-Shirt", category: "Fashion and Clothing", subcategory: "Men", price: 799, compareAt: 1199, cost: 310, stock: 120, brand: "KNOKH Basics", summary: "240 GSM combed cotton tee, pre-shrunk." },
  { name: "KNOKH Basics Everyday Kurta", category: "Fashion and Clothing", subcategory: "Women", price: 1499, cost: 640, stock: 70, brand: "KNOKH Basics", summary: "Breathable cotton kurta with side pockets." },
  { name: "Aura Living Fleece Hoodie", category: "Fashion and Clothing", subcategory: "Winter Wear", price: 2199, compareAt: 2999, cost: 980, stock: 35, brand: "Aura Living", summary: "Brushed fleece hoodie with kangaroo pocket." },
  { name: "KNOKH Basics Kids Puffer Jacket", category: "Fashion and Clothing", subcategory: "Kids", price: 1799, cost: 760, stock: 28, brand: "KNOKH Basics", summary: "Lightweight quilted jacket for 4-10 years." },
  { name: "Trailhead Everyday Sneakers", category: "Shoes and Accessories", subcategory: "Sneakers", price: 2699, compareAt: 3799, cost: 1180, stock: 48, brand: "Trailhead", summary: "Cushioned knit sneakers with memory-foam insole." },
  { name: "Trailhead Formal Leather Shoes", category: "Shoes and Accessories", subcategory: "Formal Shoes", price: 3499, cost: 1620, stock: 22, brand: "Trailhead", summary: "Genuine leather derby with anti-slip sole." },
  { name: "Northline Cabin Trolley 55cm", category: "Shoes and Accessories", subcategory: "Bags", price: 4299, compareAt: 5999, cost: 2100, stock: 16, brand: "Northline", summary: "Polycarbonate cabin trolley with TSA lock." },
  { name: "Aura Living Minimal Steel Watch", category: "Shoes and Accessories", subcategory: "Watches", price: 2999, cost: 1290, stock: 26, brand: "Aura Living", summary: "Sapphire-coated glass with mesh strap." },
  { name: "Kiran Home Triply Stainless Kadai", category: "Home and Kitchen", subcategory: "Cookware", price: 2799, compareAt: 3999, cost: 1310, stock: 40, brand: "Kiran Home", summary: "Induction-friendly triply kadai with glass lid." },
  { name: "Kiran Home Ceramic Dinner Set (18 pc)", category: "Home and Kitchen", subcategory: "Cookware", price: 3499, cost: 1580, stock: 24, brand: "Kiran Home", summary: "Microwave-safe ceramic dinner set for six." },
  { name: "Aura Living Cotton Bedsheet Set", category: "Home and Kitchen", subcategory: "Bedding", price: 1899, compareAt: 2599, cost: 820, stock: 60, brand: "Aura Living", summary: "300 thread-count king bedsheet with two pillow covers." },
  { name: "Kiran Home Modular Storage Bins (3)", category: "Home and Kitchen", subcategory: "Storage", price: 1099, cost: 470, stock: 80, brand: "Kiran Home", summary: "Stackable bins with label windows." },
  { name: "Aura Living Vitamin C Face Serum", category: "Beauty and Personal Care", subcategory: "Skin Care", price: 899, compareAt: 1299, cost: 320, stock: 90, brand: "Aura Living", summary: "10% stabilised vitamin C with hyaluronic acid." },
  { name: "Aura Living Argan Hair Oil", category: "Beauty and Personal Care", subcategory: "Hair Care", price: 649, cost: 240, stock: 110, brand: "Aura Living", summary: "Cold-pressed argan oil, non-sticky finish." },
  { name: "Northline Cordless Beard Trimmer", category: "Beauty and Personal Care", subcategory: "Grooming", price: 1599, cost: 690, stock: 44, brand: "Northline", summary: "40-setting trimmer with 90-minute runtime." },
  { name: "Trailhead Adjustable Dumbbell Set", category: "Fitness and Sports Accessories", subcategory: "Home Gym", price: 5499, compareAt: 7299, cost: 2600, stock: 14, brand: "Trailhead", summary: "Pair of adjustable dumbbells, 2.5-12 kg each." },
  { name: "Trailhead Anti-Slip Yoga Mat 6mm", category: "Fitness and Sports Accessories", subcategory: "Yoga", price: 1299, cost: 540, stock: 70, brand: "Trailhead", summary: "TPE mat with alignment lines and carry strap." },
  { name: "Trailhead 21-Speed City Cycle Helmet", category: "Fitness and Sports Accessories", subcategory: "Cycling", price: 1899, cost: 810, stock: 30, brand: "Trailhead", summary: "Vented helmet with adjustable dial fit." },
  { name: "KNOKH Basics STEM Building Blocks (250)", category: "Toys and Games", subcategory: "Building Sets", price: 1499, compareAt: 1999, cost: 630, stock: 52, brand: "KNOKH Basics", summary: "Interlocking blocks with a project idea booklet." },
  { name: "KNOKH Basics Family Board Game", category: "Toys and Games", subcategory: "Board Games", price: 899, cost: 340, stock: 66, brand: "KNOKH Basics", summary: "Strategy board game for 2-6 players, ages 8+." },
  { name: "Northline Hard Shell Suitcase 68cm", category: "Travel and Lifestyle", subcategory: "Luggage", price: 5999, compareAt: 7999, cost: 2880, stock: 12, brand: "Northline", summary: "Spinner suitcase with expandable zip section." },
  { name: "Trailhead 4-Person Dome Tent", category: "Outdoor Products", subcategory: "Adventure Gear", price: 6499, cost: 3100, stock: 10, brand: "Trailhead", summary: "Double-layer dome tent, 3000mm waterproof rating." },
  { name: "Trailhead Solar Camping Lantern", category: "Outdoor Products", subcategory: "Lighting", price: 1199, compareAt: 1699, cost: 480, stock: 58, brand: "Trailhead", summary: "Collapsible lantern with solar and USB charging." },
  { name: "KNOKH Basics Bamboo Desk Organiser", category: "Office and Stationery", subcategory: "Desk Organisers", price: 1099, cost: 440, stock: 47, brand: "KNOKH Basics", summary: "Five-compartment bamboo organiser." },
  { name: "KNOKH Basics A5 Dotted Notebook (3)", category: "Office and Stationery", subcategory: "Notebooks", price: 599, cost: 190, stock: 130, brand: "KNOKH Basics", summary: "160-page dotted notebooks, 120 GSM paper." },
  { name: "Voltway Compact Label Printer", category: "Office and Stationery", subcategory: "Office Electronics", price: 2899, cost: 1350, stock: 21, brand: "Voltway", summary: "Bluetooth label printer with app templates." },
  { name: "Northline Car Vacuum Cleaner 120W", category: "Automotive Accessories", subcategory: "Car Care", price: 2299, compareAt: 3199, cost: 990, stock: 33, brand: "Northline", summary: "Corded 12V vacuum with HEPA filter." },
  { name: "Northline Magnetic Phone Car Mount", category: "Automotive Accessories", subcategory: "Interior", price: 799, cost: 260, stock: 96, brand: "Northline", summary: "N52 magnet mount with 360° rotation." },
  { name: "Northline Motorcycle Phone Mount", category: "Automotive Accessories", subcategory: "Bike Accessories", price: 1299, cost: 520, stock: 40, brand: "Northline", summary: "Anti-vibration mount with USB charger port." },
  { name: "Kiran Home Cast Iron Grill Pan", category: "Home and Kitchen", subcategory: "Cookware", price: 1999, cost: 880, stock: 26, brand: "Kiran Home", summary: "Pre-seasoned cast iron grill pan." },
];

/** Demo photography uses a deterministic placeholder service, not supplier assets. */
function demoImage(seed: string, index: number): string {
  return `https://picsum.photos/seed/knokh-${slugify(seed).slice(0, 28)}-${index}/900/900`;
}

export const seedFoundation = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    void admin;
    const existingCategories = await ctx.db.query("categories").take(300);
    let categoriesCreated = 0;

    for (let index = 0; index < CATEGORY_TREE.length; index++) {
      const parent = CATEGORY_TREE[index];
      let parentId = existingCategories.find(
        (category) => category.slug === slugify(parent.name) && !category.parentId,
      )?._id;
      if (!parentId) {
        parentId = await ctx.db.insert("categories", {
          name: parent.name,
          slug: slugify(parent.name),
          position: index,
          featured: index < 8,
          status: "active",
          icon: parent.icon,
          attributes: parent.attributes,
          image: `https://picsum.photos/seed/knokh-cat-${slugify(parent.name).slice(0, 20)}/600/600`,
        });
        categoriesCreated += 1;
      }
      for (let childIndex = 0; childIndex < parent.children.length; childIndex++) {
        const childName = parent.children[childIndex];
        const exists = existingCategories.find(
          (category) => category.slug === slugify(childName) && category.parentId === parentId,
        );
        if (!exists) {
          await ctx.db.insert("categories", {
            name: childName,
            slug: slugify(childName),
            parentId,
            position: childIndex,
            featured: false,
            status: "active",
          });
          categoriesCreated += 1;
        }
      }
    }

    const existingBrands = await ctx.db.query("brands").take(300);
    let brandsCreated = 0;
    for (const name of DEMO_BRANDS) {
      if (existingBrands.some((brand) => brand.slug === slugify(name))) continue;
      await ctx.db.insert("brands", {
        name,
        slug: slugify(name),
        status: "active",
        description: `${name} products available on KNOKH.`,
      });
      brandsCreated += 1;
    }

    const existingSuppliers = await ctx.db.query("suppliers").take(100);
    if (!existingSuppliers.some((supplier) => supplier.connector === "manual")) {
      const supplierId = await ctx.db.insert("suppliers", {
        name: "Manual fulfilment (in-house stock)",
        slug: "manual-fulfilment",
        country: "IN",
        currency: "INR",
        connector: "manual",
        apiStatus: "connected",
        supportsProductApi: false,
        supportsOrderApi: false,
        supportsStockSync: false,
        supportsPriceSync: false,
        importMethods: ["csv", "xlsx"],
        processingTimeDays: 2,
        shippingRegions: ["IN", "US", "GB", "AE", "SG"],
        returnPolicy: "7-day return window for unused items in original packaging.",
        notes:
          "Default supplier record for products you ship yourself. No API: orders are queued as manual fulfilment tasks.",
        createdAt: Date.now(),
      });
      await ctx.db.insert("supplier_connections", {
        supplierId,
        label: "Manual / email fulfilment",
        authType: "manual",
        envVars: [],
        status: "connected",
        createdAt: Date.now(),
      });
    }
    if (!existingSuppliers.some((supplier) => supplier.connector === "feed_url")) {
      const supplierId = await ctx.db.insert("suppliers", {
        name: "Catalog feed supplier (configure URL)",
        slug: "catalog-feed-supplier",
        country: "CN",
        currency: "USD",
        connector: "feed_url",
        apiStatus: "pending_credentials",
        supportsProductApi: false,
        supportsOrderApi: false,
        supportsStockSync: true,
        supportsPriceSync: true,
        importMethods: ["feed", "csv", "xlsx"],
        processingTimeDays: 3,
        shippingRegions: ["IN", "US", "GB", "AE"],
        notes:
          "Ready-to-use connector. Set SUPPLIER_FEED_URL (and SUPPLIER_FEED_TOKEN if needed) to sync cost and stock from a feed you are authorised to consume.",
        createdAt: Date.now(),
      });
      await ctx.db.insert("supplier_connections", {
        supplierId,
        label: "Catalog feed (JSON/CSV feed URL)",
        authType: "feed_url",
        envVars: ["SUPPLIER_FEED_URL", "SUPPLIER_FEED_TOKEN"],
        status: "pending_credentials",
        createdAt: Date.now(),
      });
    }

    const coupon = await ctx.db
      .query("coupons")
      .withIndex("by_code", (q) => q.eq("code", "WELCOME10"))
      .unique();
    if (!coupon) {
      await ctx.db.insert("coupons", {
        code: "WELCOME10",
        description: "10% off your first order above ₹1,499",
        type: "percent",
        value: 10,
        currency: "INR",
        minOrderMinor: 149900,
        maxDiscountMinor: 50000,
        usageLimit: undefined,
        usedCount: 0,
        perUserLimit: 1,
        status: "active",
        createdAt: Date.now(),
      });
    }

    await getSettings(ctx);

    return {
      categoriesCreated,
      brandsCreated,
      suppliersReady: true,
    };
  },
});

/**
 * Sample catalog. Everything created here is flagged `isDemo: true` and is
 * explicitly NOT real supplier, stock or sales data. Remove it from
 * Admin → Products → "Remove demo catalog" before going live.
 */
export const seedDemoCatalog = mutation({
  args: { count: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const settings = await getSettings(ctx);
    const categories = await ctx.db.query("categories").take(300);
    const brands = await ctx.db.query("brands").take(300);
    const manualSupplier = (await ctx.db.query("suppliers").take(100)).find(
      (supplier) => supplier.connector === "manual",
    );

    const limit = Math.min(args.count ?? DEMO_PRODUCTS.length, DEMO_PRODUCTS.length);
    let created = 0;

    for (const demo of DEMO_PRODUCTS.slice(0, limit)) {
      const sku = normalizeSku(`DEMO-${slugify(demo.name).slice(0, 24)}`);
      const existing = await ctx.db
        .query("products")
        .withIndex("by_sku", (q) => q.eq("sku", sku))
        .unique();
      if (existing) continue;

      const parent = categories.find(
        (category) => category.name === demo.category && !category.parentId,
      );
      const child = demo.subcategory
        ? categories.find(
            (category) =>
              category.name === demo.subcategory && category.parentId === parent?._id,
          )
        : undefined;
      const brand = brands.find((entry) => entry.name === demo.brand);

      await ctx.db.insert("products", {
        name: demo.name,
        slug: slugify(demo.name),
        sku,
        searchText: `${demo.name} ${demo.summary} ${sku}`,
        summary: demo.summary,
        description: `${demo.summary}\n\nThis is sample catalog data supplied with the KNOKH template so the storefront can be reviewed before your real catalog is imported. Replace it with your own products (Admin → Import) before selling.`,
        priceMinor: Math.round(demo.price * 100),
        compareAtMinor: demo.compareAt ? Math.round(demo.compareAt * 100) : undefined,
        costMinor: Math.round(demo.cost * 100),
        currency: settings.commerce.baseCurrency,
        stock: demo.stock,
        lowStockThreshold: 5,
        images: [
          { url: demoImage(demo.name, 1), alt: demo.name, position: 0 },
          { url: demoImage(demo.name, 2), alt: `${demo.name} detail`, position: 1 },
          { url: demoImage(demo.name, 3), alt: `${demo.name} in use`, position: 2 },
        ],
        categoryId: parent?._id,
        subcategoryId: child?._id,
        brandId: brand?._id,
        supplierId: manualSupplier?._id,
        supplierSku: normalizeSku(`SUP-${slugify(demo.name).slice(0, 20)}`),
        status: "published",
        featured: created < 8,
        isDemo: true,
        deliveryEstimateDays: 5,
        shipsTo: ["IN", "US", "GB", "AE", "SG"],
        weightGrams: 500,
        specs: [
          { label: "Category", value: demo.subcategory ?? demo.category },
          { label: "Brand", value: demo.brand },
          { label: "Country of dispatch", value: "India" },
        ],
        unitsSold: 0,
        ratingCount: 0,
        views: 0,
        seoTitle: `${demo.name} | KNOKH`,
        seoDescription: demo.summary.slice(0, 160),
        updatedAt: Date.now(),
      });
      created += 1;
    }

    return { created, isDemo: true };
  },
});

/** One-click removal of every product flagged as demo data. */
export const removeDemoCatalog = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const products = await ctx.db.query("products").take(1000);
    let removed = 0;
    for (const product of products) {
      if (product.isDemo !== true) continue;
      const items = await ctx.db
        .query("order_items")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .take(1);
      if (items.length > 0) continue; // never delete a product that has real orders
      const movements = await ctx.db
        .query("inventory_movements")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .take(100);
      for (const movement of movements) await ctx.db.delete(movement._id);
      await ctx.db.delete(product._id);
      removed += 1;
    }
    return { removed };
  },
});
