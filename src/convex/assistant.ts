import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, mutation, type ActionCtx } from "./_generated/server";
import { brief, guard, identity, type ContextBundle } from "./ai/context";
import { formatDuration, haversineKm } from "./ai/geo";
import { structured } from "./ai/provider";
import { AssistantAnswerSchema, AssistantPlanSchema, type AssistantPlan } from "./ai/schemas";
import { stableKey } from "./ai/store";
import { budgetModeValidator, tripItemKindValidator } from "./schema";
import type { CostEstimate } from "./cost";
import { FLIGHTS_UNAVAILABLE } from "./flights";

/**
 * Pulse, the conversational door into the same brain the rest of the product
 * uses. It is not a separate assistant with its own opinions: it reads the same
 * profile, the same cached places and the same counted facts, and it can only
 * act through the same mutations a person could tap.
 *
 * Flow, per question:
 *   1. read intent (one small structured call, given the live page context),
 *   2. run that intent against real data — places, routes, weather, costs,
 *      trips, memories — with no model in the loop,
 *   3. write the answer from what came back (a second call, given the data),
 *   4. offer the actions that make sense, as proposals the person confirms.
 */

const REPLY_TTL_MS = 24 * 60 * 60 * 1000;

/* --- What comes back to the interface ------------------------------- */

export type AssistantCard =
  | {
      type: "place";
      placeId: string;
      name: string;
      categoryLabel: string;
      address: string | null;
      rating: number | null;
      reviewCount: number | null;
      openNow: boolean | null;
      mapsUrl: string | null;
      photoUrl: string | null;
      distanceKm: number | null;
      why: string[];
    }
  | {
      type: "destination";
      name: string;
      lat: number;
      lng: number;
      why: string[];
      bestMonths: string[];
      cost: { currency: string; low: number; high: number } | null;
      tags: string[];
      confidence: number;
    }
  | { type: "cost"; estimate: CostEstimate; label: string }
  | {
      type: "route";
      label: string;
      stops: { name: string; lat: number; lng: number }[];
      legs: { from: string; to: string; km: number; minutes: number; source: string; estimate: boolean }[];
      totalKm: number;
      totalMinutes: number;
      estimated: boolean;
      source: string;
      note?: string;
    }
  | {
      type: "itinerary";
      title: string;
      destination: string;
      days: {
        day: number;
        theme: string;
        items: { title: string; kind: string; detail?: string; real: boolean; googlePlaceId?: string }[];
      }[];
      notes: string[];
    }
  | {
      type: "weather";
      place: string;
      source: string;
      available: boolean;
      reason?: string;
      now?: { maxC: number; minC: number; rainMm: number; label: string };
      days: { date: string; label: string; maxC: number; minC: number; rainMm: number }[];
      months: { month: string; avgMaxC: number; avgMinC: number; avgRainMm: number; comfort: number }[];
    }
  | { type: "memory"; id: string; title: string; placeName: string; happenedAt: number; why?: string }
  | { type: "flight"; source: string; available: boolean; reason?: string; offers: { airline: string; from: string; to: string; price: number; currency: string; stops: number }[] }
  | { type: "note"; heading: string; body: string };

export type AssistantUi = {
  kind: "openPlace" | "focusGlobe" | "showRoute" | "openTrip" | "planHere";
  label: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  spanKm?: number;
  tripId?: string;
};

export type AssistantProposal = {
  kind: "savePlace" | "createTrip" | "addToTrip";
  label: string;
  summary: string;
  placeId?: string;
  name?: string;
  lat?: number;
  lng?: number;
  category?: string;
  tripTitle?: string;
  destination?: string;
  days?: number;
  travellers?: number;
  budgetMode?: "budget" | "balanced" | "comfort" | "luxury";
  currency?: string;
  items?: {
    day: number;
    kind: "place" | "activity" | "food" | "stay" | "transport" | "rest";
    title: string;
    detail?: string;
    lat?: number;
    lng?: number;
    googlePlaceId?: string;
    costCents?: number;
  }[];
};

export type AssistantReply = {
  ok: boolean;
  message?: string;
  answer?: string;
  cards?: AssistantCard[];
  ui?: AssistantUi[];
  proposals?: AssistantProposal[];
  followUps?: string[];
  sources?: string[];
  intent?: string;
  action?: string;
  model?: string;
  cached?: boolean;
};

/* --- Context the client hands over ---------------------------------- */

const contextValidator = v.object({
  route: v.string(),
  placeId: v.optional(v.string()),
  placeName: v.optional(v.string()),
  memoryId: v.optional(v.id("memories")),
  tripId: v.optional(v.id("trips")),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  spanKm: v.optional(v.number()),
  filters: v.optional(v.array(v.string())),
  label: v.optional(v.string()),
});

type PageContext = {
  route: string;
  placeId?: string;
  placeName?: string;
  memoryId?: Id<"memories">;
  tripId?: Id<"trips">;
  lat?: number;
  lng?: number;
  spanKm?: number;
  filters?: string[];
  label?: string;
};

/** A short, human description of where the person is standing. */
function describeContext(context: PageContext): string {
  const parts: string[] = [`Screen: ${context.route}`];
  if (context.placeName) parts.push(`They are looking at the place "${context.placeName}"`);
  if (typeof context.lat === "number" && typeof context.lng === "number") {
    parts.push(`The map view is centred on ${context.lat.toFixed(3)}, ${context.lng.toFixed(3)}${context.spanKm ? ` (about ${Math.round(context.spanKm)} km across)` : ""}`);
  }
  if (context.filters?.length) parts.push(`Active filters: ${context.filters.join(", ")}`);
  if (context.tripId) parts.push("They have a trip open");
  if (context.memoryId) parts.push("They have one of their memories open");
  return parts.join("\n");
}

/* --- Tool execution -------------------------------------------------- */

type ToolOutput = {
  cards: AssistantCard[];
  ui: AssistantUi[];
  proposals: AssistantProposal[];
  sources: string[];
  /** The compact data block handed to the answering call. */
  facts: string;
  note?: string;
  needsConfirmation?: boolean;
};

function argString(args: Record<string, string | number | boolean> | undefined, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function argNumber(args: Record<string, string | number | boolean> | undefined, key: string): number | undefined {
  const value = args?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/** Where to look when a question is about "here". */
function viewPoint(context: PageContext): { lat: number; lng: number } | null {
  if (typeof context.lat === "number" && typeof context.lng === "number") {
    return { lat: context.lat, lng: context.lng };
  }
  return null;
}

async function runTool(
  ctx: ActionCtx,
  plan: AssistantPlan,
  context: PageContext,
  bundle: ContextBundle,
): Promise<ToolOutput> {
  const empty: ToolOutput = { cards: [], ui: [], proposals: [], sources: [], facts: "No data was gathered for this request." };
  const userId = bundle.userId;

  switch (plan.action) {
    case "searchPlaces": {
      const query = argString(plan.args, "query") ?? argString(plan.args, "textQuery");
      if (!query) return { ...empty, note: "I need a place, city or kind of place to search for." };
      const result = await ctx.runAction(api.places.search, {
        textQuery: query,
        lat: context.lat,
        lng: context.lng,
      });
      if (!result.ok) return { ...empty, note: result.message };
      const cards: AssistantCard[] = result.places.slice(0, 6).map((place) => ({
        type: "place",
        placeId: place.id,
        name: place.name,
        categoryLabel: place.categoryLabel,
        address: place.address ?? place.shortAddress ?? null,
        rating: place.rating,
        reviewCount: place.reviewCount,
        openNow: place.openNow,
        mapsUrl: place.googleMapsUri,
        photoUrl: place.photoUrl,
        distanceKm: place.distanceKm,
        why: [],
      }));
      return {
        cards,
        ui: cards.slice(0, 3).map((card) => ({
          kind: "openPlace" as const,
          label: `Open ${card.type === "place" ? card.name : ""}`,
          placeId: card.type === "place" ? card.placeId : undefined,
        })),
        proposals: [],
        sources: [`Google Places search for "${query}"`],
        facts: cards
          .map(
            (card) =>
              card.type === "place"
                ? `- ${card.name} (${card.categoryLabel})${card.rating ? `, ${card.rating.toFixed(1)}★ from ${card.reviewCount ?? 0} reviews` : ""}${card.address ? `, ${card.address}` : ""}${card.openNow !== null ? (card.openNow ? ", open now" : ", closed now") : ""}${card.distanceKm !== null ? `, ${card.distanceKm} km from the view` : ""}`
                : "",
          )
          .join("\n"),
      };
    }

    case "findNearbyPlaces": {
      const point = viewPoint(context) ?? bundle.centroid;
      if (!point) return { ...empty, note: "Move the map somewhere first and I can look around it." };
      const radiusKm = Math.min(50, Math.max(5, Math.round((context.spanKm ?? 60) * 0.5)));
      await ctx.runAction(api.places.ensure, { lat: point.lat, lng: point.lng, radiusKm, scope: "all" });
      const rows = await ctx.runQuery(api.places.around, { lat: point.lat, lng: point.lng, radiusKm });
      const cards: AssistantCard[] = rows.slice(0, 8).map((place) => ({
        type: "place",
        placeId: place.id,
        name: place.name,
        categoryLabel: place.categoryLabel,
        address: place.shortAddress ?? place.address ?? null,
        rating: place.rating,
        reviewCount: place.reviewCount,
        openNow: place.openNow,
        mapsUrl: place.googleMapsUri,
        photoUrl: place.photoUrl,
        distanceKm: place.distanceKm,
        why: [],
      }));
      return {
        cards,
        ui: [{ kind: "focusGlobe", label: "Show this on the globe", lat: point.lat, lng: point.lng, spanKm: radiusKm }],
        proposals: [],
        sources: [`${rows.length} real Google places within ${radiusKm} km`],
        facts: cards.map((card) => (card.type === "place" ? `- ${card.name} (${card.categoryLabel}) ${card.distanceKm} km` : "")).join("\n"),
      };
    }

    case "getPlaceDetails": {
      const placeId = argString(plan.args, "placeId") ?? context.placeId;
      if (!placeId) return { ...empty, note: "Which place should I open?" };
      const resolved = await ctx.runAction(api.places.resolve, { placeId });
      if (!resolved.ok) return { ...empty, note: resolved.message };
      const place = resolved.place;
      const intel = await ctx.runAction(api.intelligence.explainPlace, { placeId });
      const card: AssistantCard = {
        type: "place",
        placeId: place.id,
        name: place.name,
        categoryLabel: place.categoryLabel,
        address: place.address ?? place.shortAddress ?? null,
        rating: place.rating,
        reviewCount: place.reviewCount,
        openNow: place.openNow,
        mapsUrl: place.googleMapsUri,
        photoUrl: place.photoUrl,
        distanceKm: place.distanceKm,
        why: intel.ok ? intel.intel?.whyFits ?? [] : [],
      };
      const cards: AssistantCard[] = [card];
      if (intel.ok && intel.intel) {
        if (intel.intel.bestMonths.length > 0) {
          cards.push({
            type: "note",
            heading: "Best months",
            body: intel.intel.bestMonths
              .slice(0, 4)
              .map((month) => `${month.month}: ${month.note}`)
              .join("\n"),
          });
        }
        cards.push({ type: "cost", estimate: intel.intel.cost, label: `${place.name} — a ${intel.intel.stay.min}-day stay` });
      }
      return {
        cards,
        ui: [
          { kind: "openPlace", label: `Open ${place.name}`, placeId: place.id },
          { kind: "focusGlobe", label: "Show on the globe", lat: place.lat, lng: place.lng, spanKm: 40 },
        ],
        proposals: [
          {
            kind: "savePlace",
            label: "Save this place",
            summary: `Adds ${place.name} to your saved places so it shows up in recommendations.`,
            placeId: place.id,
            name: place.name,
            lat: place.lat,
            lng: place.lng,
            category: place.categoryLabel,
          },
        ],
        sources: ["Google Places details", "Open-Meteo climate", "Your own history"],
        facts: `${place.name} — ${place.categoryLabel}${place.rating ? `, ${place.rating}★ (${place.reviewCount ?? 0})` : ""}${place.hours?.length ? `, hours: ${place.hours.join(" | ")}` : ""}${place.website ? `, website ${place.website}` : ""}`,
      };
    }

    case "getRoute": {
      const names = [argString(plan.args, "from"), argString(plan.args, "to")].filter(
        (value): value is string => Boolean(value),
      );
      const stops: { name: string; lat: number; lng: number }[] = [];
      if (names.length === 2) {
        for (const name of names) {
          const found = await ctx.runAction(api.places.search, { textQuery: name });
          const first = found.ok ? found.places[0] : undefined;
          if (first) stops.push({ name: first.name, lat: first.lat, lng: first.lng });
        }
      } else if (viewPoint(context) && bundle.centroid) {
        stops.push({ name: "Your roaming centre", lat: bundle.centroid.lat, lng: bundle.centroid.lng });
      }
      if (stops.length < 2) return { ...empty, note: "Tell me two places and I will measure the route between them." };

      const route = await ctx.runAction(internal.routes.route, { stops, mode: "drive" });
      return {
        cards: [
          {
            type: "route",
            label: `${stops[0].name} → ${stops[stops.length - 1].name}`,
            stops: route.stops.map((stop) => ({ name: stop.name, lat: stop.lat, lng: stop.lng })),
            legs: route.legs.map((leg) => ({
              from: leg.from,
              to: leg.to,
              km: leg.km,
              minutes: leg.minutes,
              source: leg.source,
              estimate: leg.estimate,
            })),
            totalKm: route.totalKm,
            totalMinutes: route.totalMinutes,
            estimated: route.estimated,
            source: route.source,
            note: route.note,
          },
        ],
        ui: [
          { kind: "showRoute", label: "Show this on the globe", lat: stops[0].lat, lng: stops[0].lng, spanKm: Math.max(80, route.totalKm * 3) },
        ],
        proposals: [],
        sources: [route.source],
        facts: `Route total ${route.totalKm} km, ${formatDuration(route.totalMinutes)}${route.estimated ? " (partly estimated)" : " (real driving directions)"}`,
      };
    }

    case "getWeather": {
      const point = viewPoint(context) ?? bundle.centroid;
      if (!point) return { ...empty, note: "Point me at a place and I will check the weather." };
      const panel = await ctx.runAction(internal.weather.panel, { lat: point.lat, lng: point.lng });
      if (!panel.available) return { ...empty, note: panel.reason ?? "Weather is unavailable right now." };
      const warmest = [...panel.months].sort((a, b) => b.comfort - a.comfort).slice(0, 3);
      return {
        cards: [
          {
            type: "weather",
            place: context.placeName ?? context.label ?? `${point.lat.toFixed(2)}, ${point.lng.toFixed(2)}`,
            source: panel.source,
            available: true,
            now: panel.now,
            days: panel.days.slice(0, 7).map((day) => ({ date: day.date, label: day.label, maxC: day.maxC, minC: day.minC, rainMm: day.rainMm })),
            months: panel.months.map((month) => ({ month: month.month, avgMaxC: month.avgMaxC, avgMinC: month.avgMinC, avgRainMm: month.avgRainMm, comfort: month.comfort })),
          },
        ],
        ui: [{ kind: "focusGlobe", label: "Show this area", lat: point.lat, lng: point.lng, spanKm: 60 }],
        proposals: [],
        sources: [panel.source],
        facts: panel.now
          ? `Now: ${panel.now.label}, ${panel.now.maxC}°C / ${panel.now.minC}°C, ${panel.now.rainMm} mm. Most comfortable months by the 3-year archive: ${warmest.map((month) => month.month).join(", ")}.`
          : `Most comfortable months: ${warmest.map((month) => month.month).join(", ")}.`,
      };
    }

    case "searchFlights": {
      const from = argString(plan.args, "from") ?? "";
      const to = argString(plan.args, "to") ?? context.placeName ?? "";
      const flights = await ctx.runAction(internal.flights.search, { from, to, travellers: bundle.stats.trips > 0 ? 1 : 1 });
      if (!flights.available) {
        return {
          cards: [{ type: "flight", source: flights.source, available: false, reason: flights.reason ?? FLIGHTS_UNAVAILABLE, offers: [] }],
          ui: [],
          proposals: [],
          sources: ["No flight data provider connected"],
          facts: `Flights: unavailable. ${flights.reason ?? FLIGHTS_UNAVAILABLE}`,
        };
      }
      return {
        cards: [
          {
            type: "flight",
            source: flights.source,
            available: true,
            offers: flights.offers.map((offer) => ({
              airline: offer.airline,
              from: offer.from,
              to: offer.to,
              price: offer.price,
              currency: offer.currency,
              stops: offer.stops,
            })),
          },
        ],
        ui: [],
        proposals: [],
        sources: [flights.source],
        facts: flights.offers.map((offer) => `${offer.airline}: ${offer.currency} ${offer.price}, ${offer.stops} stops`).join("\n"),
      };
    }

    case "estimateTripCost": {
      const destination = argString(plan.args, "destination") ?? context.placeName;
      const nights = argNumber(plan.args, "nights") ?? Math.max(3, bundle.stats.avgTripDays || 5);
      const mode = argString(plan.args, "mode");
      const budgetMode =
        mode === "budget" || mode === "comfort" || mode === "luxury" || mode === "balanced" ? mode : "balanced";
      const result = await ctx.runAction(api.trips.costFor, {
        tripId: context.tripId,
        destinations: destination ? [destination] : undefined,
        nights,
        travellers: argNumber(plan.args, "travellers") ?? 1,
        budgetMode,
        currency: argString(plan.args, "currency") ?? "INR",
      });
      if (!result.ok || !result.cost) return { ...empty, note: result.message ?? "I could not work out a cost for that." };
      return {
        cards: [
          {
            type: "cost",
            estimate: result.cost,
            label: `${destination ?? "This trip"} — ${result.cost.nights} nights, ${result.cost.mode}`,
          },
        ],
        ui: [],
        proposals: [],
        sources: ["Planning table + real route distances"],
        facts: result.cost.lines
          .map((line) => `${line.label}: ${line.included ? `${line.currency} ${line.low}–${line.high}` : `not included (${line.unavailable})`}`)
          .join("\n"),
      };
    }

    case "getRecommendations": {
      const recommended = await ctx.runAction(api.intelligence.recommend, {
        surface: "globe",
        lat: context.lat,
        lng: context.lng,
      });
      const cards: AssistantCard[] = recommended.items.map((item) => ({
        type: "destination",
        name: item.name,
        lat: item.lat,
        lng: item.lng,
        why: item.why,
        bestMonths: item.bestMonths,
        cost: item.cost ?? null,
        tags: item.tags,
        confidence: item.confidence,
      }));
      return {
        cards,
        ui: cards.slice(0, 4).map((card) => ({
          kind: "focusGlobe" as const,
          label: `Show ${card.type === "destination" ? card.name : ""}`,
          lat: card.type === "destination" ? card.lat : undefined,
          lng: card.type === "destination" ? card.lng : undefined,
          spanKm: 60,
        })),
        proposals: [],
        sources: ["Your history, counted and read back"],
        facts: recommended.items.map((item) => `- ${item.name}: ${item.why.join(" ")}`).join("\n"),
      };
    }

    case "destinationInsight": {
      const placeId = argString(plan.args, "placeId") ?? context.placeId;
      const point = viewPoint(context) ?? bundle.centroid;
      if (!placeId && !point) return { ...empty, note: "Which destination should I look into?" };
      if (placeId) {
        const intel = await ctx.runAction(api.intelligence.explainPlace, { placeId });
        if (!intel.ok || !intel.intel) return { ...empty, note: intel.message ?? "I could not open that one." };
        return {
          cards: [
            {
              type: "destination",
              name: intel.intel.name,
              lat: point?.lat ?? 0,
              lng: point?.lng ?? 0,
              why: [...intel.intel.whyFits, ...intel.intel.whyVisit].slice(0, 5),
              bestMonths: intel.intel.bestMonths.map((month) => month.month),
              cost: intel.intel.cost.total
                ? { currency: intel.intel.cost.currency, low: intel.intel.cost.total.low, high: intel.intel.cost.total.high }
                : null,
              tags: intel.intel.activities.slice(0, 4),
              confidence: intel.intel.confidence,
            },
            { type: "cost", estimate: intel.intel.cost, label: `${intel.intel.name} — suggested stay` },
          ],
          ui: [{ kind: "openPlace", label: `Open ${intel.intel.name}`, placeId: intel.intel.placeId }],
          proposals: [],
          sources: intel.intel.sources,
          facts: [
            intel.intel.whyFits.length > 0 ? `Why it fits: ${intel.intel.whyFits.join(" ")}` : "No history to fit against yet.",
            `Stay: ${intel.intel.stay.min}-${intel.intel.stay.max} days. ${intel.intel.stay.rationale}`,
            intel.intel.bestMonths.length > 0 ? `Best months: ${intel.intel.bestMonths.map((month) => month.month).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
      const area = await ctx.runAction(api.intelligence.areaIntel, {
        lat: point!.lat,
        lng: point!.lng,
        spanKm: context.spanKm ?? 120,
      });
      if (!area.ok || !area.area) return { ...empty, note: area.message ?? "Nothing to read here yet." };
      return {
        cards: [
          { type: "note", heading: area.area.headline, body: area.area.observations.map((row) => `${row.heading}: ${row.body}`).join("\n\n") },
          ...area.area.places.slice(0, 4).map<AssistantCard>((place) => ({
            type: "place",
            placeId: place.placeId,
            name: place.name,
            categoryLabel: place.categoryLabel,
            address: null,
            rating: place.rating,
            reviewCount: null,
            openNow: null,
            mapsUrl: null,
            photoUrl: null,
            distanceKm: null,
            why: [],
          })),
        ],
        ui: [],
        proposals: [],
        sources: area.area.sources,
        facts: area.area.observations.map((row) => `${row.heading}: ${row.body}`).join("\n"),
      };
    }

    case "memoryConnections": {
      const memoryId = context.memoryId;
      if (!memoryId) return { ...empty, note: "Open one of your memories and I will find its relatives." };
      const linked = await ctx.runAction(api.intelligence.connections, { memoryId });
      if (!linked.ok) return { ...empty, note: linked.message };
      return {
        cards: linked.items.map<AssistantCard>((item) => ({
          type: "memory",
          id: item.id,
          title: item.title,
          placeName: item.placeName,
          happenedAt: item.happenedAt,
          why: item.why,
        })),
        ui: [],
        proposals: [],
        sources: ["Your own memories and their analysis"],
        facts: linked.items.map((item) => `- ${item.title} at ${item.placeName}: ${item.why}`).join("\n"),
      };
    }

    case "optimizeItinerary": {
      const tripId = context.tripId ?? (await ctx.runQuery(internal.trips.activeForUser, { userId }))?.trip._id;
      if (!tripId) return { ...empty, note: "Which trip should I tidy up? No trip is open right now." };
      const day = argNumber(plan.args, "day") ?? 1;
      const optimised = await ctx.runAction(api.trips.optimise, { tripId, day });
      if (!optimised.ok || !optimised.route) return { ...empty, note: optimised.message ?? "I could not reorder that day." };
      return {
        cards: [
          {
            type: "route",
            label: `Day ${optimised.day} reordered`,
            stops: optimised.route.legs.length > 0 ? [] : [],
            legs: optimised.route.legs,
            totalKm: optimised.route.totalKm,
            totalMinutes: optimised.route.totalMinutes,
            estimated: optimised.route.estimated,
            source: optimised.route.source,
            note: optimised.note,
          },
        ],
        ui: [{ kind: "openTrip", label: "Open the trip", tripId }],
        proposals: [],
        sources: [optimised.route.source],
        facts: optimised.note ?? `Saved about ${optimised.savedKm ?? 0} km.`,
      };
    }

    case "planTrip": {
      const destination = argString(plan.args, "destination") ?? context.placeName;
      if (!destination) return { ...empty, note: "Where should we go?" };
      const days = Math.max(1, Math.min(21, argNumber(plan.args, "days") ?? 5));
      const mode = argString(plan.args, "mode");
      const budgetMode =
        mode === "budget" || mode === "comfort" || mode === "luxury" || mode === "balanced" ? mode : "balanced";
      const planned = await ctx.runAction(api.trips.plan, {
        destination,
        days,
        travellers: argNumber(plan.args, "travellers") ?? 1,
        budgetMode,
        currency: argString(plan.args, "currency") ?? "INR",
        lat: context.lat,
        lng: context.lng,
      });
      if (!planned.ok || !planned.days) return { ...empty, note: planned.message ?? "I could not build that plan." };

      const items: AssistantProposal["items"] = planned.days.flatMap((day) =>
        day.items.map((item) => ({
          day: day.day,
          kind: item.kind,
          title: item.title,
          detail: item.detail,
          lat: item.lat,
          lng: item.lng,
          googlePlaceId: item.googlePlaceId,
          costCents: item.cost ? Math.round(item.cost * 100) : undefined,
        })),
      );

      const cards: AssistantCard[] = [
        {
          type: "itinerary",
          title: planned.title ?? `${days} days in ${destination}`,
          destination,
          days: planned.days.map((day) => ({
            day: day.day,
            theme: day.theme,
            items: day.items.map((item) => ({
              title: item.title,
              kind: item.kind,
              detail: item.detail,
              real: item.real,
              googlePlaceId: item.googlePlaceId,
            })),
          })),
          notes: planned.notes ?? [],
        },
      ];
      if (planned.route) {
        cards.push({
          type: "route",
          label: "Route between the stops",
          stops: planned.placesUsed?.slice(0, 10).map((place) => ({ name: place.name, lat: 0, lng: 0 })) ?? [],
          legs: planned.route.legs,
          totalKm: planned.route.totalKm,
          totalMinutes: planned.route.totalMinutes,
          estimated: planned.route.estimated,
          source: planned.route.source,
          note: planned.route.note,
        });
      }
      if (planned.cost) cards.push({ type: "cost", estimate: planned.cost, label: `${destination} — ${planned.cost.nights} nights` });

      return {
        cards,
        ui: planned.anchor
          ? [{ kind: "focusGlobe", label: `Show ${destination}`, lat: planned.anchor.lat, lng: planned.anchor.lng, spanKm: 80 }]
          : [],
        proposals: [
          {
            kind: "createTrip",
            label: "Add this to my trips",
            summary: `Creates "${planned.title ?? `${days} days in ${destination}`}" with ${items.length} stops. Nothing is saved until you confirm.`,
            tripTitle: planned.title ?? `${days} days in ${destination}`,
            destination,
            days,
            budgetMode,
            currency: planned.cost?.currency ?? "INR",
            items,
          },
        ],
        sources: ["Google Places (real stops)", "Google Routes (real distances)", planned.weather?.source ?? "Weather unavailable", "Planning-table cost estimate"],
        facts: [
          `Plan: ${planned.title ?? destination}, ${days} days.`,
          planned.route ? `Route: ${planned.route.totalKm} km, ${formatDuration(planned.route.totalMinutes)}${planned.route.estimated ? " (partly estimated)" : " (real driving directions)"}.` : "",
          planned.cost?.total ? `Estimated cost: ${planned.cost.currency} ${planned.cost.total.low}–${planned.cost.total.high} (${planned.cost.notice})` : "",
          planned.assumptions?.length ? `Assumptions: ${planned.assumptions.join(" ")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    case "proposeSavePlace": {
      const placeId = argString(plan.args, "placeId") ?? context.placeId;
      const name = argString(plan.args, "name") ?? context.placeName;
      if (!placeId && !name) return { ...empty, note: "Which place should I save?" };
      return {
        cards: [],
        ui: placeId ? [{ kind: "openPlace", label: `Open ${name ?? "the place"}`, placeId }] : [],
        proposals: [
          {
            kind: "savePlace",
            label: "Save this place",
            summary: `Adds ${name ?? "this place"} to your saved places.`,
            placeId,
            name: name ?? "Saved place",
            lat: context.lat,
            lng: context.lng,
          },
        ],
        sources: [],
        facts: `Ready to save ${name ?? "that place"}.`,
      };
    }

    case "proposeCreateTrip":
    case "proposeAddToTrip": {
      const destination = argString(plan.args, "destination") ?? context.placeName;
      if (!destination) return { ...empty, note: "Where is the trip?" };
      return {
        cards: [],
        ui: context.tripId ? [{ kind: "openTrip", label: "Open the trip", tripId: context.tripId }] : [],
        proposals: [
          {
            kind: context.tripId || plan.action === "proposeAddToTrip" ? "addToTrip" : "createTrip",
            label: context.tripId ? `Add ${destination} to this trip` : `Start a trip to ${destination}`,
            summary: "Nothing changes until you confirm.",
            destination,
            tripTitle: `Trip to ${destination}`,
            days: argNumber(plan.args, "days") ?? 4,
            currency: "INR",
          },
        ],
        sources: [],
        facts: `Proposal staged for ${destination}.`,
      };
    }

    case "answer":
    default: {
      // A plain question: answer from what the product already knows, plus the
      // person's own history. No tools, no invented facts.
      const nearest = bundle.centroid
        ? bundle.memories
            .map((memory) => ({ memory, km: haversineKm(memory, bundle.centroid as { lat: number; lng: number }) }))
            .sort((a, b) => a.km - b.km)
            .slice(0, 3)
        : [];
      return {
        cards: nearest.map<AssistantCard>((entry) => ({
          type: "memory",
          id: entry.memory._id,
          title: entry.memory.title,
          placeName: entry.memory.placeName,
          happenedAt: entry.memory.happenedAt,
        })),
        ui: [],
        proposals: [],
        sources: ["Your own history"],
        facts: nearest.length > 0 ? `Their closest pins to their own centre of gravity: ${nearest.map((entry) => entry.memory.placeName).join(", ")}.` : "No memories yet.",
      };
    }
  }
}

/* --- The conversation ----------------------------------------------- */

export const ask = action({
  args: {
    message: v.string(),
    context: contextValidator,
    history: v.optional(
      v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() })),
    ),
  },
  handler: async (ctx, args): Promise<AssistantReply> => {
    const who = await identity(ctx);
    if ("ok" in who) return { ok: false, message: who.message };
    const userId = who.userId;

    const blocked = await guard(ctx, userId);
    if (blocked) return { ok: false, message: blocked.message };

    const message = args.message.trim().slice(0, 600);
    if (message.length < 2) return { ok: false, message: "Ask me something about your travels." };

    const context = args.context as PageContext;
    const bundle: ContextBundle = await ctx.runQuery(internal.ai.context.load, { userId });
    const contextBlock = describeContext(context);

    const key = stableKey([message.toLowerCase(), contextBlock, bundle.profile?.builtAt ?? 0, bundle.stats.memories, bundle.feedback.length]);
    const artifactKey = `${userId}:${key}`;

    const cached = await ctx.runQuery(internal.ai.store.readArtifact, { kind: "assistant", key: artifactKey });
    if (cached?.state === "ready") {
      await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "cached" });
      return { ...(cached.payload as AssistantReply), cached: true };
    }

    const claim = await ctx.runMutation(internal.ai.store.claimArtifact, {
      kind: "assistant",
      key: artifactKey,
      userId,
      ttlMs: REPLY_TTL_MS,
    });
    if (!claim.claimed) {
      return { ok: false, message: "I am already working on that one — give me a second." };
    }

    /* 1. Read the intent. */
    const planResult = await structured({
      kind: "assistant.plan",
      schema: AssistantPlanSchema,
      schemaName: "AssistantPlan",
      system:
        "You route a traveller's question to exactly one capability of a travel app. " +
        "Pick the single most useful action. Use 'answer' when no tool is needed. " +
        "Set needsConfirmation true only for actions that would change their data. " +
        "Only include arguments you can see in the question or the screen context; never guess a place id. " +
        "Use 'clarify' when the request is too thin to run.",
      messages: [
        { role: "user", content: `${contextBlock}\n\nQuestion: ${message}` },
      ],
      maxOutputTokens: 300,
      temperature: 0.2,
    });

    if (!planResult.ok) {
      await ctx.runMutation(internal.ai.store.bumpUsage, { userId, field: "failures" });
      await ctx.runMutation(internal.ai.store.failArtifact, {
        kind: "assistant",
        key: artifactKey,
        message: planResult.message,
      });
      return { ok: false, message: planResult.message };
    }

    const plan = planResult.data;
    await ctx.runMutation(internal.ai.store.bumpUsage, {
      userId,
      field: "calls",
      tokensIn: planResult.usage.in,
      tokensOut: planResult.usage.out,
    });

    if (plan.action === "answer" && plan.clarify && message.length < 12) {
      const reply: AssistantReply = {
        ok: true,
        answer: plan.clarify,
        cards: [],
        ui: [],
        proposals: [],
        followUps: [],
        sources: [],
        intent: plan.intent,
        action: plan.action,
        model: planResult.model,
      };
      await ctx.runMutation(internal.ai.store.completeArtifact, {
        kind: "assistant",
        key: artifactKey,
        payload: reply,
        model: planResult.model,
        ttlMs: REPLY_TTL_MS,
      });
      return reply;
    }

    /* 2. Run it against real data. */
    const tool = await runTool(ctx, plan, context, bundle);

    /* 3. Say it in words, from what the tool actually returned. */
    const answerResult = await structured({
      kind: "assistant.answer",
      schema: AssistantAnswerSchema,
      schemaName: "AssistantAnswer",
      system:
        "You are Pulse, the travel intelligence inside a memory-mapping app. " +
        "Answer using ONLY the gathered facts below — they came from real data. " +
        "Never invent a price, a flight, an opening time or a place. " +
        "If something is missing, say plainly that it is not available. " +
        "Write like a well-travelled friend: short, specific, no filler, no exclamation marks. " +
        "Two to five sentences. Put anything the person should do next into followUps.",
      messages: [
        {
          role: "user",
          content: [
            `Screen context:\n${contextBlock}`,
            "",
            `Question: ${message}`,
            "",
            `Capability used: ${plan.action} (${plan.intent})`,
            "",
            `Gathered facts:\n${tool.facts}`,
            tool.note ? `\nLimitation: ${tool.note}` : "",
            "",
            brief(bundle, { memoryLimit: 14 }),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      maxOutputTokens: 600,
      temperature: 0.5,
    });

    const answer = answerResult.ok
      ? answerResult.data
      : {
          answer: tool.note ?? "Here is what I could find.",
          highlights: [] as string[],
          followUps: [] as string[],
        };

    if (answerResult.ok) {
      await ctx.runMutation(internal.ai.store.bumpUsage, {
        userId,
        field: "calls",
        tokensIn: answerResult.usage.in,
        tokensOut: answerResult.usage.out,
      });
    }

    const reply: AssistantReply = {
      ok: true,
      answer: answer.answer,
      cards: tool.cards,
      ui: tool.ui,
      proposals: plan.needsConfirmation || tool.proposals.length > 0 ? tool.proposals : [],
      followUps: answer.followUps,
      sources: tool.sources,
      intent: plan.intent,
      action: plan.action,
      model: answerResult.ok ? answerResult.model : planResult.model,
    };

    await ctx.runMutation(internal.ai.store.completeArtifact, {
      kind: "assistant",
      key: artifactKey,
      payload: reply,
      model: reply.model,
      ttlMs: REPLY_TTL_MS,
    });

    return reply;
  },
});

/* --- Acting on a proposal ------------------------------------------- */

/**
 * The only write path the assistant has. The person taps a button, this runs
 * with the payload they saw, and nothing happens before that.
 */
export const confirm = mutation({
  args: {
    kind: v.union(v.literal("savePlace"), v.literal("createTrip"), v.literal("addToTrip")),
    label: v.string(),
    placeId: v.optional(v.string()),
    name: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    category: v.optional(v.string()),
    tripTitle: v.optional(v.string()),
    destination: v.optional(v.string()),
    days: v.optional(v.number()),
    travellers: v.optional(v.number()),
    budgetMode: v.optional(budgetModeValidator),
    currency: v.optional(v.string()),
    items: v.optional(
      v.array(
        v.object({
          day: v.number(),
          kind: tripItemKindValidator,
          title: v.string(),
          detail: v.optional(v.string()),
          lat: v.optional(v.number()),
          lng: v.optional(v.number()),
          googlePlaceId: v.optional(v.string()),
          costCents: v.optional(v.number()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");
    const now = Date.now();

    if (args.kind === "savePlace") {
      // A saved place is a memory carrying the "saved" tag, which is how the
      // map, the cluster logic and the recommender all already see them.
      const title = (args.name ?? "Saved place").slice(0, 120);
      let lat = args.lat ?? null;
      let lng = args.lng ?? null;

      if (args.placeId) {
        const row = await ctx.db
          .query("places")
          .withIndex("by_google_id", (q) => q.eq("googlePlaceId", args.placeId as string))
          .first();
        if (row) {
          lat = lat ?? row.lat;
          lng = lng ?? row.lng;
        }
        const existing = await ctx.db
          .query("memories")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(200);
        if (existing.some((memory) => memory.googlePlaceId === args.placeId)) {
          return { ok: true, already: true, message: "Already saved." };
        }
      }
      if (lat === null || lng === null) throw new Error("That place has no coordinates, so it cannot be saved yet.");

      const memoryId = await ctx.db.insert("memories", {
        userId,
        title,
        note: "Saved from the map — no memory pinned here yet.",
        placeName: args.name ?? "Saved place",
        lat,
        lng,
        happenedAt: now,
        tone: "quiet",
        tags: ["saved", ...(args.category ? [args.category.toLowerCase()] : [])],
        visibility: "private",
        googlePlaceId: args.placeId,
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true, memoryId };
    }

    if (args.kind === "createTrip") {
      const tripId = await ctx.db.insert("trips", {
        userId,
        title: (args.tripTitle ?? `Trip to ${args.destination ?? "somewhere"}`).slice(0, 80),
        destination: (args.destination ?? "Unnamed").slice(0, 120),
        lat: args.lat,
        lng: args.lng,
        status: "planning",
        travellers: Math.max(1, Math.min(16, args.travellers ?? 1)),
        budgetMode: args.budgetMode ?? "balanced",
        currency: (args.currency ?? "INR").toUpperCase().slice(0, 4),
        interests: [],
        notes: "Drafted with Pulse — this is a starting point, not a booking.",
        origin: "pulse",
        createdAt: now,
        updatedAt: now,
      });
      let added = 0;
      for (const item of args.items ?? []) {
        await ctx.db.insert("tripItems", {
          tripId,
          userId,
          day: Math.max(1, Math.min(60, Math.round(item.day))),
          order: added,
          kind: item.kind,
          title: item.title.slice(0, 120),
          detail: item.detail?.slice(0, 400),
          lat: item.lat,
          lng: item.lng,
          googlePlaceId: item.googlePlaceId,
          costCents: item.costCents,
          source: "ai",
          createdAt: now,
        });
        added += 1;
      }
      return { ok: true, tripId, added };
    }

    // addToTrip: append onto a trip that already exists, matched loosely by
    // destination so a confirmation cannot land on the wrong trip silently.
    const trips: Doc<"trips">[] = [];
    const all = await ctx.db
      .query("trips")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
    const destination = (args.destination ?? "").toLowerCase();
    for (const trip of all) {
      if (destination && trip.destination.toLowerCase().includes(destination)) trips.push(trip);
    }
    const trip = trips[0] ?? all[0];
    if (!trip) return { ok: false, message: "There is no trip to add this to yet." };

    let order = (
      await ctx.db
        .query("tripItems")
        .withIndex("by_trip", (q) => q.eq("tripId", trip._id))
        .take(200)
    ).length;
    let added = 0;
    for (const item of args.items ?? []) {
      await ctx.db.insert("tripItems", {
        tripId: trip._id,
        userId,
        day: Math.max(1, Math.min(60, Math.round(item.day))),
        order,
        kind: item.kind,
        title: item.title.slice(0, 120),
        detail: item.detail?.slice(0, 400),
        lat: item.lat,
        lng: item.lng,
        googlePlaceId: item.googlePlaceId,
        costCents: item.costCents,
        source: "ai",
        createdAt: now,
      });
      order += 1;
      added += 1;
    }
    await ctx.db.patch(trip._id, { updatedAt: now });
    return { ok: true, tripId: trip._id, added };
  },
});
