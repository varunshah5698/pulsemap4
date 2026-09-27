import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * A real photograph for a place, when Google's own photos are not available.
 *
 * Google's `photos` field is not enabled on every Maps key, and a place panel
 * with no picture at all is a poor answer to "what is this?". Wikipedia has
 * photographs of a great many landmarks, under a licence that only asks for
 * credit, and its API is open — so we look one up.
 *
 * The matching is deliberately strict. A nearby article is not the same thing
 * as this place, and showing the wrong photograph is worse than showing none:
 * so the page has to sit within a kilometre *and* its title has to actually
 * match the place's name. Anything else is rejected.
 */

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const MAX_DISTANCE_KM = 1.5;
/** Below this share of shared words, a title is a different subject. */
const MIN_SIMILARITY = 0.6;
/** Filenames that are never a photograph of the place itself. */
const NOT_A_PHOTO = /(logo|map|plan|flag|coat_of_arms|seal|diagram|chart|signature|icon)/;

const STOP_WORDS = new Set([
  "the",
  "and",
  "of",
  "de",
  "la",
  "le",
  "les",
  "du",
  "des",
  "del",
  "di",
  "el",
  "al",
  "a",
  "an",
  "at",
  "in",
  "on",
  "by",
  "for",
  "san",
  "saint",
  "st",
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/** How much of the shorter name is shared with the other. */
function similarity(placeName: string, title: string): number {
  const a = tokens(placeName);
  const b = tokens(title);
  if (a.length === 0 || b.length === 0) return 0;
  const other = new Set(b);
  const hits = a.filter((word) => other.has(word)).length;
  return hits / Math.min(a.length, b.length);
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Page = {
  title?: string;
  coordinates?: { lat?: number; lon?: number }[];
  thumbnail?: { source?: string };
};

export type WikimediaPhoto = {
  url: string;
  pageUrl: string;
  credit: string;
};

/** The best confidently-matched photograph near these coordinates, if any. */
export async function findWikimediaPhoto(
  name: string,
  lat: number,
  lng: number,
): Promise<WikimediaPhoto | null> {
  const url = new URL(WIKI_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "geosearch");
  url.searchParams.set("ggscoord", `${lat}|${lng}`);
  url.searchParams.set("ggsradius", "2000");
  url.searchParams.set("ggslimit", "12");
  url.searchParams.set("prop", "coordinates|pageimages");
  url.searchParams.set("piprop", "thumbnail");
  url.searchParams.set("pithumbsize", "800");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("origin", "*");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "Pulsemap/1.0 (memory map demo)" },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const payload = (await response.json()) as { query?: { pages?: Page[] } };
  const pages = payload.query?.pages ?? [];

  let best: { score: number; photo: WikimediaPhoto } | null = null;

  for (const page of pages) {
    const title = page.title;
    const source = page.thumbnail?.source;
    const point = page.coordinates?.[0];
    if (!title || !source || typeof point?.lat !== "number" || typeof point.lon !== "number") {
      continue;
    }

    const file = decodeURIComponent(source.split("/").pop() ?? "").toLowerCase();
    if (NOT_A_PHOTO.test(file) || /\.svg(\?|$)/i.test(file)) continue;

    const away = distanceKm(lat, lng, point.lat, point.lon);
    if (away > MAX_DISTANCE_KM) continue;

    const score = similarity(name, title);
    if (score < MIN_SIMILARITY) continue;

    // Prefer the closest thing to an exact match, then the closest place.
    const ranked = score * 100 - away;
    if (!best || ranked > best.score) {
      best = {
        score: ranked,
        photo: {
          url: source.split("?")[0],
          pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
          credit: "Wikipedia",
        },
      };
    }
  }

  return best?.photo ?? null;
}

/**
 * Photograph lookup, exposed for places whose Google record has no pictures.
 * Cached on the place row by the caller, so the same lookup happens once.
 */
export const forPlace = internalAction({
  args: { name: v.string(), lat: v.number(), lng: v.number() },
  handler: async (_ctx, args): Promise<WikimediaPhoto | null> => {
    return await findWikimediaPhoto(args.name, args.lat, args.lng);
  },
});
