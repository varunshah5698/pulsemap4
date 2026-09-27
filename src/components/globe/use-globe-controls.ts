import * as THREE from "three";
import { useEffect, useRef } from "react";

export const MIN_DISTANCE = 1.55;
export const MAX_DISTANCE = 6.2;

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
};

const DRAG_SPEED = 0.0046;
/** Gestures shorter than this still count as a tap on the globe. */
export const TAP_THRESHOLD = 6;

/**
 * Pointer, drag, wheel and pinch input for the globe.
 *
 * Every value lives in a ref: continuous input never triggers a React render,
 * and the frame loop is the only writer.
 */
export function useGlobeControls(element: HTMLElement | null) {
  const controls = useRef<GlobeControls>({
    pointer: { x: 0, y: 0 },
    pointerInside: false,
    dragging: false,
    spin: { y: -0.9, x: 0.24, velocityY: 0, velocityX: 0, idle: 0 },
    distance: 3.1,
    targetDistance: 3.1,
    travel: null,
    glow: 0,
    dragDistance: 0,
    dragged: false,
  });

  useEffect(() => {
    if (!element) return;
    const c = controls.current;
    const pointers = new Map<number, { x: number; y: number }>();
    const pinch = { startGap: 0, startDistance: 0, active: false };
    let last = { x: 0, y: 0 };
    let moved = 0;

    const clampDistance = (value: number) =>
      THREE.MathUtils.clamp(value, MIN_DISTANCE, MAX_DISTANCE);

    const onPointerMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      c.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      c.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      c.pointerInside = true;

      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        if (!pinch.active) {
          pinch.active = true;
          pinch.startGap = gap;
          pinch.startDistance = c.targetDistance;
        } else if (pinch.startGap > 0) {
          c.targetDistance = clampDistance(pinch.startDistance * (pinch.startGap / gap));
        }
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
      // Remember the flick so release keeps momentum.
      c.spin.velocityY = dx / 0.016 * DRAG_SPEED * 0.35;
      c.spin.velocityX = dy / 0.016 * DRAG_SPEED * 0.35;
      c.spin.idle = 0;
      c.travel = null;
    };

    const endDrag = () => {
      if (c.dragging && moved < TAP_THRESHOLD) {
        // A tap, not a drag: let the momentum die so nothing drifts.
        c.spin.velocityY = 0;
        c.spin.velocityX = 0;
      }
      c.dragging = false;
      moved = 0;
    };

    const onPointerDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size > 1) {
        c.dragging = false;
        return;
      }
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
      if (pointers.size < 2) pinch.active = false;
      if (pointers.size === 0) endDrag();
    };

    const onPointerLeave = () => {
      c.pointerInside = false;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Trackpad pinch arrives as a wheel with ctrlKey set.
      const sensitivity = event.ctrlKey ? 0.01 : 0.0012;
      c.targetDistance = clampDistance(
        c.targetDistance * Math.exp(event.deltaY * sensitivity),
      );
      c.travel = null;
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
