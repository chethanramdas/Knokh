import { internalQuery, query } from "./_generated/server";
import type { SiteSettings } from "./lib/config";
import { getSettings, providerRuntimeStatus } from "./lib/settings";

/** Internal accessor used by actions (actions have no direct db access). */
export const read = internalQuery({
  args: {},
  handler: async (ctx): Promise<SiteSettings> => {
    return await getSettings(ctx);
  },
});

/** Public, secret-free subset for the storefront shell. */
export const publicBrand = query({
  args: {},
  handler: async (ctx) => {
    const settings = await getSettings(ctx);
    return {
      brand: settings.brand,
      contact: settings.contact,
      currencies: settings.currencies,
      shippingZones: settings.shippingZones,
      codEnabled: settings.commerce.codEnabled,
      testGatewayEnabled: settings.payments.testGatewayEnabled,
      providers: settings.payments.providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        enabled: provider.enabled,
        status: providerRuntimeStatus(provider.envVars),
      })),
    };
  },
});
