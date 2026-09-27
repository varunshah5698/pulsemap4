import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { haversineKm, optimiseOrder, pathKm, type Point } from "./ai/geo";

/**
 * Getting between two real points in the world.
 *
 * Google's Routes API answers properly — verified live: Mumbai to Pune comes
 * back as 141 km / 2 h 39 m of actual driving. When it cannot answer (key
 * restricted, quota, offline) the leg falls back to great-circle distance with
 * a published speed factor and is marked `estimate: true`, so the interface can
 * say "roughly" instead of pretending to know the road.
 */

export type TravelMode = "drive" | "transit" | "walk" | "cycle";

export type RouteLeg = {
  from: string;
  to: string;
  km: number;
  minutes: number;
  mode: TravelMode;
  source: "google-routes" | "great-circle";
  estimate: boolean;
};

const ROUTES_API = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** Typical door-to-door speeds, only ever used for labelled estimates. */
const FALLBACK_KMH: Record<TravelMode, number> = {
  drive: 62,
  transit: 45,
  walk: 4.5,
  cycle: 15,
};

const MODE_TO_GOOGLE: Record<TravelMode, string> = {
  drive: "DRIVE",
  transit: "TRANSIT",
  walk: "WALK",
  cycle: "BICYCLE",
};

export const ROUTING_SOURCE = "Google Routes API";

async function googleLeg(from: Point, to: Point, mode: TravelMode): Promise<RouteLeg | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || key.trim().length < 10) return null;

  let response: Response;
  try {
    response = await fetch(ROUTES_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key.trim(),
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: MODE_TO_GOOGLE[mode],
        ...(mode === "drive" ? { routingPreference: "TRAFFIC_UNAWARE" } : {}),
      }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as
    | { routes?: { distanceMeters?: number; duration?: string }[] }
    | null;
  const route = body?.routes?.[0];
  const metres = route?.distanceMeters;
  const seconds = route?.duration ? Number(String(route.duration).replace("s", "")) : undefined;
  if (typeof metres !== "number" || typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return null;
  }

  return {
    from: from.name ?? `${from.lat.toFixed(3)}, ${from.lng.toFixed(3)}`,
    to: to.name ?? `${to.lat.toFixed(3)}, ${to.lng.toFixed(3)}`,
    km: Number((metres / 1000).toFixed(1)),
    minutes: Math.round(seconds / 60),
    mode,
    source: "google-routes",
    estimate: false,
  };
}

function fallbackLeg(from: Point, to: Point, mode: TravelMode): RouteLeg {
  // Road distance runs longer than a straight line; the factor is a stated
  // assumption, not a measurement.
  const detour = mode === "drive" || mode === "cycle" ? 1.28 : 1.12;
  const km = haversineKm(from, to) * detour;
  return {
    from: from.name ?? `${from.lat.toFixed(3)}, ${from.lng.toFixed(3)}`,
    to: to.name ?? `${to.lat.toFixed(3)}, ${to.lng.toFixed(3)}`,
    km: Number(km.toFixed(1)),
    minutes: Math.round((km / FALLBACK_KMH[mode]) * 60),
    mode,
    source: "great-circle",
    estimate: true,
  };
}

export async function routeLeg(from: Point, to: Point, mode: TravelMode): Promise<RouteLeg> {
  return (await googleLeg(from, to, mode)) ?? fallbackLeg(from, to, mode);
}

/* --- Public surface -------------------------------------------------- */

export type TripRoute = {
  legs: RouteLeg[];
  totalKm: number;
  totalMinutes: number;
  /** True when any leg had to be estimated rather than routed. */
  estimated: boolean;
  source: string;
  stops: { name: string; lat: number; lng: number; placeId?: string }[];
  /** What reordering saved, when the caller asked for an optimised order. */
  savedKm?: number;
  note?: string;
};

/** Legs between the stops, in the order given. */
export const route = internalAction({
  args: {
    stops: v.array(
      v.object({
        name: v.string(),
        lat: v.number(),
        lng: v.number(),
        placeId: v.optional(v.string()),
      }),
    ),
    mode: v.optional(v.union(v.literal("drive"), v.literal("transit"), v.literal("walk"), v.literal("cycle"))),
  },
  handler: async (_ctx, args): Promise<TripRoute> => {
    const mode = args.mode ?? "drive";
    const stops = args.stops.slice(0, 12);
    const legs: RouteLeg[] = [];
    for (let index = 1; index < stops.length; index += 1) {
      legs.push(await routeLeg(stops[index - 1], stops[index], mode));
    }
    const totalKm = Number(legs.reduce((sum, leg) => sum + leg.km, 0).toFixed(1));
    const totalMinutes = legs.reduce((sum, leg) => sum + leg.minutes, 0);
    const estimated = legs.some((leg) => leg.estimate);
    return {
      legs,
      totalKm,
      totalMinutes,
      estimated,
      source: estimated ? "Google Routes API with great-circle estimates" : ROUTING_SOURCE,
      stops,
    };
  },
});

/**
 * The same stops, reordered, plus the legs for the better order. Used by
 * "optimize my itinerary" and by trip planning, which drafts stops in whatever
 * order the model suggested and lets the geometry fix it.
 */
export const optimise = internalAction({
  args: {
    stops: v.array(
      v.object({
        name: v.string(),
        lat: v.number(),
        lng: v.number(),
        placeId: v.optional(v.string()),
      }),
    ),
    mode: v.optional(v.union(v.literal("drive"), v.literal("transit"), v.literal("walk"), v.literal("cycle"))),
    /** Keep the first stop fixed (usually where the person lands). */
    keepFirst: v.optional(v.boolean()),
  },
  handler: async (_ctx, args): Promise<TripRoute> => {
    const mode = args.mode ?? "drive";
    const stops = args.stops.slice(0, 12);
    if (stops.length < 3) {
      const legs: RouteLeg[] = [];
      for (let index = 1; index < stops.length; index += 1) {
        legs.push(await routeLeg(stops[index - 1], stops[index], mode));
      }
      return {
        legs,
        totalKm: Number(legs.reduce((sum, leg) => sum + leg.km, 0).toFixed(1)),
        totalMinutes: legs.reduce((sum, leg) => sum + leg.minutes, 0),
        estimated: legs.some((leg) => leg.estimate),
        source: ROUTING_SOURCE,
        stops,
        savedKm: 0,
        note: "Not enough stops to reorder.",
      };
    }

    const anchor = stops[0];
    const tail = args.keepFirst === false ? stops : stops.slice(1);
    const { order, beforeKm, afterKm } = optimiseOrder(tail);
    const ordered = args.keepFirst === false ? order : [anchor, ...order];

    const legs: RouteLeg[] = [];
    for (let index = 1; index < ordered.length; index += 1) {
      legs.push(await routeLeg(ordered[index - 1], ordered[index], mode));
    }

    // Report the improvement on straight-line paths, so the number is not
    // inflated by whichever legs happened to be routed individually.
    const savedKm = Math.max(0, Number((beforeKm - afterKm).toFixed(1)));

    return {
      legs,
      totalKm: Number(legs.reduce((sum, leg) => sum + leg.km, 0).toFixed(1)),
      totalMinutes: legs.reduce((sum, leg) => sum + leg.minutes, 0),
      estimated: legs.some((leg) => leg.estimate),
      source: legs.some((leg) => leg.estimate) ? "Google Routes API with great-circle estimates" : ROUTING_SOURCE,
      stops: ordered,
      savedKm,
      note:
        savedKm > 1
          ? `Reordering saves about ${savedKm} km of straight-line travel between those stops.`
          : "The order was already close to the shortest sensible path.",
    };
  },
});

/** Straight-line length of a set of stops, for quick comparisons. */
export function straightLineKm(stops: Point[]): number {
  return Number(pathKm(stops).toFixed(1));
}
