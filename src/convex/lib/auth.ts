import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/**
 * Returns the signed-in user document, or null. Never throws, so it is safe to
 * use in queries that must also render for signed-out visitors.
 */
export async function getUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.get(userId);
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getUser(ctx);
  if (!user) {
    throw new Error("You must be signed in to do that.");
  }
  return user;
}

/**
 * Authorization is enforced here, on the server, for every admin operation.
 * Hiding a button in the UI is never treated as security.
 */
export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new Error("Admin access required.");
  }
  return user;
}

export async function isAdmin(ctx: Ctx): Promise<boolean> {
  const user = await getUser(ctx);
  return user?.role === "admin";
}

/**
 * Stable per-visitor key for carts / recently viewed.
 *
 * Signed-in users are keyed by their user id (so their cart follows them across
 * devices). Guests pass a client-generated key that is scoped to "anon:" so a
 * guest can never read another account's cart.
 */
export function resolveOwnerKey(
  userId: Id<"users"> | null,
  guestKey?: string,
): string {
  if (userId) return `user:${userId}`;
  if (guestKey && /^[a-zA-Z0-9-]{8,64}$/.test(guestKey)) return `anon:${guestKey}`;
  throw new Error("A valid cart session key is required.");
}

export async function writeAuditLog(
  ctx: MutationCtx,
  entry: {
    actorId?: Id<"users">;
    actorEmail?: string;
    action: string;
    entity: string;
    entityId?: string;
    summary?: string;
    metadata?: unknown;
  },
) {
  await ctx.db.insert("audit_logs", {
    actorId: entry.actorId,
    actorEmail: entry.actorEmail,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    summary: entry.summary,
    metadata:
      entry.metadata === undefined ? undefined : JSON.stringify(entry.metadata),
    createdAt: Date.now(),
  });
}

export async function notifyUser(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    type: string;
    title: string;
    body: string;
    link?: string;
    orderId?: Id<"orders">;
  },
) {
  await ctx.db.insert("notifications", {
    audience: "user",
    userId: args.userId,
    type: args.type,
    title: args.title,
    body: args.body,
    link: args.link,
    orderId: args.orderId,
    createdAt: Date.now(),
  });
}

export async function notifyAdmins(
  ctx: MutationCtx,
  args: { type: string; title: string; body: string; link?: string },
) {
  await ctx.db.insert("notifications", {
    audience: "admin",
    type: args.type,
    title: args.title,
    body: args.body,
    link: args.link,
    createdAt: Date.now(),
  });
}
