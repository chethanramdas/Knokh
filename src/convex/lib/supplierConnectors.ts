export const CONNECTORS = [
  {
    id: "manual",
    label: "Manual / email fulfilment",
    implemented: true,
    supportsProductApi: false,
    supportsOrderApi: false,
    supportsStockSync: false,
    supportsPriceSync: false,
    importMethods: ["csv", "xlsx", "url"],
    authType: "manual" as const,
    envVars: [] as string[],
    setup:
      "No credentials required. Orders for this supplier are queued as manual fulfilment tasks and you add the shipment tracking yourself.",
  },
  {
    id: "feed_url",
    label: "Catalog feed (JSON/CSV feed URL)",
    implemented: true,
    supportsProductApi: false,
    supportsOrderApi: false,
    supportsStockSync: true,
    supportsPriceSync: true,
    importMethods: ["feed", "csv", "xlsx"],
    authType: "feed_url" as const,
    envVars: ["SUPPLIER_FEED_URL"],
    setup:
      "Set SUPPLIER_FEED_URL to the catalog feed you are authorised to consume (and SUPPLIER_FEED_TOKEN if the feed requires a bearer token). The scheduled sync reads cost and stock only — retail prices are never overwritten.",
  },
  {
    id: "cjdropshipping",
    label: "CJdropshipping",
    implemented: false,
    supportsProductApi: true,
    supportsOrderApi: true,
    supportsStockSync: true,
    supportsPriceSync: true,
    importMethods: ["api", "csv", "xlsx"],
    authType: "api_key" as const,
    envVars: ["CJ_EMAIL", "CJ_API_KEY", "CJ_ACCESS_TOKEN"],
    setup:
      "Register an app in the CJdropshipping developer portal, then set CJ_EMAIL, CJ_API_KEY and the access token in the deployment environment. The connector interface is in place; the request layer must be completed and tested against your account before orders can be forwarded automatically.",
  },
  {
    id: "aliexpress",
    label: "AliExpress (authorised affiliate/open platform)",
    implemented: false,
    supportsProductApi: true,
    supportsOrderApi: false,
    supportsStockSync: false,
    supportsPriceSync: false,
    importMethods: ["api", "csv"],
    authType: "oauth" as const,
    envVars: [
      "ALIEXPRESS_APP_KEY",
      "ALIEXPRESS_APP_SECRET",
      "ALIEXPRESS_ACCESS_TOKEN",
    ],
    setup:
      "Requires an approved AliExpress open-platform application. Product data may only be used within the terms of your agreement. Not implemented in this codebase — use CSV/XLSX or your own feed until approval and testing are complete.",
  },
  {
    id: "dsers",
    label: "DSers-supported channels",
    implemented: false,
    supportsProductApi: false,
    supportsOrderApi: false,
    supportsStockSync: false,
    supportsPriceSync: false,
    importMethods: ["csv", "xlsx"],
    authType: "manual" as const,
    envVars: [],
    setup:
      "DSers is built for Shopify and WooCommerce stores and has no public API for a custom storefront like KNOKH. Use the DSers/CSV export and the spreadsheet importer instead.",
  },
  {
    id: "india_fulfilment",
    label: "Indian fulfilment provider (3PL with API)",
    implemented: false,
    supportsProductApi: false,
    supportsOrderApi: true,
    supportsStockSync: false,
    supportsPriceSync: false,
    importMethods: ["api", "csv"],
    authType: "api_key" as const,
    envVars: ["THREEPL_API_KEY", "THREEPL_ACCOUNT_ID"],
    setup:
      "Add the provider's API key and account id. The order-forwarding interface is implemented; the provider-specific request mapping must be completed against their sandbox before enabling it.",
  },
  {
    id: "qikink",
    label: "Qikink — manual fulfilment",
    implemented: true,
    supportsProductApi: false,
    supportsOrderApi: false,
    supportsStockSync: false,
    supportsPriceSync: false,
    importMethods: ["csv", "xlsx"],
    authType: "manual" as const,
    envVars: [] as string[],
    setup:
      "Manual orders and CSV/XLSX imports are ready. Qikink publishes an Open API, but automatic ordering is disabled until your approved account credentials, current API specification, costs and test orders are verified. Custom products need your own licensed designs. Supplier production and delivery charges apply per order.",
  },
  {
    id: "deodap",
    label: "DeoDap — manual / authorised CSV",
    implemented: true,
    supportsProductApi: false,
    supportsOrderApi: false,
    supportsStockSync: false,
    supportsPriceSync: false,
    importMethods: ["csv", "xlsx"],
    authType: "manual" as const,
    envVars: [] as string[],
    setup:
      "Manual fulfilment and authorised CSV/XLSX imports only. No verified supplier API contract or free CSV subscription has been established. Confirm catalogue rights, delivery, returns and per-order costs with DeoDap; KNOKH does not subscribe to a paid plan or scrape its catalogue.",
  },
];

export function isManualConnector(id: string) {
  return ["manual", "qikink", "deodap"].includes(id);
}
export function connectionReadiness(
  id: string,
  configured: (name: string) => boolean,
) {
  const connector = CONNECTORS.find((c) => c.id === id);
  const missing = (connector?.envVars ?? []).filter((key) => !configured(key));
  if (!connector)
    return {
      status: "not_configured" as const,
      missing,
      message: "Unknown connector. Select a supported connector.",
    };
  if (isManualConnector(id))
    return {
      status: "connected" as const,
      missing,
      message:
        "Ready for manual fulfilment; no supplier API or automatic stock sync is connected.",
    };
  if (!connector.implemented)
    return {
      status: "not_configured" as const,
      missing,
      message:
        "Connector is not implemented. Use manual fulfilment or CSV/XLSX.",
    };
  if (missing.length)
    return {
      status: "pending_credentials" as const,
      missing,
      message: `Missing environment variable(s): ${missing.join(", ")}`,
    };
  return {
    status: "not_configured" as const,
    missing,
    message:
      "Configuration is present; connection has not been live-verified. A successful authorised feed sync verifies the connection.",
  };
}
