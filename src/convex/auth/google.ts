import Google from "@auth/core/providers/google";

export function hasGoogleCredentials() {
  return Boolean(process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim());
}

export function trustedGoogleEmail(profile: { email?: string; email_verified?: boolean; hd?: string }) {
  const email = profile.email?.trim().toLowerCase();
  const domain = email?.split("@")[1];
  if (!email || !domain || profile.email_verified !== true) return null;
  if (domain === "gmail.com" || profile.hd?.toLowerCase() === domain) return email;
  return null;
}

export const google = Google({
  allowDangerousEmailAccountLinking: false,
  profile(profile) {
    const email = trustedGoogleEmail(profile);
    if (!email) throw new Error("Use email verification for this account.");
    return { id: profile.sub, email, emailVerified: true, name: profile.name, image: profile.picture };
  },
});
