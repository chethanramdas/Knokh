import { useMutation, useQuery } from "convex/react";
import { Loader2, PackageCheck, Search, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  EmptyState,
  InfoNote,
  LoadingBlock,
  Pagination,
  SectionHeading,
  StatusPill,
} from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, titleCase } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";
import { formatBase } from "./AdminApp";

const STATUSES = [
  "pending",
  "processing",
  "forwarded",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;

type ShipmentStatus =
  | "pending"
  | "label_created"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "failed"
  | "returned";

const PAYMENT_STATUSES = [
  "unpaid",
  "pending",
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
  "cod_pending",
] as const;

export default function AdminOrders() {
  const { config } = useStore();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [page, setPage] = useState(1);
  const orders = useQuery(api.admin.listOrdersAdmin, {
    search: search || undefined,
    status,
    paymentStatus,
    page,
    perPage: 25,
  });

  usePageMeta({ title: "Orders", noIndex: true, path: "/admin/orders", siteUrl: config?.seo.siteUrl });

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Orders"
        subtitle="Search orders, review payment status, add tracking and handle refunds."
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Order number, customer name or email"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          aria-label="Fulfilment status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="all">All fulfilment</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>
        <select
          aria-label="Payment status"
          value={paymentStatus}
          onChange={(event) => setPaymentStatus(event.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="all">All payments</option>
          {PAYMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>
      </div>

      {orders === undefined ? (
        <LoadingBlock label="Loading orders…" />
      ) : orders.items.length === 0 ? (
        <EmptyState title="No orders match" description="Adjust the filters to see more." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Placed</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Payment</th>
                  <th className="px-3 py-2">Fulfilment</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.items.map((order) => (
                  <tr key={order._id}>
                    <td className="px-3 py-3">
                      <Link to={`/admin/orders/${order._id}`} className="font-medium hover:text-primary">
                        {order.orderNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {order.itemCount} item(s) · {order.country}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p>{order.customerName}</p>
                      <p className="text-xs text-muted-foreground">{order.email}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {formatDateTime(order.placedAt)}
                    </td>
                    <td className="px-3 py-3 font-medium">
                      {formatBase(order.totalMinor, order.currency)}
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill
                        tone={
                          order.paymentStatus === "paid"
                            ? "success"
                            : order.paymentStatus === "failed"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {titleCase(order.paymentStatus)}
                      </StatusPill>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {titleCase(order.paymentMethod)}
                        {order.provider ? ` · ${order.provider}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill tone="info">{titleCase(order.fulfilmentStatus)}</StatusPill>
                    </td>
                    <td className="px-3 py-3">
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/admin/orders/${order._id}`}>Open</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={orders.page} totalPages={orders.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

export function AdminOrderDetail() {
  const { orderId = "" } = useParams();
  const detail = useQuery(
    api.orders.getOrderDetail,
    orderId ? { orderId: orderId as Id<"orders"> } : "skip",
  );
  const payments = useQuery(
    api.payments.getPaymentForOrder,
    orderId ? { orderId: orderId as Id<"orders"> } : "skip",
  );
  const supplierOrders = useQuery(api.suppliers.listSupplierOrders, {});
  const updateStatus = useMutation(api.admin.updateOrderStatus);
  const addShipment = useMutation(api.admin.addShipment);
  const createRefund = useMutation(api.admin.createRefund);
  const setRefundStatus = useMutation(api.admin.setRefundStatus);
  const manualFulfil = useMutation(api.suppliers.completeManualFulfilment);

  const [shipment, setShipment] = useState<{
    carrier: string;
    trackingNumber: string;
    trackingUrl: string;
    status: ShipmentStatus;
  }>({
    carrier: "",
    trackingNumber: "",
    trackingUrl: "",
    status: "in_transit",
  });
  const [refund, setRefund] = useState({ amount: "", reason: "" });
  const [busy, setBusy] = useState(false);

  usePageMeta({ title: "Order detail", noIndex: true, path: `/admin/orders/${orderId}` });

  if (detail === undefined) return <LoadingBlock label="Loading order…" />;
  if (detail === null) {
    return (
      <EmptyState
        title="Order not found"
        description="It may have been removed."
        action={
          <Button asChild variant="outline">
            <Link to="/admin/orders">Back to orders</Link>
          </Button>
        }
      />
    );
  }

  const { order, items, shipments, refunds } = detail;
  const related = (supplierOrders ?? []).filter((entry) => entry.orderId === order._id);

  return (
    <div className="space-y-5">
      <SectionHeading
        title={`Order ${order.orderNumber}`}
        subtitle={`${order.customerName} · ${order.shippingAddress.email ?? order.guestEmail ?? "no email"}`}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/orders">All orders</Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h2 className="font-semibold">Customer & delivery</h2>
          <p className="mt-2">{order.customerName}</p>
          <p className="text-muted-foreground">
            {order.shippingAddress.email ?? order.guestEmail}
          </p>
          <p className="text-muted-foreground">{order.shippingAddress.phone}</p>
          <p className="mt-2 text-muted-foreground">
            {order.shippingAddress.line1}
            {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}
            <br />
            {order.shippingAddress.city}, {order.shippingAddress.state}{" "}
            {order.shippingAddress.postalCode}
            <br />
            {order.shippingAddress.country}
          </p>
          {order.notes ? (
            <InfoNote className="mt-3">Customer note: {order.notes}</InfoNote>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h2 className="font-semibold">Payment</h2>
          <p className="mt-2">
            {titleCase(order.paymentMethod)} · {order.provider ?? "no provider"}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <StatusPill tone={order.paymentStatus === "paid" ? "success" : "warning"}>
              {titleCase(order.paymentStatus)}
            </StatusPill>
            <StatusPill tone="info">{titleCase(order.fulfilmentStatus)}</StatusPill>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {(payments?.payments ?? []).map((payment) => (
              <li key={payment._id}>
                {payment.provider} · {titleCase(payment.status)} ·{" "}
                {formatBase(payment.amountMinor, payment.currency)}
                {payment.signatureVerified ? " · signature verified" : " · signature not verified"}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            An order is only ever marked paid by a signature-verified callback or webhook. Changing
            the status manually here does not move money.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Items</h2>
        <ul className="mt-2 divide-y divide-border text-sm">
          {items.map((item) => (
            <li key={item._id} className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <p className="font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {item.sku} · Qty {item.quantity} · supplier SKU {item.supplierSku ?? "unmapped"} ·{" "}
                  {titleCase(item.fulfilmentStatus)}
                </p>
              </div>
              <p>{formatBase(item.lineTotalMinor, order.currency)}</p>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3 text-sm">
          <span>Subtotal {formatBase(order.subtotalMinor, order.currency)}</span>
          <span>Discount {formatBase(order.discountMinor, order.currency)}</span>
          <span>Shipping {formatBase(order.shippingMinor, order.currency)}</span>
          <span>Tax {formatBase(order.taxMinor, order.currency)}</span>
          <span className="font-semibold">Total {formatBase(order.totalMinor, order.currency)}</span>
          <span className="text-muted-foreground">
            Recorded cost {formatBase(order.costTotalMinor, order.baseCurrency)}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="size-4" /> Shipment
          </h2>
          {shipments.map((entry) => (
            <div key={entry._id} className="mt-2 text-sm">
              <p className="font-medium">
                {entry.carrier} · {entry.trackingNumber} · {titleCase(entry.status)}
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {entry.events.map((event, index) => (
                  <li key={`${event.at}-${index}`}>
                    {formatDateTime(event.at)} — {event.description}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <form
            className="mt-4 space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await addShipment({
                  orderId: order._id,
                  carrier: shipment.carrier,
                  trackingNumber: shipment.trackingNumber,
                  trackingUrl: shipment.trackingUrl || undefined,
                  status: shipment.status,
                });
                toast.success("Shipment recorded and the customer notified.");
                setShipment({ carrier: "", trackingNumber: "", trackingUrl: "", status: "in_transit" });
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not save the shipment.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="s-carrier">Carrier</Label>
                <Input
                  id="s-carrier"
                  required
                  value={shipment.carrier}
                  onChange={(event) => setShipment({ ...shipment, carrier: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="s-tracking">Tracking number</Label>
                <Input
                  id="s-tracking"
                  required
                  value={shipment.trackingNumber}
                  onChange={(event) =>
                    setShipment({ ...shipment, trackingNumber: event.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="s-url">Tracking URL</Label>
                <Input
                  id="s-url"
                  value={shipment.trackingUrl}
                  onChange={(event) => setShipment({ ...shipment, trackingUrl: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="s-status">Status</Label>
                <select
                  id="s-status"
                  value={shipment.status}
                  onChange={(event) =>
                    setShipment({ ...shipment, status: event.target.value as ShipmentStatus })
                  }
                  className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
                >
                  {["label_created", "in_transit", "out_for_delivery", "delivered", "returned"].map(
                    (value) => (
                      <option key={value} value={value}>
                        {titleCase(value)}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} Save
              shipment
            </Button>
          </form>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Fulfilment & supplier routing</h2>
          {related.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No supplier order queued yet. Fulfilment is queued automatically as soon as the
              payment is confirmed.
            </p>
          ) : (
            <ul className="mt-2 space-y-3 text-sm">
              {related.map((entry) => (
                <li key={entry._id} className="rounded-lg border border-border p-3">
                  <p className="font-medium">
                    {entry.supplierName} · {titleCase(entry.status)}
                  </p>
                  {entry.responseSummary ? (
                    <p className="mt-1 text-xs text-muted-foreground">{entry.responseSummary}</p>
                  ) : null}
                  {entry.status === "needs_manual_fulfilment" ? (
                    <form
                      className="mt-2 flex flex-wrap items-end gap-2"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        try {
                          await manualFulfil({
                            supplierOrderId: entry._id,
                            supplierOrderIdReference: String(data.get("ref") ?? "") || undefined,
                            carrier: String(data.get("carrier") ?? "") || undefined,
                            trackingNumber: String(data.get("tracking") ?? "") || undefined,
                            trackingUrl: String(data.get("url") ?? "") || undefined,
                          });
                          toast.success("Manual fulfilment recorded.");
                        } catch (error) {
                          toast.error(
                            error instanceof Error ? error.message : "Could not record fulfilment.",
                          );
                        }
                      }}
                    >
                      <Input name="ref" placeholder="Supplier order ref" className="max-w-40" />
                      <Input name="carrier" placeholder="Carrier" className="max-w-32" />
                      <Input name="tracking" placeholder="Tracking no." className="max-w-40" />
                      <Input name="url" placeholder="Tracking URL" className="max-w-48" />
                      <Button type="submit" size="sm" variant="outline">
                        <PackageCheck className="size-3.5" /> Mark fulfilled
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <Label htmlFor="o-status">Set fulfilment status</Label>
            <select
              id="o-status"
              value={order.fulfilmentStatus}
              onChange={async (event) => {
                try {
                  await updateStatus({
                    orderId: order._id,
                    fulfilmentStatus: event.target.value as (typeof STATUSES)[number],
                  });
                  toast.success("Status updated and the customer notified.");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not update status.");
                }
              }}
              className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Refunds</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {refunds.map((entry) => (
            <li key={entry._id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {formatBase(entry.amountMinor, entry.currency)} · {entry.reason}
                <span className="ml-2 text-xs text-muted-foreground">
                  {titleCase(entry.status)}
                  {entry.providerRefundId ? ` · provider ${entry.providerRefundId}` : ""}
                </span>
              </span>
              <span className="flex gap-1">
                {(["approved", "completed", "rejected"] as const).map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await setRefundStatus({ refundId: entry._id, status });
                      toast.success(`Refund marked ${status}.`);
                    }}
                  >
                    {titleCase(status)}
                  </Button>
                ))}
              </span>
            </li>
          ))}
          {refunds.length === 0 ? <li className="text-muted-foreground">No refunds recorded.</li> : null}
        </ul>

        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto]"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await createRefund({
                orderId: order._id,
                amountMinor: Math.round(Number(refund.amount) * 100),
                reason: refund.reason || "Refund recorded by admin",
                status: "requested",
              });
              toast.success(
                "Refund record created. Use your provider dashboard (or the refund action) to move the money, then mark it completed.",
              );
              setRefund({ amount: "", reason: "" });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not create the refund.");
            }
          }}
        >
          <div>
            <Label htmlFor="r-amount">Amount ({order.currency})</Label>
            <Input
              id="r-amount"
              inputMode="decimal"
              required
              value={refund.amount}
              onChange={(event) => setRefund({ ...refund, amount: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="r-reason">Reason</Label>
            <Textarea
              id="r-reason"
              rows={1}
              value={refund.reason}
              onChange={(event) => setRefund({ ...refund, reason: event.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="outline">
              Record refund
            </Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Gateway refunds are sent to the provider from the refund action once the provider
          credentials are configured; otherwise record the refund manually and keep the reference
          here.
        </p>
      </div>
    </div>
  );
}
