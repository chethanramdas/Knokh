import { useQuery } from "@/lib/cloudflare-client";
import { Layers, PackageSearch } from "lucide-react";
import { Link } from "react-router";
import { api } from "@/convex/_generated/api";
import { Container, EmptyState, LoadingBlock, SectionHeading } from "@/components/knokh/ui";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";

/** Category index — every category and subcategory in one place. */
export function CategoriesIndex() {
  const categories = useQuery(api.catalog.listCategories, {});
  const { config } = useStore();
  usePageMeta({
    title: "All categories",
    description:
      "Browse every KNOKH category and subcategory — electronics, fashion, home, beauty, fitness, toys, travel, office and automotive.",
    path: "/categories",
    siteUrl: config?.seo.siteUrl,
  });

  const roots = (categories ?? []).filter((category) => !category.parentId);
  const childrenOf = (id: string) =>
    (categories ?? []).filter((category) => category.parentId === id);

  return (
    <Container className="py-10">
      <SectionHeading
        title="Shop by category"
        subtitle="Every product in the catalog belongs to a category and, where relevant, a subcategory."
      />

      {categories === undefined ? (
        <LoadingBlock />
      ) : roots.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-5" />}
          title="No categories yet"
          description="Categories will appear here once the catalog has been set up."
          action={
            <Link to="/shop" className="text-sm font-medium text-primary hover:underline">
              Browse all products →
            </Link>
          }
        />
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {roots.map((category) => (
            <div key={category._id} className="rounded-xl border border-border bg-card p-5">
              <Link
                to={`/category/${category.slug}`}
                className="group flex items-start gap-3"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                  <PackageSearch className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold group-hover:text-primary">
                    {category.name}
                  </span>
                  {category.description ? (
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {category.description}
                    </span>
                  ) : null}
                </span>
              </Link>
              {childrenOf(category._id).length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                  {childrenOf(category._id).map((child) => (
                    <li key={child._id}>
                      <Link
                        to={`/category/${child.slug}`}
                        className="inline-block rounded-full border border-border px-3 py-1 hover:border-primary hover:text-primary"
                      >
                        {child.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Container>
  );
}

/** Collection index — curated sets that span categories. */
export function CollectionsIndex() {
  const collections = useQuery(api.catalog.listCollections, {});
  const { config } = useStore();
  usePageMeta({
    title: "Collections",
    description: "Curated KNOKH collections selected by our buying team.",
    path: "/collections",
    siteUrl: config?.seo.siteUrl,
  });

  return (
    <Container className="py-10">
      <SectionHeading
        title="Featured collections"
        subtitle="Curated groups of products that span multiple categories."
      />
      {collections === undefined ? (
        <LoadingBlock />
      ) : collections.length === 0 ? (
        <EmptyState
          title="No collections yet"
          description="Collections are created by the store team and appear here when published."
        />
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <Link
              key={collection._id}
              to={`/collections/${collection.slug}`}
              className="group overflow-hidden rounded-xl border border-border bg-card"
            >
              {collection.image ? (
                <img
                  src={collection.image}
                  alt={collection.name}
                  className="h-40 w-full object-cover"
                  loading="lazy"
                  onError={(event) => {
                    // A broken remote image must never break the layout.
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <div className="flex h-40 items-center justify-center bg-muted text-muted-foreground">
                  <Layers className="size-6" />
                </div>
              )}
              <div className="p-5">
                <p className="font-semibold group-hover:text-primary">{collection.name}</p>
                {collection.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{collection.description}</p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {collection.productIds.length} products
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Container>
  );
}
