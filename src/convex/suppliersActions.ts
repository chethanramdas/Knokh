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
import { CONNECTORS } from "./lib/supplierConnectors";
import { publicGet } from "./lib/publicHttp";
import { parseCsvRecords } from "./lib/supplierFeed";

async function fetchFeed(): Promise<Record<string, unknown>[]> {
  const url = envValue("SUPPLIER_FEED_URL");
  if (!url) throw new Error("SUPPLIER_FEED_URL is not configured.");
  const response = await publicGet(url, {
    token: envValue("SUPPLIER_FEED_TOKEN") || undefined,
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Feed returned HTTP ${response.status}.`);
  let rows: unknown;
  if (
    response.text.trimStart().startsWith("{") ||
    response.text.trimStart().startsWith("[")
  ) {
    const parsed: unknown = JSON.parse(response.text);
    rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? "products" in parsed
          ? parsed.products
          : "items" in parsed
            ? parsed.items
            : null
        : null;
  } else rows = parseCsvRecords(response.text);
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > 250 ||
    rows.some((r) => !r || typeof r !== "object" || Array.isArray(r))
  )
    throw new Error(
      "Feed must contain 1–250 object rows. Split larger feeds into authorised batches or use spreadsheet imports.",
    );
  return rows as Record<string, unknown>[];
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
      const active = await ctx.runMutation(internal.suppliers.claimSyncJob, {
        jobId: args.jobId,
        supplierId: args.supplierId,
      });
      if (!active)
        return {
          ok: false,
          reason: "Job is not queued for an active feed supplier.",
        };
      const rows = await fetchFeed();
      const items = feedRowsToItems(rows);
      if (items.length === 0) {
        await ctx.runMutation(internal.suppliers.markSyncJobResult, {
          jobId: args.jobId,
          status: "failed",
          error: "The feed contained no readable product rows.",
        });
        return {
          ok: false,
          reason: "The feed contained no readable product rows.",
        };
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
      const message =
        error instanceof Error ? error.message : "Unknown sync error";
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
    const jobs: DueJob[] = await ctx.runQuery(
      internal.suppliers_queue.dueSyncJobs,
      {},
    );
    const results: string[] = [];
    for (const job of jobs) {
      const connector = CONNECTORS.find((entry) => entry.id === job.connector);
      const missing = (connector?.envVars ?? []).filter(
        (key) => !process.env[key],
      );
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
          updateCost: job.type !== "stock",
          updateStock: job.type !== "price",
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
    await ctx.runQuery(internal.suppliers_queue.authorizeForward, {});
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
      return {
        ok: true,
        duplicate: true,
        reason: "Already submitted (idempotency key reused).",
      };
    }
    const connector = CONNECTORS.find(
      (entry) => entry.id === details.connector,
    );
    if (!connector?.implemented || !connector.supportsOrderApi) {
      await ctx.runMutation(internal.suppliers_queue.markManualFulfilment, {
        supplierOrderId: args.supplierOrderId,
        reason: `Automated order submission is not available for the "${connector?.label ?? details.connector}" connector${
          connector?.implemented
            ? " (no order API)"
            : " (not implemented in this codebase)"
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
