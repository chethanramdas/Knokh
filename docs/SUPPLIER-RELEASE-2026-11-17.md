# KNOKH supplier production release — 17 November 2026

## Deployment record

| Item | Verified result |
| --- | --- |
| Repository | https://github.com/chethanramdas/Knokh |
| Pull request | #3, merged |
| Application main commit | `501ed9cc51d7d1cc23655daf7226ac14df1970b2` |
| Tested/backend source commit | `dfd550dd89d8c5e76029457473825ff8178fbc8e` |
| Source equivalence | Application merge tree equals tested backend source tree |
| Backend | Convex `agreeable-caterpillar-156`, deployment succeeded |
| Frontend | Cloudflare Pages `knokh-preview`, production branch `main` |
| Application frontend deployment | `90189267-2402-4c9f-ae6b-56608a25090c`, success |
| Live domain | https://knokh.com |
| New recurring subscriptions | None introduced |

Documentation-only commits may follow the application commit above; they do not change runtime code. This release retains the existing React/Vite frontend, Convex backend and Resend authentication. It is not the separately proposed PostgreSQL/self-hosting migration.

## Changes shipped

- Manual zero-inventory supplier workflow with explicit human order placement and tracking; no automatic external purchases.
- Qikink and DeoDap manual profiles with setup notes and truthful API limitations.
- Supplier-linked CSV/XLSX import preview, mapping, duplicate detection, draft publishing control, retry handling and history.
- Bounded HTTPS feed synchronisation with DNS pinning, redirect/token restrictions, currency validation, supplier-scoped matching, cost updates that retain retail prices, conservative inventory deltas and atomic/idempotent jobs.
- Scheduled job due-time filtering and explicit skipped status for unsupported operations.
- Split supplier shipment handling and contribution estimates including shipping, fees, returns reserve and tax provision.
- Guest ownership keys restored in product-card/detail cart additions; a missing checkout confirmation route restored while preserving the existing URL.
- Compatible Convex Auth v1 and other dependency security updates; official vendor SheetJS package with lockfile integrity and bounded frontend parsing.
- Existing approved logo and Golden Sunrise homepage retained.

## Verification

The clean release checkout passed dependency installation, TypeScript, all **44 automated tests**, production build and scoped changed-code ESLint. The production dependency audit reported **zero vulnerabilities**. Full-repository lint retains documented legacy failures outside this release, and the development toolchain retains moderate advisories. No checks were disabled.

Isolated cloud tests covered authentication/authorization, CSV import commit and retry, product/inventory changes, server-calculated checkout, stock reservation, duplicate prevention, authenticated fixture-feed transport, supplier readiness, manual tracking and signed-session logout.

Real Resend OTP delivery and verification succeeded in staging using a separate sending-only key restricted to `knokh.com`. The owner established a verified session and received staging administrator access through the existing administrator-authorized role mutation, with audit logging. Browser checks passed for supplier creation/configuration, actual CSV upload/mapping/preview/commit as draft, stock increment/decrement, order review and manual shipment recording. The contribution calculator returned ₹150 and 30% for a ₹500 sale less ₹200 supplier cost, ₹50 shipping, ₹20 fees, ₹30 return reserve and ₹50 tax. A dashboard-queued fixture-feed job completed in the actual worker. These fixtures are not real supplier connections or shipments.

Production verification passed for:

- HTTPS backend health and storefront configuration.
- Signed-out supplier/import reads denied with sanitized errors.
- Absence of the staging fixture HTTP endpoint.
- Existing owner administrator session after the backend and frontend updates.
- Admin overview, supplier, imports, inventory, orders, customers and settings routes.
- Four existing accounts preserved, matching the backup baseline; product, order and supplier counts also match.
- Homepage, search results navigation, cart, categories and customer profile routes.
- Approved logo rendering, exact browser-computed Golden Sunrise color stops, and no horizontal overflow at the observed 1348px desktop viewport.
- No application console errors in the observed live route checks.

No test products, supplier records or orders were created in production. Existing private credentials were retained. Only the approved production deploy-only credential was used for the release.

## Actual supplier and commerce status

| Provider/feature | Production status |
| --- | --- |
| Manual supplier workflow | Deployed and available; no supplier records configured yet |
| Authorized CSV/XLSX imports | Deployed; owner supplies catalogue rights and real product files |
| JSON/CSV feed | Deployed; production feed credentials are not configured |
| Qikink | Manual profile available; authenticated API ordering/sync not connected or tested |
| DeoDap | Manual profile available; no verified fulfilment API/free CSV subscription established |
| Automatic supplier ordering | Disabled |
| Payment gateways | Existing unconfigured provider credentials retained; no settlement/sandbox claim |

Zero inventory does not eliminate per-order supplier, shipping, returns, tax or payment costs. No paid plan was purchased.

## Backup and rollback

A fresh production backup including file storage completed at **11:19:05 IST on 17 November 2026**. The private downloaded ZIP passed CRC verification. SHA-256: `ba44cc662dadeb16c3d298b3c0c75239094549eece1d6bc4dd9ce7a73534617b`. The Convex dashboard retains backups for seven days. Code and environment configuration require separate rollback planning.

Previous frontend deployment: `d96af55d-1f92-4d99-9a6b-c0c9d918a58d`, source `bad509d71a107783f2dcc52323f2b5074ea96d5d`. On a critical failure, restore that Cloudflare deployment and deploy the corresponding previous backend source. Review additive schema compatibility first. Do not overwrite newer orders by restoring an old database without a separately authorized recovery plan. No indexes were deleted by this release.

The temporary production credential has only `deployment:deploy` permission and expires after one hour. Credentials and backup contents must never enter Git or public reports.

## Limits and follow-up

- Fresh production OTP delivery was not repeated; real staging delivery/verification passed and the existing live administrator session works.
- No real supplier API account, supplier order or payment settlement was tested.
- A full mobile viewport/accessibility/performance matrix was not executed in this release.
- A direct programmatic logo-byte fetch was denied with HTTP 403; live browser loading and visual rendering succeeded, and the deployed source retains the approved asset.
- Existing orphaned cart references can leave a stale header count even when no current products render in the cart. No cart records were deleted by this release.
- The production catalogue is empty, matching the pre-release baseline. Owner catalogue, contact/legal, shipping and payment configuration remain operational setup tasks. The existing test-gateway flag is enabled without its secret; real provider setup and sandbox disabling should be reviewed before accepting live sales.
