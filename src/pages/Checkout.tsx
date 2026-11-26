import { ConvexError } from "convex/values";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
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
import { deliveryDateRange } from "@/lib/delivery";
import { formatMoney } from "@/lib/format";
import { keepGuestOrderToken, readGuestOrderToken } from "@/lib/guestOrders";
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
    script.onerror = () => {
      script.remove();
      reject(new Error("Payment checkout could not load."));
    };
    document.head.appendChild(script);
  });
}

export default function Checkout() {
  const navigate = useNavigate();
  const { guestKey, config } = useStore();
  const moneyLocal = (amount: number) => formatMoney(amount, config?.currencies.find((entry) => entry.code === "INR"));
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const shippingMethodId = searchParams.get("ship") ?? "standard";

  const quote = useQuery(api.checkout.getCheckoutQuote, {
    guestKey: guestKey || undefined,
    currency: "INR",
    countryCode: "IN",
    shippingMethodId,
  });
  const placeOrder = useMutation(api.checkout.placeOrder);

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
  const [selectedPayment, setPaymentChoice] = useState("");
  const paymentChoice = selectedPayment || quote?.paymentOptions.online[0]?.id ||
    quote?.paymentOptions.cod?.id || "";
  const pin = form.postalCode.trim();
  const estimate = useQuery(api.checkout.estimateDelivery, /^[1-9][0-9]{5}$/.test(pin) ? { pin } : "skip");
  const requestId = useRef<string | undefined>(undefined);
  const submittingRequest = useRef(false);
  const [notes, setNotes] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePageMeta({ title: "Secure checkout", path: "/checkout", noIndex: true, siteUrl: config?.seo.siteUrl });

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
  const configuredOnline = quote.paymentOptions.online;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRequest.current) return;
    submittingRequest.current = true;
    setError(null);
    setSubmitting(true);
    let createdOrderId: string | undefined;
    try {
      requestId.current ??= crypto.randomUUID();
      const useCod = paymentChoice === "cod";
      const result = await placeOrder({
        requestId: requestId.current,
        guestKey,
        contact: {
          name: form.name || form.fullName, email: form.email, phone: form.phone,
        },
        shippingAddress: {
          fullName: form.fullName || form.name, phone: form.phone, email: form.email,
          line1: form.line1, line2: form.line2 || undefined, city: form.city, state: form.state,
          postalCode: pin, countryCode: "IN", country: "India",
        },
        shippingMethodId: selectedShipping?.id ?? "standard",
        paymentMethod: useCod ? "cod" : "online",
        providerId: useCod ? undefined : paymentChoice,
        notes: notes || undefined,
        marketingConsent,
      });
      createdOrderId = result.orderId;
      if (result.guestToken) keepGuestOrderToken(result.orderId, result.guestToken);
      if (!result.requiresPayment) {
        navigate(`/order/${result.orderId}`);
        return;
      }
      navigate(`/checkout/return?orderId=${result.orderId}`, { state: { openPayment: true } });
    } catch (submitError) {
      setError(submitError instanceof ConvexError
        ? String(submitError.data)
        : "We could not place your order. Check your details and try again.");
    } finally {
      if (!createdOrderId) submittingRequest.current = false;
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
                <Input id="country" value="India" readOnly />
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
                  PIN code
                </Label>
                <Input
                  id="postalCode"
                  required
                  inputMode="numeric"
                  pattern="[1-9][0-9]{5}"
                  maxLength={6}
                  value={form.postalCode}
                  onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
                />
              </div>
            </div>
            {pin.length === 6 ? (
              <p className="mt-3 text-sm" aria-live="polite">
                {estimate?.status === "available" ? `Estimated delivery ${deliveryDateRange(estimate.earliest, estimate.latest)}`
                  : estimate?.status === "unsupported" ? "Delivery is unavailable for this PIN code."
                    : estimate?.status === "unconfigured" ? "Delivery estimates are unavailable. Contact support."
                      : !/^[1-9][0-9]{5}$/.test(pin) ? "Enter a valid Indian PIN code." : "Checking delivery…"}
              </p>
            ) : null}
            {zone && !zone.serviceable ? (
              <InfoNote tone="warning" className="mt-4">
                Checkout is currently unavailable for this destination.
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

              {configuredOnline.length === 0 &&
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
              disabled={submitting || quote.blockers.length > 0 || !paymentChoice || estimate?.status !== "available"}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
              {paymentChoice === "cod" ? "Place order (COD)" : "Pay and place order"}
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              No change-of-mind returns or refunds. Your legal rights still apply.{" "}
              <Link className="underline" to="/info/returns-refunds">Returns and refunds policy</Link>.
              Card details are handled by the payment provider.
            </p>
          </div>
        </aside>
      </form>
    </Container>
  );
}

/** A return to the store only reads the verified payment state. */
export function CheckoutReturn() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const orderId = searchParams.get("orderId") ?? "";
  const { config } = useStore();
  const guestToken = readGuestOrderToken(orderId);
  const createSession = useAction(api.paymentsActions.createPaymentSession);
  const confirmPayment = useMutation(api.payments.confirmCheckoutResult);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const autoOpened = useRef(false);
  const opening = useRef(false);

  const payment = useQuery(
    api.payments.getPaymentForOrder,
    /^[a-z0-9]{20,64}$/i.test(orderId) ? { orderId: orderId as Id<"orders">, guestToken } : "skip",
  );
  const latest = payment?.payments[0];
  const paid = latest?.status === "captured";
  const canPay = latest?.provider === "razorpay" && ["created", "pending", "failed"].includes(latest.status);

  usePageMeta({ title: "Payment status", noIndex: true, path: "/checkout/return", siteUrl: config?.seo.siteUrl });

  async function openCheckout() {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      // Load the provider UI first so a blocked script does not start order creation.
      await loadScript("https://checkout.razorpay.com/v1/checkout.js");
      if (!window.Razorpay) throw new Error("Payment checkout could not load.");
      const session = await createSession({ orderId: orderId as Id<"orders">, guestToken });
      const payload = session.clientPayload as {
        key: string; razorpayOrderId: string; amountMinor: number;
        currency: string; name: string; description: string;
      };
      new window.Razorpay({
        key: payload.key, amount: payload.amountMinor, currency: payload.currency,
        name: payload.name, description: payload.description, order_id: payload.razorpayOrderId,
        handler: async (response) => {
          try {
            await confirmPayment({
              orderId: orderId as Id<"orders">, guestToken,
              providerOrderId: response.razorpay_order_id,
              providerPaymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            });
            navigate(`/order/${orderId}`);
          } catch {
            setMessage("The payment is awaiting confirmation. Check the order status before retrying.");
            opening.current = false;
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => {
            setMessage("Checkout was closed. Check the payment status before retrying.");
            opening.current = false;
            setBusy(false);
          },
        },
      }).open();
    } catch {
      setMessage("Payment checkout could not open. Check this order or contact support before retrying.");
      opening.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (location.state?.openPayment && canPay && !autoOpened.current) {
      autoOpened.current = true;
      const start = window.setTimeout(() => void openCheckout(), 0);
      return () => {
        window.clearTimeout(start);
        autoOpened.current = false;
      };
    }
  // Only auto-open when the owned payment first becomes available.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPay, location.state]);

  if (!/^[a-z0-9]{20,64}$/i.test(orderId) || payment === null) {
    return <Container className="py-16"><EmptyState title="Order unavailable" description="Open an order from your account or track a guest order." /></Container>;
  }
  if (payment === undefined) return <Container className="py-16"><LoadingBlock label="Checking payment…" /></Container>;

  return (
    <Container className="max-w-2xl py-16">
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        {paid ? <CheckCircle2 className="mx-auto size-10 text-emerald-600" /> : <CreditCard className="mx-auto size-10 text-primary" />}
        <h1 className="mt-4 text-xl font-bold">{paid ? "Payment confirmed" : "Payment status"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {paid ? "Razorpay confirmed the payment." : "This page updates when the payment provider confirms the capture."}
        </p>
        {message ? <p role="status" className="mt-3 text-sm">{message}</p> : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {canPay ? <Button disabled={busy} onClick={() => void openCheckout()}>Open payment checkout</Button> : null}
          <Button variant="outline" asChild><Link to={`/order/${orderId}`}>View order</Link></Button>
        </div>
      </div>
    </Container>
  );
}
