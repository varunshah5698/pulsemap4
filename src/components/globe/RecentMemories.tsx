import { Button } from "@/components/ui/button";
import { relativeTime, toneMeta } from "@/components/pulsemap/tone";
import { Plus } from "lucide-react";
import type { GlobePin } from "./Markers";

export function RecentMemories({
  pins,
  activeId,
  onSelect,
  onAdd,
}: {
  pins: GlobePin[];
  activeId: string | null;
  onSelect: (pin: GlobePin) => void;
  onAdd: () => void;
}) {
  return (
    <section className="pm-panel p-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="pm-panel-title">Recent memories</h2>
        <span className="pm-chip">{pins.length}</span>
      </header>

      {pins.length === 0 ? (
        <p className="px-1 py-7 text-center text-xs leading-5 text-white/45">
          Nothing pinned yet. Click anywhere on the globe and the memory lands at that
          exact point.
        </p>
      ) : (
        <ul className="mt-3 -mx-1 max-h-[46vh] overflow-y-auto pr-1">
          {pins.slice(0, 40).map((pin) => {
            const meta = toneMeta(pin.tone);
            const active = pin.id === activeId;
            return (
              <li key={pin.id}>
                <button
                  type="button"
                  onClick={() => onSelect(pin)}
                  data-active={active}
                  className="pm-row w-full text-left"
                >
                  {pin.mediaUrl ? (
                    <img
                      src={pin.mediaUrl}
                      alt=""
                      loading="lazy"
                      className="size-11 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="size-11 shrink-0 rounded-xl"
                      style={{
                        background: `linear-gradient(150deg, ${meta.hex}, ${meta.hex}33)`,
                      }}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-white">
                      {pin.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-white/45">
                      {pin.placeName || "Unplaced"} · {relativeTime(pin.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        onClick={onAdd}
        className="mt-3 h-10 w-full rounded-full text-[13px] font-semibold"
      >
        <Plus className="size-4" aria-hidden="true" />
        Pin a memory
      </Button>
    </section>
  );
}
