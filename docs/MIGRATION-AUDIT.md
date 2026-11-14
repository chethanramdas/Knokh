# KNOKH migration audit

Status: pre-migration audit; implementation and production acceptance are incomplete.
Source commit: dd776d01a6e23c892f6c25315d892d22da7b1a72.

## Current architecture
React 19 / Vite / TypeScript / React Router 7 / Tailwind 4 storefront and admin UI. Shadcn primitives, Framer Motion, React Hook Form, Zod and Recharts are already present. Convex provides database, queries, mutations, actions, cron jobs, HTTP webhooks and authentication. Email OTP uses Resend; anonymous authentication is enabled. A Hono/Deno server entry also exists. PostgreSQL, Express, Drizzle and TanStack Query have not been integrated.

## Existing functionality to preserve
Storefront homepage, catalog and product details; category/brand/collection browsing; variants; guest and authenticated carts; saved carts; wishlist; recently viewed; configured currencies and shipping; tax and coupons; checkout and inventory reservation; order confirmation and tracking; customer profile and addresses; notifications; returns and reviews. Administration covers catalog, inventory, orders, customers, settings, imports and suppliers. CSV/XLSX preview and supplier feed parsing exist. Payment code includes Razorpay, Cashfree, PayPal and a test gateway. Existing integrations are not certified as operational by this audit.

## Dependencies
Retain React, Vite, TypeScript, React Router, Tailwind, Shadcn/Radix, Framer Motion, React Hook Form, Zod, Recharts, Lucide and the spreadsheet capability. Review xlsx distribution/version before production. Remove convex and @convex-dev/auth only after all callers migrate. Remove Hono/Deno entry once Express serves production assets. Remove platform instrumentation and unused screenshot/debug dependencies after confirming their callers. Three.js is not in the current package manifest and should not be added without a feature need.

## Platform references and deployment risks
src/main.tsx falls back to a hardcoded convex.cloud deployment. src/instrumentation.tsx links to Freebuff using VITE_VLY_APP_ID. Convex providers, generated API references and database IDs pervade the UI and backend. .env.example contains Convex deployment variables. convex.json configures the proprietary backend. README claims production builds deploy backend functions, but package.json build runs only vite build. Generated Convex modules are excluded from source control. The repository has no portable PostgreSQL/Docker deployment. No Firebase or Supabase SDK is declared in package.json.

## Security and correctness risks
- First-admin claim is available to any non-anonymous account while no admin exists.
- Guest order retrieval accepts an order ID without proving possession of the checkout session.
- Cashfree signature concatenation has an extra period; reproduced locally using an independently generated valid signature.
- Refund-only Razorpay events map payment IDs into gateway order-ID lookup.
- Failed/abandoned payments retain reserved stock without a reservation expiry worker.
- Guest payment status query returns null, leaving the payment return page waiting.
- Payment transitions need monotonic state guards, expected amount/currency validation and cancellation coordination.
- Authentication sessions and password credentials require explicit migration policy; never treat source access as access to production user records.

## Migration and data safety plan
1. Preserve source commit and export production database and storage before cutover. No production data has been downloaded or modified.
2. Introduce npm workspaces: apps/web, apps/api, packages/shared and database. Preserve page components and branding while replacing data hooks.
3. Normalize Drizzle tables with UUID keys and a legacy-ID mapping table. Model roles/permissions, sessions, catalog/variants/images, inventory/reservations, carts, orders, payment attempts, refunds, shipping, returns, supplier/import jobs, content and audit records with constraints and indexes.
4. Implement Better Auth with PostgreSQL sessions, email/password, OTP and reset; optional SMTP/Resend adapters. Bootstrap admin using a controlled CLI. Document whether legacy identities require verified account activation; never import incompatible password hashes silently.
5. Replace each public backend operation below with an explicitly validated REST route and service. Internal operations become private services/jobs, never public generic RPC. Use TanStack Query for reads and mutation invalidation. Preserve all UI callers.
6. Implement checkout transactions with inventory row locks, reservation expiry, server-derived totals, checkout idempotency and payment attempt records. Verify webhook signatures before persisting trusted events; unique provider/event IDs and atomic state transitions prevent replay.
7. Port import preview, duplicate detection and supplier mapping; keep unsupported supplier integrations manual. Add local/S3 storage with content validation and safe deletion.
8. Add production asset serving and product HTML metadata/pre-rendering, OpenAPI, Docker and PostgreSQL health checks, persistent volumes, migration and backup/restore commands.
9. Import a copy of exported legacy data in a transaction-safe staging run; compare row counts, order totals, inventory, foreign keys and representative customer flows. Keep original export immutable and verify checksums.
10. Run builds, lint, API and database tests, Docker builds and credential-dependent payment sandbox tests. Freeze writes during final export/import and cutover. Retain original deployment and backups until reconciliation passes.

## Rollback
Before accepting new writes, switch back to the preserved original deployment and its unchanged database. After accepting writes, rollback requires reconciliation/export of new orders, payments, inventory movements and accounts; do not blindly restore an old database. Source rollback alone cannot undo a data migration.

## Validation and environment
Previous inspection executed 22 existing pure-function tests with a Node compatibility harness; this does not verify authentication, database or checkout. npm registry is reachable by HTTP. Bun, Docker, psql and postgres are not available on PATH in this session. Full dependency installation/build and migration execution remain unverified. No provider sandbox credentials or production database export have been supplied. Missing Docker prevents Docker acceptance testing here unless an execution environment with Docker is provided.

## Backend operation inventory
Every row must have a mapped implementation, caller migration and tests before its original implementation is removed.

| Source | Operation | Kind |
|---|---|---|
| `src/convex/account.ts` | `getProfile` | `query` |
| `src/convex/account.ts` | `updateProfile` | `mutation` |
| `src/convex/account.ts` | `requestAccountDeletion` | `mutation` |
| `src/convex/account.ts` | `saveAddress` | `mutation` |
| `src/convex/account.ts` | `deleteAddress` | `mutation` |
| `src/convex/account.ts` | `setDefaultAddress` | `mutation` |
| `src/convex/account.ts` | `toggleWishlist` | `mutation` |
| `src/convex/account.ts` | `getWishlist` | `query` |
| `src/convex/account.ts` | `getNotifications` | `query` |
| `src/convex/account.ts` | `markNotificationRead` | `mutation` |
| `src/convex/account.ts` | `markAllNotificationsRead` | `mutation` |
| `src/convex/account.ts` | `subscribeNewsletter` | `mutation` |
| `src/convex/account.ts` | `createSupportTicket` | `mutation` |
| `src/convex/account.ts` | `myTickets` | `query` |
| `src/convex/admin.ts` | `claimFirstAdmin` | `mutation` |
| `src/convex/admin.ts` | `adminStatus` | `query` |
| `src/convex/admin.ts` | `listAdminUsers` | `query` |
| `src/convex/admin.ts` | `setUserRole` | `mutation` |
| `src/convex/admin.ts` | `getOverview` | `query` |
| `src/convex/admin.ts` | `listProductsAdmin` | `query` |
| `src/convex/admin.ts` | `getProductAdmin` | `query` |
| `src/convex/admin.ts` | `createProduct` | `mutation` |
| `src/convex/admin.ts` | `updateProduct` | `mutation` |
| `src/convex/admin.ts` | `bulkUpdateProducts` | `mutation` |
| `src/convex/admin.ts` | `adjustStock` | `mutation` |
| `src/convex/admin.ts` | `exportProductsCsv` | `query` |
| `src/convex/admin.ts` | `listCategoriesAdmin` | `query` |
| `src/convex/admin.ts` | `saveCategory` | `mutation` |
| `src/convex/admin.ts` | `reorderCategory` | `mutation` |
| `src/convex/admin.ts` | `listBrandsAdmin` | `query` |
| `src/convex/admin.ts` | `saveBrand` | `mutation` |
| `src/convex/admin.ts` | `listCollectionsAdmin` | `query` |
| `src/convex/admin.ts` | `saveCollection` | `mutation` |
| `src/convex/admin.ts` | `listOrdersAdmin` | `query` |
| `src/convex/admin.ts` | `updateOrderStatus` | `mutation` |
| `src/convex/admin.ts` | `addShipment` | `mutation` |
| `src/convex/admin.ts` | `createRefund` | `mutation` |
| `src/convex/admin.ts` | `setRefundStatus` | `mutation` |
| `src/convex/admin.ts` | `listRefundsAdmin` | `query` |
| `src/convex/admin.ts` | `listReviewsAdmin` | `query` |
| `src/convex/admin.ts` | `moderateReview` | `mutation` |
| `src/convex/admin.ts` | `listSupportTickets` | `query` |
| `src/convex/admin.ts` | `updateSupportTicket` | `mutation` |
| `src/convex/admin.ts` | `listCouponsAdmin` | `query` |
| `src/convex/admin.ts` | `saveCoupon` | `mutation` |
| `src/convex/admin.ts` | `getSettingsAdmin` | `query` |
| `src/convex/admin.ts` | `saveSettings` | `mutation` |
| `src/convex/admin.ts` | `listAuditLogs` | `query` |
| `src/convex/admin.ts` | `listAdminNotifications` | `query` |
| `src/convex/admin.ts` | `listCustomersAdmin` | `query` |
| `src/convex/cart.ts` | `getCart` | `query` |
| `src/convex/cart.ts` | `getCartCount` | `query` |
| `src/convex/cart.ts` | `addToCart` | `mutation` |
| `src/convex/cart.ts` | `updateCartItem` | `mutation` |
| `src/convex/cart.ts` | `removeCartItem` | `mutation` |
| `src/convex/cart.ts` | `clearCart` | `mutation` |
| `src/convex/cart.ts` | `applyCoupon` | `mutation` |
| `src/convex/cart.ts` | `setCartCurrency` | `mutation` |
| `src/convex/cart.ts` | `saveCartForLater` | `mutation` |
| `src/convex/cart.ts` | `listSavedCarts` | `query` |
| `src/convex/cart.ts` | `restoreSavedCart` | `mutation` |
| `src/convex/cart.ts` | `deleteSavedCart` | `mutation` |
| `src/convex/cart.ts` | `adoptGuestCart` | `mutation` |
| `src/convex/catalog.ts` | `getStoreConfig` | `query` |
| `src/convex/catalog.ts` | `paymentProviderStatus` | `query` |
| `src/convex/catalog.ts` | `listCategories` | `query` |
| `src/convex/catalog.ts` | `getCategoryBySlug` | `query` |
| `src/convex/catalog.ts` | `listBrands` | `query` |
| `src/convex/catalog.ts` | `getBrandBySlug` | `query` |
| `src/convex/catalog.ts` | `listCollections` | `query` |
| `src/convex/catalog.ts` | `getCollectionBySlug` | `query` |
| `src/convex/catalog.ts` | `listProducts` | `query` |
| `src/convex/catalog.ts` | `getProductBySlug` | `query` |
| `src/convex/catalog.ts` | `getRelatedProducts` | `query` |
| `src/convex/catalog.ts` | `searchSuggestions` | `query` |
| `src/convex/catalog.ts` | `getHomeData` | `query` |
| `src/convex/catalog.ts` | `recordProductView` | `mutation` |
| `src/convex/catalog.ts` | `getRecentlyViewed` | `query` |
| `src/convex/catalog.ts` | `trackEvent` | `mutation` |
| `src/convex/checkout.ts` | `getCheckoutQuote` | `query` |
| `src/convex/checkout.ts` | `placeOrder` | `mutation` |
| `src/convex/imports.ts` | `startImport` | `mutation` |
| `src/convex/imports.ts` | `commitImportBatch` | `mutation` |
| `src/convex/imports.ts` | `finalizeImport` | `mutation` |
| `src/convex/imports.ts` | `rollbackImport` | `mutation` |
| `src/convex/imports.ts` | `retryFailedRows` | `mutation` |
| `src/convex/imports.ts` | `listImportJobs` | `query` |
| `src/convex/imports.ts` | `getImportJob` | `query` |
| `src/convex/imports.ts` | `importTemplateCsv` | `query` |
| `src/convex/imports.ts` | `importErrorReport` | `query` |
| `src/convex/imports.ts` | `checkUrlImportSupport` | `query` |
| `src/convex/imports.ts` | `createDraftFromPreview` | `mutation` |
| `src/convex/importsActions.ts` | `fetchUrlPreview` | `action` |
| `src/convex/orders.ts` | `getOrderForCheckout` | `query` |
| `src/convex/orders.ts` | `getOrderDetail` | `query` |
| `src/convex/orders.ts` | `myOrders` | `query` |
| `src/convex/orders.ts` | `lookupGuestOrder` | `query` |
| `src/convex/orders.ts` | `cancelOrder` | `mutation` |
| `src/convex/orders.ts` | `requestReturn` | `mutation` |
| `src/convex/orders.ts` | `listMyReturns` | `query` |
| `src/convex/orders.ts` | `getTracking` | `query` |
| `src/convex/orders.ts` | `submitReview` | `mutation` |
| `src/convex/orders.ts` | `myReviews` | `query` |
| `src/convex/payments.ts` | `processWebhookEvent` | `internalMutation` |
| `src/convex/payments.ts` | `attachGatewaySession` | `internalMutation` |
| `src/convex/payments.ts` | `recordGatewayError` | `internalMutation` |
| `src/convex/payments.ts` | `confirmCheckoutResult` | `mutation` |
| `src/convex/payments.ts` | `getOrderPayment` | `internalQuery` |
| `src/convex/payments.ts` | `processPaypalEvent` | `internalMutation` |
| `src/convex/payments.ts` | `getPaymentForOrder` | `query` |
| `src/convex/paymentsActions.ts` | `createPaymentSession` | `action` |
| `src/convex/paymentsActions.ts` | `simulateTestGatewayEvent` | `action` |
| `src/convex/paymentsActions.ts` | `handlePaypalWebhook` | `internalAction` |
| `src/convex/paymentsActions.ts` | `requestRefund` | `action` |
| `src/convex/seed.ts` | `seedFoundation` | `mutation` |
| `src/convex/seed.ts` | `seedDemoCatalog` | `mutation` |
| `src/convex/seed.ts` | `removeDemoCatalog` | `mutation` |
| `src/convex/seo.ts` | `getSeoConfig` | `query` |
| `src/convex/seo.ts` | `sitemapEntries` | `internalQuery` |
| `src/convex/settings.ts` | `read` | `internalQuery` |
| `src/convex/settings.ts` | `publicBrand` | `query` |
| `src/convex/suppliers.ts` | `listConnectors` | `query` |
| `src/convex/suppliers.ts` | `listSuppliers` | `query` |
| `src/convex/suppliers.ts` | `saveSupplier` | `mutation` |
| `src/convex/suppliers.ts` | `checkSupplierConnection` | `mutation` |
| `src/convex/suppliers.ts` | `disconnectSupplier` | `mutation` |
| `src/convex/suppliers.ts` | `listSupplierProducts` | `query` |
| `src/convex/suppliers.ts` | `mapSupplierProduct` | `mutation` |
| `src/convex/suppliers.ts` | `queueSyncJob` | `mutation` |
| `src/convex/suppliers.ts` | `listSyncJobs` | `query` |
| `src/convex/suppliers.ts` | `listSupplierOrders` | `query` |
| `src/convex/suppliers.ts` | `completeManualFulfilment` | `mutation` |
| `src/convex/suppliers.ts` | `unmappedProductAlerts` | `query` |
| `src/convex/suppliers.ts` | `applyFeedItems` | `internalMutation` |
| `src/convex/suppliers.ts` | `markSyncJobResult` | `internalMutation` |
| `src/convex/suppliersActions.ts` | `runSyncJob` | `internalAction` |
| `src/convex/suppliersActions.ts` | `runDueSyncJobs` | `internalAction` |
| `src/convex/suppliersActions.ts` | `forwardSupplierOrder` | `action` |
| `src/convex/suppliers_queue.ts` | `dueSyncJobs` | `internalQuery` |
| `src/convex/suppliers_queue.ts` | `supplierOrderDetails` | `internalQuery` |
| `src/convex/suppliers_queue.ts` | `markManualFulfilment` | `internalMutation` |
| `src/convex/suppliers_queue.ts` | `retireStaleCarts` | `internalMutation` |
| `src/convex/users.ts` | `currentUser` | `query` |
