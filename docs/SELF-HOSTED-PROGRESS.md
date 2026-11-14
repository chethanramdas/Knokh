# Self-hosted migration checkpoint

This is an incomplete migration, not a production release. The current storefront still uses the original backend. The new API is isolated in apps/api and is not wired to production data.

Implemented: Express service, validated startup configuration, security headers, origin-restricted credentialed CORS, request limits, API rate limits, consistent errors, database liveness/readiness checks, graceful shutdown, Better Auth PostgreSQL configuration for passwords, verification, OTP, reset and sessions. Optional Resend delivery reports missing configuration. Product/category/variant/inventory Drizzle schema includes keys and stock constraints.

Run from apps/api with environment variables exported:

    npm ci
    npm run build
    npm test
    npm run db:migrate
    npm start

The auth migration command requires PostgreSQL. It must first be exercised on an empty development database. Never point it at the original production database. Commerce schema migration generation and endpoint implementation are still pending. No data import or cutover has occurred.

Still required: complete normalized commerce schema and Drizzle migration files, REST business endpoints and backend RBAC, controlled admin bootstrap, frontend data-hook migration, payment and supplier adapters, storage, transactional checkout, inventory expiry, deployment packaging, integration tests and the requested final ZIP. Authentication configuration is implemented but sign-up/login/OTP/reset have not been integration-tested against PostgreSQL and email delivery.

## Verified checkpoint
Dependency installation completed. Seven Node/Supertest tests pass (configuration validation, security headers, liveness, readiness outage and error format). Strict TypeScript build remains blocked by upstream Better Auth/Drizzle declaration errors, including optional Bun/Gel/MySQL types. skipLibCheck remains false; no successful build is claimed. Docker has not been tested. Drizzle migration generation is attempted separately from execution; no database migration or authentication flow has been run against PostgreSQL.

## Latest verified checkpoint
Strict API TypeScript build passes with skipLibCheck=false. Twelve test cases pass, including a real PostgreSQL integration case covering authentication migrations, verified email/password login, hashed credentials, session logout, catalog reads, stock constraints, admin role denial, origin denial, transactional product creation/editing, duplicate rejection and audit records. Email is captured by a test adapter; delivery to real inboxes remains untested. Commerce migrations are generated in the current Drizzle directory format. The legacy storefront still needs migration; this remains incomplete.

## Updated owner requirements
Owner now requires Prisma instead of Drizzle. An incremental Prisma catalog mapping is under apps/api/prisma; it does not yet replace the full database layer. Resend sender variable is RESEND_FROM_EMAIL. OTP configuration now explicitly uses hashed storage, 900-second expiry, five attempts, rotation and three requests/minute. PostgreSQL integration tests verify OTP sign-in, hashed storage and replay rejection using captured test email, plus one-time administrator bootstrap and repeat rejection. All 12 tests pass. Actual Resend delivery remains untested. No production administrator has been provisioned, no live data has been migrated, and no production cutover has been performed. Logo remains in the successful preview branch until production approval.

## Account API checkpoint
Added session-protected GET/PATCH /api/account/profile, strict name-only updates, role-field rejection and mutation-origin enforcement. No live accounts or production data changed. The owner explicitly requests main integration, but also requires separate approval before production infrastructure/data cutover. The current main branch automatically deploys through Cloudflare, so full migration promotion must wait for staging acceptance and cutover approval.
