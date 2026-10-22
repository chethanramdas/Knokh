"use node";

/**
 * URL import preview action (Node runtime).
 *
 * What this does — and does not do:
 *  - fetches exactly one public page (or one JSON feed) for a URL you paste,
 *  - checks robots.txt first and refuses when the path is disallowed,
 *  - never sends credentials, never bypasses a login/CAPTCHA/rate limit, and
 *    never bulk-crawls a site,
 *  - returns a *preview*; a draft product is only created when a human confirms.
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import {
  assertFetchableUrl,
  extractProductFromHtml,
  extractProductFromJson,
  isPathAllowed,
  parseRobotsTxt,
} from "./lib/feed";

const USER_AGENT = "KNOKH-ProductImporter/1.0 (+catalog import; contact the store admin)";
const MAX_BYTES = 600_000;
const TIMEOUT_MS = 12_000;

async function fetchWithLimit(url: string): Promise<{ text: string; contentType: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const reader = response.body?.getReader();
    if (!reader) return { text: "", contentType, status: response.status };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
        if (total >= MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }
    }
    const buffer = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      text: new TextDecoder("utf-8").decode(buffer),
      contentType,
      status: response.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const fetchUrlPreview = action({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user || user.role !== "admin") {
      throw new Error("Admin access required.");
    }

    const guard = assertFetchableUrl(args.url);
    if (guard.error) return { ok: false as const, reason: guard.error };
    const url = guard.url;

    // robots.txt is always honoured before fetching anything.
    let robotsNote = "robots.txt was not available; the page is public.";
    try {
      const robotsUrl = new URL("/robots.txt", url.origin).toString();
      const robots = await fetchWithLimit(robotsUrl);
      if (robots.status === 200 && robots.text.trim().length > 0) {
        const rules = parseRobotsTxt(robots.text);
        if (!isPathAllowed(rules, url.pathname)) {
          return {
            ok: false as const,
            reason: `${url.host} disallows automated access to ${url.pathname} in robots.txt, so KNOKH will not import it.`,
            alternatives: [
              "Ask the supplier for API or feed access",
              "Upload the product data as CSV/XLSX",
              "Create the product manually",
            ],
          };
        }
        robotsNote = "robots.txt allows this path.";
      }
    } catch {
      robotsNote = "robots.txt could not be read; continuing with a single polite request.";
    }

    let page: { text: string; contentType: string; status: number };
    try {
      page = await fetchWithLimit(url.toString());
    } catch (error) {
      return {
        ok: false as const,
        reason: `The page could not be fetched: ${
          error instanceof Error ? error.message : "network error"
        }`,
      };
    }
    if (page.status === 401 || page.status === 403) {
      return {
        ok: false as const,
        reason: `The source returned HTTP ${page.status} (login or access restriction). KNOKH does not bypass access controls.`,
        alternatives: ["Ask the supplier for API access", "Use CSV/XLSX upload"],
      };
    }
    if (page.status >= 400) {
      return { ok: false as const, reason: `The source returned HTTP ${page.status}.` };
    }

    const isJson =
      page.contentType.includes("json") || page.text.trimStart().startsWith("{");
    const preview = isJson
      ? extractProductFromJson(safeJson(page.text))
      : extractProductFromHtml(page.text);

    if (!preview) {
      return {
        ok: false as const,
        reason:
          "No product data (JSON-LD, Open Graph or feed fields) could be read from that page.",
        alternatives: ["Upload the product data as CSV/XLSX", "Create the product manually"],
      };
    }

    return {
      ok: true as const,
      sourceUrl: url.toString(),
      robotsNote,
      preview: {
        ...preview,
        priceMinor: preview.priceMinor,
      },
    };
  },
});

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
