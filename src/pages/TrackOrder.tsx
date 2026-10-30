import { useQuery } from "@/lib/cloudflare-client";
import { Loader2, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "@/lib/api";
import {
  Container,
  EmptyState,
  InfoNote,
  SectionHeading,
  StatusPill,
} from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, titleCase } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";

/**
 * Guest order lookup. The query returns nothing unless the order number and the
 * email address on the order both match, so an order cannot be enumerated.
 */
export default function TrackOrder() {
  const { config } = useStore();
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const result = useQuery(
    api.orders.lookupGuestOrder,
    submitted && orderNumber && email ? { orderNumber, email } : "skip",
  );

  usePageMeta({
    title: "Track an order",
    description:
      "Look up a KNOKH order with your order number and the email address used at checkout.",
    path: "/track-order",
    siteUrl: config?.seo.siteUrl,
  });

  return (
    <Container className="max-w-2xl py-12">
      <SectionHeading
        title="Track an order"
        subtitle="Enter the order number from your confirmation email together with the email address used at checkout."
      />

      <form
        className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
        }}
      >
        <div>
          <Label htmlFor="orderNumber">Order number</Label>
          <Input
            id="orderNumber"
            required
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value.toUpperCase())}
            placeholder="KN-260101-000123"
          />
        </div>
        <div>
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <Button type="submit" className="w-full gap-2">
          <Search className="size-4" /> Find my order
        </Button>
      </form>

      {submitted ? (
        <div className="mt-6">
          {result === undefined ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Looking up your order…
            </p>
          ) : result === null ? (
            <EmptyState
              title="No matching order"
              description="Check the order number and email address. For privacy we do not reveal whether an order number exists."
              action={
                <Button asChild variant="outline">
                  <Link to="/account/orders">Sign in to see your orders</Link>
                </Button>
              }
            />
          ) : (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{result.orderNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    Placed {formatDate(result.placedAt)} · {result.totalMinor / 100}{" "}
                    {result.currency}
                  </p>
                </div>
                <div className="flex gap-2">
                  <StatusPill tone="info">{titleCase(result.fulfilmentStatus)}</StatusPill>
                  <StatusPill tone={result.paymentStatus === "paid" ? "success" : "warning"}>
                    {titleCase(result.paymentStatus)}
                  </StatusPill>
                </div>
              </div>
              <Button asChild className="mt-4">
                <Link to={`/order/${result.orderId}?email=${encodeURIComponent(email)}`}>
                  Open full order details
                </Link>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <InfoNote className="mt-6">
          Signed-in customers can see every order, shipment and return in the{" "}
          <Link to="/account/orders" className="font-semibold text-primary hover:underline">
            orders area
          </Link>
          .
        </InfoNote>
      )}
    </Container>
  );
}
