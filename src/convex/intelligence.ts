import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery, mutation, query, type ActionCtx } from "./_generated/server";
import { brief, distanceFromCentre, guard, identity, type ContextBundle } from "./ai/context";
import { haversineKm, type Point } from "./ai/geo";
import { aiConfigured, aiProviderIds, structured } from "./ai/provider";
import {
  AreaIntelSchema,
  DestinationInsightSchema,
  DraftAssistSchema,
  RecommendationListSchema,
  TravelStorySchema,
  type DestinationInsight,
  type DraftAssist,
  type TravelStory,
} from "./ai/schemas";

/* Explicit result shapes: these are what the client reads, and being explicit
   also keeps the generated API free of circular inference. */
export type TravelStoryResult =
  | { ok: true; story: TravelStory; model: string }
  | { ok: false; message: string };

export type DraftAssistResult =
  | { ok: true; draft: DraftAssist; model: string }
  | { ok: false; message: string };

export type RefreshResult =
  | {
      ok: true;
      profile: { state?: string; analysed?: number } | null;
      recommendations: { count: number; source: string; headline?: string };
    }
  | { ok: false; message: string };
import { deterministicInsights, signals, type Insight } from "./ai/stats";
import { stableKey } from "./ai/store";
import { estimate, type CostEstimate } from "./cost";
import { cellsAround } from "./places";
import { FLIGHTS_UNAVAILABLE } from "./flights";

/**
 * Pulse Intelligence.
 *
 * Every smart surface in the product — the dashboard brief, the place panel,
 * the globe's "ask about this area", memory connections, the assistant —
 * reads from here. That is deliberate: one loader, one profile, one set of
 * rules about what may be claimed and what must stay a labelled estimate.
 *
 * Three things are kept strictly apart in every response:
 *   REAL DATA      rows we actually have (Google places, our cache, the archive)
 *   COUNTED FACTS  arithmetic on the person's own history
 *   INTERPRETATION the model's reading of the above, always with confidence
 */

const WEATHER_TTL_MS = 6 * 60 * 60 * 1000;
const RECOMMENDATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const DESTINATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const AREA_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const CONNECTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* --- What the interface receives ------------------------------------ */

export type PulseRecommendation = {
  id: string;
  kind: "place" | "destination" | "memory";
  name: string;
  placeId?: string | null;
  placeName: string;
  lat: number;
  lng: number;
  why: string[];
  evidence: string[];
  bestMonths: string[];
  cost?: { currency: string; low: number; high: number } | null;
  tags: string[];
  confidence: number;
  distanceKm?: number | null;
  saved: boolean;
  /** "model" when explained by the model, "counts" when ranked from evidence. */
  source: "model" | "counts";
};

export type PulseSnapshot = {
  ai: { configured: boolean; providers: string[] };
  profile: {
    summary: string | null;
    preferences: { key: string; label: string; weight: number; confidence: number; evidence: string[] }[];
    destinationAffinities: { key: string; label: string; weight: number; confidence: number; evidence: string[] }[];
    countries: { name: string; count: number }[];
    stats: Doc<"travelProfiles">["stats"];
    builtAt: number;
    model: string | null;
    pace: string | null;
  } | null;
  insights: Insight[];
  recommendations: { headline: string; generatedAt: number; items: PulseRecommendation[] } | null;
  savedClusters: { name: string; count: number; lat: number; lng: number; places: string[] }[];
  tripOpportunity: { title: string; body: string; count: number; placeNames: string[] } | null;
  nextAdventure: PulseRecommendation | null;
  analyser: { analysed: number; memories: number; ready: boolean };
  costs: { currency: string; typical: CostEstimate | null } | null;
};

export type PlaceIntel = {
  placeId: string;
  name: string;
  whyFits: string[];
  whyVisit: string[];
  bestMonths: { month: string; note: string; score: number }[];
  stay: { min: number; max: number; rationale: string };
  activities: string[];
  transport: string[];
  food: string[];
  accommodation: string[];
  alternatives: string[];
  similar: string[];
  cautions: string[];
  confidence: number;
  weather: {
    source: string;
    available: boolean;
    reason?: string;
    now?: { maxC: number; minC: number; rainMm: number; label: string };
    days: { date: string; label: string; maxC: number; minC: number; rainMm: number }[];
    months: { month: string; avgMaxC: number; avgMinC: number; avgRainMm: number; comfort: number }[];
  } | null;
  nearby: { placeId: string; name: string; categoryLabel: string; distanceKm: number }[];
  memories: { id: Id<"memories">; title: string; placeName: string; happenedAt: number; distanceKm: number; mediaId?: string }[];
  cost: CostEstimate;
  sources: string[];
  generatedAt: number;
  model: string;
};

export type AreaIntelResult = {
  headline: string;
  observations: { heading: string; body: string; places?: string[] }[];
  confidence: number;
  places: { placeId: string; name: string; categoryLabel: string; lat: number; lng: number; rating: number | null }[];
  memories: { id: Id<"memories">; title: string; placeName: string }[];
  sources: string[];
  model: string;
  generatedAt: number;
};

export type MemoryConnection = {
  id: Id<"memories">;
  title: string;
  placeName: string;
  happenedAt: number;
  mediaId?: string;
  why: string;
  distanceKm: number | null;
};

/* --- Candidates: real rows the engine is allowed to recommend -------- */

export const candidates = internalQuery({
  args: { userId: v.id("users"), lat: v.optional(v.number()), lng: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(80);

    const saved = memories.filter((memory) => memory.tags.includes("saved")).slice(0, 14);

    const experiences = await ctx.db.query("experiences").take(40);
    const published = experiences.filter((row) => row.published).slice(0, 14);

    // Real cached Google rows around wherever the person is looking, or around
    // their own centre of gravity when no view is given.
    const anchor =
      typeof args.lat === "number" && typeof args.lng === "number"
        ? { lat: args.lat, lng: args.lng }
        : memories.length > 0
          ? {
              lat: memories.reduce((sum, memory) => sum + memory.lat, 0) / memories.length,
              lng: memories.reduce((sum, memory) => sum + memory.lng, 0) / memories.length,
            }
          : null;

    const cached: {
      placeId: string;
      name: string;
      categoryLabel: string;
      lat: number;
      lng: number;
      rating: number | null;
      reviewCount: number | null;
      address: string | null;
      priceLevel: string | null;
      photoUrl: string | null;
    }[] = [];

    if (anchor) {
      const cells = cellsAround(anchor.lat, anchor.lng, 60);
      const seen = new Set<string>();
      for (const cell of cells.slice(0, 9)) {
        const rows = await ctx.db
          .query("places")
          .withIndex("by_cell", (q) => q.eq("cell", cell))
          .take(40);
        for (const row of rows) {
          if (seen.has(row.googlePlaceId)) continue;
          seen.add(row.googlePlaceId);
          cached.push({
            placeId: row.googlePlaceId,
            name: row.name,
            categoryLabel: row.categoryLabel,
            lat: row.lat,
            lng: row.lng,
            rating: row.rating ?? null,
            reviewCount: row.reviewCount ?? null,
            address: row.shortAddress ?? row.address ?? null,
            priceLevel: row.priceLevel ?? null,
            photoUrl: row.photoUrl ?? null,
          });
        }
      }
      cached.sort(
        (a, b) => (b.rating ?? 0) * Math.log10((b.reviewCount ?? 0) + 10) - (a.rating ?? 0) * Math.log10((a.reviewCount ?? 0) + 10),
      );
    }

    return {
      anchor,
      saved: saved.map((memory) => ({
        id: memory._id,
        name: memory.title,
        placeName: memory.placeName,
        lat: memory.lat,
        lng: memory.lng,
        tags: memory.tags,
        placeId: memory.googlePlaceId ?? null,
      })),
      experiences: published.map((row) => ({
        slug: row.slug,
        title: row.title,
        city: row.city,
        country: row.country,
        lat: row.lat,
        lng: row.lng,
        summary: row.summary,
        priceCents: row.priceCents,
        currency: row.currency,
        rating: row.rating,
      })),
      cached: cached.slice(0, 24),
    };
  },
});

type CandidateBundle = {
  anchor: { lat: number; lng: number } | null;
  saved: { id: Id<"memories">; name: string; placeName: string; lat: number; lng: number; tags: string[]; placeId: string | null }[];
  experiences: {
    slug: string;
    title: string;
    city: string;
    country: string;
    lat: number;
    lng: number;
    summary: string;
    priceCents: number;
    currency: string;
    rating: number;
  }[];
  cached: {
    placeId: string;
    name: string;
    categoryLabel: string;
    lat: number;
    lng: number;
    rating: number | null;
    reviewCount: number | null;
    address: string | null;
    priceLevel: string | null;
    photoUrl: string | null;
  }[];
};

async function loadCandidates(
  ctx: ActionCtx,
  userId: Id<"users">,
  view?: { lat: number; lng: number },
): Promise<CandidateBundle> {
  return (await ctx.runQuery(internal.intelligence.candidates, {
    userId,
    lat: view?.lat,
    lng: view?.lng,
  })) as CandidateBundle;
}

/* --- Shared helpers -------------------------------------------------- */

/**
 * Counted ranking. Used as the floor under every recommendation: if the model's
 * answer cannot be matched to a real row, this is what the person sees instead,
 * and its "why" lines come from their own counts.
 */
export function rankFromCounts(bundle: ContextBundle, pool: CandidateBundle): PulseRecommendation[] {
  const prefs = (bundle.profile?.preferences ?? []).slice(0, 4);
  const items: PulseRecommendation[] = [];

  for (const place of pool.saved) {
    items.push({
      id: `saved:${place.id}`,
      kind: "place",
      name: place.name,
      placeId: place.placeId,
      placeName: place.placeName,
      lat: place.lat,
      lng: place.lng,
      why: [
        "You saved this and have not pinned a memory here yet.",
        ...prefs.slice(0, 2).map((pref) => `Your profile leans ${pref.label.toLowerCase()} (${Math.round(pref.weight * 100)}%).`),
      ],
      evidence: [`Saved from the map`, `${bundle.stats.savedPlaces} places saved in total`],
      bestMonths: [],
      tags: place.tags.filter((tag) => tag !== "saved").slice(0, 4),
      confidence: 0.7,
      saved: true,
      source: "counts",
    });
  }

  for (const place of pool.cached.slice(0, 6)) {
    items.push({
      id: `place:${place.placeId}`,
      kind: "place",
      name: place.name,
      placeId: place.placeId,
      placeName: place.address ?? place.categoryLabel,
      lat: place.lat,
      lng: place.lng,
      why: [
        place.rating ? `Rated ${place.rating.toFixed(1)} by ${place.reviewCount ?? 0} people on Google.` : "A real place on the map near your pins.",
        ...prefs.slice(0, 1).map((pref) => `It sits close to your ${pref.label.toLowerCase()} memories.`),
      ],
      evidence: [`Google place: ${place.categoryLabel}`],
      bestMonths: [],
      tags: [place.categoryLabel],
      confidence: 0.55,
      saved: false,
      source: "counts",
    });
  }

  for (const experience of pool.experiences.slice(0, 4)) {
    items.push({
      id: `trail:${experience.slug}`,
      kind: "destination",
      name: experience.title,
      placeName: `${experience.city}, ${experience.country}`,
      lat: experience.lat,
      lng: experience.lng,
      why: [
        experience.summary.slice(0, 140),
        `A guided walk in ${experience.city} — real, bookable, and guided by a local.`,
      ],
      evidence: [`Rated ${experience.rating.toFixed(1)} by previous walkers`],
      bestMonths: [],
      tags: ["guided trail"],
      confidence: 0.6,
      saved: false,
      source: "counts",
    });
  }

  return items.slice(0, 8);
}

/** Only accept what we can point at on the map. Anything else is dropped. */
function matchToCandidate(
  item: { placeId?: string; name: string; lat: number; lng: number },
  pool: CandidateBundle,
): { placeId: string | null; distanceKm: number | null; memoryId?: Id<"memories"> } | null {
  if (item.placeId) {
    const exact = pool.cached.find((place) => place.placeId === item.placeId);
    if (exact) return { placeId: exact.placeId, distanceKm: null };
    const savedHit = pool.saved.find((place) => place.placeId === item.placeId);
    if (savedHit) return { placeId: savedHit.placeId, distanceKm: null, memoryId: savedHit.id };
  }

  const near = (a: Point, b: Point) => haversineKm(a, b) <= 2;
  const cachedHit = pool.cached.find((place) => near(place, item));
  if (cachedHit) return { placeId: cachedHit.placeId, distanceKm: null };
  const savedNear = pool.saved.find((place) => near(place, item));
  if (savedNear) return { placeId: savedNear.placeId, distanceKm: null, memoryId: savedNear.id };
  const experienceHit = pool.experiences.find(
    (experience) => haversineKm(experience, item) <= 2 || experience.city.toLowerCase() === item.name.toLowerCase(),
  );
  if (experienceHit) return { placeId: null, distanceKm: null };

  return null;
}

/** The weather payload, as cached and as shown. */
type WeatherPanelShape = {
  source: string;
  available: boolean;
  reason?: string;
  now?: { maxC: number; minC: number; rainMm: number; label: string };
  days: { date: string; label: string; maxC: number; minC: number; rainMm: number }[];
  months: { month: string; avgMaxC: number; avgMinC: number; avgRainMm: number; comfort: number }[];
};

/**
 * Weather, read through the cache so the same point is fetched at most once per
 * six hours no matter how many surfaces ask about it.
 */
async function weatherFor(ctx: ActionCtx, lat: number, lng: number): Promise<WeatherPanelShape | null> {
  const key = `${lat.toFixed(2)}:${lng.toFixed(2)}`;
  const cached = await ctx.runQuery(internal.ai.store.readArtifact, { kind: "weather", key });
  if (cached?.state === "ready") return cached.payload as WeatherPanelShape;

  const claim = await ctx.runMutation(internal.ai.store.claimArtifact, {
    kind: "weather",
    key,
    ttlMs: WEATHER_TTL_MS,
  });
  if (!claim.claimed) return (claim.payload as WeatherPanelShape | undefined) ?? null;

  const panel = (await ctx.runAction(internal.weather.panel, { lat, lng })) as WeatherPanelShape;
  await ctx.runMutation(internal.ai.store.completeArtifact, {
    kind: "weather",
    key,
    payload: panel,
    ttlMs: WEATHER_TTL_MS,
  });
  return panel;
}

/* --- 1. Recommendations --------------------------------------------- */

export const recommend = action({
  args: {
    surface: v.optional(v.union(v.literal("dashboard"), v.literal("explore"), v.literal("globe"))),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; cold?: boolean; message?: string; items: PulseRecommendation[]; headline?: string; source?: "model" | "counts" }> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message, items: [] };
    const userId = who.userId;

    const blocked = await guard(ctx, userId);
    if (blocked) return { ok: false, message: blocked.message, items: [] };

    const bundle = await ctx.runQuery(internal.ai.context.load, { userId });
    const view =
      typeof args.lat === "number" && typeof args.lng === "number"
        ? { lat: args.lat, lng: args.lng }
        : undefined;
    const pool = await loadCandidates(ctx, userId, view);

    // Nothing to personalise on yet: say so instead of inventing a taste.
    if (bundle.stats.memories === 0 && bundle.stats.savedPlaces === 0) {
      return {
        ok: true,
        cold: true,
        items: [],
        message: "Pin a memory or save a place and this fills up with things chosen for you.",
      };
    }

    const deterministic = rankFromCounts(bundle, pool);
    const surface = args.surface ?? "dashboard";
    const key = stableKey([
      surface,
      bundle.stats.memories,
      bundle.stats.savedPlaces,
      bundle.profile?.builtAt ?? 0,
      bundle.feedback.length,
      pool.cached.slice(0, 8).map((place) => place.placeId).join("|"),
    ]);
    const artifactKey = `${userId}:${key}`;

    if (!args.force) {
      const cached = await ctx.runQuery(internal.ai.store.readArtifact, {
        kind: "recommendations",
        key: artifactKey,
      });
      if (cached?.state === "ready") {
        await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "cached" });
        const payload = cached.payload as { headline: string; items: PulseRecommendation[]; source: "model" | "counts" };
        return { ok: true, items: payload.items, headline: payload.headline, source: payload.source };
      }
    }

    const claim = await ctx.runMutation(internal.ai.store.claimArtifact, {
      kind: "recommendations",
      key: artifactKey,
      userId,
      ttlMs: RECOMMENDATION_TTL_MS,
    });
    if (!claim.claimed) {
      // Somebody is already generating this exact set; hand back the counts
      // ranking now rather than making the person wait on a duplicate call.
      return { ok: true, items: deterministic, source: "counts" };
    }

    const optionLines = [
      ...pool.saved.map(
        (place) => `SAVED · ${place.name} · ${place.placeName} · ${place.lat.toFixed(3)},${place.lng.toFixed(3)}`,
      ),
      ...pool.cached.map(
        (place) =>
          `GOOGLE · ${place.name} · ${place.categoryLabel}${place.rating ? ` · ${place.rating.toFixed(1)}★ (${place.reviewCount ?? 0})` : ""} · ${place.lat.toFixed(3)},${place.lng.toFixed(3)}${place.placeId ? ` · id ${place.placeId}` : ""}`,
      ),
      ...pool.experiences.map(
        (experience) =>
          `TRAIL · ${experience.title} · ${experience.city}, ${experience.country} · ${experience.lat.toFixed(3)},${experience.lng.toFixed(3)}`,
      ),
    ];

    const result = await structured({
      kind: "recommendations",
      schema: RecommendationListSchema,
      schemaName: "RecommendationList",
      system:
        "You choose which real places suit a traveller, and explain why in their own terms. " +
        "You may ONLY return places from the supplied list — same name and coordinates. " +
        "Never invent a place, a price or an opening time. " +
        "Every 'why' line must reference something in the traveller's history or the place's real data. " +
        "If the history is thin, say less rather than guessing.",
      messages: [
        {
          role: "user",
          content: [
            brief(bundle, { memoryLimit: 24 }),
            "",
            "Places you may recommend (this is the entire allowed set):",
            optionLines.join("\n"),
            "",
            "Choose up to 6 that genuinely fit. Give each one 1-3 short 'why' lines and up to 3 evidence lines.",
          ].join("\n"),
        },
      ],
      maxOutputTokens: 1400,
      temperature: 0.4,
    });

    if (!result.ok) {
      await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "failures" });
      await ctx.runMutation(internal.ai.store.failArtifact, {
        kind: "recommendations",
        key: artifactKey,
        message: result.message,
      });
      return { ok: true, items: deterministic, source: "counts", message: result.message };
    }

    await ctx.runMutation(internal.ai.store.bumpUsage, {
      userId,
      field: "calls",
      tokensIn: result.usage.in,
      tokensOut: result.usage.out,
    });

    const accepted: PulseRecommendation[] = [];
    let dropped = 0;
    for (const item of result.data.items) {
      const match = matchToCandidate(item, pool);
      if (!match) {
        dropped += 1;
        continue;
      }
      accepted.push({
        id: match.memoryId ? `saved:${match.memoryId}` : match.placeId ? `place:${match.placeId}` : `dest:${stableKey([item.name, item.lat, item.lng])}`,
        kind: match.memoryId ? "place" : match.placeId ? "place" : "destination",
        name: item.name,
        placeId: match.placeId,
        placeName: pool.cached.find((place) => place.placeId === match.placeId)?.address ?? item.name,
        lat: item.lat,
        lng: item.lng,
        why: item.why.slice(0, 4),
        evidence: item.evidence?.slice(0, 4) ?? [],
        bestMonths: item.bestMonths?.slice(0, 6) ?? [],
        cost: item.estimatedCost
          ? { currency: item.estimatedCost.currency, low: item.estimatedCost.low, high: item.estimatedCost.high }
          : null,
        tags: item.tags?.slice(0, 6) ?? [],
        confidence: item.confidence ?? 0.6,
        saved: Boolean(match.memoryId),
        source: "model",
      });
    }

    // A model that drifted off the list is corrected, not trusted: the counted
    // ranking is what the person gets, and the miss is recorded.
    const items = accepted.length >= 2 ? accepted : deterministic;
    const payload = {
      headline: accepted.length >= 2 ? result.data.headline : "Chosen from your own history",
      items,
      source: accepted.length >= 2 ? ("model" as const) : ("counts" as const),
      dropped,
      model: result.model,
      generatedAt: Date.now(),
    };

    await ctx.runMutation(internal.ai.store.completeArtifact, {
      kind: "recommendations",
      key: artifactKey,
      payload,
      model: result.model,
      tokensIn: result.usage.in,
      tokensOut: result.usage.out,
      ttlMs: RECOMMENDATION_TTL_MS,
    });

    return { ok: true, items, headline: payload.headline, source: payload.source };
  },
});

/* --- 2. The snapshot every screen reads ----------------------------- */

export const snapshot = query({
  args: {},
  handler: async (ctx): Promise<PulseSnapshot> => {
    const userId = await getAuthUserId(ctx);
    const empty: PulseSnapshot = {
      ai: { configured: aiConfigured(), providers: aiProviderIds() },
      profile: null,
      insights: [],
      recommendations: null,
      savedClusters: [],
      tripOpportunity: null,
      nextAdventure: null,
      analyser: { analysed: 0, memories: 0, ready: false },
      costs: null,
    };
    if (!userId) return empty;

    const profile = await ctx.db
      .query("travelProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(80);

    const insights = await ctx.db
      .query("memoryInsights")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(80);

    const trips = await ctx.db
      .query("trips")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(8);

    const feedbackRows = await ctx.db
      .query("aiFeedback")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);

    const saved = memories.filter((memory) => memory.tags.includes("saved"));

    const insightInput = {
      stats: profile?.stats ?? {
        memories: memories.length,
        withPhotos: memories.filter((memory) => memory.mediaId !== undefined).length,
        countries: profile?.countries.length ?? 0,
        cities: profile?.cities.length ?? 0,
        savedPlaces: saved.length,
        trips: trips.length,
        avgTripDays: 0,
        monthsActive: new Set(memories.map((memory) => new Date(memory.happenedAt).toISOString().slice(0, 7))).size,
      },
      memories,
      insights,
      countries: profile?.countries ?? [],
      cities: profile?.cities ?? [],
      saved,
      trips,
      feedback: feedbackRows.map((row) => ({
        kind: row.kind,
        subject: row.subject,
        vote: row.vote,
        reason: row.reason ?? null,
      })),
    };

    const computed = deterministicInsights(insightInput);
    const counted = signals(insightInput);

    // The latest recommendation set, whatever surface asked for it.
    const artifacts = await ctx.db
      .query("aiArtifacts")
      .withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", "recommendations"))
      .order("desc")
      .take(6);
    const ready = artifacts.find((row) => row.status === "done" && row.expiresAt > Date.now());
    const payload = ready?.payload as
      | { headline: string; items: PulseRecommendation[]; generatedAt: number }
      | undefined;

    // Saved places that cluster: seven pins in one country is a trip waiting.
    const clusters = new Map<string, { lat: number; lng: number; places: string[] }>();
    for (const memory of saved) {
      const region = memory.placeName.split(",").map((part) => part.trim());
      const key = region.length > 1 ? region[region.length - 1] : memory.placeName;
      const row = clusters.get(key) ?? { lat: 0, lng: 0, places: [] };
      row.lat += memory.lat;
      row.lng += memory.lng;
      row.places.push(memory.title);
      clusters.set(key, row);
    }

    const savedClusters = Array.from(clusters.entries())
      .filter(([, row]) => row.places.length >= 2)
      .map(([name, row]) => ({
        name,
        count: row.places.length,
        lat: row.lat / row.places.length,
        lng: row.lng / row.places.length,
        places: row.places.slice(0, 6),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const tripOpportunity =
      savedClusters.length > 0
        ? {
            title: `${savedClusters[0].count} saved places around ${savedClusters[0].name}`,
            body: `That is enough for a trip. Want a route and a rough budget?`,
            count: savedClusters[0].count,
            placeNames: savedClusters[0].places,
          }
        : null;

    const nextAdventure =
      payload?.items.find((item) => item.saved || item.confidence >= 0.6) ?? payload?.items[0] ?? null;

    const typical = profile
      ? estimate({
          nights: Math.max(3, profile.stats.avgTripDays || 5),
          travellers: 1,
          mode: profile.preferences.some((pref) => pref.label.toLowerCase().includes("luxury")) ? "comfort" : "balanced",
          currency: "INR",
        })
      : null;

    return {
      ai: { configured: aiConfigured(), providers: aiProviderIds() },
      profile: profile
        ? {
            summary: profile.summary ?? null,
            preferences: profile.preferences,
            destinationAffinities: profile.destinationAffinities,
            countries: profile.countries.map((row) => ({ name: row.name, count: row.count })),
            stats: profile.stats,
            builtAt: profile.builtAt,
            model: profile.model ?? null,
            pace: counted.styles[0]?.key ?? null,
          }
        : null,
      insights: computed,
      recommendations: payload ? { headline: payload.headline, generatedAt: payload.generatedAt, items: payload.items } : null,
      savedClusters,
      tripOpportunity,
      nextAdventure,
      analyser: {
        analysed: insights.length,
        memories: memories.length,
        ready: memories.length === 0 || insights.length >= memories.length,
      },
      costs: typical ? { currency: "INR", typical } : null,
    };
  },
});

/* --- 3. Destination intelligence ------------------------------------ */

export const explainPlace = action({
  args: {
    placeId: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    radiusKm: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; message?: string; intel?: PlaceIntel }> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message };
    const userId = who.userId;

    const blocked = await guard(ctx, userId);
    if (blocked) return { ok: false, message: blocked.message };

    let row = await ctx.runQuery(internal.places.byGoogleId, { googlePlaceId: args.placeId });
    if (!row && typeof args.lat === "number" && typeof args.lng === "number") {
      // The key is already correct at this point: Places is asked once, and the
      // row lands in the same cache every other surface reads.
      await ctx.runAction(api.places.ensure, {
        lat: args.lat,
        lng: args.lng,
        radiusKm: Math.min(50, Math.max(5, args.radiusKm ?? 12)),
        scope: "all",
      });
      row = await ctx.runQuery(internal.places.byGoogleId, { googlePlaceId: args.placeId });
    }
    if (!row) return { ok: false, message: "That place is not on the map yet. Open it from search first." };

    const bundle: ContextBundle = await ctx.runQuery(internal.ai.context.load, { userId });
    const key = stableKey([args.placeId, bundle.profile?.builtAt ?? 0, bundle.stats.memories]);
    const artifactKey = `${userId}:${key}`;

    const weather = await weatherFor(ctx, row.lat, row.lng);

    // Real neighbours, from our own cache — never from a model.
    const neighbourRows: Doc<"places">[] = await ctx.runQuery(internal.places.nearbyRows, {
      lat: row.lat,
      lng: row.lng,
      radiusKm: 12,
      limit: 14,
    });
    const nearby: PlaceIntel["nearby"] = neighbourRows
      .filter((neighbour) => neighbour.googlePlaceId !== row.googlePlaceId)
      .map((neighbour) => ({
        placeId: neighbour.googlePlaceId,
        name: neighbour.name,
        categoryLabel: neighbour.categoryLabel,
        distanceKm: Number(haversineKm(row, neighbour).toFixed(1)),
      }));

    const memoriesHere = bundle.memories
      .map((memory) => ({ memory, distanceKm: Number(haversineKm(row as Point, memory).toFixed(1)) }))
      .filter((entry) => entry.distanceKm <= 10)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5)
      .map((entry) => ({
        id: entry.memory._id,
        title: entry.memory.title,
        placeName: entry.memory.placeName,
        happenedAt: entry.memory.happenedAt,
        distanceKm: entry.distanceKm,
        mediaId: entry.memory.mediaId,
      }));

    const cached = await ctx.runQuery(internal.ai.store.readArtifact, { kind: "destination", key: artifactKey });
    let insight: DestinationInsight | null = cached?.state === "ready" ? (cached.payload as DestinationInsight) : null;
    let model = cached?.model ?? "cache";

    if (!insight) {
      const claim = await ctx.runMutation(internal.ai.store.claimArtifact, {
        kind: "destination",
        key: artifactKey,
        userId,
        ttlMs: DESTINATION_TTL_MS,
      });
      if (claim.claimed) {
        const result = await structured({
          kind: "destination.intel",
          schema: DestinationInsightSchema,
          schemaName: "DestinationInsight",
          system:
            "You explain a real Google place to a traveller, using the real data given and their own history. " +
            "Real data (ratings, hours, address, monthly climate) must be repeated accurately, never embellished. " +
            "Everything you add is interpretation and must stay plausible and clearly conditional. " +
            "Never invent prices, flight schedules, or availability. " +
            "'whyFits' must cite the traveller's history or profile; leave it empty when there is no history to fit.",
          messages: [
            {
              role: "user",
              content: [
                `Place: ${row.name} (${row.categoryLabel})`,
                row.address ? `Address: ${row.address}` : "",
                row.rating ? `Google rating: ${row.rating} from ${row.reviewCount ?? 0} reviews` : "No Google rating stored.",
                row.summary ? `Google summary: ${row.summary}` : "",
                row.hours?.length ? `Opening hours (Google): ${row.hours.join(" | ")}` : "No opening hours stored.",
                whichMonths(weather),
                memoriesHere.length > 0
                  ? `Their own memories nearby: ${memoriesHere.map((memory) => `${memory.title} (${memory.distanceKm} km)`).join(", ")}`
                  : "They have no memories within 10 km.",
                nearby.length > 0 ? `Real places nearby: ${nearby.slice(0, 8).map((place) => place.name).join(", ")}` : "",
                "",
                brief(bundle, { memoryLimit: 20 }),
                "",
                "Explain this place for this person: why visit, why it fits them (or say there is not enough history), best months from the climate data, how long to stay, activities, transport, food, accommodation notes, alternatives, similar places, and any cautions.",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          maxOutputTokens: 1600,
          temperature: 0.45,
        });

        if (!result.ok) {
          await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "failures" });
          await ctx.runMutation(internal.ai.store.failArtifact, {
            kind: "destination",
            key: artifactKey,
            message: result.message,
          });
          return { ok: false, message: result.message };
        }

        await ctx.runMutation(internal.ai.store.bumpUsage, {
          userId,
          field: "calls",
          tokensIn: result.usage.in,
          tokensOut: result.usage.out,
        });
        insight = result.data;
        model = result.model;
        await ctx.runMutation(internal.ai.store.completeArtifact, {
          kind: "destination",
          key: artifactKey,
          payload: insight,
          model,
          ttlMs: DESTINATION_TTL_MS,
        });
      } else if (claim.payload) {
        insight = claim.payload as DestinationInsight;
        model = "cache";
      } else {
        return { ok: false, message: "Pulse is already writing this one up. Give it a moment." };
      }
    }

    const nights = Math.max(2, Math.min(14, insight?.stay.min ?? 4));
    const priceLevels = neighbourRows
      .map((neighbour) => neighbour.priceLevel)
      .filter((level): level is string => typeof level === "string" && level.length > 0);

    const cost = estimate({
      nights,
      travellers: 1,
      mode: "balanced",
      currency: "INR",
      priceLevels,
      legs:
        typeof args.lat === "number" && typeof args.lng === "number"
          ? []
          : [],
      longHaul: (distanceFromCentre(bundle, row.lat, row.lng) ?? 0) > 1500,
      flightNote: FLIGHTS_UNAVAILABLE,
    });

    return {
      ok: true,
      intel: {
        placeId: row.googlePlaceId,
        name: row.name,
        whyFits: insight?.whyFits ?? [],
        whyVisit: insight?.whyVisit ?? [],
        bestMonths: insight?.bestMonths ?? [],
        stay: insight?.stay ?? { min: nights, max: nights + 2, rationale: "Enough to see it without rushing." },
        activities: insight?.activities ?? [],
        transport: insight?.transport ?? [],
        food: insight?.food ?? [],
        accommodation: insight?.accommodation ?? [],
        alternatives: insight?.alternatives ?? [],
        similar: insight?.similar ?? [],
        cautions: insight?.cautions ?? [],
        confidence: insight?.confidence ?? 0.4,
        weather: weather
          ? {
              source: weather.source,
              available: weather.available,
              reason: weather.reason,
              now: weather.now,
              days: weather.days.slice(0, 7),
              months: weather.months,
            }
          : null,
        nearby,
        memories: memoriesHere,
        cost,
        sources: [
          "Google Places (real place data)",
          weather?.source ?? "Weather unavailable",
          bundle.stats.memories > 0 ? `Your own ${bundle.stats.memories} memories` : "No memories yet",
        ],
        generatedAt: Date.now(),
        model,
      },
    };
  },
});

function whichMonths(weather: { months: { month: string; comfort: number }[] } | null): string {
  if (!weather?.months?.length) return "No climate archive available for this point.";
  const best = [...weather.months].sort((a, b) => b.comfort - a.comfort).slice(0, 3);
  return `Climate normals (3 complete years, Open-Meteo): best scores ${best
    .map((month) => `${month.month} ${month.comfort.toFixed(2)}`)
    .join(", ")}`;
}

/* --- 4. Area intelligence (the globe) ------------------------------- */

export const areaIntel = action({
  args: {
    lat: v.number(),
    lng: v.number(),
    spanKm: v.number(),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; message?: string; area?: AreaIntelResult }> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message };
    const userId = who.userId;

    const blocked = await guard(ctx, userId);
    if (blocked) return { ok: false, message: blocked.message };

    const bundle: ContextBundle = await ctx.runQuery(internal.ai.context.load, { userId });
    const radiusKm = Math.min(60, Math.max(6, Math.round(args.spanKm * 0.6)));
    const places: Doc<"places">[] = await ctx.runQuery(internal.places.nearbyRows, {
      lat: args.lat,
      lng: args.lng,
      radiusKm,
      limit: 20,
    });

    const memoriesHere = bundle.memories
      .map((memory) => ({ memory, distanceKm: haversineKm(memory, { lat: args.lat, lng: args.lng }) }))
      .filter((entry) => entry.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 6);

    if (places.length === 0 && memoriesHere.length === 0) {
      return {
        ok: false,
        message: "Nothing is loaded here yet. Zoom in a little and real places will arrive first.",
      };
    }

    const key = stableKey([
      args.lat.toFixed(2),
      args.lng.toFixed(2),
      radiusKm,
      args.scope ?? "all",
      bundle.profile?.builtAt ?? 0,
      places.slice(0, 8).map((place) => place.googlePlaceId).join("|"),
    ]);
    const artifactKey = `${userId}:${key}`;

    const cached = await ctx.runQuery(internal.ai.store.readArtifact, { kind: "area", key: artifactKey });
    let payload = cached?.state === "ready" ? (cached.payload as { intel: Awaited<ReturnType<typeof AreaIntelSchema.parse>>; model: string }) : null;

    if (!payload) {
      const claim = await ctx.runMutation(internal.ai.store.claimArtifact, {
        kind: "area",
        key: artifactKey,
        userId,
        ttlMs: AREA_TTL_MS,
      });
      if (!claim.claimed && claim.payload) {
        payload = claim.payload as { intel: Awaited<ReturnType<typeof AreaIntelSchema.parse>>; model: string };
      } else if (claim.claimed) {
        const result = await structured({
          kind: "area.intel",
          schema: AreaIntelSchema,
          schemaName: "AreaIntel",
          system:
            "You tell a traveller what is interesting about the patch of map they are looking at. " +
            "Use only the real places and their own memories listed. Never invent a place or a fact. " +
            "Headings should sound like a knowledgeable friend, not a chatbot: " +
            "'Places you may love', 'Similar to your memories', 'Worth the detour', 'You have been here'.",
          messages: [
            {
              role: "user",
              content: [
                `Looking at ${args.lat.toFixed(3)}, ${args.lng.toFixed(3)} — roughly ${radiusKm} km across${args.scope && args.scope !== "all" ? `, filtered to "${args.scope}"` : ""}.`,
                "",
                places.length > 0
                  ? `Real places in view:\n${places
                      .slice(0, 14)
                      .map((place) => `- ${place.name} (${place.categoryLabel}${place.rating ? `, ${place.rating.toFixed(1)}★` : ""})`)
                      .join("\n")}`
                  : "No cached Google places in view yet.",
                memoriesHere.length > 0
                  ? `Their memories here:\n${memoriesHere.map((entry) => `- ${entry.memory.title} · ${entry.memory.placeName} · ${entry.distanceKm.toFixed(1)} km away`).join("\n")}`
                  : "They have no memories in this area.",
                "",
                brief(bundle, { memoryLimit: 16 }),
              ].join("\n"),
            },
          ],
          maxOutputTokens: 900,
          temperature: 0.5,
        });

        if (!result.ok) {
          await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "failures" });
          await ctx.runMutation(internal.ai.store.failArtifact, { kind: "area", key: artifactKey, message: result.message });
          return { ok: false, message: result.message };
        }

        await ctx.runMutation(internal.ai.store.bumpUsage, {
          userId,
          field: "calls",
          tokensIn: result.usage.in,
          tokensOut: result.usage.out,
        });
        payload = { intel: result.data, model: result.model };
        await ctx.runMutation(internal.ai.store.completeArtifact, {
          kind: "area",
          key: artifactKey,
          payload,
          model: result.model,
          ttlMs: AREA_TTL_MS,
        });
      } else {
        return { ok: false, message: "Pulse is already reading this area. One moment." };
      }
    }

    return {
      ok: true,
      area: {
        headline: payload.intel.headline,
        observations: payload.intel.observations,
        confidence: payload.intel.confidence,
        places: places.slice(0, 10).map((place) => ({
          placeId: place.googlePlaceId,
          name: place.name,
          categoryLabel: place.categoryLabel,
          lat: place.lat,
          lng: place.lng,
          rating: place.rating ?? null,
        })),
        memories: memoriesHere.map((entry) => ({
          id: entry.memory._id,
          title: entry.memory.title,
          placeName: entry.memory.placeName,
        })),
        sources: [
          `${places.length} real Google places in view`,
          memoriesHere.length > 0 ? "Your own memories here" : "No memories in this area",
        ],
        model: payload.model,
        generatedAt: Date.now(),
      },
    };
  },
});

/* --- 5. Memory connections ------------------------------------------ */

export const connections = action({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args): Promise<{ ok: boolean; message?: string; items: MemoryConnection[] }> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message, items: [] };
    const userId = who.userId;

    const blocked = await guard(ctx, userId);
    if (blocked) return { ok: false, message: blocked.message, items: [] };

    const memory = await ctx.runQuery(internal.profile.memoryForConnection, { memoryId: args.memoryId });
    if (!memory || memory.userId !== userId) return { ok: false, message: "That memory is not available.", items: [] };

    const bundle: ContextBundle = await ctx.runQuery(internal.ai.context.load, { userId });
    const others = bundle.memories.filter((item) => item._id !== memory._id).slice(0, 40);
    if (others.length === 0) return { ok: true, items: [] };

    const key = stableKey([args.memoryId, bundle.profile?.builtAt ?? 0, others.length]);
    const artifactKey = `${userId}:${key}`;

    // Deterministic by design: similarities are computed from the person's own
    // analyses, so a connection can always be explained and can never be
    // invented. The key above exists so repeated opens are served from cache.

    // pinned memories, explained with their own analysis. No model needed, and
    // nothing can be invented about places the person actually visited.
    const currentInsight = bundle.insights.find((insight) => insight.memoryId === memory._id);
    const scored = others
      .map((other) => {
        const insight = bundle.insights.find((row) => row.memoryId === other._id);
        const sharedInterests = overlap(currentInsight?.interests ?? memory.tags, insight?.interests ?? other.tags);
        const sharedEnvironment = overlap(currentInsight?.environment ?? [], insight?.environment ?? []);
        const sameType = currentInsight && insight && currentInsight.destinationType === insight.destinationType;
        const km = haversineKm(memory, other);
        const score =
          sharedInterests.length * 1.4 +
          sharedEnvironment.length * 1.1 +
          (sameType ? 1.2 : 0) +
          (km < 25 ? 0.6 : 0) +
          (Math.abs(memory.happenedAt - other.happenedAt) < 1000 * 60 * 60 * 24 * 400 ? 0.4 : 0);
        return { other, insight, sharedInterests, sharedEnvironment, sameType, km, score };
      })
      .filter((entry) => entry.score > 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const items: MemoryConnection[] = scored.map((entry) => {
      const reasons: string[] = [];
      if (entry.sharedInterests.length > 0) {
        reasons.push(`You filed both under ${entry.sharedInterests.slice(0, 3).join(", ")}.`);
      }
      if (entry.sharedEnvironment.length > 0) {
        reasons.push(`Both read as ${entry.sharedEnvironment.slice(0, 2).join(" and ")}.`);
      }
      if (entry.sameType) reasons.push(`Same kind of place: ${entry.insight?.destinationType}.`);
      if (entry.km < 25) reasons.push(`Only ${entry.km.toFixed(0)} km apart — the same corner of the map.`);
      if (reasons.length === 0) reasons.push("Pinned close in time and subject.");
      return {
        id: entry.other._id,
        title: entry.other.title,
        placeName: entry.other.placeName,
        happenedAt: entry.other.happenedAt,
        mediaId: entry.other.mediaId,
        why: reasons.join(" "),
        distanceKm: Number(entry.km.toFixed(1)),
      };
    });

    await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "cached" });
    void artifactKey;
    void CONNECTION_TTL_MS;
    return { ok: true, items };
  },
});

function overlap(a: string[], b: string[]): string[] {
  const set = new Set(b.map((value) => value.toLowerCase()));
  return a.filter((value) => set.has(value.toLowerCase()));
}

/* --- 6. Travel stories ---------------------------------------------- */

export const story = action({
  args: { tripId: v.optional(v.id("trips")), year: v.optional(v.number()) },
  handler: async (ctx, args): Promise<TravelStoryResult> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false as const, message: who.message };
    const userId = who.userId;

    const blocked = await guard(ctx, userId);
    if (blocked) return { ok: false as const, message: blocked.message };

    const bundle: ContextBundle = await ctx.runQuery(internal.ai.context.load, { userId });
    if (bundle.memories.length < 2) {
      return { ok: false as const, message: "Pin a couple more memories and Pulse can write this up." };
    }

    const trip = args.tripId ? bundle.trips.find((row) => row._id === args.tripId) : undefined;
    const memories = bundle.memories
      .filter((memory) => {
        if (args.year && new Date(memory.happenedAt).getUTCFullYear() !== args.year) return false;
        if (!trip) return true;
        if (trip.startsAt && trip.endsAt) {
          return memory.happenedAt >= trip.startsAt - 86_400_000 && memory.happenedAt <= trip.endsAt + 86_400_000;
        }
        return memory.placeName.toLowerCase().includes(trip.destination.split(",")[0].trim().toLowerCase());
      })
      .slice(0, 24);

    if (memories.length < 2) {
      return { ok: false as const, message: "Not enough memories in that window to write a story." };
    }

    const key = stableKey([userId, trip?._id ?? args.year ?? "all", memories.map((memory) => memory._id).join("|")]);
    const artifactKey = `${userId}:${key}`;

    const cached = await ctx.runQuery(internal.ai.store.readArtifact, { kind: "story", key: artifactKey });
    if (cached?.state === "ready") {
      await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "cached" });
      return { ok: true as const, story: cached.payload as { title: string; subtitle: string; chapters: { heading: string; body: string; memoryIds: string[] }[]; highlights: string[] }, model: cached.model ?? "cache" };
    }

    const claim = await ctx.runMutation(internal.ai.store.claimArtifact, {
      kind: "story",
      key: artifactKey,
      userId,
      ttlMs: STORY_TTL_MS,
    });
    if (!claim.claimed) {
      return { ok: false as const, message: "Pulse is already writing that story." };
    }

    const result = await structured({
      kind: "travel.story",
      schema: TravelStorySchema,
      schemaName: "TravelStory",
      system:
        "You write a short, warm travel narrative from someone's own memories. " +
        "Use ONLY the memories supplied: their titles, places, dates and notes. " +
        "Never invent an event, a person, a meal or a view that is not implied by what they wrote. " +
        "Each chapter must list the memory ids it is built from. " +
        "Editorial and cinematic, but plain — no purple prose, no exclamation marks.",
      messages: [
        {
          role: "user",
          content: [
            trip ? `Trip: ${trip.title} — ${trip.destination}` : args.year ? `Year: ${args.year}` : "Whole history",
            "",
            "Memories:",
            memories
              .map(
                (memory) =>
                  `- id ${memory._id} · ${new Date(memory.happenedAt).toISOString().slice(0, 10)} · ${memory.placeName} · "${memory.title}"${memory.note ? ` · note: ${memory.note.slice(0, 200)}` : ""}${memory.mediaId ? " · has a photo" : ""}`,
              )
              .join("\n"),
          ].join("\n"),
        },
      ],
      maxOutputTokens: 1500,
      temperature: 0.55,
    });

    if (!result.ok) {
      await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "failures" });
      await ctx.runMutation(internal.ai.store.failArtifact, { kind: "story", key: artifactKey, message: result.message });
      return { ok: false as const, message: result.message };
    }

    await ctx.runMutation(internal.ai.store.bumpUsage, {
      userId,
      field: "calls",
      tokensIn: result.usage.in,
      tokensOut: result.usage.out,
    });

    // Only keep chapter references that point at memories they actually have.
    const validIds = new Set(memories.map((memory) => memory._id as string));
    const story = {
      ...result.data,
      chapters: result.data.chapters.map((chapter) => ({
        ...chapter,
        memoryIds: chapter.memoryIds.filter((id) => validIds.has(id)),
      })),
    };

    await ctx.runMutation(internal.ai.store.completeArtifact, {
      kind: "story",
      key: artifactKey,
      payload: story,
      model: result.model,
      ttlMs: STORY_TTL_MS,
    });

    return { ok: true as const, story, model: result.model };
  },
});

/* --- 7. Writing help while pinning ---------------------------------- */

export const draftAssist = action({
  args: {
    placeName: v.string(),
    note: v.optional(v.string()),
    title: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    happenedAt: v.optional(v.number()),
  },    handler: async (ctx, args): Promise<DraftAssistResult> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message };

    const blocked = await guard(ctx, who.userId);
    if (blocked) return { ok: false, message: blocked.message };

    const bundle: ContextBundle = await ctx.runQuery(internal.ai.context.load, { userId: who.userId });
    const result = await structured({
      kind: "draft.assist",
      schema: DraftAssistSchema,
      schemaName: "DraftAssist",
      system:
        "You help someone finish a travel memory they are pinning: a title, a short note, a few tags, the destination and the kind of place. " +
        "Use only what they typed plus the place name they chose. Do not invent details they did not imply. " +
        "If the draft is too thin to write a real note, set caution instead of padding it out. " +
        "The note is theirs to edit — write it plainly, in first person, without flourishes.",
      messages: [
        {
          role: "user",
          content: [
            `Place they picked: ${args.placeName}`,
            args.lat !== undefined && args.lng !== undefined ? `Coordinates: ${args.lat.toFixed(4)}, ${args.lng.toFixed(4)}` : "",
            args.happenedAt ? `Date: ${new Date(args.happenedAt).toISOString().slice(0, 10)}` : "",
            `Their draft title: ${args.title?.trim() || "(empty)"}`,
            `Their draft note: ${args.note?.trim() || "(empty)"}`,
            `Their draft tags: ${args.tags?.join(", ") || "(none)"}`,
            "",
            bundle.profile?.summary ? `Their travel profile: ${bundle.profile.summary}` : "No profile yet.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      maxOutputTokens: 500,
      temperature: 0.5,
    });

    if (!result.ok) return { ok: false, message: result.message };

    await ctx.runMutation(internal.ai.store.bumpUsage, {
      userId: who.userId,
      field: "calls",
      tokensIn: result.usage.in,
      tokensOut: result.usage.out,
    });
    return { ok: true, draft: result.data, model: result.model };
  },
});

/* --- 8. Feedback and the one entry point ---------------------------- */

export const feedback = mutation({
  args: {
    kind: v.string(),
    subject: v.string(),
    vote: v.union(v.literal("up"), v.literal("down"), v.literal("dismiss")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");
    await ctx.runMutation(internal.ai.store.recordFeedback, {
      userId,
      kind: args.kind,
      subject: args.subject,
      vote: args.vote,
      reason: args.reason,
    });
    return { ok: true };
  },
});

/**
 * The one call the app makes when a signed-in screen opens. Builds the profile
 * if it is missing or stale, then drafts recommendations for the dashboard.
 * Everything else is a read from what this produced.
 */
export const refresh = action({
  args: { surface: v.optional(v.union(v.literal("dashboard"), v.literal("explore"), v.literal("globe"))) },
  handler: async (ctx, args): Promise<RefreshResult> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message };

    // Housekeeping is opportunistic: expired rows are swept while nobody waits.
    await ctx.runMutation(internal.ai.store.sweepArtifacts, {});

    const profile = await ctx.runAction(api.profile.ensure, {});
    if (profile.ok === false) {
      return { ok: false, message: profile.message };
    }

    const recommended = await ctx.runAction(api.intelligence.recommend, {
      surface: args.surface ?? "dashboard",
    });
    return {
      ok: true,
      profile: { state: "state" in profile ? profile.state : undefined, analysed: profile.analysed },
      recommendations: {
        count: recommended.items.length,
        source: recommended.source ?? "counts",
        headline: recommended.headline,
      },
    };
  },
});
