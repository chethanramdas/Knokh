import Google from "@auth/core/providers/google";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";
import { safeReturnTo } from "../lib/authRedirect";
import { emailOtp } from "./auth/emailOtp";

const google = Google({
  // Google is authoritative for Gmail and managed Workspace addresses.
  // A verified third-party address can have changed owners since verification.
  allowDangerousEmailAccountLinking: false,
  profile(profile) {
    const email = profile.email?.trim().toLowerCase();
    if (!profile.email_verified || !email || (!email.endsWith("@gmail.com") && !profile.hd)) {
      throw new Error("Use email sign-in for this Google account.");
    }
    return { id: profile.sub, email, emailVerified: true };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
    ? [emailOtp, Anonymous, google]
    : [emailOtp, Anonymous],
  callbacks: {
    async redirect({ redirectTo }) {
      const origin = new URL(process.env.SITE_URL!).origin;
      return new URL(safeReturnTo(redirectTo), origin).href;
    },
  },
});
