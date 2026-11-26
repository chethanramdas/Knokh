import { envValue } from "./gateways";
import type { SiteSettings } from "./config";

export function checkoutProviderEnabled(
  provider: string,
  settings: SiteSettings,
): boolean {
  const mode = envValue("KNOKH_PAYMENT_MODE");
  if (mode !== "live" && mode !== "sandbox") return false;
  if (mode === "sandbox") {
    const site = envValue("SITE_URL");
    // Sandbox checkout is restricted to a deployment explicitly configured for the preview site.
    if (
      !site ||
      site !== envValue("KNOKH_SANDBOX_SITE_ORIGIN") ||
      !site.endsWith(".pages.dev") ||
      site === "https://knokh-preview.pages.dev" ||
      envValue("CONVEX_SITE_URL") ===
        "https://agreeable-caterpillar-156.convex.site"
    )
      return false;
  }
  if (provider === "razorpay") {
    const key = envValue("RAZORPAY_KEY_ID");
    return (
      !!key?.startsWith(mode === "live" ? "rzp_live_" : "rzp_test_") &&
      !!envValue("RAZORPAY_KEY_SECRET") &&
      !!envValue("RAZORPAY_WEBHOOK_SECRET") &&
      settings.payments.providers.some(
        (entry) => entry.id === provider && entry.enabled,
      )
    );
  }
  // Existing Cashfree and PayPal records remain readable. Checkout and refund
  // initiation for those providers is held until their integrations pass review.
  return false;
}
