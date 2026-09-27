import * as THREE from "three";

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Radius of the globe in scene units. */
export const GLOBE_RADIUS = 1;

/** Real world radius, for turning camera distance into kilometres. */
export const EARTH_RADIUS_KM = 6371;

/**
 * The camera distance the marker sizes are authored for. Markers are scaled by
 * `markerZoomScale` so they keep a roughly constant size on screen as the
 * person descends from orbit into a city.
 */
export const BASE_DISTANCE = 3.1;

/** How far above the surface the camera may descend: ~127 km up, city scale. */
export const MIN_DISTANCE = 1.02;
export const MAX_DISTANCE = 7;

/** Big enough to see a ridge; small enough that the poles never flip over. */
export const MAX_TILT = 1.4;

/** The camera's field of view, in degrees. Keep in step with the Canvas. */
export const CAMERA_FOV_DEG = 32;

/** Angular radius of the patch of Earth on screen, in kilometres. */
export function viewRadiusKm(distance: number, fovDeg = CAMERA_FOV_DEG): number {
  const half = Math.tan((fovDeg * DEG2RAD) / 2);
  const altitude = Math.max(distance - GLOBE_RADIUS, 0.0004);
  return EARTH_RADIUS_KM * Math.atan(half * altitude);
}

/**
 * The inverse of `viewRadiusKm`: the camera distance that frames this much
 * ground. Used to line the 3D globe up with a 2D map of the same place.
 */
export function distanceForSpan(spanKm: number, fovDeg = CAMERA_FOV_DEG): number {
  const half = Math.tan((fovDeg * DEG2RAD) / 2);
  const angle = Math.max(spanKm, 0.01) / EARTH_RADIUS_KM;
  return GLOBE_RADIUS + Math.tan(angle) / half;
}

/** World-space scale that keeps a marker the same size on screen. */
export function markerZoomScale(distance: number): number {
  return THREE.MathUtils.clamp(
    (distance - GLOBE_RADIUS) / (BASE_DISTANCE - GLOBE_RADIUS),
    0.024,
    4,
  );
}

function toRadians(value: number): number {
  return value * DEG2RAD;
}

/** Great-circle distance, for "is this memory at that place?". */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A point {"dx":"km north", "dy":"km east"} away, for camera framing maths. */
export function offsetLatLng(
  lat: number,
  lng: number,
  northKm: number,
  eastKm: number,
): { lat: number; lng: number } {
  const nextLat = lat + northKm / 111.32;
  const nextLng = lng + eastKm / (111.32 * Math.max(0.2, Math.cos(toRadians(lat))));
  return {
    lat: THREE.MathUtils.clamp(nextLat, -85, 85),
    lng: ((nextLng + 540) % 360) - 180,
  };
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Latitude/longitude to a point on the globe.
 *
 * The mapping matches an equirectangular earth texture on a three.js sphere:
 * longitude -180 sits at u = 0, Greenwich at u = 0.5, the north pole at v = 1.
 */
export function latLngToVector3(
  lat: number,
  lng: number,
  radius = GLOBE_RADIUS,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const theta = (90 - lat) * DEG2RAD;
  const phi = (lng + 180) * DEG2RAD;
  const sinTheta = Math.sin(theta);
  return target.set(
    -radius * Math.cos(phi) * sinTheta,
    radius * Math.cos(theta),
    radius * Math.sin(phi) * sinTheta,
  );
}

/** The inverse of latLngToVector3, for turning a click on the surface into coordinates. */
export function vector3ToLatLng(point: THREE.Vector3): { lat: number; lng: number } {
  const radius = point.length() || 1;
  const lat = 90 - Math.acos(THREE.MathUtils.clamp(point.y / radius, -1, 1)) * RAD2DEG;
  const lng = Math.atan2(point.z, -point.x) * RAD2DEG - 180;
  return { lat, lng: ((lng + 540) % 360) - 180 };
}

/**
 * Where a point on the globe should be, so a rotation can aim at it.
 *
 * Assumes Euler order `XYZ` with `z = 0`: the polar spin happens first and the
 * tilt about the world's horizontal axis second, so a long way round is a spin
 * rather than a flip — and the tilt only ever has to reach the point's latitude.
 */
export function rotationToFace(point: THREE.Vector3): { x: number; y: number } {
  const horizontal = Math.hypot(point.x, point.z);
  return {
    // Bounded tilt keeps the poles upright instead of somersaulting the globe.
    x: THREE.MathUtils.clamp(Math.atan2(point.y, horizontal), -MAX_TILT, MAX_TILT),
    y: -Math.atan2(point.x, point.z),
  };
}

/** Shortest way round from one angle to another, so the globe never spins the long way. */
export function shortestAngle(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return from + delta;
}

/** Points the given quaternion along a surface normal. */
export function quaternionFromNormal(
  normal: THREE.Vector3,
  target = new THREE.Quaternion(),
): THREE.Quaternion {
  return target.setFromUnitVectors(Z_AXIS, normal);
}

export function easeInOutCubic(t: number): number {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - THREE.MathUtils.clamp(t, 0, 1), 3);
}


/** Slight overshoot, used for markers growing out of the surface. */
export function easeOutBack(t: number, overshoot = 1.7): number {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(clamped - 1, 3) + overshoot * Math.pow(clamped - 1, 2);
}

/** Angular distance between two surface points, in radians. */
export function angularDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return a.angleTo(b);
}
