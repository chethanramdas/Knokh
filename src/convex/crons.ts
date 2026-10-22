import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Supplier synchronisation. Jobs whose connector is unimplemented or whose
 * credentials are missing are marked `skipped_not_configured` with the reason,
 * never silently ignored.
 */
crons.interval(
  "supplier catalog sync",
  { minutes: 30 },
  internal.suppliersActions.runDueSyncJobs,
  {},
);

/** Housekeeping: retire carts that have been idle for 30+ days. */
crons.daily(
  "retire stale carts",
  { hourUTC: 2, minuteUTC: 30 },
  internal.suppliers_queue.retireStaleCarts,
  {},
);

export default crons;
