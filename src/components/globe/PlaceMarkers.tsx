import { memo, useCallback, useMemo, useState, type RefObject } from "react";
import * as THREE from "three";
import { GLOBE_RADIUS, latLngToVector3, quaternionFromNormal } from "./geo";
import { fallbackLabel, placeVisual } from "./place-categories";
import { getLabelTexture, getPlaceTexture } from "./textures";

/**
 * World size at the resting camera distance; the frame loop keeps it constant
 * on screen. Sized to be comfortably tappable, not just visible.
 */
export const PLACE_SPRITE = 0.068;

/** Name plate above a marker: a sprite, so it needs no DOM at all. */
export const LABEL_WIDTH = 0.18;
export const LABEL_HEIGHT = LABEL_WIDTH * (96 / 320);

/** Labels are decoration: a tap has to reach the marker underneath. */
const NO_RAYCAST = () => {};

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
  labelRegistry,
}: {
  places: GlobePlace[];
  labelIds: string[];
  /** Real places the person has their own memory at — worth pointing out. */
  promotedIds: string[];
  activeId: string | null;
  onOpen: (id: string) => void;
  registry: RefObject<Map<string, THREE.Sprite>>;
  /** Name plates, kept apart so the frame loop can size them to the screen. */
  labelRegistry: RefObject<Map<string, THREE.Sprite>>;
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
          labelRegistry={labelRegistry}
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
  labelRegistry,
}: {
  place: GlobePlace;
  labelled: boolean;
  promoted: boolean;
  active: boolean;
  onOpen: (id: string) => void;
  registry: RefObject<Map<string, THREE.Sprite>>;
  labelRegistry: RefObject<Map<string, THREE.Sprite>>;
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

  const attachLabel = useCallback(
    (sprite: THREE.Sprite | null) => {
      if (sprite) labelRegistry.current.set(place.id, sprite);
      else labelRegistry.current.delete(place.id);
    },
    [labelRegistry, place.id],
  );

  const label = place.categoryLabel ?? fallbackLabel(place.category);
  // A place that already holds one of your memories keeps its name on screen:
  // "I have actually been here" is the interesting fact, not the category.
  const showLabel = labelled || hovered || active || promoted;
  const accent = promoted ? "#ff8a4d" : active ? visual.color : "rgba(255,255,255,0.16)";

  const distance =
    place.distanceKm !== null && place.distanceKm < 40
      ? place.distanceKm < 1
        ? `${Math.round(place.distanceKm * 1000)} m`
        : `${place.distanceKm.toFixed(1)} km`
      : null;
  const subtitle = [
    place.rating ? `★ ${place.rating.toFixed(1)}` : null,
    label,
    distance,
  ]
    .filter(Boolean)
    .join(" · ");

  const labelTexture = useMemo(
    () =>
      showLabel
        ? getLabelTexture({
            title: place.name,
            subtitle,
            accent,
            promoted,
          })
        : null,
    [accent, place.name, promoted, showLabel, subtitle],
  );

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

      {labelTexture ? (
        <sprite
          ref={attachLabel}
          // Sits above the glyph, along the surface normal it is parented to.
          position={[0, 0, 0.04]}
          scale={[LABEL_WIDTH, LABEL_HEIGHT, 1]}
          raycast={NO_RAYCAST}
        >
          <spriteMaterial
            map={labelTexture}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      ) : null}
    </group>
  );
});
