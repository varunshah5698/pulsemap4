import {
  DashboardRail,
  WorkspaceTopBar,
  useOpenReminderCount,
} from "@/components/dashboard/DashboardFrame";
import {
  EarthGlobe,
  type CurrentLocation,
  type GlobeCommand,
  type GlobeHoverSignal,
  type GlobeScreenSignal,
  type GlobeView,
} from "@/components/globe/EarthScene";
import { GlobeHoverCard } from "@/components/globe/GlobeHoverCard";
import { StageBoundary } from "@/components/globe/StageBoundary";
import { NavigationControls, PlaceCategories, ViewChip, formatLatLng } from "@/components/globe/GlobeControls";
import { GlobeFilters, type GlobeScope } from "@/components/globe/GlobeFilters";
import { MemoryConnector, MemoryNotification } from "@/components/globe/MemoryNotification";
import type { GlobePin } from "@/components/globe/Markers";
import { NearbyPlaces } from "@/components/globe/NearbyPlaces";
import { PlaceMap2D, type Map2DView } from "@/components/globe/PlaceMap2D";
import { PlacePanel, type PlaceMemoryLink, type PlaceSummary } from "@/components/globe/PlacePanel";
import { PlaceSearch } from "@/components/globe/PlaceSearch";
import { RecentMemories } from "@/components/globe/RecentMemories";
import { MAX_DISTANCE, MIN_DISTANCE, distanceForSpan, haversineKm } from "@/components/globe/geo";
import { useGlobeView, createViewSignal } from "@/components/globe/use-globe-view";
import { useMemoryStream } from "@/components/globe/use-memory-stream";
import { PLACES_SPAN_KM, useNearbyPlaces } from "@/components/globe/use-nearby-places";
import { PinMemoryDialog, type PinnedMemory } from "@/components/pulsemap/PinMemoryDialog";
import { toneMeta } from "@/components/pulsemap/tone";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Compass, Globe2, MapIcon, MapPin, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** How close a memory has to be before we say "you have been here". */
const MEMORY_NEARBY_M = 300;

/**
 * Where the globe stops being useful and the flat map takes over.
 *
 * One globe texture pixel covers kilometres at this zoom, so there are simply
 * no streets to look at. Handing over here is what makes "zoom into Paris"
 * show Paris.
 */
const MAP_HANDOFF_KM = 130;
/** Come back out past this and the globe becomes the better view again. */
const GLOBE_RETURN_KM = 420;

type StageMode = "globe" | "map";

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
    saved: pin.tags.includes("saved"),
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

  /* --- camera ---------------------------------------------------------- */
  const screenRef = useRef<GlobeScreenSignal>({ x: 0, y: 0, visible: false });
  const hoverRef = useRef<GlobeHoverSignal>({ id: null, x: 0, y: 0 });
  const viewSignal = useRef<GlobeView>(createViewSignal());
  const view = useGlobeView(viewSignal);
  const nonce = useRef(0);
  const [command, setCommand] = useState<GlobeCommand | null>(null);

  const aim = useCallback((lat: number, lng: number, distance?: number) => {
    nonce.current += 1;
    setCommand({ kind: "focus", lat, lng, distance, nonce: nonce.current });
  }, []);
  const zoomBy = useCallback((factor: number) => {
    nonce.current += 1;
    setCommand({ kind: "zoom", factor, nonce: nonce.current });
  }, []);
  const resetView = useCallback(() => {
    nonce.current += 1;
    setCommand({ kind: "reset", nonce: nonce.current });
  }, []);

  /* --- globe or flat map ------------------------------------------------ */
  const [mode, setMode] = useState<StageMode>("globe");
  const [mapView, setMapView] = useState<GlobeView | null>(null);
  const mapSyncNonce = useRef(0);
  const [mapSync, setMapSync] = useState({ lat: 0, lng: 0, spanKm: 3400, nonce: 0 });
  /** Set once the person picks the globe themselves, so we stop handing over. */
  const handoffDismissed = useRef(false);

  /** The camera both views agree on: the flat map wins while it is on screen. */
  const effectiveView: GlobeView = mode === "map" && mapView ? mapView : view;

  /** The globe's camera distance that frames the same patch of ground. */
  const distanceFor = useCallback(
    (spanKm: number) =>
      Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distanceForSpan(spanKm))),
    [],
  );

  const showMap = useCallback(
    (source: { lat: number; lng: number; spanKm: number }) => {
      mapSyncNonce.current += 1;
      setMapSync({
        lat: source.lat,
        lng: source.lng,
        spanKm: source.spanKm,
        nonce: mapSyncNonce.current,
      });
      setMapView({
        lat: source.lat,
        lng: source.lng,
        spanKm: source.spanKm,
        distance: distanceFor(source.spanKm),
        local: true,
        moving: false,
      });
      setMode("map");
    },
    [distanceFor],
  );

  /** What the flat map is looking at, reported once it settles. */
  const handleMapView = useCallback(
    (next: Map2DView) => {
      // The map only reports once it has settled, so this is never mid-gesture.
      setMapView({
        lat: next.lat,
        lng: next.lng,
        spanKm: next.spanKm,
        distance: distanceFor(next.spanKm),
        local: true,
        moving: false,
      });
    },
    [distanceFor],
  );

  /** The frame loop is paused in map mode, so effects must not rely on `mode`. */
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /** Hand the camera back to the globe exactly where the flat map left it. */
  const showGlobe = useCallback(() => {
    handoffDismissed.current = true;
    const target = mapView;
    setMode("globe");
    if (!target) return;
    nonce.current += 1;
    setCommand({
      kind: "centre",
      lat: target.lat,
      lng: target.lng,
      distance: target.distance,
      nonce: nonce.current,
    });
  }, [mapView]);

  /* --- memory notifications ------------------------------------------- */
  const { current, cardShown, queued, focus, present, showNow, dismiss, markArrived } =
    useMemoryStream();

  /**
   * A new memory turns the globe toward it. In 2D mode the globe is paused, so
   * the flat map is what actually travels — the card and its photo still land.
   */
  const handledFocus = useRef(0);
  useEffect(() => {
    if (!focus || focus.nonce === handledFocus.current) return;
    handledFocus.current = focus.nonce;
    aim(focus.lat, focus.lng, 2.35);
    if (modeRef.current === "map") {
      showMap({ lat: focus.lat, lng: focus.lng, spanKm: 4 });
    }
  }, [aim, focus, showMap]);

  /* --- filters --------------------------------------------------------- */
  const [scope, setScope] = useState<GlobeScope>("all");
  const [tone, setTone] = useState<string>("any");
  const [memorySearch, setMemorySearch] = useState("");
  const [category, setCategory] = useState("all");

  /* --- real places ----------------------------------------------------- */
  const nearby = useNearbyPlaces({ view: effectiveView, category, enabled: true });
  const [searchResults, setSearchResults] = useState<PlaceSummary[]>([]);
  const [selected, setSelected] = useState<{
    id: string;
    fallback: PlaceSummary | null;
  } | null>(null);

  /* --- position -------------------------------------------------------- */
  const [currentLocation, setCurrentLocation] = useState<CurrentLocation>(null);
  const [locating, setLocating] = useState(false);
  /** Set only if the 3D frame loop throws: the flat map is still there. */
  const [globeError, setGlobeError] = useState<string | null>(null);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  /* --- chrome ---------------------------------------------------------- */
  const [autoSpin, setAutoSpin] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const memories = useMemo<MapPin[]>(() => pinRows ?? [], [pinRows]);

  const visible = useMemo(() => {
    const term = memorySearch.trim().toLowerCase();
    return memories.filter((pin) => {
      if (scope === "mine" && pin.userId !== user?._id) return false;
      if (tone !== "any" && pin.tone !== tone) return false;
      if (!term) return true;
      return `${pin.title} ${pin.placeName} ${pin.tags.join(" ")}`
        .toLowerCase()
        .includes(term);
    });
  }, [memories, memorySearch, scope, tone, user?._id]);

  const globePins = useMemo(
    () => visible.map((pin) => toGlobePin(pin, user?._id)),
    [user?._id, visible],
  );

  /** Nearby places, search hits and the open place all share one marker list. */
  const placeById = useMemo(() => {
    const map = new Map<string, PlaceSummary>();
    for (const place of [...nearby.rows, ...searchResults]) map.set(place.id, place);
    if (selected?.fallback) map.set(selected.fallback.id, selected.fallback);
    return map;
  }, [nearby.rows, searchResults, selected]);

  const globePlaces = useMemo(
    () =>
      Array.from(placeById.values()).map((place) => ({
        id: place.id,
        name: place.name,
        category: place.category,
        categoryLabel: place.categoryLabel,
        lat: place.lat,
        lng: place.lng,
        rating: place.rating,
        reviewCount: place.reviewCount,
        // `around` already gives us a distance from the queried centre, so the
        // marker list does not have to be rebuilt every time the camera moves.
        distanceKm: place.distanceKm ?? 0,
      })),
    [placeById],
  );

  /**
   * Progressive density: at regional zoom only dots, then names, then names,
   * categories and distances — the closest ones to whatever we are facing.
   */
  const labelLevel =
    effectiveView.spanKm <= 45 ? 3 : effectiveView.spanKm <= 130 ? 2 : 1;
  // Names are picked against a coarse centre: a drifting camera should not
  // reshuffle every label four times a second.
  const labelLat = Number(effectiveView.lat.toFixed(1));
  const labelLng = Number(effectiveView.lng.toFixed(1));
  const labelIds = useMemo(() => {
    if (labelLevel === 1) return [];
    const count = labelLevel === 3 ? 14 : 8;
    return [...globePlaces]
      .sort(
        (a, b) =>
          haversineKm(labelLat, labelLng, a.lat, a.lng) -
          haversineKm(labelLat, labelLng, b.lat, b.lng),
      )
      .slice(0, count)
      .map((place) => place.id);
  }, [globePlaces, labelLat, labelLevel, labelLng]);

  /**
   * Real places the person has a memory at. This is the one marker we promote:
   * "I have actually been here" beats any generic recommendation.
   */
  const promotedPlaceIds = useMemo(() => {
    const ids: string[] = [];
    for (const place of globePlaces) {
      for (const pin of visible) {
        if (haversineKm(place.lat, place.lng, pin.lat, pin.lng) * 1000 <= MEMORY_NEARBY_M) {
          ids.push(place.id);
          break;
        }
      }
    }
    return ids;
  }, [globePlaces, visible]);

  /** "You have been here" — a real memory close to the open place. */
  const memoryLink = useMemo<PlaceMemoryLink | null>(() => {
    const place = selected?.fallback;
    if (!place) return null;
    let best: { pin: MapPin; distanceM: number } | null = null;
    for (const pin of memories) {
      const distanceM = haversineKm(place.lat, place.lng, pin.lat, pin.lng) * 1000;
      if (distanceM > MEMORY_NEARBY_M) continue;
      if (!best || distanceM < best.distanceM) best = { pin, distanceM };
    }
    return best
      ? {
          id: best.pin._id,
          title: best.pin.title,
          happenedAt: best.pin.happenedAt,
          mediaUrl: best.pin.mediaUrl,
          distanceM: best.distanceM,
        }
      : null;
  }, [memories, selected]);

  const openDialog = useCallback((next: { lat: number; lng: number } | null = null) => {
    // With no point given, a new memory lands at the middle of whatever the
    // person is actually looking at — easier than asking them to click a spot.
    if (next) {
      setCoords(next);
    } else if (modeRef.current === "map" && mapView) {
      setCoords({ lat: mapView.lat, lng: mapView.lng });
    } else {
      setCoords(null);
    }
    setDialogOpen(true);
  }, [mapView]);

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

  const handlePinned = useCallback(
    (memory: PinnedMemory) => {
      present({ ...memory, fresh: true });
    },
    [present],
  );

  /** Open a real place: dismiss any memory card, then show its details. */
  const openPlace = useCallback(
    (place: PlaceSummary) => {
      dismiss();
      setSelected({ id: place.id, fallback: place });
      // Recentre only when the place is off to one side, so tapping a place
      // you can already see does not yank the camera around.
      if (modeRef.current === "map") {
        // The flat map flies there instead, keeping a neighbourhood-sized view.
        showMap({
          lat: place.lat,
          lng: place.lng,
          spanKm: Math.min(Math.max(effectiveView.spanKm, 1.5), 8),
        });
        return;
      }
      const angular = haversineKm(effectiveView.lat, effectiveView.lng, place.lat, place.lng);
      if (angular > Math.max(effectiveView.spanKm * 0.4, 3)) {
        aim(place.lat, place.lng, Math.min(effectiveView.distance, 1.12));
      }
    },
    [
      aim,
      dismiss,
      effectiveView.distance,
      effectiveView.lat,
      effectiveView.lng,
      effectiveView.spanKm,
      showMap,
    ],
  );

  /** One handler for both views: a marker's id becomes the open place panel. */
  const openPlaceById = useCallback(
    (id: string) => {
      const place = placeById.get(id);
      if (place) openPlace(place);
    },
    [openPlace, placeById],
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationNote("This browser will not share a location.");
      return;
    }
    setLocating(true);
    setLocationNote(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const fix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setCurrentLocation(fix);
        setLocating(false);
        setLocationNote(`Located at ${formatLatLng(fix.lat, fix.lng)}`);
        aim(fix.lat, fix.lng, 1.1);
      },
      () => {
        setLocating(false);
        setLocationNote("Location permission was denied. The globe stays yours to drive.");
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }, [aim]);

  const openMemory = useCallback((id: string) => navigate(`/m/${id}`), [navigate]);

  /**
   * Descend far enough and the flat map takes over on its own — that is the
   * whole point of it. Zooming back out (or choosing the globe yourself) hands
   * control straight back, so manual navigation is never taken away.
   */
  useEffect(() => {
    if (view.spanKm > GLOBE_RETURN_KM) handoffDismissed.current = false;
    if (mode !== "globe" || handoffDismissed.current) return;
    if (view.spanKm > MAP_HANDOFF_KM) return;
    showMap(view);
  }, [mode, showMap, view]);

  /* --- stage chrome ---------------------------------------------------- */
  const loading = pinRows === undefined;
  const empty = !loading && memories.length === 0;
  const showEmptyCard = empty && effectiveView.spanKm > PLACES_SPAN_KM;
  const scopes = nearby.config?.scopes ?? [];
  // Typed through PlaceSummary so a field the panel needs can never quietly
  // go missing from the serialised rows.
  const nearbyList: PlaceSummary[] = nearby.rows;

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
                    The living globe
                  </h1>
                  <span className="pm-chip">
                    {memories.length} {memories.length === 1 ? "memory" : "memories"} ·{" "}
                    {nearby.places.length} real places in view
                  </span>
                </div>
                <p className="mt-2.5 max-w-2xl text-sm leading-6 text-white/55">
                  Grab the Earth and take it anywhere: drag to spin, scroll or pinch to
                  zoom, double-click to dive toward a spot. As you descend into a city,
                  real Google places appear around you.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Globe or flat map: the same memories, two ways of seeing them. */}
                <div
                  role="group"
                  aria-label="View style"
                  className="pm-segmented flex items-center gap-1 p-1"
                >
                  {(
                    [
                      { key: "globe" as const, label: "3D globe", icon: Globe2 },
                      { key: "map" as const, label: "2D map", icon: MapIcon },
                    ]
                  ).map((option) => {
                    const Icon = option.icon;
                    const active = mode === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          option.key === "map" ? showMap(effectiveView) : showGlobe()
                        }
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-semibold transition-colors",
                          active
                            ? "bg-[#ff6a2c] text-white"
                            : "text-white/55 hover:text-white",
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden="true" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>

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

            <section className="relative min-h-[540px] flex-1 overflow-hidden rounded-[26px] border border-white/[0.07]">
              <div className="pm-stage-sky absolute inset-0" aria-hidden="true" />

              {/*
                The globe stays mounted even in 2D mode: the swap back is instant,
                the textures stay loaded, and the frame loop is simply stopped.
              */}
              <div
                className={cn("absolute inset-0", mode === "map" && "invisible")}
                aria-hidden={mode === "map"}
              >
                <StageBoundary
                  fallback={
                    <div className="grid h-full w-full place-items-center bg-[#07080c] px-8 text-center">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          The globe had to step aside
                        </p>
                        <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-white/50">
                          Your browser dropped the 3D view. Switch to the 2D map to keep
                          exploring, or reload the page to bring the globe back.
                        </p>
                      </div>
                    </div>
                  }
                >
                  <EarthGlobe
                    pins={globePins}
                    places={globePlaces}
                    labelIds={labelIds}
                    promotedPlaceIds={promotedPlaceIds}
                    activeId={current?._id ?? null}
                    activePlaceId={selected?.id ?? null}
                    justAddedId={current?.fresh ? current._id : null}
                    command={command}
                    currentLocation={currentLocation}
                    autoSpin={autoSpin}
                    paused={mode === "map"}
                    screenRef={screenRef}
                    hoverRef={hoverRef}
                    viewRef={viewSignal}
                    onFocusArrived={markArrived}
                    onOpenMemory={openMemory}
                    onOpenPlace={openPlaceById}
                    onPickLocation={(next) => openDialog(next)}
                    onError={setGlobeError}
                  />
                </StageBoundary>
              </div>

              {mode === "map" ? (
                <div className="absolute inset-0">
                  <PlaceMap2D
                    apiKey={nearby.config?.browserKey ?? null}
                    configReady={nearby.config !== undefined}
                    active
                    sync={mapSync}
                    pins={globePins}
                    places={globePlaces}
                    promotedIds={promotedPlaceIds}
                    activeMemoryId={current?._id ?? null}
                    activePlaceId={selected?.id ?? null}
                    currentLocation={currentLocation}
                    onView={handleMapView}
                    onOpenMemory={openMemory}
                    onOpenPlace={openPlaceById}
                  />
                </div>
              ) : null}

              <MemoryConnector
                screenRef={screenRef}
                cardRef={cardRef}
                active={cardShown && current !== null && !selected && mode === "globe"}
              />

              {/* Hover card for a memory marker: DOM, not inside the canvas. */}
              {mode === "globe" ? (
                <GlobeHoverCard hoverRef={hoverRef} pins={globePins} />
              ) : null}

              {/*
                One rail, not three floating cards: search, categories, the
                real places around here, the memory filters and the recent list
                all stack in a single column, so nothing can land on top of
                anything else.
              */}
              <div className="pointer-events-none absolute top-3 right-3 left-3 z-30 flex max-h-[58vh] flex-col gap-3 lg:top-4 lg:bottom-4 lg:left-4 lg:max-h-none lg:w-[400px] lg:right-auto">
                <div className="pm-panel pointer-events-auto flex min-h-0 flex-1 flex-col overflow-y-auto p-3 backdrop-blur-xl">
                  <PlaceSearch
                    view={effectiveView}
                    configured={nearby.configured}
                    results={searchResults}
                    onSelect={openPlace}
                    onResults={setSearchResults}
                    onClearResults={() => setSearchResults([])}
                    onLocate={(fix) => {
                      setCurrentLocation(fix);
                      setLocationNote(`Near me: ${formatLatLng(fix.lat, fix.lng)}`);
                    }}
                    onOpenPanel={openPlace}
                  />

                  {scopes.length > 0 ? (
                    <div className="mt-3">
                      <PlaceCategories
                        scopes={scopes}
                        value={category}
                        onChange={setCategory}
                        loading={nearby.loading}
                      />
                    </div>
                  ) : null}

                  {scopes.length > 0 ? (
                    <div className="mt-3 border-t border-white/[0.07] pt-3">
                      <p className="mb-2 text-[10px] font-bold tracking-[0.18em] text-white/40 uppercase">
                        Nearby
                      </p>
                      <NearbyPlaces
                        places={nearbyList}
                        activeId={selected?.id ?? null}
                        loading={nearby.loading}
                        configured={nearby.configured}
                        withinRange={nearby.withinRange}
                        error={nearby.error}
                        onSelect={openPlace}
                      />
                    </div>
                  ) : null}

                  <div className="mt-3 border-t border-white/[0.07] pt-3">
                    <GlobeFilters
                      search={memorySearch}
                      onSearch={setMemorySearch}
                      scope={scope}
                      onScope={setScope}
                      tone={tone}
                      onTone={setTone}
                      shown={globePins.length}
                      total={memories.length}
                    />
                  </div>

                  <div className="mt-3 border-t border-white/[0.07] pt-3">
                    <ViewChip
                      view={effectiveView}
                      memories={globePins.length}
                      places={globePlaces.length}
                    />
                    {locationNote ? (
                      <p className="mt-2 text-[11px] leading-5 text-white/45">
                        {locationNote}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* The recent list lives in the same column, so it cannot
                    sit on top of the search and filters. */}
                <div className="pointer-events-auto hidden min-h-0 max-h-[36%] shrink-0 overflow-y-auto lg:block">
                  <RecentMemories
                    pins={globePins}
                    activeId={current?._id ?? null}
                    onSelect={flyTo}
                    onAdd={() => openDialog()}
                  />
                </div>
              </div>

              {/* Manual navigation, out of the way of the panel and the rail. */}
              {mode === "globe" ? (
                <NavigationControls
                  onZoomIn={() => zoomBy(0.72)}
                  onZoomOut={() => zoomBy(1.38)}
                  onReset={resetView}
                  onLocate={locate}
                  locating={locating}
                  autoSpin={autoSpin}
                  onToggleAutoSpin={() => setAutoSpin((value) => !value)}
                  className="absolute right-3 bottom-20 z-30 lg:right-4 lg:bottom-4"
                />
              ) : (
                <button
                  type="button"
                  onClick={showGlobe}
                  className="pm-panel absolute right-3 bottom-20 z-30 flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-semibold text-white/80 backdrop-blur-xl transition-colors hover:text-white lg:right-4 lg:bottom-4"
                >
                  <Globe2 className="size-3.5 text-[#ff6a2c]" aria-hidden="true" />
                  Back to globe
                </button>
              )}

              <div
                className={cn(
                  "absolute inset-x-3 bottom-3 z-30 lg:hidden",
                  (showEmptyCard || (cardShown && current !== null)) && "hidden",
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

              {showEmptyCard ? (
                <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center p-6 pt-40 lg:pt-6">
                  <div className="pm-panel pointer-events-auto max-w-sm p-6 text-center backdrop-blur-xl">
                    <span className="mx-auto grid size-12 place-items-center rounded-full bg-[#ff6a2c]/15 text-[#ff8a4d]">
                      <MapPin className="size-5" aria-hidden="true" />
                    </span>
                    <h2 className="mt-4 text-lg font-bold tracking-[-0.01em] text-white">
                      Nothing pinned yet
                    </h2>
                    <p className="mt-2 text-[13px] leading-6 text-white/55">
                      Zoom in anywhere to meet real places, or pin the first memory of your
                      own — the Earth will fly straight to it.
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

              {globeError && mode === "globe" ? (
                <div className="absolute inset-x-3 bottom-3 z-40 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#141419]/96 px-4 py-3 text-center backdrop-blur-xl lg:inset-x-auto lg:right-4 lg:bottom-4 lg:left-auto lg:max-w-sm lg:text-left">
                  <p className="text-[12px] leading-5 text-white/70">
                    The 3D view stopped — your browser dropped the render loop.
                  </p>
                  <button
                    type="button"
                    onClick={() => showMap(effectiveView)}
                    className="rounded-full bg-[#ff6a2c] px-3.5 py-1.5 text-[12px] font-semibold text-white"
                  >
                    Use the 2D map
                  </button>
                </div>
              ) : null}

              {mode === "map" ? (
                <p className="pointer-events-none absolute bottom-4 left-1/2 z-30 hidden -translate-x-1/2 text-[11px] font-medium text-white/40 lg:block">
                  Streets, labels and real places from Google Maps · your pins sit on top
                </p>
              ) : null}

              {!showEmptyCard && nearby.withinRange && !nearby.configured ? (
                <p className="pointer-events-none absolute bottom-4 left-1/2 z-30 hidden -translate-x-1/2 text-[11px] font-medium text-white/40 lg:block">
                  <Globe2 className="mr-1.5 inline size-3.5 text-[#ff6a2c]" aria-hidden="true" />
                  Add a Google Maps key to light up real places around this view.
                </p>
              ) : null}

              <MemoryNotification
                memory={current}
                shown={cardShown && !selected}
                queued={queued}
                onDismiss={dismiss}
                cardRef={cardRef}
              />

              <PlacePanel
                placeId={selected?.id ?? null}
                fallback={selected?.fallback ?? null}
                memory={memoryLink}
                photoBase={nearby.config?.photoBase ?? null}
                onClose={() => setSelected(null)}
                onCentre={(place) => aim(place.lat, place.lng, Math.min(view.distance, 1.1))}
                onPinMemory={(place) => openDialog({ lat: place.lat, lng: place.lng })}
                onShowSaved={(memoryId) => navigate(`/m/${memoryId}`)}
              />
            </section>

            <p className="mt-4 text-[11px] leading-5 text-white/35">
              Every point keeps its real latitude and longitude. Real places come from
              Google Maps Platform and are cached as you explore, so panning the globe
              stays fast.
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
