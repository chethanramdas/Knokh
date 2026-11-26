const inMemory = new Map<string, string>();

export function keepGuestOrderToken(orderId: string, token: string) {
  inMemory.set(orderId, token);
  try {
    sessionStorage.setItem(`knokh-order:${orderId}`, token);
  } catch {
    // The current tab can still use the in-memory token.
  }
}

export function readGuestOrderToken(orderId: string) {
  try {
    return (
      sessionStorage.getItem(`knokh-order:${orderId}`) ?? inMemory.get(orderId)
    );
  } catch {
    return inMemory.get(orderId);
  }
}
