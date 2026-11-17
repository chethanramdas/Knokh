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

Primary references checked 2026-11-16:
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

## 2026-11-16 release verification additions
The branch incorporates the production Golden Sunrise homepage unchanged. Dependency updates remove reported production dependency vulnerabilities while retaining compatible Convex Auth v1; see SUPPLIER-SECURITY-AUDIT.md. Regression tests now include actual OTP actions with an intercepted email transport, session refresh/logout, real CSV/XLSX bytes, customer COD checkout, stock reservation, and supplier task creation. Scheduled jobs are restricted by due time and unsupported operations are marked skipped without external purchasing.

Staging target: `dev/user-2` / `tame-lemur-590`, separate from production `agreeable-caterpillar-156`. The release was deployed there with staging-only test data, fresh authentication signing keys and an approved one-hour deployment credential. No production data or signing keys were copied there. The Convex CLI runs in CI mode, which disables optional CLI Sentry initialization according to its installed official source.

## Cloud staging push — 2026-11-16
The supplier functions and schema were successfully pushed to isolated deployment
`tame-lemur-590` using an approved one-hour staging-only credential. This caught
and fixed a missing Node runtime directive in the bounded HTTPS helper that
frontend builds and in-memory tests could not detect. All 43 isolated tests and
strict type checks still pass. The test harness and authenticated fixture feed
are deployed from a separate staging-only source copy; neither is part of the
production release tree. No production data was imported into staging.

Real staging email delivery and OTP verification subsequently passed using a
dedicated Resend sending-only key restricted to knokh.com. The connected Resend
service reports the domain verified for sending. The owner entered the OTP
through the secure browser authentication form and established a real session.
No production email credential was copied; automatic approval review rejected
that approach, so staging uses its own restricted credential. A frontend preview
alone does not establish backend or provider connectivity.

### Cloud integration evidence
Eleven checks passed against the real isolated cloud backend on 2026-11-16:
1. HTTPS health endpoint.
2. Staging administrator access, with signed-out and customer privileged requests denied.
3. Truthful manual/Qikink/DeoDap readiness and unverified feed status.
4. CSV preview, duplicate rejection, commit and retry idempotency.
5. Product creation, stock adjustment and supplier mapping.
6. Customer cart, server quote, COD checkout, stock reservation and duplicate checkout rejection.
7. Authenticated staging fixture feed fetched through the real DNS-pinned Node HTTPS transport; supplier cost updates preserve retail price and checkout stock deductions.
8. Feed connection becomes verified only after that actual successful request.
9. Manual supplier task, tracking, harmless repeated shipment submission, shipped order and customer order history.
10. Anonymous sign-in with a real signed session, current-user query and logout.
11. Email sign-in fails closed with an understandable error when staging Resend credentials are missing.

The feed is a controlled staging fixture, not a Qikink, DeoDap or other real supplier connection. Isolated fixture identities and the test feed are in a separate staging-only source copy. They must never be deployed to production. The release branch does not contain test administrator provisioning, a test HTTP feed, or staging environment files.

The dedicated Cloudflare preview at `https://staging-supplier-release.knokh-preview.pages.dev` targets the isolated backend. Its staging-only configuration contains the public staging backend URL; other previews and production retain their existing backend targets. `SITE_URL` on the staging backend points to this isolated preview. Cloudflare Access sign-in was completed by the owner and browser verification proceeded with the protection retained.

### Browser regression checks
Browser checks confirmed working search and product detail navigation, anonymous sign-in, account access and logout. Signed-out admin access redirects to login; an anonymous account receives an administrator-access denial.

These checks caught two existing storefront defects: product cards/details omitted the guest ownership key in add-to-cart requests, and checkout navigated to an unregistered `/order/:orderId` URL. The release now passes the guest key from both purchase controls and retains both confirmation URL forms. Product-local selections reset through a keyed product component instead of synchronous effect state updates. All 44 tests, strict types and production build pass. Changed cart/product components lint without errors; the entry-point lint has two existing Fast Refresh warnings.

The updated isolated preview verified additions from both product detail and catalog cards, persisted guest totals, server rejection of an invalid Indian PIN, and creation of a synthetic COD order with a manual supplier task. No real payment or external supplier order was placed.

After email verification, the authorised owner received a staging administrator role through the existing administrator-only role mutation, with an audit record. Browser checks passed for the supplier dashboard, manual supplier creation/configuration, real CSV file upload and supplier-SKU mapping, preview and committed draft import, stock increment/decrement, order review and manual shipment recording. The INR calculator returned a contribution of 150 and 30% margin for sale 500 less supplier cost 200, shipping 50, fees 20, return reserve 30 and tax 50. A dashboard-queued fixture-feed job was processed successfully by the actual background worker. These fixtures are staging-only; no supplier API or real shipment is claimed.

### Production backup and outstanding release gates
Before any production code deployment, a fresh manual Convex backup including file storage completed at 2026-11-17 11:19:05 IST (05:49:05 UTC). The downloaded ZIP passed CRC verification. Its SHA-256 is `ba44cc662dadeb16c3d298b3c0c75239094549eece1d6bc4dd9ce7a73534617b`. The previous verified backup remains available in the dashboard. The archive stays private; no customer records, session data or credentials belong in this repository. Dashboard backups expire after seven days; code, environment variables and scheduled functions require separate rollback planning.

The supplier release is **merged and deployed to production**. PR #3 merged as `501ed9cc51d7d1cc23655daf7226ac14df1970b2`. The tested backend was deployed to `agreeable-caterpillar-156`, and Cloudflare deployment `90189267-2402-4c9f-ae6b-56608a25090c` successfully published that main commit to `https://knokh.com`. Schema validation passed and no indexes were deleted. Existing production credentials were retained.

A fresh clean checkout passed dependency installation, all 44 tests, strict TypeScript, the production frontend build, scoped changed-code ESLint and the production dependency audit (zero reported vulnerabilities) on 2026-11-17. Live HTTPS health, public store configuration, signed-out protection, the existing owner administrator session, supplier/import/inventory/order/settings routes and customer account navigation were verified. Account, product, order and supplier counts match the private pre-release backup. The approved logo renders and the browser-computed homepage gradient matches the supplied stops. See [the release report](SUPPLIER-RELEASE-2026-11-17.md) for exact evidence, supplier status and limitations.

Automatic supplier purchasing remains disabled. A full mobile viewport matrix, fresh production OTP delivery and real provider sandbox connections are not claimed; actual OTP delivery/verification passed in isolated staging, and the existing production administrator session was preserved.
