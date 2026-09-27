import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Chart primitives for the dashboard. Hand-rolled SVG so the orange
 * accent, weights and caps match the card system exactly.
 * ------------------------------------------------------------------ */

export function BarsRow({
  values,
  accent = "light",
  height = 86,
}: {
  values: number[];
  accent?: "light" | "orange";
  height?: number;
}) {
  const max = Math.max(...values, 1);
  const peak = values.indexOf(max);

  return (
    <div
      className="flex items-end justify-between gap-1.5"
      style={{ height }}
    >
      {values.map((value, index) => {
        const barHeight = Math.max(7, Math.round((value / max) * height));
        const isPeak = index === peak;
        return (
          <span
            key={index}
            className="w-full max-w-[18px] flex-1 rounded-full"
            style={{
              height: barHeight,
              background: isPeak
                ? accent === "orange"
                  ? "#ff6a2c"
                  : "#e8e8ee"
                : "rgba(255,255,255,0.16)",
            }}
          />
        );
      })}
    </div>
  );
}

/* --- Gauge ---------------------------------------------------------- */

function polar(cx: number, cy: number, r: number, degrees: number) {
  const angle = ((degrees - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const start = polar(cx, cy, r, from);
  const end = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export type GaugeSegment = { value: number; color: string };

/**
 * Horseshoe gauge opening at the bottom: a muted track, then each value
 * segment drawn on top with a two degree gap so rounded caps never collide.
 */
export function ArcGauge({
  segments,
  track = "#2b2b30",
  sweep = 270,
  thickness = 26,
}: {
  segments: GaugeSegment[];
  track?: string;
  sweep?: number;
  thickness?: number;
}) {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size - thickness) / 2 - 6;
  const from = -sweep / 2;
  const to = sweep / 2;
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  let cursor = from;
  const drawn = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const span = total > 0 ? (segment.value / total) * sweep : 0;
      const segmentFrom = cursor;
      const segmentTo = cursor + span;
      cursor = segmentTo;
      return {
        color: segment.color,
        from: segmentFrom + 1,
        to: Math.max(segmentFrom + 1.4, segmentTo - 1),
      };
    });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto h-[188px] w-[188px]"
      aria-hidden="true"
    >
      <path
        d={arcPath(cx, cy, radius, from, to)}
        fill="none"
        stroke={track}
        strokeWidth={thickness}
        strokeLinecap="round"
      />
      {drawn.map((segment, index) => (
        <path
          key={index}
          d={arcPath(cx, cy, radius, segment.from, segment.to)}
          fill="none"
          stroke={segment.color}
          strokeWidth={thickness}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/* --- Area curve ----------------------------------------------------- */

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export type SeriesPoint = { label: string; value: number };

export function AreaCurve({
  points,
  gridLevels = 6,
}: {
  points: SeriesPoint[];
  gridLevels?: number;
}) {
  const width = 600;
  const height = 190;

  if (points.length < 2) {
    return (
      <p className="py-16 text-center text-sm text-white/40">
        Not enough history yet — pin a couple of memories and the curve appears.
      </p>
    );
  }

  const values = points.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(4, (rawMax - rawMin) * 0.35);
  const min = Math.floor((rawMin - padding) / 5) * 5;
  const max = Math.ceil((rawMax + padding) / 5) * 5;

  const coords = points.map((point, index) => ({
    x: (index / (points.length - 1)) * width,
    y: height - ((point.value - min) / (max - min || 1)) * height,
  }));

  const line = smoothPath(coords);
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const peakIndex = values.indexOf(Math.max(...values));
  const peak = coords[peakIndex];

  const levels = Array.from({ length: gridLevels }, (_, index) =>
    Math.round(min + ((max - min) / (gridLevels - 1)) * index),
  ).reverse();

  return (
    <div>
      <div className="relative h-[190px] w-full">
        {/* Horizontal rules stay in HTML so their labels render crisply. */}
        <div className="absolute inset-0 flex flex-col justify-between">
          {levels.map((level) => (
            <div key={level} className="flex items-center gap-3">
              <span className="w-7 shrink-0 text-right text-[10px] text-white/30 tabular-nums">
                {level}
              </span>
              <span className="h-px flex-1 bg-white/[0.07]" />
            </div>
          ))}
        </div>

        {/* The plot area starts where the rules start. */}
        <div className="absolute inset-y-0 right-0 left-10">
          <svg
            className="h-full w-full"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="pm-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff6a2c" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#ff6a2c" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#pm-area)" />
            <path
              d={line}
              fill="none"
              stroke="#ff6a2c"
              strokeWidth={2.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${(peak.x / width) * 100}%`,
              top: `${(peak.y / height) * 100}%`,
            }}
          >
            <span className="block size-3 rounded-full border-2 border-white bg-[#ff6a2c]" />
            <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#17171a] tabular-nums">
              {Math.round(points[peakIndex].value)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex justify-between gap-1 pl-10">
        {points.map((point, index) => (
          <span
            key={`${point.label}-${index}`}
            className={cn(
              "text-[9px] tracking-wide uppercase sm:text-[10px]",
              index === peakIndex ? "text-white/70" : "text-white/30",
            )}
          >
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* --- Segmented control ---------------------------------------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="pm-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="pm-segment"
          data-active={option.value === value}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* --- Legend --------------------------------------------------------- */

export function Legend({
  items,
  className,
}: {
  items: Array<{ label: string; color: string }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-5 gap-y-2",
        className,
      )}
    >
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] text-white/55 uppercase"
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
