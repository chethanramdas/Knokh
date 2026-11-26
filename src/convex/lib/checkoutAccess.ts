import type { Doc } from "../_generated/dataModel";
import { hmacHex, safeEqual } from "./hmac";

export function guestCheckoutSecret() {
  const secret = process.env.KNOKH_GUEST_CHECKOUT_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
}

export function guestOrderToken(
  order: Pick<Doc<"orders">, "_id" | "cartOwnerKey">,
  secret: string,
) {
  return hmacHex(
    secret,
    `knokh:guest-order:${order._id}:${order.cartOwnerKey}`,
  );
}

export function canViewOrder(
  order: Doc<"orders">,
  user: Doc<"users"> | null,
  guestToken?: string,
) {
  if (user?.role === "admin") return true;
  if (order.userId) return order.userId === user?._id;
  if (
    !guestToken ||
    !order.guestAccessExpiresAt ||
    Date.now() >= order.guestAccessExpiresAt
  ) {
    return false;
  }
  const secret = guestCheckoutSecret();
  return !!secret && safeEqual(guestOrderToken(order, secret), guestToken);
}
