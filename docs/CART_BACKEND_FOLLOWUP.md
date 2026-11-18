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

Deployment access was renewed with owner-approved one-hour, deployment-only staging and production keys. Staging (`tame-lemur-590`) successfully deployed backend source `359a46438640372a8a74a4651405c0f3d3aec7e1`; production dry-run validation passed, with no index deletion. Eleven actual staging HTTP checks passed: missing-session public error, guest add/persistence, quantity/count changes, stock caps, strict quantities, cross-guest isolation, server currency totals, remove, concurrent additions to one line and clear. Only test-owned cart lines were cleared.

The built staging frontend also rendered and added its existing staging fixture successfully against that backend. Browser QA caught and fixed an existing display-unit bug in `src/pages/Cart.tsx`: free-shipping shortfall is stored in base units and must use the base-to-display formatter, not the already-local formatter. The verified USD message is now $10.46 instead of $879.00 for INR879 remaining. All 75 tests, TypeScript, changed-file lint and builds pass again.

Production deployment is held by a fresh-backup gate. Convex's free plan has a maximum of two retained backups; the dashboard explicitly disables Backup Now until a slot is freed. Both existing snapshots remain intact. The older 16 November snapshot was downloaded privately, ZIP CRC validated, and SHA-256 verified (`4958a8a6391770b93419774afc42fc995b3918c253528188ad12df686b7da519`). Deleting its cloud copy requires explicit owner confirmation; the 17 November cloud snapshot must remain. After approval, remove only that older cloud snapshot, create and verify a current production backup, then deploy the backend and verify the combined frontend release. Do not add paid plans or delete production tables. No keys or backup contents belong in Git or public reports.

Guest-to-account migration and additional authenticated/variant paths are tested in Convex's local test harness, not through a live staging login. Guest cart operations have also passed actual staging API and browser checks. Physical Android/iPhone Add-to-Cart testing remains unverified. Production browser verification and the client module-loading failure remain release gates.

## Rollback

Keep the known-good production deployment active until verified. Revert a failed source merge through a normal reviewed commit, or select the previous successful Pages deployment. For a backend rollback, redeploy the previous verified source after compatibility checks. Never reset, replace-import, seed or delete production tables to repair this incident.
