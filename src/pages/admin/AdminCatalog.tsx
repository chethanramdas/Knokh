import { useMutation, useQuery } from "@/lib/cloudflare-client";
import { Archive, ArrowDown, ArrowUp, Loader2, Plus, Tags } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Id } from "@/lib/cloudflare-types";
import { EmptyState, InfoNote, LoadingBlock, SectionHeading, StatusPill } from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, titleCase } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";

type AttributeRow = { key: string; label: string; options: string[] };

/** Parse "key|Label|option a,option b" lines into category attribute definitions. */
function parseAttributes(value: string): AttributeRow[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key = "", label = "", options = ""] = line.split("|");
      return {
        key: key.trim(),
        label: label.trim() || key.trim(),
        options: options
          .split(",")
          .map((option) => option.trim())
          .filter(Boolean),
      };
    })
    .filter((row) => row.key.length > 0);
}

function serializeAttributes(rows: AttributeRow[] | undefined): string {
  return (rows ?? [])
    .map((row) => `${row.key}|${row.label}|${row.options.join(",")}`)
    .join("\n");
}

export default function AdminCatalog() {
  const { config } = useStore();
  const categories = useQuery(api.admin.listCategoriesAdmin, {});
  const brands = useQuery(api.admin.listBrandsAdmin, {});
  const collections = useQuery(api.admin.listCollectionsAdmin, {});
  const coupons = useQuery(api.admin.listCouponsAdmin, {});
  const products = useQuery(api.admin.listProductsAdmin, { perPage: 100, status: "all" });

  const saveCategory = useMutation(api.admin.saveCategory);
  const reorderCategory = useMutation(api.admin.reorderCategory);
  const saveBrand = useMutation(api.admin.saveBrand);
  const saveCollection = useMutation(api.admin.saveCollection);
  const saveCoupon = useMutation(api.admin.saveCoupon);

  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  usePageMeta({
    title: "Catalog & coupons",
    noIndex: true,
    path: "/admin/catalog",
    siteUrl: config?.seo.siteUrl,
  });

  const roots = (categories ?? []).filter((category) => !category.parentId);
  const childrenOf = (id: string) =>
    (categories ?? []).filter((category) => category.parentId === id);

  async function moveCategory(id: Id<"categories">, position: number) {
    try {
      await reorderCategory({ categoryId: id, position: Math.max(0, position) });
      toast.success("Category order updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reorder.");
    }
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        title="Catalog, brands & coupons"
        subtitle="Categories drive storefront navigation and filtering. Featured collections appear on the homepage. Coupons are validated on the server at checkout."
      />

      {/* Categories */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Categories & subcategories</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditingCategory(editingCategory === "new" ? null : "new")}
          >
            <Plus className="size-3.5" /> New category
          </Button>
        </div>

        {editingCategory === "new" ? (
          <CategoryForm
            title="Create a category"
            busy={busy === "category"}
            onCancel={() => setEditingCategory(null)}
            onSubmit={async (values) => {
              setBusy("category");
              try {
                await saveCategory(values);
                toast.success("Category created.");
                setEditingCategory(null);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not save.");
              } finally {
                setBusy(null);
              }
            }}
          />
        ) : null}

        {categories === undefined ? (
          <LoadingBlock />
        ) : categories.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description="Create the top-level categories your storefront will navigate by."
          />
        ) : (
          <ul className="mt-4 space-y-2">
            {roots.map((category, index) => (
              <li key={category._id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{category.name}</span>
                  <StatusPill tone={category.status === "active" ? "success" : "neutral"}>
                    {titleCase(category.status ?? "active")}
                  </StatusPill>
                  {category.featured ? <StatusPill tone="info">Featured</StatusPill> : null}
                  <StatusPill tone="neutral">{category.productCount} products</StatusPill>
                  <span className="text-xs text-muted-foreground">/{category.slug}</span>
                  <div className="ml-auto flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Move up"
                      onClick={() => moveCategory(category._id, (category.position ?? index) - 1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Move down"
                      onClick={() => moveCategory(category._id, (category.position ?? index) + 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setEditingCategory(editingCategory === category._id ? null : category._id)
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await saveCategory({
                          categoryId: category._id,
                          name: category.name,
                          parentId: category.parentId,
                          description: category.description,
                          image: category.image,
                          icon: category.icon,
                          position: category.position,
                          featured: category.featured,
                          status: category.status === "archived" ? "active" : "archived",
                          attributes: category.attributes,
                          seoTitle: category.seoTitle,
                          seoDescription: category.seoDescription,
                        });
                        toast.success(
                          category.status === "archived"
                            ? "Category restored."
                            : "Category archived (products are kept, but it is hidden from navigation).",
                        );
                      }}
                    >
                      <Archive className="size-3.5" />
                      {category.status === "archived" ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </div>

                {childrenOf(category._id).length > 0 ? (
                  <ul className="mt-3 space-y-1 pl-4 text-sm text-muted-foreground">
                    {childrenOf(category._id).map((child) => (
                      <li key={child._id}>
                        ↳ {child.name}
                        <span className="ml-2 text-xs">/{child.slug}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {editingCategory === category._id ? (
                  <CategoryForm
                    title={`Edit ${category.name}`}
                    initial={{
                      name: category.name,
                      description: category.description ?? "",
                      image: category.image ?? "",
                      icon: category.icon ?? "",
                      featured: category.featured ?? false,
                      attributes: serializeAttributes(category.attributes),
                    }}
                    parents={roots
                      .filter((root) => root._id !== category._id)
                      .map((root) => ({ value: root._id, label: root.name }))}
                    currentParent={category.parentId}
                    busy={busy === "category"}
                    onCancel={() => setEditingCategory(null)}
                    onSubmit={async (values) => {
                      setBusy("category");
                      try {
                        await saveCategory({ ...values, categoryId: category._id });
                        toast.success("Category updated.");
                        setEditingCategory(null);
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Could not save.");
                      } finally {
                        setBusy(null);
                      }
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Brands */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Brands</h2>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            try {
              await saveBrand({
                name: String(data.get("name") ?? ""),
                description: String(data.get("description") ?? "") || undefined,
              });
              toast.success("Brand saved.");
              event.currentTarget.reset();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not save the brand.");
            }
          }}
        >
          <div>
            <Label htmlFor="brand-name">Name</Label>
            <Input id="brand-name" name="name" required />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="brand-desc">Description (optional)</Label>
            <Input id="brand-desc" name="description" />
          </div>
          <div>
            <Button type="submit" variant="outline">
              Add brand
            </Button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {(brands ?? []).map((brand) => (
            <span key={brand._id} className="rounded-full border border-border px-3 py-1">
              {brand.name}
            </span>
          ))}
          {brands?.length === 0 ? (
            <span className="text-muted-foreground">No brands yet.</span>
          ) : null}
        </div>
      </section>

      {/* Collections */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Featured collections</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Collections group products across categories and can be promoted on the homepage.
        </p>
        <form
          className="mt-3 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const selected = (data.getAll("productIds") as string[]) as Id<"products">[];
            if (selected.length === 0) {
              toast.error("Pick at least one product for the collection.");
              return;
            }
            try {
              await saveCollection({
                name: String(data.get("name") ?? ""),
                description: String(data.get("description") ?? "") || undefined,
                featured: data.get("featured") === "on",
                productIds: selected,
              });
              toast.success("Collection saved.");
              form.reset();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not save the collection.");
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="col-name">Name</Label>
              <Input id="col-name" name="name" required />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="col-desc">Description</Label>
              <Input id="col-desc" name="description" />
            </div>
          </div>
          <div>
            <Label htmlFor="col-products">Products (ctrl/cmd-click for multiple)</Label>
            <select
              id="col-products"
              name="productIds"
              multiple
              size={6}
              className="w-full rounded-lg border border-border bg-background p-2 text-sm"
            >
              {(products?.items ?? []).map((product) => (
                <option key={product._id} value={product._id}>
                  {product.name} — {product.sku}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="featured" className="size-4" /> Feature on the homepage
          </label>
          <Button type="submit" variant="outline">
            Save collection
          </Button>
        </form>

        <ul className="mt-4 space-y-1 text-sm">
          {(collections ?? []).map((collection) => (
            <li key={collection._id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{collection.name}</span>
              <span className="text-xs text-muted-foreground">
                {collection.productIds.length} products · /collections/{collection.slug}
              </span>
              {collection.featured ? <StatusPill tone="info">Featured</StatusPill> : null}
            </li>
          ))}
          {collections?.length === 0 ? (
            <li className="text-muted-foreground">No collections yet.</li>
          ) : null}
        </ul>
      </section>

      {/* Coupons */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Tags className="size-4" /> Coupons
        </h2>
        <InfoNote tone="info">
          Percentage discounts are capped at 90%. Values are stored as integers (percent, or minor
          units for fixed amounts) and re-validated on the server every time a cart is priced.
        </InfoNote>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const type = String(data.get("type")) as "percent" | "fixed" | "free_shipping";
            const rawValue = Number(data.get("value") ?? 0);
            try {
              await saveCoupon({
                code: String(data.get("code") ?? ""),
                description: String(data.get("description") ?? "") || undefined,
                type,
                value: type === "fixed" ? Math.round(rawValue * 100) : Math.round(rawValue),
                minOrderMinor: Math.round(Number(data.get("minOrder") ?? 0) * 100),
                maxDiscountMinor:
                  data.get("maxDiscount") && Number(data.get("maxDiscount")) > 0
                    ? Math.round(Number(data.get("maxDiscount")) * 100)
                    : undefined,
                usageLimit: data.get("usageLimit") ? Number(data.get("usageLimit")) : undefined,
                perUserLimit: data.get("perUserLimit")
                  ? Number(data.get("perUserLimit"))
                  : undefined,
                status: "active",
              });
              toast.success("Coupon created.");
              form.reset();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not save the coupon.");
            }
          }}
        >
          <div>
            <Label htmlFor="c-code">Code</Label>
            <Input id="c-code" name="code" required minLength={3} placeholder="WELCOME10" />
          </div>
          <div>
            <Label htmlFor="c-type">Type</Label>
            <select
              id="c-type"
              name="type"
              className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
            >
              <option value="percent">Percent off</option>
              <option value="fixed">Fixed amount off</option>
              <option value="free_shipping">Free shipping</option>
            </select>
          </div>
          <div>
            <Label htmlFor="c-value">Value (percent or base-currency amount)</Label>
            <Input id="c-value" name="value" type="number" min="0" step="0.01" defaultValue={10} />
          </div>
          <div>
            <Label htmlFor="c-min">Minimum order (optional)</Label>
            <Input id="c-min" name="minOrder" type="number" min="0" step="0.01" defaultValue={0} />
          </div>
          <div>
            <Label htmlFor="c-max">Max discount (optional)</Label>
            <Input id="c-max" name="maxDiscount" type="number" min="0" step="0.01" />
          </div>
          <div>
            <Label htmlFor="c-usage">Total usage limit (optional)</Label>
            <Input id="c-usage" name="usageLimit" type="number" min="1" />
          </div>
          <div>
            <Label htmlFor="c-peruser">Per customer limit (optional)</Label>
            <Input id="c-peruser" name="perUserLimit" type="number" min="1" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="c-desc">Description</Label>
            <Input id="c-desc" name="description" />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" variant="outline">
              Create coupon
            </Button>
          </div>
        </form>

        <div className="mt-4 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[620px] text-xs">
            <thead className="bg-muted/60 text-left uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Used</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(coupons ?? []).map((coupon) => (
                <tr key={coupon._id}>
                  <td className="px-3 py-2 font-medium">{coupon.code}</td>
                  <td className="px-3 py-2">{titleCase(coupon.type)}</td>
                  <td className="px-3 py-2">
                    {coupon.type === "percent"
                      ? `${coupon.value}%`
                      : coupon.type === "fixed"
                        ? `${(coupon.value / 100).toFixed(2)} ${coupon.currency}`
                        : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {coupon.usedCount}
                    {coupon.usageLimit ? ` / ${coupon.usageLimit}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={coupon.status === "active" ? "success" : "neutral"}>
                      {titleCase(coupon.status)}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await saveCoupon({
                          couponId: coupon._id,
                          code: coupon.code,
                          description: coupon.description,
                          type: coupon.type,
                          value: coupon.value,
                          minOrderMinor: coupon.minOrderMinor,
                          maxDiscountMinor: coupon.maxDiscountMinor,
                          usageLimit: coupon.usageLimit,
                          perUserLimit: coupon.perUserLimit,
                          startsAt: coupon.startsAt,
                          endsAt: coupon.endsAt,
                          appliesToCategoryIds: coupon.appliesToCategoryIds,
                          status: coupon.status === "active" ? "disabled" : "active",
                        });
                        toast.success(
                          coupon.status === "active" ? "Coupon disabled." : "Coupon enabled.",
                        );
                      }}
                    >
                      {coupon.status === "active" ? "Disable" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))}
              {coupons?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No coupons yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Created {coupons?.[0] ? formatDateTime(coupons[0].createdAt) : "—"} (most recent).
        </p>
      </section>
    </div>
  );
}

type CategoryFormValues = {
  name: string;
  parentId?: Id<"categories">;
  description?: string;
  image?: string;
  icon?: string;
  featured?: boolean;
  status?: "active" | "archived";
  attributes?: AttributeRow[];
  seoTitle?: string;
  seoDescription?: string;
};

function CategoryForm({
  title,
  initial,
  parents,
  currentParent,
  busy,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial?: {
    name: string;
    description: string;
    image: string;
    icon: string;
    featured: boolean;
    attributes: string;
  };
  parents?: { value: string; label: string }[];
  currentParent?: Id<"categories">;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
}) {
  const [attributes, setAttributes] = useState(initial?.attributes ?? "");
  const [parent, setParent] = useState(currentParent ?? "");

  return (
    <form
      className="mt-4 space-y-3 rounded-lg border border-dashed border-border p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        await onSubmit({
          name: String(data.get("name") ?? ""),
          parentId: parent ? (parent as Id<"categories">) : undefined,
          description: String(data.get("description") ?? "") || undefined,
          image: String(data.get("image") ?? "") || undefined,
          icon: String(data.get("icon") ?? "") || undefined,
          featured: data.get("featured") === "on",
          attributes: parseAttributes(attributes),
          seoTitle: String(data.get("seoTitle") ?? "") || undefined,
          seoDescription: String(data.get("seoDescription") ?? "") || undefined,
        });
      }}
    >
      <p className="text-sm font-semibold">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="cat-name">Name</Label>
          <Input id="cat-name" name="name" required defaultValue={initial?.name} />
        </div>
        <div>
          <Label htmlFor="cat-parent">Parent category</Label>
          <select
            id="cat-parent"
            className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
            value={parent}
            onChange={(event) => setParent(event.target.value)}
          >
            <option value="">— top level —</option>
            {(parents ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="cat-desc">Description</Label>
          <Input id="cat-desc" name="description" defaultValue={initial?.description} />
        </div>
        <div>
          <Label htmlFor="cat-image">Image URL</Label>
          <Input id="cat-image" name="image" defaultValue={initial?.image} />
        </div>
        <div>
          <Label htmlFor="cat-icon">Icon (lucide name, optional)</Label>
          <Input id="cat-icon" name="icon" defaultValue={initial?.icon} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="cat-attributes">
            Attributes — one per line: key|Label|option a,option b
          </Label>
          <Textarea
            id="cat-attributes"
            rows={3}
            value={attributes}
            onChange={(event) => setAttributes(event.target.value)}
            placeholder={"color|Colour|Black,White\nsize|Size|S,M,L"}
          />
        </div>
        <div>
          <Label htmlFor="cat-seo-title">SEO title</Label>
          <Input id="cat-seo-title" name="seoTitle" />
        </div>
        <div>
          <Label htmlFor="cat-seo-desc">SEO description</Label>
          <Input id="cat-seo-desc" name="seoDescription" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="featured"
          className="size-4"
          defaultChecked={initial?.featured}
        />{" "}
        Feature this category on the homepage
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
