import { PulseShell } from "@/components/pulsemap/AppShell";
import { MemoryCard } from "@/components/pulsemap/MemoryCard";
import { Segmented } from "@/components/dashboard/charts";
import { TONES, TONE_META, formatDuration, formatMoney, toneMeta } from "@/components/pulsemap/tone";
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
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Clock, MapPin, Search, Star } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

const VIEWS = [
  { value: "trails", label: "Guided trails" },
  { value: "memories", label: "Public memories" },
] as const;

type ExploreView = (typeof VIEWS)[number]["value"];

function toneChipClass(active: boolean) {
  return cn(
    "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
    active
      ? "border-[#ff6a2c] bg-[#ff6a2c] text-white"
      : "border-white/12 text-white/55 hover:border-white/25 hover:text-white",
  );
}

export default function Explore() {
  const [view, setView] = useState<ExploreView>("trails");
  const [search, setSearch] = useState("");
  const [tone, setTone] = useState<string>("any");
  const [city, setCity] = useState<string>("any");

  const term = search.trim();
  const memories = useQuery(
    api.memories.catalog,
    view === "memories"
      ? {
          search: term || undefined,
          tone:
            tone === "any"
              ? undefined
              : (tone as "quiet" | "golden" | "bright" | "storm" | "night"),
        }
      : "skip",
  );
  const trails = useQuery(
    api.experiences.list,
    view === "trails"
      ? { search: term || undefined, city: city === "any" ? undefined : city }
      : "skip",
  );
  const cities = useQuery(api.experiences.cities);

  return (
    <PulseShell
      eyebrow="Catalogue"
      title="Browse and search the map"
      description="Public memories are the living half of Pulsemap. The trails are curated routes you can book a guide for, then keep every pin you collect along the way."
    >
      <div className="pm-panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="absolute top-3.5 left-3.5 size-4 text-white/35"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              view === "trails"
                ? "Search trails, e.g. bridge or springs"
                : "Search memories, e.g. copper or rain"
            }
            className="h-11 rounded-full pl-10"
            aria-label="Search the catalogue"
          />
        </div>
        {view === "trails" ? (
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="h-11 w-full rounded-full sm:w-52">
              <SelectValue placeholder="Every city" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Every city</SelectItem>
              {(cities ?? []).map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTone("any")}
              className={toneChipClass(tone === "any")}
            >
              Any tone
            </button>
            {TONES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setTone(name)}
                className={toneChipClass(tone === name)}
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
        )}
      </div>

      <div className="mt-6 max-w-sm">
        <Segmented options={VIEWS} value={view} onChange={setView} label="Catalogue view" />
      </div>

      {view === "trails" ? (
        <div className="mt-7">
          {(trails ?? []).length === 0 ? (
            <EmptyState
              title="No trails match that search"
              body="The catalogue is seeded from the dashboard. Load the starter content and five guided walks appear here."
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {(trails ?? []).map((trail) => {
                const meta = toneMeta(trail.tone);
                return (
                  <article
                    key={trail._id}
                    className="pm-panel pm-panel-link flex flex-col overflow-hidden"
                  >
                    <div
                      className="relative h-44"
                      style={{
                        background: `linear-gradient(180deg, ${meta.hex}33 0%, ${meta.hex}66 100%)`,
                      }}
                    >
                      <img
                        src={trail.imageUrl}
                        alt=""
                        className="absolute bottom-0 left-1/2 h-[92%] w-auto max-w-none -translate-x-1/2 object-contain"
                        loading="lazy"
                      />
                      <span
                        className="absolute top-4 left-4 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-white uppercase"
                        style={{ background: meta.hex }}
                      >
                        {trail.city}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col gap-3 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="pm-chip">Guided trail</span>
                        <span className="flex items-center gap-1 text-xs text-white/45">
                          <Star className="size-3.5 text-[#ff6a2c]" aria-hidden="true" />
                          {trail.rating.toFixed(1)} · {trail.reviewCount}
                        </span>
                      </div>

                      <h3 className="text-[1.2rem] leading-snug font-bold tracking-[-0.015em] text-white">
                        <Link to={`/trails/${trail.slug}`} className="hover:text-[#ff6a2c]">
                          {trail.title}
                        </Link>
                      </h3>

                      <p className="line-clamp-3 text-[13px] leading-6 text-white/55">
                        {trail.summary}
                      </p>

                      <div className="mt-auto flex items-end justify-between gap-4 border-t border-white/[0.07] pt-4">
                        <div className="text-xs text-white/45">
                          <p className="flex items-center gap-1.5">
                            <Clock className="size-3.5" aria-hidden="true" />
                            {formatDuration(trail.durationMinutes)}
                          </p>
                          <p className="mt-1 flex items-center gap-1.5">
                            <MapPin className="size-3.5" aria-hidden="true" />
                            {trail.guide}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl leading-none font-bold text-white tabular-nums">
                            {formatMoney(trail.priceCents, trail.currency)}
                          </p>
                          <p className="pm-metric-unit mt-1.5">per person</p>
                        </div>
                      </div>

                      <Button asChild className="h-11 w-full rounded-full font-semibold">
                        <Link to={`/trails/${trail.slug}`}>Book this trail</Link>
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {view === "memories" ? (
        <div className="mt-7">
          {(memories ?? []).length === 0 ? (
            <EmptyState
              title="No public memories match yet"
              body="Search by title, or clear the filters. Memories marked private never appear in this catalogue."
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {(memories ?? []).map((memory) => (
                <MemoryCard key={memory._id} memory={memory} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </PulseShell>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="pm-panel border-dashed px-6 py-16 text-center">
      <h3 className="text-xl font-bold tracking-[-0.015em] text-white">{title}</h3>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/50">{body}</p>
    </div>
  );
}
