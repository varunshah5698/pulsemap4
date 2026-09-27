import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * The bookkeeping behind a fast AI layer: one place that caches structured
 * output, dedupes concurrent callers, meters spend and records feedback.
 *
 * Cache rows are keyed by `kind` + a hash of everything that went into the
 * answer, so the same question asked twice — on two pages, or by two renders —
 * is answered from the database the second time.
 */

/** A stable, dependency-free hash: enough to key a cache, nothing more. */
export function stableKey(parts: unknown): string {
  const text = typeof parts === "string" ? parts : JSON.stringify(parts);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code + index, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}${text.length.toString(36)}`;
}

export function utcDay(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Cached, ready-to-serve payload for a key — or nothing. */
export const readArtifact = internalQuery({
  args: { kind: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("aiArtifacts")
      .withIndex("by_kind_key", (q) => q.eq("kind", args.kind).eq("key", args.key))
      .first();
    if (!row) return null;
    if (row.status === "done" && row.payload !== undefined && row.expiresAt > Date.now()) {
      return {
        state: "ready" as const,
        payload: row.payload,
        model: row.model ?? null,
        createdAt: row.createdAt,
      };
    }
    if (row.status === "running" && Date.now() - row.updatedAt < 60_000) {
      return { state: "running" as const, startedAt: row.updatedAt };
    }
    if (row.status === "error" && Date.now() - row.updatedAt < 30_000) {
      return { state: "error" as const, message: row.error ?? "That did not work." };
    }
    return null;
  },
});

/**
 * Claim a key for generation. Returns `claimed: false` when somebody else is
 * already on it, which is how two components asking at once cost one call.
 */
export const claimArtifact = internalMutation({
  args: {
    kind: v.string(),
    key: v.string(),
    userId: v.optional(v.id("users")),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("aiArtifacts")
      .withIndex("by_kind_key", (q) => q.eq("kind", args.kind).eq("key", args.key))
      .first();

    if (existing) {
      if (existing.status === "done" && existing.payload !== undefined && existing.expiresAt > now) {
        return { claimed: false as const, state: "ready" as const, payload: existing.payload };
      }
      if (existing.status === "running" && now - existing.updatedAt < 60_000) {
        return { claimed: false as const, state: "running" as const };
      }
      await ctx.db.patch(existing._id, {
        status: "running",
        userId: args.userId,
        updatedAt: now,
        expiresAt: now + args.ttlMs,
        error: undefined,
      });
      return { claimed: true as const, state: "claimed" as const };
    }

    await ctx.db.insert("aiArtifacts", {
      userId: args.userId,
      kind: args.kind,
      key: args.key,
      status: "running",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + args.ttlMs,
    });
    return { claimed: true as const, state: "claimed" as const };
  },
});

export const completeArtifact = internalMutation({
  args: {
    kind: v.string(),
    key: v.string(),
    payload: v.any(),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await ctx.db
      .query("aiArtifacts")
      .withIndex("by_kind_key", (q) => q.eq("kind", args.kind).eq("key", args.key))
      .first();
    const patch = {
      status: "done" as const,
      payload: args.payload,
      model: args.model,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      error: undefined,
      updatedAt: now,
      expiresAt: now + args.ttlMs,
    };
    if (row) await ctx.db.patch(row._id, patch);
    else
      await ctx.db.insert("aiArtifacts", {
        kind: args.kind,
        key: args.key,
        createdAt: now,
        ...patch,
      });
  },
});

export const failArtifact = internalMutation({
  args: { kind: v.string(), key: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("aiArtifacts")
      .withIndex("by_kind_key", (q) => q.eq("kind", args.kind).eq("key", args.key))
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      status: "error",
      error: args.message.slice(0, 300),
      updatedAt: Date.now(),
    });
  },
});

/** Old rows are swept opportunistically, so the table cannot grow unbounded. */
export const sweepArtifacts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("aiArtifacts")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now() - 60_000))
      .take(40);
    for (const row of stale) await ctx.db.delete(row._id);
    return stale.length;
  },
});

/* --- Spend guard ----------------------------------------------------- */

export const usageToday = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiUsage")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId).eq("day", utcDay()))
      .first();
  },
});

export const bumpUsage = internalMutation({
  args: {
    userId: v.id("users"),
    field: v.union(
      v.literal("calls"),
      v.literal("cached"),
      v.literal("rejected"),
      v.literal("failures"),
    ),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const day = utcDay();
    const row = await ctx.db
      .query("aiUsage")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId).eq("day", day))
      .first();
    if (!row) {
      await ctx.db.insert("aiUsage", {
        userId: args.userId,
        day,
        calls: args.field === "calls" ? 1 : 0,
        cached: args.field === "cached" ? 1 : 0,
        rejected: args.field === "rejected" ? 1 : 0,
        failures: args.field === "failures" ? 1 : 0,
        tokensIn: args.tokensIn ?? 0,
        tokensOut: args.tokensOut ?? 0,
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(row._id, {
      calls: row.calls + (args.field === "calls" ? 1 : 0),
      cached: row.cached + (args.field === "cached" ? 1 : 0),
      rejected: row.rejected + (args.field === "rejected" ? 1 : 0),
      failures: row.failures + (args.field === "failures" ? 1 : 0),
      tokensIn: row.tokensIn + (args.tokensIn ?? 0),
      tokensOut: row.tokensOut + (args.tokensOut ?? 0),
      updatedAt: Date.now(),
    });
  },
});

/* --- Feedback -------------------------------------------------------- */

export const recordFeedback = internalMutation({
  args: {
    userId: v.id("users"),
    kind: v.string(),
    subject: v.string(),
    vote: v.union(v.literal("up"), v.literal("down"), v.literal("dismiss")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiFeedback")
      .withIndex("by_user_subject", (q) =>
        q.eq("userId", args.userId).eq("kind", args.kind).eq("subject", args.subject),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        vote: args.vote,
        reason: args.reason,
        createdAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("aiFeedback", {
      userId: args.userId,
      kind: args.kind,
      subject: args.subject,
      vote: args.vote,
      reason: args.reason,
      createdAt: Date.now(),
    });
  },
});

/** Dismissed and down-voted subjects, used to filter the next round. */
export const feedbackForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("aiFeedback")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(200);
    return rows.map((row: Doc<"aiFeedback">) => ({
      kind: row.kind,
      subject: row.subject,
      vote: row.vote,
      reason: row.reason ?? null,
    }));
  },
});
