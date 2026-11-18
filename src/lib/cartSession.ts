/** Match the server's guest ownership boundary; never reuse malformed stored values. */
export function isValidCartSessionKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(value);
}

type SessionStorage = Pick<Storage, "getItem" | "setItem">;

/** Retain an in-memory session if browser storage is unavailable. */
export function createCartSession(
  storage: () => SessionStorage | null,
  storageKey: string,
  generate: () => string,
) {
  let current: string | undefined;
  return () => {
    let saved: string | null = null;
    try { saved = storage()?.getItem(storageKey) ?? null; } catch { /* Private mode. */ }
    if (isValidCartSessionKey(saved)) current = saved;
    if (!current) current = generate();
    if (!isValidCartSessionKey(current)) throw new Error("Could not initialize your cart session.");
    try { storage()?.setItem(storageKey, current); } catch { /* Keep the memory session. */ }
    return current;
  };
}
