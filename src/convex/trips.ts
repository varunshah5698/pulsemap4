import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalQuery, mutation, query, type ActionCtx } from "./_generated/server";
import { brief, guard, identity, type ContextBundle } from "./ai/context";
import { haversineKm } from "./ai/geo";
import { structured } from "./ai/provider";
import { TripPlanSchema } from "./ai/schemas";
import { stableKey } from "./ai/store";
import { budgetModeValidator, tripItemKindValidator, tripStatusValidator } from "./schema";
import { estimate, type CostEstimate } from "./cost";
import { FLIGHTS_UNAVAILABLE } from "./flights";

/**
 * Trips: real rows, real distances, AI drafts.
 *
 * The split matters. Planning is an action — it reads, thinks and proposes.
 * Writing is a mutation the person triggers (`applyPlan`, `addItems`), so the
 * assistant can offer a plan but can never quietly change somebody's holiday.
 */

type WeatherPanelShape = {
  source: string;
  available: boolean;
  months: { month: string; avgMaxC: number; avgMinC: number; avgRainMm: number; comfort: number }[];
  days?: { date: string; label: string; maxC: number; minC: number; rainMm: number }[];
};

export type PlannedItem = {
  kind: "place" | "activity" | "food" | "stay" | "transport" | "rest";
  title: string;
  detail?: string;
  googlePlaceId?: string;
  lat?: number;
  lng?: number;
  startMinute?: number;
  durationMinutes?: number;
  cost?: number;
  /** True when the stop is a real cached Google place rather than a suggestion. */
  real: boolean;
  placeName?: string;
};

export type PlannedDay = { day: number; theme: string; items: PlannedItem[] };

export type TripPlanResult = {
  ok: boolean;
  message?: string;
  title?: string;
  destination?: string;
  anchor?: { lat: number; lng: number } | null;
  days?: PlannedDay[];
  notes?: string[];
  assumptions?: string[];
  route?: {
    legs: { from: string; to: string; km: number; minutes: number; source: string; estimate: boolean }[];
    totalKm: number;
    totalMinutes: number;
    estimated: boolean;
    source: string;
    savedKm?: number;
    note?: string;
  } | null;
  cost?: CostEstimate;
  weather?: { source: string; available: boolean; months: { month: string; avgMaxC: number; avgMinC: number; avgRainMm: number; comfort: number }[] } | null;
  placesUsed?: { placeId: string; name: string; categoryLabel: string }[];
  model?: string;
  planKey?: string;
};

/* --- Reads ----------------------------------------------------------- */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const trips = await ctx.db
      .query("trips")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(30);

    const withCounts = [];
    for (const trip of trips) {
      const items = await ctx.db
        .query("tripItems")
        .withIndex("by_trip", (q) => q.eq("tripId", trip._id))
        .take(200);
      withCounts.push({ ...trip, itemCount: items.length, stopCount: items.filter((item) => item.kind === "place").length });
    }
    return withCounts;
  },
});

export const get = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const trip = await ctx.db.get(args.tripId);
    if (!trip || trip.userId !== userId) return null;
    const items = await ctx.db
      .query("tripItems")
      .withIndex("by_trip_day", (q) => q.eq("tripId", args.tripId))
      .take(300);
    return { trip, items };
  },
});

/** Used by the assistant: the trip someone is looking at right now. */
export const activeForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const trip = await ctx.db
      .query("trips")
      .withIndex("by_user_status", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();
    if (!trip) return null;
    const items = await ctx.db
      .query("tripItems")
      .withIndex("by_trip", (q) => q.eq("tripId", trip._id))
      .take(60);
    return { trip, items };
  },
});

/* --- Writes (always a deliberate, confirmed action) ------------------ */

export const create = mutation({
  args: {
    title: v.string(),
    destination: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    status: v.optional(tripStatusValidator),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    travellers: v.optional(v.number()),
    budgetMode: v.optional(budgetModeValidator),
    budgetCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    interests: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    origin: v.optional(v.union(v.literal("manual"), v.literal("pulse"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");
    const now = Date.now();
    return await ctx.db.insert("trips", {
      userId,
      title: args.title.slice(0, 80),
      destination: args.destination.slice(0, 120),
      lat: args.lat,
      lng: args.lng,
      status: args.status ?? "planning",
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      travellers: Math.max(1, Math.min(16, args.travellers ?? 1)),
      budgetMode: args.budgetMode ?? "balanced",
      budgetCents: args.budgetCents,
      currency: (args.currency ?? "INR").toUpperCase().slice(0, 4),
      interests: (args.interests ?? []).slice(0, 10),
      notes: args.notes?.slice(0, 600),
      origin: args.origin ?? "manual",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    tripId: v.id("trips"),
    title: v.optional(v.string()),
    destination: v.optional(v.string()),
    status: v.optional(tripStatusValidator),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    travellers: v.optional(v.number()),
    budgetMode: v.optional(budgetModeValidator),
    budgetCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    interests: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");
    const trip = await ctx.db.get(args.tripId);
    if (!trip || trip.userId !== userId) throw new Error("That trip is not yours.");
    await ctx.db.patch(args.tripId, {
      title: args.title?.slice(0, 80) ?? trip.title,
      destination: args.destination?.slice(0, 120) ?? trip.destination,
      status: args.status ?? trip.status,
      startsAt: args.startsAt ?? trip.startsAt,
      endsAt: args.endsAt ?? trip.endsAt,
      travellers: args.travellers ?? trip.travellers,
      budgetMode: args.budgetMode ?? trip.budgetMode,
      budgetCents: args.budgetCents ?? trip.budgetCents,
      currency: args.currency?.toUpperCase().slice(0, 4) ?? trip.currency,
      interests: args.interests?.slice(0, 10) ?? trip.interests,
      notes: args.notes?.slice(0, 600) ?? trip.notes,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const remove = mutation({
  args: { tripId: v.id("trips") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");
    const trip = await ctx.db.get(args.tripId);
    if (!trip || trip.userId !== userId) throw new Error("That trip is not yours.");
    const items = await ctx.db
      .query("tripItems")
      .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
      .take(300);
    for (const item of items) await ctx.db.delete(item._id);
    await ctx.db.delete(args.tripId);
    return { ok: true, removed: items.length };
  },
});

export const addItems = mutation({
  args: {
    tripId: v.id("trips"),
    source: v.optional(v.union(v.literal("ai"), v.literal("user"))),
    items: v.array(
      v.object({
        day: v.number(),
        kind: tripItemKindValidator,
        title: v.string(),
        detail: v.optional(v.string()),
        lat: v.optional(v.number()),
        lng: v.optional(v.number()),
        googlePlaceId: v.optional(v.string()),
        startMinute: v.optional(v.number()),
        durationMinutes: v.optional(v.number()),
        costCents: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");
    const trip = await ctx.db.get(args.tripId);
    if (!trip || trip.userId !== userId) throw new Error("That trip is not yours.");

    const existing = await ctx.db
      .query("tripItems")
      .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
      .take(300);
    const perDay = new Map<number, number>();
    for (const item of existing) perDay.set(item.day, Math.max(perDay.get(item.day) ?? 0, item.order + 1));

    const now = Date.now();
    for (const item of args.items.slice(0, 120)) {
      const order = perDay.get(item.day) ?? 0;
      perDay.set(item.day, order + 1);
      await ctx.db.insert("tripItems", {
        tripId: args.tripId,
        userId,
        day: Math.max(1, Math.min(60, Math.round(item.day))),
        order,
        kind: item.kind,
        title: item.title.slice(0, 120),
        detail: item.detail?.slice(0, 400),
        lat: item.lat,
        lng: item.lng,
        googlePlaceId: item.googlePlaceId,
        startMinute: item.startMinute,
        durationMinutes: item.durationMinutes,
        costCents: item.costCents,
        source: args.source ?? "user",
        createdAt: now,
      });
    }
    await ctx.db.patch(args.tripId, { updatedAt: now });
    return { ok: true, added: Math.min(120, args.items.length) };
  },
});

export const removeItem = mutation({
  args: { itemId: v.id("tripItems") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");
    const item = await ctx.db.get(args.itemId);
    if (!item || item.userId !== userId) throw new Error("That stop is not yours.");
    await ctx.db.delete(args.itemId);
    await ctx.db.patch(item.tripId, { updatedAt: Date.now() });
    return { ok: true };
  },
});

/** Clear a day, or the whole plan, before applying a new one. */
export const clearItems = mutation({
  args: { tripId: v.id("trips"), day: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");
    const trip = await ctx.db.get(args.tripId);
    if (!trip || trip.userId !== userId) throw new Error("That trip is not yours.");
    const items = await ctx.db
      .query("tripItems")
      .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
      .take(300);
    let removed = 0;
    for (const item of items) {
      if (args.day !== undefined && item.day !== args.day) continue;
      await ctx.db.delete(item._id);
      removed += 1;
    }
    return { ok: true, removed };
  },
});

/** Reorder a day's stops after an optimisation the person accepted. */
export const applyOrder = mutation({
  args: { tripId: v.id("trips"), day: v.number(), itemIds: v.array(v.id("tripItems")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");
    const trip = await ctx.db.get(args.tripId);
    if (!trip || trip.userId !== userId) throw new Error("That trip is not yours.");
    let order = 0;
    for (const id of args.itemIds) {
      const item = await ctx.db.get(id);
      if (!item || item.userId !== userId || item.tripId !== args.tripId) continue;
      await ctx.db.patch(id, { order, day: args.day });
      order += 1;
    }
    await ctx.db.patch(args.tripId, { updatedAt: Date.now() });
    return { ok: true, ordered: order };
  },
});

/* --- Planning -------------------------------------------------------- */

/** Turn a destination string into real coordinates, through real search. */
async function anchorFor(
  ctx: ActionCtx,
  destination: string,
  hint?: { lat: number; lng: number },
): Promise<{ lat: number; lng: number; name: string } | null> {
  if (hint) return { ...hint, name: destination };
  const result = await ctx.runAction(api.places.search, { textQuery: destination });
  if (!result.ok || result.places.length === 0) return null;
  const first = result.places[0];
  return { lat: first.lat, lng: first.lng, name: first.name };
}

/**
 * Draft an itinerary. Real places only: the model may organise the stops, but
 * every place it names has to exist in our cache, and the geometry is fixed by
 * real routing afterwards.
 */
export const plan = action({
  args: {
    destination: v.string(),
    days: v.number(),
    travellers: v.optional(v.number()),
    budgetMode: v.optional(budgetModeValidator),
    budgetCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    interests: v.optional(v.array(v.string())),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    relax: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<TripPlanResult> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message };
    const userId = who.userId;

    const blocked = await guard(ctx, userId);
    if (blocked) return { ok: false, message: blocked.message };

    const days = Math.max(1, Math.min(21, Math.round(args.days)));
    const destination = args.destination.trim().slice(0, 120);
    if (destination.length < 2) return { ok: false, message: "Where are we going?" };

    const anchor = await anchorFor(
      ctx,
      destination,
      typeof args.lat === "number" && typeof args.lng === "number"
        ? { lat: args.lat, lng: args.lng }
        : undefined,
    );
    if (!anchor) {
      return { ok: false, message: `I could not find ${destination} on the map. Try the place search first.` };
    }

    // Pull real places around the anchor, then read them back from our cache.
    await ctx.runAction(api.places.ensure, {
      lat: anchor.lat,
      lng: anchor.lng,
      radiusKm: 25,
      scope: "all",
    });
    const nearby = await ctx.runQuery(api.places.around, {
      lat: anchor.lat,
      lng: anchor.lng,
      radiusKm: 25,
    });

    const bundle: ContextBundle = await ctx.runQuery(internal.ai.context.load, { userId });
    // Climate for the destination, cached the same way every other surface
    // reads it, so planning twice in a day costs one forecast.
    const weatherKey = `${anchor.lat.toFixed(2)}:${anchor.lng.toFixed(2)}`;
    const weatherArtifact = await ctx.runQuery(internal.ai.store.readArtifact, {
      kind: "weather",
      key: weatherKey,
    });
    let weatherPanel =
      weatherArtifact?.state === "ready" ? (weatherArtifact.payload as WeatherPanelShape) : null;
    if (!weatherPanel) {
      const fresh = (await ctx.runAction(internal.weather.panel, {
        lat: anchor.lat,
        lng: anchor.lng,
      })) as WeatherPanelShape;
      weatherPanel = fresh;
      await ctx.runMutation(internal.ai.store.completeArtifact, {
        kind: "weather",
        key: weatherKey,
        payload: fresh,
        ttlMs: 6 * 60 * 60 * 1000,
      });
    }

    const months = weatherPanel?.months ?? [];

    const placeLines = nearby.slice(0, 22).map(
      (place) =>
        `- ${place.name} · ${place.categoryLabel}${place.rating ? ` · ${place.rating.toFixed(1)}★ (${place.reviewCount ?? 0})` : ""} · ${place.lat.toFixed(4)},${place.lng.toFixed(4)} · id ${place.id}`,
    );

    const relax = args.relax ?? 0;
    const result = await structured({
      kind: "trip.plan",
      schema: TripPlanSchema,
      schemaName: "TripPlan",
      system:
        "You are planning a real trip around real places. " +
        "You may ONLY use the places listed below, exactly as named, with their ids and coordinates. " +
        "Never invent a place, a price, an opening time or a flight. " +
        "Build a day-by-day plan that keeps travel between stops sensible and gives each day a theme. " +
        "Include rests and meals as items where they belong; a plan with no breathing room is a bad plan. " +
        "Put anything you cannot know into 'assumptions'.",
      messages: [
        {
          role: "user",
          content: [
            `Destination: ${destination} (${anchor.lat.toFixed(4)}, ${anchor.lng.toFixed(4)})`,
            `Trip length: ${days} day${days === 1 ? "" : "s"}`,
            `Travellers: ${args.travellers ?? 1}`,
            `Spending level: ${args.budgetMode ?? bundle.profile?.budgetLean ?? "balanced"}`,
            args.interests?.length ? `Interests they named: ${args.interests.join(", ")}` : "",
            relax > 0 ? `They asked for a ${relax === 1 ? "more relaxed" : "much more relaxed"} pace: fewer stops, longer sits.` : "",
            "",
            months.length > 0
              ? `Climate normals for ${destination}: ${months
                  .map((month) => `${month.month} ${month.avgMaxC}/${month.avgMinC}°C ${Math.round(month.avgRainMm)}mm`)
                  .join("; ")}`
              : "No climate data for this point.",
            "",
            "Real places you may use (the entire allowed set):",
            placeLines.join("\n"),
            "",
            brief(bundle, { memoryLimit: 16 }),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      maxOutputTokens: 1800,
      temperature: 0.5,
    });

    if (!result.ok) {
      await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "failures" });
      return { ok: false, message: result.message };
    }

    await ctx.runMutation(internal.ai.store.bumpUsage, {
      userId,
      field: "calls",
      tokensIn: result.usage.in,
      tokensOut: result.usage.out,
    });

    // Keep only stops we can point at on the map.
    const byId = new Map(nearby.map((place) => [place.id, place]));
    const byName = new Map(nearby.map((place) => [place.name.toLowerCase(), place]));
    const used = new Map<string, { placeId: string; name: string; categoryLabel: string }>();
    let dropped = 0;

    const cleanedDays: PlannedDay[] = result.data.days.slice(0, days).map((day) => ({
      day: day.day,
      theme: day.theme,
      items: day.items.slice(0, 8).map((item) => {
        const match =
          (item.googlePlaceId ? byId.get(item.googlePlaceId) : undefined) ??
          byName.get(item.title.toLowerCase()) ??
          (item.lat !== undefined && item.lng !== undefined
            ? nearby.find((place) => haversineKm(place, { lat: item.lat as number, lng: item.lng as number }) <= 0.6)
            : undefined);
        if (item.kind === "place" && !match) dropped += 1;
        if (match) used.set(match.id, { placeId: match.id, name: match.name, categoryLabel: match.categoryLabel });
        return {
          kind: item.kind,
          title: match?.name ?? item.title,
          detail: item.detail,
          googlePlaceId: match?.id,
          lat: match?.lat ?? item.lat,
          lng: match?.lng ?? item.lng,
          startMinute: item.startMinute,
          durationMinutes: item.durationMinutes,
          cost: item.cost,
          real: Boolean(match),
          placeName: match ? undefined : item.title,
        };
      }),
    }));

    // Real geometry: order the stops the way a driver would.
    const stops = Array.from(used.values()).map((place) => {
      const row = byId.get(place.placeId);
      return {
        name: place.name,
        placeId: place.placeId,
        lat: row?.lat ?? anchor.lat,
        lng: row?.lng ?? anchor.lng,
      };
    });

    const route =
      stops.length >= 2
        ? await ctx.runAction(internal.routes.optimise, { stops, mode: "drive" })
        : null;

    const nights = Math.max(1, days - 1);
    const priceLevels = nearby
      .map((place) => place.priceLevel)
      .filter((level): level is string => typeof level === "string" && level.length > 0);

    const cost = estimate({
      nights,
      travellers: args.travellers ?? 1,
      mode: args.budgetMode ?? "balanced",
      currency: args.currency ?? "INR",
      legs: route?.legs.map((leg) => ({ km: leg.km, minutes: leg.minutes, mode: "drive" })),
      priceLevels,
      longHaul: haversineKm(anchor, bundle.centroid ?? anchor) > 1500 || bundle.centroid === null,
      flightNote: FLIGHTS_UNAVAILABLE,
    });

    const planKey = stableKey([userId, destination, days, args.budgetMode ?? "balanced", anchor.lat, anchor.lng, relax]);

    return {
      ok: true,
      title: result.data.title,
      destination,
      anchor,
      days: cleanedDays,
      notes: result.data.notes,
      assumptions: [...result.data.assumptions, dropped > 0 ? `${dropped} suggested stop(s) were left out because they are not real places on the map.` : ""].filter(Boolean),
      route: route
        ? {
            legs: route.legs.map((leg) => ({ from: leg.from, to: leg.to, km: leg.km, minutes: leg.minutes, source: leg.source, estimate: leg.estimate })),
            totalKm: route.totalKm,
            totalMinutes: route.totalMinutes,
            estimated: route.estimated,
            source: route.source,
            savedKm: route.savedKm,
            note: route.note,
          }
        : null,
      cost,
      weather: weatherPanel ? { source: weatherPanel.source, available: weatherPanel.available, months: months } : null,
      placesUsed: Array.from(used.values()),
      model: result.model,
      planKey,
    };
  },
});

/**
 * Apply a plan the person accepted. This is the only path that writes a plan,
 * and it is called from a button, never from the model's own initiative.
 */
export const applyPlan = mutation({
  args: {
    tripId: v.optional(v.id("trips")),
    title: v.string(),
    destination: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    travellers: v.optional(v.number()),
    budgetMode: v.optional(budgetModeValidator),
    currency: v.optional(v.string()),
    interests: v.optional(v.array(v.string())),
    days: v.array(
      v.object({
        day: v.number(),
        theme: v.string(),
        items: v.array(
          v.object({
            kind: tripItemKindValidator,
            title: v.string(),
            detail: v.optional(v.string()),
            lat: v.optional(v.number()),
            lng: v.optional(v.number()),
            googlePlaceId: v.optional(v.string()),
            startMinute: v.optional(v.number()),
            durationMinutes: v.optional(v.number()),
            costCents: v.optional(v.number()),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");
    const now = Date.now();

    let tripId: Id<"trips">;
    if (args.tripId) {
      const trip = await ctx.db.get(args.tripId);
      if (!trip || trip.userId !== userId) throw new Error("That trip is not yours.");
      tripId = args.tripId;
      await ctx.db.patch(tripId, {
        title: args.title.slice(0, 80),
        destination: args.destination.slice(0, 120),
        lat: args.lat,
        lng: args.lng,
        travellers: args.travellers ?? trip.travellers,
        budgetMode: args.budgetMode ?? trip.budgetMode,
        currency: args.currency?.toUpperCase().slice(0, 4) ?? trip.currency,
        interests: args.interests ?? trip.interests,
        updatedAt: now,
      });
      // Replacing a plan replaces its stops, so the itinerary never doubles up.
      const existing = await ctx.db
        .query("tripItems")
        .withIndex("by_trip", (q) => q.eq("tripId", tripId))
        .take(300);
      for (const item of existing) {
        if (item.source === "ai") await ctx.db.delete(item._id);
      }
    } else {
      tripId = await ctx.db.insert("trips", {
        userId,
        title: args.title.slice(0, 80),
        destination: args.destination.slice(0, 120),
        lat: args.lat,
        lng: args.lng,
        status: "planning",
        travellers: args.travellers ?? 1,
        budgetMode: args.budgetMode ?? "balanced",
        currency: (args.currency ?? "INR").toUpperCase().slice(0, 4),
        interests: args.interests ?? [],
        origin: "pulse",
        createdAt: now,
        updatedAt: now,
      });
    }

    let added = 0;
    for (const day of args.days.slice(0, 21)) {
      let order = 0;
      for (const item of day.items.slice(0, 12)) {
        await ctx.db.insert("tripItems", {
          tripId,
          userId,
          day: Math.max(1, Math.min(60, Math.round(day.day))),
          order,
          kind: item.kind,
          title: item.title.slice(0, 120),
          detail: item.detail?.slice(0, 400),
          lat: item.lat,
          lng: item.lng,
          googlePlaceId: item.googlePlaceId,
          startMinute: item.startMinute,
          durationMinutes: item.durationMinutes,
          costCents: item.costCents,
          source: "ai",
          createdAt: now,
        });
        order += 1;
        added += 1;
      }
    }

    return { ok: true, tripId, added };
  },
});

/* --- Optimising and costing an existing trip ------------------------ */

export type OptimiseResult = {
  ok: boolean;
  message?: string;
  day?: number;
  order?: { itemId: Id<"tripItems">; title: string }[];
  route?: TripPlanResult["route"];
  savedKm?: number;
  note?: string;
};

export const optimise = action({
  args: { tripId: v.id("trips"), day: v.optional(v.number()) },
  handler: async (ctx, args): Promise<OptimiseResult> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message };

    const bundle = await ctx.runQuery(api.trips.get, { tripId: args.tripId });
    if (!bundle || bundle.trip.userId !== who.userId) return { ok: false, message: "That trip is not yours." };

    const day = args.day ?? 1;
    const stops = bundle.items
      .filter((item) => item.day === day && typeof item.lat === "number" && typeof item.lng === "number")
      .sort((a, b) => a.order - b.order);

    if (stops.length < 3) {
      return { ok: false, message: "A day needs at least three placed stops before reordering helps." };
    }

    const route = await ctx.runAction(internal.routes.optimise, {
      stops: stops.map((item) => ({ name: item.title, lat: item.lat as number, lng: item.lng as number, placeId: item.googlePlaceId })),
      mode: "drive",
    });

    // Map the reordered stops back onto real item ids by coordinates.
    const order = route.stops
      .map((stop) => stops.find((item) => Math.abs((item.lat as number) - stop.lat) < 1e-6 && Math.abs((item.lng as number) - stop.lng) < 1e-6))
      .filter((item): item is (typeof stops)[number] => Boolean(item))
      .map((item) => ({ itemId: item._id, title: item.title }));

    return {
      ok: true,
      day,
      order,
      route: {
        legs: route.legs.map((leg) => ({ from: leg.from, to: leg.to, km: leg.km, minutes: leg.minutes, source: leg.source, estimate: leg.estimate })),
        totalKm: route.totalKm,
        totalMinutes: route.totalMinutes,
        estimated: route.estimated,
        source: route.source,
        savedKm: route.savedKm,
        note: route.note,
      },
      savedKm: route.savedKm,
      note: route.note,
    };
  },
});

export type TripCostResult = { ok: boolean; message?: string; cost?: CostEstimate; nights?: number };

export const costFor = action({
  args: {
    tripId: v.optional(v.id("trips")),
    destinations: v.optional(v.array(v.string())),
    nights: v.optional(v.number()),
    travellers: v.optional(v.number()),
    budgetMode: v.optional(budgetModeValidator),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<TripCostResult> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message };

    let nights = args.nights ?? 0;
    let travellers = args.travellers ?? 1;
    let mode = args.budgetMode ?? "balanced";
    let currency = args.currency ?? "INR";
    const stops: { name: string; lat: number; lng: number }[] = [];
    let legs: { km: number; minutes: number; mode: string }[] = [];
    const priceLevels: string[] = [];

    if (args.tripId) {
      const bundle = await ctx.runQuery(api.trips.get, { tripId: args.tripId });
      if (!bundle || bundle.trip.userId !== who.userId) return { ok: false, message: "That trip is not yours." };
      const trip = bundle.trip;
      travellers = trip.travellers;
      mode = trip.budgetMode;
      currency = trip.currency;
      if (trip.startsAt && trip.endsAt) {
        nights = Math.max(1, Math.round((trip.endsAt - trip.startsAt) / 86_400_000));
      }
      for (const item of bundle.items) {
        if (typeof item.lat === "number" && typeof item.lng === "number") {
          stops.push({ name: item.title, lat: item.lat, lng: item.lng });
        }
      }
      if (stops.length >= 2) {
        const route = await ctx.runAction(internal.routes.route, {
          stops: stops.slice(0, 12).map((stop) => ({ name: stop.name, lat: stop.lat, lng: stop.lng })),
          mode: "drive",
        });
        legs = route.legs.map((leg) => ({ km: leg.km, minutes: leg.minutes, mode: "drive" }));
      }
      if (stops.length > 0) {
        const nearby = await ctx.runQuery(api.places.around, {
          lat: stops[0].lat,
          lng: stops[0].lng,
          radiusKm: 20,
        });
        for (const place of nearby.slice(0, 20)) {
          if (typeof place.priceLevel === "string") priceLevels.push(place.priceLevel);
        }
      }
    } else if (args.destinations?.length) {
      // Name the places, then measure them: real coordinates, real legs.
      for (const name of args.destinations.slice(0, 8)) {
        const found = await anchorFor(ctx, name);
        if (found) stops.push({ name: found.name, lat: found.lat, lng: found.lng });
      }
      if (stops.length >= 2) {
        const route = await ctx.runAction(internal.routes.route, {
          stops: stops.map((stop) => ({ name: stop.name, lat: stop.lat, lng: stop.lng })),
          mode: "drive",
        });
        legs = route.legs.map((leg) => ({ km: leg.km, minutes: leg.minutes, mode: "drive" }));
      }
    }

    if (nights <= 0) nights = Math.max(2, stops.length * 2);

    const cost = estimate({
      nights,
      travellers,
      mode,
      currency,
      legs,
      priceLevels,
      longHaul: true,
      flightNote: FLIGHTS_UNAVAILABLE,
    });

    return { ok: true, cost, nights };
  },
});
