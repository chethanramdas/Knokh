import { useMutation, useQuery } from "@/lib/cloudflare-client";
import {
  ArrowRight,
  Boxes,
  Factory,
  LayoutDashboard,
  Loader2,
  MessagesSquare,
  Package,
  Receipt,
  ShieldCheck,
  Settings,
  Tags,
  Upload,
  Users,
} from "lucide-react";
import React, { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Container, InfoNote, LoadingBlock, SectionHeading } from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { formatDateTime } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function formatBase(amountMinor: number, currency: string): string {
  const cfg = { INR: "₹", USD: "$", EUR: "€", GBP: "£" }[currency] ?? "";
  return `${cfg}${(amountMinor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type QueryResult = {
  currency: string;
  counts: {
    ordersLastWeek: number;
    revenueLastWeek: number;
    estimatedProfitLastWeek: number;
    productsPublished: number;
    pendingFulfilment: number;
    products: number;
    published: number;
    paidOrders: number;
    suppliers: number;
    configuredSuppliers: number;
    customers: number;
  };
  finance: {
    salesBaseMinor: number;
    costBaseMinor: number;
    refundedBaseMinor: number;
    profitBaseMinor: number;
  };
  lowStock: { _id: string; name: string; sku: string; stock: number; status: string }[];
  belowMargin: {
    _id: string;
    name: string;
    sku: string;
    marginPercent: number;
    priceMinor: number;
    costMinor: number;
    currency: string;
  }[];
  bestSellers: { name: string; slug: string; units: number }[];
  recentActivity: {
    action: string;
    summary: string;
    createdAt: number;
    actorEmail: string | undefined;
  }[];
  recentImportJobs: {
    _id: string;
    jobId: string;
    status: string;
    createdAt: number;
    rowCount: number;
    failedRowCount: number;
    errorMessage?: string | null;
  }[];
  updatedAt: number;
};

export function AdminOverview() {
  const overview = useQuery(api.admin.getOverview, {});
  const seedDemo = useMutation(api.seed.seedDemoCatalog);
  const { config } = useStore();

  usePageMeta({
    title: "Admin dashboard — overview",
    noIndex: true,
    path: "/admin",
    siteUrl: config?.seo.siteUrl,
  });

  if (overview === undefined) return <LoadingBlock />;

  const data = overview as unknown as QueryResult;

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Overview"
        subtitle="This is the first page administrators see. From here you can start building the catalog, check recent orders and find anything unfinished."
      />

      <InfoNote tone="info">
        <div className="flex flex-wrap items-start gap-3">
          <ShieldCheck className="size-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Keep the sandbox separate from production data.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The test gateway is a signed sandbox, not a real payment provider. Do not use it with
              real merchant credentials, and do not enable it for a live store. When you are ready, set
              up a real provider (Razorpay, Cashfree, PayPal or an equivalent with your business
              requirements) and re-check the credentials in Admin → Settings.
            </p>
          </div>
        </div>
      </InfoNote>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Orders (last week)" value={data.counts.ordersLastWeek.toLocaleString()} />
        <MetricCard
          label="Paid revenue (last week)"
          value={formatBase(data.finance.salesBaseMinor, config?.commerce.baseCurrency ?? "INR")}
        />
        <MetricCard
          label="Estimated profit (last week)"
          value={formatBase(data.finance.profitBaseMinor, config?.commerce.baseCurrency ?? "INR")}
          note="after supplier cost, payment fees and refunds"
        />
        <MetricCard label="Products published" value={data.counts.productsPublished.toLocaleString()} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PanelCard
          title="Low-stock products"
          count={data.lowStock.length}
          description="Products at or below the configured low-stock threshold."
        >
          <Link to="/admin/inventory" className="text-sm text-primary hover:underline">
            Review inventory →
          </Link>
        </PanelCard>

        <PanelCard
          title="Pending fulfilment"
          count={data.counts.pendingFulfilment}
          description="Paid orders waiting to be forwarded to a supplier."
        >
          <Link to="/admin/orders?status=pending&status=processing&status=forwarded" className="text-sm text-primary hover:underline">
            View orders →
          </Link>
        </PanelCard>

        <PanelCard
          title="Supplier sync failures"
          count={data.recentImportJobs.filter((j) => j.status === "failed").length}
          description="Jobs that could not reach a supplier in the last run."
        >
          <Link to="/admin/suppliers" className="text-sm text-primary hover:underline">
            Check suppliers →
          </Link>
        </PanelCard>

        <PanelCard
          title="Import failures"
          count={data.recentImportJobs.filter((j) => j.status === "failed").length}
          description="Jobs with rows that failed validation or execution."
        >
          <Link to="/admin/imports" className="text-sm text-primary hover:underline">
            Review imports →
          </Link>
        </PanelCard>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">If the store is brand new</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The first time, you will usually want to create the store foundation — categories,
          brands, the demo catalog and a supplier record — before editing products by hand.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("demo");
              try {
                const result = await seedDemo({});
                toast.success(
                  `${result.created} sample products added (flagged as demo, easy to remove later).`,
                );
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Could not add samples.",
                );
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "demo" ? <Loader2 className="size-4 animate-spin" /> : null}
            Add sample products
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("remove");
              try {
                const result = await seedDemo({});
                toast.success(
                  "Demo products and their related records were removed. Non-demo data was left untouched.",
                );
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Could not remove the samples.",
                );
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "remove" ? <Loader2 className="size-4 animate-spin" /> : null}
            Remove demo products
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Last updated {formatDateTime(data.updatedAt) ?? "—"} · {data.counts.ordersLastWeek} orders in the last
        week · {formatBase(data.finance.salesBaseMinor, config?.commerce.baseCurrency ?? "INR")}{" "}
        paid revenue in the last week.
      </p>
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function PanelCard({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count: number;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <p className="text-3xl font-light tracking-tight">{count}</p>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

let busy: string | null = null;
function setBusy(value: string | null) {
  busy = value;
}

const ADMIN_SECTIONS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: Receipt },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/imports", label: "Import centre", icon: Upload },
  { href: "/admin/inventory", label: "Inventory", icon: Boxes },
  { href: "/admin/suppliers", label: "Suppliers", icon: Factory },
  { href: "/admin/catalog", label: "Catalog & coupons", icon: Tags },
  { href: "/admin/marketing", label: "Reviews & support", icon: MessagesSquare },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

export default function AdminApp() {
  const [isLoading, setIsLoading] = useState(false);
  const location = useLocation();
  const { config } = useStore();
  const user = useAuth().user;

  usePageMeta({
    title: "KNOKH admin",
    noIndex: true,
    path: "/admin",
    siteUrl: config?.seo.siteUrl,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <Container className="flex items-center justify-between py-3">
          <Link to="/admin" className="flex items-center gap-2 text-lg font-semibold">
            <ArrowRight className="size-5 text-primary" />
            KNOKH
            <span className="text-xs text-muted-foreground font-normal">Admin</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-1">
            {ADMIN_SECTIONS.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                <item.icon className="size-4" />
                {item.label}
              </NavLink>
))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {user?.name || user?.email ? String(user?.name || user?.email) : "Admin"}
            </span>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/" className="flex items-center gap-1 text-xs">
                <ArrowRight className="size-3.5" /> Storefront
              </Link>
            </Button>
          </div>
        </Container>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
