# Self-hosted OTP staging

The existing frontend now has an isolated `/migration/auth` page for the PostgreSQL-backed OTP API. The production `/auth` route is intentionally not switched: account pages still depend on the legacy backend. A new session must not be presented as a legacy account session.

Run the API with PostgreSQL, auth and commerce migrations applied, FRONTEND_URL matching the frontend origin, and RESEND_API_KEY plus RESEND_FROM_EMAIL configured only on the API. Use a sender on a Resend-verified domain. Configure VITE_API_URL to the API origin when building the frontend, e.g. http://localhost:3001 in development. An empty value means same-origin API routing; the reverse proxy must forward /api to Express.

The staging page requests an OTP, verifies it, reloads the server session and supports logout. It uses credentials-included requests; sessions remain in HTTP-only cookies. Browser failures show safe messages without raw backend error payloads or OTP logging.

Production HTTPS should serve API and frontend under the same site, preferably via a /api reverse proxy. Do not use an unrelated API domain without evaluating cookie policies. Resend email delivery itself remains credential-dependent and has not been tested here. The server integration tests use captured email to validate hashed OTP storage, successful OTP sign-in and replay rejection against PostgreSQL.

Remaining: migrate use-auth and account/admin business APIs, then enable the existing /auth route with end-to-end browser tests. The staging page does not yet redirect to an unmigrated account dashboard.
