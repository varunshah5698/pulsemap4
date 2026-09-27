import { Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { GLOBE_RADIUS, latLngToVector3 } from "./geo";

export type RoutePoint = { lat: number; lng: number; label?: string };

const STEPS_PER_LEG = 26;
/** Enough clearance that the arc never z-fights with the surface. */
const CLEARANCE = 0.004;
/** Long hops bow out further, the way a flight path looks on a globe. */
const MAX_ARC = 0.075;

/**
 * A trip drawn on the globe: the stops in order, joined along great circles.
 *
 * Deliberately points-only — no DOM, no textures, no per-frame work — so it can
 * sit inside the globe's rotating group without touching the frame loop.
 * Interpolation is spherical, so a leg across an ocean stays above the surface
 * instead of cutting through it.
 */
export function RouteLine({
  points,
  color = "#ff6a2c",
}: {
  points: RoutePoint[];
  color?: string;
}) {
  const arc = useMemo(() => {
    if (points.length < 2) return null;

    const vertices: THREE.Vector3[] = [];
    for (let leg = 0; leg < points.length - 1; leg += 1) {
      const from = points[leg];
      const to = points[leg + 1];
      const start = latLngToVector3(from.lat, from.lng, 1);
      const end = latLngToVector3(to.lat, to.lng, 1);
      const omega = start.angleTo(end);
      const bow = CLEARANCE + MAX_ARC * (omega / Math.PI);
      const sinOmega = Math.sin(omega);

      for (let step = 0; step <= STEPS_PER_LEG; step += 1) {
        // The previous leg already placed this corner.
        if (leg > 0 && step === 0) continue;
        const t = step / STEPS_PER_LEG;
        const point =
          omega < 1e-4 || Math.abs(sinOmega) < 1e-5
            ? start.clone()
            : start
                .clone()
                .multiplyScalar(Math.sin((1 - t) * omega) / sinOmega)
                .add(end.clone().multiplyScalar(Math.sin(t * omega) / sinOmega));
        const radius = GLOBE_RADIUS + bow * Math.sin(Math.PI * t) + CLEARANCE;
        point.normalize().multiplyScalar(radius);
        vertices.push(point);
      }
    }

    return vertices.length > 1 ? vertices : null;
  }, [points]);

  if (!arc) return null;

  return (
    <Line
      points={arc}
      color={color}
      lineWidth={2}
      transparent
      opacity={0.85}
      depthWrite={false}
      toneMapped={false}
    />
  );
}
