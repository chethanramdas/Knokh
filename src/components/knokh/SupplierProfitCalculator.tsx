import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supplierContribution } from "@/convex/lib/money";
const fields = [
  ["sale", "Customer payment"],
  ["cost", "Supplier cost"],
  ["shipping", "Supplier shipping"],
  ["fees", "Payment / COD fees"],
  ["reserve", "Returns / RTO reserve"],
  ["tax", "Tax to remit"],
] as const;
export function SupplierProfitCalculator() {
  const [values, setValues] = useState<Record<string, string>>({});
  const amounts = fields.map(([key]) => {
    const n = Number(values[key] || 0);
    return n >= 0 && Number.isFinite(n) ? Math.round(n * 100) : NaN;
  });
  let result: ReturnType<typeof supplierContribution> | null = null;
  try {
    result = supplierContribution(
      amounts[0],
      amounts[1],
      amounts[2],
      amounts[3],
      amounts[4],
      amounts[5],
    );
  } catch {
    /* Invalid input is reported inline. */
  }
  return (
    <section
      className="rounded-xl border border-border bg-card p-5"
      aria-labelledby="supplier-profit-heading"
    >
      <h2 id="supplier-profit-heading" className="text-sm font-semibold">
        INR contribution calculator
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Estimate one order using your actual costs. Includes no subscription.
        Advertising, income tax and other overheads are excluded. This estimate
        does not change prices.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {fields.map(([key, label]) => (
          <div key={key}>
            <Label htmlFor={`profit-${key}`}>{label} (₹)</Label>
            <Input
              id={`profit-${key}`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={values[key] ?? ""}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm" aria-live="polite">
        {result
          ? `Estimated contribution: ₹${(result.contributionMinor / 100).toFixed(2)} · margin ${result.marginPercent.toFixed(1)}%`
          : "Enter valid non-negative amounts."}
      </p>
    </section>
  );
}
