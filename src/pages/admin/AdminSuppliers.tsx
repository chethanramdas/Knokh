import { useMutation, useQuery } from "@/lib/cloudflare-client";
import { Link2, Loader2, Plug, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  EmptyState,
  InfoNote,
  LoadingBlock,
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

const MANUAL_ALERT =
  "Supplier automation is only enabled for connectors implemented in this codebase (manual, catalog feed). Others are registered with their setup notes and credentials list, but no request layer exists yet — so they are reported as not configured instead of pretending to work.";

export default function AdminSuppliers() {
  const { config } = useStore();
  const suppliers = useQuery(api.suppliers.listSuppliers, {});
  const connectors = useQuery(api.suppliers.listConnectors, {});
  const supplierProducts = useQuery(api.suppliers.listSupplierProducts, {});
  const supplierOrders = useQuery(api.suppliers.listSupplierOrders, {});
  const syncJobs = useQuery(api.suppliers.listSyncJobs, {});
  const unmapped = useQuery(api.suppliers.unmappedProductAlerts, {});
  const products = useQuery(api.admin.listProductsAdmin, { perPage: 100, status: "all" });

  const saveSupplier = useMutation(api.suppliers.saveSupplier);
  const checkConnection = useMutation(api.suppliers.checkSupplierConnection);
  const disconnect = useMutation(api.suppliers.disconnectSupplier);
  const queueSync = useMutation(api.suppliers.queueSyncJob);
  const mapSupplierProduct = useMutation(api.suppliers.mapSupplierProduct);
  const [busy, setBusy] = useState<string | null>(null);

  usePageMeta({ title: "Suppliers", noIndex: true, path: "/admin/suppliers", siteUrl: config?.seo.siteUrl });

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Suppliers & dropshipping"
        subtitle="Register suppliers, connect the ones with working connectors, map their SKUs to your catalog and route fulfilment."
      />

      <InfoNote tone="info">
        Queued synchronisation runs automatically every 30 minutes on the deployment's scheduled
        job. Jobs for connectors that are not implemented, or that are missing credentials, are
        recorded as <strong>skipped_not_configured</strong> with the reason — never silently dropped.
      </InfoNote>

      <InfoNote tone="warning">
        <strong>Honest status.</strong> {MANUAL_ALERT}
      </InfoNote>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Connector registry</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {(connectors ?? []).map((connector) => (
            <div key={connector.id} className="rounded-lg border border-border p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{connector.label}</span>
                <StatusPill tone={connector.implemented ? "success" : "warning"}>
                  {connector.implemented ? "Implemented" : "Interface only"}
                </StatusPill>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{connector.setup}</p>
              {connector.envStatus.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {connector.envStatus.map((entry) => (
                    <li key={entry.key} className="flex items-center gap-2">
                      <StatusPill tone={entry.configured ? "success" : "neutral"}>
                        {entry.configured ? "set" : "missing"}
                      </StatusPill>
                      <code>{entry.key}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Add a supplier</h2>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setBusy("create");
            try {
              await saveSupplier({
                name: String(data.get("name") ?? ""),
                website: String(data.get("website") ?? "") || undefined,
                country: String(data.get("country") ?? "IN"),
                currency: String(data.get("currency") ?? "INR"),
                connector: String(data.get("connector") ?? "manual"),
                contactEmail: String(data.get("email") ?? "") || undefined,
                notes: String(data.get("notes") ?? "") || undefined,
              });
              toast.success("Supplier added with its connection record.");
              event.currentTarget.reset();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not add the supplier.");
            } finally {
              setBusy(null);
            }
          }}
        >
          <div>
            <Label htmlFor="sup-name">Name</Label>
            <Input id="sup-name" name="name" required />
          </div>
          <div>
            <Label htmlFor="sup-website">Website</Label>
            <Input id="sup-website" name="website" placeholder="https://supplier.example" />
          </div>
          <div>
            <Label htmlFor="sup-connector">Connector</Label>
            <select
              id="sup-connector"
              name="connector"
              className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
            >
              {(connectors ?? []).map((connector) => (
                <option key={connector.id} value={connector.id}>
                  {connector.label}
                  {connector.implemented ? "" : " (not implemented)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="sup-country">Country (ISO)</Label>
            <Input id="sup-country" name="country" defaultValue="IN" maxLength={2} />
          </div>
          <div>
            <Label htmlFor="sup-currency">Currency</Label>
            <Input id="sup-currency" name="currency" defaultValue="INR" maxLength={3} />
          </div>
          <div>
            <Label htmlFor="sup-email">Contact email</Label>
            <Input id="sup-email" name="email" type="email" />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="sup-notes">Notes</Label>
            <Textarea id="sup-notes" name="notes" rows={2} />
          </div>
          <div>
            <Button type="submit" disabled={busy === "create"}>
              {busy === "create" ? <Loader2 className="size-4 animate-spin" /> : null} Add supplier
            </Button>
          </div>
        </form>
      </div>

      {suppliers === undefined ? (
        <LoadingBlock />
      ) : suppliers.length === 0 ? (
        <EmptyState
          title="No suppliers yet"
          description="Add a supplier to map supplier SKUs, sync cost and stock, and route fulfilment."
        />
      ) : (
        <div className="space-y-4">
          {suppliers.map((supplier) => (
            <div key={supplier._id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{supplier.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {supplier.connectorLabel} · {supplier.country} · {supplier.currency} ·{" "}
                    {supplier.website ?? "no website"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusPill
                      tone={
                        supplier.apiStatus === "connected"
                          ? "success"
                          : supplier.apiStatus === "error"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {titleCase(supplier.apiStatus)}
                    </StatusPill>
                    {!supplier.connectorImplemented ? (
                      <StatusPill tone="neutral">Connector not implemented</StatusPill>
                    ) : null}
                    <StatusPill tone="info">{supplier.mappedProducts} mapped SKUs</StatusPill>
                    {supplier.unmappedProducts > 0 ? (
                      <StatusPill tone="warning">
                        {supplier.unmappedProducts} unmapped
                      </StatusPill>
                    ) : null}
                    {supplier.manualFulfilmentTasks > 0 ? (
                      <StatusPill tone="warning">
                        {supplier.manualFulfilmentTasks} manual fulfilment task(s)
                      </StatusPill>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(String(supplier._id));
                      try {
                        const result = await checkConnection({ supplierId: supplier._id });
                        toast.success(
                          result.missing.length === 0
                            ? "All required credentials are present."
                            : `Missing: ${result.missing.join(", ")}`,
                        );
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Check failed.");
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <Plug className="size-3.5" /> Check connection
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={async () => {
                      const result = await queueSync({ supplierId: supplier._id, type: "full_catalog" });
                      toast.success(
                        result.skipped
                          ? `Sync queued but will be skipped: ${
                              result.missing.length > 0
                                ? `missing ${result.missing.join(", ")}`
                                : "connector not implemented"
                            }`
                          : "Sync job queued. It runs on the next scheduled pass or when you run due jobs.",
                      );
                    }}
                  >
                    <RefreshCw className="size-3.5" /> Queue catalog sync
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await disconnect({ supplierId: supplier._id });
                      toast.success("Connection marked disconnected. Rotate the credentials too.");
                    }}
                  >
                    <ShieldAlert className="size-3.5" /> Disconnect
                  </Button>
                </div>
              </div>

              {supplier.connections.length > 0 ? (
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {supplier.connections.map((connection) => (
                    <p key={connection._id}>
                      {connection.label} · {titleCase(connection.status)} ·{" "}
                      {connection.envVars.length > 0
                        ? `env: ${connection.envVars.join(", ")}`
                        : "no credentials required"}
                      {connection.lastCheckedAt
                        ? ` · checked ${formatDateTime(connection.lastCheckedAt)}`
                        : ""}
                    </p>
                  ))}
                </div>
              ) : null}

              {supplier.recentJobs.length > 0 ? (
                <div className="mt-3 text-xs text-muted-foreground">
                  Last jobs:{" "}
                  {supplier.recentJobs
                    .map(
                      (job) =>
                        `${job.type} → ${job.status}${job.lastError ? ` (${job.lastError})` : ""}`,
                    )
                    .join(" · ")}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Supplier SKU mapping</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Mapping links a supplier SKU to a catalog product so cost and stock sync reaches the right
          item. Unmapped supplier rows are reported here rather than silently skipped.
        </p>
        {supplierProducts === undefined ? (
          <LoadingBlock />
        ) : supplierProducts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No supplier products recorded. Run a catalog sync or import a supplier spreadsheet.
          </p>
        ) : (
          <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-muted/60 text-left uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Supplier SKU</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Cost</th>
                  <th className="px-3 py-2">Stock</th>
                  <th className="px-3 py-2">Mapped product</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {supplierProducts.slice(0, 100).map((row) => (
                  <tr key={row._id}>
                    <td className="px-3 py-2">{row.supplierSku}</td>
                    <td className="px-3 py-2">{row.title}</td>
                    <td className="px-3 py-2">
                      {(row.costMinor / 100).toFixed(2)} {row.currency}
                    </td>
                    <td className="px-3 py-2">{row.stock}</td>
                    <td className="px-3 py-2">
                      {row.productName ?? <span className="text-amber-600">unmapped</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={`Map ${row.supplierSku}`}
                        value={row.productId ?? ""}
                        onChange={async (event) => {
                          try {
                            await mapSupplierProduct({
                              supplierProductId: row._id,
                              productId: event.target.value
                                ? (event.target.value as Id<"products">)
                                : undefined,
                            });
                            toast.success("Mapping updated.");
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : "Could not map the SKU.",
                            );
                          }
                        }}
                        className="h-8 rounded border border-border bg-background px-1"
                      >
                        <option value="">— unmapped —</option>
                        {(products?.items ?? []).map((product) => (
                          <option key={product._id} value={product._id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Supplier orders</h2>
          {supplierOrders === undefined ? (
            <LoadingBlock />
          ) : supplierOrders.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No supplier orders yet. They are queued when a paid order is confirmed.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {supplierOrders.slice(0, 20).map((entry) => (
                <li key={entry._id}>
                  <Link
                    to={`/admin/orders/${entry.orderId}`}
                    className="font-medium hover:text-primary"
                  >
                    {entry.orderNumber}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {entry.supplierName} · {titleCase(entry.status)} · attempts {entry.attempts}
                  </span>
                  {entry.responseSummary ? (
                    <p className="text-xs text-muted-foreground">{entry.responseSummary}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Sync jobs</h2>
          {syncJobs === undefined ? (
            <LoadingBlock />
          ) : syncJobs.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No sync jobs have been queued.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {syncJobs.slice(0, 20).map((job) => (
                <li key={job._id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{titleCase(job.type)}</span>
                  <StatusPill
                    tone={
                      job.status === "succeeded"
                        ? "success"
                        : job.status === "failed"
                          ? "danger"
                          : job.status === "skipped_not_configured"
                            ? "neutral"
                            : "warning"
                    }
                  >
                    {titleCase(job.status)}
                  </StatusPill>
                  <span className="text-xs text-muted-foreground">
                    {job.resultSummary ?? job.lastError ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(unmapped ?? []).length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4" /> Products with no supplier mapping
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {(unmapped ?? []).map((product) => (
              <li key={product._id} className="rounded-full border border-border px-3 py-1">
                {product.name}
                {product.isDemo ? " (sample)" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
