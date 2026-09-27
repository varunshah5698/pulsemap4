import { Billboard, Html } from "@react-three/drei";
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { toneMeta } from "@/components/pulsemap/tone";
import { angularDistance, latLngToVector3, quaternionFromNormal, GLOBE_RADIUS } from "./geo";
import {
  getCircleTexture,
  getCountTexture,
  getGlowTexture,
  getSavedTexture,
  useImageTexture,
} from "./textures";

const DOT_RADIUS = 0.0115;
const HIT_RADIUS = 0.052;
const THUMB_SIZE = 0.08;

export type GlobePin = {
  id: string;
  title: string;
  placeName: string;
  lat: number;
  lng: number;
  tone: string;
  mediaUrl: string | null;
  happenedAt: number;
  createdAt: number;
  visibility: string;
  mine: boolean;
  /** A Google place the person saved, rather than something they witnessed. */
  saved?: boolean;
};

/** Everything the frame loop needs to animate a marker without React. */
export type MarkerHandle = {
  id: string;
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  haloMaterial: THREE.SpriteMaterial;
  thumbMaterial: THREE.MeshBasicMaterial | null;
  cluster: boolean;
  mine: boolean;
  justAdded: boolean;
  hovered: boolean;
  /** Seconds on the render clock; -1 means "start counting from now". */
  growthStart: number;
  /** Set by the row; the frame loop damps the thumbnail toward it. */
  thumbTarget: number;
};

export type MarkersProps = {
  pins: GlobePin[];
  activeId: string | null;
  justAddedId: string | null;
  clusterLevel: number;
  onOpen: (id: string) => void;
  onCluster: (cluster: { lat: number; lng: number }) => void;
  registry: RefObject<Map<string, MarkerHandle>>;
};

type ClusterGroup = {
  id: string;
  lat: number;
  lng: number;
  count: number;
  mine: boolean;
};

/** Coarser grouping the further out the camera is. */
/** Angular distance at which neighbouring memories merge, per zoom level. */
const CLUSTER_THRESHOLD = [0.06, 0.018, 0];

function buildMarkers(
  pins: GlobePin[],
  clusterLevel: number,
  keepSeparate: Set<string>,
): { pinned: GlobePin[]; clusters: ClusterGroup[] } {
  const threshold = CLUSTER_THRESHOLD[Math.min(clusterLevel, CLUSTER_THRESHOLD.length - 1)];
  const bucket = pins.filter((pin) => !keepSeparate.has(pin.id));
  const held = pins.filter((pin) => keepSeparate.has(pin.id));

  if (threshold <= 0 || bucket.length <= 12) {
    return { pinned: [...held, ...bucket], clusters: [] };
  }

  const groups: { center: THREE.Vector3; sum: THREE.Vector3; pins: GlobePin[] }[] = [];
  const point = new THREE.Vector3();

  for (const pin of bucket) {
    latLngToVector3(pin.lat, pin.lng, GLOBE_RADIUS, point);
    let placed = false;
    for (const group of groups) {
      if (angularDistance(group.center, point) < threshold) {
        group.sum.add(point);
        group.center.copy(group.sum).normalize();
        group.pins.push(pin);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({ center: point.clone(), sum: point.clone(), pins: [pin] });
    }
  }

  const clusters: ClusterGroup[] = [];
  const clustered = new Set<string>();
  for (const group of groups) {
    if (group.pins.length < 2) continue;
    clusters.push({
      id: `cluster:${group.pins[0].id}`,
      lat: 90 - Math.acos(THREE.MathUtils.clamp(group.center.y, -1, 1)) * (180 / Math.PI),
      lng: ((Math.atan2(group.center.z, -group.center.x) * (180 / Math.PI) - 180 + 540) % 360) - 180,
      count: group.pins.length,
      mine: group.pins.some((pin) => pin.mine),
    });
    for (const pin of group.pins) clustered.add(pin.id);
  }

  return {
    pinned: [...held, ...bucket.filter((pin) => !clustered.has(pin.id))],
    clusters,
  };
}

export function Markers({
  pins,
  activeId,
  justAddedId,
  clusterLevel,
  onOpen,
  onCluster,
  registry,
}: MarkersProps) {
  const keepSeparate = useMemo(() => {
    const set = new Set<string>();
    if (activeId) set.add(activeId);
    if (justAddedId) set.add(justAddedId);
    return set;
  }, [activeId, justAddedId]);

  const { pinned, clusters } = useMemo(
    () => buildMarkers(pins, clusterLevel, keepSeparate),
    [pins, clusterLevel, keepSeparate],
  );

  return (
    <group>
      {pinned.map((pin) => (
        <MarkerRow
          key={pin.id}
          pin={pin}
          active={pin.id === activeId}
          justAdded={pin.id === justAddedId}
          onOpen={onOpen}
          registry={registry}
        />
      ))}
      {clusters.map((cluster) => (
        <ClusterRow key={cluster.id} cluster={cluster} onCluster={onCluster} registry={registry} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Thumbnail photo attached to the surface.
 * ------------------------------------------------------------------ */

function ThumbnailTexture({
  url,
  enabled,
  material,
}: {
  url: string | null;
  enabled: boolean;
  material: RefObject<THREE.MeshBasicMaterial | null>;
}) {
  const texture = useImageTexture(url, enabled);

  useEffect(() => {
    const target = material.current;
    if (!target) return;
    target.map = texture;
    target.needsUpdate = true;
  }, [texture, material]);

  return null;
}

/* ------------------------------------------------------------------ *
 * A single memory on the globe.
 * ------------------------------------------------------------------ */

const MarkerRow = memo(function MarkerRow({
  pin,
  active,
  justAdded,
  onOpen,
  registry,
}: {
  pin: GlobePin;
  active: boolean;
  justAdded: boolean;
  onOpen: (id: string) => void;
  registry: RefObject<Map<string, MarkerHandle>>;
}) {
  const meta = toneMeta(pin.tone);
  const saved = pin.saved === true;
  const accent = saved ? "#5eead4" : meta.hex;
  const [hovered, setHovered] = useState(false);
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Sprite>(null);
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const haloMaterial = useRef<THREE.SpriteMaterial>(null);
  const thumbMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const handleRef = useRef<MarkerHandle | null>(null);

  const local = useMemo(
    () => latLngToVector3(pin.lat, pin.lng, GLOBE_RADIUS),
    [pin.lat, pin.lng],
  );
  const quaternion = useMemo(() => quaternionFromNormal(local.clone().normalize()), [local]);

  // A memory with a photograph shows it on the globe, always. That picture is
  // the whole point of the pin — hiding it behind a hover nobody can perform on
  // a touch screen makes the map look like dots on a ball.
  const wantsThumb = active || justAdded || hovered || Boolean(pin.mediaUrl);

  useEffect(() => {
    const groupNode = group.current;
    const ringNode = ring.current;
    const ringMat = ringMaterial.current;
    const haloMat = haloMaterial.current;
    if (!groupNode || !ringNode || !ringMat || !haloMat) return;

    const handle: MarkerHandle = {
      id: pin.id,
      group: groupNode,
      ring: ringNode,
      ringMaterial: ringMat,
      haloMaterial: haloMat,
      thumbMaterial: thumbMaterial.current,
      cluster: false,
      mine: pin.mine,
      justAdded,
      hovered: false,
      growthStart: justAdded ? -1 : 0,
      thumbTarget: pin.mediaUrl ? (pin.mine ? 1 : 0.9) : 0,
    };
    handleRef.current = handle;
    const store = registry.current;
    store.set(pin.id, handle);
    return () => {
      store.delete(pin.id);
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin.id, registry]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.thumbMaterial = thumbMaterial.current;
    handle.mine = pin.mine;
    handle.thumbTarget = pin.mediaUrl ? (pin.mine ? 1 : 0.9) : 0;
  }, [pin.mediaUrl, pin.mine]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.hovered = hovered;
  }, [hovered]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.justAdded = justAdded;
    if (justAdded) handle.growthStart = -1;
  }, [justAdded]);

  return (
    <group ref={group} position={local} quaternion={quaternion}>
      <mesh position={[0, 0, 0.004]}>
        <sphereGeometry args={[DOT_RADIUS, 14, 14]} />
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>

      <sprite ref={halo} position={[0, 0, 0.008]} scale={[0.12, 0.12, 0.12]}>
        <spriteMaterial
          ref={haloMaterial}
          map={saved ? getSavedTexture() : getGlowTexture()}
          color={accent}
          transparent
          opacity={0.45}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>

      <mesh ref={ring} position={[0, 0, 0.003]}>
        <ringGeometry args={[0.019, 0.0245, 44]} />
        <meshBasicMaterial
          ref={ringMaterial}
          color={active ? "#ff6a2c" : accent}
          transparent
          opacity={0.8}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      <group position={[0, 0, 0.062]}>
        <Billboard>
          <mesh>
            <planeGeometry args={[THUMB_SIZE, THUMB_SIZE]} />
            <meshBasicMaterial
              ref={thumbMaterial}
              transparent
              opacity={0}
              alphaMap={getCircleTexture()}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 0, -0.001]}>
            <ringGeometry args={[THUMB_SIZE / 2, THUMB_SIZE / 2 + 0.004, 40]} />
            <meshBasicMaterial
              color={meta.hex}
              transparent
              opacity={0.55}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </Billboard>
      </group>

      <ThumbnailTexture url={pin.mediaUrl} enabled={wantsThumb} material={thumbMaterial} />

      {/* Hover label: the photograph, the place, the note's first line. */}
      {hovered ? (
        <Html
          position={[0, 0, 0.1]}
          center
          zIndexRange={[24, 12]}
          style={{ pointerEvents: "none" }}
        >
          <div className="pointer-events-none flex w-44 items-center gap-3 rounded-2xl border border-white/15 bg-[#101014]/92 p-2.5 shadow-[0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
            {pin.mediaUrl ? (
              <img
                src={pin.mediaUrl}
                alt=""
                className="size-11 shrink-0 rounded-xl object-cover"
                loading="lazy"
              />
            ) : (
              <span
                className="size-11 shrink-0 rounded-xl"
                style={{ background: `linear-gradient(150deg, ${meta.hex}, ${meta.hex}44)` }}
              />
            )}
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold tracking-[0.1em] text-white/45 uppercase">
                {saved ? "Saved place" : pin.placeName || "Unplaced"}
              </span>
              <span className="mt-0.5 block truncate text-[13px] font-semibold text-white">
                {pin.title}
              </span>
            </span>
          </div>
        </Html>
      ) : null}

      {/* Invisible hit target: comfortable to hover, still a point on the globe. */}
      <mesh
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(pin.id);
        }}
      >
        <sphereGeometry args={[HIT_RADIUS, 10, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
});

/* ------------------------------------------------------------------ *
 * Several memories close together.
 * ------------------------------------------------------------------ */

const ClusterRow = memo(function ClusterRow({
  cluster,
  onCluster,
  registry,
}: {
  cluster: ClusterGroup;
  onCluster: (cluster: { lat: number; lng: number }) => void;
  registry: RefObject<Map<string, MarkerHandle>>;
}) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Sprite>(null);
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const haloMaterial = useRef<THREE.SpriteMaterial>(null);

  const local = useMemo(
    () => latLngToVector3(cluster.lat, cluster.lng, GLOBE_RADIUS),
    [cluster.lat, cluster.lng],
  );
  const quaternion = useMemo(() => quaternionFromNormal(local.clone().normalize()), [local]);
  const countTexture = useMemo(() => getCountTexture(cluster.count), [cluster.count]);

  useEffect(() => {
    const groupNode = group.current;
    const ringNode = ring.current;
    const ringMat = ringMaterial.current;
    const haloMat = haloMaterial.current;
    if (!groupNode || !ringNode || !ringMat || !haloMat) return;

    const handle: MarkerHandle = {
      id: cluster.id,
      group: groupNode,
      ring: ringNode,
      ringMaterial: ringMat,
      haloMaterial: haloMat,
      thumbMaterial: null,
      cluster: true,
      mine: cluster.mine,
      justAdded: false,
      hovered: false,
      growthStart: 0,
      thumbTarget: 0,
    };
    const store = registry.current;
    store.set(cluster.id, handle);
    return () => {
      store.delete(cluster.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.id, registry]);

  return (
    <group ref={group} position={local} quaternion={quaternion}>
      <mesh position={[0, 0, 0.004]}>
        <sphereGeometry args={[0.019, 16, 16]} />
        <meshBasicMaterial color="#ff6a2c" toneMapped={false} />
      </mesh>
      <sprite ref={halo} position={[0, 0, 0.01]} scale={[0.19, 0.19, 0.19]}>
        <spriteMaterial
          ref={haloMaterial}
          map={getGlowTexture()}
          color="#ff6a2c"
          transparent
          opacity={0.4}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      <mesh ref={ring} position={[0, 0, 0.003]}>
        <ringGeometry args={[0.028, 0.0335, 44]} />
        <meshBasicMaterial
          ref={ringMaterial}
          color="#ffb38a"
          transparent
          opacity={0.75}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {countTexture ? (
        <sprite position={[0, 0, 0.05]} scale={[0.06, 0.06, 0.06]}>
          <spriteMaterial
            map={countTexture}
            transparent
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </sprite>
      ) : null}

      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onCluster({ lat: cluster.lat, lng: cluster.lng });
        }}
      >
        <sphereGeometry args={[0.045, 10, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
});
