interface D1Result<T> { results: T[]; success: boolean }
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Database { prepare(query: string): D1Statement }
interface Env { DB?: D1Database }

type ProductRow = {
  id: string; sku: string; slug: string; name: string; summary: string | null;
  description: string | null; images_json: string; price_minor: number;
  compare_at_minor: number | null; currency: string; stock: number;
  status: string; featured: number; rating_avg: number | null;
  rating_count: number; units_sold: number; category_id: string | null;
  brand_id: string | null; updated_at: string;
};

function jsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

type PagesFunction<E> = (context: { request: Request; env: E }) => Response | Promise<Response>;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) return Response.json({ error: "Catalog database is not configured" }, { status: 503 });

  const url = new URL(request.url);
  const page = Math.max(1, Math.min(10000, Number(url.searchParams.get("page") || 1)));
  const perPage = Math.max(1, Math.min(48, Number(url.searchParams.get("perPage") || 24)));
  const search = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const category = url.searchParams.get("categoryId");
  const brand = url.searchParams.get("brandId");
  const minPrice = Number(url.searchParams.get("minMinor"));
  const maxPrice = Number(url.searchParams.get("maxMinor"));
  const inStock = url.searchParams.get("inStockOnly") === "true";
  const featured = url.searchParams.get("featured") === "true";

  const where = ["status = 'published'"];
  const values: unknown[] = [];
  if (search) { where.push("(name LIKE ? OR search_text LIKE ? OR sku LIKE ?)"); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (category) { where.push("(category_id = ? OR subcategory_id = ?)"); values.push(category, category); }
  if (brand) { where.push("brand_id = ?"); values.push(brand); }
  if (Number.isFinite(minPrice) && url.searchParams.has("minMinor")) { where.push("price_minor >= ?"); values.push(minPrice); }
  if (Number.isFinite(maxPrice) && url.searchParams.has("maxMinor")) { where.push("price_minor <= ?"); values.push(maxPrice); }
  if (inStock) where.push("stock > 0");
  if (featured) where.push("featured = 1");

  const sortKey = url.searchParams.get("sort");
  const orderBy = sortKey === "price_asc" ? "price_minor ASC"
    : sortKey === "price_desc" ? "price_minor DESC"
    : sortKey === "popular" ? "units_sold DESC"
    : sortKey === "rating" ? "rating_avg DESC"
    : "updated_at DESC";
  const offset = (page - 1) * perPage;
  const query = `SELECT id, sku, slug, name, summary, description, images_json, price_minor, compare_at_minor, currency, stock, status, featured, rating_avg, rating_count, units_sold, category_id, brand_id, updated_at FROM products WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  values.push(perPage, offset);

  try {
    const result = await env.DB.prepare(query).bind(...values).all<ProductRow>();
    const products = result.results.map((row) => {
      const images = jsonArray(row.images_json);
      const firstImage = images[0] as { url?: string } | string | undefined;
      return {
        _id: row.id, id: row.id, sku: row.sku, slug: row.slug, name: row.name,
        summary: row.summary ?? undefined, description: row.description ?? undefined,
        images, image: typeof firstImage === "string" ? firstImage : firstImage?.url,
        priceMinor: row.price_minor, compareAtMinor: row.compare_at_minor ?? undefined,
        currency: row.currency, stock: row.stock, inStock: row.stock > 0,
        status: row.status, featured: Boolean(row.featured),
        ratingAvg: row.rating_avg ?? undefined, ratingCount: row.rating_count,
        unitsSold: row.units_sold, categoryId: row.category_id ?? undefined,
        brandId: row.brand_id ?? undefined, updatedAt: row.updated_at,
      };
    });
    return Response.json({ products, page, perPage, hasMore: products.length === perPage }, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
    });
  } catch {
    return Response.json({ error: "Unable to load products" }, { status: 500 });
  }
};
