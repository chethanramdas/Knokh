import { useQuery } from "@/lib/cloudflare-client";
import { Filter, PackageSearch, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { api } from "@/convex/_generated/api";
import { ProductCard } from "@/components/knokh/ProductCard";
import {
  Container,
  EmptyState,
  FilterChips,
  LoadingBlock,
  Pagination,
  SectionHeading,
  StatusPill,
} from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRAND } from "@/lib/brand";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";
import type { ProductCardData } from "@/lib/types";

export type CatalogMode = "shop" | "category" | "search" | "brand" | "collection" | "preset";

const PRESET_LABELS: Record<string, { title: string; subtitle: string }> = {
  "new-arrivals": {
    title: "New arrivals",
    subtitle: "The most recently published products in the catalog.",
  },
  "best-sellers": {
    title: "Best sellers",
    subtitle:
      "Ranked by real completed orders. Empty until your store records its first sales.",
  },
  trending: {
    title: "Trending now",
    subtitle: "Ranked by genuine product page views and sales, not invented numbers.",
  },
  deals: {
    title: "Deals and offers",
    subtitle: "Products with a genuine markdown recorded in the catalog.",
  },
};

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "popular", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
];

export default function Catalog({
  mode,
  preset,
}: {
  mode: CatalogMode;
  preset?: string;
}) {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const store = useStore();
  const { config, baseCurrencyConfig } = store;

  const page = Number(searchParams.get("page") ?? "1") || 1;
  const sort = searchParams.get("sort") ?? "newest";
  const minMajor = searchParams.get("min") ?? "";
  const maxMajor = searchParams.get("max") ?? "";
  const inStockOnly = searchParams.get("stock") === "1";
  const onSaleOnly = searchParams.get("sale") === "1";
  const brandSlug = searchParams.get("brand") ?? "";
  const subcategorySlug = searchParams.get("sub") ?? "";
  const attributeKey = searchParams.get("attr") ?? "";
  const attributeValue = searchParams.get("attrValue") ?? "";
  const term = searchParams.get("q") ?? "";
  const perPage = 24;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSearchParams(next, { replace: true });
  };

  const categorySlug = mode === "category" ? params.slug : undefined;
  const category = useQuery(
    api.catalog.getCategoryBySlug,
    categorySlug ? { slug: categorySlug } : "skip",
  );
  const brand = useQuery(
    api.catalog.getBrandBySlug,
    mode === "brand" && params.slug ? { slug: params.slug } : "skip",
  );
  const collection = useQuery(
    api.catalog.getCollectionBySlug,
    mode === "collection" && params.slug ? { slug: params.slug } : "skip",
  );
  const brands = useQuery(api.catalog.listBrands, {});

  const productArgs = useMemo(
    () => ({
      q: mode === "search" ? term : undefined,
      categorySlug,
      subcategorySlug: subcategorySlug || undefined,
      brandSlug: mode === "brand" ? (params.slug ?? undefined) : brandSlug || undefined,
      collectionSlug: mode === "collection" ? (params.slug ?? undefined) : undefined,
      attributeKey: attributeKey || undefined,
      attributeValue: attributeValue || undefined,
      minMinor: minMajor ? Math.round(Number(minMajor) * 100) : undefined,
      maxMinor: maxMajor ? Math.round(Number(maxMajor) * 100) : undefined,
      inStockOnly: inStockOnly || undefined,
      onSaleOnly: onSaleOnly || preset === "deals" ? true : undefined,
      sort: sort as "newest" | "price_asc" | "price_desc" | "popular" | "rating",
      page: mode === "search" && term.length < 2 ? 1 : page,
      perPage,
    }),
    [
      mode,
      term,
      categorySlug,
      subcategorySlug,
      brandSlug,
      params.slug,
      attributeKey,
      attributeValue,
      minMajor,
      maxMajor,
      inStockOnly,
      onSaleOnly,
      preset,
      sort,
      page,
    ],
  );

  const results = useQuery(
    api.catalog.listProducts,
    mode === "search" && term.length < 2 ? "skip" : productArgs,
  );

  const heading = useMemo(() => {
    if (mode === "category") return category?.name ?? "Category";
    if (mode === "search") return term ? `Results for “${term}”` : "Search the catalog";
    if (mode === "brand") return brand?.name ? `${brand.name} products` : "Brand";
    if (mode === "collection") return collection?.name ?? "Collection";
    if (preset) return PRESET_LABELS[preset]?.title ?? "Products";
    return "All products";
  }, [mode, category, term, brand, collection, preset]);

  const subtitle = useMemo(() => {
    if (mode === "category") return category?.description;
    if (preset) return PRESET_LABELS[preset]?.subtitle;
    if (mode === "collection") return collection?.description;
    if (mode === "brand") return brand?.description;
    if (mode === "search") return "Search by product name, SKU, brand or category.";
    return "Every published product in the KNOKH catalog.";
  }, [mode, category, preset, collection, brand]);

  usePageMeta({
    title: heading,
    description: subtitle ?? config?.seo.defaultDescription,
    path: `/search?q=${encodeURIComponent(term)}`,
    siteUrl: config?.seo.siteUrl,
    noIndex: mode === "search",
  });

  const activeFilters = [
    minMajor ? { label: `Min ${minMajor}`, clear: { min: null } } : null,
    maxMajor ? { label: `Max ${maxMajor}`, clear: { max: null } } : null,
    inStockOnly ? { label: "In stock only", clear: { stock: null } } : null,
    onSaleOnly && preset !== "deals"
      ? { label: "On sale", clear: { sale: null } }
      : null,
    brandSlug ? { label: `Brand: ${brandSlug}`, clear: { brand: null } } : null,
    subcategorySlug ? { label: `Subcategory: ${subcategorySlug}`, clear: { sub: null } } : null,
    attributeValue ? { label: `${attributeKey}: ${attributeValue}`, clear: { attr: null, attrValue: null } } : null,
  ].filter(Boolean) as unknown as { label: string; clear: Record<string, string | null> }[];

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const filterPanel = (
    <div className="space-y-6">
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Price ({store.currency})
        </Label>
        <div className="mt-2 flex items-center gap-2">
          <Input
            inputMode="numeric"
            placeholder="Min"
            defaultValue={minMajor}
            onBlur={(event) => update({ min: event.target.value || null })}
            aria-label="Minimum price"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            inputMode="numeric"
            placeholder="Max"
            defaultValue={maxMajor}
            onBlur={(event) => update({ max: event.target.value || null })}
            aria-label="Maximum price"
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Prices are filtered in {baseCurrencyConfig?.code ?? "INR"} and displayed in {store.currency}.
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Availability
        </Label>
        <div className="flex items-center gap-2">
          <Checkbox
            id="filter-stock"
            checked={inStockOnly}
            onCheckedChange={(value) => update({ stock: value === true ? "1" : null })}
          />
          <Label htmlFor="filter-stock" className="text-sm font-normal">
            In stock only
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="filter-sale"
            checked={onSaleOnly}
            onCheckedChange={(value) => update({ sale: value === true ? "1" : null })}
          />
          <Label htmlFor="filter-sale" className="text-sm font-normal">
            On sale only
          </Label>
        </div>
      </div>

      {mode === "category" && (category?.children.length ?? 0) > 0 ? (
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Subcategory
          </Label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => update({ sub: null })}
              className={`rounded-full border px-3 py-1 text-xs ${
                !subcategorySlug ? "border-primary bg-primary/10 text-primary" : "border-border"
              }`}
            >
              All
            </button>
            {category?.children.map((child) => (
              <button
                key={child._id}
                type="button"
                onClick={() => update({ sub: child.slug })}
                className={`rounded-full border px-3 py-1 text-xs ${
                  subcategorySlug === child.slug
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border"
                }`}
              >
                {child.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode !== "brand" ? (
        <div className="space-y-2">
          <Label
            htmlFor="filter-brand"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Brand
          </Label>
          <select
            id="filter-brand"
            value={brandSlug}
            onChange={(event) => update({ brand: event.target.value || null })}
            className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="">All brands</option>
            {(brands ?? []).map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {(category?.attributeOptions ?? []).map((attribute) => (
        <div key={attribute.key} className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {attribute.label}
          </Label>
          <div className="flex flex-wrap gap-2">
            {attribute.values.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  update({
                    attr: attribute.key,
                    attrValue: attributeValue === value ? null : value,
                  })
                }
                className={`rounded-full border px-3 py-1 text-xs ${
                  attributeValue === value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      ))}

      {activeFilters.length > 0 ? (
        <Button variant="outline" className="w-full" onClick={() => setSearchParams({})}>
          Clear all filters
        </Button>
      ) : null}
    </div>
  );

  const items: ProductCardData[] = results?.items ?? [];

  return (
    <Container className="py-8">
      <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span>/</span>
        {mode === "category" && category ? (
          <>
            <Link to="/categories" className="hover:text-foreground">
              Categories
            </Link>
            <span>/</span>
            <span className="text-foreground">{category.name}</span>
          </>
        ) : (
          <span className="text-foreground">{heading}</span>
        )}
      </nav>

      <div className="mt-4">
        <SectionHeading title={heading} subtitle={subtitle} />
      </div>

      {mode === "category" && (category?.children.length ?? 0) > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {category?.children.map((child) => (
            <Link
              key={child._id}
              to={`/category/${category.slug}?sub=${child.slug}`}
              className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/50"
            >
              {child.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-32 rounded-xl border border-border bg-card p-5">
            <p className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal className="size-4" /> Filters
            </p>
            {filterPanel}
          </div>
        </aside>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {results === undefined
                ? "Loading products…"
                : `${results.total} product${results.total === 1 ? "" : "s"}`}
              {results?.scannedLimitReached
                ? " · showing the first batch of a very large result set"
                : ""}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 lg:hidden"
                onClick={() => setMobileFiltersOpen((value) => !value)}
              >
                <Filter className="size-3.5" /> Filters
              </Button>
              <select
                aria-label="Sort products"
                value={sort}
                onChange={(event) => update({ sort: event.target.value })}
                className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {activeFilters.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {activeFilters.map((filter) => (
                <button
                  key={filter.label}
                  type="button"
                  onClick={() => update(filter.clear)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-xs"
                >
                  {filter.label}
                  <X className="size-3" />
                </button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
                Clear
              </Button>
            </div>
          ) : null}

          {mobileFiltersOpen ? (
            <div className="mt-4 rounded-xl border border-border bg-card p-5 lg:hidden">
              {filterPanel}
            </div>
          ) : null}

          <div className="mt-6">
            {mode === "search" && term.length < 2 ? (
              <EmptyState
                icon={<PackageSearch className="size-5" />}
                title="Enter at least two characters"
                description="Search matches product names, SKUs, brands and categories."
              />
            ) : results === undefined ? (
              <LoadingBlock label="Loading products…" />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<PackageSearch className="size-5" />}
                title="No products matched"
                description="Try removing a filter, widening the price range or searching a different term."
                action={
                  <Button variant="outline" onClick={() => setSearchParams({})}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                  {items.map((product) => (
                    <ProductCard key={product._id} product={product} />
                  ))}
                </div>
                <Pagination
                  page={results.page}
                  totalPages={results.totalPages}
                  onChange={(next) => update({ page: String(next) })}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-10 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <StatusPill tone="info">Note</StatusPill>
          {BRAND.name} never displays fabricated ratings, reviews, discounts or stock levels.
          Badges only appear for data that exists in the catalog.
        </p>
      </div>
    </Container>
  );
}
