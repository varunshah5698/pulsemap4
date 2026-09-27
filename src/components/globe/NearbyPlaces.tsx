import type { PlaceSummary } from "./PlacePanel";
import { placeVisual } from "./place-categories";

/**
 * The places Google knows about around here, as a list.
 *
 * The globe is for seeing where a place is; a list is for actually choosing
 * one. Every row opens the same detail panel the markers do, so nothing that is
 * listed is out of reach — including on a phone, where a marker can be a few
 * pixels across.
 */
export function NearbyPlaces({
  places,
  activeId,
  loading,
  configured,
  withinRange,
  error,
  onSelect,
}: {
  places: PlaceSummary[];
  activeId: string | null;
  loading: boolean;
  configured: boolean;
  withinRange: boolean;
  error: string | null;
  onSelect: (place: PlaceSummary) => void;
}) {
  if (!configured) {
    return (
      <p className="text-[11px] leading-5 text-white/45">
        Real places need a Google Maps key. Add{" "}
        <strong className="font-semibold text-white/70">GOOGLE_MAPS_API_KEY</strong> in the
        Keys tab.
      </p>
    );
  }

  if (!withinRange) {
    return (
      <p className="text-[11px] leading-5 text-white/45">
        Zoom in to a city and the real places around it appear here.
      </p>
    );
  }

  if (error) {
    return <p className="text-[11px] leading-5 text-[#ffb4b4]">{error}</p>;
  }

  if (loading && places.length === 0) {
    return <p className="text-[11px] leading-5 text-white/45">Looking around…</p>;
  }

  if (places.length === 0) {
    return (
      <p className="text-[11px] leading-5 text-white/45">
        Nothing on Google Maps within sight of here. Try a spot nearer a town.
      </p>
    );
  }

  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-0.5">
      {places.map((place) => {
        const visual = placeVisual(place.category);
        const active = place.id === activeId;
        return (
          <li key={place.id}>
            <button
              type="button"
              onClick={() => onSelect(place)}
              className={`pm-nearby-row${active ? " is-active" : ""}`}
            >
              {place.photoUrl ? (
                <img
                  src={place.photoUrl}
                  alt=""
                  loading="lazy"
                  className="pm-nearby-thumb"
                />
              ) : (
                <span
                  className="pm-nearby-thumb grid place-items-center text-[13px]"
                  style={{ background: `${visual.color}22` }}
                  aria-hidden="true"
                >
                  {visual.glyph}
                </span>
              )}

              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[12.5px] leading-tight font-semibold text-white">
                  {place.name}
                </span>
                <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-white/50">
                  {place.rating ? `★ ${place.rating.toFixed(1)} · ` : ""}
                  {place.categoryLabel ?? place.category}
                  {place.distanceKm !== null
                    ? ` · ${
                        place.distanceKm < 1
                          ? `${Math.round(place.distanceKm * 1000)} m`
                          : `${place.distanceKm.toFixed(1)} km`
                      }`
                    : ""}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
