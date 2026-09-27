import { toneMeta } from "@/components/pulsemap/tone";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { GlobeHoverSignal } from "./EarthScene";
import type { GlobePin } from "./Markers";

/**
 * The card that follows the marker under the cursor.
 *
 * It lives in the page's own DOM rather than inside the WebGL canvas: a card
 * rendered under the canvas means a nested React root per marker, mounting and
 * unmounting as labels come and go. Here the scene only publishes a coordinate,
 * this positions one element with it, and React re-renders just when the
 * hovered marker actually changes.
 */

/** Fast enough to feel attached, slow enough to cost nothing. */
const POLL_MS = 90;
/** The card hangs above the marker. */
const OFFSET_Y = 26;

export function GlobeHoverCard({
  hoverRef,
  pins,
}: {
  hoverRef: RefObject<GlobeHoverSignal>;
  pins: GlobePin[];
}) {
  const [id, setId] = useState<string | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const signal = hoverRef.current;
      setId((current) => (current === signal.id ? current : signal.id));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [hoverRef]);

  // Position is written straight to the node: moving the card must not render.
  useEffect(() => {
    if (!id) return;
    let frame = 0;
    const follow = () => {
      const node = nodeRef.current;
      const signal = hoverRef.current;
      if (node && signal.id) {
        node.style.transform = `translate(-50%, -100%) translate(${signal.x}px, ${
          signal.y - OFFSET_Y
        }px)`;
      }
      frame = window.requestAnimationFrame(follow);
    };
    frame = window.requestAnimationFrame(follow);
    return () => window.cancelAnimationFrame(frame);
  }, [hoverRef, id]);

  const pin = id ? pins.find((item) => item.id === id) : undefined;
  if (!pin) return null;

  const meta = toneMeta(pin.tone);

  return (
    <div
      ref={nodeRef}
      className="pointer-events-none absolute top-0 left-0 z-20 flex w-44 items-center gap-3 rounded-2xl border border-white/15 bg-[#101014]/94 p-2.5 shadow-[0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur-md"
    >
      {pin.mediaUrl ? (
        <img src={pin.mediaUrl} alt="" loading="lazy" className="size-11 shrink-0 rounded-xl object-cover" />
      ) : (
        <span
          className="size-11 shrink-0 rounded-xl"
          style={{ background: `linear-gradient(150deg, ${meta.hex}, ${meta.hex}44)` }}
        />
      )}
      <span className="min-w-0">
        <span className="block truncate text-[10px] font-semibold tracking-[0.1em] text-white/45 uppercase">
          {pin.saved ? "Saved place" : pin.placeName || "Unplaced"}
        </span>
        <span className="mt-0.5 block truncate text-[13px] font-semibold text-white">
          {pin.title}
        </span>
      </span>
    </div>
  );
}
