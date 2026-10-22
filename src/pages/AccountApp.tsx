import { useMutation, useQuery } from "convex/react";
import {
  Bell,
  Heart,
  Loader2,
  MapPin,
  Package,
  RotateCcw,
  Save,
  ShieldAlert,
  ShoppingBag,
  Trash2,
  User,
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ProductCard } from "@/components/knokh/ProductCard";
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
import { ACCOUNT_NAV } from "@/lib/brand";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/* ------------------------------- shell ------------------------------- */

export default function AccountApp() {
  const { user } = useAuth();
  const notifications = useQuery(api.account.getNotifications, { limit: 30 });
  const cartCount = useStore().cartCount;

  return (
    <Container className="py-8">
      <SectionHeading
        title={user?.name ? `Hello, ${user.name.split(" ")[0]}` : "Your account"}
        subtitle="Orders, addresses, wishlist, returns and privacy controls in one place."
      />
      {user?.isAnonymous ? (
        <InfoNote tone="warning" className="mt-5">
          You are signed in as a guest. Add an email address at{" "}
          <Link to="/auth" className="font-semibold text-primary hover:underline">
            sign-in
          </Link>{" "}
          so your orders are reachable from any device.
        </InfoNote>
      ) : null}

      <div className="mt-6 grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside>
          <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {ACCOUNT_NAV.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href === "/account"}
                className={({ isActive }) =>
                  cn(
                    "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                {item.label}
                {item.href === "/account/notifications" && (notifications?.unread ?? 0) > 0 ? (
                  <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                    {notifications?.unread}
                  </span>
                ) : null}
              </NavLink>
            ))}
            <NavLink
              to="/cart"
              className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Cart {cartCount > 0 ? `(${cartCount})` : ""}
            </NavLink>
          </nav>
        </aside>
        <div>
          <Outlet />
        </div>
      </div>
    </Container>
  );
}

/* ------------------------------ overview ------------------------------ */

export function AccountOverview() {
  const orders = useQuery(api.orders.myOrders, { limit: 50 });
  const notifications = useQuery(api.account.getNotifications, { limit: 30 });
  const wishlist = useQuery(api.account.getWishlist, {});
  const recent = useQuery(api.catalog.getRecentlyViewed, { limit: 4 });
  const pending = (orders ?? []).filter((order) =>
    ["pending", "processing", "forwarded", "shipped"].includes(order.fulfilmentStatus),
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Orders" value={String(orders?.length ?? 0)} icon={<Package className="size-4" />} href="/account/orders" />
        <StatCard label="In progress" value={String(pending.length)} icon={<RotateCcw className="size-4" />} href="/account/orders" />
        <StatCard
          label="Wishlist"
          value={String(wishlist?.items.length ?? 0)}
          icon={<Heart className="size-4" />}
          href="/account/wishlist"
        />
      </div>

      {notifications && notifications.unread > 0 ? (
        <InfoNote>
          You have {notifications.unread} unread notification
          {notifications.unread === 1 ? "" : "s"}.{" "}
          <Link to="/account/notifications" className="font-semibold text-primary hover:underline">
            Review them
          </Link>
          .
        </InfoNote>
      ) : null}

      <div>
        <h2 className="text-base font-semibold">Recent orders</h2>
        {orders === undefined ? (
          <LoadingBlock />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="size-5" />}
            title="No orders yet"
            description="When you place an order it will appear here with live status and tracking."
            action={
              <Button asChild>
                <Link to="/shop">Start shopping</Link>
              </Button>
            }
          />
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {orders.slice(0, 5).map((order) => (
              <li key={order._id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Link to={`/account/orders/${order._id}`} className="font-semibold hover:text-primary">
                  {order.orderNumber}
                </Link>
                <span className="text-muted-foreground">{formatDate(order.placedAt)}</span>
                <StatusPill tone="info" className="ml-auto">
                  {titleCase(order.fulfilmentStatus)}
                </StatusPill>
                <StatusPill tone={order.paymentStatus === "paid" ? "success" : "warning"}>
                  {titleCase(order.paymentStatus)}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(recent ?? []).length > 0 ? (
        <div>
          <h2 className="text-base font-semibold">Recently viewed</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {(recent ?? []).map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  href,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  href: string;
}) {
  return (
    <Link to={href} className="rounded-xl border border-border bg-card p-4 hover:border-primary/40">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </Link>
  );
}

/* -------------------------------- orders -------------------------------- */

export function AccountOrders() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const orders = useQuery(api.orders.myOrders, {
    status: (status || undefined) as never,
    search: search || undefined,
  });

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <Label htmlFor="order-search">Search orders</Label>
          <Input
            id="order-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Order number"
          />
        </div>
        <div>
          <Label htmlFor="order-status">Status</Label>
          <select
            id="order-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="">All statuses</option>
            {["pending", "processing", "forwarded", "shipped", "delivered", "cancelled", "returned"].map(
              (value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ),
            )}
          </select>
        </div>
      </div>

      <div className="mt-6">
        {orders === undefined ? (
          <LoadingBlock />
        ) : orders.length === 0 ? (
          <EmptyState
            title="No orders match"
            description="Try a different status or clear the search."
          />
        ) : (
          <ul className="space-y-4">
            {orders.map((order) => (
              <li key={order._id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      to={`/account/orders/${order._id}`}
                      className="text-sm font-semibold hover:text-primary"
                    >
                      {order.orderNumber}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(order.placedAt)} · {order.shippingMethod.label}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone="info">{titleCase(order.fulfilmentStatus)}</StatusPill>
                    <StatusPill tone={order.paymentStatus === "paid" ? "success" : "warning"}>
                      {titleCase(order.paymentStatus)}
                    </StatusPill>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold">
                    {order.currency} {(order.totalMinor / 100).toFixed(2)}
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/account/orders/${order._id}`}>View details</Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link to={`/account/orders/${order._id}#return`}>Return or refund</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function AccountOrderDetail() {
  const { orderId = "" } = useParams();
  const detail = useQuery(
    api.orders.getOrderDetail,
    orderId ? { orderId: orderId as Id<"orders"> } : "skip",
  );
  const payments = useQuery(
    api.payments.getPaymentForOrder,
    orderId ? { orderId: orderId as Id<"orders"> } : "skip",
  );
  const cancelOrder = useMutation(api.orders.cancelOrder);
  const requestReturn = useMutation(api.orders.requestReturn);
  const [reason, setReason] = useState("");
  const [returnType, setReturnType] = useState<"return" | "refund" | "exchange">("return");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (detail === undefined) return <LoadingBlock />;
  if (detail === null) {
    return (
      <EmptyState
        title="Order not found"
        description="This order does not exist or does not belong to your account."
        action={
          <Button asChild variant="outline">
            <Link to="/account/orders">Back to orders</Link>
          </Button>
        }
      />
    );
  }

  const { order, items, shipments, returnRequests } = detail;
  const canCancel = ["pending", "processing", "forwarded"].includes(order.fulfilmentStatus);
  const canReturn = ["shipped", "delivered"].includes(order.fulfilmentStatus);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">{order.orderNumber}</h2>
            <p className="text-xs text-muted-foreground">
              Placed {formatDateTime(order.placedAt)} · {titleCase(order.paymentMethod)} ·{" "}
              {order.provider ?? "no provider"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="info">{titleCase(order.fulfilmentStatus)}</StatusPill>
            <StatusPill tone={order.paymentStatus === "paid" ? "success" : "warning"}>
              {titleCase(order.paymentStatus)}
            </StatusPill>
          </div>
        </div>

        <ul className="mt-4 divide-y divide-border">
          {items.map((item) => (
            <li key={item._id} className="flex items-center gap-3 py-3">
              {item.image ? (
                <img src={item.image} alt="" className="size-12 rounded object-cover" />
              ) : null}
              <div className="flex-1 text-sm">
                <p className="font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  Qty {item.quantity} · {titleCase(item.fulfilmentStatus)}
                </p>
              </div>
              <p className="text-sm font-medium">
                {order.currency} {(item.lineTotalMinor / 100).toFixed(2)}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
          <span className="text-muted-foreground">
            Delivering to {order.shippingAddress.city}, {order.shippingAddress.country}
          </span>
          <span className="font-semibold">
            Total {order.currency} {(order.totalMinor / 100).toFixed(2)}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/order/${order._id}`}>Printable confirmation</Link>
          </Button>
          {canCancel ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await cancelOrder({ orderId: order._id, reason: "Cancelled by customer" });
                  toast.success("Order cancelled. Stock has been released.");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not cancel.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Cancel order
            </Button>
          ) : null}
        </div>
      </div>

      {shipments.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">Tracking</h3>
          {shipments.map((shipment) => (
            <div key={shipment._id} className="mt-2 text-sm">
              <p className="font-medium">
                {shipment.carrier} · {shipment.trackingNumber}
              </p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
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

      {payments && payments.payments.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h3 className="font-semibold">Payment records</h3>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {payments.payments.map((payment) => (
              <li key={payment._id}>
                {payment.provider} · {titleCase(payment.status)} ·{" "}
                {payment.currency} {(payment.amountMinor / 100).toFixed(2)}
                {payment.signatureVerified ? " · signature verified" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div id="return" className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">Return or refund request</h3>
        {returnRequests.length > 0 ? (
          <ul className="mt-3 space-y-2 text-sm">
            {returnRequests.map((request) => (
              <li key={request._id} className="rounded-lg border border-border p-3">
                <p className="font-medium">
                  {titleCase(request.type)} · {titleCase(request.status)}
                </p>
                <p className="text-xs text-muted-foreground">{request.reason}</p>
              </li>
            ))}
          </ul>
        ) : null}
        {canReturn ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await requestReturn({
                  orderId: order._id,
                  orderItemIds: selectedItems.map((id) => id as Id<"order_items">),
                  type: returnType,
                  reason: reason || "Item not as described",
                });
                toast.success("Return request submitted. Our team will review it.");
                setSelectedItems([]);
                setReason("");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not submit the request.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item._id} className="flex items-center gap-2">
                  <Checkbox
                    id={`return-${item._id}`}
                    checked={selectedItems.includes(String(item._id))}
                    onCheckedChange={(value) =>
                      setSelectedItems((current) =>
                        value === true
                          ? [...current, String(item._id)]
                          : current.filter((id) => id !== String(item._id)),
                      )
                    }
                  />
                  <Label htmlFor={`return-${item._id}`} className="text-sm font-normal">
                    {item.name}
                  </Label>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <select
                aria-label="Request type"
                value={returnType}
                onChange={(event) => setReturnType(event.target.value as typeof returnType)}
                className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
              >
                <option value="return">Return</option>
                <option value="refund">Refund</option>
                <option value="exchange">Exchange</option>
              </select>
              <Input
                className="max-w-sm"
                placeholder="Reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || selectedItems.length === 0}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Submit request
            </Button>
            <p className="text-xs text-muted-foreground">
              Requests are reviewed by a human. Refunds are only issued after approval and follow
              the published policy.
            </p>
          </form>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Returns can be requested once the order has been shipped. Current status:{" "}
            {titleCase(order.fulfilmentStatus)}.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ addresses ------------------------------ */

export function AccountAddresses() {
  const profile = useQuery(api.account.getProfile, {});
  const saveAddress = useMutation(api.account.saveAddress);
  const deleteAddress = useMutation(api.account.deleteAddress);
  const setDefaultAddress = useMutation(api.account.setDefaultAddress);
  const { config } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
    countryCode: "IN",
  });

  if (!profile) return <LoadingBlock />;

  return (
    <div className="space-y-5">
      {profile.addresses.length === 0 && !showForm ? (
        <EmptyState
          icon={<MapPin className="size-5" />}
          title="No saved addresses"
          description="Save an address to check out faster next time."
          action={<Button onClick={() => setShowForm(true)}>Add an address</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {profile.addresses.map((address) => (
            <li key={address._id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm">
                  <p className="font-semibold">
                    {address.fullName}
                    {address.isDefault ? (
                      <StatusPill tone="success" className="ml-2">
                        Default
                      </StatusPill>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground">
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ""}
                  </p>
                  <p className="text-muted-foreground">
                    {address.city}, {address.state} {address.postalCode}, {address.country}
                  </p>
                  <p className="text-muted-foreground">{address.phone}</p>
                </div>
                <div className="flex gap-2">
                  {!address.isDefault ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await setDefaultAddress({ addressId: address._id });
                        toast.success("Default address updated.");
                      }}
                    >
                      Make default
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await deleteAddress({ addressId: address._id });
                      toast.success("Address removed.");
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <form
          className="space-y-4 rounded-xl border border-border bg-card p-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await saveAddress({
                ...form,
                country:
                  config?.shippingZones.find((zone) => zone.countryCode === form.countryCode)
                    ?.country ?? form.countryCode,
              });
              toast.success("Address saved.");
              setShowForm(false);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not save the address.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="a-name">Recipient</Label>
              <Input
                id="a-name"
                required
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="a-phone">Phone</Label>
              <Input
                id="a-phone"
                required
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="a-line1">Address line 1</Label>
              <Input
                id="a-line1"
                required
                value={form.line1}
                onChange={(event) => setForm({ ...form, line1: event.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="a-line2">Address line 2</Label>
              <Input
                id="a-line2"
                value={form.line2}
                onChange={(event) => setForm({ ...form, line2: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="a-city">City</Label>
              <Input
                id="a-city"
                required
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="a-state">State</Label>
              <Input
                id="a-state"
                required
                value={form.state}
                onChange={(event) => setForm({ ...form, state: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="a-postal">Postal code</Label>
              <Input
                id="a-postal"
                required
                value={form.postalCode}
                onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="a-country">Country</Label>
              <select
                id="a-country"
                value={form.countryCode}
                onChange={(event) => setForm({ ...form, countryCode: event.target.value })}
                className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
              >
                {(config?.shippingZones ?? []).map((zone) => (
                  <option key={zone.countryCode} value={zone.countryCode}>
                    {zone.country}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
              address
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : profile.addresses.length > 0 ? (
        <Button variant="outline" onClick={() => setShowForm(true)}>
          Add another address
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------- wishlist ------------------------------- */

export function AccountWishlist() {
  const wishlist = useQuery(api.account.getWishlist, {});
  const toggle = useMutation(api.account.toggleWishlist);
  const { money } = useStore();

  if (wishlist === undefined) return <LoadingBlock />;

  return wishlist.items.length === 0 ? (
    <EmptyState
      icon={<Heart className="size-5" />}
      title="Your wishlist is empty"
      description="Tap the heart on any product to save it here."
      action={
        <Button asChild>
          <Link to="/shop">Browse products</Link>
        </Button>
      }
    />
  ) : (
    <ul className="grid gap-4 sm:grid-cols-2">
      {wishlist.items.map((item) => (
        <li key={item._id} className="flex gap-4 rounded-xl border border-border bg-card p-4">
          <Link to={`/product/${item.slug}`} className="product-frame size-20 overflow-hidden rounded-lg">
            {item.image ? <img src={item.image} alt="" className="size-full object-cover" /> : null}
          </Link>
          <div className="flex-1 text-sm">
            <Link to={`/product/${item.slug}`} className="font-medium hover:text-primary">
              {item.name}
            </Link>
            <p className="mt-1 font-semibold">{money(item.priceMinor)}</p>
            <p className="text-xs text-muted-foreground">
              {item.stock > 0 ? "In stock" : "Out of stock"}
            </p>
            <div className="mt-2 flex gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to={`/product/${item.slug}`}>View</Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await toggle({ productId: item._id as Id<"products"> });
                  toast.success("Removed from wishlist.");
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------- saved carts ----------------------------- */

export function AccountSavedCarts() {
  const { guestKey } = useStore();
  const carts = useQuery(api.cart.listSavedCarts, { guestKey: guestKey || undefined });
  const restore = useMutation(api.cart.restoreSavedCart);
  const remove = useMutation(api.cart.deleteSavedCart);

  if (carts === undefined) return <LoadingBlock />;

  return carts.length === 0 ? (
    <EmptyState
      icon={<ShoppingBag className="size-5" />}
      title="No saved carts"
      description="Save your cart from the cart page to park a basket and come back to it later."
    />
  ) : (
    <ul className="space-y-3">
      {carts.map((cart) => (
        <li key={cart.cartId} className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">
                {cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-muted-foreground">Saved {formatDate(cart.updatedAt)}</p>
              <ul className="mt-1 text-xs text-muted-foreground">
                {cart.lines.slice(0, 3).map((line) => (
                  <li key={String(line.productId)}>
                    {line.quantity} × {line.name}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await restore({ guestKey, cartId: cart.cartId });
                  toast.success("Cart restored. Your previous cart was replaced.");
                }}
              >
                Restore
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await remove({ guestKey, cartId: cart.cartId });
                  toast.success("Saved cart deleted.");
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------- recently viewed --------------------------- */

export function AccountRecentlyViewed() {
  const { guestKey } = useStore();
  const products = useQuery(api.catalog.getRecentlyViewed, {
    guestKey: guestKey || undefined,
    limit: 20,
  });
  if (products === undefined) return <LoadingBlock />;
  return products.length === 0 ? (
    <EmptyState title="Nothing viewed yet" description="Products you open will be listed here." />
  ) : (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {products.map((product) => (
        <ProductCard key={product._id} product={product} />
      ))}
    </div>
  );
}

/* -------------------------------- returns -------------------------------- */

export function AccountReturns() {
  const returns = useQuery(api.orders.listMyReturns, {});
  if (returns === undefined) return <LoadingBlock />;
  return returns.length === 0 ? (
    <EmptyState
      icon={<RotateCcw className="size-5" />}
      title="No return requests"
      description="Open an order and use the return section to raise a request."
    />
  ) : (
    <ul className="space-y-3">
      {returns.map((request) => (
        <li key={request._id} className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link to={`/account/orders/${request.orderId}`} className="font-semibold hover:text-primary">
              {request.orderNumber}
            </Link>
            <StatusPill tone="info">{titleCase(request.status)}</StatusPill>
          </div>
          <p className="mt-1 text-muted-foreground">
            {titleCase(request.type)} · {request.reason}
          </p>
          <p className="text-xs text-muted-foreground">Requested {formatDate(request.createdAt)}</p>
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------- notifications ----------------------------- */

export function AccountNotifications() {
  const notifications = useQuery(api.account.getNotifications, { limit: 50 });
  const markRead = useMutation(api.account.markNotificationRead);
  const markAll = useMutation(api.account.markAllNotificationsRead);

  if (notifications === undefined) return <LoadingBlock />;

  return notifications.items.length === 0 ? (
    <EmptyState
      icon={<Bell className="size-5" />}
      title="No notifications"
      description="Order updates, shipment movements and refunds will appear here."
    />
  ) : (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void markAll({})}>
          Mark all as read
        </Button>
      </div>
      <ul className="space-y-2">
        {notifications.items.map((item) => (
          <li
            key={item._id}
            className={cn(
              "rounded-xl border p-4 text-sm",
              item.readAt ? "border-border bg-card" : "border-primary/40 bg-primary/5",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{item.title}</p>
              <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{item.body}</p>
            <div className="mt-2 flex gap-2">
              {item.link ? (
                <Button asChild size="sm" variant="outline">
                  <Link to={item.link}>Open</Link>
                </Button>
              ) : null}
              {!item.readAt ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void markRead({ notificationId: item._id })}
                >
                  Mark read
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------- profile -------------------------------- */

export function AccountProfile() {
  const profile = useQuery(api.account.getProfile, {});
  const updateProfile = useMutation(api.account.updateProfile);
  const requestDeletion = useMutation(api.account.requestAccountDeletion);
  const { signOut } = useAuth();
  const [form, setForm] = useState({ name: "", phone: "", defaultCurrency: "INR", marketingConsent: false });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (profile && !loaded) {
    setForm({
      name: profile.name,
      phone: profile.phone,
      defaultCurrency: profile.defaultCurrency,
      marketingConsent: profile.marketingConsent,
    });
    setLoaded(true);
  }

  if (!profile) return <LoadingBlock />;

  return (
    <div className="space-y-6">
      <form
        className="space-y-4 rounded-xl border border-border bg-card p-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await updateProfile(form);
            toast.success("Profile updated.");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not update the profile.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <User className="size-4" /> Profile details
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="p-name">Full name</Label>
            <Input
              id="p-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="p-email">Email (used for sign-in)</Label>
            <Input id="p-email" value={profile.email} disabled />
          </div>
          <div>
            <Label htmlFor="p-phone">Phone</Label>
            <Input
              id="p-phone"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="p-currency">Preferred currency</Label>
            <select
              id="p-currency"
              value={form.defaultCurrency}
              onChange={(event) => setForm({ ...form, defaultCurrency: event.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
            >
              {profile.currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} — {currency.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id="p-marketing"
            checked={form.marketingConsent}
            onCheckedChange={(value) => setForm({ ...form, marketingConsent: value === true })}
          />
          <Label htmlFor="p-marketing" className="text-sm font-normal">
            Email me new arrivals, offers and buying guides.
          </Label>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
          changes
        </Button>
      </form>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="size-4" /> Privacy and data
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You can request deletion of your account and personal data. Orders are retained for the
          period required for tax and consumer-protection records, then deleted. We store no card
          data.
        </p>
        {profile.deletionRequestedAt ? (
          <InfoNote className="mt-3">
            Deletion requested on {formatDateTime(profile.deletionRequestedAt)}. Our team will
            process it and confirm by email.
          </InfoNote>
        ) : (
          <form
            className="mt-3 space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              await requestDeletion({ reason: String(data.get("reason") ?? "") });
              toast.success("Deletion request recorded.");
            }}
          >
            <Textarea name="reason" rows={2} placeholder="Reason (optional)" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline">
                Request account deletion
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  await signOut();
                  toast.success("Signed out.");
                }}
              >
                Sign out
              </Button>
            </div>
          </form>
        )}
      </div>

      <InfoNote>
        Read the{" "}
        <Link to="/info/privacy-policy" className="font-semibold text-primary hover:underline">
          privacy policy
        </Link>{" "}
        and the{" "}
        <Link to="/info/cookie-policy" className="font-semibold text-primary hover:underline">
          cookie policy
        </Link>{" "}
        for the full detail, including retention periods and your rights.
      </InfoNote>
    </div>
  );
}
