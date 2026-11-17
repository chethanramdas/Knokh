import { useMutation, useQuery } from "convex/react";
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
import { Link, NavLink, Outlet } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Container, InfoNote, LoadingBlock, SectionHeading } from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
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
    orders: number;
    pendingFulfilment: number;
    products: number;
    published: number;
    paidOrders: number;
    suppliers: number;
    configuredSuppliers: number;
    syncFailures: number;
    customers: number;
  };
  finance: {
    grossSalesBaseMinor: number;
    costOfGoodsBaseMinor: number;
    refundedBaseMinor: number;
    estimatedGrossProfitBaseMinor: number;
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
    type: string;
    status: string;
    createdAt: number;
    fileName?: string;
    createdRows: number;
    invalidRows: number;
    errorMessage?: string | null;
  }[];
};

export function AdminOverview() {
  const overview = useQuery(api.admin.getOverview, {});
  const seedDemo = useMutation(api.seed.seedDemoCatalog);
  const removeDemo = useMutation(api.seed.removeDemoCatalog);
  const [busy, setBusy] = useState<string | null>(null);
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
        <MetricCard label="Recent orders" value={data.counts.orders.toLocaleString()} />
        <MetricCard
          label="Recent paid revenue"
          value={formatBase(data.finance.grossSalesBaseMinor, config?.commerce.baseCurrency ?? "INR")}
        />
        <MetricCard
          label="Estimated recent profit"
          value={formatBase(data.finance.estimatedGrossProfitBaseMinor, config?.commerce.baseCurrency ?? "INR")}
          note="after supplier cost and refunds; excludes payment fees and advertising"
        />
        <MetricCard label="Products published" value={data.counts.published.toLocaleString()} />
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
          count={data.counts.syncFailures}
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
                await removeDemo({});
                toast.success(
                  "Demo products were removed. Non-demo data was left untouched.",
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
        Order and revenue totals cover up to the 200 most recent orders. Profit is an estimate.
        Product counts cover up to 1,000 products.
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
  const { config } = useStore();
  const { user, isLoading: isAuthLoading } = useAuth();

  usePageMeta({
    title: "KNOKH admin",
    noIndex: true,
    path: "/admin",
    siteUrl: config?.seo.siteUrl,
  });

  if (isAuthLoading) return <LoadingBlock />;
  if (user?.role !== "admin") {
    return (
      <Container className="py-16">
        <h1 className="text-2xl font-semibold">Administrator access required</h1>
        <p className="mt-3 text-muted-foreground">
          This account does not have administrator permissions. Contact the store owner for access.
        </p>
        <Link to="/account/profile" className="mt-6 inline-block text-primary underline">
          Manage your account or sign in with a different email
        </Link>
      </Container>
    );
  }

  return (
    <div className="knokh-admin-shell min-h-svh min-w-0 bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <Container className="py-3">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <Link to="/admin" className="flex shrink-0 items-center gap-2 text-lg font-semibold">
              <ArrowRight className="size-5 text-primary" />
              KNOKH
              <span className="text-xs font-normal text-muted-foreground">Admin</span>
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden max-w-48 truncate text-xs text-muted-foreground sm:inline">
                {user?.name || user?.email ? String(user?.name || user?.email) : "Admin"}
              </span>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/" className="flex items-center gap-1 text-xs">
                  <ArrowRight className="size-3.5" /> Storefront
                </Link>
              </Button>
            </div>
          </div>
          <nav aria-label="Administrator navigation" className="mt-3 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto pb-1">
            {ADMIN_SECTIONS.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
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
        </Container>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

