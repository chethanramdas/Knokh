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
