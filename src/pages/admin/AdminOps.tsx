import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Loader2, Minus, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { EmptyState, InfoNote, LoadingBlock, SectionHeading, StatusPill } from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime, titleCase } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

export function AdminInventory() {
  const { config } = useStore();
  const products = useQuery(api.admin.listProductsAdmin, { perPage: 100, status: "all" });
  const adjustStock = useMutation(api.admin.adjustStock);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  usePageMeta({
    title: "Inventory",
    noIndex: true,
    path: "/admin/inventory",
    siteUrl: config?.seo.siteUrl,
  });

  const items = (products?.items ?? []).filter((product) =>
    search.trim()
      ? `${product.name} ${product.sku}`.toLowerCase().includes(search.trim().toLowerCase())
      : true,
  );
  const lowStock = items.filter((product) => product.stock <= 5);

  async function adjust(productId: Id<"products">, delta: number, note: string) {
    setBusy(String(productId));
    try {
      const result = await adjustStock({
        productId,
        delta,
        note: note.trim() || "Manual adjustment from the admin inventory screen",
      });
      toast.success(`Stock is now ${result.stock}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not adjust stock.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Inventory"
        subtitle="Every adjustment writes an inventory movement and an audit entry, so stock changes are always traceable."
      />

      {lowStock.length > 0 ? (
        <InfoNote tone="warning">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="size-4" />
            {lowStock.length} product(s) at or below 5 units:{" "}
            {lowStock.slice(0, 6).map((product) => product.name).join(", ")}
            {lowStock.length > 6 ? "…" : ""}
          </span>
        </InfoNote>
      ) : null}

      <Input
        placeholder="Search by name or SKU"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-sm"
      />

      {products === undefined ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <EmptyState
          title="No products to manage"
          description="Import products or create them from the Products screen first."
        />
      ) : (
        <div className="overflow-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Stock</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Adjust</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((product) => (
                <tr key={product._id}>
                  <td className="px-3 py-2">{product.name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{product.sku}</td>
                  <td className="px-3 py-2 font-medium">{product.stock}</td>
                  <td className="px-3 py-2">
                    <StatusPill
                      tone={
                        product.status === "published"
                          ? "success"
                          : product.status === "draft"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {titleCase(product.status)}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2">
                    <StockAdjuster
                      busy={busy === String(product._id)}
                      onApply={(delta, note) => adjust(product._id, delta, note)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StockAdjuster({
  busy,
  onApply,
}: {
  busy: boolean;
  onApply: (delta: number, note: string) => Promise<void>;
}) {
  const [delta, setDelta] = useState("1");
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        aria-label="Decrease stock"
        disabled={busy}
        onClick={() => onApply(-1, note)}
      >
        <Minus className="size-3.5" />
      </Button>
      <Input
        aria-label="Adjustment quantity"
        type="number"
        value={delta}
        onChange={(event) => setDelta(event.target.value)}
        className="h-8 w-20"
      />
      <Input
        aria-label="Adjustment note"
        placeholder="Reason"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="h-8 w-32"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onApply(Number(delta) || 0, note)}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Apply
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Reviews & support
 * ------------------------------------------------------------------ */

export function AdminMarketing() {
  const { config } = useStore();
  const reviews = useQuery(api.admin.listReviewsAdmin, {});
  const tickets = useQuery(api.admin.listSupportTickets, {});
  const moderateReview = useMutation(api.admin.moderateReview);
  const updateTicket = useMutation(api.admin.updateSupportTicket);

  usePageMeta({
    title: "Reviews & support",
    noIndex: true,
    path: "/admin/marketing",
    siteUrl: config?.seo.siteUrl,
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Reviews & support"
        subtitle="Product ratings are only ever computed from approved, verified-purchase reviews — never fabricated."
      />

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Reviews awaiting moderation</h2>
        {reviews === undefined ? (
          <LoadingBlock />
        ) : reviews.length === 0 ? (
          <EmptyState
            title="No reviews yet"
            description="Customers can review products they have actually had delivered."
          />
        ) : (
          <ul className="mt-3 space-y-3">
            {reviews.map((review) => (
              <li key={review._id} className="rounded-lg border border-border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{review.productName}</span>
                  <StatusPill
                    tone={
                      review.status === "approved"
                        ? "success"
                        : review.status === "rejected"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {titleCase(review.status)}
                  </StatusPill>
                  <span className="text-xs text-muted-foreground">
                    {review.rating}/5 · {formatDateTime(review.createdAt)}
                    {review.orderId ? " · linked to an order" : " · no order reference"}
                  </span>
                  {review.status !== "approved" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={async () => {
                        await moderateReview({ reviewId: review._id, status: "approved" });
                        toast.success("Review approved and rating recalculated.");
                      }}
                    >
                      Approve
                    </Button>
                  ) : null}
                  {review.status !== "rejected" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await moderateReview({ reviewId: review._id, status: "rejected" });
                        toast.success("Review rejected.");
                      }}
                    >
                      Reject
                    </Button>
                  ) : null}
                </div>
                {review.title ? <p className="mt-1 font-medium">{review.title}</p> : null}
                <p className="mt-1 text-muted-foreground">{review.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Support tickets</h2>
        {tickets === undefined ? (
          <LoadingBlock />
        ) : tickets.length === 0 ? (
          <EmptyState
            title="No support tickets"
            description="Messages sent through the contact form and the help centre land here."
          />
        ) : (
          <ul className="mt-3 space-y-3">
            {tickets.map((ticket) => (
              <li key={ticket._id} className="rounded-lg border border-border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{ticket.subject}</span>
                  <StatusPill
                    tone={
                      ticket.status === "closed"
                        ? "neutral"
                        : ticket.status === "resolved"
                          ? "success"
                          : "warning"
                    }
                  >
                    {titleCase(ticket.status)}
                  </StatusPill>
                  <span className="text-xs text-muted-foreground">
                    {ticket.email ?? "signed-in customer"} · {formatDateTime(ticket.createdAt)}
                  </span>
                  <div className="ml-auto flex gap-2">
                    {(["open", "pending", "resolved", "closed"] as const).map((status) => (
                      <Button
                        key={status}
                        size="sm"
                        variant={ticket.status === status ? "default" : "outline"}
                        onClick={async () => {
                          await updateTicket({ ticketId: ticket._id, status });
                          toast.success(`Ticket marked ${status}.`);
                        }}
                      >
                        {titleCase(status)}
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{ticket.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Customers, roles & audit log
 * ------------------------------------------------------------------ */

export function AdminCustomers() {
  const { config } = useStore();
  const customers = useQuery(api.admin.listCustomersAdmin, {});
  const users = useQuery(api.admin.listAdminUsers, {});
  const auditLogs = useQuery(api.admin.listAuditLogs, { limit: 50 });
  const setUserRole = useMutation(api.admin.setUserRole);

  usePageMeta({
    title: "Customers",
    noIndex: true,
    path: "/admin/customers",
    siteUrl: config?.seo.siteUrl,
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Customers, roles & audit log"
        subtitle="Roles are enforced by the backend on every admin call — hiding a button in the browser is never the protection."
      />

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Customers</h2>
        {customers === undefined ? (
          <LoadingBlock />
        ) : customers.length === 0 ? (
          <EmptyState title="No customers yet" description="Accounts appear here after registration." />
        ) : (
          <div className="mt-3 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Orders</th>
                  <th className="px-3 py-2">Paid lifetime value</th>
                  <th className="px-3 py-2">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customers.map((customer) => (
                  <tr key={customer._id}>
                    <td className="px-3 py-2">
                      {customer.name}
                      {customer.deletionRequested ? (
                        <StatusPill tone="warning" className="ml-2">
                          deletion requested
                        </StatusPill>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{customer.email}</td>
                    <td className="px-3 py-2">{customer.orders}</td>
                    <td className="px-3 py-2">
                      {(customer.lifetimeValueBaseMinor / 100).toFixed(2)}{" "}
                      {config?.commerce.baseCurrency ?? "INR"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDateTime(customer.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4" /> Accounts & roles
        </h2>
        <div className="mt-3 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Change role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(users ?? []).map((user) => (
                <tr key={user._id}>
                  <td className="px-3 py-2">
                    {user.name || "—"}
                    <span className="ml-2 text-xs text-muted-foreground">{user.email}</span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={user.role === "admin" ? "info" : "neutral"}>
                      {user.role}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2 flex gap-2">
                    {(["member", "user", "admin"] as const).map((role) => (
                      <Button
                        key={role}
                        size="sm"
                        variant={user.role === role ? "default" : "outline"}
                        onClick={async () => {
                          try {
                            await setUserRole({ userId: user._id, role });
                            toast.success(`${user.email || "Account"} is now ${role}.`);
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : "Could not change the role.",
                            );
                          }
                        }}
                      >
                        {role}
                      </Button>
                    ))}
                  </td>
                </tr>
              ))}
              {users?.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    No accounts yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Audit log</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Sensitive actions (pricing, roles, refunds, settings, imports, supplier actions) are recorded
          with the acting account.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {(auditLogs ?? []).map((log) => (
            <li key={log._id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{log.action}</span>
              <span className="text-xs text-muted-foreground">
                {log.summary} · {log.actorEmail ?? "system"} · {formatDateTime(log.createdAt)}
              </span>
            </li>
          ))}
          {auditLogs?.length === 0 ? (
            <li className="text-muted-foreground">No entries yet.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
