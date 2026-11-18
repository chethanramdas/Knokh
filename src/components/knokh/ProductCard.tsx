import { useMutation } from "convex/react";
import { Heart, Loader2, ShoppingCart } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cartErrorMessage } from "@/lib/cartErrors";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import type { ProductCardData } from "@/lib/types";
import { DiscountBadge, PriceTag, StarRating } from "./ui";

/**
 * Product card. Discount and rating badges only render when the underlying data
 * is real: a discount needs a genuine compare-at price, and a rating needs
 * approved customer reviews.
 */
export function ProductCard({
  product,
  className,
}: {
  product: ProductCardData;
  className?: string;
}) {
  const { guestKey, money, isWishlisted, toggleWishlist, zone, currency } = useStore();
  const addToCart = useMutation(api.cart.addToCart);
  const navigate = useNavigate();
  const [isAdding, setIsAdding] = useState(false);
  const adding = useRef(false);
  const wished = isWishlisted(String(product._id));

  const shipNote = zone
    ? `Delivery in about ${Math.max(product.deliveryEstimateDays, zone.etaDays)} days`
    : `Delivery in about ${product.deliveryEstimateDays} days`;

  const handleAdd = async () => {
    if (product.hasVariants) {
      navigate(`/product/${product.slug}`);
      return;
    }
    if (adding.current || !guestKey) return;
    adding.current = true;
    setIsAdding(true);
    try {
      const result = await addToCart({
        guestKey,
        currency,
        productId: product._id as Id<"products">,
        quantity: 1,
      });
      toast.success(`${product.name} added to your cart.`, {
        description: result.capped
          ? "Quantity was limited to the stock we hold."
          : undefined,
      });
    } catch (error) {
      toast.error(
        cartErrorMessage(error, "Could not add this item to your cart. Please try again."),
      );
    } finally {
      adding.current = false;
      setIsAdding(false);
    }
  };

  return (
    <article
      className={cn(
        "knokh-product-card group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40",
        className,
      )}
    >
      <div className="relative">
        <Link to={`/product/${product.slug}`} className="block product-frame">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
              No image
            </div>
          )}
        </Link>
        <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
          <DiscountBadge percent={product.discountPercent} />
          {product.isDemo ? (
            <span className="rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Sample
            </span>
          ) : null}
          {!product.inStock ? (
            <span className="rounded-full bg-foreground/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">
              Out of stock
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={wished ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
          className="absolute right-3 top-3 size-9 rounded-full border border-border bg-background/90 backdrop-blur"
          onClick={() => void toggleWishlist(product._id as Id<"products">, product.name)}
        >
          <Heart className={cn("size-4", wished && "fill-destructive text-destructive")} />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link
          to={`/product/${product.slug}`}
          className="line-clamp-2 text-sm font-semibold leading-snug hover:text-primary"
        >
          {product.name}
        </Link>
        <StarRating value={product.ratingAvg} count={product.ratingCount} />
        <PriceTag priceMinor={product.priceMinor} compareAtMinor={product.compareAtMinor} />
        <p className="text-xs text-muted-foreground">
          {product.inStock ? shipNote : "Currently unavailable"}
          {product.hasVariants ? ` · ${product.variantCount} options` : ""}
        </p>
        <div className="knokh-product-actions mt-auto flex gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            className="flex-1"
            disabled={isAdding || !guestKey || !product.inStock}
            onClick={() => void handleAdd()}
          >
            {isAdding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ShoppingCart className="size-4" />
            )}
            {product.hasVariants ? "Choose options" : "Add to cart"}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/product/${product.slug}`} aria-label={`View ${product.name}`}>
              View
            </Link>
          </Button>
        </div>
        {product.inStock ? (
          <p className="sr-only">
            {product.stock} in stock at {money(product.priceMinor)}
          </p>
        ) : null}
      </div>
    </article>
  );
}
