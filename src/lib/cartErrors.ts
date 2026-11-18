import { ConvexError } from "convex/values";

/** Only intentional public errors are displayed; transport errors do not expose internals. */
export function cartErrorMessage(error: unknown, fallback = "Could not update your cart. Please try again."): string {
  return error instanceof ConvexError && typeof error.data === "string" ? error.data : fallback;
}
