# Cart backend follow-up and release status — 18 November 2026

## Confirmed root cause

Production request `c54004551fc55340` failed in `resolveOwnerKey` with “A valid cart session key is required.” The dashboard reports unknown identity and zero database reads/writes. Client initialization accepted empty/malformed stored keys and initially sent no key. The log does not contain the submitted key, so its exact stored value is unknown. Product stock, settings, indexes and publication checks were not reached in this request.

## Changes already on main

PR #6 / merge `26965bdeab91fa3e684909b99c671f7272d5602e` contains synchronous validated guest-session initialization, preservation of valid keys, stable blocked-storage fallback, click guards, selected currency and safe cart-action error handling. It adds seven regression tests against the unchanged backend. TypeScript, production build, 51 tests and changed-file lint (one existing warning) passed.

## Production status

Cloudflare built deployment `e4a35a89-7bd9-4864-bfd0-2afff0b7bcd6` successfully. Browser smoke testing then failed to load lazy Home/Catalog modules. A fresh page and one retry reproduced it. Public HTTP checks returned 200 JavaScript for the modules and all Catalog dependencies, and the exact built bundle rendered the cart successfully in an isolated local preview. A direct asset navigation in the managed browser reported `net::ERR_BLOCKED_BY_CLIENT`; that establishes a browser-side restriction for that navigation, not a proven production CDN root cause.

Because live functionality could not be verified, production was restored to known-good Cloudflare deployment `adccd81a-d613-4879-8088-3a6bc372b956`, commit `aff727734fb08706ee0d263c7f6eb17a8edf3ce0`. Its homepage was checked again. The client fix is committed on main but is NOT the active production release. Do not report the cart incident resolved on the live site.

## Backend changes in this follow-up (not deployed)

- `src/convex/lib/auth.ts`: preserve the strict owner boundary; expose an intentional public session error.
- `src/convex/cart.ts`: exact indexed line lookup; public validation errors; finite integer quantities; required valid variant selection; stock-capped adds and updates; refuse zero-stock updates without silently deleting customer items; exclude orphaned/hidden product rows from visible counts without deleting them; cap guest merges to stock and retain original guest carts as abandoned migration history. Add return validators to changed registered functions.
- `src/lib/store.tsx`: invoke repeat-safe transactional adoption when a user becomes authenticated; retain guest data and report failures safely.
- `tests/cart.test.ts`, `tests/cart-session.test.ts`, `tests/suppliers.test.ts`: regression coverage for guest/session failures, authenticated ownership, stock/variants, quantities, concurrency, currencies/default settings, orphan counts and guest-cart migration.

No schema, account, role, secret, supplier, payment, order or production inventory edits are required. No dependency/subscription added.

## Actual verification and remaining gates

The full changeset passes TypeScript and 75 tests after combining the client-release tests; its production build also passed. Changed-file lint has no errors and one existing Fast Refresh warning. Existing repository-wide lint problems remain outside this cart release. Browser preview against the current production backend verified guest additions through product cards and product details, count/totals updates, increasing/decreasing quantities, refresh persistence, USD conversion (INR1999 → USD23.80), item removal and clearing the isolated test cart. Only owned test additions were removed; no checkout, payment, product seed, or order was created.

CLI deployment validation is blocked by `401 MissingAccessToken`. Before deploying this backend, obtain fresh one-hour deployment-only credentials for staging and production, back up production, push and test staging, then deploy the compatible backend and merge its tested client adoption code. Do not create broad or persistent keys. Do not expose credentials in chat, logs or Git.

Guest-to-account migration and additional stock/error paths are tested in Convex's local test harness, not through a live login/staging deployment. Physical Android/iPhone Add-to-Cart testing remains unverified. Production browser verification and the client module-loading failure remain release gates.

## Rollback

Keep the known-good production deployment active until verified. Revert a failed source merge through a normal reviewed commit, or select the previous successful Pages deployment. For a backend rollback, redeploy the previous verified source after compatibility checks. Never reset, replace-import, seed or delete production tables to repair this incident.
