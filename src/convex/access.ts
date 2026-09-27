import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ROLES } from "./schema";

type Ctx = QueryCtx | MutationCtx;

/** The signed-in user document, or null when nobody is signed in. */
export async function currentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.get(userId);
}

/** Throws a friendly error for signed-out callers. */
export async function requireUserId(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Please sign in to continue.");
  return userId;
}

export async function isAdmin(ctx: Ctx): Promise<boolean> {
  const user = await currentUser(ctx);
  return user?.role === ROLES.ADMIN;
}

/** Display name that reads well in lists. */
export function displayName(user: Doc<"users"> | null): string {
  if (!user) return "Someone";
  if (user.name?.trim()) return user.name.trim();
  if (user.email?.trim()) return user.email.split("@")[0];
  return "Anonymous traveller";
}
