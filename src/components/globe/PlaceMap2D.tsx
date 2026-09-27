import { toneMeta } from "@/components/pulsemap/tone";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobePin } from "./Markers";
import type { GlobePlace } from "./PlaceMarkers";
import { placeVisual } from "./place-categories";

/**
 * The flat view of wherever the globe has descended to.
 *
 * A globe is the right shape for a travel journal and the wrong shape for
 * looking at a city: past a few hundred kilometres the satellite texture has no
 * streets on it at all. So once the camera gets low, this takes over — a real
 * Google map of that exact place, with the same memories and the same real
 * places drawn on it, and its own deep zoom.
 *
 * The JavaScript API is loaded once, on demand, and only when this view is
 * actually shown. Street names, districts and coastlines come from Google; so
 * do the places, through our own server-side cache. Nothing is scraped.
 */

/* --- Loading the API ------------------------------------------------ */

type MapsApi = {
  Map: new (node: HTMLElement, options: Record<string, unknown>) => MapsMap;
  OverlayView: new () => MapsOverlay;
  LatLng: new (lat: number, lng: number) => unknown;
};

type MapsMap = {
  getCenter: () => { lat: () => number; lng: () => number } | null;
  getZoom: () => number | undefined;
  getDiv: () => HTMLElement;
  setCenter: (value: unknown) => void;
  setZoom: (value: number) => void;
  setMapTypeId: (value: string) => void;
  addListener: (event: string, handler: () => void) => unknown;
  panTo: (value: unknown) => void;
};

type MapsOverlay = {
  setMap: (map: MapsMap | null) => void;
  getPanes: () => { overlayMouseTarget: HTMLElement } | null;
  getProjection: () => {
    fromLatLngToDivPixel: (value: unknown) => { x: number; y: number } | null;
  } | null;
  position: unknown;
};

let apiPromise: Promise<MapsApi> | null = null;

function loadMaps(apiKey: string): Promise<MapsApi> {
  const holder = window as unknown as {
    google?: { maps?: MapsApi };
    __pulsemapMapsReady?: () => void;
  };
  const ready = holder.google?.maps;
  if (ready?.Map) return Promise.resolve(ready);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<MapsApi>((resolve, reject) => {
    holder.__pulsemapMapsReady = () => {
      const maps = holder.google?.maps;
      if (maps?.Map) resolve(maps);
      else reject(new Error("Google Maps loaded but is not usable."));
    };

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&v=weekly&loading=async&callback=__pulsemapMapsReady`;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("Google Maps could not be downloaded."));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

/* --- Marker placement ----------------------------------------------- */

/** Full styling for a map we do not own: muted ground, quiet labels, dark water. */
const DARK_STYLE: Record<string, unknown>[] = [
  { elementType: "geometry", stylers: [{ color: "#16171b" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9aa0ab" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f0f11" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#2c2e34" }] },
  { featureType: "administrative.country", elementType: "labels", stylers: [{ visibility: "on" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#1b1c21" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ color: "#8d8f98" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#17231c" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#26282e" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#33363d" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#7d838e" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#22242a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0c1420" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4b5a70" }] },
];

/** Web Mercator: metres of ground per screen pixel, at a latitude and zoom. */
function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** The zoom that shows roughly `spanKm` of ground in half the map's height. */
export function zoomForSpan(spanKm: number, lat: number, height: number): number {
  const half = Math.max(height / 2, 1);
  const wanted = (Math.max(spanKm, 0.01) * 1000) / half;
  const zoom = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / wanted);
  return Math.min(21, Math.max(1, zoom));
}

type MarkerSpec = {
  key: string;
  lat: number;
  lng: number;
  /** Built lazily: a marker that is already on the map is never rebuilt. */
  make: () => HTMLElement;
};

/** Places DOM markers on a Google map, reusing elements between renders. */
class MarkerLayer {
  private entries = new Map<string, { overlay: MapsOverlay; el: HTMLElement }>();
  private latLngClass: new (lat: number, lng: number) => unknown;
  private maps: MapsApi;
  private map: MapsMap;

  constructor(maps: MapsApi, map: MapsMap) {
    this.maps = maps;
    this.map = map;
    this.latLngClass = maps.LatLng;
  }

  sync(specs: MarkerSpec[]) {
    const wanted = new Set(specs.map((spec) => spec.key));

    for (const [key, entry] of this.entries) {
      if (!wanted.has(key)) {
        entry.overlay.setMap(null);
        entry.el.remove();
        this.entries.delete(key);
      }
    }

    for (const spec of specs) {
      const position = new this.latLngClass(spec.lat, spec.lng);
      const existing = this.entries.get(spec.key);
      if (existing) {
        existing.overlay.position = position;
        continue;
      }

      const Overlay = this.maps.OverlayView;
      const element = spec.make();
      class Marker extends Overlay {
        onAdd() {
          const panes = this.getPanes();
          panes?.overlayMouseTarget.appendChild(element);
        }
        draw() {
          const point = this.getProjection()?.fromLatLngToDivPixel(this.position);
          if (!point) return;
          element.style.transform = `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`;
        }
        onRemove() {
          element.remove();
        }
      }

      const overlay = new Marker();
      overlay.position = position;
      overlay.setMap(this.map);
      this.entries.set(spec.key, { overlay, el: element });
    }
  }

  clear() {
    for (const entry of this.entries.values()) {
      entry.overlay.setMap(null);
      entry.el.remove();
    }
    this.entries.clear();
  }
}

/* --- Marker elements ------------------------------------------------ */

function memoryElement(pin: GlobePin, active: boolean, onOpen: () => void) {
  const meta = toneMeta(pin.tone);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pm-map-marker pm-map-marker--memory${active ? " is-active" : ""}`;
  button.title = pin.placeName ? `${pin.title} — ${pin.placeName}` : pin.title;
  button.style.borderColor = meta.hex;

  if (pin.mediaUrl) {
    const image = document.createElement("img");
    image.src = pin.mediaUrl;
    image.alt = "";
    image.loading = "lazy";
    button.appendChild(image);
  } else {
    const dot = document.createElement("span");
    dot.className = "pm-map-marker__dot";
    dot.style.background = meta.hex;
    button.appendChild(dot);
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onOpen();
  });
  return button;
}

function placeElement(place: GlobePlace, active: boolean, promoted: boolean, onOpen: () => void) {
  const visual = placeVisual(place.category);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pm-map-marker pm-map-marker--place${
    active ? " is-active" : ""
  }${promoted ? " is-promoted" : ""}`;
  button.style.setProperty("--marker-color", visual.color);
  button.title = place.name;

  const glyph = document.createElement("span");
  glyph.className = "pm-map-marker__glyph";
  glyph.textContent = visual.glyph;
  button.appendChild(glyph);

  if (promoted || active) {
    const label = document.createElement("span");
    label.className = "pm-map-marker__label";
    label.textContent = promoted ? `✦ ${place.name}` : place.name;
    button.appendChild(label);
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onOpen();
  });
  return button;
}

function locationElement() {
  const dot = document.createElement("span");
  dot.className = "pm-map-marker pm-map-marker--me";
  dot.title = "Your location";
  return dot;
}

/* --- The component -------------------------------------------------- */

export type Map2DView = { lat: number; lng: number; spanKm: number; zoom: number };

/** Where the map should jump to, and a nonce so a repeat jump still happens. */
export type Map2DSync = { lat: number; lng: number; spanKm: number; nonce: number };

export function PlaceMap2D({
  apiKey,
  configReady,
  active,
  sync,
  pins,
  places,
  promotedIds,
  activeMemoryId,
  activePlaceId,
  currentLocation,
  onView,
  onOpenMemory,
  onOpenPlace,
}: {
  apiKey: string | null;
  /** False until the server has told us whether a key exists at all. */
  configReady: boolean;
  /** False while the globe is on screen: the map is kept but not drawing. */
  active: boolean;
  sync: Map2DSync;
  pins: GlobePin[];
  places: GlobePlace[];
  promotedIds: string[];
  activeMemoryId: string | null;
  activePlaceId: string | null;
  currentLocation: { lat: number; lng: number } | null;
  onView: (view: Map2DView) => void;
  onOpenMemory: (id: string) => void;
  onOpenPlace: (id: string) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const layerRef = useRef<MarkerLayer | null>(null);
  const mapsRef = useRef<MapsApi | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [mapType, setMapType] = useState<"roadmap" | "hybrid">("roadmap");

  const syncRef = useRef(sync);
  const viewRef = useRef(onView);
  const lastSync = useRef<number>(sync.nonce);

  useEffect(() => {
    syncRef.current = sync;
    viewRef.current = onView;
  }, [onView, sync]);

  /* Load the API, then build the map once. */
  useEffect(() => {
    if (!apiKey || !nodeRef.current) return;
    let cancelled = false;

    loadMaps(apiKey)
      .then((maps) => {
        if (cancelled || !nodeRef.current || mapRef.current) return;
        mapsRef.current = maps;
        const height = nodeRef.current.clientHeight || 600;
        const map = new maps.Map(nodeRef.current, {
          center: { lat: syncRef.current.lat, lng: syncRef.current.lng },
          zoom: zoomForSpan(syncRef.current.spanKm, syncRef.current.lat, height),
          mapTypeId: "roadmap",
          styles: DARK_STYLE,
          // Our own real places are the points of interest here.
          clickableIcons: false,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          keyboardShortcuts: false,
          backgroundColor: "#0f0f11",
        });
        mapRef.current = map;
        layerRef.current = new MarkerLayer(maps, map);
        setReady(true);
      })
      .catch((error: Error) => {
        if (!cancelled) setFailure(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  /* A bad key surfaces through this hook rather than a stack trace. */
  useEffect(() => {
    const holder = window as unknown as { gm_authFailure?: () => void };
    const previous = holder.gm_authFailure;
    holder.gm_authFailure = () => {
      setFailure(
        "Google rejected the map key. Enable Maps JavaScript API and allow this site's referrers.",
      );
      previous?.();
    };
    return () => {
      holder.gm_authFailure = previous;
    };
  }, []);

  /* Report the settled camera upward: no requests while the map is moving. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const report = () => {
      const centre = map.getCenter();
      if (!centre) return;
      const lat = centre.lat();
      const lng = centre.lng();
      const zoom = map.getZoom() ?? 3;
      const height = map.getDiv().clientHeight || 600;
      viewRef.current({
        lat,
        lng,
        zoom,
        spanKm: Math.max(0.02, ((height / 2) * metresPerPixel(lat, zoom)) / 1000),
      });
    };
    const listeners = [map.addListener("idle", report), map.addListener("dragend", report)];
    // The first report matters too: the UI should know where the map opened.
    report();
    return () => {
      for (const listener of listeners) {
        (listener as { remove?: () => void })?.remove?.();
      }
    };
  }, [ready]);

  /* Jumping in from the globe, or from a place the person picked. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || sync.nonce === lastSync.current) return;
    lastSync.current = sync.nonce;
    const height = map.getDiv().clientHeight || 600;
    map.setCenter({ lat: sync.lat, lng: sync.lng });
    map.setZoom(zoomForSpan(sync.spanKm, sync.lat, height));
  }, [ready, sync]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setMapTypeId(mapType);
  }, [mapType, ready]);

  /* Keep the marker layer in step with the data. */
  const promoted = useMemo(() => new Set(promotedIds), [promotedIds]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !ready) return;

    const specs: MarkerSpec[] = [
      ...pins.map((pin) => {
        const isActive = pin.id === activeMemoryId;
        return {
          key: `m:${pin.id}:${isActive ? "a" : "-"}`,
          lat: pin.lat,
          lng: pin.lng,
          make: () => memoryElement(pin, isActive, () => onOpenMemory(pin.id)),
        };
      }),
      ...places.map((place) => {
        const isActive = place.id === activePlaceId;
        const isPromoted = promoted.has(place.id);
        return {
          key: `p:${place.id}:${isActive ? "a" : "-"}:${isPromoted ? "p" : "-"}`,
          lat: place.lat,
          lng: place.lng,
          make: () => placeElement(place, isActive, isPromoted, () => onOpenPlace(place.id)),
        };
      }),
    ];

    if (currentLocation) {
      specs.push({
        key: "me",
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        make: locationElement,
      });
    }

    layer.sync(specs);
  }, [
    activeMemoryId,
    activePlaceId,
    currentLocation,
    onOpenMemory,
    onOpenPlace,
    pins,
    places,
    promoted,
    ready,
  ]);

  useEffect(() => {
    const layer = layerRef.current;
    return () => layer?.clear();
  }, []);

  return (
    <div className="pm-map-shell" data-active={active}>
      <div ref={nodeRef} className="pm-map-canvas" />

      {failure ? (
        <div className="pm-map-note">
          <p className="font-semibold text-white">The 2D map is unavailable</p>
          <p className="mt-1.5 leading-5 text-white/60">{failure}</p>
        </div>
      ) : null}

      {configReady && !apiKey ? (
        <div className="pm-map-note">
          <p className="font-semibold text-white">2D maps need a browser key</p>
          <p className="mt-1.5 leading-5 text-white/60">
            Add <strong>GOOGLE_MAPS_BROWSER_KEY</strong> (a Maps JavaScript API key
            restricted to this site) in the Keys tab. Places, search and memory pins
            keep working without it.
          </p>
        </div>
      ) : null}

      {ready && !failure ? (
        <div className="pm-map-types">
          {(["roadmap", "hybrid"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setMapType(type)}
              aria-pressed={mapType === type}
              className="pm-map-type"
            >
              {type === "roadmap" ? "Map" : "Satellite"}
            </button>
          ))}
        </div>
      ) : null}

      {/* Google's own attribution and logo are drawn by the API itself. */}
    </div>
  );
}
