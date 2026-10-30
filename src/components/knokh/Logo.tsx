import { Link } from "react-router";
import { cn } from "@/lib/utils";

/** KNOKH's signature cart-inspired K, rendered as crisp scalable SVG. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-9 shrink-0", className)}
      role="img"
      aria-label="KNOKH"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="knokh-gold-mark" x1="12" y1="10" x2="50" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFD447" />
          <stop offset="0.48" stopColor="#FF9D18" />
          <stop offset="1" stopColor="#F06A16" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="#17191D" />
      <path d="M13 15h5.5l4.2 25.2a5 5 0 0 0 4.9 4.2h19.8" fill="none" stroke="url(#knokh-gold-mark)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 23h29l-5.2 15.2H25.1" fill="none" stroke="url(#knokh-gold-mark)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M34 25v12m0-6 10-8m-10 8 10 8" fill="none" stroke="url(#knokh-gold-mark)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="29" cy="51" r="3.2" fill="#FFD447" />
      <circle cx="46" cy="51" r="3.2" fill="#FFD447" />
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
      <span className="wordmark text-xl text-foreground">
        <span className="knokh-gold-text">K</span>NO<span className="text-foreground">KH</span>
      </span>
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
