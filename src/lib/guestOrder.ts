export function rememberGuestOrder(orderId: string, guestToken: string | undefined) {
  if (guestToken) sessionStorage.setItem(`knokh:guest-order:${orderId}`, guestToken);
}

export function guestOrderToken(orderId: string) {
  return sessionStorage.getItem(`knokh:guest-order:${orderId}`) ?? undefined;
}
