# Password login migration checkpoint

The staging frontend at /migration/auth now uses email/password instead of OTP as its default. It supports registration, verification email, sign-in, logout, password-reset requests and token-based password reset. /migration/admin checks /api/admin/access; authorization is enforced on the server. It is an access-check page, not a completed replacement for the legacy dashboard modules.

The backend requires 12–128 character passwords, hashes them through Better Auth, requires verified email, and uses server sessions. It retains optional OTP endpoints. Email is delivered only during verification/reset rather than on every password login. Missing Resend credentials cause an explicit delivery error, with no insecure fallback. The one-time CLI bootstrap grants an existing verified account staff access; it closes after successful bootstrap. Production target account approval is still required.

## Production blocker

Cloudflare Pages currently serves the legacy Vite storefront. No deployable Node/PostgreSQL server or VPS access has been provided. Do not point the live sign-in page at the new backend until that server is configured and the rest of the account/storefront API migration is complete. Hosting credentials must be supplied through a secure connection, never committed or pasted into chat. Do not deploy this workspace's temporary embedded test PostgreSQL instance as production infrastructure.

## Operator setup once hosting exists

1. Configure PostgreSQL, HTTPS and the API environment (DATABASE_URL, AUTH_SECRET, BETTER_AUTH_URL, FRONTEND_URL, RESEND_API_KEY, RESEND_FROM_EMAIL).
2. Apply auth and commerce migrations to a staging database and validate them.
3. Route /api to Express or set VITE_API_URL to the approved API origin.
4. Test registration, verification email, login, reset and session persistence in browsers.
5. Approve the verified owner account, then run the one-time admin:grant command through authorized server access.
6. Finish remaining business APIs and data reconciliation before live cutover.

No administrator account has been provisioned on production by this change. Existing production data and live authentication remain intact.
