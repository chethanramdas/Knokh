import type { AuthConfig } from "convex/server";

// KNOKH issues and validates its own Convex Auth sessions. Keep this provider
// aligned with CONVEX_SITE_URL and the auth HTTP routes in convex/http.ts.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
