# Cloudflare-native migration (in progress)

This branch is the isolated migration workspace for moving KNOKH from Convex to
Cloudflare Pages Functions + D1 + R2. The live `main` branch remains unchanged.

## Foundation added

- `migrations/0001_cloudflare_core.sql`: initial D1 relational schema for
  customers, catalog, carts, wishlists, addresses, orders and store settings.
- `functions/api/health.ts`: a Pages Function health check that verifies the
  D1 binding without exposing secrets or customer data.

## Required Cloudflare setup

1. Create a **new** D1 database for the migration. Do not point it at production
   data during development.
2. In the Pages project `knokh-preview`, add a D1 binding named `DB` to the
   preview environment. Keep production binding separate until cutover.
3. Apply `migrations/0001_cloudflare_core.sql` to the preview database.
4. After deployment, check `/api/health`; it should report
   `database: connected`.

## Migration safety

This is only the database/API foundation. The current UI still uses Convex.
Do not remove Convex packages, credentials, or the existing deployment until
all existing queries, mutations, actions, auth, admin workflows, supplier
integrations, payments and scheduled jobs have Cloudflare replacements and
have passed regression tests. Existing Convex data must be exported, mapped,
validated and backed up before any production cutover.
