import { useMutation, useQuery } from "@/lib/cloudflare-client";
import {
  Heart,
  Home,
  LayoutGrid,
  Loader2,
  Mail,
  Menu,
  Package,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Truck,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { BRAND, FOOTER_COLUMNS } from "@/lib/brand";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Container } from "./ui";
import { LogoLink, LogoMark } from "./Logo";

const PRIMARY_NAV = [
  { href: "/shop", label: "All products" },
  { href: "/deals", label: "Deals" },
  { href: "/new-arrivals", label: "New arrivals" },
  { href: "/best-sellers", label: "Best sellers" },
  { href: "/collections", label: "Collections" },
];

function SearchBox({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [term]);

  const suggestions = useQuery(
    api.catalog.searchSuggestions,
    debounced.length >= 2 ? { term: debounced } : "skip",
  );
  const { money } = useStore();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const query = term.trim();
    if (!query) return;
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  const hasResults =
    (suggestions?.products.length ?? 0) > 0 || (suggestions?.categories.length ?? 0) > 0;

  return (
    <form onSubmit={submit} className={cn("relative", className)} role="search">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        placeholder="Search products, brands and SKUs"
        aria-label="Search products"
        className="h-11 pl-9"
      />
      {open && debounced.length >= 2 ? (
        <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-border bg-popover">
          {suggestions === undefined ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Searching…
            </div>
          ) : hasResults ? (
            <ul className="max-h-96 overflow-auto py-1">
              {suggestions?.categories.map((category) => (
                <li key={category.slug}>
                  <Link
                    to={`/category/${category.slug}`}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted"
                    onClick={() => {
                      if (blurTimer.current) window.clearTimeout(blurTimer.current);
                      setOpen(false);
                    }}
                  >
                    <LayoutGrid className="size-4 text-muted-foreground" />
                    <span>{category.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">Category</span>
                  </Link>
                </li>
              ))}
              {suggestions?.products.map((product) => (
                <li key={product._id}>
                  <Link
                    to={`/product/${product.slug}`}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted"
                    onClick={() => {
                      if (blurTimer.current) window.clearTimeout(blurTimer.current);
                      setOpen(false);
                    }}
                  >
                    {product.image ? (
                      <img
                        src={product.image}
                        alt=""
                        className="size-8 rounded object-cover"
                      />
                    ) : (
                      <Package className="size-4 text-muted-foreground" />
                    )}
                    <span className="line-clamp-1">{product.name}</span>
                    <span className="ml-auto shrink-0 text-xs font-medium">
                      {money(product.priceMinor)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              No matches yet. Try a different word or browse all products.
            </div>
          )}
        </div>
      ) : null}
    </form>
  );
}

function CurrencyCountrySelectors({ compact = false }: { compact?: boolean }) {
  const { config, currency, setCurrency, country, setCountry } = useStore();
  const currencies = config?.currencies.filter((entry) => entry.enabled) ?? [];
  const zones = config?.shippingZones ?? [];
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Display currency"
        value={currency}
        onChange={(event) => setCurrency(event.target.value)}
        className="h-9 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground"
      >
        {currencies.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.code} {entry.symbol}
          </option>
        ))}
      </select>
      <select
        aria-label="Delivery country"
        value={country}
        onChange={(event) => setCountry(event.target.value)}
        className={cn(
          "h-9 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground",
          compact && "max-w-[9.5rem]",
        )}
      >
        {zones.map((zone) => (
          <option key={zone.countryCode} value={zone.countryCode}>
            {zone.country}
            {zone.serviceable ? "" : " (not serviceable)"}
          </option>
        ))}
      </select>
    </div>
  );
}

function AccountMenu() {
  const { user, isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { config } = useStore();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <User className="size-4" />
        <span className="hidden text-sm sm:inline">
          {isAuthenticated ? user?.name?.split(" ")[0] || "Account" : "Sign in"}
        </span>
      </Button>
      {open ? (
        <div
          className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-border bg-popover p-1.5 text-sm"
          onClick={(event) => event.stopPropagation()}
        >
          {isAuthenticated ? (
            <>
              <Link to="/account" className="block rounded-lg px-3 py-2 hover:bg-muted">
                My account
              </Link>
              <Link to="/account/orders" className="block rounded-lg px-3 py-2 hover:bg-muted">
                My orders
              </Link>
              <Link to="/account/wishlist" className="block rounded-lg px-3 py-2 hover:bg-muted">
                Wishlist
              </Link>
              <Link
                to="/account/notifications"
                className="block rounded-lg px-3 py-2 hover:bg-muted"
              >
                Notifications
              </Link>
              {config?.viewer.isAdmin ? (
                <Link to="/admin" className="block rounded-lg px-3 py-2 hover:bg-muted">
                  Admin dashboard
                </Link>
              ) : null}
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left text-destructive hover:bg-muted"
                onClick={async () => {
                  await signOut();
                  setOpen(false);
                  toast.success("Signed out.");
                  navigate("/");
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/auth" className="block rounded-lg px-3 py-2 hover:bg-muted">
                Sign in or create an account
              </Link>
              <Link to="/track-order" className="block rounded-lg px-3 py-2 hover:bg-muted">
                Track an order
              </Link>
              <Link to="/account/saved-carts" className="block rounded-lg px-3 py-2 hover:bg-muted">
                Saved carts
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MobileMenu() {
  const categories = useQuery(api.catalog.listCategories, {});
  const [open, setOpen] = useState(false);
  const { config } = useStore();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu" className="lg:hidden">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[86vw] max-w-sm overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-left">
            <LogoMark className="size-7" />
            <span className="wordmark">{BRAND.name}</span>
          </SheetTitle>
        </SheetHeader>
        <nav className="mt-4 flex flex-col gap-1 text-sm">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
          <Link
            to="/categories"
            onClick={() => setOpen(false)}
            className="rounded-lg px-3 py-2.5 font-semibold hover:bg-muted"
          >
            All categories
          </Link>
          <div className="my-2 h-px bg-border" />
          {(categories ?? []).slice(0, 12).map((category) => (
            <Link
              key={category._id}
              to={`/category/${category.slug}`}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted"
            >
              <span>{category.name}</span>
              <span className="text-xs">{category.productCount || ""}</span>
            </Link>
          ))}
          <div className="my-2 h-px bg-border" />
          <Link
            to="/account"
            onClick={() => setOpen(false)}
            className="rounded-lg px-3 py-2.5 hover:bg-muted"
          >
            My account
          </Link>
          <Link
            to="/track-order"
            onClick={() => setOpen(false)}
            className="rounded-lg px-3 py-2.5 hover:bg-muted"
          >
            Track an order
          </Link>
          <Link
            to="/info/help"
            onClick={() => setOpen(false)}
            className="rounded-lg px-3 py-2.5 hover:bg-muted"
          >
            Help centre
          </Link>
          {config?.viewer.isAdmin ? (
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 font-semibold text-primary hover:bg-muted"
            >
              Admin dashboard
            </Link>
          ) : null}
          <div className="mt-3">
            <CurrencyCountrySelectors compact />
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

function BottomNav() {
  const { cartCount } = useStore();
  const items = [
    { href: "/", label: "Home", icon: Home },
    { href: "/categories", label: "Categories", icon: LayoutGrid },
    { href: "/account/wishlist", label: "Wishlist", icon: Heart },
    { href: "/account", label: "Account", icon: User },
    { href: "/cart", label: "Cart", icon: ShoppingCart, badge: cartCount },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink
              to={item.href}
              end={item.href === "/"}
              className={({ isActive }) =>
                cn(
                  "relative flex flex-col items-center gap-1 py-2 text-[11px] font-medium",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              <item.icon className="size-5" />
              {item.label}
              {item.badge ? (
                <span className="absolute right-[22%] top-1 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                  {item.badge}
                </span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NewsletterForm() {
  const subscribe = useMutation(api.account.subscribeNewsletter);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const { config } = useStore();

  if (config && !config.commerce.newsletterEnabled) {
    return (
      <p className="text-xs text-muted-foreground">
        Newsletter signup is currently disabled in the store settings.
      </p>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await subscribe({ email, consent, source: "footer" });
      toast.success(
        result.alreadySubscribed
          ? "You are already on the list."
          : "Thanks — you are subscribed.",
      );
      setEmail("");
      setConsent(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not subscribe right now.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2">
        <Input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
        />
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          Join
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="newsletter-consent"
          checked={consent}
          onCheckedChange={(value) => setConsent(value === true)}
        />
        <Label
          htmlFor="newsletter-consent"
          className="text-xs leading-snug text-muted-foreground"
        >
          I agree to receive new arrivals, offers and buying guides by email. I can
          unsubscribe at any time.
        </Label>
      </div>
    </form>
  );
}

function Footer() {
  const { config, contact, brand } = useStore();
  const year = new Date().getFullYear();
  const configuredProviders =
    config?.payments.providers.filter((provider) => provider.enabled) ?? [];

  return (
    <footer className="mt-16 border-t border-border bg-secondary/40 pb-24 lg:pb-0">
      <Container className="py-12">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <LogoLink showTagline />
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              {brand.tagline} A multi-category marketplace with delivery in India and
              internationally.
            </p>
            <div className="mt-5">
              <p className="text-sm font-semibold">New arrivals and offers</p>
              <div className="mt-2">
                <NewsletterForm />
              </div>
            </div>
            <div className="mt-5 space-y-1 text-sm text-muted-foreground">
              {contact.supportEmail ? (
                <p>
                  Support:{" "}
                  <a className="hover:text-foreground" href={`mailto:${contact.supportEmail}`}>
                    {contact.supportEmail}
                  </a>
                </p>
              ) : (
                <p>Support email is not configured yet.</p>
              )}
              {contact.phone ? <p>Phone: {contact.phone}</p> : null}
              {contact.hours ? <p>{contact.hours}</p> : null}
            </div>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <p className="text-sm font-semibold">{column.title}</p>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {column.links.map((link) => (
                    <li key={link.href + link.label}>
                      <Link to={link.href} className="hover:text-foreground">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-4 border-t border-border pt-6 sm:grid-cols-3">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Truck className="mt-0.5 size-4 shrink-0" />
            Delivery estimates are shown per destination and are confirmed at checkout.
          </p>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            {configuredProviders.length > 0
              ? `Payments processed by ${configuredProviders.map((provider) => provider.label).join(", ")}. Card details never touch our servers.`
              : "Online payment methods appear at checkout once a payment provider is configured in the admin settings."}
          </p>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Package className="mt-0.5 size-4 shrink-0" />
            Returns and refunds follow the published policy — see Returns &amp; refunds.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {brand.name}. {brand.tagline}
          </p>
          <p>
            Legal and tax details must be configured by the store owner in Admin →
            Settings before trading.
          </p>
        </div>
      </Container>
    </footer>
  );
}

export function StoreShell() {
  const categories = useQuery(api.catalog.listCategories, {});
  const { cartCount, config, zone } = useStore();
  const location = useLocation();
  const topCategories = useMemo(
    () => (categories ?? []).filter((category) => !category.parentId).slice(0, 8),
    [categories],
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b border-border bg-primary text-primary-foreground">
        <Container className="flex h-9 items-center justify-between text-xs">
          <p className="truncate">
            {zone?.freeAboveMinor
              ? `Free standard delivery on orders above ${(zone.freeAboveMinor / 100).toFixed(0)} ${config?.commerce.baseCurrency ?? "INR"}`
              : "Worldwide dispatch from verified suppliers"}
          </p>
          <p className="hidden items-center gap-3 sm:flex">
            <Link to="/info/shipping-policy" className="hover:underline">
              Shipping
            </Link>
            <Link to="/info/returns-refunds" className="hover:underline">
              Returns
            </Link>
            <Link to="/info/contact" className="hover:underline">
              Contact
            </Link>
          </p>
        </Container>
      </div>

      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <Container className="flex h-16 items-center gap-3">
          <MobileMenu />
          <LogoLink className="shrink-0" />
          <SearchBox className="hidden flex-1 lg:block" />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <div className="hidden xl:block">
              <CurrencyCountrySelectors />
            </div>
            <Button asChild variant="ghost" size="icon" aria-label="Wishlist">
              <Link to="/account/wishlist">
                <Heart className="size-5" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="relative gap-2" aria-label="Cart">
              <Link to="/cart">
                <ShoppingBag className="size-5" />
                <span className="hidden sm:inline">Cart</span>
                {cartCount > 0 ? (
                  <span className="absolute -right-0 -top-1 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                    {cartCount}
                  </span>
                ) : null}
              </Link>
            </Button>
            <AccountMenu />
          </div>
        </Container>
        <Container className="pb-3 lg:hidden">
          <SearchBox />
        </Container>
        <Container className="hidden items-center gap-1 pb-2 lg:flex">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          <span className="mx-2 h-4 w-px bg-border" />
          {topCategories.map((category) => (
            <NavLink
              key={category._id}
              to={`/category/${category.slug}`}
              className={({ isActive }) =>
                cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {category.name}
            </NavLink>
          ))}
          <NavLink to="/categories" className="ml-auto text-sm font-medium text-primary">
            All categories →
          </NavLink>
        </Container>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <Footer />
      <BottomNav />
    </div>
  );
}
