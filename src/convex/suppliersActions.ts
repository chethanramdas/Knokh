"use node";

/**
 * Supplier automation actions (Node runtime).
 *
 * Only connectors marked `implemented: true` in `suppliers.CONNECTORS` reach
 * the network here. Everything else fails with an explicit explanation so an
 * unimplemented integration can never look operational.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { feedRowsToItems } from "./lib/feed";
import { envValue } from "./lib/gateways";
import { CONNECTORS } from "./suppliers";

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object" && Array.isArray((value as any).products)) {
    return (value as any).products as Record<string, unknown>[];
  }
  if (value && typeof value === "object" && Array.isArray((value as any).items)) {
    return (value as any).items as Record<string, unknown>[];
  }
  return [];
}

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const splitRow = (line: string) => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        cells.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  };
  const headers = splitRow(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index]?.trim() ?? "";
    });
    return row;
  });
}

async function fetchFeed(connector: string): Promise<Record<string, unknown>[]> {
  const url = envValue("SUPPLIER_FEED_URL");
  const token = envValue("SUPPLIER_FEED_TOKEN");
  if (!url) {
    throw new Error(
      "SUPPLIER_FEED_URL is not configured. Set it on the deployment to enable the catalog feed connector.",
    );
  }
  if (connector !== "feed_url") {
    throw new Error(
      `The "${connector}" connector is registered but its request layer is not implemented in this codebase. See the setup notes in Admin → Suppliers.`,
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`The feed responded with HTTP ${response.status}.`);
    }
    const text = await response.text();
    if (text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
      return asArray(JSON.parse(text));
    }
    return parseCsv(text);
  } finally {
    clearTimeout(timer);
  }
}

type SyncOutcome = {
  ok: boolean;
  reason?: string;
  costChanges?: number;
  stockChanges?: number;
  unmatched?: number;
  hidden?: number;
  priceAlerts?: number;
};

export const runSyncJob = internalAction({
  args: {
    jobId: v.id("supplier_sync_jobs"),
    supplierId: v.id("suppliers"),
    updateCost: v.optional(v.boolean()),
    updateStock: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SyncOutcome> => {
    try {
      const rows = await fetchFeed("feed_url");
      const items = feedRowsToItems(rows);
      if (items.length === 0) {
        await ctx.runMutation(internal.suppliers.markSyncJobResult, {
          jobId: args.jobId,
          status: "failed",
          error: "The feed contained no readable product rows.",
        });
        return { ok: false, reason: "The feed contained no readable product rows." };
      }
      const result: {
        costChanges: number;
        stockChanges: number;
        unmatched: number;
        hidden: number;
        priceAlerts: number;
      } = await ctx.runMutation(internal.suppliers.applyFeedItems, {
        jobId: args.jobId,
        supplierId: args.supplierId,
        items,
        updateCost: args.updateCost ?? true,
        updateStock: args.updateStock ?? true,
      });
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      await ctx.runMutation(internal.suppliers.markSyncJobResult, {
        jobId: args.jobId,
        status: "failed",
        error: message,
      });
      return { ok: false, reason: message };
    }
  },
});

/** Scheduled entry point: runs any queued sync jobs (see crons.ts). */
type DueJob = {
  _id: Id<"supplier_sync_jobs">;
  supplierId: Id<"suppliers">;
  connector: string;
  type: string;
};

export const runDueSyncJobs = internalAction({
  args: {},
  handler: async (ctx): Promise<{ processed: number; results: string[] }> => {
    const jobs: DueJob[] = await ctx.runQuery(internal.suppliers_queue.dueSyncJobs, {});
    const results: string[] = [];
    for (const job of jobs) {
      const connector = CONNECTORS.find((entry) => entry.id === job.connector);
      const missing = (connector?.envVars ?? []).filter((key) => !process.env[key]);
      if (!connector?.implemented || missing.length > 0) {
        await ctx.runMutation(internal.suppliers.markSyncJobResult, {
          jobId: job._id,
          status: "skipped_not_configured",
          error: !connector?.implemented
            ? `Connector "${connector?.label ?? job.connector}" is not implemented.`
            : `Missing environment variable(s): ${missing.join(", ")}`,
        });
        results.push(`${job._id}: skipped (${connector?.id ?? job.connector})`);
        continue;
      }
      const outcome: SyncOutcome = await ctx.runAction(
        internal.suppliersActions.runSyncJob,
        {
          jobId: job._id,
          supplierId: job.supplierId,
          updateCost: true,
          updateStock: true,
        },
      );
      results.push(`${job._id}: ${outcome.ok ? "succeeded" : "failed"}`);
    }
    return { processed: jobs.length, results };
  },
});

/**
 * Forwards an order group to a supplier.
 *
 * No connector in this repository currently advertises a live order API, so
 * this always records an explicit manual-fulfilment task with a reason. The
 * plumbing (idempotency key, attempts, retries) is in place for the day a
 * connector is implemented and tested against a real account.
 */
type ForwardOutcome = { ok: boolean; duplicate?: boolean; reason?: string };

export const forwardSupplierOrder = action({
  args: { supplierOrderId: v.id("supplier_orders") },
  handler: async (ctx, args): Promise<ForwardOutcome> => {
    const details: {
      connector: string;
      supplierName: string;
      apiStatus: string;
      orderNumber: string;
      alreadySubmitted: boolean;
    } | null = await ctx.runQuery(
      internal.suppliers_queue.supplierOrderDetails,
      { supplierOrderId: args.supplierOrderId },
    );
    if (!details) return { ok: false, reason: "Supplier order not found." };
    if (details.alreadySubmitted) {
      return { ok: true, duplicate: true, reason: "Already submitted (idempotency key reused)." };
    }
    const connector = CONNECTORS.find((entry) => entry.id === details.connector);
    if (!connector?.implemented || !connector.supportsOrderApi) {
      await ctx.runMutation(internal.suppliers_queue.markManualFulfilment, {
        supplierOrderId: args.supplierOrderId,
        reason: `Automated order submission is not available for the "${connector?.label ?? details.connector}" connector${
          connector?.implemented ? " (no order API)" : " (not implemented in this codebase)"
        }. Fulfil this order manually and add the tracking number.`,
      });
      return { ok: false, reason: "Manual fulfilment required." };
    }
    await ctx.runMutation(internal.suppliers_queue.markManualFulfilment, {
      supplierOrderId: args.supplierOrderId,
      reason:
        "Connector advertises an order API but the request mapping for this account has not been verified yet, so KNOKH refused to send an unverified order.",
    });
    return { ok: false, reason: "Connector not verified." };
  },
});

export type SupplierOrderId = Id<"supplier_orders">;
