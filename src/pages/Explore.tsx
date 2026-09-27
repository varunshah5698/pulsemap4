import { PulseShell } from "@/components/pulsemap/AppShell";
import { MemoryCard } from "@/components/pulsemap/MemoryCard";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Clock, MapPin, Search, Star } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

export default function Explore() {
  const [tab, setTab] = useState("trails");
  const [search, setSearch] = useState("");
  const [tone, setTone] = useState<string>("any");
  const [city, setCity] = useState<string>("any");

  const term = search.trim();
  const memories = useQuery(
    api.memories.catalog,
    tab === "memories"
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
    tab === "trails"
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
      <div className="flex flex-col gap-4 border border-[var(--rule)] bg-card p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="absolute top-3 left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              tab === "trails"
                ? "Search trails, e.g. bridge or springs"
                : "Search memories, e.g. copper or rain"
            }
            className="pl-9"
            aria-label="Search the catalogue"
          />
        </div>
        {tab === "trails" ? (
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="w-full sm:w-52">
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
              className={cn(
                "border px-3 py-1.5 text-xs",
                tone === "any"
                  ? "border-[var(--foreground)] bg-[var(--foreground)] text-background"
                  : "border-[var(--rule)] text-muted-foreground",
              )}
            >
              Any tone
            </button>
            {TONES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setTone(name)}
                className={cn(
                  "flex items-center gap-2 border px-3 py-1.5 text-xs",
                  tone === name ? "border-[var(--foreground)]" : "border-[var(--rule)]",
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
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList className="rounded-none border border-[var(--rule)] bg-card">
          <TabsTrigger value="trails" className="rounded-none">
            Guided trails
          </TabsTrigger>
          <TabsTrigger value="memories" className="rounded-none">
            Public memories
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trails" className="mt-6">
          {(trails ?? []).length === 0 ? (
            <EmptyState
              title="No trails match that search"
              body="The catalogue is seeded from the dashboard. Load the starter content and five guided walks appear here."
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {(trails ?? []).map((trail) => {
                const meta = toneMeta(trail.tone);
                return (
                  <article
                    key={trail._id}
                    className="flex flex-col border border-[var(--rule)] bg-card transition-shadow hover:shadow-[0_14px_32px_rgba(23,23,15,0.12)]"
                  >
                    <div
                      className="relative h-44 overflow-hidden border-b border-[var(--rule)]"
                      style={{
                        background: `linear-gradient(180deg, ${meta.hex}22 0%, ${meta.hex}44 100%)`,
                      }}
                    >
                      <img
                        src={trail.imageUrl}
                        alt=""
                        className="absolute bottom-0 left-1/2 h-[92%] w-auto max-w-none -translate-x-1/2 object-contain"
                        loading="lazy"
                      />
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-[3px]"
                        style={{ background: meta.hex }}
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-3 px-5 py-5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="micro-label" style={{ color: meta.hex }}>
                          {trail.city}
                        </p>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Star className="size-3.5" aria-hidden="true" />
                          {trail.rating.toFixed(1)} · {trail.reviewCount}
                        </span>
                      </div>
                      <h3 className="font-display text-2xl leading-[1.08]">
                        <Link to={`/trails/${trail.slug}`} className="hover:underline">
                          {trail.title}
                        </Link>
                      </h3>
                      <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                        {trail.summary}
                      </p>
                      <div className="mt-auto flex items-end justify-between gap-4 border-t border-[var(--rule)] pt-4">
                        <div className="text-xs text-muted-foreground">
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
                          <p className="font-display text-2xl leading-none">
                            {formatMoney(trail.priceCents, trail.currency)}
                          </p>
                          <p className="micro-label mt-1">per person</p>
                        </div>
                      </div>
                      <Button className="w-full rounded-sm" asChild>
                        <Link to={`/trails/${trail.slug}`}>Book this trail</Link>
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="memories" className="mt-6">
          {(memories ?? []).length === 0 ? (
            <EmptyState
              title="No public memories match yet"
              body="Search by title, or clear the filters. Memories marked private never appear in this catalogue."
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {(memories ?? []).map((memory) => (
                <MemoryCard key={memory._id} memory={memory} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PulseShell>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-dashed border-[var(--rule)] px-6 py-16 text-center">
      <h3 className="font-display text-2xl">{title}</h3>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
