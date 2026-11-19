import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatDeliveryRange } from "@/lib/format";

export function DeliveryEstimate({ pin, method = "standard" }: { pin: string; method?: string }) {
  const estimate = useQuery(
    api.checkout.deliveryEstimate,
    /^[1-9][0-9]{5}$/.test(pin.trim()) ? { pin: pin.trim(), method: method === "express" ? "express" : "standard" } : "skip",
  );
  let text = "Enter your six-digit Indian PIN code to check delivery.";
  if (estimate?.status === "available") text = `Estimated delivery ${formatDeliveryRange(estimate.range)}.`;
  if (estimate?.status === "unsupported") text = "This delivery option is unavailable for the PIN code.";
  if (estimate?.status === "unconfigured") text = "A delivery estimate is unavailable. Contact support for timing.";
  return <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">{text}</p>;
}
