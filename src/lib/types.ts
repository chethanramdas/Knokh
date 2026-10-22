import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

/**
 * Types derived from the Convex functions themselves, so the UI can never
 * drift from the backend contract.
 */

export type ProductListResult = FunctionReturnType<typeof api.catalog.listProducts>;
export type ProductCardData = ProductListResult["items"][number];

export type HomeData = FunctionReturnType<typeof api.catalog.getHomeData>;
export type HomeRow = HomeData["rows"][string];

export type CategoryList = FunctionReturnType<typeof api.catalog.listCategories>;
export type CategorySummary = CategoryList[number];

export type CategoryDetail = NonNullable<
  FunctionReturnType<typeof api.catalog.getCategoryBySlug>
>;

export type ProductDetail = NonNullable<
  FunctionReturnType<typeof api.catalog.getProductBySlug>
>;

export type CartView = NonNullable<FunctionReturnType<typeof api.cart.getCart>>;
export type CartLineView = CartView["lines"][number];

export type CheckoutQuote = NonNullable<
  FunctionReturnType<typeof api.checkout.getCheckoutQuote>
>;
export type ShippingOptionView = CheckoutQuote["shippingOptions"][number];

export type OrderDetail = NonNullable<FunctionReturnType<typeof api.orders.getOrderDetail>>;
export type OrderSummary = FunctionReturnType<typeof api.orders.myOrders>[number];
export type TrackingView = NonNullable<FunctionReturnType<typeof api.orders.getTracking>>;

export type AdminOverview = FunctionReturnType<typeof api.admin.getOverview>;
export type AdminProductRow = FunctionReturnType<typeof api.admin.listProductsAdmin>["items"][number];
export type AdminOrderRow = FunctionReturnType<typeof api.admin.listOrdersAdmin>["items"][number];
export type AdminSettingsPayload = FunctionReturnType<typeof api.admin.getSettingsAdmin>;
export type AdminCategories = FunctionReturnType<typeof api.admin.listCategoriesAdmin>;
export type AdminBrands = FunctionReturnType<typeof api.admin.listBrandsAdmin>;
export type AdminCollections = FunctionReturnType<typeof api.admin.listCollectionsAdmin>;
export type AdminCoupons = FunctionReturnType<typeof api.admin.listCouponsAdmin>;
export type AdminRefunds = FunctionReturnType<typeof api.admin.listRefundsAdmin>;
export type AdminReviews = FunctionReturnType<typeof api.admin.listReviewsAdmin>;
export type AdminTickets = FunctionReturnType<typeof api.admin.listSupportTickets>;
export type AdminCustomers = FunctionReturnType<typeof api.admin.listCustomersAdmin>;
export type AdminAuditLogs = FunctionReturnType<typeof api.admin.listAuditLogs>;
export type AdminSuppliers = FunctionReturnType<typeof api.suppliers.listSuppliers>;
export type AdminSupplierProducts = FunctionReturnType<typeof api.suppliers.listSupplierProducts>;
export type AdminSyncJobs = FunctionReturnType<typeof api.suppliers.listSyncJobs>;
export type AdminSupplierOrders = FunctionReturnType<typeof api.suppliers.listSupplierOrders>;
export type AdminImportJobs = FunctionReturnType<typeof api.imports.listImportJobs>;
export type AdminImportJobDetail = NonNullable<
  FunctionReturnType<typeof api.imports.getImportJob>
>;
export type AdminConnectors = FunctionReturnType<typeof api.suppliers.listConnectors>;
export type PaymentProviderStatus = FunctionReturnType<typeof api.catalog.paymentProviderStatus>;
