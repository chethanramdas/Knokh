import { useQuery } from "@/lib/cloudflare-client";
import {
  ArrowRight,
  BadgeCheck,
  Loader2,
  Package,
  RotateCcw,
  Search,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "@/convex/_generated/api";
import { ProductCard } from "@/components/knokh/ProductCard";
import { Container, EmptyState, SectionHeading } from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BRAND } from "@/lib/brand";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";
import type { ProductCardData } from "@/lib/types";

const TRUST = [
  {
    icon: Truck,
    title: "Delivery estimates you can see",
    body: "Every product shows a delivery window based on your destination country before you commit.",
  },
  {
    icon: ShieldCheck,
    title: "Server-verified payments",
    body: "Totals are calculated on the server and every gateway webhook is signature-verified before an order is confirmed.",
  },
  {
    icon: RotateCcw,
    title: "Published return policy",
    body: "Returns and refunds follow the written policy in our help centre — no hidden conditions.",
  },
  {
    icon: BadgeCheck,
    title: "Real stock, real prices",
    body: "Availability and pricing come from our own catalog database. No invented ratings or sales figures.",
  },
];

function Hero({
  section,
  featuredCategories,
}: {
  section?: { title: string; subtitle?: string; ctaLabel?: string; ctaHref?: string };
  featuredCategories: { _id: string; name: string; slug: string; image?: string }[];
}) {
  const { config, zone } = useStore();
  const [term, setTerm] = useState("");
  return (
    <section className="border-b border-border bg-secondary/50">
      <Container className="grid gap-10 py-12 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            {BRAND.tagline}
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
            {section?.title ?? "Discover More. Shop Smarter."}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            {section?.subtitle ??
              "A curated multi-category marketplace with transparent pricing and delivery. Browse electronics, fashion, home, beauty, fitness, toys, travel, office and automotive products."}
          </p>
          <form
            className="mt-6 flex max-w-xl gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const query = term.trim();
              if (query) window.location.assign(`/search?q=${encodeURIComponent(query)}`);
            }}
            role="search"
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="What are you looking for today?"
                aria-label="Search the catalog"
                className="h-12 pl-9"
              />
            </div>
            <Button type="submit" size="lg" className="h-12">
              Search
            </Button>
          </form>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="default">
              <Link to={section?.ctaHref ?? "/shop"}>
                {section?.ctaLabel ?? "Shop all products"} <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/categories">Browse categories</Link>
            </Button>
          </div>
          <dl className="mt-8 grid max-w-lg grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Categories</dt>
              <dd className="text-lg font-bold">11+</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Ships to</dt>
              <dd className="text-lg font-bold">
                {(config?.shippingZones ?? []).filter((entry) => entry.serviceable).length} countries
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Standard delivery</dt>
              <dd className="text-lg font-bold">
                {zone ? `${zone.etaDays} days` : "confirmed at checkout"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {featuredCategories.slice(0, 4).map((category) => (
              <Link
                key={category._id}
                to={`/category/${category.slug}`}
                className="group overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="product-frame">
                  {category.image ? (
                    <img
                      src={category.image}
                      alt={category.name}
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <Package className="size-6" />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-semibold leading-snug">{category.name}</p>
                  <p className="text-xs text-muted-foreground">Shop now</p>
                </div>
              </Link>
            ))}
        </div>
      </Container>
    </section>
  );
}

function ProductRow({
  title,
  subtitle,
  items,
  ctaLabel,
  ctaHref,
  emptyHint,
}: {
  title: string;
  subtitle?: string;
  items: ProductCardData[];
  ctaLabel?: string;
  ctaHref?: string;
  emptyHint?: string;
}) {
  return (
    <section className="py-10">
      <Container>
        <SectionHeading
          title={title}
          subtitle={subtitle}
          action={
            ctaHref && ctaLabel ? (
              <Button asChild variant="outline" size="sm">
                <Link to={ctaHref}>
                  {ctaLabel} <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            ) : undefined
          }
        />
        <div className="mt-6">
          {items.length === 0 ? (
            <EmptyState
              title="Nothing to show here yet"
              description={
                emptyHint ??
                "Products will appear here as soon as they are published in the admin dashboard."
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((product) => (
                <ProductCard key={product._id} product={product} />
              ))}
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}

export default function Home() {
  const data = useQuery(api.catalog.getHomeData);
  const featuredCategories = useQuery(api.catalog.listCategories, { withCounts: true });
  const { config, guestKey } = useStore();
  const recentlyViewed = useQuery(
    api.catalog.getRecentlyViewed,
    guestKey ? { guestKey, limit: 4 } : "skip",
  );

  usePageMeta({
    title: BRAND.homeTitle,
    description: config?.seo.defaultDescription,
    path: "/",
    siteUrl: config?.seo.siteUrl,
  });

  const sections = useMemo(() => data?.sections ?? [], [data]);

  if (data === undefined) {
    return (
      <Container className="flex items-center justify-center gap-2 py-32 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading the KNOKH storefront…
      </Container>
    );
  }

  return (
    <>
      {sections.map((section) => {
        switch (section.type) {
          case "hero":
            return (
              <Hero
                key={section.id}
                section={section}
                featuredCategories={(featuredCategories ?? []).filter(
                  (category) => category.featured,
                )}
              />
            );
          case "category_grid":
            return (
              <section key={section.id} className="py-10">
                <Container>
                  <SectionHeading
                    title={section.title}
                    subtitle={section.subtitle}
                    action={
                      <Button asChild variant="outline" size="sm">
                        <Link to="/categories">
                          All categories <ArrowRight className="size-3.5" />
                        </Link>
                      </Button>
                    }
                  />
                  <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {data.categories.map((category) => (
                      <Link
                        key={category._id}
                        to={`/category/${category.slug}`}
                        className="group overflow-hidden rounded-xl border border-border bg-card text-center"
                      >
                        <div className="product-frame">
                          {category.image ? (
                            <img
                              src={category.image}
                              alt={category.name}
                              loading="lazy"
                              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center text-muted-foreground">
                              <Package className="size-6" />
                            </div>
                          )}
                        </div>
                        <p className="p-3 text-left text-xs font-semibold leading-snug">
                          {category.name}
                        </p>
                      </Link>
                    ))}
                  </div>
                </Container>
              </section>
            );
          case "product_row": {
            const row = data.rows[section.id];
            if (!row) return null;
            return (
              <ProductRow
                key={section.id}
                title={row.title}
                subtitle={row.subtitle}
                items={row.items}
                ctaLabel={row.ctaLabel}
                ctaHref={row.ctaHref}
                emptyHint={
                  section.source === "best_sellers"
                    ? "Best sellers are ranked from real completed orders — this list stays empty until your first sales."
                    : undefined
                }
              />
            );
          }
          case "promo_banner":
            return (
              <section key={section.id} className="py-10">
                <Container>
                  <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-primary px-6 py-8 text-primary-foreground sm:flex-row sm:items-center sm:justify-between sm:px-10">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                        {section.title}
                      </h2>
                      {section.subtitle ? (
                        <p className="mt-1 max-w-xl text-sm opacity-90">{section.subtitle}</p>
                      ) : null}
                    </div>
                    {section.ctaHref ? (
                      <Button asChild variant="secondary" size="lg">
                        <Link to={section.ctaHref}>
                          {section.ctaLabel ?? "Explore"} <ArrowRight className="size-4" />
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </Container>
              </section>
            );
          case "trust_badges":
            return (
              <section key={section.id} className="py-10">
                <Container>
                  <SectionHeading title={section.title} subtitle={section.subtitle} />
                  <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {TRUST.map((item) => (
                      <div key={item.title} className="rounded-xl border border-border bg-card p-5">
                        <item.icon className="size-5 text-primary" />
                        <p className="mt-3 text-sm font-semibold">{item.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                      </div>
                    ))}
                  </div>
                </Container>
              </section>
            );
          case "collection_row":
            return data.collections.length === 0 ? null : (
              <section key={section.id} className="py-10">
                <Container>
                  <SectionHeading title={section.title} subtitle={section.subtitle} />
                  <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {data.collections.map((collection) => (
                      <Link
                        key={collection._id}
                        to={`/collections/${collection.slug}`}
                        className="group overflow-hidden rounded-xl border border-border bg-card"
                      >
                        <div className="aspect-[16/9] overflow-hidden bg-muted">
                          {collection.image ? (
                            <img
                              src={collection.image}
                              alt={collection.name}
                              loading="lazy"
                              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          ) : null}
                        </div>
                        <div className="p-4">
                          <p className="font-semibold">{collection.name}</p>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {collection.description ?? "Curated by the KNOKH team."}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </Container>
              </section>
            );
          case "brand_strip":
            return data.brands.length === 0 ? null : (
              <section key={section.id} className="py-10">
                <Container>
                  <SectionHeading title={section.title} />
                  <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {data.brands.map((brand) => (
                      <Link
                        key={brand._id}
                        to={`/brand/${brand.slug}`}
                        className="flex h-20 items-center justify-center rounded-xl border border-border bg-card text-sm font-semibold hover:border-primary/40"
                      >
                        {brand.name}
                      </Link>
                    ))}
                  </div>
                </Container>
              </section>
            );
          case "recently_viewed":
            return (recentlyViewed?.length ?? 0) === 0 ? null : (
              <ProductRow
                key={section.id}
                title={section.title}
                items={recentlyViewed ?? []}
              />
            );
          case "newsletter":
            return (
              <section key={section.id} className="py-10">
                <Container>
                  <div className="rounded-2xl border border-border bg-secondary/60 px-6 py-8 sm:px-10">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-lg font-bold tracking-tight">{section.title}</h2>
                        <p className="text-sm text-muted-foreground">
                          No spam — new arrivals, genuine offers and buying guides only.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline">
                          <Link to="/info/faq">Read the FAQ</Link>
                        </Button>
                        <Button asChild>
                          <Link to="/shop">Start shopping</Link>
                        </Button>
                      </div>
                    </div>
                    <p className="mt-4 text-xs text-muted-foreground">
                      Newsletter consent is collected in the footer form. Subscribers can
                      unsubscribe at any time.
                    </p>
                  </div>
                </Container>
              </section>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
