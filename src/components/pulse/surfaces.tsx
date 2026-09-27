import { api } from "@/convex/_generated/api";
import type { AreaIntelResult, MemoryConnection, PlaceIntel, PulseRecommendation } from "@/convex/intelligence";
import { PulseCard } from "@/components/pulse/cards";
import { usePulse } from "@/components/pulse/PulseProvider";
import { useAction, useMutation } from "convex/react";
import { Compass, Loader2, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

/**
 * The intelligence layer, visible in place.
 *
 * None of this requires opening the assistant: the dashboard, the place panel
 * and the memory page all show what Pulse already understands, with the
 * evidence attached. Every component here reads the same snapshot, so the whole
 * product has one opinion about who you are.
 */

/* --- Small shared kit ------------------------------------------------ */

export function PulsePanel({
  label,
  title,
  children,
  action,
}: {
  label?: string;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="pm-panel p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          {label ? <p className="pm-chip mb-2">{label}</p> : null}
          {title ? (
            <h2 className="text-[1.05rem] leading-tight font-bold tracking-[-0.015em] text-white">{title}</h2>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PulseThinking({ lines = 2, note }: { lines?: number; note?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-white/45">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        {note ?? "Reading your memories and real place data…"}
      </div>
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className="h-3 w-full animate-pulse rounded-full bg-white/[0.05]" />
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-6 text-white/45">{children}</p>;
}

/* --- 1. Dashboard brief --------------------------------------------- */

export function PulseBrief() {
  const { snapshot, refresh } = usePulse();
  const { openPulse } = usePulse();

  if (snapshot === undefined) {
    return (
      <PulsePanel label="Pulse" title="Getting to know your map">
        <PulseThinking note="Reading your memories and building your travel profile…" />
      </PulsePanel>
    );
  }

  if (!snapshot.ai.configured) {
    return (
      <PulsePanel label="Pulse" title="Intelligence is not connected yet">
        <Empty>
          Add an AI provider key in the Keys tab and Pulse starts reading your memories, explaining
          places and planning trips. Everything else in the app keeps working without it.
        </Empty>
      </PulsePanel>
    );
  }

  if (snapshot.analyser.memories === 0) {
    return (
      <PulsePanel label="Pulse" title="Pin your first memory">
        <Empty>
          Once you have a few pins, Pulse reads them — the places, the seasons, the things you keep
          coming back to — and every screen in here starts speaking your language.
        </Empty>
      </PulsePanel>
    );
  }

  const profile = snapshot.profile;
  const analyser = snapshot.analyser;

  return (
    <PulsePanel
      label="Pulse"
      title={profile?.summary ? "Your travel profile" : "Reading your memories"}
      action={
        <button
          type="button"
          onClick={() => openPulse("Where should I go next?")}
          className="shrink-0 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-[#ff6a2c]/60 hover:text-white"
        >
          Ask Pulse
        </button>
      }
    >
      {profile?.summary ? (
        <p className="text-[12px] leading-6 text-white/65">{profile.summary}</p>
      ) : (
        <PulseThinking note={`Read ${analyser.analysed} of ${analyser.memories} memories so far…`} />
      )}

      {profile && profile.preferences.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {profile.preferences.slice(0, 7).map((preference) => (
            <span key={preference.key} className="pm-chip" title={preference.evidence.join(" · ")}>
              {preference.label}
              <span className="ml-1.5 text-white/35">{Math.round(preference.weight * 100)}%</span>
            </span>
          ))}
        </div>
      ) : null}

      {!analyser.ready ? (
        <button
          type="button"
          onClick={() => refresh("dashboard")}
          className="mt-4 rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition hover:text-white"
        >
          Read the next few memories
        </button>
      ) : null}

      {profile && profile.preferences[0]?.evidence.length ? (
        <p className="mt-3 text-[11px] leading-5 text-white/35">
          Evidence for “{profile.preferences[0].label}”: {profile.preferences[0].evidence.slice(0, 3).join(" · ")}
        </p>
      ) : null}
    </PulsePanel>
  );
}

/* --- 2. Recommendations --------------------------------------------- */

export function PersonalizedRecommendations({
  surface = "dashboard",
  limit = 3,
}: {
  surface?: "dashboard" | "explore" | "globe";
  limit?: number;
}) {
  const { snapshot } = usePulse();
  const { openPulse } = usePulse();
  const navigate = useNavigate();
  const feedback = useMutation(api.intelligence.feedback);
  const [hidden, setHidden] = useState<string[]>([]);

  if (snapshot === undefined) {
    return (
      <PulsePanel label="Chosen for you" title="Working out what fits">
        <PulseThinking lines={3} />
      </PulsePanel>
    );
  }

  const items = (snapshot.recommendations?.items ?? []).filter((item) => !hidden.includes(item.id));
  const headline = snapshot.recommendations?.headline ?? "Places that fit your travel style";
  // The word "AI" is deliberately absent: this is the product understanding you.
  const label =
    surface === "explore" ? "More like your memories" : surface === "globe" ? "Around here" : "Chosen for you";

  async function vote(item: PulseRecommendation, voteKind: "up" | "down" | "dismiss") {
    setHidden((current) => [...current, item.id]);
    try {
      await feedback({ kind: "recommendation", subject: item.id, vote: voteKind });
    } catch {
      // Feedback is best-effort: the card is already out of the way.
    }
  }

  return (
    <PulsePanel
      label={label}
      title={headline}
      action={
        <button
          type="button"
          onClick={() => openPulse("Why are you recommending this?")}
          className="shrink-0 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-[#ff6a2c]/60 hover:text-white"
        >
          Why these?
        </button>
      }
    >
      {items.length === 0 ? (
        <Empty>
          {snapshot.analyser.memories === 0
            ? "Save a place or pin a memory and this fills with things chosen for you."
            : "Nothing new to suggest right now — zoom the globe somewhere and Pulse will look again."}
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.slice(0, limit).map((item) => (
            <article key={item.id} className="flex flex-col rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="text-[13px] font-semibold text-white">{item.name}</p>
              <p className="mt-0.5 text-[11px] text-white/40">{item.placeName}</p>
              <ul className="mt-2.5 flex-1 space-y-1">
                {item.why.slice(0, 3).map((line) => (
                  <li key={line} className="text-[11px] leading-5 text-white/60">
                    {line}
                  </li>
                ))}
              </ul>
              {item.cost ? (
                <p className="mt-2 text-[11px] font-semibold text-[#ffb347]">
                  {item.cost.currency} {item.cost.low.toLocaleString()}–{item.cost.high.toLocaleString()} est.
                </p>
              ) : null}
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (item.placeId) navigate(`/map?place=${encodeURIComponent(item.placeId)}`);
                      else navigate(`/map?focus=${item.lat},${item.lng},60`);
                    }}
                    className="rounded-full bg-[#ff6a2c] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-110"
                  >
                    Show on map
                  </button>
                  <button
                    type="button"
                    onClick={() => openPulse(`What is ${item.name} like for me?`)}
                    className="rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:text-white"
                  >
                    Ask
                  </button>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label="Good suggestion"
                    onClick={() => void vote(item, "up")}
                    className="grid size-7 place-items-center rounded-full text-white/35 transition hover:text-[#7ad39b]"
                  >
                    <ThumbsUp className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Not for me"
                    onClick={() => void vote(item, "down")}
                    className="grid size-7 place-items-center rounded-full text-white/35 transition hover:text-white/70"
                  >
                    <ThumbsDown className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => void vote(item, "dismiss")}
                    className="grid size-7 place-items-center rounded-full text-white/35 transition hover:text-white/70"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </PulsePanel>
  );
}

/* --- 3. Counted insights -------------------------------------------- */

export function TravelInsights({ limit = 5 }: { limit?: number }) {
  const { snapshot } = usePulse();
  const rows = snapshot?.insights ?? [];

  return (
    <PulsePanel label="Insights" title="What your map says">
      {snapshot === undefined ? (
        <PulseThinking lines={2} />
      ) : rows.length === 0 ? (
        <Empty>No insights yet — they appear once there are a few memories to count.</Empty>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {rows.slice(0, limit).map((insight) => (
            <li key={insight.id} className="flex items-start gap-3 py-2.5">
              <Compass className="mt-0.5 size-4 shrink-0 text-[#ff6a2c]" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[12px] leading-5 text-white/75">{insight.text}</p>
                <p className="text-[10px] text-white/35">{insight.evidence}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PulsePanel>
  );
}

/* --- 4. Next adventure ---------------------------------------------- */

export function NextAdventure() {
  const { snapshot, openPulse } = usePulse();
  const navigate = useNavigate();
  const item = snapshot?.nextAdventure;

  if (!item) return null;

  return (
    <section className="pm-panel relative overflow-hidden p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-[#ff6a2c]/12 blur-3xl"
      />
      <p className="pm-chip mb-2">Next adventure</p>
      <h2 className="text-[1.35rem] leading-tight font-extrabold tracking-[-0.02em] text-white">{item.name}</h2>
      <ul className="mt-3 space-y-1.5">
        {item.why.slice(0, 3).map((line) => (
          <li key={line} className="flex items-start gap-2 text-[12px] leading-5 text-white/65">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#ff6a2c]" aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => navigate(`/map?focus=${item.lat},${item.lng},80`)}
          className="rounded-full bg-[#ff6a2c] px-4 py-2 text-[12px] font-semibold text-white transition hover:brightness-110"
        >
          Explore the globe
        </button>
        <button
          type="button"
          onClick={() => openPulse(`Plan a trip around ${item.name}`)}
          className="rounded-full border border-white/12 px-4 py-2 text-[12px] font-semibold text-white/80 transition hover:text-white"
        >
          Plan a trip
        </button>
      </div>
    </section>
  );
}

/* --- 5. Saved-place opportunity ------------------------------------- */

export function SavedOpportunity() {
  const { snapshot, openPulse } = usePulse();
  const cluster = snapshot?.savedClusters[0];
  if (!cluster) return null;

  return (
    <PulsePanel label="Saved places" title={`${cluster.count} places around ${cluster.name}`}>
      <p className="text-[12px] leading-6 text-white/60">
        Enough for a trip. Pulse can order them into days, measure the driving between them and put a
        rough budget on it.
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {cluster.places.map((place) => (
          <li key={place} className="pm-chip">
            {place}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => openPulse(`Plan a trip through my saved places around ${cluster.name}`)}
        className="mt-3 rounded-full bg-[#ff6a2c] px-4 py-2 text-[12px] font-semibold text-white transition hover:brightness-110"
      >
        Build this trip
      </button>
    </PulsePanel>
  );
}

/* --- 6. Counted travel stats (nothing here is inferred) ------------- */

export function AITravelStats() {
  const { snapshot } = usePulse();
  const profile = snapshot?.profile;

  if (!profile) {
    return (
      <PulsePanel label="Your map, counted" title="Your numbers">
        <PulseThinking lines={2} note="Counting your memories and saved places…" />
      </PulsePanel>
    );
  }

  const stats = profile.stats;
  const rows = [
    { label: "Memories", value: stats.memories },
    { label: "Countries", value: stats.countries },
    { label: "Cities", value: stats.cities },
    { label: "Saved places", value: stats.savedPlaces },
    { label: "Trips", value: stats.trips },
  ];

  return (
    <PulsePanel label="Your map, counted" title="Travel stats">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
            <dt className="text-[10px] tracking-[0.12em] text-white/40 uppercase">{row.label}</dt>
            <dd className="mt-0.5 text-[1.05rem] font-bold text-white">{row.value}</dd>
          </div>
        ))}
        {stats.avgTripDays > 0 ? (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
            <dt className="text-[10px] tracking-[0.12em] text-white/40 uppercase">Usual length</dt>
            <dd className="mt-0.5 text-[1.05rem] font-bold text-white">{stats.avgTripDays} days</dd>
          </div>
        ) : null}
      </dl>

      {profile.countries.length > 0 ? (
        <p className="mt-3 text-[11px] leading-5 text-white/45">
          Most of your pins are in {profile.countries.slice(0, 3).map((row) => `${row.name} (${row.count})`).join(", ")}.
        </p>
      ) : null}

      {snapshot?.tripOpportunity ? (
        <p className="mt-2 text-[11px] leading-5 text-white/45">
          {snapshot.tripOpportunity.title} — {snapshot.tripOpportunity.body}
        </p>
      ) : null}
    </PulsePanel>
  );
}

/* --- 7. Memory connections ------------------------------------------ */

export function MemoryConnections({ memoryId }: { memoryId: string }) {
  const connections = useAction(api.intelligence.connections);
  const [items, setItems] = useState<MemoryConnection[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    connections({ memoryId: memoryId as never })
      .then((result) => {
        if (result.ok) setItems(result.items);
        else setFailed(result.message ?? null);
      })
      .catch(() => setFailed("Connections are unavailable right now."));
  }, [connections, memoryId]);

  return (
    <PulsePanel label="Pulse" title="This reminds you of">
      {failed ? (
        <Empty>{failed}</Empty>
      ) : items === null ? (
        <PulseThinking lines={2} note="Comparing this memory with the rest of your map…" />
      ) : items.length === 0 ? (
        <Empty>Nothing else on your map reads quite like this one yet.</Empty>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3">
              <span className="mt-1 size-2 shrink-0 rounded-full bg-[#ff6a2c]" aria-hidden="true" />
              <div className="min-w-0">
                <a
                  href={`/m/${item.id}`}
                  className="text-[12px] font-semibold text-white transition hover:text-[#ff6a2c]"
                >
                  {item.title}
                </a>
                <p className="text-[11px] text-white/40">
                  {item.placeName} · {new Date(item.happenedAt).toLocaleDateString("en", { month: "short", year: "numeric" })}
                </p>
                <p className="mt-0.5 text-[11px] leading-5 text-white/60">{item.why}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PulsePanel>
  );
}

/* --- 8. Destination intelligence (place panel) --------------------- */

export function DestinationIntel({ placeId, compact = false }: { placeId: string; compact?: boolean }) {
  const explain = useAction(api.intelligence.explainPlace);
  const { openPulse } = usePulse();
  const [intel, setIntel] = useState<PlaceIntel | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (asked.current === placeId) return;
    asked.current = placeId;
    setIntel(null);
    setFailed(null);
    explain({ placeId })
      .then((result) => {
        if (result.ok && result.intel) setIntel(result.intel);
        else setFailed(result.message ?? "Pulse could not read this place.");
      })
      .catch(() => setFailed("Pulse could not read this place right now."));
  }, [explain, placeId]);

  if (failed) return null;

  if (!intel) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="pm-chip mb-2">Pulse</p>
        <PulseThinking lines={2} note="Reading this place against your history…" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {intel.whyFits.length > 0 ? (
        <div className="rounded-2xl border border-[#ff6a2c]/20 bg-[#ff6a2c]/[0.06] p-4">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-[#ff9a63] uppercase">Why this fits you</p>
          <ul className="mt-2 space-y-1">
            {intel.whyFits.map((line) => (
              <li key={line} className="text-[12px] leading-5 text-white/75">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="text-[11px] leading-5 text-white/50">
            Nothing in your history points at this place yet — here is what it is, from real data.
          </p>
        </div>
      )}

      {intel.bestMonths.length > 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-white/45 uppercase">
            Best time for you to visit
          </p>
          <ul className="mt-2 space-y-1.5">
            {intel.bestMonths.slice(0, 4).map((month) => (
              <li key={month.month} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="font-medium text-white/80">{month.month}</span>
                <span className="text-right text-white/50">{month.note}</span>
              </li>
            ))}
          </ul>
          {intel.weather?.months.length ? (
            <p className="mt-2 text-[10px] text-white/30">
              From {intel.weather.months.length} months of climate records · {intel.weather.source}
            </p>
          ) : null}
        </div>
      ) : null}

      {!compact ? (
        <>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-white/45 uppercase">
              How long to stay
            </p>
            <p className="mt-1.5 text-[12px] leading-5 text-white/70">
              {intel.stay.min}–{intel.stay.max} days. {intel.stay.rationale}
            </p>
            {intel.activities.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {intel.activities.slice(0, 6).map((activity) => (
                  <span key={activity} className="pm-chip">
                    {activity}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <PulseCard
            card={{ type: "cost", estimate: intel.cost, label: `${intel.name} — suggested trip` }}
            ui={[]}
            onUi={() => {}}
          />

          {intel.nearby.length > 0 ? (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-white/45 uppercase">
                Places nearby you may like
              </p>
              <ul className="mt-2 space-y-1">
                {intel.nearby.slice(0, 6).map((place) => (
                  <li key={place.placeId} className="flex items-baseline justify-between gap-3 text-[11px]">
                    <span className="min-w-0 truncate text-white/70">{place.name}</span>
                    <span className="shrink-0 text-white/35">
                      {place.categoryLabel} · {place.distanceKm} km
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {intel.memories.length > 0 ? (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-white/45 uppercase">
                Your memories nearby
              </p>
              <ul className="mt-2 space-y-1">
                {intel.memories.map((memory) => (
                  <li key={memory.id} className="text-[11px] text-white/65">
                    <a href={`/m/${memory.id}`} className="transition hover:text-[#ff6a2c]">
                      {memory.title}
                    </a>
                    <span className="text-white/35"> · {memory.distanceKm} km away</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {intel.similar.length > 0 ? (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-white/45 uppercase">
                Similar places you've enjoyed
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {intel.similar.map((name) => (
                  <span key={name} className="pm-chip">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <p className="text-[10px] leading-4 text-white/30">
            {intel.sources.join(" · ")} · interpretation confidence {Math.round(intel.confidence * 100)}%
          </p>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => openPulse(`Tell me about ${intel.name} — is it worth it for me?`)}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3.5 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-[#ff6a2c]/60 hover:text-white"
      >
        <Sparkles className="size-3.5 text-[#ff6a2c]" aria-hidden="true" />
        Ask Pulse about this place
      </button>
    </div>
  );
}

/* --- 9. Area intelligence (globe) ----------------------------------- */

export function AreaIntelCard({
  lat,
  lng,
  spanKm,
  label,
}: {
  lat: number;
  lng: number;
  spanKm: number;
  label?: string;
}) {
  const area = useAction(api.intelligence.areaIntel);
  const [result, setResult] = useState<AreaIntelResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setFailed(null);
    try {
      const response = await area({ lat, lng, spanKm });
      if (response.ok && response.area) setResult(response.area);
      else setFailed(response.message ?? "Nothing to read here yet.");
    } catch {
      setFailed("Pulse could not read this area right now.");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="pm-pulse-area">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[12px] font-semibold text-white">{result.headline}</p>
          <button
            type="button"
            onClick={() => setResult(null)}
            aria-label="Dismiss"
            className="grid size-6 place-items-center rounded-full text-white/40 transition hover:text-white"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-2 space-y-2.5">
          {result.observations.map((observation) => (
            <div key={observation.heading}>
              <p className="text-[11px] font-semibold tracking-[0.1em] text-[#ff6a2c] uppercase">
                {observation.heading}
              </p>
              <p className="mt-0.5 text-[11px] leading-5 text-white/65">{observation.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-white/30">{result.sources.join(" · ")}</p>
      </div>
    );
  }

  return (
    <div className="pm-pulse-area">
      <p className="text-[11px] font-semibold tracking-[0.1em] text-white/45 uppercase">
        {label ?? "This area"}
      </p>
      {failed ? <p className="mt-1.5 text-[11px] leading-5 text-white/50">{failed}</p> : null}
      <button
        type="button"
        onClick={() => void run()}
        disabled={loading}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#ff6a2c] px-3.5 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
        {loading ? "Reading the area…" : "Ask Pulse about this area"}
      </button>
    </div>
  );
}

/* --- 10. Writing help while pinning --------------------------------- */

export function DraftAssistant({
  placeName,
  title,
  note,
  tags,
  lat,
  lng,
  happenedAt,
  onApply,
}: {
  placeName: string;
  title: string;
  note: string;
  tags: string[];
  lat?: number;
  lng?: number;
  happenedAt?: number;
  onApply: (draft: { title?: string; note?: string; tags?: string[] }) => void;
}) {
  const assist = useAction(api.intelligence.draftAssist);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; note: string; tags: string[]; caution?: string } | null>(null);

  if (!placeName) return null;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold text-white/60">Pulse can help you write this</p>
        <button
          type="button"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setFailed(null);
            try {
              const result = await assist({ placeName, title, note, tags, lat, lng, happenedAt });
              if (result.ok) {
                if (result.draft) setDraft(result.draft);
                else setFailed("Pulse did not return a draft.");
              } else {
                setFailed(result.message);
              }
            } catch {
              setFailed("Pulse could not draft that right now.");
            } finally {
              setLoading(false);
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-1 text-[11px] font-semibold text-white/75 transition hover:text-white disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3 text-[#ff6a2c]" aria-hidden="true" />}
          {loading ? "Drafting…" : "Suggest"}
        </button>
      </div>

      {failed ? <p className="mt-2 text-[11px] leading-5 text-white/50">{failed}</p> : null}

      {draft ? (
        <div className="mt-2.5 rounded-xl border border-white/[0.07] bg-[#0f0f11] p-3">
          <p className="text-[12px] font-semibold text-white">{draft.title}</p>
          <p className="mt-1 text-[11px] leading-5 text-white/65">{draft.note}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {draft.tags.map((tag) => (
              <span key={tag} className="pm-chip">
                {tag}
              </span>
            ))}
          </div>
          {draft.caution ? <p className="mt-2 text-[10px] leading-4 text-white/40">{draft.caution}</p> : null}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onApply({ title: draft.title, note: draft.note, tags: draft.tags });
                setDraft(null);
              }}
              className="rounded-full bg-[#ff6a2c] px-3 py-1 text-[11px] font-semibold text-white transition hover:brightness-110"
            >
              Use this
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-full border border-white/12 px-3 py-1 text-[11px] font-semibold text-white/70 transition hover:text-white"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
