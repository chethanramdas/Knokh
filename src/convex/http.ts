import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

/* ------------------------------------------------------------------ *
 * Payment webhooks
 *
 * The raw body is used verbatim for signature verification (re-serialising the
 * JSON would invalidate the HMAC). Verification, idempotency and fulfilment all
 * happen inside `payments.processWebhookEvent`.
 * ------------------------------------------------------------------ */

const paymentWebhook = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const provider = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  if (provider === "paypal") {
    const result = await ctx.runAction(
      internal.paymentsActions.handlePaypalWebhook,
      { rawBody, headers },
    );
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!["razorpay", "cashfree", "test_gateway"].includes(provider)) {
    return new Response(
      JSON.stringify({ ok: false, reason: `Unsupported provider "${provider}".` }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const result = await ctx.runMutation(internal.payments.processWebhookEvent, {
    provider,
    rawBody,
    headers,
  });

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
});

http.route({ path: "/payments/webhook/razorpay", method: "POST", handler: paymentWebhook });
http.route({ path: "/payments/webhook/cashfree", method: "POST", handler: paymentWebhook });
http.route({ path: "/payments/webhook/paypal", method: "POST", handler: paymentWebhook });
http.route({ path: "/payments/webhook/test_gateway", method: "POST", handler: paymentWebhook });

/* ------------------------------------------------------------------ *
 * SEO routes
 * ------------------------------------------------------------------ */

http.route({
  path: "/robots.txt",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const entries = await ctx.runQuery(internal.seo.sitemapEntries, {});
    const base = entries.siteUrl.replace(/\/$/, "");
    const lines = [
      "User-agent: *",
      "Allow: /",
      "# Private areas are never indexed",
      "Disallow: /account",
      "Disallow: /cart",
      "Disallow: /checkout",
      "Disallow: /admin",
      "Disallow: /auth",
      "Disallow: /api",
      base ? `Sitemap: ${base}/sitemap.xml` : "# Set seo.siteUrl in Admin → Settings to publish a sitemap URL",
    ];
    return new Response(lines.join("\n") + "\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }),
});

http.route({
  path: "/sitemap.xml",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const entries = await ctx.runQuery(internal.seo.sitemapEntries, {});
    const base = entries.siteUrl.replace(/\/$/, "");
    if (!base) {
      return new Response(
        "Sitemap is unavailable until seo.siteUrl is configured in Admin → Settings.",
        { status: 503, headers: { "Content-Type": "text/plain" } },
      );
    }
    const escape = (value: string) =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const urls: string[] = [];
    const push = (path: string, lastmod?: string, priority = "0.7") => {
      urls.push(
        [
          "  <url>",
          `    <loc>${escape(`${base}${path}`)}</loc>`,
          lastmod ? `    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : "",
          `    <priority>${priority}</priority>`,
          "  </url>",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    };
    push("/", undefined, "1.0");
    push("/shop", undefined, "0.9");
    push("/deals", undefined, "0.8");
    push("/new-arrivals", undefined, "0.8");
    push("/categories", undefined, "0.8");
    for (const category of entries.categories) push(`/category/${category.slug}`);
    for (const brand of entries.brands) push(`/brand/${brand.slug}`, undefined, "0.6");
    for (const collection of entries.collections) push(`/collections/${collection.slug}`, undefined, "0.6");
    for (const product of entries.products) {
      push(`/product/${product.slug}`, new Date(product.updatedAt).toISOString(), "0.8");
    }
    for (const page of [
      "about",
      "contact",
      "help",
      "faq",
      "shipping-policy",
      "returns-refunds",
      "cancellation-policy",
      "privacy-policy",
      "terms",
      "cookie-policy",
      "warranty",
      "payment-information",
      "international-shipping",
      "invoice-and-tax",
      "accessibility",
    ]) {
      push(`/info/${page}`, undefined, "0.4");
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
    return new Response(xml, {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }),
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(
      JSON.stringify({ ok: true, service: "knokh", time: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

export default http;
