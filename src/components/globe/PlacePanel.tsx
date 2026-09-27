import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Clock,
  ExternalLink,
  Globe2,
  Heart,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Plus,
  Star,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { fallbackLabel, placeVisual } from "./place-categories";

/** One real place, exactly as the backend serialises it. */
export type PlaceSummary = {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  lat: number;
  lng: number;
  address: string | null;
  shortAddress: string | null;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: string | null;
  businessStatus: string | null;
  website: string | null;
  phone: string | null;
  googleMapsUri: string | null;
  hasPhoto: boolean;
  photos: string[];
  /** A picture we can point an <img> at — Google's proxy or a licensed one. */
  photoUrl: string | null;
  photoCredit: string | null;
  photoPageUrl: string | null;
  openNow: boolean | null;
  hours: string[];
  summary: string | null;
  types: string[];
  detailsAt: number | null;
  distanceKm: number | null;
};

export type PlaceMemoryLink = {
  id: string;
  title: string;
  happenedAt: number;
  mediaUrl: string | null;
  distanceM: number;
};

const SPRING = { type: "spring" as const, stiffness: 240, damping: 27, mass: 0.9 };

function priceSymbol(level: string | null): string | null {
  switch (level) {
    case "PRICE_LEVEL_FREE":
      return "Free";
    case "PRICE_LEVEL_INEXPENSIVE":
      return "€";
    case "PRICE_LEVEL_MODERATE":
      return "€€";
    case "PRICE_LEVEL_EXPENSIVE":
      return "€€€";
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return "€€€€";
    default:
      return null;
  }
}

function ratingWord(value: number): string {
  if (value >= 4.7) return "Exceptional";
  if (value >= 4.4) return "Excellent";
  if (value >= 4.0) return "Very good";
  if (value >= 3.5) return "Good";
  return "Mixed";
}

/**
 * A Google-Maps-grade place panel, in PulseMap's own clothes.
 *
 * Only fields Google actually sent are rendered — never a fabricated rating,
 * opening time or description. Photographs stream through our own Convex
 * route, because the Maps key must never reach the browser.
 */
export function PlacePanel({
  placeId,
  fallback,
  memory,
  photoBase,
  onClose,
  onCentre,
  onPinMemory,
  onShowSaved,
}: {
  placeId: string | null;
  fallback: PlaceSummary | null;
  memory: PlaceMemoryLink | null;
  photoBase: string | null;
  onClose: () => void;
  onCentre: (place: PlaceSummary) => void;
  onPinMemory: (place: PlaceSummary) => void;
  onShowSaved: (memoryId: string) => void;
}) {
  const detail = useQuery(api.places.detail, placeId ? { placeId } : "skip");
  const resolve = useAction(api.places.resolve);
  const createMemory = useMutation(api.memories.create);

  const requested = useRef<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showHours, setShowHours] = useState(false);

  useEffect(() => {
    if (!placeId) {
      requested.current = null;
      setSavedId(null);
      setError(null);
      setShowHours(false);
      return;
    }
    if (requested.current === placeId) return;
    requested.current = placeId;
    setResolving(true);
    setError(null);

    resolve({ placeId })
      .then((result) => {
        if (!result.ok) setError(result.message);
      })
      .catch(() => setError("Google Places could not be reached just now."))
      .finally(() => setResolving(false));
  }, [placeId, resolve]);

  const place = (detail as PlaceSummary | null) ?? fallback;
  const visual = place ? placeVisual(place.category) : null;

  async function savePlace() {
    if (!place) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createMemory({
        title: place.name,
        note: "",
        placeName: place.shortAddress ?? place.name,
        lat: place.lat,
        lng: place.lng,
        happenedAt: Date.now(),
        tone: "quiet",
        tags: ["saved", place.category],
        visibility: "private",
        googlePlaceId: place.id,
      });
      setSavedId(created._id);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "That place could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  // Google's own photo if the key is entitled to it, otherwise whatever
  // licensed photograph the backend matched to this exact place. Either way it
  // is the real building, and the credit follows it.
  const googlePhotoUrl =
    photoBase && place?.photos.length ? `${photoBase}${encodeURIComponent(place.photos[0])}` : null;
  const photoUrl = place?.photoUrl ?? googlePhotoUrl;
  const photoCredit = place?.photoUrl ? place.photoCredit : null;
  const directions = place
    ? `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}&destination_place_id=${encodeURIComponent(place.id)}`
    : "#";
  const price = priceSymbol(place?.priceLevel ?? null);

  return (
    <AnimatePresence>
      {placeId && place ? (
        <motion.aside
          key={place.id}
          initial={{ opacity: 0, y: 26, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={SPRING}
          className="pm-dark pointer-events-auto fixed inset-x-3 bottom-3 z-50 flex max-h-[78vh] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#141419]/97 shadow-[0_30px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl lg:absolute lg:inset-x-auto lg:top-4 lg:right-4 lg:bottom-auto lg:z-40 lg:max-h-[calc(100%-6.5rem)] lg:w-[368px]"
          aria-label={`${place.name} details`}
        >
          <span className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-white/15 lg:hidden" />

          <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-2 lg:pt-5">
            <span
              className="flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold"
              style={{ borderColor: `${visual?.color}66`, color: visual?.color }}
            >
              <span aria-hidden="true">{visual?.glyph}</span>
              {place.categoryLabel || fallbackLabel(place.category)}
            </span>
            <div className="flex items-center gap-2">
              {resolving ? (
                <Loader2 className="size-3.5 animate-spin text-white/35" aria-hidden="true" />
              ) : null}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close place details"
                className="grid size-7 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-5">
            <h2 className="text-[1.35rem] leading-tight font-bold tracking-[-0.02em] text-white">
              {place.name}
            </h2>

            {place.rating !== null ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span className="font-semibold text-white">{place.rating.toFixed(1)}</span>
                <span className="flex items-center gap-0.5" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <Star
                      key={index}
                      className={
                        index < Math.round(place.rating ?? 0)
                          ? "size-3.5 fill-[#ffb547] text-[#ffb547]"
                          : "size-3.5 text-white/25"
                      }
                    />
                  ))}
                </span>
                <span className="text-white/60">{ratingWord(place.rating)}</span>
                {place.reviewCount !== null ? (
                  <span className="text-white/40">
                    ({place.reviewCount.toLocaleString("en-GB")})
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="mt-1.5 text-[13px] text-white/40">
                Google has no rating for this place yet.
              </p>
            )}

            {photoUrl ? (
              <figure className="mt-4">
                <img
                  src={photoUrl}
                  alt={place.name}
                  loading="lazy"
                  className="h-48 w-full rounded-2xl border border-white/[0.08] object-cover"
                />
                {photoCredit ? (
                  <figcaption className="mt-1.5 text-[10.5px] text-white/35">
                    Photo:{" "}
                    <a
                      href={place.photoPageUrl ?? "https://commons.wikimedia.org"}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-white/60"
                    >
                      {photoCredit}
                    </a>{" "}
                    — not from Google
                  </figcaption>
                ) : null}
              </figure>
            ) : (
              <div
                className="mt-4 grid h-24 w-full place-items-center rounded-2xl border border-white/[0.08] px-4 text-center text-[11px] leading-4 text-white/40"
                style={{ background: `linear-gradient(150deg, ${visual?.color}22, transparent)` }}
              >
                {resolving
                  ? "Looking for a photograph…"
                  : "No photograph available for this place yet"}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={directions}
                target="_blank"
                rel="noreferrer"
                className="flex h-10 items-center gap-2 rounded-full bg-[#ff6a2c] px-4 text-[13px] font-semibold text-white transition-transform active:scale-95"
              >
                <Navigation className="size-4" aria-hidden="true" />
                Directions
              </a>

              <Button
                type="button"
                variant="outline"
                onClick={savePlace}
                disabled={saving || savedId !== null}
                className="h-10 gap-2 rounded-full border-white/12 bg-transparent px-4 text-[13px] font-semibold text-white hover:bg-white/5"
              >
                {savedId ? (
                  <Check className="size-4 text-[#5eead4]" aria-hidden="true" />
                ) : saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Heart className="size-4" aria-hidden="true" />
                )}
                {savedId ? "Saved" : "Save"}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => onPinMemory(place)}
                className="h-10 gap-2 rounded-full border-white/12 bg-transparent px-4 text-[13px] font-semibold text-white hover:bg-white/5"
              >
                <Plus className="size-4" aria-hidden="true" />
                Memory here
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => onCentre(place)}
                className="h-10 gap-2 rounded-full border-white/12 bg-transparent px-4 text-[13px] font-semibold text-white hover:bg-white/5"
              >
                <Globe2 className="size-4" aria-hidden="true" />
                Centre
              </Button>
            </div>

            {savedId ? (
              <button
                type="button"
                onClick={() => onShowSaved(savedId)}
                className="mt-3 text-[12px] font-semibold text-[#5eead4] hover:underline"
              >
                Open the memory you just saved →
              </button>
            ) : null}

            {error ? (
              <p className="mt-4 rounded-2xl border-l-2 border-[#ff5c5c] bg-[#ff5c5c]/10 px-3 py-2 text-[12px] leading-5 text-[#ffb4b4]">
                {error}
              </p>
            ) : null}

            {place.address ? (
              <p className="mt-4 flex items-start gap-2 text-[13px] leading-6 text-white/70">
                <MapPin className="mt-1 size-4 shrink-0 text-white/35" aria-hidden="true" />
                {place.address}
              </p>
            ) : null}

            {place.businessStatus && place.businessStatus !== "OPERATIONAL" ? (
              <p className="mt-2 text-[12px] font-semibold text-[#ffb4b4]">
                Google reports this place as {place.businessStatus.toLowerCase().replace(/_/g, " ")}.
              </p>
            ) : null}

            {place.openNow !== null || place.hours.length > 0 ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowHours((value) => !value)}
                  className="flex items-center gap-2 text-[13px] font-semibold"
                >
                  <Clock className="size-4 text-white/35" aria-hidden="true" />
                  <span className={place.openNow ? "text-[#7ee2a8]" : "text-[#ffb4b4]"}>
                    {place.openNow === null ? "Hours" : place.openNow ? "Open now" : "Closed now"}
                  </span>
                  {place.hours.length > 0 ? (
                    <span className="text-white/40">{showHours ? "Hide" : "Show hours"}</span>
                  ) : null}
                </button>
                {showHours && place.hours.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-l border-white/10 pl-3">
                    {place.hours.map((line) => (
                      <li key={line} className="text-[12px] leading-5 text-white/60">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {place.summary ? (
              <div className="mt-4">
                <h3 className="text-[11px] font-bold tracking-[0.16em] text-white/40 uppercase">
                  About
                </h3>
                <p className="mt-2 text-[13px] leading-6 text-white/70">{place.summary}</p>
              </div>
            ) : null}

            {memory ? (
              <div className="mt-4 rounded-2xl border border-[#ff6a2c]/25 bg-[#ff6a2c]/10 p-3">
                <p className="text-[10px] font-bold tracking-[0.2em] text-[#ff8a4d] uppercase">
                  You have been here
                </p>
                <div className="mt-2 flex items-center gap-3">
                  {memory.mediaUrl ? (
                    <img
                      src={memory.mediaUrl}
                      alt=""
                      loading="lazy"
                      className="size-12 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/10 text-[11px] text-white/60">
                      📸
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-white">
                      {memory.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/60">
                      Your memory · {Math.round(memory.distanceM)} m away
                    </p>
                  </div>
                  <Link
                    to={`/m/${memory.id}`}
                    className="ml-auto shrink-0 text-[12px] font-semibold text-[#ff8a4d] hover:underline"
                  >
                    Open
                  </Link>
                </div>
              </div>
            ) : null}

            <dl className="mt-5 grid gap-2 border-t border-white/[0.07] pt-4 text-[13px]">
              {place.phone ? (
                <div className="flex items-center gap-2">
                  <Phone className="size-4 text-white/35" aria-hidden="true" />
                  <a href={`tel:${place.phone}`} className="text-white/85 hover:underline">
                    {place.phone}
                  </a>
                </div>
              ) : null}
              {place.website ? (
                <div className="flex items-center gap-2">
                  <ExternalLink className="size-4 text-white/35" aria-hidden="true" />
                  <a
                    href={place.website}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-white/85 hover:underline"
                  >
                    {place.website.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <MapPin className="size-4 text-white/35" aria-hidden="true" />
                <a
                  href={
                    place.googleMapsUri ??
                    `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}&query_place_id=${encodeURIComponent(place.id)}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-white/85 hover:underline"
                >
                  View on Google Maps
                </a>
              </div>
              {place.types.length > 1 ? (
                <div className="flex flex-wrap gap-1.5">
                  {place.types
                    .filter((type) => type !== place.category)
                    .slice(0, 5)
                    .map((type) => (
                      <span
                        key={type}
                        className="rounded-full border border-white/10 px-2 py-0.5 text-[10.5px] text-white/50"
                      >
                        {type.replace(/_/g, " ")}
                      </span>
                    ))}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-white/40">
                <span>
                  {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
                </span>
                {place.distanceKm !== null ? (
                  <span>
                    {place.distanceKm < 1
                      ? `${Math.round(place.distanceKm * 1000)} m from the view centre`
                      : `${place.distanceKm.toFixed(1)} km from the view centre`}
                  </span>
                ) : null}
                {price ? <span>{price}</span> : null}
              </div>
              <p className="mt-1 text-[10.5px] leading-4 text-white/30">
                Place data from Google Maps Platform. PulseMap is not endorsed by Google.
              </p>
            </dl>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
