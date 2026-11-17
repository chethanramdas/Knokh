# Supplier release security review — 2026-11-16

## Dependency remediation
- Convex Auth remains on its compatible existing implementation: `@convex-dev/auth` 0.0.98 with its supported `@auth/core` 0.41.3 peer. Existing email OTP/anonymous providers and auth tables are retained; no migration to Auth v2 is attempted.
- SheetJS is pinned to the official vendor distribution `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, with lockfile integrity. The npm registry's obsolete 0.18.5 package is replaced. The browser rejects oversized imports before reading the file and bounds the parsed row count.
- Compatible dependency updates include Axios 1.21.1, React Router 7.18.5, Vite 7.3.8, Hono 4.13.19 and Zod 4.6.7, plus affected transitive packages. No forced major upgrades or disabled audit checks.
- An orphaned lockfile entry for a nonexistent Vly integration was removed; no runtime feature used that package.

`npm audit --omit=dev --json` reports **0 vulnerabilities** for the installed production dependency graph on 2026-11-16. This is a dependency audit, not proof of complete application security.

The full development dependency audit still reports moderate minimatch findings through the TypeScript ESLint toolchain. npm proposes a forced toolchain downgrade; it is not applied. These findings do not appear in the production dependency graph. Full-repository lint also has pre-existing errors outside this release. Changed supplier/import code is linted without rule suppression.

## Regression evidence and limits
Isolated tests exercise actual Convex Auth sign-in and verification actions, hashed/single-use OTPs with 15-minute expiry, rejected code handling, session refresh/logout and preservation of an existing verified administrator. Resend transport is intercepted by the tests; no real email delivery is claimed from these tests.

Supplier tests cover backend admin enforcement, real CSV/XLSX byte parsing and import commit, duplicate SKUs, COD checkout and transactional stock reservation, split manual shipments, job idempotency, cost/stock flags, currency boundaries, contribution costs and public HTTPS address guards. Automatic external supplier purchasing remains disabled.

A cloud staging push and eleven live integration checks pass, including actual signed-session authentication, server-side authorization, imports, checkout, stock, supplier feed transport and manual shipment tracking. A missing Node runtime directive caught by the real deployment was corrected. Subsequent real Resend delivery and OTP verification passed with a dedicated domain-restricted staging sending key. Verified administrator browser checks passed for suppliers, CSV imports, stock changes and manual shipment recording; no production email secret was reused. The clean release checkout passes all 44 tests and the production dependency audit reports zero vulnerabilities on 2026-11-17. Production backend and Cloudflare deployments succeeded; live health, access protection and the existing administrator session were verified. See SUPPLIERS.md and SUPPLIER-RELEASE-2026-11-17.md for the evidence and limits.

Never infer a backend deployment from Cloudflare's frontend build. Temporary staging credentials must be deployment-scoped, short-lived and revoked or allowed to expire after verification. Production data is not copied into test fixtures or logs. The temporary test harness and feed exist only in a separate staging-only source copy, not the release tree. Production supplier connections and automatic purchasing remain disabled/unverified until separately authorised and tested.

## Primary references
- https://github.com/get-convex/convex-auth/blob/main/CHANGELOG.md
- https://github.com/nextauthjs/next-auth/security/advisories/GHSA-7rqj-j65f-68wh
- https://docs.sheetjs.com/docs/getting-started/installation/frameworks/
- https://cdn.sheetjs.com/
