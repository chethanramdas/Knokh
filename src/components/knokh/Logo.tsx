import { Link } from "react-router";
import { cn } from "@/lib/utils";

/**
 * KNOKH wordmark. The mark is an original geometric "K" with a single amber
 * accent dot, drawn as SVG so it stays crisp in the header, the mobile bar and
 * on printed order confirmations.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-9 shrink-0", className)}
      role="img"
      aria-label="KNOKH"
    >
      <rect width="64" height="64" rx="14" className="fill-primary" />
      <path
        d="M16 14h6v15.5L33.8 14H42L30.6 28.2 42.4 50h-8.6l-8.2-15.6L22 38.4V50h-6z"
        className="fill-primary-foreground"
      />
      <circle cx="47" cy="20" r="4.5" className="fill-accent" />
    </svg>
  );
}

export function Wordmark({
  className,
  showTagline = false,
}: {
  className?: string;
  showTagline?: boolean;
}) {
  return (
    <span className={cn("flex flex-col leading-none", className)}>
      <span className="wordmark text-xl text-foreground">KNOKH</span>
      {showTagline ? (
        <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Your World. One Marketplace.
        </span>
      ) : null}
    </span>
  );
}

export function LogoLink({
  to = "/",
  showTagline = false,
  className,
}: {
  to?: string;
  showTagline?: boolean;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn("flex items-center gap-2.5", className)}
      aria-label="KNOKH home"
    >
      <LogoMark />
      <Wordmark showTagline={showTagline} />
    </Link>
  );
}
