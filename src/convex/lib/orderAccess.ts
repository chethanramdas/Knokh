import type { Doc } from "../_generated/dataModel";
import { safeEqual, sha256, toHex, utf8Bytes } from "./hmac";

export function hashOrderToken(token: string) {
  return toHex(sha256(utf8Bytes(token)));
}

export function canAccessOrder(
  order: Doc<"orders">,
  user: Doc<"users"> | null,
  guestToken?: string,
) {
  if (user?.role === "admin" || (order.userId && order.userId === user?._id)) return true;
  if (order.userId) return false;
  return Boolean(
    guestToken && /^[0-9a-f-]{36}$/.test(guestToken) &&
    order.guestAccessExpiresAt && Date.now() < order.guestAccessExpiresAt &&
    order.guestAccessHash && safeEqual(hashOrderToken(guestToken), order.guestAccessHash),
  );
}
