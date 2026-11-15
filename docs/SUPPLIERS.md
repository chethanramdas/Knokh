# Supplier operations and release checklist

## What is implemented
Manual fulfilment, authorised CSV/XLSX imports and bounded JSON/CSV feed synchronisation use the existing KNOKH application and database. No new infrastructure, supplier subscription or automatic external purchasing is enabled. Zero inventory does not mean zero working capital: supplier costs, shipping, payment fees, returns and tax still need funding per order.

### Manual workflow
1. Add a manual, Qikink or DeoDap supplier in Admin → Suppliers. The status means **manual fulfilment ready**, not an authenticated API connection.
2. Obtain catalogue usage rights and confirm delivery regions, costs, returns, stock availability and fulfilment terms with the supplier.
3. Preview authorised CSV/XLSX product data through Admin → Imports; review errors and duplicates before publishing. Map product and supplier SKUs explicitly. Keep currency consistent; no exchange rate is invented.
4. Receive a paid order or an enabled COD order. KNOKH creates one manual task per supplier, using an order/supplier idempotency key.
5. Review payment, address, supplier availability and actual contribution before placing the supplier order yourself. KNOKH does not place or pay for supplier orders.
6. Record the real supplier order reference, then carrier and tracking when available. Split supplier groups retain independent shipments. The overall order is marked shipped only when all items are shipped or delivered.
7. Handle cancellations/refunds through the existing order workflow. An unpaid/cancelled order cannot be submitted through manual fulfilment.

The contribution calculator subtracts supplier cost, shipping, payment fees, return reserve and tax provision from the selling price. It is a planning contribution, not audited net profit; enter all amounts in the same currency. It does not change retail prices.

## Provider readiness
| Provider | Available now | Automatic API status |
| --- | --- | --- |
| Manual | Authorised imports and human order placement/tracking | No external API required |
| JSON/CSV feed | Cost/stock sync for explicitly supplier-mapped products | Verified only after an actual successful authorised feed sync |
| Qikink | Manual profile and authorised spreadsheets | Disabled pending approved account, current API contract, authentication and sandbox/order verification |
| DeoDap | Manual profile and authorised spreadsheets | No verified supplier fulfilment API or free CSV subscription established |
| Existing CJ/AliExpress/3PL profiles | Existing configuration remains visible | Unimplemented providers cannot become connected merely because environment variables exist |

Primary references checked 2026-11-15:
- https://qikink.com/help/getting-started/how-do-i-get-started/
- https://admins.qikink.com/api-docs/ (account-restricted; current authentication, idempotency and inventory contracts still require verification)
- https://deodap.in/pages/csv-plan
- https://dropshipping.deodap.com/

Public storefront product endpoints are not proof of an authorised supplier ordering API. Never bypass authentication, provider terms or rate limits. No paid plan has been purchased or assumed free.

## Feed security and semantics
Set `SUPPLIER_FEED_URL` only in the backend deployment environment; `SUPPLIER_FEED_TOKEN` is optional and server-only. The frontend receives variable names/configuration booleans, never values. Do not put credentials in feed URLs or VITE_ variables. This version has one deployment-level feed configuration; use separate adapters/configuration before onboarding multiple independently authenticated feeds.

HTTPS requests validate every redirect, resolve and pin public DNS addresses, reject private/reserved destinations, bound response size (1 MB) and duration (15 seconds), and forbid bearer-token redirects across origins. Redirect limit: three. A feed batch accepts 1–250 object rows. Larger catalogues require a deliberately paginated adapter; they are rejected rather than silently truncated.

CSV supports quoted fields, quoted newlines, escaped quotes, CRLF and BOM; malformed rows and unsafe/duplicate headers are rejected. Stock is a non-negative integer; monetary inputs must be non-negative finite values and are stored in minor units. Feed currency must match the supplier/product; conversions require an explicit future exchange-rate policy.

Retail prices are never replaced by supplier feed prices. Products are matched within the supplier mapping/index, not by a global SKU fallback. Duplicate jobs claim atomically and successful jobs are idempotent. Existing checkout stock deductions are preserved using conservative supplier snapshot deltas; a first snapshot cannot increase saleable stock. If the supplier also deducts your submitted order from its snapshot, this conservative policy can understate availability: reconcile manually until provider reservations/order acknowledgements are implemented. Hidden or discontinued items are not automatically republished.

## Verification and production gate
`npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and scoped ESLint must pass. Full-repository lint has existing failures in unrelated shared hooks and payment modules; these remain a separate quality issue. The automated suite uses isolated in-memory Convex fixtures, not production records. It covers role enforcement, truthful statuses, paid/COD routing, split shipments, duplicate jobs/import rows, supplier-scoped stock, currency boundaries, CSV validation, HTTPS guards and contribution calculation.

These tests do not demonstrate Qikink/DeoDap sandbox connectivity, live feed delivery, payment settlement or production backend deployment. Before merging this backend release: deploy to a dedicated Convex staging deployment, test existing authentication/admin and import/order workflows, and obtain authorised production deployment access. Cloudflare's frontend preview alone does not deploy Convex functions.

### Data safety and rollback
- Export an authorised Convex backup before production deployment and record the deployment version. Keep it private; never commit customer/order exports.
- Schema changes are additive optional fields and indexes. No migration resets or production seed commands are required.
- Verify existing record counts and representative orders before and after the backend deployment. Use staging fixtures for write tests.
- Deploy backend first, then merge/deploy the frontend from main after staging verification. Observe sync failures and manual task statuses.
- On failure, stop scheduled new sync work and restore the previous backend code and Cloudflare deployment. Do not restore an old database over newer customer orders without a separately approved recovery plan. Added optional fields may remain during code rollback.
- Revoke temporary deployment credentials after the release. Do not decommission the current backend as part of these supplier/UI changes.
