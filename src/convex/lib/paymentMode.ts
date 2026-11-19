import { envValue } from "./gateways";
import type { SiteSettings } from "./config";

export function testGatewayAllowed(settings: SiteSettings) {
  return settings.payments.testGatewayEnabled && process.env.KNOKH_PAYMENT_MODE === "sandbox" &&
    process.env.SITE_URL === "https://feat-knokh-hardening.knokh-preview.pages.dev" &&
    Boolean(envValue("TEST_GATEWAY_WEBHOOK_SECRET"));
}

export function providerAllowed(provider: SiteSettings["payments"]["providers"][number]) {
  if (!provider.enabled) return false;
  const mode = process.env.KNOKH_PAYMENT_MODE;
  const isLive = process.env.SITE_URL === "https://knokh.com";
  const isSandbox = process.env.SITE_URL === "https://feat-knokh-hardening.knokh-preview.pages.dev";
  if (provider.id === "razorpay") {
    const key = envValue("RAZORPAY_KEY_ID");
    return Boolean(
      envValue("RAZORPAY_KEY_SECRET") && envValue("RAZORPAY_WEBHOOK_SECRET") &&
      ((mode === "sandbox" && isSandbox && key?.startsWith("rzp_test_")) ||
       (mode === "live" && isLive && key?.startsWith("rzp_live_"))),
    );
  }
  return provider.id === "cashfree" && mode === "sandbox" && isSandbox &&
    process.env.KNOKH_CASHFREE_SANDBOX_ENABLED === "true" &&
    process.env.CASHFREE_ENV === "sandbox" && Boolean(envValue("CASHFREE_CLIENT_ID") && envValue("CASHFREE_CLIENT_SECRET"));
}
