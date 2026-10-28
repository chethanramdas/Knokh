/**
 * KNOKH central configuration (server side).
 *
 * Everything a shop owner is expected to change lives here as a default and can
 * be overridden at runtime from Admin → Settings (stored in `site_settings`).
 *
 * IMPORTANT: no company registration numbers, addresses, phone numbers or
 * certifications are invented here. Values below are clearly marked
 * placeholders that must be replaced by the real business before launch.
 */

export const SETTINGS_KEY = "global";

export type CurrencyConfig = {
  code: string;
  symbol: string;
  name: string;
  /** 1 unit of this currency = `rateToBase` units of the base currency. */
  rateToBase: number;
  enabled: boolean;
  /** Decimal places to show. */
  decimals: number;
};

export type ShippingZone = {
  countryCode: string;
  country: string;
  zone: string;
  rateMinor: number;
  freeAboveMinor: number;
  etaDays: number;
  serviceable: boolean;
  codAvailable: boolean;
};

export type TaxRule = {
  countryCode: string;
  label: string;
  ratePercent: number;
  /** True when catalog prices already include the tax (India GST style). */
  inclusive: boolean;
};

export type PaymentProviderConfig = {
  id: string;
  label: string;
  /** Convex environment variables that must be configured before this works. */
  envVars: string[];
  /** Country codes this provider can process payments for. */
  countries: string[];
  currencies: string[];
  enabled: boolean;
  status: "configured" | "pending_credentials" | "disabled";
  docsUrl: string;
  supportsRefunds: boolean;
  supportsWebhooks: boolean;
};

export type HomeSection = {
  id: string;
  type:
    | "hero"
    | "category_grid"
    | "product_row"
    | "promo_banner"
    | "trust_badges"
    | "newsletter"
    | "recently_viewed"
    | "collection_row"
    | "brand_strip";
  title: string;
  subtitle?: string;
  enabled: boolean;
  position: number;
  /** Row source: new_arrivals | best_sellers | trending | featured | deals */
  source?: string;
  limit?: number;
  ctaLabel?: string;
  ctaHref?: string;
  image?: string;
};

export type SiteSettings = {
  brand: {
    name: string;
    wordmark: string;
    tagline: string;
    domain: string;
  };
  contact: {
    /** Placeholders — the real business details must be entered in Admin → Settings. */
    supportEmail: string;
    salesEmail: string;
    phone: string;
    addressLines: string[];
    hours: string;
  };
  legal: {
    legalEntityName: string;
    gstin: string;
    cin: string;
    countryOfOperation: string;
  };
  commerce: {
    baseCurrency: string;
    defaultCurrency: string;
    freeShippingThresholdMinor: number;
    codEnabled: boolean;
    guestCheckoutEnabled: boolean;
    newsletterEnabled: boolean;
    reviewsEnabled: boolean;
    maxImportRows: number;
    maxImportFileBytes: number;
    /** Hide products automatically when a supplier sync reports zero stock. */
    autoHideUnavailable: boolean;
  };
  pricing: {
    defaultMarkupPercent: number;
    minimumMarginPercent: number;
    /** "none" | "nearest_99" (₹X99) | "nearest_whole" */
    rounding: string;
    /** categoryId -> markup percent override */
    categoryMarkup: Record<string, number>;
  };
  payments: {
    /** List of providers, each with the env vars it needs. */
    providers: PaymentProviderConfig[];
    /** Enables the built-in signed test-gateway harness (see README). */
    testGatewayEnabled: boolean;
    testGatewayWebhookSecretEnvVar: string;
  };
  currencies: CurrencyConfig[];
  shippingZones: ShippingZone[];
  taxRules: TaxRule[];
  seo: {
    siteUrl: string;
    defaultTitle: string;
    defaultDescription: string;
    /** Optional GA4 / privacy-friendly analytics ID. Blank = no analytics. */
    analyticsId: string;
    organisationTwitter: string;
  };
  homepage: HomeSection[];
};

export const DEFAULT_SETTINGS: SiteSettings = {
  brand: {
    name: "KNOKH",
    wordmark: "KNOKH",
    tagline: "Your World. One Marketplace.",
    domain: "",
  },
  contact: {
    supportEmail: "support@example.com",
    salesEmail: "sales@example.com",
    phone: "",
    addressLines: [],
    hours: "Mon–Sat, 10:00–18:00 IST",
  },
  legal: {
    legalEntityName: "",
    gstin: "",
    cin: "",
    countryOfOperation: "IN",
  },
  commerce: {
    baseCurrency: "INR",
    defaultCurrency: "INR",
    freeShippingThresholdMinor: 99900,
    codEnabled: true,
    guestCheckoutEnabled: true,
    newsletterEnabled: true,
    reviewsEnabled: true,
    maxImportRows: 5000,
    maxImportFileBytes: 5 * 1024 * 1024,
    autoHideUnavailable: false,
  },
  pricing: {
    defaultMarkupPercent: 35,
    minimumMarginPercent: 12,
    rounding: "none",
    categoryMarkup: {},
  },
  payments: {
    providers: [
      {
        id: "razorpay",
        label: "Razorpay",
        envVars: [
          "RAZORPAY_KEY_ID",
          "RAZORPAY_KEY_SECRET",
          "RAZORPAY_WEBHOOK_SECRET",
        ],
        countries: ["IN"],
        currencies: ["INR"],
        enabled: false,
        status: "pending_credentials",
        docsUrl: "https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/",
        supportsRefunds: true,
        supportsWebhooks: true,
      },
      {
        id: "cashfree",
        label: "Cashfree Payments",
        envVars: [
          "CASHFREE_CLIENT_ID",
          "CASHFREE_CLIENT_SECRET",
          "CASHFREE_ENV",
        ],
        countries: ["IN"],
        currencies: ["INR"],
        enabled: false,
        status: "pending_credentials",
        docsUrl: "https://www.cashfree.com/docs/api-reference/payments/latest",
        supportsRefunds: true,
        supportsWebhooks: true,
      },
      {
        id: "paypal",
        label: "PayPal",
        envVars: [
          "PAYPAL_CLIENT_ID",
          "PAYPAL_CLIENT_SECRET",
          "PAYPAL_WEBHOOK_ID",
          "PAYPAL_ENV",
        ],
        countries: ["US", "GB", "AE", "SG", "AU", "CA", "EU"],
        currencies: ["USD", "EUR", "GBP"],
        enabled: false,
        status: "pending_credentials",
        docsUrl: "https://developer.paypal.com/docs/checkout/standard/",
        supportsRefunds: true,
        supportsWebhooks: true,
      },
    ],
    /**
     * The built-in test gateway is NOT a real payment provider. It is a signed
     * sandbox that exercises the exact same order → session → signed webhook →
     * verification → fulfilment pipeline so the platform can be tested without
     * merchant approval. It must be disabled for a live store.
     */
    testGatewayEnabled: true,
    testGatewayWebhookSecretEnvVar: "TEST_GATEWAY_WEBHOOK_SECRET",
  },
  currencies: [
    { code: "INR", symbol: "₹", name: "Indian Rupee", rateToBase: 1, enabled: true, decimals: 2 },
    { code: "USD", symbol: "$", name: "US Dollar", rateToBase: 84, enabled: true, decimals: 2 },
    { code: "EUR", symbol: "€", name: "Euro", rateToBase: 91, enabled: true, decimals: 2 },
    { code: "GBP", symbol: "£", name: "Pound Sterling", rateToBase: 107, enabled: true, decimals: 2 },
    { code: "AED", symbol: "د.إ", name: "UAE Dirham", rateToBase: 23, enabled: true, decimals: 2 },
    { code: "AUD", symbol: "A$", name: "Australian Dollar", rateToBase: 55, enabled: false, decimals: 2 },
  ],
  shippingZones: [
    { countryCode: "IN", country: "India", zone: "domestic", rateMinor: 5900, freeAboveMinor: 99900, etaDays: 4, serviceable: true, codAvailable: true },
    { countryCode: "US", country: "United States", zone: "international", rateMinor: 149900, freeAboveMinor: 0, etaDays: 12, serviceable: true, codAvailable: false },
    { countryCode: "GB", country: "United Kingdom", zone: "international", rateMinor: 139900, freeAboveMinor: 0, etaDays: 12, serviceable: true, codAvailable: false },
    { countryCode: "AE", country: "United Arab Emirates", zone: "international", rateMinor: 99000, freeAboveMinor: 0, etaDays: 9, serviceable: true, codAvailable: false },
    { countryCode: "SG", country: "Singapore", zone: "international", rateMinor: 119900, freeAboveMinor: 0, etaDays: 10, serviceable: true, codAvailable: false },
    { countryCode: "AU", country: "Australia", zone: "international", rateMinor: 159900, freeAboveMinor: 0, etaDays: 14, serviceable: false, codAvailable: false },
  ],
  taxRules: [
    { countryCode: "IN", label: "GST (included in price)", ratePercent: 18, inclusive: true },
    { countryCode: "US", label: "Sales tax (est. 0%)", ratePercent: 0, inclusive: false },
    { countryCode: "GB", label: "VAT (est. 20%)", ratePercent: 20, inclusive: false },
    { countryCode: "AE", label: "VAT (est. 5%)", ratePercent: 5, inclusive: false },
    { countryCode: "SG", label: "GST (est. 9%)", ratePercent: 9, inclusive: false },
  ],
  seo: {
    siteUrl: "",
    defaultTitle: "KNOKH — Discover More. Shop Smarter.",
    defaultDescription:
      "KNOKH is a multi-category marketplace for electronics, fashion, home, beauty, fitness, toys, travel, office and automotive products.",
    analyticsId: "",
    organisationTwitter: "",
  },
  homepage: [
    {
      id: "hero-main",
      type: "hero",
      title: "Discover More. Shop Smarter.",
      subtitle:
        "Thousands of products across twelve categories, delivered to your door.",
      enabled: true,
      position: 0,
      ctaLabel: "Shop all products",
      ctaHref: "/shop",
    },
    { id: "cat-grid", type: "category_grid", title: "Shop by category", enabled: true, position: 1 },
    { id: "new-arrivals", type: "product_row", title: "New arrivals", source: "new_arrivals", limit: 8, enabled: true, position: 2, ctaLabel: "View all", ctaHref: "/new-arrivals" },
    { id: "deals", type: "promo_banner", title: "Deals of the week", subtitle: "Genuine markdowns on selected products.", enabled: true, position: 3, ctaLabel: "See all deals", ctaHref: "/deals" },
    { id: "best-sellers", type: "product_row", title: "Best sellers", source: "best_sellers", limit: 8, enabled: true, position: 4, ctaLabel: "View all", ctaHref: "/best-sellers" },
    { id: "trust", type: "trust_badges", title: "Why shop with KNOKH", enabled: true, position: 5 },
    { id: "trending", type: "product_row", title: "Trending now", source: "trending", limit: 8, enabled: true, position: 6, ctaLabel: "View all", ctaHref: "/trending" },
    { id: "collections", type: "collection_row", title: "Featured collections", enabled: true, position: 7 },
    { id: "recent", type: "recently_viewed", title: "Recently viewed", enabled: true, position: 8 },
    { id: "newsletter", type: "newsletter", title: "Get new arrivals and offers", enabled: true, position: 9 },
  ],
};

export function moneyZoneFor(settings: SiteSettings, countryCode: string) {
  return settings.shippingZones.find(
    (zone) => zone.countryCode === countryCode.toUpperCase(),
  );
}

export function taxRuleFor(settings: SiteSettings, countryCode: string) {
  return settings.taxRules.find(
    (rule) => rule.countryCode === countryCode.toUpperCase(),
  );
}

export function currencyFor(settings: SiteSettings, code: string) {
  return (
    settings.currencies.find((currency) => currency.code === code) ?? null
  );
}
