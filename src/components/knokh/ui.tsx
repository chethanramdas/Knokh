import { Loader2, Minus, Plus, Star } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";

export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)}>
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
        {subtitle ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
      {icon ? (
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-semibold">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

const STATUS_TONES: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  danger: "bg-destructive/12 text-destructive",
  info: "bg-primary/10 text-primary",
};

export function StatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof STATUS_TONES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        STATUS_TONES[tone] ?? STATUS_TONES.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PriceTag({
  priceMinor,
  compareAtMinor,
  size = "md",
  className,
}: {
  priceMinor: number;
  compareAtMinor?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { money } = useStore();
  const hasDiscount = Boolean(compareAtMinor && compareAtMinor > priceMinor);
  return (
    <span className={cn("flex flex-wrap items-baseline gap-2", className)}>
      <span
        className={cn(
          "font-semibold tracking-tight",
          size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base",
        )}
      >
        {money(priceMinor)}
      </span>
      {hasDiscount ? (
        <span
          className={cn(
            "text-muted-foreground line-through",
            size === "lg" ? "text-base" : "text-xs",
          )}
        >
          {money(compareAtMinor!)}
        </span>
      ) : null}
    </span>
  );
}

export function DiscountBadge({ percent }: { percent: number | null }) {
  if (!percent) return null;
  return (
    <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground">
      {percent}% off
    </span>
  );
}

export function StarRating({
  value,
  count,
  className,
}: {
  value?: number;
  count: number;
  className?: string;
}) {
  // Ratings are only shown when genuine, approved reviews exist.
  if (!value || count <= 0) return null;
  return (
    <span className={cn("flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <Star className="size-3.5 fill-accent text-accent" />
      <span className="font-medium text-foreground">{value.toFixed(1)}</span>
      <span>({count})</span>
    </span>
  );
}

export function QuantityStepper({
  value,
  onChange,
  max,
  disabled,
  size = "md",
}: {
  value: number;
  onChange: (next: number) => void;
  max?: number;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const limit = max ?? 20;
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border",
        size === "sm" ? "h-8" : "h-10",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Decrease quantity"
        className={cn("rounded-r-none", size === "sm" ? "size-8" : "size-10")}
        disabled={disabled || value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        <Minus className="size-3.5" />
      </Button>
      <span
        className={cn(
          "min-w-8 text-center text-sm font-semibold tabular-nums",
          size === "sm" && "min-w-6",
        )}
      >
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Increase quantity"
        className={cn("rounded-l-none", size === "sm" ? "size-8" : "size-10")}
        disabled={disabled || value >= limit}
        onClick={() => onChange(Math.min(limit, value + 1))}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let index = start; index <= end; index++) pages.push(index);
  return (
    <nav className="flex items-center justify-center gap-1 py-8" aria-label="Pagination">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </Button>
      {pages.map((entry) => (
        <Button
          key={entry}
          variant={entry === page ? "default" : "outline"}
          size="sm"
          className="min-w-9"
          onClick={() => onChange(entry)}
          aria-current={entry === page ? "page" : undefined}
        >
          {entry}
        </Button>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

export function FilterChips({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label ? (
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      ) : null}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            value === option.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function InfoNote({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "danger";
  className?: string;
}) {
  const tones = {
    info: "border-primary/25 bg-primary/5 text-foreground",
    warning: "border-amber-500/30 bg-amber-500/8 text-foreground",
    danger: "border-destructive/30 bg-destructive/5 text-foreground",
  };
  return (
    <div className={cn("rounded-lg border px-3.5 py-3 text-sm", tones[tone], className)}>
      {children}
    </div>
  );
}
