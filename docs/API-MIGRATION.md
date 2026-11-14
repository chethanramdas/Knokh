# Portable API implemented endpoints

This API is a work in progress. The legacy storefront is not connected yet.

| Method | Path | Access | Behavior |
|---|---|---|---|
| GET | /health/live | Public | Process liveness |
| GET | /health/ready | Public | PostgreSQL connectivity |
| POST | /api/auth/sign-up/email | Public, rate limited | Password registration and email verification |
| POST | /api/auth/sign-in/email | Public, rate limited | Verified account login |
| POST | /api/auth/sign-out | Session | Revoke session |
| GET | /api/auth/get-session | Session | Current session |
| POST | /api/auth/request-password-reset | Public, rate limited | Request reset email |
| POST | /api/auth/reset-password | Token | Change password |
| GET | /api/categories | Public | Categories |
| GET | /api/products | Public | Published products with filters and pagination |
| GET | /api/products/:slug | Public | Product and variant availability |
| POST | /api/admin/products | Catalog manager/admin | Transactional product, variant and inventory creation |
| PATCH | /api/admin/products/:id | Catalog manager/admin | Name, description and publication status |

Catalog query: page, pageSize (1–100), search, category (UUID), minPrice/maxPrice (integer minor units), currency (ISO uppercase), inStock=true, sort=newest/price_asc/price_desc.

Admin endpoints validate server sessions and staff_roles; mutation Origin must match FRONTEND_URL. Product creation accepts name, slug, description, status, sku, priceMinor, currency and stock. Duplicate SKU/slug returns 409. There is no public first-admin claim. An operator with database access grants the first role using `npm run admin:grant -- email` from apps/api after account verification. Role changes are audited.

Email delivery is injected through a replaceable function; the default adapter uses optional Resend credentials. Integration tests capture verification email in memory and never deliver messages. Production email delivery itself is not sandbox-tested.

The service overwrites its internal client-IP header from the socket address, preventing caller spoofing. Behind a reverse proxy, rate limits currently group clients by proxy IP; trusted-proxy configuration must be implemented and tested before public deployment.

The currently pinned Drizzle ORM and toolkit are release candidates selected to resolve upstream TypeScript declarations without disabling checks. This is a release-readiness risk to review before production.
