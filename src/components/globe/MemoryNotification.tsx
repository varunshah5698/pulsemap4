import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router";
import { longDate, toneMeta } from "@/components/pulsemap/tone";
import type { GlobeScreenSignal } from "./EarthScene";

export type NotifiedMemory = {
  _id: string;
  title: string;
  placeName: string;
  note: string;
  happenedAt: number;
  mediaUrl: string | null;
  tone: string;
  lat: number;
  lng: number;
  /** True while this is the memory that was just saved. */
  fresh?: boolean;
};

const SPRING = { type: "spring" as const, stiffness: 235, damping: 26, mass: 0.9 };

/**
 * Draws the subtle line from the card to its marker. Both ends are measured
 * live, so the line tracks the marker as the globe turns.
 */
export function MemoryConnector({
  screenRef,
  cardRef,
  active,
}: {
  screenRef: RefObject<GlobeScreenSignal>;
  cardRef: RefObject<HTMLDivElement | null>;
  active: boolean;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (!active) {
      if (layer.current) layer.current.style.opacity = "0";
      return;
    }
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const layerNode = layer.current;
      const pathNode = path.current;
      const dotNode = dot.current;
      const card = cardRef.current;
      const target = screenRef.current;
      if (!layerNode || !pathNode || !dotNode) return;

      if (!card || !target.visible) {
        layerNode.style.opacity = "0";
        return;
      }

      const box = layerNode.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      const startX = cardBox.left - box.left;
      const startY = cardBox.top - box.top + cardBox.height / 2;
      const endX = target.x;
      const endY = target.y;
      const bend = (startX + endX) / 2;

      layerNode.style.opacity = "1";
      pathNode.setAttribute(
        "d",
        `M ${startX} ${startY} C ${bend} ${startY}, ${bend} ${endY}, ${endX} ${endY}`,
      );
      dotNode.setAttribute("cx", String(endX));
      dotNode.setAttribute("cy", String(endY));
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, cardRef, screenRef]);

  return (
    <div
      ref={layer}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 hidden opacity-0 transition-opacity duration-500 lg:block"
    >
      <svg className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id="pm-connector" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff6a2c" stopOpacity="0.1" />
            <stop offset="55%" stopColor="#ff6a2c" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#ffe0cd" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          ref={path}
          fill="none"
          stroke="url(#pm-connector)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="5 7"
          className="pm-connector-flow"
        />
        <circle ref={dot} r="3.6" fill="#ff6a2c" />
      </svg>
    </div>
  );
}

/**
 * The travel-notification card. Anchored beside the globe on desktop and as a
 * bottom sheet on phones, the same markup either way.
 */
export function MemoryNotification({
  memory,
  shown,
  queued,
  onDismiss,
  cardRef,
}: {
  memory: NotifiedMemory | null;
  shown: boolean;
  queued: number;
  onDismiss: () => void;
  cardRef: RefObject<HTMLDivElement | null>;
}) {
  const meta = memory ? toneMeta(memory.tone) : null;

  return (
    <AnimatePresence>
      {memory && shown ? (
        <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 lg:absolute lg:top-4 lg:right-4 lg:bottom-auto lg:left-auto lg:w-[336px]">
          <motion.div
            ref={cardRef}
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 14 }}
            transition={SPRING}
            className="pm-panel pointer-events-auto relative overflow-hidden p-4 shadow-[0_28px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -top-16 h-32 blur-3xl"
              style={{ background: `radial-gradient(60% 60% at 50% 50%, #ff6a2c55, transparent)` }}
            />

            <div className="relative flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold tracking-[0.22em] text-[#ff8a4d] uppercase">
                {memory.fresh ? "New memory" : "Memory"}
              </span>
              <div className="flex items-center gap-2">
                {queued > 0 ? (
                  <span className="pm-chip">+{queued} waiting</span>
                ) : null}
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Close this notification"
                  className="grid size-7 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="relative mt-3 flex items-start gap-3">
              {memory.mediaUrl ? (
                <motion.img
                  key={memory.mediaUrl}
                  src={memory.mediaUrl}
                  alt=""
                  initial={{ scale: 1.06 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
                  className="size-[72px] shrink-0 rounded-2xl object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid size-[72px] shrink-0 place-items-center rounded-2xl text-[11px] font-semibold text-white/70"
                  style={{
                    background: `linear-gradient(150deg, ${meta?.hex ?? "#ff6a2c"}, ${
                      meta?.hex ?? "#ff6a2c"
                    }33)`,
                  }}
                >
                  {meta?.label ?? "Memory"}
                </span>
              )}

              <div className="min-w-0 pt-0.5">
                <p className="truncate text-[15px] font-bold tracking-[-0.01em] text-white">
                  {memory.placeName || "Somewhere on the map"}
                </p>
                <p className="mt-1 text-xs text-white/45">{longDate(memory.happenedAt)}</p>
                <p className="mt-1 truncate text-xs text-white/60">{memory.title}</p>
              </div>
            </div>

            {memory.note ? (
              <p className="relative mt-3 line-clamp-3 text-[13px] leading-6 text-white/65">
                “{memory.note}”
              </p>
            ) : null}

            <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
              <Link
                to={`/m/${memory._id}`}
                className="group flex items-center gap-2 text-[13px] font-semibold text-[#ff8a4d]"
              >
                View memory
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
              <span className="text-[11px] text-white/35">
                {memory.lat.toFixed(2)}°, {memory.lng.toFixed(2)}°
              </span>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
