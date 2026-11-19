import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { StoreShell } from "@/components/knokh/StoreShell";
import { PRODUCTION_CONVEX_ORIGIN } from "@/lib/deployment";
import { StoreProvider } from "@/lib/store";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";
import "./styles/responsive.css";

// Route components are code-split so the first storefront paint stays fast.
const Home = lazy(() => import("./pages/Home.tsx"));
const Catalog = lazy(() => import("./pages/Catalog.tsx"));
const CategoriesIndex = lazy(() =>
  import("./pages/Browse.tsx").then((module) => ({ default: module.CategoriesIndex })),
);
const CollectionsIndex = lazy(() =>
  import("./pages/Browse.tsx").then((module) => ({ default: module.CollectionsIndex })),
);
const ProductDetail = lazy(() => import("./pages/ProductDetail.tsx"));
const Cart = lazy(() => import("./pages/Cart.tsx"));
const Checkout = lazy(() => import("./pages/Checkout.tsx"));
const CheckoutReturn = lazy(() =>
  import("./pages/Checkout.tsx").then((module) => ({ default: module.CheckoutReturn })),
);
const SandboxCheckout = lazy(() =>
  import("./pages/Checkout.tsx").then((module) => ({ default: module.SandboxCheckout })),
);
const OrderConfirmation = lazy(() => import("./pages/OrderConfirmation.tsx"));
const TrackOrder = lazy(() => import("./pages/TrackOrder.tsx"));
const Info = lazy(() => import("./pages/Info.tsx"));
const AccountApp = lazy(() => import("./pages/AccountApp.tsx"));
const AccountOverview = lazy(() =>
  import("./pages/AccountApp.tsx").then((module) => ({ default: module.AccountOverview })),
);
const AccountOrders = lazy(() =>
  import("./pages/AccountApp.tsx").then((module) => ({ default: module.AccountOrders })),
);
const AccountOrderDetail = lazy(() =>
  import("./pages/AccountApp.tsx").then((module) => ({ default: module.AccountOrderDetail })),
);
const AccountAddresses = lazy(() =>
  import("./pages/AccountApp.tsx").then((module) => ({ default: module.AccountAddresses })),
);
const AccountWishlist = lazy(() =>
  import("./pages/AccountApp.tsx").then((module) => ({ default: module.AccountWishlist })),
);
const AccountSavedCarts = lazy(() =>
  import("./pages/AccountApp.tsx").then((module) => ({ default: module.AccountSavedCarts })),
);
const AccountRecentlyViewed = lazy(() =>
  import("./pages/AccountApp.tsx").then((module) => ({ default: module.AccountRecentlyViewed })),
);
const AccountReturns = lazy(() =>
  import("./pages/AccountApp.tsx").then((module) => ({ default: module.AccountReturns })),
);
const AccountNotifications = lazy(() =>
  import("./pages/AccountApp.tsx").then((module) => ({ default: module.AccountNotifications })),
);
const AccountProfile = lazy(() =>
  import("./pages/AccountApp.tsx").then((module) => ({ default: module.AccountProfile })),
);
const AdminApp = lazy(() => import("./pages/admin/AdminApp.tsx"));
const AdminOverview = lazy(() =>
  import("./pages/admin/AdminApp.tsx").then((module) => ({ default: module.AdminOverview })),
);
const AdminProducts = lazy(() => import("./pages/admin/AdminProducts.tsx"));
const AdminOrders = lazy(() => import("./pages/admin/AdminOrders.tsx"));
const AdminOrderDetail = lazy(() =>
  import("./pages/admin/AdminOrders.tsx").then((module) => ({ default: module.AdminOrderDetail })),
);
const AdminImports = lazy(() => import("./pages/admin/AdminImports.tsx"));
const AdminSuppliers = lazy(() => import("./pages/admin/AdminSuppliers.tsx"));
const AdminCatalog = lazy(() => import("./pages/admin/AdminCatalog.tsx"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings.tsx"));
const AdminInventory = lazy(() =>
  import("./pages/admin/AdminOps.tsx").then((module) => ({ default: module.AdminInventory })),
);
const AdminMarketing = lazy(() =>
  import("./pages/admin/AdminOps.tsx").then((module) => ({ default: module.AdminMarketing })),
);
const AdminCustomers = lazy(() =>
  import("./pages/admin/AdminOps.tsx").then((module) => ({ default: module.AdminCustomers })),
);
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col gap-3 items-center justify-center p-6" role="alert">
          <p>KNOKH could not load this page.</p>
          <button type="button" className="underline" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const convexUrl = import.meta.env.VITE_CONVEX_URL || PRODUCTION_CONVEX_ORIGIN;
const convex = new ConvexReactClient(convexUrl);

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source === window.parent && event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <StoreProvider>
            {import.meta.env.DEV ? <RouteSyncer /> : null}
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                {/* Storefront — shares the KNOKH header, footer and mobile nav */}
                <Route element={<StoreShell />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/shop" element={<Catalog mode="shop" />} />
                  <Route path="/search" element={<Catalog mode="search" />} />
                  <Route path="/category/:slug" element={<Catalog mode="category" />} />
                  <Route path="/brand/:slug" element={<Catalog mode="brand" />} />
                  <Route path="/collections/:slug" element={<Catalog mode="collection" />} />
                  <Route
                    path="/new-arrivals"
                    element={<Catalog mode="preset" preset="new-arrivals" />}
                  />
                  <Route
                    path="/best-sellers"
                    element={<Catalog mode="preset" preset="best-sellers" />}
                  />
                  <Route path="/trending" element={<Catalog mode="preset" preset="trending" />} />
                  <Route path="/deals" element={<Catalog mode="preset" preset="deals" />} />
                  <Route path="/categories" element={<CategoriesIndex />} />
                  <Route path="/collections" element={<CollectionsIndex />} />
                  <Route path="/product/:slug" element={<ProductDetail />} />
                  <Route path="/cart" element={<Cart />} />
                  <Route path="/checkout" element={<Checkout />} />
                  <Route path="/checkout/return" element={<CheckoutReturn />} />
                  <Route path="/checkout/sandbox/:orderId" element={<SandboxCheckout />} />
                  <Route path="/order/:orderId" element={<OrderConfirmation />} />
                  <Route path="/order/:orderId/confirmation" element={<OrderConfirmation />} />
                  <Route path="/track-order" element={<TrackOrder />} />
                  <Route path="/info/:slug" element={<Info />} />
                </Route>

                {/* Customer account area */}
                <Route
                  path="/account"
                  element={
                    <RequireAuth
                      title="Sign in to your KNOKH account"
                      description="Your orders, addresses, wishlist and returns live here."
                    >
                      <AccountApp />
                    </RequireAuth>
                  }
                >
                  <Route index element={<AccountOverview />} />
                  <Route path="orders" element={<AccountOrders />} />
                  <Route path="orders/:orderId" element={<AccountOrderDetail />} />
                  <Route path="addresses" element={<AccountAddresses />} />
                  <Route path="wishlist" element={<AccountWishlist />} />
                  <Route path="saved-carts" element={<AccountSavedCarts />} />
                  <Route path="recently-viewed" element={<AccountRecentlyViewed />} />
                  <Route path="returns" element={<AccountReturns />} />
                  <Route path="notifications" element={<AccountNotifications />} />
                  <Route path="profile" element={<AccountProfile />} />
                </Route>

                {/* Admin dashboard */}
                <Route
                  path="/admin"
                  element={
                    <RequireAuth
                      title="Administrator sign-in"
                      description="The dashboard is restricted to accounts with an administrator role."
                      redirectImmediately
                    >
                      <AdminApp />
                    </RequireAuth>
                  }
                >
                  <Route index element={<AdminOverview />} />
                  <Route path="orders" element={<AdminOrders />} />
                  <Route path="orders/:orderId" element={<AdminOrderDetail />} />
                  <Route path="products" element={<AdminProducts />} />
                  <Route path="imports" element={<AdminImports />} />
                  <Route path="inventory" element={<AdminInventory />} />
                  <Route path="suppliers" element={<AdminSuppliers />} />
                  <Route path="catalog" element={<AdminCatalog />} />
                  <Route path="marketing" element={<AdminMarketing />} />
                  <Route path="customers" element={<AdminCustomers />} />
                  <Route path="settings" element={<AdminSettings />} />
                </Route>

                <Route path="/auth" element={<AuthPage redirectAfterAuth="/account" />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </StoreProvider>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
