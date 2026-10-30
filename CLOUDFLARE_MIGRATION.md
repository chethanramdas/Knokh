# KNOKH Cloudflare-native migration

This branch is the isolated migration workspace. Production remains on `main` until the complete migration is built, data has been reviewed/imported, and end-to-end tests pass.

## Target architecture
- Cloudflare Pages + Pages Functions: same-origin storefront API
- Cloudflare D1: relational catalog, carts, customer/order data
- Cloudflare R2: product/media files (optional binding; no third-party storage)
- Cloudflare Turnstile: optional abuse protection
- COD and manual bank/UPI transfer initially; payment gateways can be added later through a provider interface.

## Implemented foundation
- Initial D1 schema and product catalog endpoint
- Health endpoint
- Guest cart API: GET/POST `/api/cart`
- Guest checkout/order creation and lookup: POST/GET `/api/orders`
- Checkout currently accepts COD and manual bank transfer only. Manual transfers are not marked as paid automatically.

## Not yet migrated
The existing React application still imports Convex hooks and Convex Auth across storefront, customer-account, checkout, and admin screens. Those must be replaced before removing Convex build/codegen dependencies or changing the production Pages build. Supplier connectors, OTP email, automated payment, email notifications, and courier APIs are not part of the no-provider baseline; supplier/order fulfilment becomes admin-managed.

## Deployment safety
1. Keep production deployment and Convex credentials unchanged during migration.
2. Bind D1 as `DB` to the Pages project (preview and production separately).
3. Apply migrations to a new D1 database and import reviewed catalog data.
4. Complete frontend API adapter and admin authorization before public launch.
5. Run build, API, checkout, inventory concurrency, and browser tests.
6. Only then switch production build settings and DNS.
