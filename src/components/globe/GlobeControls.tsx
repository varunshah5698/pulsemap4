import { cn } from "@/lib/utils";
import { Crosshair, Loader2, Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { GlobeView } from "./EarthScene";

/** "19.07°N, 72.88°E" — the plain truth about where the camera is pointing. */
export function formatLatLng(lat: number, lng: number): string {
  const north = lat >= 0 ? "N" : "S";
  const east = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${north}, ${Math.abs(lng).toFixed(2)}°${east}`;
}

export function formatSpan(spanKm: number): string {
  if (spanKm < 1) return `${Math.round(spanKm * 1000)} m across`;
  if (spanKm < 10) return `${spanKm.toFixed(1)} km across`;
  if (spanKm > 1000) return `${Math.round(spanKm / 100) * 100} km across`;
  return `${Math.round(spanKm)} km across`;
}

/** Zoom, reset, locate and the auto-spin switch, as one quiet rail. */
export function NavigationControls({
  onZoomIn,
  onZoomOut,
  onReset,
  onLocate,
  locating,
  autoSpin,
  onToggleAutoSpin,
  className,
  children,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onLocate: () => void;
  locating: boolean;
  autoSpin: boolean;
  onToggleAutoSpin: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const button =
    "grid size-9 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40";

  return (
    <div className={cn("pointer-events-auto flex flex-col items-center gap-1.5", className)}>
      <div className="pm-panel flex flex-col items-center gap-1 p-1.5 backdrop-blur-xl">
        <button type="button" onClick={onZoomIn} className={button} aria-label="Zoom in">
          <Plus className="size-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={onZoomOut} className={button} aria-label="Zoom out">
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <span aria-hidden="true" className="my-0.5 h-px w-6 bg-white/10" />
        <button
          type="button"
          onClick={onLocate}
          disabled={locating}
          className={cn(button, "text-[#ff8a4d] hover:text-[#ff8a4d]")}
          aria-label="Use my location"
          title="Use my location"
        >
          {locating ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Crosshair className="size-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={onReset}
          className={button}
          aria-label="Reset the view"
          title="Reset the view"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleAutoSpin}
          className={cn(button, autoSpin && "text-white")}
          aria-label={autoSpin ? "Pause the slow auto-rotation" : "Resume the slow auto-rotation"}
          aria-pressed={autoSpin}
          title={autoSpin ? "Auto-rotation on when idle" : "Auto-rotation off"}
        >
          {autoSpin ? (
            <Pause className="size-4" aria-hidden="true" />
          ) : (
            <Play className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {children}
    </div>
  );
}

/** The Google place categories, mapped to real included types on the server. */
export function PlaceCategories({
  scopes,
  value,
  onChange,
  loading,
}: {
  scopes: { key: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="-mx-1 flex flex-1 gap-2 overflow-x-auto px-1 py-0.5">
        {scopes.map((scope) => {
          const active = scope.key === value;
          return (
            <button
              key={scope.key}
              type="button"
              onClick={() => onChange(scope.key)}
              aria-pressed={active}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors",
                active
                  ? "border-[#ff6a2c] bg-[#ff6a2c] text-white"
                  : "border-white/12 text-white/55 hover:border-white/25 hover:text-white",
              )}
            >
              {scope.label}
            </button>
          );
        })}
      </div>
      {loading ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-white/40" aria-hidden="true" />
      ) : null}
    </div>
  );
}

/** One line telling the person what they are actually looking at. */
export function ViewChip({
  view,
  memories,
  places,
  className,
}: {
  view: GlobeView;
  memories: number;
  places: number;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "pointer-events-none flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-white/45",
        className,
      )}
    >
      <span className="text-white/70">{formatLatLng(view.lat, view.lng)}</span>
      <span aria-hidden="true">·</span>
      <span>{formatSpan(view.spanKm)}</span>
      <span aria-hidden="true">·</span>
      <span>
        {memories} {memories === 1 ? "memory" : "memories"}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        {places} {places === 1 ? "real place" : "real places"}
      </span>
    </p>
  );
}
