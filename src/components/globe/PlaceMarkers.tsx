import { Html } from "@react-three/drei";
import { memo, useCallback, useMemo, useState, type RefObject } from "react";
import * as THREE from "three";
import { GLOBE_RADIUS, latLngToVector3, quaternionFromNormal } from "./geo";
import { fallbackLabel, placeVisual } from "./place-categories";
import { getPlaceTexture } from "./textures";

/**
 * World size at the resting camera distance; the frame loop keeps it constant
 * on screen. Sized to be comfortably tappable, not just visible.
 */
export const PLACE_SPRITE = 0.068;

/** A real place, as the globe needs it. */
export type GlobePlace = {
  id: string;
  name: string;
  category: string;
  categoryLabel: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  distanceKm: number | null;
};

export function PlaceMarkers({
  places,
  labelIds,
  promotedIds,
  activeId,
  onOpen,
  registry,
}: {
  places: GlobePlace[];
  labelIds: string[];
  /** Real places the person has their own memory at — worth pointing out. */
  promotedIds: string[];
  activeId: string | null;
  onOpen: (id: string) => void;
  registry: RefObject<Map<string, THREE.Sprite>>;
}) {
  const labelled = useMemo(() => new Set(labelIds), [labelIds]);
  const promoted = useMemo(() => new Set(promotedIds), [promotedIds]);

  return (
    <group>
      {places.map((place) => (
        <PlaceRow
          key={place.id}
          place={place}
          labelled={labelled.has(place.id)}
          promoted={promoted.has(place.id)}
          active={place.id === activeId}
          onOpen={onOpen}
          registry={registry}
        />
      ))}
    </group>
  );
}

const PlaceRow = memo(function PlaceRow({
  place,
  labelled,
  promoted,
  active,
  onOpen,
  registry,
}: {
  place: GlobePlace;
  labelled: boolean;
  promoted: boolean;
  active: boolean;
  onOpen: (id: string) => void;
  registry: RefObject<Map<string, THREE.Sprite>>;
}) {
  const [hovered, setHovered] = useState(false);
  const visual = placeVisual(place.category);

  const position = useMemo(
    () => latLngToVector3(place.lat, place.lng, GLOBE_RADIUS),
    [place.lat, place.lng],
  );
  const quaternion = useMemo(
    () => quaternionFromNormal(position.clone().normalize()),
    [position],
  );
  const texture = useMemo(
    () => getPlaceTexture(visual.glyph, visual.color),
    [visual.glyph, visual.color],
  );

  // The frame loop owns visibility and scale; this only registers the sprite.
  const attach = useCallback(
    (sprite: THREE.Sprite | null) => {
      if (sprite) registry.current.set(place.id, sprite);
      else registry.current.delete(place.id);
    },
    [place.id, registry],
  );

  const label = place.categoryLabel ?? fallbackLabel(place.category);
  // A place that already holds one of your memories keeps its name on screen:
  // "I have actually been here" is the interesting fact, not the category.
  const showLabel = labelled || hovered || active || promoted;
  const accent = promoted ? "#ff8a4d" : active ? visual.color : undefined;

  return (
    <group position={position} quaternion={quaternion}>
      <sprite
        ref={attach}
        scale={PLACE_SPRITE}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(place.id);
        }}
      >
        <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
      </sprite>

      {showLabel ? (
        <Html
          position={[0, 0, 0.028]}
          center
          zIndexRange={[18, 10]}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="pointer-events-none -translate-y-3 rounded-xl border border-white/12 bg-[#0d0d12]/92 px-2.5 py-1.5 text-center whitespace-nowrap shadow-[0_14px_32px_rgba(0,0,0,0.5)] backdrop-blur-md"
            style={{ borderColor: accent }}
          >
            <p className="max-w-[190px] truncate text-[12px] leading-tight font-semibold text-white">
              {promoted ? <span aria-hidden="true">✦ </span> : null}
              {place.name}
            </p>
            <p className="mt-0.5 text-[10.5px] leading-tight text-white/55">
              {place.rating ? `★ ${place.rating.toFixed(1)} · ` : ""}
              {label}
              {place.distanceKm !== null && place.distanceKm < 40
                ? ` · ${place.distanceKm < 1 ? `${Math.round(place.distanceKm * 1000)} m` : `${place.distanceKm.toFixed(1)} km`}`
                : ""}
            </p>
            {promoted ? (
              <p className="mt-0.5 text-[10px] leading-tight font-semibold text-[#ff8a4d]">
                your memory is here
              </p>
            ) : null}
          </div>
        </Html>
      ) : null}
    </group>
  );
});
