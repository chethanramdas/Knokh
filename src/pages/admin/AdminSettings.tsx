import { useMutation, useQuery } from "@/lib/cloudflare-client";
import { ArrowDown, ArrowUp, Loader2, Save } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { InfoNote, LoadingBlock, SectionHeading, StatusPill } from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { titleCase } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";

type CurrencyRow = {
  code: string;
  symbol: string;
  name: string;
  rateToBase: number;
  enabled: boolean;
  decimals: number;
};

type ZoneRow = {
  countryCode: string;
  country: string;
  zone: string;
  rateMinor: number;
  freeAboveMinor: number;
  etaDays: number;
  serviceable: boolean;
  codAvailable: boolean;
};

type TaxRow = {
  countryCode: string;
  label: string;
  ratePercent: number;
  inclusive: boolean;
};

type HomeSectionRow = {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  enabled: boolean;
  position: number;
  source?: string;
  limit?: number;
  ctaLabel?: string;
  ctaHref?: string;
};

export default function AdminSettings() {
  const data = useQuery(api.admin.getSettingsAdmin, {});
  const saveSettings = useMutation(api.admin.saveSettings);
  const { config } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [taxRules, setTaxRules] = useState<TaxRow[]>([]);
  const [sections, setSections] = useState<HomeSectionRow[]>([]);

  usePageMeta({
    title: "Settings & payments",
    noIndex: true,
    path: "/admin/settings",
    siteUrl: config?.seo.siteUrl,
  });

  useEffect(() => {
    if (!data) return;
    setCurrencies(data.settings.currencies as CurrencyRow[]);
    setZones(data.settings.shippingZones as ZoneRow[]);
    setTaxRules(data.settings.taxRules as TaxRow[]);
    setSections((data.settings.homepage as HomeSectionRow[]).slice().sort((a, b) => a.position - b.position));
  }, [data]);

  if (!data) return <LoadingBlock label="Loading configuration…" />;

  const settings = data.settings;

  async function save(label: string, patch: Record<string, unknown>) {
    setBusy(label);
    try {
      await saveSettings({ patch });
      toast.success(`${label} saved.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Settings, payments & international"
        subtitle="Everything here is stored in the database and read by the storefront and backend at request time. Secret keys are never stored here — they live in the deployment environment."
      />

      <InfoNote tone="info">
        This configuration is shared by the storefront, checkout pricing and supplier sync, and is
        read on every request — there is no cached copy to invalidate.
      </InfoNote>

      {/* Brand & SEO */}
      <Panel title="Brand & SEO">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await save("Brand & SEO", {
              brand: {
                name: String(form.get("brandName") ?? ""),
                wordmark: String(form.get("wordmark") ?? ""),
                tagline: String(form.get("tagline") ?? ""),
                domain: String(form.get("domain") ?? ""),
              },
              seo: {
                siteUrl: String(form.get("siteUrl") ?? ""),
                defaultTitle: String(form.get("defaultTitle") ?? ""),
                defaultDescription: String(form.get("defaultDescription") ?? ""),
                analyticsId: String(form.get("analyticsId") ?? ""),
                organisationTwitter: String(form.get("twitter") ?? ""),
              },
            });
          }}
        >
          <Field label="Brand name" name="brandName" defaultValue={settings.brand.name} />
          <Field label="Wordmark" name="wordmark" defaultValue={settings.brand.wordmark} />
          <Field label="Tagline" name="tagline" defaultValue={settings.brand.tagline} />
          <Field label="Primary domain" name="domain" defaultValue={settings.brand.domain} />
          <Field
            label="Site URL (used for canonical links and sitemap)"
            name="siteUrl"
            defaultValue={settings.seo.siteUrl}
            placeholder="https://knokh.example"
          />
          <Field
            label="Analytics ID (GA4 — leave blank to disable)"
            name="analyticsId"
            defaultValue={settings.seo.analyticsId}
          />
          <Field label="Default title" name="defaultTitle" defaultValue={settings.seo.defaultTitle} />
          <Field
            label="Organisation X/Twitter handle"
            name="twitter"
            defaultValue={settings.seo.organisationTwitter}
          />
          <div className="sm:col-span-2">
            <Label htmlFor="defaultDescription">Default meta description</Label>
            <Textarea
              id="defaultDescription"
              name="defaultDescription"
              rows={2}
              defaultValue={settings.seo.defaultDescription}
            />
          </div>
          <div>
            <Button type="submit" disabled={busy === "Brand & SEO"}>
              {busy === "Brand & SEO" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{" "}
              Save
            </Button>
          </div>
        </form>
      </Panel>

      {/* Contact & legal */}
      <Panel title="Contact & legal">
        <InfoNote tone="warning">
          Placeholders are shipped empty on purpose — no company registration numbers, addresses or
          phone numbers are invented. Fill these in with your real business details before launch;
          they render on the contact, invoice and policy pages.
        </InfoNote>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await save("Contact & legal", {
              contact: {
                supportEmail: String(form.get("supportEmail") ?? ""),
                salesEmail: String(form.get("salesEmail") ?? ""),
                phone: String(form.get("phone") ?? ""),
                addressLines: String(form.get("addressLines") ?? "")
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
                hours: String(form.get("hours") ?? ""),
              },
              legal: {
                legalEntityName: String(form.get("legalEntityName") ?? ""),
                gstin: String(form.get("gstin") ?? ""),
                cin: String(form.get("cin") ?? ""),
                countryOfOperation: String(form.get("countryOfOperation") ?? "IN"),
              },
            });
          }}
        >
          <Field label="Support email" name="supportEmail" defaultValue={settings.contact.supportEmail} />
          <Field label="Sales email" name="salesEmail" defaultValue={settings.contact.salesEmail} />
          <Field label="Phone" name="phone" defaultValue={settings.contact.phone} />
          <Field label="Support hours" name="hours" defaultValue={settings.contact.hours} />
          <Field
            label="Legal entity name"
            name="legalEntityName"
            defaultValue={settings.legal.legalEntityName}
          />
          <Field label="GSTIN" name="gstin" defaultValue={settings.legal.gstin} />
          <Field label="CIN / registration" name="cin" defaultValue={settings.legal.cin} />
          <Field
            label="Country of operation (ISO)"
            name="countryOfOperation"
            defaultValue={settings.legal.countryOfOperation}
          />
          <div className="sm:col-span-2">
            <Label htmlFor="addressLines">Registered address lines (one per line)</Label>
            <Textarea
              id="addressLines"
              name="addressLines"
              rows={3}
              defaultValue={settings.contact.addressLines.join("\n")}
            />
          </div>
          <div>
            <Button type="submit" disabled={busy === "Contact & legal"}>
              {busy === "Contact & legal" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}{" "}
              Save
            </Button>
          </div>
        </form>
      </Panel>

      {/* Commerce & pricing */}
      <Panel title="Commerce & pricing rules">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await save("Commerce & pricing", {
              commerce: {
                baseCurrency: String(form.get("baseCurrency") ?? "INR").toUpperCase(),
                defaultCurrency: String(form.get("defaultCurrency") ?? "INR").toUpperCase(),
                freeShippingThresholdMinor: Math.round(
                  Number(form.get("freeShipping") ?? 0) * 100,
                ),
                codEnabled: form.get("cod") === "on",
                guestCheckoutEnabled: form.get("guest") === "on",
                newsletterEnabled: form.get("newsletter") === "on",
                reviewsEnabled: form.get("reviews") === "on",
                autoHideUnavailable: form.get("autoHide") === "on",
                maxImportRows: Math.round(Number(form.get("maxRows") ?? 5000)),
                maxImportFileBytes: Math.round(Number(form.get("maxBytes") ?? 5) * 1024 * 1024),
              },
              pricing: {
                defaultMarkupPercent: Number(form.get("markup") ?? 35),
                minimumMarginPercent: Number(form.get("minMargin") ?? 12),
                rounding: String(form.get("rounding") ?? "none"),
              },
            });
          }}
        >
          <Field label="Base currency (prices stored in)" name="baseCurrency" defaultValue={settings.commerce.baseCurrency} />
          <Field
            label="Default display currency"
            name="defaultCurrency"
            defaultValue={settings.commerce.defaultCurrency}
          />
          <Field
            label="Free shipping above (base currency)"
            name="freeShipping"
            type="number"
            step="0.01"
            defaultValue={(settings.commerce.freeShippingThresholdMinor / 100).toFixed(2)}
          />
          <Field
            label="Default markup %"
            name="markup"
            type="number"
            step="0.1"
            defaultValue={settings.pricing.defaultMarkupPercent}
          />
          <Field
            label="Minimum margin % (warn below)"
            name="minMargin"
            type="number"
            step="0.1"
            defaultValue={settings.pricing.minimumMarginPercent}
          />
          <div>
            <Label htmlFor="rounding">Price rounding</Label>
            <select
              id="rounding"
              name="rounding"
              defaultValue={settings.pricing.rounding}
              className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
            >
              <option value="none">No rounding</option>
              <option value="nearest_99">Nearest …99</option>
              <option value="nearest_whole">Nearest whole unit</option>
            </select>
          </div>
          <Field
            label="Max import rows per file"
            name="maxRows"
            type="number"
            defaultValue={settings.commerce.maxImportRows}
          />
          <Field
            label="Max import file size (MB)"
            name="maxBytes"
            type="number"
            defaultValue={Math.round(settings.commerce.maxImportFileBytes / (1024 * 1024))}
          />
          <div className="space-y-2 text-sm sm:col-span-3">
            <Toggle name="cod" label="Cash on delivery for eligible zones" defaultChecked={settings.commerce.codEnabled} />
            <Toggle name="guest" label="Allow guest checkout" defaultChecked={settings.commerce.guestCheckoutEnabled} />
            <Toggle name="newsletter" label="Show newsletter signup" defaultChecked={settings.commerce.newsletterEnabled} />
            <Toggle name="reviews" label="Allow verified-purchase reviews" defaultChecked={settings.commerce.reviewsEnabled} />
            <Toggle
              name="autoHide"
              label="Auto-hide products when a supplier sync reports zero stock"
              defaultChecked={settings.commerce.autoHideUnavailable}
            />
          </div>
          <div>
            <Button type="submit" disabled={busy === "Commerce & pricing"}>
              {busy === "Commerce & pricing" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}{" "}
              Save
            </Button>
          </div>
        </form>
      </Panel>

      {/* Payments */}
      <Panel title="Payment providers">
        <InfoNote tone="warning">
          A provider only becomes selectable at checkout when every environment variable below is
          present on the deployment. Credentials are configured by the platform owner in the
          deployment environment — never in this form and never in front-end code. The built-in test
          gateway is a signed sandbox, not a real payment provider: disable it before going live.
        </InfoNote>
        <div className="mt-3 space-y-3">
          {data.providers.map((provider) => (
            <div key={provider.id} className="rounded-lg border border-border p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{provider.label}</span>
                <StatusPill
                  tone={
                    provider.envVars.every((entry) => entry.configured) ? "success" : "warning"
                  }
                >
                  {provider.envVars.every((entry) => entry.configured)
                    ? "Credentials present"
                    : "Pending credentials"}
                </StatusPill>
                <StatusPill tone={provider.enabled ? "info" : "neutral"}>
                  {provider.enabled ? "Enabled at checkout" : "Disabled"}
                </StatusPill>
                <a
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-primary hover:underline"
                >
                  Official docs
                </a>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Countries {provider.countries.join(", ")} · Currencies {provider.currencies.join(", ")}
              </p>
              <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                {provider.envVars.map((entry) => (
                  <li key={entry.key} className="flex items-center gap-1 rounded border border-border px-2 py-0.5">
                    <StatusPill tone={entry.configured ? "success" : "neutral"}>
                      {entry.configured ? "set" : "missing"}
                    </StatusPill>
                    <code>{entry.key}</code>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const next = settings.payments.providers.map((entry) =>
                      entry.id === provider.id ? { ...entry, enabled: !entry.enabled } : entry,
                    );
                    await save("Payment providers", {
                      payments: { providers: next, testGatewayEnabled: settings.payments.testGatewayEnabled },
                    });
                  }}
                >
                  {provider.enabled ? "Disable at checkout" : "Enable at checkout"}
                </Button>
              </div>
            </div>
          ))}
          <div className="rounded-lg border border-dashed border-border p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Built-in test gateway (sandbox)</span>
              <StatusPill tone={settings.payments.testGatewayEnabled ? "warning" : "neutral"}>
                {settings.payments.testGatewayEnabled ? "Enabled" : "Disabled"}
              </StatusPill>
              <StatusPill tone={data.testGatewaySecretConfigured ? "success" : "warning"}>
                {data.testGatewaySecretConfigured
                  ? "TEST_GATEWAY_WEBHOOK_SECRET set"
                  : "TEST_GATEWAY_WEBHOOK_SECRET missing"}
              </StatusPill>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Moves no money. It exists so the order → payment session → signed webhook →
              verification → fulfilment pipeline can be tested with sandbox credentials. Webhooks
              signed by the wrong secret are rejected.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() =>
                save("Payment providers", {
                  payments: {
                    providers: settings.payments.providers,
                    testGatewayEnabled: !settings.payments.testGatewayEnabled,
                  },
                })
              }
            >
              {settings.payments.testGatewayEnabled ? "Disable sandbox gateway" : "Enable sandbox gateway"}
            </Button>
          </div>
        </div>
      </Panel>

      {/* Currencies */}
      <Panel title="Currencies">
        <p className="text-xs text-muted-foreground">
          Rates are expressed as “1 unit of this currency = x units of {settings.commerce.baseCurrency}”.
          Checkout always charges in the base currency; other currencies are display conversions.
        </p>
        <div className="mt-3 overflow-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2">Code</th>
                <th className="py-2">Symbol</th>
                <th className="py-2">Name</th>
                <th className="py-2">Rate → base</th>
                <th className="py-2">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((row, index) => (
                <tr key={row.code} className="border-t border-border">
                  <td className="py-1 pr-2 font-medium">{row.code}</td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`${row.code} symbol`}
                      value={row.symbol}
                      className="h-8 w-20"
                      onChange={(event) => {
                        const next = [...currencies];
                        next[index] = { ...row, symbol: event.target.value };
                        setCurrencies(next);
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`${row.code} name`}
                      value={row.name}
                      className="h-8"
                      onChange={(event) => {
                        const next = [...currencies];
                        next[index] = { ...row, name: event.target.value };
                        setCurrencies(next);
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`${row.code} rate`}
                      type="number"
                      step="0.0001"
                      value={row.rateToBase}
                      className="h-8 w-24"
                      onChange={(event) => {
                        const next = [...currencies];
                        next[index] = { ...row, rateToBase: Number(event.target.value) };
                        setCurrencies(next);
                      }}
                    />
                  </td>
                  <td className="py-1">
                    <input
                      type="checkbox"
                      aria-label={`${row.code} enabled`}
                      className="size-4"
                      checked={row.enabled}
                      onChange={(event) => {
                        const next = [...currencies];
                        next[index] = { ...row, enabled: event.target.checked };
                        setCurrencies(next);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          disabled={busy === "Currencies"}
          onClick={() => save("Currencies", { currencies })}
        >
          {busy === "Currencies" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
          currencies
        </Button>
      </Panel>

      {/* Shipping zones */}
      <Panel title="Shipping zones">
        <p className="text-xs text-muted-foreground">
          Rates are in the base currency. “Serviceable = off” blocks checkout for that destination, so
          products are never sold into a country you cannot ship to.
        </p>
        <div className="mt-3 overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2">Country</th>
                <th className="py-2">Zone</th>
                <th className="py-2">Rate</th>
                <th className="py-2">Free above</th>
                <th className="py-2">ETA (days)</th>
                <th className="py-2">Serviceable</th>
                <th className="py-2">COD</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((row, index) => (
                <tr key={row.countryCode} className="border-t border-border">
                  <td className="py-1 pr-2">
                    {row.country} ({row.countryCode})
                  </td>
                  <td className="py-1 pr-2">{titleCase(row.zone)}</td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`${row.countryCode} rate`}
                      type="number"
                      step="1"
                      value={row.rateMinor / 100}
                      className="h-8 w-24"
                      onChange={(event) => {
                        const next = [...zones];
                        next[index] = { ...row, rateMinor: Math.round(Number(event.target.value) * 100) };
                        setZones(next);
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`${row.countryCode} free above`}
                      type="number"
                      step="1"
                      value={row.freeAboveMinor / 100}
                      className="h-8 w-24"
                      onChange={(event) => {
                        const next = [...zones];
                        next[index] = {
                          ...row,
                          freeAboveMinor: Math.round(Number(event.target.value) * 100),
                        };
                        setZones(next);
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`${row.countryCode} eta`}
                      type="number"
                      value={row.etaDays}
                      className="h-8 w-16"
                      onChange={(event) => {
                        const next = [...zones];
                        next[index] = { ...row, etaDays: Number(event.target.value) };
                        setZones(next);
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`${row.countryCode} serviceable`}
                      className="size-4"
                      checked={row.serviceable}
                      onChange={(event) => {
                        const next = [...zones];
                        next[index] = { ...row, serviceable: event.target.checked };
                        setZones(next);
                      }}
                    />
                  </td>
                  <td className="py-1">
                    <input
                      type="checkbox"
                      aria-label={`${row.countryCode} cod`}
                      className="size-4"
                      checked={row.codAvailable}
                      onChange={(event) => {
                        const next = [...zones];
                        next[index] = { ...row, codAvailable: event.target.checked };
                        setZones(next);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          disabled={busy === "Shipping zones"}
          onClick={() => save("Shipping zones", { shippingZones: zones })}
        >
          {busy === "Shipping zones" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
          zones
        </Button>
      </Panel>

      {/* Tax rules */}
      <Panel title="Tax rules">
        <InfoNote tone="warning">
          These are configuration defaults, not tax advice. Confirm the correct treatment for every
          destination, and whether duties are collected at checkout or on delivery, with your tax
          adviser before going live. KNOKH does not promise prepaid duties unless your shipping
          arrangement actually supports it.
        </InfoNote>
        <div className="mt-3 overflow-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2">Country</th>
                <th className="py-2">Label</th>
                <th className="py-2">Rate %</th>
                <th className="py-2">Included in price</th>
              </tr>
            </thead>
            <tbody>
              {taxRules.map((row, index) => (
                <tr key={row.countryCode} className="border-t border-border">
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`${row.countryCode} tax country`}
                      value={row.countryCode}
                      className="h-8 w-20"
                      onChange={(event) => {
                        const next = [...taxRules];
                        next[index] = { ...row, countryCode: event.target.value.toUpperCase() };
                        setTaxRules(next);
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`${row.countryCode} tax label`}
                      value={row.label}
                      className="h-8"
                      onChange={(event) => {
                        const next = [...taxRules];
                        next[index] = { ...row, label: event.target.value };
                        setTaxRules(next);
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`${row.countryCode} tax rate`}
                      type="number"
                      step="0.1"
                      value={row.ratePercent}
                      className="h-8 w-20"
                      onChange={(event) => {
                        const next = [...taxRules];
                        next[index] = { ...row, ratePercent: Number(event.target.value) };
                        setTaxRules(next);
                      }}
                    />
                  </td>
                  <td className="py-1">
                    <input
                      type="checkbox"
                      aria-label={`${row.countryCode} inclusive`}
                      className="size-4"
                      checked={row.inclusive}
                      onChange={(event) => {
                        const next = [...taxRules];
                        next[index] = { ...row, inclusive: event.target.checked };
                        setTaxRules(next);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          disabled={busy === "Tax rules"}
          onClick={() => save("Tax rules", { taxRules })}
        >
          {busy === "Tax rules" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save tax
          rules
        </Button>
      </Panel>

      {/* Homepage */}
      <Panel title="Homepage sections">
        <p className="text-xs text-muted-foreground">
          Reorder, rename, show or hide each homepage block. Disabled sections are skipped by the
          storefront immediately.
        </p>
        <ul className="mt-3 space-y-2">
          {sections.map((section, index) => (
            <li key={section.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={section.enabled ? "success" : "neutral"}>
                  {section.enabled ? "Visible" : "Hidden"}
                </StatusPill>
                <Input
                  aria-label={`${section.id} title`}
                  value={section.title}
                  className="h-8 w-56"
                  onChange={(event) => {
                    const next = [...sections];
                    next[index] = { ...section, title: event.target.value };
                    setSections(next);
                  }}
                />
                <span className="text-xs text-muted-foreground">{section.type}</span>
                <div className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move up"
                    onClick={() => {
                      const next = [...sections];
                      if (index === 0) return;
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      setSections(next.map((row, position) => ({ ...row, position })));
                    }}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move down"
                    onClick={() => {
                      const next = [...sections];
                      if (index === next.length - 1) return;
                      [next[index + 1], next[index]] = [next[index], next[index + 1]];
                      setSections(next.map((row, position) => ({ ...row, position })));
                    }}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const next = [...sections];
                      next[index] = { ...section, enabled: !section.enabled };
                      setSections(next);
                    }}
                  >
                    {section.enabled ? "Hide" : "Show"}
                  </Button>
                </div>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <Input
                  aria-label={`${section.id} subtitle`}
                  placeholder="Subtitle"
                  value={section.subtitle ?? ""}
                  className="h-8"
                  onChange={(event) => {
                    const next = [...sections];
                    next[index] = { ...section, subtitle: event.target.value };
                    setSections(next);
                  }}
                />
                <Input
                  aria-label={`${section.id} cta label`}
                  placeholder="CTA label"
                  value={section.ctaLabel ?? ""}
                  className="h-8"
                  onChange={(event) => {
                    const next = [...sections];
                    next[index] = { ...section, ctaLabel: event.target.value };
                    setSections(next);
                  }}
                />
                <Input
                  aria-label={`${section.id} cta href`}
                  placeholder="CTA link (e.g. /shop)"
                  value={section.ctaHref ?? ""}
                  className="h-8"
                  onChange={(event) => {
                    const next = [...sections];
                    next[index] = { ...section, ctaHref: event.target.value };
                    setSections(next);
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          disabled={busy === "Homepage sections"}
          onClick={() => save("Homepage sections", { homepage: sections })}
        >
          {busy === "Homepage sections" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}{" "}
          Save homepage
        </Button>
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  step,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  type?: string;
  step?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        step={step}
        placeholder={placeholder}
        defaultValue={defaultValue}
      />
    </div>
  );
}

function Toggle({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" name={name} className="size-4" defaultChecked={defaultChecked} /> {label}
    </label>
  );
}
