/**
 * KNOKH brand + storefront constants.
 *
 * The brand name, tagline and wordmark are centralised here (and mirrored in
 * `src/convex/lib/config.ts` for the server). Never hardcode the brand in a
 * component. No company registration details, addresses or certifications are
 * invented here — real contact details are configured in Admin → Settings and
 * surfaced through the server config.
 */

export const BRAND = {
  name: "KNOKH",
  wordmark: "KNOKH",
  tagline: "Your World. One Marketplace.",
  homeTitle: "KNOKH — Discover More. Shop Smarter.",
  description:
    "KNOKH is a multi-category marketplace for electronics, fashion, home, beauty, fitness, toys, travel, office and automotive products with delivery in India and internationally.",
} as const;

export const STORAGE_KEYS = {
  guestKey: "knokh.guestKey",
  currency: "knokh.currency",
  country: "knokh.country",
  visitor: "knokh.visitorKey",
} as const;

export const ACCOUNT_NAV = [
  { href: "/account", label: "Overview" },
  { href: "/account/orders", label: "My orders" },
  { href: "/account/addresses", label: "Address book" },
  { href: "/account/wishlist", label: "Wishlist" },
  { href: "/account/saved-carts", label: "Saved carts" },
  { href: "/account/recently-viewed", label: "Recently viewed" },
  { href: "/account/returns", label: "Returns & refunds" },
  { href: "/account/notifications", label: "Notifications" },
  { href: "/account/profile", label: "Profile & privacy" },
] as const;

export const ADMIN_NAV = [
  { href: "/admin", label: "Overview", icon: "LayoutDashboard" },
  { href: "/admin/orders", label: "Orders", icon: "Receipt" },
  { href: "/admin/products", label: "Products", icon: "Package" },
  { href: "/admin/imports", label: "Import centre", icon: "Upload" },
  { href: "/admin/inventory", label: "Inventory", icon: "Boxes" },
  { href: "/admin/suppliers", label: "Suppliers", icon: "Factory" },
  { href: "/admin/catalog", label: "Catalog & coupons", icon: "Tags" },
  { href: "/admin/marketing", label: "Reviews & support", icon: "MessagesSquare" },
  { href: "/admin/customers", label: "Customers", icon: "Users" },
  { href: "/admin/settings", label: "Settings & payments", icon: "Settings" },
] as const;

export const FOOTER_COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Shop",
    links: [
      { label: "All products", href: "/shop" },
      { label: "Categories", href: "/categories" },
      { label: "New arrivals", href: "/new-arrivals" },
      { label: "Best sellers", href: "/best-sellers" },
      { label: "Trending", href: "/trending" },
      { label: "Deals & offers", href: "/deals" },
    ],
  },
  {
    title: "Your account",
    links: [
      { label: "Sign in or register", href: "/auth" },
      { label: "My orders", href: "/account/orders" },
      { label: "Track an order", href: "/track-order" },
      { label: "Wishlist", href: "/account/wishlist" },
      { label: "Returns & refunds", href: "/account/returns" },
      { label: "Notifications", href: "/account/notifications" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Help centre", href: "/info/help" },
      { label: "FAQ", href: "/info/faq" },
      { label: "Contact us", href: "/info/contact" },
      { label: "Shipping policy", href: "/info/shipping-policy" },
      { label: "Returns & refunds policy", href: "/info/returns-refunds" },
      { label: "Cancellation policy", href: "/info/cancellation-policy" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "/info/about" },
      { label: "Payment information", href: "/info/payment-information" },
      { label: "International shipping", href: "/info/international-shipping" },
      { label: "Invoice & tax", href: "/info/invoice-and-tax" },
      { label: "Privacy policy", href: "/info/privacy-policy" },
      { label: "Terms & conditions", href: "/info/terms" },
      { label: "Cookie policy", href: "/info/cookie-policy" },
      { label: "Accessibility", href: "/info/accessibility" },
      { label: "Warranty", href: "/info/warranty" },
    ],
  },
];
