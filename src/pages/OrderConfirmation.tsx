import { useQuery } from "convex/react";
import { CheckCircle2, Clock, PackageCheck, Truck } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Container,
  EmptyState,
  InfoNote,
  LoadingBlock,
  StatusPill,
} from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { formatDateTime, titleCase } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";

export default function OrderConfirmation() {
  const { orderId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") ?? undefined;
  const { config, moneyLocal } = useStore();
  const detail = useQuery(
    api.orders.getOrderDetail,
    orderId ? { orderId: orderId as Id<"orders">, email } : "skip",
  );

  usePageMeta({
    title: "Order confirmation",
    noIndex: true,
    path: `/order/${orderId}`,
    siteUrl: config?.seo.siteUrl,
  });

  if (detail === undefined) {
    return (
      <Container className="py-16">
        <LoadingBlock label="Loading your order…" />
      </Container>
    );
  }

  if (detail === null) {
    return (
      <Container className="py-16">
        <EmptyState
          title="We could not open that order"
          description="Sign in with the account used for the order, or look it up with the order number and email address."
          action={
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/track-order">Track an order</Link>
              </Button>
            </div>
          }
        />
      </Container>
    );
  }

  const { order, items, shipments, fulfilment } = detail;
  const paid = order.paymentStatus === "paid";
  const codPending = order.paymentStatus === "cod_pending";
  const awaitingPayment = order.paymentMethod === "online" && !paid;

  return (
    <Container className="max-w-4xl py-10">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-primary">
              {paid || codPending ? <CheckCircle2 className="size-4" /> : <Clock className="size-4" />}
              {paid
                ? "Payment confirmed"
                : codPending
                  ? "Cash on delivery order confirmed"
                  : "Order received — payment pending"}
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{order.orderNumber}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Placed {formatDateTime(order.placedAt)} · {titleCase(order.fulfilmentStatus)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-2xl font-bold">{moneyLocal(order.totalMinor)}</p>
            <p className="text-xs text-muted-foreground">{order.currency}</p>
          </div>
        </div>

        {awaitingPayment ? (
          <InfoNote tone="warning" className="mt-5">
            We have not received a verified payment confirmation for this order yet. No items
            will be dispatched until the gateway confirms the payment. If you completed the
            payment, this page updates as soon as the signed confirmation arrives.
          </InfoNote>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <Truck className="size-4 text-primary" /> Delivery
            </p>
            <p className="mt-1 text-muted-foreground">
              {order.shippingMethod.label} · about {order.shippingMethod.etaDays} days
            </p>
            <p className="mt-1 text-muted-foreground">
              {order.shippingAddress.city}, {order.shippingAddress.state}{" "}
              {order.shippingAddress.postalCode}, {order.shippingAddress.country}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <PackageCheck className="size-4 text-primary" /> Fulfilment
            </p>
            <p className="mt-1 text-muted-foreground">{titleCase(order.fulfilmentStatus)}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {fulfilment.map((entry) => (
                <li key={String(entry.supplierId)}>
                  {entry.supplierName}: {titleCase(entry.status)}
                </li>
              ))}
              {fulfilment.length === 0 ? <li>Not yet forwarded</li> : null}
            </ul>
          </div>
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="font-semibold">Payment</p>
            <p className="mt-1 text-muted-foreground">
              {order.paymentMethod === "cod" ? "Cash on delivery" : order.provider ?? "Online"}
            </p>
            <StatusPill
              tone={paid ? "success" : codPending ? "info" : "warning"}
              className="mt-2"
            >
              {titleCase(order.paymentStatus)}
            </StatusPill>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card">
        <p className="border-b border-border px-5 py-3 text-sm font-semibold">Items</p>
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item._id} className="flex items-center gap-4 px-5 py-4">
              {item.image ? (
                <img src={item.image} alt="" className="size-14 rounded object-cover" />
              ) : null}
              <div className="flex-1">
                <p className="text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  SKU {item.sku} · Qty {item.quantity}
                  {item.variantName ? ` · ${item.variantName}` : ""}
                </p>
              </div>
              <p className="text-sm font-semibold">{moneyLocal(item.lineTotalMinor)}</p>
            </li>
          ))}
        </ul>
        <div className="space-y-1.5 border-t border-border px-5 py-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{moneyLocal(order.subtotalMinor)}</span>
          </div>
          {order.discountMinor > 0 ? (
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
              <span>Coupon {order.couponCode}</span>
              <span>−{moneyLocal(order.discountMinor)}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Shipping</span>
            <span>{order.shippingMinor === 0 ? "Free" : moneyLocal(order.shippingMinor)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span>{moneyLocal(order.taxMinor)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <span>Total</span>
            <span>{moneyLocal(order.totalMinor)}</span>
          </div>
        </div>
      </div>

      {shipments.length > 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-semibold">Shipment tracking</p>
          {shipments.map((shipment) => (
            <div key={shipment._id} className="mt-3 text-sm">
              <p className="font-medium">
                {shipment.carrier} · {shipment.trackingNumber}
              </p>
              {shipment.trackingUrl ? (
                <a
                  href={shipment.trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Open tracking
                </a>
              ) : null}
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {shipment.events.map((event, index) => (
                  <li key={`${event.at}-${index}`}>
                    {formatDateTime(event.at)} — {event.description}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/account/orders">My orders</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/shop">Continue shopping</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/info/returns-refunds">Returns policy</Link>
        </Button>
      </div>
    </Container>
  );
}
