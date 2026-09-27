import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { toneMeta } from "./tone";

export type MapPin = {
  id: string;
  title: string;
  placeName: string;
  lat: number;
  lng: number;
  tone: string;
  mediaUrl?: string | null;
};

const MOSTAR: [number, number] = [43.3373, 17.8149];

export function MemoryMap({
  pins,
  activeId = null,
  onSelect,
  onPick,
  picked = null,
  center,
  zoom = 13,
  className,
}: {
  pins: MapPin[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  onPick?: (coords: { lat: number; lng: number }) => void;
  picked?: { lat: number; lng: number } | null;
  center?: [number, number];
  zoom?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinLayerRef = useRef<L.LayerGroup | null>(null);
  const pickMarkerRef = useRef<L.Marker | null>(null);

  const onSelectRef = useRef(onSelect);
  const onPickRef = useRef(onPick);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onPickRef.current = onPick;
  }, [onSelect, onPick]);

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: center ?? MOSTAR,
      zoom,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    map.on("click", (event: L.LeafletMouseEvent) => {
      onPickRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng });
    });

    pinLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const timer = window.setTimeout(() => map.invalidateSize(), 150);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      pinLayerRef.current = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (container as any)._leaflet_id;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw pins whenever the data or the selection changes.
  useEffect(() => {
    const layer = pinLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    pins.forEach((pin) => {
      const meta = toneMeta(pin.tone);
      const active = pin.id === activeId;
      const marker = L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({
          className: "pulse-pin-wrap",
          html: `<div class="pulse-pin${active ? " pulse-pin--active" : ""}" style="background:${meta.hex}">•</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        title: `${pin.title} — ${pin.placeName}`,
      });
      marker.on("click", () => onSelectRef.current?.(pin.id));
      layer.addLayer(marker);
    });
  }, [pins, activeId]);

  // Marker for a location that is being chosen right now.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pickMarkerRef.current) {
      pickMarkerRef.current.remove();
      pickMarkerRef.current = null;
    }
    if (!picked) return;
    pickMarkerRef.current = L.marker([picked.lat, picked.lng], {
      icon: L.divIcon({
        className: "pulse-pin-wrap",
        html: '<div class="pulse-pin pulse-pin--active" style="background:#17170f">+</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    }).addTo(map);
  }, [picked]);

  return (
    <div
      id="pulse-map"
      ref={containerRef}
      className={cn("h-[420px] w-full border border-[var(--rule)]", className)}
      aria-label="Map of pinned memories"
    />
  );
}
