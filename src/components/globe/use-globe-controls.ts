import { useEffect, useRef } from "react";
import * as THREE from "three";
import { MAX_DISTANCE, MIN_DISTANCE, BASE_DISTANCE } from "./geo";

export { MAX_DISTANCE, MIN_DISTANCE };

export type GlobeSpin = {
  /** Rotation about the polar axis, the main spin. */
  y: number;
  /** Rotation about the screen's horizontal axis, bounded tilt. */
  x: number;
  velocityY: number;
  velocityX: number;
  /** 0 = paused, 1 = full idle drift. Ramps so motion always eases. */
  idle: number;
};

export type GlobeTravel = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  duration: number;
};

export type GlobeControls = {
  pointer: { x: number; y: number };
  pointerInside: boolean;
  dragging: boolean;
  spin: GlobeSpin;
  /** Where the camera is, and where it is heading. */
  distance: number;
  targetDistance: number;
  travel: GlobeTravel | null;
  /** Extra charge that lights the region glow when a memory lands. */
  glow: number;
  /** How far the pointer travelled during the current gesture, in pixels. */
  dragDistance: number;
  /** True once the last gesture was a drag rather than a tap. */
  dragged: boolean;
  /** `performance.now()` of the last touch, drag or zoom. */
  interactionAt: number;
  /** True while two fingers are down. */
  pinching: boolean;
};

const DRAG_SPEED = 0.0046;
/** Two-finger movement rotates a little slower, so pinching stays stable. */
const PINCH_PAN_SPEED = 0.0032;
/** Gestures shorter than this still count as a tap on the globe. */
export const TAP_THRESHOLD = 6;
/** Auto-rotation only returns after this long without any input. */
export const AUTO_RESUME_MS = 5200;
/**
 * A flick is a nudge, not a throw. The globe has to stop where the person
 * lets go of it — momentum that runs on for seconds reads as the Earth
 * slipping out of their hand.
 */
const MAX_FLICK_SPEED = 1.15;
/** How much of the drag's speed survives release. */
const FLICK_TRANSFER = 0.085;
/** How much one pixel of wheel travel moves the camera. */
const WHEEL_PER_PIXEL = 0.0012;
/** A trackpad pinch sends small deltas; they need a firmer hand. */
const PINCH_WHEEL_PER_PIXEL = 0.008;

const IDLE_VIEW = { x: 0.24, y: -0.9 };

/**
 * Pointer, drag, wheel and pinch input for the globe.
 *
 * Every value lives in a ref: continuous input never triggers a React render,
 * and the frame loop is the only writer. Manual control is absolute — nothing
 * here ever overrides the person holding the globe.
 */
export function useGlobeControls(element: HTMLElement | null) {
  const controls = useRef<GlobeControls>({
    pointer: { x: 0, y: 0 },
    pointerInside: false,
    dragging: false,
    spin: { y: IDLE_VIEW.y, x: IDLE_VIEW.x, velocityY: 0, velocityX: 0, idle: 0 },
    distance: BASE_DISTANCE,
    targetDistance: BASE_DISTANCE,
    travel: null,
    glow: 0,
    dragDistance: 0,
    dragged: false,
    interactionAt: 0,
    pinching: false,
  });

  useEffect(() => {
    if (!element) return;
    const c = controls.current;
    const pointers = new Map<number, { x: number; y: number }>();
    const pinch = { startGap: 0, startDistance: 0, active: false, centroid: { x: 0, y: 0 } };
    let last = { x: 0, y: 0 };
    let moved = 0;

    const clampDistance = (value: number) =>
      THREE.MathUtils.clamp(value, MIN_DISTANCE, MAX_DISTANCE);

    const touch = () => {
      c.interactionAt = performance.now();
      c.spin.idle = 0;
    };

    const centroidOf = () => {
      let x = 0;
      let y = 0;
      for (const point of pointers.values()) {
        x += point.x;
        y += point.y;
      }
      const count = Math.max(1, pointers.size);
      return { x: x / count, y: y / count };
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      c.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      c.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      c.pointerInside = true;

      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      // Two fingers: pinch to zoom, and the whole gesture can still pan.
      if (pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        const centroid = centroidOf();

        if (!pinch.active) {
          pinch.active = true;
          pinch.startGap = gap;
          pinch.startDistance = c.targetDistance;
          pinch.centroid = centroid;
        } else {
          if (pinch.startGap > 0) {
            c.targetDistance = clampDistance(
              pinch.startDistance * (pinch.startGap / Math.max(gap, 1)),
            );
          }
          const dx = centroid.x - pinch.centroid.x;
          const dy = centroid.y - pinch.centroid.y;
          c.spin.y += dx * PINCH_PAN_SPEED;
          c.spin.x += dy * PINCH_PAN_SPEED;
          pinch.centroid = centroid;
          c.travel = null;
          touch();
        }
        moved += 10;
        c.dragged = true;
        return;
      }

      if (!c.dragging) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      last = { x: event.clientX, y: event.clientY };
      c.dragDistance = moved;
      c.dragged = moved > TAP_THRESHOLD;

      c.spin.y += dx * DRAG_SPEED;
      c.spin.x += dy * DRAG_SPEED;
      // Remember the flick so release keeps a *little* momentum.
      c.spin.velocityY = THREE.MathUtils.clamp(dx * FLICK_TRANSFER, -MAX_FLICK_SPEED, MAX_FLICK_SPEED);
      c.spin.velocityX = THREE.MathUtils.clamp(dy * FLICK_TRANSFER, -MAX_FLICK_SPEED, MAX_FLICK_SPEED);
      c.travel = null;
      touch();
    };

    const endDrag = () => {
      if (c.dragging && moved < TAP_THRESHOLD) {
        // A tap, not a drag: let the momentum die so nothing drifts.
        c.spin.velocityY = 0;
        c.spin.velocityX = 0;
      }
      c.dragging = false;
      moved = 0;
      touch();
    };

    const onPointerDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      touch();
      if (pointers.size > 1) {
        // A second finger always hands the camera to the pinch gesture.
        pinch.active = false;
        c.pinching = true;
        c.dragging = false;
        c.travel = null;
        return;
      }
      c.pinching = false;
      c.dragging = true;
      c.travel = null;
      last = { x: event.clientX, y: event.clientY };
      moved = 0;
      c.dragDistance = 0;
      c.dragged = false;
      (event.target as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    };

    const onPointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) {
        pinch.active = false;
        c.pinching = false;
      }
      if (pointers.size === 1) {
        // Lifting one finger keeps the globe in hand rather than dropping it.
        const remaining = Array.from(pointers.values())[0];
        last = { x: remaining.x, y: remaining.y };
        moved = TAP_THRESHOLD + 1;
        c.dragging = true;
        c.dragged = true;
        return;
      }
      if (pointers.size === 0) endDrag();
    };

    const onPointerLeave = () => {
      c.pointerInside = false;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      // Devices disagree wildly about what a "scroll" is: a notch, a line, a
      // page, or a stream of tiny trackpad deltas. Normalise all of them to
      // pixels, then cap a single event, so one gesture is one predictable step
      // instead of a lurch into orbit.
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const raw = event.deltaY * lines;
      // Trackpad pinch arrives as a wheel with ctrlKey set, in much finer steps.
      const pixels = event.ctrlKey
        ? THREE.MathUtils.clamp(raw, -30, 30)
        : THREE.MathUtils.clamp(raw, -200, 200);
      const step =
        pixels * (event.ctrlKey ? PINCH_WHEEL_PER_PIXEL : WHEEL_PER_PIXEL);

      c.targetDistance = clampDistance(c.targetDistance * Math.exp(step));
      c.travel = null;
      touch();
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointerleave", onPointerLeave);
    element.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", endDrag);

    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointerleave", onPointerLeave);
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", endDrag);
    };
  }, [element]);

  return controls;
}
