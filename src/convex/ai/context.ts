import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { haversineKm } from "./geo";
import type { AIUnavailable } from "./schemas";
import { utcDay } from "./store";

/**
 * One brain, one context.
 *
 * Every AI feature — the assistant, the dashboard brief, place explanations,
 * trip planning — reads the same bundle of real user data through this module.
 * That is what stops "AI on the dashboard" and "AI in the chat" from becoming
 * two different products with two different opinions about the same person.
 *
 * The bundle is deliberately compressed: interests and counts, not whole
 * memories, because a profile that has already been distilled does not need the
 * raw archive shipped to a model on every call.
 */

/** Hard ceiling on model calls per person per day, across every surface. */
export const DAILY_AI_CALL_LIMIT = 240;
/** How much raw history is worth sending: enough to reason, not to dump. */
const MEMORY_LIMIT = 60;
const SAVED_LIMIT = 24;
const TRIP_LIMIT = 8;
const INSIGHT_LIMIT = 60;

export type RegionRef = { city: string | null; country: string | null };

/**
 * Places arrive as "Kyoto, Japan" or "Fushimi Inari, Kyoto, Japan". The last
 * part is the country, the one before it is the city; anything less is left
 * unknown rather than guessed at.
 */
export function parseRegion(placeName: string): RegionRef {
  const parts = placeName
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { city: null, country: null };
  if (parts.length === 1) return { city: parts[0], country: null };
  return { city: parts[parts.length - 2], country: parts[parts.length - 1] };
}

export type ContextBundle = {
  userId: Id<"users">;
  displayName: string;
  profile: Doc<"travelProfiles"> | null;
  memories: Doc<"memories">[];
  saved: Doc<"memories">[];
  trips: Doc<"trips">[];
  tripItems: Doc<"tripItems">[];
  insights: Doc<"memoryInsights">[];
  feedback: { kind: string; subject: string; vote: string; reason: string | null }[];
  countries: { name: string; count: number; lastAt: number }[];
  cities: { name: string; count: number; lastAt: number }[];
  stats: {
    memories: number;
    withPhotos: number;
    countries: number;
    cities: number;
    savedPlaces: number;
    trips: number;
    avgTripDays: number;
    firstAt?: number;
    lastAt?: number;
    monthsActive: number;
  };
  /** Mean position of the person's own memories — their centre of gravity. */
  centroid: { lat: number; lng: number } | null;
  memberSince: number;
};

/** Everything the intelligence layer is allowed to know about one person. */
export const load = internalQuery({
  args: {
    userId: v.id("users"),
    memoryLimit: v.optional(v.number()),
    insightLimit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ContextBundle> => {
    const userId = args.userId;
    const user = await ctx.db.get(userId);

    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.memoryLimit ?? MEMORY_LIMIT);

    const trips = await ctx.db
      .query("trips")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(TRIP_LIMIT);

    const insights = await ctx.db
      .query("memoryInsights")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.insightLimit ?? INSIGHT_LIMIT);

    const profile = await ctx.db
      .query("travelProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const feedback = await ctx.runQuery(internal.ai.store.feedbackForUser, { userId });

    const tripItems: Doc<"tripItems">[] = [];
    for (const trip of trips.slice(0, 3)) {
      const items = await ctx.db
        .query("tripItems")
        .withIndex("by_trip", (q) => q.eq("tripId", trip._id))
        .take(14);
      tripItems.push(...items);
    }

    // Saved places are memories that were saved from a real Google place, which
    // is why the tag is the source of truth rather than a second table.
    const saved = memories.filter((memory) => memory.tags.includes("saved")).slice(0, SAVED_LIMIT);

    const countryCounts = new Map<string, { count: number; lastAt: number }>();
    const cityCounts = new Map<string, { count: number; lastAt: number }>();
    for (const memory of memories) {
      const region = parseRegion(memory.placeName);
      if (region.country) {
        const row = countryCounts.get(region.country) ?? { count: 0, lastAt: 0 };
        countryCounts.set(region.country, {
          count: row.count + 1,
          lastAt: Math.max(row.lastAt, memory.happenedAt),
        });
      }
      if (region.city) {
        const row = cityCounts.get(region.city) ?? { count: 0, lastAt: 0 };
        cityCounts.set(region.city, {
          count: row.count + 1,
          lastAt: Math.max(row.lastAt, memory.happenedAt),
        });
      }
    }

    const months = new Set(memories.map((memory) => new Date(memory.happenedAt).toISOString().slice(0, 7)));
    const timestamps = memories.map((memory) => memory.happenedAt).sort((a, b) => a - b);
    const tripDays = trips
      .filter((trip) => typeof trip.startsAt === "number" && typeof trip.endsAt === "number")
      .map((trip) => Math.max(1, Math.round(((trip.endsAt as number) - (trip.startsAt as number)) / 86_400_000)));

    const centroid =
      memories.length > 0
        ? {
            lat: memories.reduce((sum, memory) => sum + memory.lat, 0) / memories.length,
            lng: memories.reduce((sum, memory) => sum + memory.lng, 0) / memories.length,
          }
        : null;

    return {
      userId,
      displayName: user?.name ?? user?.email?.split("@")[0] ?? "traveller",
      profile,
      memories,
      saved,
      trips,
      tripItems,
      insights,
      feedback,
      countries: Array.from(countryCounts.entries())
        .map(([name, row]) => ({ name, ...row }))
        .sort((a, b) => b.count - a.count),
      cities: Array.from(cityCounts.entries())
        .map(([name, row]) => ({ name, ...row }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 16),
      stats: {
        memories: memories.length,
        withPhotos: memories.filter((memory) => memory.mediaId !== undefined).length,
        countries: countryCounts.size,
        cities: cityCounts.size,
        savedPlaces: saved.length,
        trips: trips.length,
        avgTripDays:
          tripDays.length > 0 ? Math.round(tripDays.reduce((sum, days) => sum + days, 0) / tripDays.length) : 0,
        firstAt: timestamps[0],
        lastAt: timestamps[timestamps.length - 1],
        monthsActive: months.size,
      },
      centroid,
      memberSince: user?._creationTime ?? Date.now(),
    };
  },
});

/** The compressed, prompt-ready view of that bundle. */
export function brief(bundle: ContextBundle, options?: { memoryLimit?: number }): string {
  const memoryLimit = options?.memoryLimit ?? 24;
  const lines: string[] = [];

  lines.push(`Traveller: ${bundle.displayName}`);
  lines.push(
    `History: ${bundle.stats.memories} memories across ${bundle.stats.countries} countries and ${bundle.stats.cities} cities; ${bundle.stats.trips} trips; ${bundle.stats.savedPlaces} saved places.`,
  );
  if (bundle.stats.firstAt && bundle.stats.lastAt) {
    const first = new Date(bundle.stats.firstAt).toISOString().slice(0, 10);
    const last = new Date(bundle.stats.lastAt).toISOString().slice(0, 10);
    lines.push(`Active between ${first} and ${last}.`);
  }
  if (bundle.countries.length > 0) {
    lines.push(
      `Countries visited: ${bundle.countries
        .slice(0, 10)
        .map((row) => `${row.name} (${row.count})`)
        .join(", ")}.`,
    );
  }
  if (bundle.cities.length > 0) {
    lines.push(`Cities: ${bundle.cities.slice(0, 12).map((row) => row.name).join(", ")}.`);
  }

  const preferences = bundle.profile?.preferences ?? [];
  if (preferences.length > 0) {
    lines.push(
      `Known tastes (weight 0-1): ${preferences
        .slice(0, 10)
        .map((item) => `${item.label} ${item.weight.toFixed(2)}`)
        .join(", ")}.`,
    );
  }
  const affinities = bundle.profile?.destinationAffinities ?? [];
  if (affinities.length > 0) {
    lines.push(`Places they lean toward: ${affinities.slice(0, 8).map((item) => item.label).join(", ")}.`);
  }
  if (bundle.profile?.summary) lines.push(`Profile summary: ${bundle.profile.summary}`);
  if (bundle.profile?.seasonal?.length) lines.push(`Seasonal notes: ${bundle.profile.seasonal.join(" | ")}`);

  const insightLines = bundle.insights.slice(0, 20).map((insight) => {
    const memory = bundle.memories.find((item) => item._id === insight.memoryId);
    const where = memory ? memory.placeName : "unknown place";
    const tried = insight.inferred
      .slice(0, 2)
      .map((item) => `${item.preference} (${Math.round(item.confidence * 100)}%)`)
      .join(", ");
    return `- ${where}: ${insight.destinationType}; activities ${insight.activities.slice(0, 3).join("/") || "n/a"}${tried ? `; inferred ${tried}` : ""}`;
  });
  if (insightLines.length > 0) lines.push(`Memory analysis:\n${insightLines.join("\n")}`);

  const recent = bundle.memories.slice(0, memoryLimit).map((memory) => {
    const when = new Date(memory.happenedAt).toISOString().slice(0, 7);
    const tags = memory.tags.filter((tag) => tag !== "saved").slice(0, 4).join(", ");
    return `- ${when} · ${memory.placeName} · "${memory.title}"${tags ? ` · ${tags}` : ""}${memory.mediaId ? " · has a photo" : ""}`;
  });
  if (recent.length > 0) lines.push(`Recent memories:\n${recent.join("\n")}`);

  const savedLines = bundle.saved.slice(0, 12).map((memory) => `- ${memory.title} · ${memory.placeName}`);
  if (savedLines.length > 0) lines.push(`Saved places (they have not been):\n${savedLines.join("\n")}`);

  const tripLines = bundle.trips.map((trip) => {
    const when = trip.startsAt ? new Date(trip.startsAt).toISOString().slice(0, 10) : "dates open";
    return `- ${trip.title} → ${trip.destination} (${trip.status}, ${when}, ${trip.budgetMode})`;
  });
  if (tripLines.length > 0) lines.push(`Trips:\n${tripLines.join("\n")}`);

  const dismissed = bundle.feedback.filter((row) => row.vote !== "up").slice(0, 10);
  if (dismissed.length > 0) {
    lines.push(
      `Them saying no: ${dismissed.map((row) => `${row.kind}:${row.subject}`).join(", ")}. Do not suggest these again.`,
    );
  }

  return lines.join("\n");
}

/** Distance from the person's centre of gravity, in words, for "near you" logic. */
export function distanceFromCentre(bundle: ContextBundle, lat: number, lng: number): number | null {
  if (!bundle.centroid) return null;
  return Number(haversineKm(bundle.centroid, { lat, lng }).toFixed(1));
}

/**
 * Spend guard. Returns a refusal when the person has burned the day's budget,
 * so no surface can quietly call a model in a loop.
 */
export async function guard(ctx: ActionCtx, userId: Id<"users">): Promise<AIUnavailable | null> {
  const usage = await ctx.runQuery(internal.ai.store.usageToday, { userId });
  if (usage && usage.calls >= DAILY_AI_CALL_LIMIT) {
    await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "rejected" });
    return {
      ok: false,
      reason: "budget",
      message:
        "Pulse has done a lot of thinking today. The rest of the app keeps working — try again tomorrow.",
    };
  }
  return null;
}

/**
 * The signed-in person's id, resolved inside a query so the auth identity the
 * action received is the one that is read — never a client-supplied id.
 */
export const whoAmI = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await getAuthUserId(ctx);
  },
});

/** The signed-in person, or a refusal. */
export async function identity(ctx: ActionCtx): Promise<{ userId: Id<"users"> } | AIUnavailable> {
  const userId = await ctx.runQuery(internal.ai.context.whoAmI, {});
  if (!userId) {
    return { ok: false, reason: "unavailable", message: "Please sign in again." };
  }
  return { userId };
}

/** Convenience: the id, or null. Queries use this to stay silent when signed out. */
export type { ActionCtx };

export { utcDay };
