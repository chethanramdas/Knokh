import { useMutation, useQuery } from "@/lib/cloudflare-client";
import {
  AlertTriangle,
  Loader2,
  ShoppingBag,
  Tag,
  Trash2,
  Truck,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Container,
  EmptyState,
  InfoNote,
  LoadingBlock,
  QuantityStepper,
  SectionHeading,
} from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BRAND } from "@/lib/brand";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";

export default function Cart() {
  const { guestKey, currency, country, config, moneyLocal, cartCount } = useStore();
  const cart = useQuery(api.cart.getCart, {
    guestKey: guestKey || undefined,
    currency,
    countryCode: country,
  });
  const updateItem = useMutation(api.cart.updateCartItem);
  const removeItem = useMutation(api.cart.removeCartItem);
  const clearCart = useMutation(api.cart.clearCart);
  const applyCoupon = useMutation(api.cart.applyCoupon);
  const saveForLater = useMutation(api.cart.saveCartForLater);
  const [couponInput, setCouponInput] = useState("");
  const [busyLine, setBusyLine] = useState<string | null>(null);

  usePageMeta({ title: "Your cart", path: "/cart", noIndex: true, siteUrl: config?.seo.siteUrl });

  const changeQuantity = async (cartItemId: Id<"cart_items">, quantity: number) => {
    setBusyLine(String(cartItemId));
    try {
      await updateItem({ guestKey: guestKey || undefined, cartItemId, quantity });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the quantity.");
    } finally {
      setBusyLine(null);
    }
  };

  if (!guestKey) {
    return (
      <Container className="py-16">
        <LoadingBlock label="Preparing your cart…" />
      </Container>
    );
  }

  if (cart === undefined) {
    return (
      <Container className="py-16">
        <LoadingBlock label="Loading your cart…" />
      </Container>
    );
  }

  if (cart === null || cart.lines.length === 0) {
    return (
      <Container className="py-16">
        <EmptyState
          icon={<ShoppingBag className="size-5" />}
          title="Your cart is empty"
          description="Browse the catalog and add something you like. Items you add are saved for 30 days."
          action={
            <Button asChild>
              <Link to="/shop">Start shopping</Link>
            </Button>
          }
        />
      </Container>
    );
  }

  const zone = cart.shippingZone;

  return (
    <Container className="py-8">
      <SectionHeading
        title="Your cart"
        subtitle={`${cart.itemCount} item${cart.itemCount === 1 ? "" : "s"} · prices shown in ${cart.currency}`}
        action={
          <Button variant="ghost" size="sm" onClick={() => void clearCart({ guestKey })}>
            <Trash2 className="size-3.5" /> Empty cart
          </Button>
        }
      />

      {cart.blockers.length > 0 ? (
        <InfoNote tone="warning" className="mt-5">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" /> Please review before checkout
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {cart.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </InfoNote>
      ) : null}

      <div className="mt-6 grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {cart.lines.map((line) => (
            <div
              key={line.cartItemId}
              className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row"
            >
              <Link
                to={`/product/${line.slug}`}
                className="product-frame size-24 shrink-0 overflow-hidden rounded-lg border border-border"
              >
                {line.image ? (
                  <img src={line.image} alt={line.name} className="size-full object-cover" />
                ) : null}
              </Link>
              <div className="flex-1">
                <Link to={`/product/${line.slug}`} className="text-sm font-semibold hover:text-primary">
                  {line.name}
                </Link>
                {line.variantName ? (
                  <p className="text-xs text-muted-foreground">Option: {line.variantName}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">SKU {line.sku}</p>
                <p className="mt-1 text-sm font-medium">{moneyLocal(line.unitPriceMinor)} each</p>
                {line.issue ? (
                  <p className="mt-1 text-xs font-medium text-destructive">{line.issue}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {line.availableStock} in stock · delivery in about{" "}
                    {Math.max(line.deliveryEstimateDays, zone?.etaDays ?? 0)} days
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <QuantityStepper
                    value={line.quantity}
                    max={Math.max(1, Math.min(20, line.availableStock))}
                    disabled={busyLine === String(line.cartItemId)}
                    onChange={(next) => void changeQuantity(line.cartItemId as Id<"cart_items">, next)}
                    size="sm"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={async () => {
                      await removeItem({ guestKey, cartItemId: line.cartItemId as Id<"cart_items"> });
                      toast.success("Item removed from your cart.");
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <div className="text-right">
                <p className="text-base font-semibold">{moneyLocal(line.lineTotalMinor)}</p>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link to="/shop">Continue shopping</Link>
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await saveForLater({ guestKey });
                  toast.success("Cart saved. You can restore it from Saved carts.");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not save the cart.");
                }
              }}
            >
              Save for later
            </Button>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-semibold">Order summary</p>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{moneyLocal(cart.subtotalMinor)}</span>
              </div>
              {cart.discountMinor > 0 ? (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Coupon {cart.coupon.code}</span>
                  <span>−{moneyLocal(cart.discountMinor)}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {cart.taxInclusive ? `${cart.taxLabel} (included)` : "Tax"}
                </span>
                <span>{moneyLocal(cart.taxMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping estimate</span>
                <span>
                  {cart.shippingMinor === 0 ? "Free" : moneyLocal(cart.shippingMinor)}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Total</span>
                <span>{moneyLocal(cart.totalMinor)}</span>
              </div>
            </div>

            {cart.missingForFreeShippingBaseMinor > 0 && cart.freeShippingThresholdBaseMinor > 0 ? (
              <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                <Truck className="mt-0.5 size-3.5" />
                Add {moneyLocal(cart.missingForFreeShippingBaseMinor)} more to qualify for free
                standard delivery.
              </p>
            ) : null}

            <div className="mt-4">
              {cart.coupon.code && cart.coupon.valid ? (
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Tag className="size-3.5 text-primary" /> {cart.coupon.code} applied
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void applyCoupon({ guestKey, code: "" })}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                      await applyCoupon({ guestKey, code: couponInput });
                      setCouponInput("");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Could not apply the coupon.");
                    }
                  }}
                >
                  <Input
                    value={couponInput}
                    onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                    placeholder="Coupon code"
                    aria-label="Coupon code"
                  />
                  <Button type="submit" variant="outline">
                    Apply
                  </Button>
                </form>
              )}
              {cart.coupon.code && !cart.coupon.valid ? (
                <p className="mt-2 text-xs text-destructive">{cart.coupon.message}</p>
              ) : null}
            </div>

            <Button asChild size="lg" className="mt-5 w-full" disabled={cart.blockers.length > 0}>
              <Link to="/checkout">Proceed to checkout</Link>
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Final totals including shipping and tax are calculated on our server at checkout
              for {cart.shippingZone?.country ?? "your destination"}.
            </p>
          </div>

          <div className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Why the total can change</p>
            <p className="mt-1">
              Shipping depends on the destination country you select in the header, and taxes
              depend on the rules configured for that country. {BRAND.name} recalculates
              everything server-side so the price you see is the price you pay.
            </p>
          </div>
        </aside>
      </div>
    </Container>
  );
}
