import { useMutation, useQuery } from "@/lib/cloudflare-client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Id } from "@/lib/cloudflare-types";
import { BRAND, STORAGE_KEYS } from "./brand";
import { convertMinor, formatMoney, type CurrencyConfig } from "./format";

export type StoreBrand = {
  name: string;
  wordmark: string;
  tagline: string;
  domain: string;
};

export type StoreContact = {
  supportEmail: string;
  salesEmail: string;
  phone: string;
  addressLines: string[];
  hours: string;
};

export type ShippingZone = {
  countryCode: string;
  country: string;
  zone: string;
  rateMinor: number;
  freeAboveMinor: number;
  etaDays: number;
  serviceable: boolean;
  codAvailable: boolean;
};

export type TaxRule = {
  countryCode: string;
  label: string;
  ratePercent: number;
  inclusive: boolean;
};

export type HomeSectionConfig = {
  id: string;
  type:
    | "hero"
    | "category_grid"
    | "product_row"
    | "promo_banner"
    | "trust_badges"
    | "newsletter"
    | "recently_viewed"
    | "collection_row"
    | "brand_strip";
  title: string;
  subtitle?: string;
  enabled: boolean;
  position: number;
  source?: string;
  limit?: number;
  ctaLabel?: string;
  ctaHref?: string;
  image?: string;
};

export type PaymentProviderInfo = {
  id: string;
  label: string;
  enabled: boolean;
  status: "configured" | "pending_credentials";
  countries: string[];
  currencies: string[];
  docsUrl: string;
  missingEnvVars: string[];
};

export type StoreConfig = {
  brand: StoreBrand;
  contact: StoreContact;
  commerce: {
    baseCurrency: string;
    defaultCurrency: string;
    freeShippingThresholdMinor: number;
    codEnabled: boolean;
    guestCheckoutEnabled: boolean;
    newsletterEnabled: boolean;
    reviewsEnabled: boolean;
    autoHideUnavailable: boolean;
    maxImportRows: number;
    maxImportFileBytes: number;
  };
  seo: {
    siteUrl: string;
    defaultTitle: string;
    defaultDescription: string;
    analyticsId: string;
    organisationTwitter: string;
  };
  pricing: { minimumMarginPercent: number; defaultMarkupPercent: number };
  currencies: CurrencyConfig[];
  shippingZones: ShippingZone[];
  taxRules: TaxRule[];
  homepage: HomeSectionConfig[];
  payments: {
    providers: PaymentProviderInfo[];
    codEnabled: boolean;
    testGatewayEnabled: boolean;
  };
  viewer: {
    isSignedIn: boolean;
    isAdmin: boolean;
    name: string | null;
    email: string | null;
    defaultCurrency: string;
  };
};

type StoreContextValue = {
  config: StoreConfig | undefined;
  isLoadingConfig: boolean;
  brand: StoreBrand;
  contact: StoreContact;
  /** Session key so guests can hold a cart without an account. */
  guestKey: string;
  visitorKey: string;
  currency: string;
  setCurrency: (code: string) => void;
  currencyConfig: CurrencyConfig | undefined;
  baseCurrencyConfig: CurrencyConfig | undefined;
  country: string;
  setCountry: (code: string) => void;
  zone: ShippingZone | undefined;
  /** Convert a base-currency minor amount for display. */
  toDisplay: (amountMinor: number) => number;
  /** Format a base-currency minor amount in the selected display currency. */
  money: (amountMinor: number) => string;
  /** Format an amount that is already in the selected currency. */
  moneyLocal: (amountMinor: number) => string;
  formatWith: (amountMinor: number, code: string) => string;
  cartCount: number;
  cartId: Id<"carts"> | null | undefined;
  wishlistIds: string[];
  isWishlisted: (productId: string) => boolean;
  toggleWishlist: (productId: Id<"products">, name?: string) => Promise<void>;
};

const StoreContext = createContext<StoreContextValue | null>(null);

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked (private mode); the storefront still works.
  }
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const config = useQuery(api.catalog.getStoreConfig) as StoreConfig | undefined;
  const [guestKey, setGuestKey] = useState("");
  const [visitorKey, setVisitorKey] = useState("");
  const [currency, setCurrencyState] = useState("INR");
  const [country, setCountryState] = useState("IN");

  useEffect(() => {
    const storedGuest = readStorage(STORAGE_KEYS.guestKey) ?? randomKey();
    writeStorage(STORAGE_KEYS.guestKey, storedGuest);
    setGuestKey(storedGuest);

    const storedVisitor = readStorage(STORAGE_KEYS.visitor) ?? randomKey();
    writeStorage(STORAGE_KEYS.visitor, storedVisitor);
    setVisitorKey(storedVisitor);

    const storedCurrency = readStorage(STORAGE_KEYS.currency);
    if (storedCurrency) setCurrencyState(storedCurrency);
    const storedCountry = readStorage(STORAGE_KEYS.country);
    if (storedCountry) setCountryState(storedCountry);
  }, []);

  useEffect(() => {
    if (!config) return;
    const storedCurrency = readStorage(STORAGE_KEYS.currency);
    if (!storedCurrency) {
      const preferred =
        config.viewer.defaultCurrency || config.commerce.defaultCurrency;
      setCurrencyState(preferred);
    }
  }, [config]);

  const cartCount = useQuery(api.cart.getCartCount, {
    guestKey: guestKey || undefined,
  });
  const wishlist = useQuery(
    api.account.getWishlist,
    config?.viewer.isSignedIn ? {} : "skip",
  );
  const toggleWishlistMutation = useMutation(api.account.toggleWishlist);

  const setCurrency = useCallback((code: string) => {
    setCurrencyState(code);
    writeStorage(STORAGE_KEYS.currency, code);
  }, []);

  const setCountry = useCallback((code: string) => {
    setCountryState(code.toUpperCase());
    writeStorage(STORAGE_KEYS.country, code.toUpperCase());
  }, []);

  const currencies = config?.currencies ?? [];
  const currencyConfig =
    currencies.find((entry) => entry.code === currency) ??
    currencies.find((entry) => entry.code === "INR") ??
    currencies[0];
  const baseCurrencyConfig =
    currencies.find((entry) => entry.code === (config?.commerce.baseCurrency ?? "INR")) ??
    currencies[0];

  const toDisplay = useCallback(
    (amountMinor: number) => convertMinor(amountMinor, baseCurrencyConfig, currencyConfig),
    [baseCurrencyConfig, currencyConfig],
  );

  const money = useCallback(
    (amountMinor: number) => formatMoney(toDisplay(amountMinor), currencyConfig),
    [toDisplay, currencyConfig],
  );

  const moneyLocal = useCallback(
    (amountMinor: number) => formatMoney(amountMinor, currencyConfig),
    [currencyConfig],
  );

  const formatWith = useCallback(
    (amountMinor: number, code: string) => {
      const target = currencies.find((entry) => entry.code === code);
      return formatMoney(toDisplay(amountMinor), target ?? currencyConfig);
    },
    [currencies, toDisplay, currencyConfig],
  );

  const isWishlisted = useCallback(
    (productId: string) =>
      (wishlist?.productIds ?? []).includes(productId),
    [wishlist],
  );

  const toggleWishlist = useCallback(
    async (productId: Id<"products">, name?: string) => {
      if (!config?.viewer.isSignedIn) {
        toast.error("Sign in to save items to your wishlist.", {
          description: "Your wishlist is stored with your account.",
        });
        return;
      }
      try {
        const result = await toggleWishlistMutation({ productId });
        toast.success(
          result.wished
            ? `${name ?? "Item"} saved to your wishlist.`
            : `${name ?? "Item"} removed from your wishlist.`,
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update your wishlist.",
        );
      }
    },
    [config?.viewer.isSignedIn, toggleWishlistMutation],
  );

  const homeZone = useMemo(
    () =>
      config?.shippingZones.find((entry) => entry.countryCode === country) ??
      config?.shippingZones.find((entry) => entry.zone === "domestic"),
    [config?.shippingZones, country],
  );

  const value: StoreContextValue = {
    config,
    isLoadingConfig: config === undefined,
    brand: config?.brand ?? {
      name: BRAND.name,
      wordmark: BRAND.wordmark,
      tagline: BRAND.tagline,
      domain: "",
    },
    contact: config?.contact ?? {
      supportEmail: "",
      salesEmail: "",
      phone: "",
      addressLines: [],
      hours: "",
    },
    guestKey,
    visitorKey,
    currency: currencyConfig?.code ?? currency,
    setCurrency,
    currencyConfig,
    baseCurrencyConfig,
    country,
    setCountry,
    zone: homeZone,
    toDisplay,
    money,
    moneyLocal,
    formatWith,
    cartCount: cartCount ?? 0,
    cartId: undefined,
    wishlistIds: wishlist?.productIds ?? [],
    isWishlisted,
    toggleWishlist,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useStore must be used inside <StoreProvider>.");
  }
  return context;
}
