import { useMutation, useQuery } from "@/lib/cloudflare-client";
import { Download, Loader2, Pencil, Plus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Id } from "@/lib/cloudflare-types";
import {
  EmptyState,
  InfoNote,
  LoadingBlock,
  Pagination,
  SectionHeading,
  StatusPill,
} from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadTextFile, formatDate, titleCase } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";
import { formatBase } from "./AdminApp";

const STATUSES = ["draft", "published", "unavailable", "archived"] as const;

type Draft = {
  productId?: Id<"products">;
  name: string;
  sku: string;
  summary: string;
  description: string;
  price: string;
  compareAt: string;
  cost: string;
  stock: string;
  status: (typeof STATUSES)[number];
  categoryId: string;
  brandId: string;
  supplierId: string;
  supplierSku: string;
  images: string;
  featured: boolean;
  deliveryEstimateDays: string;
  shipsTo: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  sku: "",
  summary: "",
  description: "",
  price: "",
  compareAt: "",
  cost: "",
  stock: "0",
  status: "draft",
  categoryId: "",
  brandId: "",
  supplierId: "",
  supplierSku: "",
  images: "",
  featured: false,
  deliveryEstimateDays: "7",
  shipsTo: "IN",
};

export default function AdminProducts() {
  const { config } = useStore();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const products = useQuery(api.admin.listProductsAdmin, {
    search: search || undefined,
    status,
    page,
    perPage: 25,
  });
  const categories = useQuery(api.admin.listCategoriesAdmin, {});
  const brands = useQuery(api.admin.listBrandsAdmin, {});
  const suppliers = useQuery(api.suppliers.listSuppliers, {});

  const createProduct = useMutation(api.admin.createProduct);
  const updateProduct = useMutation(api.admin.updateProduct);
  const bulkUpdate = useMutation(api.admin.bulkUpdateProducts);
  const adjustStock = useMutation(api.admin.adjustStock);

  usePageMeta({ title: "Products", noIndex: true, path: "/admin/products", siteUrl: config?.seo.siteUrl });

  const parentCategories = (categories ?? []).filter((category) => !category.parentId);
  const childCategories = (categories ?? []).filter((category) => category.parentId);

  const toMinor = (value: string) => {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const images = draft.images
        .split(/[\n,]/)
        .map((url) => url.trim())
        .filter(Boolean)
        .map((url) => ({ url, alt: draft.name }));
      if (draft.productId) {
        await updateProduct({
          productId: draft.productId,
          patch: {
            name: draft.name,
            summary: draft.summary || undefined,
            description: draft.description || undefined,
            priceMinor: toMinor(draft.price),
            compareAtMinor: draft.compareAt ? toMinor(draft.compareAt) : undefined,
            costMinor: draft.cost ? toMinor(draft.cost) : undefined,
            stock: Number(draft.stock) || 0,
            status: draft.status,
            featured: draft.featured,
            images,
            categoryId: draft.categoryId ? (draft.categoryId as Id<"categories">) : undefined,
            brandId: draft.brandId ? (draft.brandId as Id<"brands">) : undefined,
            supplierId: draft.supplierId ? (draft.supplierId as Id<"suppliers">) : undefined,
            supplierSku: draft.supplierSku || undefined,
            deliveryEstimateDays: Number(draft.deliveryEstimateDays) || 7,
            shipsTo: draft.shipsTo
              .split(/[,\s]+/)
              .map((code) => code.trim().toUpperCase())
              .filter(Boolean),
          },
        });
        toast.success("Product updated.");
      } else {
        await createProduct({
          name: draft.name,
          sku: draft.sku,
          summary: draft.summary || undefined,
          description: draft.description || undefined,
          priceMinor: toMinor(draft.price),
          compareAtMinor: draft.compareAt ? toMinor(draft.compareAt) : undefined,
          costMinor: draft.cost ? toMinor(draft.cost) : undefined,
          stock: Number(draft.stock) || 0,
          status: draft.status,
          featured: draft.featured,
          images,
          categoryId: draft.categoryId ? (draft.categoryId as Id<"categories">) : undefined,
          brandId: draft.brandId ? (draft.brandId as Id<"brands">) : undefined,
          supplierId: draft.supplierId ? (draft.supplierId as Id<"suppliers">) : undefined,
          supplierSku: draft.supplierSku || undefined,
          deliveryEstimateDays: Number(draft.deliveryEstimateDays) || 7,
          shipsTo: draft.shipsTo
            .split(/[,\s]+/)
            .map((code) => code.trim().toUpperCase())
            .filter(Boolean),
        });
        toast.success("Product created as " + draft.status + ".");
      }
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the product.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Products"
        subtitle="Add products, adjust stock and prices, and publish them to the storefront."
        action={
          <div className="flex gap-2">
            <ExportButton />
            <Button onClick={() => setDraft({ ...EMPTY_DRAFT })}>
              <Plus className="size-4" /> New product
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, SKU or supplier SKU"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm">
          <span className="font-medium">{selected.length} selected</span>
          {STATUSES.map((value) => (
            <Button
              key={value}
              size="sm"
              variant="outline"
              onClick={async () => {
                await bulkUpdate({
                  productIds: selected as Id<"products">[],
                  status: value,
                });
                toast.success(`Marked ${selected.length} product(s) as ${value}.`);
                setSelected([]);
              }}
            >
              {titleCase(value)}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await bulkUpdate({
                productIds: selected as Id<"products">[],
                markupPercent: config?.pricing.defaultMarkupPercent ?? 35,
              });
              toast.success("Prices recalculated from supplier cost with your default markup.");
              setSelected([]);
            }}
          >
            Re-price from cost
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </div>
      ) : null}

      {products === undefined ? (
        <LoadingBlock label="Loading products…" />
      ) : products.items.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Create a product manually, or import a CSV/XLSX file or supplier feed from the Import centre."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Cost / margin</th>
                  <th className="px-3 py-2">Stock</th>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.items.map((product) => (
                  <tr key={product._id}>
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={selected.includes(String(product._id))}
                        onCheckedChange={(value) =>
                          setSelected((current) =>
                            value === true
                              ? [...current, String(product._id)]
                              : current.filter((id) => id !== String(product._id)),
                          )
                        }
                        aria-label={`Select ${product.name}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        {product.image ? (
                          <img src={product.image} alt="" className="size-9 rounded object-cover" />
                        ) : null}
                        <div>
                          <p className="font-medium">{product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {product.sku}
                            {product.supplierSku ? ` · supplier ${product.supplierSku}` : ""}
                            {product.isDemo ? " · sample" : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
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
                    <td className="px-3 py-3">
                      <p className="font-medium">{formatBase(product.priceMinor, product.currency)}</p>
                      {product.compareAtMinor ? (
                        <p className="text-xs text-muted-foreground line-through">
                          {formatBase(product.compareAtMinor, product.currency)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {product.costMinor ? (
                        <>
                          <p>{formatBase(product.costMinor, product.currency)}</p>
                          <p
                            className={
                              (product.marginPercent ?? 0) <
                              (config?.pricing.minimumMarginPercent ?? 12)
                                ? "text-xs font-medium text-amber-600"
                                : "text-xs text-muted-foreground"
                            }
                          >
                            {product.marginPercent}% margin
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">No cost recorded</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <p className={product.stock <= 0 ? "font-medium text-destructive" : ""}>
                        {product.stock}
                      </p>
                      <div className="mt-1 flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await adjustStock({
                              productId: product._id as Id<"products">,
                              delta: 1,
                              note: "Quick adjust from product list",
                            });
                            toast.success("Stock increased by 1.");
                          }}
                        >
                          +1
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await adjustStock({
                              productId: product._id as Id<"products">,
                              delta: -1,
                              note: "Quick adjust from product list",
                            });
                            toast.success("Stock reduced by 1.");
                          }}
                        >
                          −1
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {formatDate(product.updatedAt)}
                    </td>
                    <td className="px-3 py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDraft({
                            productId: product._id as Id<"products">,
                            name: product.name,
                            sku: product.sku,
                            summary: "",
                            description: "",
                            price: (product.priceMinor / 100).toFixed(2),
                            compareAt: product.compareAtMinor
                              ? (product.compareAtMinor / 100).toFixed(2)
                              : "",
                            cost: product.costMinor ? (product.costMinor / 100).toFixed(2) : "",
                            stock: String(product.stock),
                            status: product.status,
                            categoryId: "",
                            brandId: "",
                            supplierId: (product.supplierId as string) ?? "",
                            supplierSku: product.supplierSku ?? "",
                            images: "",
                            featured: false,
                            deliveryEstimateDays: "7",
                            shipsTo: "",
                          })
                        }
                      >
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={products.page} totalPages={products.totalPages} onChange={setPage} />
        </>
      )}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4">
          <div className="mt-8 w-full max-w-3xl rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {draft.productId ? "Edit product" : "New product"}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                Close
              </Button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="p-name">Name</Label>
                <Input
                  id="p-name"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-sku">SKU</Label>
                <Input
                  id="p-sku"
                  value={draft.sku}
                  disabled={Boolean(draft.productId)}
                  onChange={(event) => setDraft({ ...draft, sku: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-status">Status</Label>
                <select
                  id="p-status"
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value as Draft["status"] })
                  }
                  className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
                >
                  {STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="p-price">Selling price (base currency)</Label>
                <Input
                  id="p-price"
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-compare">Compare-at price (optional)</Label>
                <Input
                  id="p-compare"
                  inputMode="decimal"
                  value={draft.compareAt}
                  onChange={(event) => setDraft({ ...draft, compareAt: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-cost">Supplier cost (internal)</Label>
                <Input
                  id="p-cost"
                  inputMode="decimal"
                  value={draft.cost}
                  onChange={(event) => setDraft({ ...draft, cost: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-stock">Stock</Label>
                <Input
                  id="p-stock"
                  inputMode="numeric"
                  value={draft.stock}
                  onChange={(event) => setDraft({ ...draft, stock: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-category">Category</Label>
                <select
                  id="p-category"
                  value={draft.categoryId}
                  onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
                  className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {parentCategories.map((category) => (
                    <optgroup key={category._id} label={category.name}>
                      <option value={category._id}>{category.name}</option>
                      {childCategories
                        .filter((child) => child.parentId === category._id)
                        .map((child) => (
                          <option key={child._id} value={child._id}>
                            — {child.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="p-brand">Brand</Label>
                <select
                  id="p-brand"
                  value={draft.brandId}
                  onChange={(event) => setDraft({ ...draft, brandId: event.target.value })}
                  className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {(brands ?? []).map((brand) => (
                    <option key={brand._id} value={brand._id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="p-supplier">Supplier</Label>
                <select
                  id="p-supplier"
                  value={draft.supplierId}
                  onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })}
                  className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {(suppliers ?? []).map((supplier) => (
                    <option key={supplier._id} value={supplier._id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="p-supplier-sku">Supplier SKU</Label>
                <Input
                  id="p-supplier-sku"
                  value={draft.supplierSku}
                  onChange={(event) => setDraft({ ...draft, supplierSku: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-delivery">Dispatch estimate (days)</Label>
                <Input
                  id="p-delivery"
                  inputMode="numeric"
                  value={draft.deliveryEstimateDays}
                  onChange={(event) =>
                    setDraft({ ...draft, deliveryEstimateDays: event.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="p-ships">Ships to (ISO codes, comma separated)</Label>
                <Input
                  id="p-ships"
                  value={draft.shipsTo}
                  onChange={(event) => setDraft({ ...draft, shipsTo: event.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="p-summary">Short summary</Label>
                <Input
                  id="p-summary"
                  value={draft.summary}
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="p-description">Description</Label>
                <Textarea
                  id="p-description"
                  rows={4}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="p-images">
                  Image URLs (one per line — only use images you are licensed to use)
                </Label>
                <Textarea
                  id="p-images"
                  rows={3}
                  value={draft.images}
                  onChange={(event) => setDraft({ ...draft, images: event.target.value })}
                />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Checkbox
                  id="p-featured"
                  checked={draft.featured}
                  onCheckedChange={(value) => setDraft({ ...draft, featured: value === true })}
                />
                <Label htmlFor="p-featured" className="text-sm font-normal">
                  Feature on the homepage
                </Label>
              </div>
            </div>
            <InfoNote className="mt-4">
              Editing an existing product only changes the fields you fill in above. Leave a field
              blank to keep the current value.
            </InfoNote>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => void save()} disabled={busy || !draft.name || (!draft.productId && !draft.sku)}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save product
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExportButton() {
  const exportQuery = useQuery(api.admin.exportProductsCsv, {});
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy || exportQuery === undefined}
      onClick={() => {
        if (!exportQuery) return;
        setBusy(true);
        downloadTextFile("knokh-products.csv", exportQuery.csv);
        toast.success(`Exported ${exportQuery.count} products.`);
        setBusy(false);
      }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export
      CSV
    </Button>
  );
}
