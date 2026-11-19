import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { safeReturnTo } from "../lib/authRedirect";
import { emailOtp } from "./auth/emailOtp";
import { google, hasGoogleCredentials } from "./auth/google";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailOtp, Anonymous, ...(hasGoogleCredentials() ? [google] : [])],
  callbacks: {
    async redirect({ redirectTo }) {
      const path = safeReturnTo(redirectTo, "");
      if (!path) throw new Error("Invalid sign-in return path.");
      return new URL(path, process.env.SITE_URL).href;
    },
  },
});
