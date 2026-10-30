import { useAction, useMutation, useQuery } from "@/lib/cloudflare-client";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Container,
  EmptyState,
  InfoNote,
  LoadingBlock,
  SectionHeading,
  StatusPill,
} from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
    Cashfree?: (options: { mode: string }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget: string }) => Promise<unknown>;
    };
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

export default function Checkout() {
  const navigate = useNavigate();
  const { guestKey, currency, country, config, moneyLocal, setCountry } = useStore();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const shippingMethodId = searchParams.get("ship") ?? "standard";

  const quote = useQuery(api.checkout.getCheckoutQuote, {
    guestKey: guestKey || undefined,
    currency,
    countryCode: country,
    shippingMethodId,
  });
  const placeOrder = useMutation(api.checkout.placeOrder);
  const createSession = useAction(api.paymentsActions.createPaymentSession);
  const confirmPayment = useMutation(api.payments.confirmCheckoutResult);

  const [form, setForm] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: "",
    fullName: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
  });
  const [paymentChoice, setPaymentChoice] = useState("test_gateway");
  const [notes, setNotes] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePageMeta({ title: "Secure checkout", path: "/checkout", noIndex: true, siteUrl: config?.seo.siteUrl });

  useEffect(() => {
    if (!quote) return;
    const options = quote.paymentOptions;
    const firstOnline = options.online.find((provider) => provider.status === "configured");
    if (firstOnline) setPaymentChoice(firstOnline.id);
    else if (options.testGateway) setPaymentChoice("test_gateway");
    else if (options.cod) setPaymentChoice("cod");
    else setPaymentChoice("");
  }, [quote?.paymentOptions.online.length, quote?.paymentOptions.testGateway, quote?.paymentOptions.cod]);

  if (!guestKey || quote === undefined) {
    return (
      <Container className="py-16">
        <LoadingBlock label="Preparing checkout…" />
      </Container>
    );
  }

  if (quote === null || quote.lines.length === 0) {
    return (
      <Container className="py-16">
        <EmptyState
          title="Nothing to check out"
          description="Your cart is empty. Add a product and come back to complete your order."
          action={
            <Button asChild>
              <Link to="/shop">Browse products</Link>
            </Button>
          }
        />
      </Container>
    );
  }

  const zone = quote.zone;
  const selectedShipping =
    quote.shippingOptions.find((option) => option.id === shippingMethodId) ??
    quote.shippingOptions[0];
  const zoneCountry = config?.shippingZones.find((entry) => entry.countryCode === country);
  const configuredOnline = quote.paymentOptions.online.filter(
    (provider) => provider.status === "configured",
  );
  const pendingOnline = quote.paymentOptions.online.filter(
    (provider) => provider.status !== "configured",
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const useCod = paymentChoice === "cod";
      const result = await placeOrder({
        guestKey,
        currency,
        contact: {
          name: form.name || form.fullName,
          email: form.email,
          phone: form.phone,
        },
        shippingAddress: {
          fullName: form.fullName || form.name,
          phone: form.phone,
          email: form.email,
          line1: form.line1,
          line2: form.line2 || undefined,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          countryCode: country,
          country: zoneCountry?.country ?? country,
        },
        shippingMethodId: selectedShipping?.id ?? "standard",
        paymentMethod: useCod ? "cod" : "online",
        providerId: useCod ? undefined : paymentChoice,
        notes: notes || undefined,
        marketingConsent,
      });

      if (!result.requiresPayment) {
        navigate(`/order/${result.orderId}?email=${encodeURIComponent(form.email)}`);
        return;
      }

      // Provider handoff. Every provider path ends with a server-side
      // verification step; a redirect alone never marks an order paid.
      const session = await createSession({
        orderId: result.orderId as Id<"orders">,
        origin: window.location.origin,
      });

      if (session.provider === "test_gateway") {
        navigate(`/checkout/sandbox/${result.orderId}`);
        return;
      }

      if (session.provider === "razorpay") {
        await loadScript("https://checkout.razorpay.com/v1/checkout.js");
        if (!window.Razorpay) throw new Error("The Razorpay checkout script did not load.");
        const payload = session.clientPayload as {
          key: string;
          razorpayOrderId: string;
          amountMinor: number;
          currency: string;
          name: string;
          description: string;
        };
        const checkout = new window.Razorpay({
          key: payload.key,
          amount: payload.amountMinor,
          currency: payload.currency,
          name: payload.name,
          description: payload.description,
          order_id: payload.razorpayOrderId,
          prefill: { name: form.fullName, email: form.email, contact: form.phone },
          handler: async (response) => {
            try {
              await confirmPayment({
                orderId: result.orderId as Id<"orders">,
                providerOrderId: response.razorpay_order_id,
                providerPaymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              });
              navigate(`/order/${result.orderId}?email=${encodeURIComponent(form.email)}`);
            } catch (verificationError) {
              toast.error(
                verificationError instanceof Error
                  ? verificationError.message
                  : "Payment verification failed.",
              );
              navigate(`/checkout/return?orderId=${result.orderId}`);
            }
          },
          modal: {
            ondismiss: () => {
              toast.message("Payment was not completed. Your order is still waiting.");
              navigate(`/checkout/return?orderId=${result.orderId}`);
            },
          },
        });
        checkout.open();
        return;
      }

      if (session.provider === "cashfree") {
        await loadScript("https://sdk.cashfree.com/js/v3/cashfree.js");
        if (!window.Cashfree) throw new Error("The Cashfree SDK did not load.");
        const payload = session.clientPayload as {
          paymentSessionId: string;
          environment: string;
        };
        const cashfree = window.Cashfree({
          mode: payload.environment === "production" ? "production" : "sandbox",
        });
        await cashfree.checkout({
          paymentSessionId: payload.paymentSessionId,
          redirectTarget: "_self",
        });
        return;
      }

      if (session.provider === "paypal") {
        const payload = session.clientPayload as { approveUrl?: string };
        if (!payload.approveUrl) throw new Error("PayPal did not return an approval link.");
        window.location.assign(payload.approveUrl);
        return;
      }

      throw new Error(`No client handoff is implemented for ${session.provider}.`);
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "We could not place your order.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container className="py-8">
      <SectionHeading
        title="Secure checkout"
        subtitle={`Totals are calculated on the KNOKH server in ${quote.currency}.`}
      />

      <form onSubmit={handleSubmit} className="mt-6 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">1. Contact details</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="email">Email for order updates</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone (with country code)</Label>
                <Input
                  id="phone"
                  required
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  placeholder="+91 98765 43210"
                />
              </div>
              <div>
                <Label htmlFor="country">Destination country</Label>
                <select
                  id="country"
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
                >
                  {(config?.shippingZones ?? []).map((entry) => (
                    <option key={entry.countryCode} value={entry.countryCode}>
                      {entry.country}
                      {entry.serviceable ? "" : " — not serviceable"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">2. Delivery address</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="fullName">Recipient name</Label>
                <Input
                  id="fullName"
                  required
                  value={form.fullName}
                  onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="line1">Address line 1</Label>
                <Input
                  id="line1"
                  required
                  value={form.line1}
                  onChange={(event) => setForm({ ...form, line1: event.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="line2">Address line 2 (optional)</Label>
                <Input
                  id="line2"
                  value={form.line2}
                  onChange={(event) => setForm({ ...form, line2: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="city">City / town</Label>
                <Input
                  id="city"
                  required
                  value={form.city}
                  onChange={(event) => setForm({ ...form, city: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="state">State / region</Label>
                <Input
                  id="state"
                  required
                  value={form.state}
                  onChange={(event) => setForm({ ...form, state: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="postalCode">
                  {country === "IN" ? "PIN code" : "Postal code"}
                </Label>
                <Input
                  id="postalCode"
                  required
                  inputMode={country === "IN" ? "numeric" : "text"}
                  value={form.postalCode}
                  onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
                />
              </div>
            </div>
            {zone && !zone.serviceable ? (
              <InfoNote tone="warning" className="mt-4">
                We do not currently deliver to {zone.country}. Choose another destination country.
              </InfoNote>
            ) : null}
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">3. Delivery method</h2>
            <div className="mt-4 space-y-2">
              {quote.shippingOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSearchParams({ ship: option.id }, { replace: true })}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm",
                    selectedShipping?.id === option.id
                      ? "border-primary bg-primary/5"
                      : "border-border",
                  )}
                >
                  <span>
                    <span className="font-medium">{option.label}</span>
                    <span className="ml-2 text-muted-foreground">
                      about {option.etaDays} days
                    </span>
                  </span>
                  <span className="font-semibold">
                    {option.rateMinor === 0 ? "Free" : moneyLocal(option.rateMinor)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">4. Payment method</h2>
            <div className="mt-4 space-y-2">
              {configuredOnline.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setPaymentChoice(provider.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm",
                    paymentChoice === provider.id ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <CreditCard className="size-4 text-primary" />
                  <span className="font-medium">{provider.label}</span>
                  <StatusPill tone="success" className="ml-auto">
                    Ready
                  </StatusPill>
                </button>
              ))}

              {quote.paymentOptions.testGateway ? (
                <button
                  type="button"
                  onClick={() => setPaymentChoice("test_gateway")}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm",
                    paymentChoice === "test_gateway" ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <ShieldCheck className="mt-0.5 size-4 text-primary" />
                  <span>
                    <span className="font-medium">Test gateway (sandbox)</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      A KNOKH test harness that signs a webhook exactly like a live gateway so
                      the order pipeline can be verified. No real money moves and no card details
                      are collected. Disable it in Admin → Settings before going live.
                    </span>
                  </span>
                </button>
              ) : null}

              {quote.paymentOptions.cod ? (
                <button
                  type="button"
                  onClick={() => setPaymentChoice("cod")}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm",
                    paymentChoice === "cod" ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <Banknote className="size-4 text-primary" />
                  <span className="font-medium">{quote.paymentOptions.cod.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    Pay the courier on delivery
                  </span>
                </button>
              ) : null}

              {pendingOnline.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-start gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm opacity-80"
                >
                  <CreditCard className="mt-0.5 size-4 text-muted-foreground" />
                  <span>
                    <span className="font-medium">{provider.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Not configured yet. An administrator must set{" "}
                      {provider.missingEnvVars.join(", ")} on the deployment and enable the
                      provider in Admin → Settings → Payments.
                    </span>
                    <a
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs text-primary hover:underline"
                    >
                      Provider setup documentation
                    </a>
                  </span>
                </div>
              ))}

              {configuredOnline.length === 0 &&
              !quote.paymentOptions.testGateway &&
              !quote.paymentOptions.cod ? (
                <InfoNote tone="danger">
                  No payment method is available for this destination yet. Contact support —
                  online payments require an approved gateway account.
                </InfoNote>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">5. Order notes (optional)</h2>
            <Textarea
              className="mt-3"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Delivery instructions, landmark, preferred time window…"
            />
            <div className="mt-4 flex items-start gap-2">
              <Checkbox
                id="marketing"
                checked={marketingConsent}
                onCheckedChange={(value) => setMarketingConsent(value === true)}
              />
              <Label htmlFor="marketing" className="text-xs font-normal leading-snug text-muted-foreground">
                Email me product news and offers. You can unsubscribe at any time.
              </Label>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-semibold">Order summary</p>
            <ul className="mt-4 space-y-3 text-sm">
              {quote.lines.map((line) => (
                <li key={line.cartItemId} className="flex gap-3">
                  {line.image ? (
                    <img src={line.image} alt="" className="size-12 rounded object-cover" />
                  ) : null}
                  <span className="flex-1">
                    <span className="line-clamp-2 font-medium">{line.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      Qty {line.quantity}
                      {line.variantName ? ` · ${line.variantName}` : ""}
                    </span>
                  </span>
                  <span className="font-medium">{moneyLocal(line.lineTotalMinor)}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{moneyLocal(quote.subtotalMinor)}</span>
              </div>
              {quote.discountMinor > 0 ? (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Coupon {quote.coupon.code}</span>
                  <span>−{moneyLocal(quote.discountMinor)}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {quote.taxInclusive ? `${quote.taxLabel} (included)` : "Tax"}
                </span>
                <span>{moneyLocal(quote.taxMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping</span>
                <span>
                  {(selectedShipping?.rateMinor ?? 0) === 0
                    ? "Free"
                    : moneyLocal(selectedShipping?.rateMinor ?? 0)}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Payable now</span>
                <span>
                  {moneyLocal(
                    quote.taxInclusive
                      ? quote.subtotalMinor -
                          quote.discountMinor +
                          (selectedShipping?.rateMinor ?? 0)
                      : quote.subtotalMinor -
                          quote.discountMinor +
                          quote.taxMinor +
                          (selectedShipping?.rateMinor ?? 0),
                  )}
                </span>
              </div>
            </div>

            {quote.blockers.length > 0 ? (
              <InfoNote tone="warning" className="mt-4">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="size-4" /> Fix these first
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {quote.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </InfoNote>
            ) : null}

            {error ? (
              <InfoNote tone="danger" className="mt-4">
                {error}
              </InfoNote>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="mt-5 w-full gap-2"
              disabled={submitting || quote.blockers.length > 0 || !paymentChoice}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
              {paymentChoice === "cod" ? "Place order (COD)" : "Pay and place order"}
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              By placing an order you agree to the terms and the returns policy. Card details are
              handled by the payment provider and never stored by KNOKH.
            </p>
          </div>
        </aside>
      </form>
    </Container>
  );
}

/** Handles the provider return URL after an external payment flow. */
export function CheckoutReturn() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId") ?? "";
  const { config } = useStore();
  const payment = useQuery(
    api.payments.getPaymentForOrder,
    orderId ? { orderId: orderId as Id<"orders"> } : "skip",
  );

  usePageMeta({ title: "Payment status", noIndex: true, path: "/checkout/return", siteUrl: config?.seo.siteUrl });

  if (!orderId) {
    return (
      <Container className="py-16">
        <EmptyState title="No order reference" description="Return to your orders page to continue." />
      </Container>
    );
  }

  if (payment === undefined) {
    return (
      <Container className="py-16">
        <LoadingBlock label="Checking the payment with the gateway…" />
      </Container>
    );
  }

  const latest = payment?.payments[0];
  const paid = latest?.status === "captured";

  return (
    <Container className="max-w-2xl py-16">
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        {paid ? (
          <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        ) : (
          <Loader2 className="mx-auto size-10 animate-spin text-primary" />
        )}
        <h1 className="mt-4 text-xl font-bold tracking-tight">
          {paid ? "Payment confirmed" : "Waiting for gateway confirmation"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {paid
            ? "We received a signature-verified confirmation and fulfilment has started."
            : "We will not mark this order as paid until the gateway confirms it with a verified signature or webhook. This page updates automatically."}
        </p>
        {latest ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Provider: {latest.provider} · status: {latest.status}
            {latest.signatureVerified ? " · signature verified" : ""}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/account/orders">Go to my orders</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/shop">Keep shopping</Link>
          </Button>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Payment events received</p>
        <ul className="mt-2 space-y-1">
          {(payment?.events ?? []).map((event) => (
            <li key={event._id}>
              {event.provider} · {event.eventType} ·{" "}
              {event.signatureValid ? "signature valid" : "signature rejected"} ·{" "}
              {event.processed ? "processed" : "not processed"}
              {event.processingError ? ` — ${event.processingError}` : ""}
            </li>
          ))}
          {(payment?.events.length ?? 0) === 0 ? <li>None yet.</li> : null}
        </ul>
      </div>
    </Container>
  );
}

/** Sandbox checkout for the built-in test gateway. */
export function SandboxCheckout() {
  const { orderId = "" } = useParams();
  const navigate = useNavigate();
  const { config, moneyLocal } = useStore();
  const simulate = useAction(api.paymentsActions.simulateTestGatewayEvent);
  const [busy, setBusy] = useState<"captured" | "failed" | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const order = useQuery(
    api.orders.getOrderForCheckout,
    orderId ? { orderId: orderId as Id<"orders"> } : "skip",
  );

  usePageMeta({ title: "Sandbox payment", noIndex: true, path: "/checkout/sandbox", siteUrl: config?.seo.siteUrl });

  const run = async (outcome: "captured" | "failed") => {
    setBusy(outcome);
    try {
      const response = await simulate({ orderId: orderId as Id<"orders">, outcome });
      setResult(
        `Webhook delivered with a valid signature. Result: ${response.status ?? "ignored"}${
          response.duplicate ? " (duplicate ignored — idempotency working)" : ""
        }.`,
      );
      if (outcome === "captured") {
        setTimeout(() => navigate(`/order/${orderId}`), 900);
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : "The simulation failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Container className="max-w-2xl py-16">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-6">
        <h1 className="text-xl font-bold tracking-tight">Test gateway — no real money</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is a signed sandbox. It builds the same HMAC-SHA256 signed webhook a live
          gateway sends and pushes it through the production verification, idempotency and
          fulfilment path. It exists so the order pipeline can be tested before merchant
          approval. Disable it in Admin → Settings → Payments before trading.
        </p>
        {order ? (
          <div className="mt-5 rounded-lg border border-border bg-background p-4 text-sm">
            <p className="font-semibold">Order {order.orderNumber}</p>
            <p className="mt-1 text-muted-foreground">
              {moneyLocal(order.totalMinor)} {order.currency} · payment status{" "}
              {order.paymentStatus}
            </p>
          </div>
        ) : (
          <LoadingBlock label="Loading the order…" />
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button disabled={busy !== null} onClick={() => void run("captured")}>
            {busy === "captured" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Simulate successful payment
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => void run("failed")}
          >
            {busy === "failed" ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
            Simulate failed payment
          </Button>
        </div>
        {result ? (
          <InfoNote className="mt-4">
            {result}
          </InfoNote>
        ) : null}
      </div>
    </Container>
  );
}
