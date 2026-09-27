import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireUserId } from "./access";

/* ------------------------------------------------------------------ *
 * Real places, straight from Google Maps Platform.
 *
 * Everything here runs on the server: the API key never reaches the
 * browser, results are cached in the `places` table, and each grid cell
 * is asked about at most once per cache window per filter. That keeps a
 * person spinning the globe from generating a request per frame.
 *
 * Field masks are deliberate: the list calls ask for the cheaper
 * "Pro" fields, and the richer Place Details mask (hours, photos,
 * editorial summary, website, phone) is only paid for on a real tap.
 * ------------------------------------------------------------------ */

const PLACES_BASE = "https://places.googleapis.com/v1";

/** Nearby Search radius ceiling, in kilometres. */
export const NEARBY_MAX_RADIUS_KM = 50;
/** How long a scanned area stays warm. Places change slowly. */
const SCAN_CACHE_DAYS = 21;
/** How long a full Place Details row stays warm. */
const DETAIL_CACHE_DAYS = 7;
/** Grid cell size in degrees; ~28 km of latitude. */
const CELL_DEGREES = 0.25;

/* --- Categories ---------------------------------------------------- */

type Scope = {
  key: string;
  label: string;
  types: string[];
};

/**
 * The filter row on the globe, mapped to Google place types.
 *
 * Every type here was checked against Places API (New): it rejects unknown
 * types outright (`landmark`, `viewpoint` and `place_of_worship` are all
 * invalid, which is why `monument`, `observation_deck` and the individual
 * worship types stand in for them).
 */
export const SCOPES: Scope[] = [
  {
    key: "all",
    label: "All",
    types: [
      "restaurant",
      "cafe",
      "museum",
      "tourist_attraction",
      "hotel",
      "park",
      "shopping_mall",
      "bar",
      "art_gallery",
      "monument",
      "historical_landmark",
      "observation_deck",
      "zoo",
      "aquarium",
      "amusement_park",
      "market",
      "bakery",
      "beach",
    ],
  },
  { key: "eat", label: "Restaurants", types: ["restaurant"] },
  { key: "cafe", label: "Cafes", types: ["cafe", "bakery"] },
  {
    key: "see",
    label: "Attractions",
    types: [
      "tourist_attraction",
      "amusement_park",
      "zoo",
      "aquarium",
      "art_gallery",
      "observation_deck",
      "monument",
      "historical_landmark",
    ],
  },
  { key: "stay", label: "Hotels", types: ["hotel", "lodging", "resort_hotel", "guest_house"] },
  { key: "museum", label: "Museums", types: ["museum"] },
  {
    key: "park",
    label: "Parks",
    types: ["park", "national_park", "beach", "garden", "botanical_garden", "hiking_area"],
  },
  {
    key: "shop",
    label: "Shopping",
    types: [
      "shopping_mall",
      "market",
      "clothing_store",
      "store",
      "supermarket",
      "gift_shop",
    ],
  },
];

/**
 * Google's taxonomy is finer than our filter row: a "cafe" search happily
 * returns `coffee_shop` or `deli`. These let a place discovered by one scan
 * still show up under the filter a person would expect.
 */
const SCOPE_RELATED: Record<string, string[]> = {
  eat: [
    "cafe",
    "bar",
    "pub",
    "bakery",
    "deli",
    "meal_takeaway",
    "meal_delivery",
    "food_court",
    "ice_cream_shop",
    "juice_shop",
    "diner",
  ],
  cafe: [
    "coffee_shop",
    "deli",
    "tea_house",
    "dessert_shop",
    "ice_cream_shop",
    "juice_shop",
    "sandwich_shop",
    "bakery",
  ],
  see: [
    "museum",
    "art_gallery",
    "observation_deck",
    "monument",
    "historical_landmark",
    "historical_place",
    "cultural_center",
    "visitor_center",
    "performing_arts_theater",
    "stadium",
    "movie_theater",
  ],
  stay: [
    "hotel",
    "lodging",
    "resort_hotel",
    "motel",
    "guest_house",
    "hostel",
    "campground",
    "inn",
    "extended_stay_hotel",
  ],
  museum: ["art_gallery", "historical_landmark", "cultural_center"],
  park: [
    "national_park",
    "state_park",
    "dog_park",
    "city_park",
    "garden",
    "botanical_garden",
    "hiking_area",
    "marina",
    "beach",
    "playground",
  ],
  shop: [
    "department_store",
    "grocery_store",
    "convenience_store",
    "discount_store",
    "liquor_store",
    "book_store",
    "shoe_store",
    "electronics_store",
    "home_goods_store",
    "sporting_goods_store",
    "toy_store",
    "furniture_store",
    "hardware_store",
    "jewelry_store",
    "gift_shop",
  ],
};

/** Fragments that mark a place as belonging to a filter, by its type name. */
const SCOPE_FRAGMENTS: Record<string, string[]> = {
  eat: ["restaurant", "grill", "bistro", "diner", "kitchen", "eatery", "steak", "pizza", "sushi", "ramen"],
  cafe: ["cafe", "coffee", "bakery", "tea", "dessert", "juice", "cream", "patisserie"],
  see: ["museum", "gallery", "attraction", "theater", "theatre", "deck", "monument", "landmark", "zoo", "aquarium", "stadium", "castle", "temple", "church", "mosque", "shrine"],
  stay: ["hotel", "hostel", "inn", "lodge", "resort", "camp", "motel"],
  museum: ["museum", "gallery"],
  park: ["park", "garden", "beach", "trail", "lookout", "marina", "playground"],
  shop: ["store", "shop", "market", "mall", "boutique", "bazaar"],
};

/** Does a cached row belong under the active filter? */
function matchesScope(row: Doc<"places">, scope: string): boolean {
  if (scope === "all") return true;
  if ((row.scopes ?? []).includes(scope)) return true;
  if (SCOPE_RELATED[scope]?.includes(row.category)) return true;
  const fragments = SCOPE_FRAGMENTS[scope] ?? [];
  return fragments.some((fragment) => row.category.includes(fragment));
}

function scopeTypes(scope: string): string[] {
  return (SCOPES.find((item) => item.key === scope) ?? SCOPES[0]).types;
}

/** Google's own type label is prettier; this fills the gaps. */
function labelForType(type: string | undefined): string {
  if (!type) return "Place";
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/* --- Geometry ------------------------------------------------------ */

const EARTH_RADIUS_KM = 6371;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cellOf(lat: number, lng: number): string {
  return `${Math.floor(lat / CELL_DEGREES)}:${Math.floor(lng / CELL_DEGREES)}`;
}

/** Every cell the given radius touches (at most 5x5 for our ceiling). */
function cellsAround(lat: number, lng: number, radiusKm: number): string[] {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(0.2, Math.cos(toRadians(lat))));
  const cells: string[] = [];
  for (
    let latStep = Math.floor((lat - dLat) / CELL_DEGREES);
    latStep <= Math.floor((lat + dLat) / CELL_DEGREES);
    latStep += 1
  ) {
    for (
      let lngStep = Math.floor((lng - dLng) / CELL_DEGREES);
      lngStep <= Math.floor((lng + dLng) / CELL_DEGREES);
      lngStep += 1
    ) {
      cells.push(`${latStep}:${lngStep}`);
    }
  }
  return cells;
}

/* --- Google payloads ----------------------------------------------- */

type LatLng = { latitude: number; longitude: number };
type LocalizedText = { text?: string };

type GooglePlace = {
  id?: string;
  displayName?: LocalizedText;
  primaryType?: string;
  primaryTypeDisplayName?: LocalizedText;
  types?: string[];
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: LatLng;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  photos?: { name?: string }[];
  editorialSummary?: LocalizedText;
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
};

type PlaceRow = {
  googlePlaceId: string;
  name: string;
  category: string;
  categoryLabel: string;
  lat: number;
  lng: number;
  cell: string;
  address?: string;
  shortAddress?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: string;
  businessStatus?: string;
  website?: string;
  phone?: string;
  googleMapsUri?: string;
  photos?: string[];
  openNow?: boolean;
  hours?: string[];
  summary?: string;
  types?: string[];
  fetchedAt: number;
  detailsAt?: number;
};

/** The cheap mask: everything a marker or a list row needs, no rich fields. */
const LIST_FIELDS = [
  "id",
  "displayName",
  "primaryType",
  "primaryTypeDisplayName",
  "types",
  "formattedAddress",
  "shortFormattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "priceLevel",
  "businessStatus",
  "googleMapsUri",
].join(",");

const NEARBY_FIELDS = LIST_FIELDS.split(",")
  .map((field) => `places.${field}`)
  .join(",");

/** The rich mask, only spent when somebody actually opens a place. */
const DETAIL_FIELDS = [
  LIST_FIELDS,
  "websiteUri",
  "internationalPhoneNumber",
  "nationalPhoneNumber",
  "photos",
  "regularOpeningHours",
  "currentOpeningHours",
  "editorialSummary",
].join(",");

function mapGooglePlace(raw: GooglePlace, cell: string, rich: boolean): PlaceRow | null {
  const id = raw.id;
  const name = raw.displayName?.text?.trim();
  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;
  if (!id || !name || typeof lat !== "number" || typeof lng !== "number") return null;

  const category = raw.primaryType ?? raw.types?.[0] ?? "point_of_interest";
  const categoryLabel =
    raw.primaryTypeDisplayName?.text?.trim() || labelForType(raw.primaryType);

  const hours =
    raw.regularOpeningHours?.weekdayDescriptions ??
    raw.currentOpeningHours?.weekdayDescriptions;
  const openNow =
    raw.regularOpeningHours?.openNow ?? raw.currentOpeningHours?.openNow;

  const photos = (raw.photos ?? [])
    .map((photo) => photo.name)
    .filter((value): value is string => typeof value === "string");

  return {
    googlePlaceId: id,
    name: name.slice(0, 160),
    category,
    categoryLabel: categoryLabel.slice(0, 60),
    lat,
    lng,
    cell,
    address: raw.formattedAddress?.slice(0, 240),
    shortAddress: raw.shortFormattedAddress?.slice(0, 160),
    rating: typeof raw.rating === "number" ? raw.rating : undefined,
    reviewCount: typeof raw.userRatingCount === "number" ? raw.userRatingCount : undefined,
    priceLevel: raw.priceLevel,
    businessStatus: raw.businessStatus,
    website: rich ? raw.websiteUri : undefined,
    phone: rich ? (raw.internationalPhoneNumber ?? raw.nationalPhoneNumber) : undefined,
    googleMapsUri: raw.googleMapsUri,
    photos: rich && photos.length > 0 ? photos.slice(0, 6) : undefined,
    openNow: rich ? openNow : undefined,
    hours: rich ? hours?.slice(0, 7) : undefined,
    summary: rich ? raw.editorialSummary?.text : undefined,
    types: raw.types?.slice(0, 8),
    fetchedAt: Date.now(),
    detailsAt: rich ? Date.now() : undefined,
  };
}

/* --- Errors -------------------------------------------------------- */

type Failure = {
  ok: false;
  reason: "no-key" | "unauthenticated" | "quota" | "key" | "request" | "network";
  message: string;
};

type Suggestions = {
  placeId: string;
  main: string;
  secondary: string;
  types: string[];
};

/* Explicit result types: these handlers call each other through `internal`,
   which TypeScript cannot infer around on its own. */
type EnsureResult = Failure | { ok: true; fetched: number; cached: boolean };
type SuggestResult = Failure | { ok: true; suggestions: Suggestions[] };
type SearchResult =
  | Failure
  | { ok: true; biased: boolean; places: ReturnType<typeof serializePlace>[] };
type ResolveResult =
  | Failure
  | { ok: true; cached: boolean; place: ReturnType<typeof serializePlace> };

function failureFrom(status: number, body: string): Failure {
  if (status === 429) {
    return {
      ok: false,
      reason: "quota",
      message: "Google Places is rate limiting us. Try again in a moment.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: "key",
      message:
        "Google rejected the key. Check that Places API (New) is enabled and the key allows it.",
    };
  }
  if (status === 400) {
    return {
      ok: false,
      reason: "request",
      message: body.slice(0, 180) || "Google could not understand that request.",
    };
  }
  return {
    ok: false,
    reason: "network",
    message: "Google Places could not be reached just now.",
  };
}

function apiKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return key && key.trim().length > 10 ? key.trim() : null;
}

async function requireIdentity(ctx: ActionCtx): Promise<Failure | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return { ok: false, reason: "unauthenticated", message: "Please sign in again." };
  }
  if (!apiKey()) {
    return {
      ok: false,
      reason: "no-key",
      message:
        "No Google Maps key is configured. Add GOOGLE_MAPS_API_KEY in the Keys tab to load real places.",
    };
  }
  return null;
}

/* --- Cached reads -------------------------------------------------- */

function isFresh(timestamp: number | undefined, days: number): boolean {
  return typeof timestamp === "number" && Date.now() - timestamp < days * 86400000;
}

/** Internal: have we already asked Google about these cells, this widely? */
export const scanned = internalQuery({
  args: { cells: v.array(v.string()), scope: v.string(), radiusKm: v.number() },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.cells.map((cell) =>
        ctx.db
          .query("placeScans")
          .withIndex("by_cell_scope", (q) => q.eq("cell", cell).eq("scope", args.scope))
          .first(),
      ),
    );
    return rows.every(
      (row) => row !== null && row.radiusKm >= args.radiusKm && isFresh(row.scannedAt, SCAN_CACHE_DAYS),
    );
  },
});

export const byGoogleId = internalQuery({
  args: { googlePlaceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("places")
      .withIndex("by_google_id", (q) => q.eq("googlePlaceId", args.googlePlaceId))
      .first();
  },
});

export const byGoogleIds = internalQuery({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.ids.map((googlePlaceId) =>
        ctx.db
          .query("places")
          .withIndex("by_google_id", (q) => q.eq("googlePlaceId", googlePlaceId))
          .first(),
      ),
    );
    return rows.filter((row): row is Doc<"places"> => row !== null);
  },
});

/** Internal: only proxy photographs we actually have a record of. */
export const photoAllowed = internalQuery({
  args: { googlePlaceId: v.string(), ref: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("places")
      .withIndex("by_google_id", (q) => q.eq("googlePlaceId", args.googlePlaceId))
      .first();
    if (!row?.photos) return false;
    return row.photos.includes(args.ref);
  },
});

/* --- Cached writes ------------------------------------------------- */

export const storeNearby = internalMutation({
  args: {
    rows: v.array(v.any()),
    cells: v.array(v.string()),
    scope: v.string(),
    radiusKm: v.number(),
  },
  handler: async (ctx, args) => {
    for (const raw of args.rows) {
      const row = raw as PlaceRow;
      const existing = await ctx.db
        .query("places")
        .withIndex("by_google_id", (q) => q.eq("googlePlaceId", row.googlePlaceId))
        .first();
      if (existing) {
        // Never let a list call erase richer details we already paid for.
        await ctx.db.patch(existing._id, {
          ...row,
          website: existing.website ?? row.website,
          phone: existing.phone ?? row.phone,
          photos: existing.photos ?? row.photos,
          hours: existing.hours ?? row.hours,
          summary: existing.summary ?? row.summary,
          openNow: existing.openNow ?? row.openNow,
          detailsAt: existing.detailsAt,
          sources: Array.from(new Set([...existing.sources, args.scope, "nearby"])),
          scopes: Array.from(new Set([...(existing.scopes ?? []), args.scope])),
        });
      } else {
        await ctx.db.insert("places", {
          ...row,
          sources: [args.scope, "nearby"],
          scopes: [args.scope],
        });
      }
    }

    const now = Date.now();
    for (const cell of args.cells) {
      const existing = await ctx.db
        .query("placeScans")
        .withIndex("by_cell_scope", (q) => q.eq("cell", cell).eq("scope", args.scope))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          radiusKm: Math.max(existing.radiusKm, args.radiusKm),
          count: existing.count + args.rows.length,
          scannedAt: now,
        });
      } else {
        await ctx.db.insert("placeScans", {
          cell,
          scope: args.scope,
          radiusKm: args.radiusKm,
          count: args.rows.length,
          scannedAt: now,
        });
      }
    }
  },
});

/** Upsert a single place row (search results and details both land here). */
export const upsertPlace = internalMutation({
  args: { row: v.any(), source: v.string() },
  handler: async (ctx, args) => {
    const row = args.row as PlaceRow;
    const existing = await ctx.db
      .query("places")
      .withIndex("by_google_id", (q) => q.eq("googlePlaceId", row.googlePlaceId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...row,
        cell: existing.cell,
        sources: Array.from(new Set([...existing.sources, args.source])),
        scopes: existing.scopes ?? [],
      });
      return existing._id;
    }
    return await ctx.db.insert("places", { ...row, sources: [args.source], scopes: [] });
  },
});

/* --- Public API ---------------------------------------------------- */

function serializePlace(row: Doc<"places">, centre?: { lat: number; lng: number }) {
  return {
    id: row.googlePlaceId,
    name: row.name,
    category: row.category,
    categoryLabel: row.categoryLabel,
    lat: row.lat,
    lng: row.lng,
    address: row.address ?? null,
    shortAddress: row.shortAddress ?? null,
    rating: row.rating ?? null,
    reviewCount: row.reviewCount ?? null,
    priceLevel: row.priceLevel ?? null,
    businessStatus: row.businessStatus ?? null,
    website: row.website ?? null,
    phone: row.phone ?? null,
    googleMapsUri: row.googleMapsUri ?? null,
    hasPhoto: (row.photos?.length ?? 0) > 0,
    photos: row.photos ?? [],
    openNow: row.openNow ?? null,
    hours: row.hours ?? [],
    summary: row.summary ?? null,
    types: row.types ?? [],
    detailsAt: row.detailsAt ?? null,
    distanceKm: centre ? Number(haversineKm(centre.lat, centre.lng, row.lat, row.lng).toFixed(3)) : null,
  };
}

export type SerializedPlace = ReturnType<typeof serializePlace>;

/**
 * Is a Google key wired up, where do photographs stream from, and can the
 * browser draw a 2D map?
 *
 * The Maps JavaScript API key has to reach the browser — that is how the API
 * works — so it is a *separate* key from the one that calls Places from here:
 * set `GOOGLE_MAPS_BROWSER_KEY` restricted to your site's referrers, and the
 * server-side `GOOGLE_MAPS_API_KEY` stays server-side only. Falling back to the
 * server key keeps a single-key project working, but that key should then be
 * referrer-restricted too. Only signed-in callers ever see it.
 */
export const config = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const site = process.env.CONVEX_SITE_URL ?? "";
    return {
      configured: apiKey() !== null,
      photoBase: site ? `${site}/places/photo?ref=` : null,
      scopes: SCOPES.map((scope) => ({ key: scope.key, label: scope.label })),
      nearbyMaxRadiusKm: NEARBY_MAX_RADIUS_KM,
      browserKey:
        identity && apiKey() !== null
          ? (process.env.GOOGLE_MAPS_BROWSER_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? null)
          : null,
      /** True when the browser key is a dedicated, referrer-restricted one. */
      browserKeyDedicated: Boolean(process.env.GOOGLE_MAPS_BROWSER_KEY),
    };
  },
});

/** Cached places around a point. Never calls Google; `ensure` does that. */
export const around = query({
  args: {
    lat: v.number(),
    lng: v.number(),
    radiusKm: v.number(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const radius = Math.min(Math.max(args.radiusKm, 0.5), NEARBY_MAX_RADIUS_KM);
    const cells = cellsAround(args.lat, args.lng, radius);
    const buckets = await Promise.all(
      cells.map((cell) =>
        ctx.db
          .query("places")
          .withIndex("by_cell", (q) => q.eq("cell", cell))
          .take(80),
      ),
    );

    const wanted = args.category && args.category !== "all" ? args.category : null;
    const seen = new Set<string>();
    const rows: Doc<"places">[] = [];
    for (const bucket of buckets) {
      for (const row of bucket) {
        if (seen.has(row.googlePlaceId)) continue;
        seen.add(row.googlePlaceId);
        if (wanted && !matchesScope(row, wanted)) continue;
        const distance = haversineKm(args.lat, args.lng, row.lat, row.lng);
        if (distance > radius) continue;
        rows.push(row);
      }
    }

    // A Google-Maps-ish mix: close by, and busier places win ties.
    const rank = (row: Doc<"places">) => {
      const distance = haversineKm(args.lat, args.lng, row.lat, row.lng);
      const weight = (row.rating ?? 3.6) * Math.log10((row.reviewCount ?? 0) + 10);
      return distance - weight * 0.35;
    };
    rows.sort((a, b) => rank(a) - rank(b));

    return rows.slice(0, 45).map((row) => serializePlace(row, args));
  },
});

/** One place, straight from cache — reactive, so panels fill themselves in. */
export const detail = query({
  args: { placeId: v.string() },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const row = await ctx.db
      .query("places")
      .withIndex("by_google_id", (q) => q.eq("googlePlaceId", args.placeId))
      .first();
    return row ? serializePlace(row) : null;
  },
});

/**
 * Fill the cache for an area, one Google request per cell and filter.
 * Safe to call on every settled camera move: warm cells cost nothing.
 */
export const ensure = action({
  args: {
    lat: v.number(),
    lng: v.number(),
    radiusKm: v.number(),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EnsureResult> => {
    const blocked = await requireIdentity(ctx);
    if (blocked) return blocked;

    const radiusKm = Math.min(Math.max(args.radiusKm, 0.5), NEARBY_MAX_RADIUS_KM);
    const scope = args.scope ?? "all";
    const cells = cellsAround(args.lat, args.lng, radiusKm);

    const warm = await ctx.runQuery(internal.places.scanned, { cells, scope, radiusKm });
    if (warm) return { ok: true as const, fetched: 0, cached: true };

    let response: Response;
    try {
      response = await fetch(`${PLACES_BASE}/places:searchNearby`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey() as string,
          "X-Goog-FieldMask": NEARBY_FIELDS,
        },
        body: JSON.stringify({
          includedTypes: scopeTypes(scope),
          maxResultCount: 20,
          rankPreference: "POPULARITY",
          languageCode: "en",
          locationRestriction: {
            circle: {
              center: { latitude: args.lat, longitude: args.lng },
              radius: radiusKm * 1000,
            },
          },
        }),
      });
    } catch {
      return {
        ok: false as const,
        reason: "network" as const,
        message: "Google Places could not be reached just now.",
      };
    }

    if (!response.ok) {
      return failureFrom(response.status, await response.text().catch(() => ""));
    }

    const payload = (await response.json()) as { places?: GooglePlace[] };
    // Tag each row with the cell the place itself falls in, not the cell we
    // asked from. Reads walk the cells covering their radius, so a place stays
    // findable from anywhere inside that radius — panning back is free.
    const rows = (payload.places ?? [])
      .map((place) => {
        const lat = place.location?.latitude;
        const lng = place.location?.longitude;
        const cell =
          typeof lat === "number" && typeof lng === "number"
            ? cellOf(lat, lng)
            : cellOf(args.lat, args.lng);
        return mapGooglePlace(place, cell, false);
      })
      .filter((place): place is PlaceRow => place !== null);

    await ctx.runMutation(internal.places.storeNearby, { rows, cells, scope, radiusKm });
    return { ok: true as const, fetched: rows.length, cached: false };
  },
});

/** Autocomplete as the person types. Predictions only — no billing per frame. */
export const suggest = action({
  args: {
    input: v.string(),
    sessionToken: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SuggestResult> => {
    const blocked = await requireIdentity(ctx);
    if (blocked) return blocked;

    const input = args.input.trim().slice(0, 160);
    if (input.length < 2) return { ok: true as const, suggestions: [] };

    const body: Record<string, unknown> = { input, languageCode: "en" };
    if (args.sessionToken) body.sessionToken = args.sessionToken;
    if (typeof args.lat === "number" && typeof args.lng === "number") {
      body.locationBias = {
        circle: {
          center: { latitude: args.lat, longitude: args.lng },
          radius: 50000,
        },
      };
    }

    let response: Response;
    try {
      response = await fetch(`${PLACES_BASE}/places:autocomplete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey() as string,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return {
        ok: false as const,
        reason: "network" as const,
        message: "Google Places could not be reached just now.",
      };
    }
    if (!response.ok) {
      return failureFrom(response.status, await response.text().catch(() => ""));
    }

    const payload = (await response.json()) as {
      suggestions?: {
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
          types?: string[];
        };
      }[];
    };

    const suggestions = (payload.suggestions ?? [])
      .map((item) => item.placePrediction)
      .filter((prediction): prediction is NonNullable<typeof prediction> => !!prediction?.placeId)
      .slice(0, 6)
      .map((prediction) => ({
        placeId: prediction.placeId as string,
        main: prediction.structuredFormat?.mainText?.text ?? prediction.text?.text ?? "",
        secondary: prediction.structuredFormat?.secondaryText?.text ?? "",
        types: prediction.types?.slice(0, 4) ?? [],
      }))
      .filter((item) => item.main.length > 0);

    return { ok: true as const, suggestions };
  },
});

/** Natural-language search: "cafes near Bandra", "restaurants in Tokyo". */
export const search = action({
  args: {
    textQuery: v.string(),
    sessionToken: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    category: v.optional(v.string()),
    nearMe: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SearchResult> => {
    const blocked = await requireIdentity(ctx);
    if (blocked) return blocked;

    const textQuery = args.textQuery.trim().slice(0, 240);
    if (!textQuery) return { ok: true as const, places: [], biased: false };

    const hasCentre = typeof args.lat === "number" && typeof args.lng === "number";
    const body: Record<string, unknown> = {
      textQuery,
      languageCode: "en",
      maxResultCount: 20,
      rankPreference: args.nearMe ? "DISTANCE" : "RELEVANCE",
    };
    if (args.sessionToken) body.sessionToken = args.sessionToken;
    if (hasCentre) {
      body.locationBias = {
        circle: {
          center: { latitude: args.lat as number, longitude: args.lng as number },
          radius: args.nearMe ? 20000 : 50000,
        },
      };
    }
    if (args.category && args.category !== "all") {
      body.includedType = scopeTypes(args.category)[0];
    }

    let response: Response;
    try {
      response = await fetch(`${PLACES_BASE}/places:searchText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey() as string,
          "X-Goog-FieldMask": NEARBY_FIELDS,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return {
        ok: false as const,
        reason: "network" as const,
        message: "Google Places could not be reached just now.",
      };
    }
    if (!response.ok) {
      return failureFrom(response.status, await response.text().catch(() => ""));
    }

    const payload = (await response.json()) as { places?: GooglePlace[] };
    const centre = hasCentre ? { lat: args.lat as number, lng: args.lng as number } : undefined;
    const ids: string[] = [];
    for (const raw of payload.places ?? []) {
      const row = mapGooglePlace(
        raw,
        cellOf(raw.location?.latitude ?? 0, raw.location?.longitude ?? 0),
        false,
      );
      if (!row) continue;
      ids.push(row.googlePlaceId);
      await ctx.runMutation(internal.places.upsertPlace, { row, source: "search" });
    }

    // Search results land in the same cache the globe reads from, so a hit
    // here is a marker there and a place row for the detail panel.
    const docs: Doc<"places">[] = await ctx.runQuery(internal.places.byGoogleIds, { ids });
    const places: ReturnType<typeof serializePlace>[] = docs.map((doc) =>
      serializePlace(doc, centre),
    );
    if (centre) {
      places.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    }

    return { ok: true as const, biased: hasCentre, places };
  },
});

/** Full Place Details, paid for once per place and cached. */
export const resolve = action({
  args: { placeId: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args): Promise<ResolveResult> => {
    const blocked = await requireIdentity(ctx);
    if (blocked) return blocked;

    const existing: Doc<"places"> | null = await ctx.runQuery(internal.places.byGoogleId, {
      googlePlaceId: args.placeId,
    });
    if (existing && isFresh(existing.detailsAt, DETAIL_CACHE_DAYS)) {
      return { ok: true as const, cached: true, place: serializePlace(existing) };
    }

    const url = new URL(`${PLACES_BASE}/places/${encodeURIComponent(args.placeId)}`);
    if (args.sessionToken) url.searchParams.set("sessionToken", args.sessionToken);
    url.searchParams.set("languageCode", "en");

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "X-Goog-Api-Key": apiKey() as string,
          "X-Goog-FieldMask": DETAIL_FIELDS,
        },
      });
    } catch {
      return {
        ok: false as const,
        reason: "network" as const,
        message: "Google Places could not be reached just now.",
      };
    }
    if (!response.ok) {
      return failureFrom(response.status, await response.text().catch(() => ""));
    }

    const raw = (await response.json()) as GooglePlace;
    const row = mapGooglePlace(
      raw,
      existing?.cell ?? cellOf(raw.location?.latitude ?? 0, raw.location?.longitude ?? 0),
      true,
    );
    if (!row) {
      return {
        ok: false as const,
        reason: "request" as const,
        message: "Google has no details for that place.",
      };
    }

    await ctx.runMutation(internal.places.upsertPlace, { row, source: "details" });
    const stored: Doc<"places"> | null = await ctx.runQuery(internal.places.byGoogleId, {
      googlePlaceId: args.placeId,
    });
    if (!stored) {
      return {
        ok: false as const,
        reason: "request" as const,
        message: "That place could not be cached.",
      };
    }
    return { ok: true as const, cached: false, place: serializePlace(stored) };
  },
});
