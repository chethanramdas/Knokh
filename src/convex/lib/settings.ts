import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DEFAULT_SETTINGS, SETTINGS_KEY, type SiteSettings } from "./config";

/**
 * Read the live KNOKH configuration. Stored values (Admin → Settings) win over
 * the built-in defaults, section by section, so a partially saved config can
 * never lose the defaults for the remaining sections.
 */
export async function getSettings(ctx: QueryCtx | MutationCtx): Promise<SiteSettings> {
  const doc = await ctx.db
    .query("site_settings")
    .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
    .unique();
  if (!doc) return DEFAULT_SETTINGS;
  return mergeSettings(doc.value);
}

export function mergeSettings(stored: unknown): SiteSettings {
  if (!stored || typeof stored !== "object") return DEFAULT_SETTINGS;
  const value = stored as Partial<SiteSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    brand: { ...DEFAULT_SETTINGS.brand, ...(value.brand ?? {}) },
    contact: { ...DEFAULT_SETTINGS.contact, ...(value.contact ?? {}) },
    legal: { ...DEFAULT_SETTINGS.legal, ...(value.legal ?? {}) },
    commerce: { ...DEFAULT_SETTINGS.commerce, ...(value.commerce ?? {}) },
    pricing: { ...DEFAULT_SETTINGS.pricing, ...(value.pricing ?? {}) },
    payments: { ...DEFAULT_SETTINGS.payments, ...(value.payments ?? {}) },
    seo: { ...DEFAULT_SETTINGS.seo, ...(value.seo ?? {}) },
    currencies: value.currencies ?? DEFAULT_SETTINGS.currencies,
    shippingZones: value.shippingZones ?? DEFAULT_SETTINGS.shippingZones,
    taxRules: value.taxRules ?? DEFAULT_SETTINGS.taxRules,
    homepage: value.homepage ?? DEFAULT_SETTINGS.homepage,
  };
}

export async function writeSettings(
  ctx: MutationCtx,
  patch: Partial<SiteSettings>,
  updatedBy?: import("../_generated/dataModel").Id<"users">,
): Promise<SiteSettings> {
  const current = await getSettings(ctx);
  const next: SiteSettings = {
    ...current,
    ...patch,
    brand: { ...current.brand, ...(patch.brand ?? {}) },
    contact: { ...current.contact, ...(patch.contact ?? {}) },
    legal: { ...current.legal, ...(patch.legal ?? {}) },
    commerce: { ...current.commerce, ...(patch.commerce ?? {}) },
    pricing: { ...current.pricing, ...(patch.pricing ?? {}) },
    payments: { ...current.payments, ...(patch.payments ?? {}) },
    seo: { ...current.seo, ...(patch.seo ?? {}) },
    currencies: patch.currencies ?? current.currencies,
    shippingZones: patch.shippingZones ?? current.shippingZones,
    taxRules: patch.taxRules ?? current.taxRules,
    homepage: patch.homepage ?? current.homepage,
  };
  const existing = await ctx.db
    .query("site_settings")
    .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      value: next,
      updatedAt: Date.now(),
      updatedBy,
    });
  } else {
    await ctx.db.insert("site_settings", {
      key: SETTINGS_KEY,
      value: next,
      updatedAt: Date.now(),
      updatedBy,
    });
  }
  return next;
}

/**
 * Which payment providers can actually run right now. A provider is only
 * "configured" when every environment variable it needs is present on the
 * Convex deployment. This is read from `process.env`, never from the client.
 */
export function providerRuntimeStatus(
  envVars: string[],
): "configured" | "pending_credentials" {
  const missing = envVars.filter((key) => !process.env[key]);
  return missing.length === 0 ? "configured" : "pending_credentials";
}

export function missingEnvVars(envVars: string[]): string[] {
  return envVars.filter((key) => !process.env[key]);
}
