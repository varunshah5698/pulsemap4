import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobeView } from "./EarthScene";
import type { GlobePlace } from "./PlaceMarkers";

/**
 * Real places around whatever the camera is looking at.
 *
 * Cost control lives here:
 *  - nothing is asked for while the globe is zoomed out to the planet;
 *  - nothing is asked for while the camera is still moving — including the
 *    globe's own idle drift, which otherwise never stopped moving and so never
 *    let a request through at all;
 *  - once it does stop, the query waits 650 ms of stillness;
 *  - the same cell and filter is never asked twice (the backend also keeps a
 *    scan ledger, so revisiting an area is free);
 *  - results come from our own cache and are read reactively.
 */

/** Below this much ground on screen, Google Places becomes useful. */
export const PLACES_SPAN_KM = 320;
/** Wait this long after the camera stops before spending a request. */
const DEBOUNCE_MS = 650;
const MIN_RADIUS_KM = 6;
const MAX_RADIUS_KM = 50;
/** How many places the globe ever draws at once. */
const MAX_RENDERED = 45;

export type PlacesConfig = {
  configured: boolean;
  photoBase: string | null;
  scopes: { key: string; label: string }[];
  nearbyMaxRadiusKm: number;
  /**
   * A Maps JavaScript API key the backend holds for browsers, if any. Only a
   * dedicated browser key is ever sent here — never the server Places key.
   */
  browserKey: string | null;
  /** True when the browser key is a dedicated, referrer-restricted one. */
  browserKeyDedicated: boolean;
};

type NearbyArgs = { lat: number; lng: number; radiusKm: number };

/**
 * The last area worth asking about.
 *
 * Different from a plain debounce: while the camera is moving we *hold* what we
 * already have rather than resetting to nothing, so the places on screen do not
 * blink out every time the globe turns.
 */
function useSettled<T>(value: T | null, paused: boolean, delay: number): T | null {
  const [settled, setSettled] = useState<T | null>(value);
  useEffect(() => {
    if (value === null) {
      setSettled(null);
      return;
    }
    if (paused) return;
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [paused, value, delay]);
  return settled;
}

function radiusFor(spanKm: number): number {
  const wanted = spanKm * 0.6;
  return Math.round(Math.min(Math.max(wanted, MIN_RADIUS_KM), MAX_RADIUS_KM));
}

export function useNearbyPlaces({
  view,
  category,
  enabled,
}: {
  view: GlobeView;
  category: string;
  enabled: boolean;
}) {
  const config = useQuery(api.places.config) as PlacesConfig | undefined;
  const configured = config?.configured ?? false;
  const withinRange = view.spanKm <= PLACES_SPAN_KM;

  const args = useMemo<NearbyArgs | null>(() => {
    if (!enabled || !configured || !withinRange) return null;
    return {
      lat: Number(view.lat.toFixed(3)),
      lng: Number(view.lng.toFixed(3)),
      radiusKm: radiusFor(view.spanKm),
    };
  }, [configured, enabled, view.lat, view.lng, view.spanKm, withinRange]);

  const settled = useSettled(args, view.moving, DEBOUNCE_MS);
  const rows = useQuery(
    api.places.around,
    settled ? { ...settled, category } : "skip",
  );

  const ensure = useAction(api.places.ensure);
  const asked = useRef<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) {
      asked.current = null;
      setError(null);
      return;
    }
    const key = `${settled.lat}:${settled.lng}:${settled.radiusKm}:${category}`;
    if (asked.current === key) return;
    asked.current = key;

    let cancelled = false;
    setScanning(true);
    ensure({
      lat: settled.lat,
      lng: settled.lng,
      radiusKm: settled.radiusKm,
      scope: category,
    })
      .then((result) => {
        if (!cancelled) setError(result.ok ? null : result.message);
      })
      .catch(() => {
        if (!cancelled) setError("Google Places could not be reached just now.");
      })
      .finally(() => {
        if (!cancelled) setScanning(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, ensure, settled]);

  const all = useMemo(() => rows ?? [], [rows]);

  const places = useMemo<GlobePlace[]>(
    () =>
      all.slice(0, MAX_RENDERED).map((place) => ({
        id: place.id,
        name: place.name,
        category: place.category,
        categoryLabel: place.categoryLabel,
        lat: place.lat,
        lng: place.lng,
        rating: place.rating,
        reviewCount: place.reviewCount,
        distanceKm: place.distanceKm,
      })),
    [all],
  );

  return {
    config,
    configured,
    withinRange,
    places,
    rows: all,
    queryCentre: settled,
    /** True while Google is being asked, or before the first rows land. */
    loading: withinRange && configured && (scanning || rows === undefined),
    error,
  };
}
