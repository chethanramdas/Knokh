import { Link } from "react-router";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return <img src="/logo.svg" alt="KNOKH" className={cn("h-9 w-auto max-w-[190px] shrink-0 object-contain", className)} />;
}

export function Wordmark({ className, showTagline = false }: { className?: string; showTagline?: boolean }) {
  return (
    <span className={cn("flex flex-col leading-none", className)}>
      <img src="/logo.svg" alt="KNOKH" className="h-9 w-auto max-w-[190px] object-contain" />
      {showTagline ? <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Your World. One Marketplace.</span> : null}
    </span>
  );
}

export function LogoLink({ to = "/", showTagline = false, className }: { to?: string; showTagline?: boolean; className?: string }) {
  return (
    <Link to={to} className={cn("flex items-center gap-2.5", className)} aria-label="KNOKH home">
      <Wordmark showTagline={showTagline} />
    </Link>
  );
}
