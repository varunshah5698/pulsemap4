import {
  DashboardRail,
  WorkspaceTopBar,
  useOpenReminderCount,
} from "@/components/dashboard/DashboardFrame";
import { EarthGlobe, type GlobeScreenSignal } from "@/components/globe/EarthScene";
import { GlobeFilters, type GlobeScope } from "@/components/globe/GlobeFilters";
import { MemoryConnector, MemoryNotification } from "@/components/globe/MemoryNotification";
import type { GlobePin } from "@/components/globe/Markers";
import { RecentMemories } from "@/components/globe/RecentMemories";
import { useMemoryStream } from "@/components/globe/use-memory-stream";
import { PinMemoryDialog, type PinnedMemory } from "@/components/pulsemap/PinMemoryDialog";
import { toneMeta } from "@/components/pulsemap/tone";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Compass, Globe, MapPin, Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

/** What `api.memories.mapPins` hands back, narrowed to what this page reads. */
type MapPin = {
  _id: string;
  userId: string;
  title: string;
  note: string;
  placeName: string;
  lat: number;
  lng: number;
  happenedAt: number;
  createdAt: number;
  tone: string;
  tags: string[];
  visibility: string;
  mediaUrl: string | null;
};

function toGlobePin(pin: MapPin, userId: string | undefined): GlobePin {
  return {
    id: pin._id,
    title: pin.title,
    placeName: pin.placeName,
    lat: pin.lat,
    lng: pin.lng,
    tone: pin.tone,
    mediaUrl: pin.mediaUrl,
    happenedAt: pin.happenedAt,
    createdAt: pin.createdAt,
    visibility: pin.visibility,
    mine: pin.userId === userId,
  };
}

function RecentStrip({
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
    <div className="pm-panel flex items-center gap-2 px-2.5 py-2 backdrop-blur-xl">
      <span className="shrink-0 pl-1 text-[10px] font-bold tracking-[0.18em] text-white/40 uppercase">
        Recent
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5">
        {pins.length === 0 ? (
          <span className="px-1 text-[11px] text-white/45">Nothing pinned yet</span>
        ) : (
          pins.slice(0, 30).map((pin) => {
            const meta = toneMeta(pin.tone);
            return (
              <button
                key={pin.id}
                type="button"
                onClick={() => onSelect(pin)}
                aria-label={`Fly to ${pin.title}`}
                data-active={pin.id === activeId}
                style={{ borderColor: meta.hex }}
                className="pm-recent-thumb"
              >
                {pin.mediaUrl ? (
                  <img src={pin.mediaUrl} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span
                    className="size-full"
                    style={{ background: `linear-gradient(150deg, ${meta.hex}, ${meta.hex}33)` }}
                  />
                )}
              </button>
            );
          })
        )}
      </div>

      <button
        type="button"
        onClick={onAdd}
        aria-label="Pin a memory"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ff6a2c] text-white transition-transform active:scale-95"
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function MapPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const openReminders = useOpenReminderCount();
  const pinRows = useQuery(api.memories.mapPins);

  const [scope, setScope] = useState<GlobeScope>("all");
  const [tone, setTone] = useState<string>("any");
  const [search, setSearch] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const screenRef = useRef<GlobeScreenSignal>({ x: 0, y: 0, visible: false });
  const cardRef = useRef<HTMLDivElement>(null);
  const { current, cardShown, queued, focus, present, showNow, dismiss, markArrived } =
    useMemoryStream();

  const memories = useMemo<MapPin[]>(() => pinRows ?? [], [pinRows]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return memories.filter((pin) => {
      if (scope === "mine" && pin.userId !== user?._id) return false;
      if (tone !== "any" && pin.tone !== tone) return false;
      if (!term) return true;
      return `${pin.title} ${pin.placeName} ${pin.tags.join(" ")}`
        .toLowerCase()
        .includes(term);
    });
  }, [memories, scope, search, tone, user?._id]);

  const globePins = useMemo(
    () => visible.map((pin) => toGlobePin(pin, user?._id)),
    [visible, user?._id],
  );

  const openDialog = useCallback((next: { lat: number; lng: number } | null = null) => {
    setCoords(next);
    setDialogOpen(true);
  }, []);

  /** Handles coming from the panel or the filmstrip: fly the globe to it. */
  const flyTo = useCallback(
    (pin: GlobePin) => {
      const source = memories.find((item) => item._id === pin.id);
      if (!source) return;
      showNow({
        _id: source._id,
        title: source.title,
        placeName: source.placeName,
        note: source.note,
        happenedAt: source.happenedAt,
        mediaUrl: source.mediaUrl,
        tone: source.tone,
        lat: source.lat,
        lng: source.lng,
      });
    },
    [memories, showNow],
  );

  /** A memory was just saved: the globe travels to it and the card follows. */
  const handlePinned = useCallback(
    (memory: PinnedMemory) => {
      present({ ...memory, fresh: true });
    },
    [present],
  );

  const openMemory = useCallback((id: string) => navigate(`/m/${id}`), [navigate]);
  const pickLocation = useCallback(
    (next: { lat: number; lng: number }) => openDialog(next),
    [openDialog],
  );

  const loading = pinRows === undefined;
  const empty = !loading && memories.length === 0;

  return (
    <div className="pm-dark flex min-h-dvh flex-col bg-[#0f0f11]">
      <div className="flex min-h-0 flex-1">
        <DashboardRail
          onNew={() => openDialog()}
          avatarName={user?.name ?? user?.email ?? "Pulsemap"}
          badge={openReminders}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <WorkspaceTopBar reminderCount={openReminders} />

          <main className="flex min-h-0 flex-1 flex-col px-5 pt-5 pb-6 sm:px-7">
            <div className="flex flex-col gap-4 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-[1.75rem] leading-[1.05] font-extrabold tracking-[-0.025em] text-white sm:text-[2.1rem]">
                    Your memory globe
                  </h1>
                  <span className="pm-chip">
                    {memories.length} {memories.length === 1 ? "memory" : "memories"} ·{" "}
                    {globePins.length} on the globe
                  </span>
                </div>
                <p className="mt-2.5 max-w-2xl text-sm leading-6 text-white/55">
                  A living Earth, one dot per memory. Drag to spin it, scroll or pinch to
                  zoom, and click anywhere on the surface to pin a memory at that exact
                  point.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to="/explore"
                  className="flex items-center gap-1.5 text-[13px] font-medium text-white/60 transition-colors hover:text-white"
                >
                  <Compass className="size-4" aria-hidden="true" />
                  Guided trails
                </Link>
                <Button
                  type="button"
                  onClick={() => openDialog()}
                  className="h-11 gap-2 rounded-full px-5 font-semibold"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Pin a memory
                </Button>
              </div>
            </div>

            <section className="relative min-h-[520px] flex-1 overflow-hidden rounded-[26px] border border-white/[0.07]">
              <div className="pm-stage-sky absolute inset-0" aria-hidden="true" />

              <div className="absolute inset-0">
                <EarthGlobe
                  pins={globePins}
                  activeId={current?._id ?? null}
                  justAddedId={current?.fresh ? current._id : null}
                  focus={focus}
                  screenRef={screenRef}
                  onFocusArrived={markArrived}
                  onOpenMemory={openMemory}
                  onPickLocation={pickLocation}
                />
              </div>

              <MemoryConnector
                screenRef={screenRef}
                cardRef={cardRef}
                active={cardShown && current !== null}
              />

              <div className="pointer-events-none absolute top-3 right-3 left-3 z-30 lg:top-4 lg:right-auto lg:left-4 lg:w-[432px]">
                <div className="pm-panel pointer-events-auto p-3 backdrop-blur-xl">
                  <GlobeFilters
                    search={search}
                    onSearch={setSearch}
                    scope={scope}
                    onScope={setScope}
                    tone={tone}
                    onTone={setTone}
                    shown={globePins.length}
                    total={memories.length}
                  />
                </div>
                <p className="mt-3 hidden pl-1 text-[11px] font-medium tracking-[0.02em] text-white/35 lg:block">
                  Drag to spin · scroll to zoom · click the surface to pin
                </p>
              </div>

              <div className="absolute bottom-4 left-4 z-30 hidden w-[280px] lg:block">
                <RecentMemories
                  pins={globePins}
                  activeId={current?._id ?? null}
                  onSelect={flyTo}
                  onAdd={() => openDialog()}
                />
              </div>

              <div
                className={cn(
                  "absolute inset-x-3 bottom-3 z-30 lg:hidden",
                  (empty || loading) && "hidden",
                )}
              >
                <RecentStrip
                  pins={globePins}
                  activeId={current?._id ?? null}
                  onSelect={flyTo}
                  onAdd={() => openDialog()}
                />
              </div>

              {loading ? (
                <p className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 text-[11px] font-medium text-white/40">
                  Syncing your memories…
                </p>
              ) : null}

              {empty ? (
                <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center p-6 pt-40 lg:pt-6">
                  <div className="pm-panel pointer-events-auto max-w-sm p-6 text-center backdrop-blur-xl">
                    <span className="mx-auto grid size-12 place-items-center rounded-full bg-[#ff6a2c]/15 text-[#ff8a4d]">
                      <MapPin className="size-5" aria-hidden="true" />
                    </span>
                    <h2 className="mt-4 text-lg font-bold tracking-[-0.01em] text-white">
                      The globe is empty
                    </h2>
                    <p className="mt-2 text-[13px] leading-6 text-white/55">
                      Pin your first memory — a bridge at dawn, a kitchen table, a city you
                      want to return to — and the Earth will fly straight to it.
                    </p>
                    <Button
                      type="button"
                      onClick={() => openDialog()}
                      className="mt-5 h-11 w-full gap-2 rounded-full font-semibold"
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Pin a memory
                    </Button>
                  </div>
                </div>
              ) : null}

              <MemoryNotification
                memory={current}
                shown={cardShown}
                queued={queued}
                onDismiss={dismiss}
                cardRef={cardRef}
              />
            </section>

            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/35">
              <Globe className="size-3.5 text-[#ff6a2c]" aria-hidden="true" />
              Every point is a real latitude and longitude — memories stay attached to
              their place as the Earth turns.
            </p>
          </main>

          <footer className="border-t border-white/[0.06] px-5 py-5 sm:px-7">
            <p className="text-xs text-white/35">
              Pulsemap — a memory map for places worth returning to.
            </p>
          </footer>
        </div>
      </div>

      <PinMemoryDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setCoords(null);
        }}
        coords={coords}
        onPinned={handlePinned}
      />
    </div>
  );
}
