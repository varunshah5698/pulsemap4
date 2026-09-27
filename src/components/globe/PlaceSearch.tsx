import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useAction } from "convex/react";
import { Crosshair, Loader2, MapPin, Search, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GlobeView } from "./EarthScene";
import type { PlaceSummary } from "./PlacePanel";
import { fallbackLabel, placeVisual } from "./place-categories";

type Prediction = {
  placeId: string;
  main: string;
  secondary: string;
  types: string[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function newSessionToken(): string {
  const cryptoObj = typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoObj && "randomUUID" in cryptoObj) return cryptoObj.randomUUID();
  return `pm-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Search the real world.
 *
 * Typing asks Google Places Autocomplete; Enter runs a text search biased to
 * wherever the globe is currently looking (or to the person's GPS when they
 * asked for "near me"). Autocomplete and the follow-up details share one
 * session token, which is what Google's session pricing expects.
 */
export function PlaceSearch({
  view,
  configured,
  results,
  onSelect,
  onResults,
  onClearResults,
  onLocate,
  onOpenPanel,
}: {
  view: GlobeView;
  configured: boolean;
  results: PlaceSummary[];
  onSelect: (place: PlaceSummary) => void;
  onResults: (places: PlaceSummary[]) => void;
  onClearResults: () => void;
  onLocate: (coords: { lat: number; lng: number }) => void;
  onOpenPanel: (place: PlaceSummary) => void;
}) {
  const suggest = useAction(api.places.suggest);
  const search = useAction(api.places.search);
  const resolve = useAction(api.places.resolve);

  const [input, setInput] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biasedTo, setBiasedTo] = useState<string | null>(null);
  const session = useRef(newSessionToken());
  const boxRef = useRef<HTMLDivElement>(null);
  /**
   * The camera is published several times a second while the globe drifts, so
   * the bias is read from a ref at request time. Depending on `view` directly
   * would restart the debounce on every camera tick and the request would never
   * get to fire — autocomplete would simply look broken.
   */
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Close the dropdown when the person clicks away from the search box.
  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  // Autocomplete, debounced so a fast typist costs one request, not ten.
  useEffect(() => {
    if (!configured) return;
    const term = input.trim();
    if (term.length < 2) {
      setPredictions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const result = await suggest({
          input: term,
          sessionToken: session.current,
          lat: viewRef.current.lat,
          lng: viewRef.current.lng,
        });
        if (cancelled) return;
        if (!result.ok) {
          setError(result.message);
          setPredictions([]);
        } else {
          setError(null);
          setPredictions(result.suggestions);
          setOpen(result.suggestions.length > 0);
        }
      } catch {
        if (!cancelled) setError("Search is unavailable right now.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [configured, input, suggest]);

  async function openPlace(placeId: string, label?: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await resolve({ placeId, sessionToken: session.current });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      session.current = newSessionToken();
      setPredictions([]);
      setOpen(false);
      if (label) setInput(label);
      onSelect(result.place as PlaceSummary);
    } catch {
      setError("That place could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function runSearch(centre?: { lat: number; lng: number }, nearMe = false) {
    const term = input.trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    try {
      const bias = centre ?? { lat: viewRef.current.lat, lng: viewRef.current.lng };
      const result = await search({
        textQuery: term,
        sessionToken: session.current,
        lat: bias.lat,
        lng: bias.lng,
        nearMe,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      session.current = newSessionToken();
      setOpen(false);
      setPredictions([]);
      setBiasedTo(
        centre
          ? `${bias.lat.toFixed(2)}°, ${bias.lng.toFixed(2)}°`
          : null,
      );
      onResults(result.places as PlaceSummary[]);
    } catch {
      setError("Search is unavailable right now.");
    } finally {
      setBusy(false);
    }
  }

  function nearMe() {
    if (!navigator.geolocation) {
      setError("This browser will not share a location.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        onLocate(coords);
        setLocating(false);
        // "cafes near me" and friends: the query text is what Google searches,
        // the fix is only the bias.
        if (input.trim()) {
          void runSearch(coords, true);
        } else {
          setInput("places to visit near me");
        }
      },
      () => {
        setLocating(false);
        setError("Location permission was denied. You can still explore by hand.");
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  const showPredictions = open && predictions.length > 0;

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="absolute top-3.5 left-3.5 size-4 text-white/35"
            aria-hidden="true"
          />
          <Input
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setError(null);
            }}
            onFocus={() => setOpen(predictions.length > 0)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void runSearch();
              }
              if (event.key === "Escape") setOpen(false);
            }}
            placeholder="Search places, cities, landmarks…"
            aria-label="Search real places"
            className="h-11 rounded-full border-white/10 bg-white/[0.05] pl-10 pr-9 text-[13px]"
          />
          {busy || locating ? (
            <Loader2
              className="absolute top-3.5 right-3.5 size-4 animate-spin text-white/40"
              aria-hidden="true"
            />
          ) : input ? (
            <button
              type="button"
              onClick={() => {
                setInput("");
                setPredictions([]);
                setOpen(false);
                onClearResults();
                setBiasedTo(null);
              }}
              aria-label="Clear search"
              className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full text-white/40 hover:bg-white/10 hover:text-white"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={nearMe}
          title="Near me"
          className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 text-[12px] font-semibold text-white/80 transition-colors hover:border-white/25 hover:text-white"
        >
          <Crosshair className="size-4 text-[#ff6a2c]" aria-hidden="true" />
          Near me
        </button>
      </div>

      {!configured ? (
        <p className="mt-3 rounded-2xl border border-[#ff6a2c]/30 bg-[#ff6a2c]/10 px-3 py-2 text-[11.5px] leading-5 text-[#ffc7a8]">
          Real places need a Google Maps key. Add <strong>GOOGLE_MAPS_API_KEY</strong> in
          the Keys tab and this search will query Google Places directly.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-2xl border-l-2 border-[#ff5c5c] bg-[#ff5c5c]/10 px-3 py-2 text-[11.5px] leading-5 text-[#ffb4b4]">
          {error}
        </p>
      ) : null}

      {showPredictions ? (
        <ul className="absolute top-[54px] right-0 left-0 z-40 max-h-[46vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#141419]/97 p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          {predictions.map((prediction) => {
            const visual = placeVisual(prediction.types[0] ?? "point_of_interest");
            return (
              <li key={prediction.placeId}>
                <button
                  type="button"
                  onClick={() => void openPlace(prediction.placeId, prediction.main)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span
                    className="grid size-8 shrink-0 place-items-center rounded-full text-[13px]"
                    style={{ background: `${visual.color}26` }}
                    aria-hidden="true"
                  >
                    {visual.glyph}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-white">
                      {prediction.main}
                    </span>
                    {prediction.secondary ? (
                      <span className="mt-0.5 block truncate text-[11.5px] text-white/50">
                        {prediction.secondary}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
          <li className="px-3 py-2 text-[10.5px] text-white/30">
            Predictions from Google Places
          </li>
        </ul>
      ) : null}

      {results.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
          <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
            <p className="text-[10.5px] font-bold tracking-[0.16em] text-white/45 uppercase">
              {results.length} Google results
              {biasedTo ? <span className="text-white/30"> · near {biasedTo}</span> : null}
            </p>
            <button
              type="button"
              onClick={() => {
                onClearResults();
                setBiasedTo(null);
              }}
              className="text-[11px] font-semibold text-white/45 hover:text-white"
            >
              Clear
            </button>
          </div>
          <ul className="max-h-[32vh] overflow-y-auto">
            {results.slice(0, 20).map((place) => {
              const visual = placeVisual(place.category);
              return (
                <li
                  key={place.id}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.06]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(place)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-full text-[13px]"
                      style={{ background: `${visual.color}26` }}
                      aria-hidden="true"
                    >
                      {visual.glyph}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-white">
                        {place.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-white/50">
                        {place.categoryLabel || fallbackLabel(place.category)}
                        {place.shortAddress ? ` · ${place.shortAddress}` : ""}
                      </span>
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-3">
                    {place.rating !== null ? (
                      <span className="flex items-center gap-1 text-[11.5px] text-white/70">
                        <Star
                          className="size-3 fill-[#ffb547] text-[#ffb547]"
                          aria-hidden="true"
                        />
                        {place.rating.toFixed(1)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onOpenPanel(place)}
                      className="grid size-7 place-items-center rounded-full text-white/40 hover:bg-white/10 hover:text-white"
                      aria-label={`Open ${place.name} details`}
                    >
                      <MapPin className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
