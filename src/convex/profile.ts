import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { brief, guard, identity, type ContextBundle } from "./ai/context";
import { structured } from "./ai/provider";
import { MemoryAnalysisSchema, TravelProfileSchema, type Affinity } from "./ai/schemas";
import { deterministicInsights, evidenceFor, signals, type Tally } from "./ai/stats";
import { stableKey } from "./ai/store";

/**
 * Understanding the traveller.
 *
 * Two passes, both incremental:
 *
 *  1. `analyse` reads memories that have not been read before (or that have
 *     changed) and writes a structured, confidence-scored analysis for each.
 *     Only a handful per run, so a large archive costs a few calls, not a bill.
 *  2. `build` distils those analyses plus counts into one profile that every
 *     other feature reads. The model writes the prose and weights; the counts
 *     stay in the row as evidence, so a stated taste always has receipts.
 */

/** A profile is rebuilt when it is this old, or when the history underneath moves. */
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Memory analyses are good for a long time; memories do not change day to day. */
const ANALYSIS_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** How many memories one run will read. Bounded on purpose. */
const ANALYSIS_BATCH = 6;
/** Nothing smaller than this is worth asserting as a preference. */
const MIN_EVIDENCE_COUNT = 2;

/* Explicit result shapes: the client and the generated API both read these. */
export type AnalyseResult = { analysed: number; remaining: number; message?: string };
export type BuildResult =
  | { ok: true; model: string; preferences: number }
  | { ok: false; message: string; reason: string };
export type EnsureResult =
  | {
      ok: true;
      state: string;
      analysed: number;
      model?: string;
      profileBuiltAt?: number | null;
    }
  | { ok: false; message: string; reason: string };

export function memoryHash(memory: Doc<"memories">): string {
  return stableKey([
    memory.title,
    memory.note,
    memory.placeName,
    memory.tags.join("|"),
    memory.mediaId ?? null,
    Math.floor(memory.happenedAt / 86_400_000),
  ]);
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/* --- Pass one: reading memories ------------------------------------- */

export const saveInsight = internalMutation({
  args: {
    userId: v.id("users"),
    memoryId: v.id("memories"),
    payload: v.any(),
    sourceHash: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const payload = args.payload as {
      destinationType: string;
      activities: string[];
      interests: string[];
      environment: string[];
      season?: string;
      travelStyle: string[];
      inferred: { preference: string; confidence: number; evidence: string }[];
      summary: string;
      confidence: number;
    };

    const existing = await ctx.db
      .query("memoryInsights")
      .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
      .first();

    const row = {
      userId: args.userId,
      memoryId: args.memoryId,
      destinationType: payload.destinationType,
      activities: payload.activities,
      interests: payload.interests,
      environment: payload.environment,
      season: payload.season,
      travelStyle: payload.travelStyle,
      inferred: payload.inferred,
      summary: payload.summary,
      confidence: payload.confidence,
      model: args.model,
      sourceHash: args.sourceHash,
      analyzedAt: Date.now(),
    };

    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("memoryInsights", row);
  },
});

/** Memories with no analysis yet, or with one that no longer matches them. */
export const pending = internalQuery({
  args: { userId: v.id("users"), limit: v.number() },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(120);

    const insights = await ctx.db
      .query("memoryInsights")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(160);
    const byMemory = new Map(insights.map((insight) => [insight.memoryId as string, insight]));

    return memories
      .filter((memory) => {
        const insight = byMemory.get(memory._id as string);
        if (!insight) return true;
        if (insight.sourceHash !== memoryHash(memory)) return true;
        return Date.now() - insight.analyzedAt > ANALYSIS_TTL_MS;
      })
      .slice(0, args.limit);
  },
});

/**
 * Read a few memories at a time. Each call sees exactly one memory, which keeps
 * the model honest — no chance of it blending two trips into one story.
 */
export const analyse = internalAction({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<AnalyseResult> => {
    const userId = args.userId;
    const memories: Doc<"memories">[] = await ctx.runQuery(internal.profile.pending, {
      userId,
      limit: args.limit ?? ANALYSIS_BATCH,
    });
    if (memories.length === 0) return { analysed: 0, remaining: 0, message: "Already up to date." };

    let analysed = 0;
    let lastMessage = "";

    for (const memory of memories) {
      const when = new Date(memory.happenedAt);
      const result = await structured({
        kind: "memory.analysis",
        schema: MemoryAnalysisSchema,
        schemaName: "MemoryAnalysis",
        system:
          "You describe one travel memory in structured terms so a travel app can learn from it. " +
          "Use only what the memory itself says: its title, note, place, date and tags. " +
          "Confidence must reflect how much evidence there really is — a bare title is low confidence. " +
          "Inference is always marked as inference; never state a preference as a fact.",
        messages: [
          {
            role: "user",
            content: [
              `Title: ${memory.title}`,
              `Place: ${memory.placeName}`,
              `Date: ${when.toISOString().slice(0, 10)} (${when.toLocaleString("en", { month: "long", timeZone: "UTC" })})`,
              `Note: ${memory.note || "(none)"}`,
              `Tags: ${memory.tags.join(", ") || "(none)"}`,
              `Photo attached: ${memory.mediaId ? "yes" : "no"}`,
            ].join("\n"),
          },
        ],
        maxOutputTokens: 700,
        temperature: 0.3,
      });

      if (!result.ok) {
        lastMessage = result.message;
        await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "failures" });
        continue;
      }

      await ctx.runMutation(internal.ai.store.bumpUsage, {
        userId,
        field: "calls",
        tokensIn: result.usage.in,
        tokensOut: result.usage.out,
      });
      await ctx.runMutation(internal.profile.saveInsight, {
        userId,
        memoryId: memory._id,
        payload: result.data,
        sourceHash: memoryHash(memory),
        model: result.model,
      });
      analysed += 1;
    }

    return { analysed, remaining: Math.max(0, memories.length - analysed), message: lastMessage || undefined };
  },
});


/* --- Pass two: distilling the profile ------------------------------- */

/** Turn counted signals into affinities, so evidence survives a terse model. */
function affinitiesFromTallies(
  rows: Tally[],
  bundle: ContextBundle,
  kind: "preference" | "destination",
): Affinity[] {
  return rows
    .filter((row) => row.count >= MIN_EVIDENCE_COUNT)
    .slice(0, 10)
    .map((row) => ({
      key: row.key,
      label: titleCase(row.key),
      weight: Math.min(1, Number(row.share.toFixed(2))),
      confidence: Math.min(1, Number((0.35 + row.count / 10).toFixed(2))),
      evidence:
        kind === "preference"
          ? [`${row.count} memories read as ${row.key}`, ...evidenceFor(bundle, row.key)].slice(0, 4)
          : [`${row.count} memories are ${row.key}`, ...evidenceFor(bundle, row.key)].slice(0, 4),
    }));
}

function mergeAffinities(
  fromModel: Affinity[],
  fromCounts: Affinity[],
  limit: number,
): Affinity[] {
  const merged = new Map<string, Affinity>();
  for (const item of fromModel) {
    merged.set(item.key.toLowerCase(), {
      key: item.key.toLowerCase(),
      label: item.label,
      weight: Math.max(0, Math.min(1, item.weight)),
      confidence: Math.max(0, Math.min(1, item.confidence)),
      evidence: item.evidence.slice(0, 4),
    });
  }
  for (const item of fromCounts) {
    const existing = merged.get(item.key);
    if (existing) {
      merged.set(item.key, {
        ...existing,
        // Counts are facts; the model's weighting is an opinion. Blend them.
        weight: Number(Math.min(1, (existing.weight + item.weight) / 2).toFixed(2)),
        evidence: Array.from(new Set([...existing.evidence, ...item.evidence])).slice(0, 4),
      });
    } else {
      merged.set(item.key, item);
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

export const saveProfile = internalMutation({
  args: { userId: v.id("users"), payload: v.any(), derivedFrom: v.any(), model: v.string() },
  handler: async (ctx, args) => {
    const payload = args.payload as {
      preferences: Affinity[];
      destinationAffinities: Affinity[];
      stats: ContextBundle["stats"];
      countries: { name: string; count: number; lastAt: number }[];
      cities: { name: string; count: number; lastAt: number }[];
      seasonal: string[];
      pace?: string;
      budgetLean?: string;
      summary: string;
      model: string;
    };
    const row = {
      userId: args.userId,
      preferences: payload.preferences,
      destinationAffinities: payload.destinationAffinities,
      countries: payload.countries,
      cities: payload.cities,
      seasonal: payload.seasonal,
      pace: payload.pace,
      budgetLean: payload.budgetLean,
      stats: payload.stats,
      derivedFrom: args.derivedFrom as {
        memories: number;
        insights: number;
        trips: number;
        saves: number;
        feedback: number;
      },
      summary: payload.summary,
      model: args.model,
      builtAt: Date.now(),
    };
    const existing = await ctx.db
      .query("travelProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("travelProfiles", row);
  },
});

/** One model call that turns counted signals into a readable profile. */
export const build = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<BuildResult> => {
    const bundle: ContextBundle = await ctx.runQuery(internal.ai.context.load, { userId: args.userId });
    const counted = signals(bundle);
    const insights = deterministicInsights(bundle);

    const result = await structured({
      kind: "profile.build",
      schema: TravelProfileSchema,
      schemaName: "TravelProfile",
      system:
        "You distil a traveller's history into a structured profile for a travel app. " +
        "Ground every preference in the supplied counts: do not invent interests, countries or trips. " +
        "Weights are 0-1 and confidence reflects how much evidence exists. " +
        "Evidence entries must name the memories or counts that support the claim. " +
        "If the history is thin, say so through low confidence rather than filler.",
      messages: [
        {
          role: "user",
          content: [
            brief(bundle, { memoryLimit: 30 }),
            "",
            "Counted signals (facts):",
            counted.summary,
            "",
            insights.length > 0
              ? `Already computed insights:\n${insights.map((item) => `- ${item.text} (${item.evidence})`).join("\n")}`
              : "No computed insights yet.",
          ].join("\n"),
        },
      ],
      maxOutputTokens: 1100,
      temperature: 0.35,
    });

    if (!result.ok) {
      await ctx.runMutation(internal.ai.store.bumpUsage, { userId: args.userId, field: "failures" });
      return { ok: false, message: result.message, reason: result.reason };
    }

    await ctx.runMutation(internal.ai.store.bumpUsage, {
      userId: args.userId,
      field: "calls",
      tokensIn: result.usage.in,
      tokensOut: result.usage.out,
    });

    const profile = result.data;
    await ctx.runMutation(internal.profile.saveProfile, {
      userId: args.userId,
      model: result.model,
      derivedFrom: {
        memories: bundle.stats.memories,
        insights: bundle.insights.length,
        trips: bundle.stats.trips,
        saves: bundle.stats.savedPlaces,
        feedback: bundle.feedback.length,
      },
      payload: {
        preferences: mergeAffinities(
          profile.preferences,
          affinitiesFromTallies(
            [...counted.interests, ...counted.environments, ...counted.activities].filter(
              (row, index, all) =>
                all.findIndex((candidate) => candidate.key === row.key) === index,
            ),
            bundle,
            "preference",
          ),
          14,
        ),
        destinationAffinities: mergeAffinities(
          profile.destinationAffinities,
          affinitiesFromTallies(counted.destinationTypes, bundle, "destination"),
          14,
        ),
        stats: bundle.stats,
        countries: bundle.countries.slice(0, 12),
        cities: bundle.cities.slice(0, 12),
        seasonal: profile.seasonal.slice(0, 6),
        pace: profile.pace,
        budgetLean: profile.budgetLean,
        summary: profile.summary,
      },
    });

    return { ok: true, model: result.model, preferences: profile.preferences.length };
  },
});

/* --- Public surface -------------------------------------------------- */

/** Is the stored profile still true of the history underneath it? */
function profileIsStale(bundle: ContextBundle): boolean {
  const profile = bundle.profile;
  if (!profile) return true;
  const derived = profile.derivedFrom;
  if (derived.memories !== bundle.stats.memories) return true;
  if (derived.trips !== bundle.stats.trips) return true;
  if (derived.saves !== bundle.stats.savedPlaces) return true;
  if (Math.abs(derived.insights - bundle.insights.length) > 1) return true;
  return Date.now() - profile.builtAt > PROFILE_TTL_MS;
}

/**
 * Called when a signed-in screen opens. Reads any new memories, then rebuilds
 * the profile if the history moved. Cheap when nothing changed: the artifact
 * claim turns concurrent callers into one run.
 */
export const ensure = action({
  args: { analyse: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<EnsureResult> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message, reason: "unavailable" };
    const userId = who.userId;

    const blocked = await guard(ctx, userId);
    if (blocked) return { ok: false, message: blocked.message, reason: blocked.reason ?? "unavailable" };

    const bundle: ContextBundle = await ctx.runQuery(internal.ai.context.load, { userId });

    let analysed = 0;
    if (args.analyse !== false && bundle.insights.length < bundle.stats.memories) {
      const reading: AnalyseResult = await ctx.runAction(internal.profile.analyse, { userId });
      analysed = reading.analysed;
    }

    const after: ContextBundle =
      analysed > 0 ? await ctx.runQuery(internal.ai.context.load, { userId }) : bundle;
    if (!profileIsStale(after)) {
      await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "cached" });
      return { ok: true, state: "fresh", analysed, profileBuiltAt: after.profile?.builtAt ?? null };
    }

    const key = stableKey([
      after.stats.memories,
      after.insights.length,
      after.stats.trips,
      after.stats.savedPlaces,
      after.feedback.length,
    ]);
    const claim = await ctx.runMutation(internal.ai.store.claimArtifact, {
      kind: "profile",
      key: `${userId}:${key}`,
      userId,
      ttlMs: PROFILE_TTL_MS,
    });
    if (!claim.claimed) {
      await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "cached" });
      return { ok: true, state: claim.state, analysed };
    }

    const built: BuildResult = await ctx.runAction(internal.profile.build, { userId });
    if (!built.ok) {
      await ctx.runMutation(internal.ai.store.failArtifact, {
        kind: "profile",
        key: `${userId}:${key}`,
        message: built.message,
      });
      return { ok: false, reason: built.reason, message: built.message };
    }

    await ctx.runMutation(internal.ai.store.completeArtifact, {
      kind: "profile",
      key: `${userId}:${key}`,
      payload: { model: built.model },
      model: built.model,
      ttlMs: PROFILE_TTL_MS,
    });

    return { ok: true, state: "built", analysed, model: built.model };
  },
});

/** The profile as the interface reads it: no model call, purely a read. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    // A reactive read: when the profile row changes, every surface updates.
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db
      .query("travelProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const insights = await ctx.db
      .query("memoryInsights")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(60);

    return {
      profile,
      insightCount: insights.length,
      /** The newest analyses, for memory connections and memory pages. */
      recentInsights: insights.slice(0, 8).map((insight) => ({
        memoryId: insight.memoryId as Id<"memories">,
        destinationType: insight.destinationType,
        interests: insight.interests,
        environment: insight.environment,
        inferred: insight.inferred,
        summary: insight.summary,
        confidence: insight.confidence,
      })),
    };
  },
});

/** One memory, for connection work that must not trust a client-supplied id. */
export const memoryForConnection = internalQuery({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.memoryId);
  },
});

/** Analysis for one memory, for the memory page. */
export const insightFor = internalQuery({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("memoryInsights")
      .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
      .first();
  },
});
