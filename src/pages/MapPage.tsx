import { PulseShell, SectionHeading } from "@/components/pulsemap/AppShell";
import { MemoryMap } from "@/components/pulsemap/MemoryMap";
import { PinMemoryDialog } from "@/components/pulsemap/PinMemoryDialog";
import { TONES, TONE_META, formatDate, toneMeta } from "@/components/pulsemap/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { MapPin, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

export default function MapPage() {
  const { user } = useAuth();
  const pins = useQuery(api.memories.mapPins);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [tone, setTone] = useState<string>("any");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (pins ?? []).filter((pin) => {
      if (scope === "mine" && pin.userId !== user?._id) return false;
      if (tone !== "any" && pin.tone !== tone) return false;
      if (term) {
        const haystack = `${pin.title} ${pin.placeName} ${pin.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [pins, scope, search, tone, user?._id]);

  const mapPins = useMemo(
    () =>
      filtered.map((pin) => ({
        id: pin._id,
        title: pin.title,
        placeName: pin.placeName,
        lat: pin.lat,
        lng: pin.lng,
        tone: pin.tone,
        mediaUrl: pin.mediaUrl,
      })),
    [filtered],
  );

  const selected = (pins ?? []).find((pin) => pin._id === selectedId) ?? null;

  function pickLocation(next: { lat: number; lng: number }) {
    setCoords(next);
    setDialogOpen(true);
  }

  return (
    <PulseShell
      eyebrow="Live map"
      title="Everything you have pinned"
      description="Click anywhere on the map to drop a new pin at that exact point. Pins update live: a memory added on your phone appears here without a refresh."
      actions={
        <Button
          type="button"
          className="gap-2"
          onClick={() => {
            setCoords(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Pin a memory
        </Button>
      }
    >
      <div className="grid gap-8 lg:grid-cols-[1.7fr_1fr]">
        <div>
          <MemoryMap
            pins={mapPins}
            activeId={selectedId}
            onSelect={setSelectedId}
            onPick={pickLocation}
            picked={coords}
            className="h-[480px] lg:h-[620px]"
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Scroll is locked over the map so the page keeps its own rhythm. Use the zoom
            controls on the left, and click once to place a pin.
          </p>
        </div>

        <div>
          <SectionHeading label={`${filtered.length} pins shown`} title="Filters" />

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="micro-label" htmlFor="pin-search">
                Search
              </label>
              <div className="relative">
                <Search
                  className="absolute top-3 left-3 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="pin-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Title, place or tag"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="micro-label">Who pinned it</span>
              <Select value={scope} onValueChange={(value) => setScope(value as "all" | "mine")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone visible to me</SelectItem>
                  <SelectItem value="mine">Only mine</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <span className="micro-label">Tone</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTone("any")}
                  className={cn(
                    "border px-3 py-1 text-xs",
                    tone === "any"
                      ? "border-[var(--foreground)] bg-[var(--foreground)] text-background"
                      : "border-[var(--rule)] text-muted-foreground",
                  )}
                >
                  Any
                </button>
                {TONES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setTone(name)}
                    className={cn(
                      "flex items-center gap-2 border px-3 py-1 text-xs",
                      tone === name
                        ? "border-[var(--foreground)]"
                        : "border-[var(--rule)] text-muted-foreground",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full"
                      style={{ background: TONE_META[name].hex }}
                    />
                    {TONE_META[name].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {selected ? (
            <div className="mt-8 border border-[var(--foreground)] bg-card">
              <div
                aria-hidden="true"
                className="h-[3px]"
                style={{ background: toneMeta(selected.tone).hex }}
              />
              <div className="px-5 py-4">
                <p className="micro-label">{formatDate(selected.happenedAt)}</p>
                <h3 className="font-display mt-3 text-2xl leading-tight">
                  {selected.title}
                </h3>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {selected.placeName}
                </p>
                <p className="mt-3 line-clamp-4 text-sm leading-6 text-muted-foreground">
                  {selected.note}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {selected.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="rounded-none">
                      {tag}
                    </Badge>
                  ))}
                  <Link
                    to={`/m/${selected._id}`}
                    className="ml-auto text-sm underline decoration-[var(--rule-strong)] underline-offset-4"
                  >
                    Open memory
                  </Link>
                </div>
              </div>
            </div>
          ) : null}

          <ul className="hairline-grid mt-8 max-h-[420px] overflow-y-auto border border-[var(--rule)] bg-card">
            {filtered.length === 0 ? (
              <li className="px-5 py-10 text-center text-sm text-muted-foreground">
                No pins match these filters yet.
              </li>
            ) : (
              filtered.slice(0, 60).map((pin) => (
                <li key={pin._id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(pin._id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-[var(--muted)]",
                      pin._id === selectedId && "bg-[var(--muted)]",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-2.5 shrink-0 rounded-full"
                      style={{ background: toneMeta(pin.tone).hex }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{pin.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {pin.placeName} · {formatDate(pin.happenedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <PinMemoryDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setCoords(null);
        }}
        coords={coords}
      />
    </PulseShell>
  );
}
