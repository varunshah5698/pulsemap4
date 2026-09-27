/**
 * Plain geography helpers shared by the routing, costing and profile layers.
 * No Convex functions live here on purpose — this is arithmetic, not API.
 */

export type Point = { lat: number; lng: number; name?: string };

const EARTH_RADIUS_KM = 6371;

export function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

/** Great-circle distance, the honest fallback when no routing engine answers. */
export function haversineKm(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function centreOf(points: Point[]): Point | null {
  if (points.length === 0) return null;
  const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
  return { lat, lng };
}

/** Round trip length in kilometres, in the order given. */
export function pathKm(points: Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineKm(points[index - 1], points[index]);
  }
  return total;
}

/**
 * Reorder stops so the path stops doubling back.
 *
 * Nearest neighbour for the first pass, then 2-opt swaps while they keep
 * shortening the path. Everything comes from real coordinates, so this needs no
 * model and no network — it is the part of "optimise my route" that is maths.
 */
export function optimiseOrder<T extends Point>(stops: T[]): { order: T[]; beforeKm: number; afterKm: number } {
  if (stops.length < 3) {
    const same = pathKm(stops);
    return { order: [...stops], beforeKm: same, afterKm: same };
  }

  const beforeKm = pathKm(stops);
  const remaining = [...stops.slice(1)];
  const route: T[] = [stops[0]];
  while (remaining.length > 0) {
    const last = route[route.length - 1];
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const distance = haversineKm(last, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    route.push(remaining.splice(bestIndex, 1)[0]);
  }

  let improved = true;
  let guard = 0;
  while (improved && guard < 40) {
    improved = false;
    guard += 1;
    for (let i = 1; i < route.length - 1; i += 1) {
      for (let j = i + 1; j < route.length; j += 1) {
        const swapped = [
          ...route.slice(0, i),
          ...route.slice(i, j + 1).reverse(),
          ...route.slice(j + 1),
        ];
        if (pathKm(swapped) + 0.001 < pathKm(route)) {
          route.splice(0, route.length, ...swapped);
          improved = true;
        }
      }
    }
  }

  return { order: route, beforeKm, afterKm: pathKm(route) };
}

/** "2 h 40 m" — the way a traveller says it. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} m`;
}

/** How far apart two things are, in words. */
export function describeDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}
