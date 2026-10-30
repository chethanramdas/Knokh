import { useMutation, useQuery } from "@/lib/cloudflare-client";
import {
  Check,
  ChevronRight,
  Heart,
  Loader2,
  MapPin,
  RotateCcw,
  ShieldCheck,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ProductCard } from "@/components/knokh/ProductCard";
import {
  Container,
  EmptyState,
  InfoNote,
  PriceTag,
  QuantityStepper,
  SectionHeading,
  StarRating,
  StatusPill,
} from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { productJsonLd, usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export default function ProductDetail() {
  const { slug = "" } = useParams();
  const { guestKey, money, isWishlisted, toggleWishlist, zone, config, country } =
    useStore();
  const result = useQuery(api.catalog.getProductBySlug, { slug });
  const recordView = useMutation(api.catalog.recordProductView);
  const addToCart = useMutation(api.cart.addToCart);
  const submitReview = useMutation(api.orders.submitReview);
  const { isAuthenticated } = useAuth();

  const [variantSku, setVariantSku] = useState<string | undefined>(undefined);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [isAdding, setIsAdding] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  const product = result?.product;

  useEffect(() => {
    if (!product) return;
    setVariantSku(product.variants[0]?.sku);
    setActiveImage(0);
    setQuantity(1);
  }, [product?._id, product?.variants.length]);

  useEffect(() => {
    if (!slug) return;
    void recordView({ slug, guestKey: guestKey || undefined });
  }, [slug, guestKey, recordView]);

  usePageMeta({
    title: product
      ? product.seoTitle ?? `${product.name} — buy online`
      : "Product",
    description: product?.seoDescription ?? product?.summary,
    path: `/product/${slug}`,
    siteUrl: config?.seo.siteUrl,
    image: product?.image,
    jsonLd: product
      ? productJsonLd({
          name: product.name,
          description: product.summary ?? product.description,
          sku: product.sku,
          image: product.image,
          priceMinor: product.priceMinor,
          currency: product.currency,
          inStock: product.inStock,
          siteUrl: config?.seo.siteUrl,
          path: `/product/${slug}`,
          ratingAvg: product.ratingAvg,
          ratingCount: product.ratingCount,
          brandName: result?.brand?.name,
        })
      : null,
  });

  const related = useQuery(
    api.catalog.getRelatedProducts,
    product ? { productId: product._id as Id<"products">, limit: 8 } : "skip",
  );

  const selectedVariant = useMemo(
    () => product?.variants.find((variant) => variant.sku === variantSku),
    [product, variantSku],
  );

  if (result === undefined) {
    return (
      <Container className="flex items-center justify-center gap-2 py-32 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading product…
      </Container>
    );
  }

  if (result === null || !product) {
    return (
      <Container className="py-20">
        <EmptyState
          title="This product is no longer available"
          description="It may have been removed or unpublished. Browse the catalog for something similar."
          action={
            <Button asChild>
              <Link to="/shop">Browse all products</Link>
            </Button>
          }
        />
      </Container>
    );
  }

  const availableStock = selectedVariant ? selectedVariant.stock : product.stock;
  const unitPriceMinor = selectedVariant?.priceMinor ?? product.priceMinor;
  const unitCompareAtMinor = selectedVariant?.compareAtMinor ?? product.compareAtMinor;
  const inStock = availableStock > 0 && product.status === "published";
  const shipsHere = product.shipsTo.length === 0 || product.shipsTo.includes(country);
  const wished = isWishlisted(String(product._id));

  const handleAdd = async () => {
    setIsAdding(true);
    try {
      await addToCart({
        productId: product._id as Id<"products">,
        variantSku,
        quantity,
      });
      toast.success(`${product.name} added to your cart.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add to cart.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleReview = async (event: React.FormEvent) => {
    event.preventDefault();
    setReviewBusy(true);
    try {
      await submitReview({
        productId: product._id as Id<"products">,
        rating: reviewRating,
        title: reviewTitle || undefined,
        body: reviewBody || undefined,
      });
      toast.success("Thanks — your review is awaiting moderation.");
      setReviewTitle("");
      setReviewBody("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit the review.");
    } finally {
      setReviewBusy(false);
    }
  };

  const specs = [
    ...(result.brand ? [{ label: "Brand", value: result.brand.name }] : []),
    ...(result.category ? [{ label: "Category", value: result.category.name }] : []),
    ...(result.subcategory ? [{ label: "Subcategory", value: result.subcategory.name }] : []),
    { label: "SKU", value: product.sku },
    ...(product.weightGrams
      ? [{ label: "Weight", value: `${(product.weightGrams / 1000).toFixed(2)} kg` }]
      : []),
    ...(product.dimensions
      ? [
          {
            label: "Dimensions",
            value: `${product.dimensions.lengthCm} × ${product.dimensions.widthCm} × ${product.dimensions.heightCm} cm`,
          },
        ]
      : []),
    ...product.specs,
  ];

  return (
    <Container className="py-8">
      <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <ChevronRight className="size-3" />
        <Link to="/shop" className="hover:text-foreground">
          Shop
        </Link>
        {result.category ? (
          <>
            <ChevronRight className="size-3" />
            <Link to={`/category/${result.category.slug}`} className="hover:text-foreground">
              {result.category.name}
            </Link>
          </>
        ) : null}
        <ChevronRight className="size-3" />
        <span className="line-clamp-1 text-foreground">{product.name}</span>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <div>
          <div className="product-frame rounded-xl border border-border">
            {product.images[activeImage]?.url || product.image ? (
              <img
                src={product.images[activeImage]?.url ?? product.image}
                alt={product.name}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
                No image provided
              </div>
            )}
          </div>
          {product.images.length > 1 ? (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {product.images.slice(0, 5).map((image, index) => (
                <button
                  key={image.url}
                  type="button"
                  onClick={() => setActiveImage(index)}
                  className={cn(
                    "product-frame overflow-hidden rounded-lg border",
                    index === activeImage ? "border-primary" : "border-border",
                  )}
                  aria-label={`Show image ${index + 1}`}
                >
                  <img src={image.url} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            {product.discountPercent ? (
              <StatusPill tone="warning">{product.discountPercent}% off</StatusPill>
            ) : null}
            {product.isDemo ? <StatusPill tone="neutral">Sample catalog item</StatusPill> : null}
            {inStock ? (
              <StatusPill tone="success">
                <Check className="mr-1 size-3" /> In stock
              </StatusPill>
            ) : (
              <StatusPill tone="danger">Out of stock</StatusPill>
            )}
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{product.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StarRating value={product.ratingAvg} count={product.ratingCount} />
            {result.brand ? (
              <Link
                to={`/brand/${result.brand.slug}`}
                className="text-sm text-primary hover:underline"
              >
                {result.brand.name}
              </Link>
            ) : null}
            <span className="text-xs text-muted-foreground">SKU {product.sku}</span>
          </div>

          <div className="mt-5 rounded-xl border border-border bg-card p-5">
            <PriceTag
              priceMinor={unitPriceMinor}
              compareAtMinor={unitCompareAtMinor}
              size="lg"
            />
            {config?.taxRules.find((rule) => rule.countryCode === country)?.inclusive ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Inclusive of{" "}
                {config?.taxRules.find((rule) => rule.countryCode === country)?.label}.
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Taxes are calculated at checkout for your destination.
              </p>
            )}

            {product.variants.length > 0 ? (
              <div className="mt-5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Options
                </Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {product.variants.map((variant) => (
                    <button
                      key={variant.sku}
                      type="button"
                      disabled={variant.stock <= 0}
                      onClick={() => setVariantSku(variant.sku)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm transition-colors",
                        variant.sku === variantSku
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-primary/40",
                        variant.stock <= 0 && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="font-medium">{variant.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {variant.stock > 0 ? money(variant.priceMinor) : "Sold out"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <QuantityStepper
                value={quantity}
                onChange={setQuantity}
                max={Math.max(1, Math.min(20, availableStock))}
                disabled={!inStock}
              />
              <Button
                size="lg"
                className="flex-1 gap-2"
                disabled={!inStock || isAdding || !shipsHere}
                onClick={() => void handleAdd()}
              >
                {isAdding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShoppingCart className="size-4" />
                )}
                {inStock ? "Add to cart" : "Out of stock"}
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="gap-2"
                onClick={() => void toggleWishlist(product._id as Id<"products">, product.name)}
              >
                <Heart className={cn("size-4", wished && "fill-destructive text-destructive")} />
                Save
              </Button>
            </div>
            {!shipsHere ? (
              <InfoNote tone="warning" className="mt-4">
                This product is currently not shipped to {country}. Choose a different
                destination country in the header or contact support.
              </InfoNote>
            ) : null}
            {availableStock > 0 && availableStock <= 5 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Only {availableStock} left in stock at this price.
              </p>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <Truck className="size-4 text-primary" /> Delivery estimate
              </p>
              <p className="mt-1 text-muted-foreground">
                {zone
                  ? `${Math.max(product.deliveryEstimateDays, zone.etaDays)} days to ${zone.country}`
                  : `${product.deliveryEstimateDays} days`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Duties and taxes are not prepaid unless stated at checkout.
              </p>
            </div>
            <div className="rounded-xl border border-border p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <RotateCcw className="size-4 text-primary" /> Returns
              </p>
              <p className="mt-1 text-muted-foreground">
                Return requests can be raised from your order page once the parcel is
                shipped.
              </p>
              <Link to="/info/returns-refunds" className="mt-1 inline-block text-xs text-primary">
                Read the returns policy
              </Link>
            </div>
          </div>

          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="size-3.5" />
            Ships to: {product.shipsTo.length > 0 ? product.shipsTo.join(", ") : "configured destinations"}
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Payments are verified on our server. Card details never touch KNOKH servers.
          </p>
        </div>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-bold tracking-tight">Description</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {product.description ?? product.summary ?? "No description has been added yet."}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold tracking-tight">Specifications</h2>
            <dl className="mt-3 divide-y divide-border rounded-xl border border-border">
              {specs.map((spec) => (
                <div key={spec.label} className="flex gap-4 px-4 py-3 text-sm">
                  <dt className="w-40 shrink-0 text-muted-foreground">{spec.label}</dt>
                  <dd className="font-medium">{spec.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h2 className="text-lg font-bold tracking-tight">
              Customer reviews
              {result.reviews.length > 0 ? ` (${result.reviews.length})` : ""}
            </h2>
            {result.reviews.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No approved reviews yet. KNOKH only publishes reviews that have been
                submitted by a signed-in customer and approved by an administrator.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {result.reviews.map((review) => (
                  <li key={review._id} className="rounded-xl border border-border p-4">
                    <StarRating value={review.rating} count={1} />
                    {review.title ? (
                      <p className="mt-2 text-sm font-semibold">{review.title}</p>
                    ) : null}
                    {review.body ? (
                      <p className="mt-1 text-sm text-muted-foreground">{review.body}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {result.reviewsEnabled ? (
              isAuthenticated ? (
                <form onSubmit={handleReview} className="mt-5 space-y-3 rounded-xl border border-border p-4">
                  <p className="text-sm font-semibold">Write a review</p>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setReviewRating(star)}
                        aria-label={`Rate ${star} out of 5`}
                        className={cn(
                          "size-8 rounded-full border text-sm font-semibold",
                          reviewRating >= star
                            ? "border-accent bg-accent text-accent-foreground"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {star}
                      </button>
                    ))}
                  </div>
                  <Input
                    placeholder="Review title (optional)"
                    value={reviewTitle}
                    onChange={(event) => setReviewTitle(event.target.value)}
                  />
                  <Textarea
                    placeholder="What did you think of this product?"
                    value={reviewBody}
                    onChange={(event) => setReviewBody(event.target.value)}
                    rows={4}
                  />
                  <Button type="submit" disabled={reviewBusy}>
                    {reviewBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                    Submit for moderation
                  </Button>
                </form>
              ) : (
                <InfoNote className="mt-5">
                  <Link to="/auth" className="font-semibold text-primary hover:underline">
                    Sign in
                  </Link>{" "}
                  to review a product you have purchased.
                </InfoNote>
              )
            ) : null}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="font-semibold">Shipping & returns</p>
            <ul className="mt-2 space-y-2 text-muted-foreground">
              <li>
                Delivery estimate: {product.deliveryEstimateDays} days dispatch, plus
                transit time for your destination.
              </li>
              <li>Tracked delivery where the supplier provides tracking.</li>
              <li>
                Return window and conditions are set out in the returns policy you can
                read before ordering.
              </li>
            </ul>
            <Button asChild variant="outline" className="mt-3 w-full">
              <Link to="/info/shipping-policy">Shipping policy</Link>
            </Button>
          </div>
        </aside>
      </div>

      {(related ?? []).length > 0 ? (
        <section className="mt-14">
          <SectionHeading
            title="You may also like"
            subtitle="Related products from the same category."
          />
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {(related ?? []).map((item) => (
              <ProductCard key={item._id} product={item} />
            ))}
          </div>
        </section>
      ) : null}
    </Container>
  );
}
