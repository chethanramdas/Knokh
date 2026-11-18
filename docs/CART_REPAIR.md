# Cart incident repair — 18 November 2026

## Confirmed incident

Convex production request `c54004551fc55340` failed in `resolveOwnerKey` with `Uncaught Error: A valid cart session key is required.` The dashboard identifies the caller as an unknown (unauthenticated) WebSocket client and shows zero database bytes read/written. This request failed before product, stock, settings or cart-index lookups, so those are not its cause.

The client originally started `guestKey` as an empty string, initialized it in an effect, trusted any stored string through nullish coalescing, and sent an omitted key when empty. Empty or malformed stored keys were never repaired; buttons did not guard session readiness. The log does not record the submitted key, so missing versus malformed storage cannot be distinguished for this individual request.

## Client repair (compatible with the existing production backend)

- `src/lib/cartSession.ts`: initialize a validated key synchronously, retain valid existing keys and stable memory fallback, repair invalid storage and tolerate blocked storage.
- `src/lib/store.tsx`: initialize cart identity before rendering controls/queries. Initialize persisted preferences directly and preserve the existing settings fallback.
- `src/components/knokh/ProductCard.tsx`, `src/pages/ProductDetail.tsx`: guard readiness and concurrent clicks, send the selected currency and show safe cart errors.
- `src/lib/cartErrors.ts`, `src/pages/Cart.tsx`: display intentional public errors, catch clear/remove/coupon failures and avoid exposing internal exception text.
- `tests/cart-session.test.ts`: reproduce the missing-key failure against the unchanged backend and prove repaired keys add/persist successfully. Cover valid-key preservation, invalid/empty/legacy storage and blocked storage.

Checks: TypeScript and production build pass; 51 tests pass. Changed-file ESLint has no errors and one existing Fast Refresh warning. No backend, schema, deployment environment, authentication, account role, product, order or supplier changes are part of this client release. Browser preview successfully added a sample product as a signed-out guest against the existing backend and rendered its cart price/count. No checkout or payment was attempted.

## Separate backend follow-up

A separate tested changeset adds public validation errors, strict quantities/variant checks, correct zero-stock updates, indexed line lookup and stock-capped repeat-safe guest-to-account adoption that retains the original guest cart. Wiring adoption into the client is held with that backend changeset, avoiding an untested cross-version release. Its local suite currently passes 67 tests. It has not been deployed: CLI reports `401 MissingAccessToken`; a fresh, time-limited deployment credential is required. Do not claim this backend follow-up or browser login-to-cart migration is live until staging and production verification succeed.

## Release / rollback

Merge only the checked client change, observe Cloudflare's main deployment, and test the live add/count/refresh workflow with an existing sample product. Preserve pre-existing carts; remove only test additions when safe. Revert the client merge and let Pages redeploy if verification fails. No database restore, product re-seed, order creation, or destructive cart repair is required.

A complete physical Android/iPhone test matrix and the backend follow-up remain separate verification items. Existing full-repository lint failures outside touched files are not silently disabled.
