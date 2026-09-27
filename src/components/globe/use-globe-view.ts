import { useEffect, useRef, useState, type RefObject } from "react";
import type { GlobeView } from "./EarthScene";

/**
 * The camera's position, published to React a few times a second.
 *
 * The frame loop writes into a ref every 180 ms and this poll copies it across
 * only when the camera has actually gone somewhere — so dragging the globe
 * never renders the app, and the queries below only fire on settled moves.
 */

const POLL_MS = 260;
/** Ignore sub-degree jitter; a real pan moves much more than this. */
const MIN_MOVE_DEGREES = 0.4;
const MIN_SPAN_RATIO = 0.12;

export function createViewSignal(): GlobeView {
  return { lat: 18, lng: 8, distance: 3.1, spanKm: 3400, local: false };
}

export function useGlobeView(signal: RefObject<GlobeView>): GlobeView {
  const [view, setView] = useState<GlobeView>(() => ({ ...signal.current }));
  const last = useRef<GlobeView>({ ...signal.current });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = signal.current;
      const previous = last.current;

      const movedDegrees = Math.hypot(
        next.lat - previous.lat,
        (((next.lng - previous.lng + 540) % 360) - 180),
      );
      const spanShift =
        Math.abs(next.spanKm - previous.spanKm) / Math.max(previous.spanKm, 1);
      const flagChanged = next.local !== previous.local;

      if (!flagChanged && spanShift < MIN_SPAN_RATIO && movedDegrees < MIN_MOVE_DEGREES) {
        return;
      }

      last.current = { ...next };
      setView({ ...next });
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [signal]);

  return view;
}
