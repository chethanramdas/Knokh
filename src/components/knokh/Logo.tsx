import { Link } from "react-router";
import { cn } from "@/lib/utils";

/** Original owner-supplied artwork. Display the full image without alteration. */
export function LogoMark({ className }: { className?: string }) {
  return <img src="/knokh-logo.png" alt="KNOKH" width={1774} height={887} className={cn("h-auto w-36 shrink-0 object-contain", className)} />;
}

export function Wordmark({ className, showTagline = false }: { className?: string; showTagline?: boolean }) {
  return <span className={cn("flex flex-col", className)}><LogoMark />{showTagline ? <span className="text-[10px] text-muted-foreground">Your World. One Marketplace.</span> : null}</span>;
}

export function LogoLink({ to = "/", showTagline = false, className }: { to?: string; showTagline?: boolean; className?: string }) {
  return <Link to={to} className={cn("inline-flex flex-col", className)} aria-label="KNOKH home"><LogoMark />{showTagline ? <span className="text-[10px] text-muted-foreground">Your World. One Marketplace.</span> : null}</Link>;
}
