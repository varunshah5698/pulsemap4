import { PulseShell, SectionHeading } from "@/components/pulsemap/AppShell";
import { PulseCard } from "@/components/pulse/cards";
import { usePulse, usePulsePage } from "@/components/pulse/PulseProvider";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { CostEstimate } from "@/convex/cost";
import type { TravelStory } from "@/convex/ai/schemas";
import { useAction, useMutation, useQuery } from "convex/react";
import { CalendarDays, Loader2, Route, Sparkles, Wallet } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

/**
 * Trips: where a Pulse plan becomes a real itinerary.
 *
 * The page itself does no thinking. It shows what is stored, and the buttons
 * ask the same intelligence layer the rest of the app uses — so "make this
 * cheaper" and "optimise this day" run through the same engine as the
 * assistant, and every change is a mutation the person triggered.
 */

export default function Trips() {
  const { tripId } = useParams<{ tripId?: string }>();
  return tripId ? <TripDetail tripId={tripId} /> : <TripList />;
}

function TripList() {
  const trips = useQuery(api.trips.list);
  const { openPulse } = usePulse();
  usePulsePage({ route: "/trips" });

  return (
    <PulseShell
      eyebrow="Trips"
      title="Your trips"
      description="Plans Pulse drafted, kept as real itineraries you can change stop by stop."
      actions={
        <Button
          onClick={() => openPulse("Plan a trip for me — ask me where and for how long")}
          className="bg-[#ff6a2c] text-white hover:brightness-110"
        >
          <Sparkles className="mr-2 size-4" aria-hidden="true" />
          Plan with Pulse
        </Button>
      }
    >
      {trips === undefined ? (
        <p className="text-sm text-white/50">Loading your trips…</p>
      ) : trips.length === 0 ? (
        <div className="pm-panel p-6">
          <p className="text-sm leading-6 text-white/60">
            No trips yet. Ask Pulse for one — say where, how long and what you like — and it will
            order real places into days, measure the driving between them and put a rough budget on it.
          </p>
          <Button
            onClick={() => openPulse("Plan a 5 day trip somewhere that suits my memories")}
            className="mt-4 bg-[#ff6a2c] text-white hover:brightness-110"
          >
            Draft my first trip
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {trips.map((trip) => (
            <Link
              key={trip._id}
              to={`/trips/${trip._id}`}
              className="pm-panel block p-5 transition hover:border-[#ff6a2c]/40"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] tracking-[0.12em] text-white/40 uppercase">{trip.status}</p>
                  <h2 className="mt-1 truncate text-[1.1rem] font-bold tracking-[-0.015em] text-white">
                    {trip.title}
                  </h2>
                  <p className="mt-1 text-[12px] text-white/50">{trip.destination}</p>
                </div>
                <span className="pm-chip shrink-0">{trip.budgetMode}</span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-white/45">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" aria-hidden="true" />
                  {trip.startsAt
                    ? `${new Date(trip.startsAt).toLocaleDateString("en", { day: "numeric", month: "short" })} → ${
                        trip.endsAt
                          ? new Date(trip.endsAt).toLocaleDateString("en", { day: "numeric", month: "short" })
                          : "…"
                      }`
                    : "dates open"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Route className="size-3.5" aria-hidden="true" />
                  {trip.stopCount} stops · {trip.itemCount} items
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Wallet className="size-3.5" aria-hidden="true" />
                  {trip.travellers} traveller{trip.travellers === 1 ? "" : "s"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PulseShell>
  );
}

function TripDetail({ tripId }: { tripId: string }) {
  const bundle = useQuery(api.trips.get, { tripId: tripId as never });
  const optimise = useAction(api.trips.optimise);
  const costFor = useAction(api.trips.costFor);
  const storyAction = useAction(api.intelligence.story);
  const applyOrder = useMutation(api.trips.applyOrder);
  const { openPulse } = usePulse();

  const [busy, setBusy] = useState<string | null>(null);
  const [cost, setCost] = useState<CostEstimate | null>(null);
  const [story, setStory] = useState<TravelStory | null>(null);
  const [proposal, setProposal] = useState<{ day: number; order: { itemId: string; title: string }[]; note?: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  usePulsePage(
    {
      route: `/trips/${tripId}`,
      tripId,
      label: bundle?.trip.title,
      lat: bundle?.trip.lat ?? undefined,
      lng: bundle?.trip.lng ?? undefined,
    },
    [tripId, bundle?.trip.title],
  );

  if (bundle === undefined) {
    return (
      <PulseShell eyebrow="Trip" title="Loading this trip">
        <p className="text-sm text-white/50">Opening it…</p>
      </PulseShell>
    );
  }

  if (bundle === null) {
    return (
      <PulseShell eyebrow="Trip" title="This trip is not available">
        <p className="text-sm text-white/50">It may belong to another account, or it was deleted.</p>
      </PulseShell>
    );
  }

  const { trip, items } = bundle;
  const days = Array.from(new Set(items.map((item) => item.day))).sort((a, b) => a - b);

  async function runOptimise(day: number) {
    setBusy(`optimise-${day}`);
    setMessage(null);
    try {
      const result = await optimise({ tripId: tripId as never, day });
      if (!result.ok || !result.order) {
        setMessage(result.message ?? "That day could not be reordered.");
        return;
      }
      setProposal({ day, order: result.order.map((entry) => ({ itemId: entry.itemId, title: entry.title })), note: result.note });
    } catch {
      setMessage("That day could not be reordered right now.");
    } finally {
      setBusy(null);
    }
  }

  async function runCost() {
    setBusy("cost");
    try {
      const result = await costFor({ tripId: tripId as never });
      if (result.ok && result.cost) setCost(result.cost);
      else setMessage(result.message ?? "A cost estimate was not possible.");
    } catch {
      setMessage("A cost estimate was not possible right now.");
    } finally {
      setBusy(null);
    }
  }

  async function runStory() {
    setBusy("story");
    try {
      const result = await storyAction({ tripId: tripId as never });
      if (result.ok) setStory(result.story);
      else setMessage(result.message);
    } catch {
      setMessage("The story could not be written right now.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <PulseShell
      eyebrow={trip.status}
      title={trip.title}
      description={`${trip.destination} · ${trip.travellers} traveller${trip.travellers === 1 ? "" : "s"} · ${trip.budgetMode} spending`}
      actions={
        <>
          <Button variant="outline" onClick={() => void runCost()} disabled={busy === "cost"}>
            {busy === "cost" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Wallet className="mr-2 size-4" />}
            Estimate cost
          </Button>
          <Button variant="outline" onClick={() => void runStory()} disabled={busy === "story"}>
            {busy === "story" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
            Write the story
          </Button>
          {items.some((item) => typeof item.lat === "number") ? (
            <Button variant="outline" asChild>
              <Link to={`/map?trip=${tripId}`}>
                <Route className="mr-2 size-4" aria-hidden="true" />
                Show the route
              </Link>
            </Button>
          ) : null}
          <Button
            onClick={() => openPulse(`Make this trip better: ${trip.title} in ${trip.destination}`)}
            className="bg-[#ff6a2c] text-white hover:brightness-110"
          >
            Ask Pulse
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <div>
            <SectionHeading label="Itinerary" title={`${days.length} day${days.length === 1 ? "" : "s"}`} />
            {days.length === 0 ? (
              <p className="text-sm leading-6 text-white/55">
                No stops yet. Ask Pulse to build a plan, then confirm it and it lands here.
              </p>
            ) : (
              <div className="space-y-5">
                {days.map((day) => (
                  <section key={day} className="pm-panel p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-[13px] font-bold tracking-[-0.01em] text-white">Day {day}</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runOptimise(day)}
                        disabled={busy === `optimise-${day}`}
                      >
                        {busy === `optimise-${day}` ? (
                          <Loader2 className="mr-2 size-3.5 animate-spin" />
                        ) : (
                          <Route className="mr-2 size-3.5" />
                        )}
                        Optimise this day
                      </Button>
                    </div>
                    <ol className="mt-3 space-y-2.5">
                      {items
                        .filter((item) => item.day === day)
                        .sort((a, b) => a.order - b.order)
                        .map((item) => (
                          <li key={item._id} className="flex items-start gap-3">
                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#ff6a2c]" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="text-[12.5px] font-semibold text-white">{item.title}</p>
                              {item.detail ? (
                                <p className="text-[11px] leading-5 text-white/50">{item.detail}</p>
                              ) : null}
                              <p className="text-[10px] text-white/30">
                                {item.kind}
                                {item.source === "ai" ? " · drafted by Pulse" : ""}
                                {item.costCents ? ` · ${(item.costCents / 100).toFixed(0)} est.` : ""}
                              </p>
                            </div>
                          </li>
                        ))}
                    </ol>
                  </section>
                ))}
              </div>
            )}
          </div>

          {story ? (
            <div>
              <SectionHeading label="Story" title={story.title} />
              <div className="pm-panel p-5">
                <p className="text-[12px] italic text-white/60">{story.subtitle}</p>
                <div className="mt-4 space-y-4">
                  {story.chapters.map((chapter) => (
                    <div key={chapter.heading}>
                      <p className="text-[11px] font-semibold tracking-[0.1em] text-[#ff6a2c] uppercase">
                        {chapter.heading}
                      </p>
                      <p className="mt-1 text-[12.5px] leading-6 text-white/70">{chapter.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          {proposal ? (
            <div className="pm-panel p-5">
              <p className="pm-chip mb-2">Proposed change</p>
              <p className="text-[12px] leading-5 text-white/65">
                {proposal.note ?? "A shorter order for this day."}
              </p>
              <ol className="mt-3 space-y-1">
                {proposal.order.map((entry, index) => (
                  <li key={entry.itemId} className="text-[11px] text-white/60">
                    {index + 1}. {entry.title}
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex gap-2">
                <Button
                  onClick={async () => {
                    await applyOrder({
                      tripId: tripId as never,
                      day: proposal.day,
                      itemIds: proposal.order.map((entry) => entry.itemId) as never,
                    });
                    setProposal(null);
                  }}
                  className="bg-[#ff6a2c] text-white hover:brightness-110"
                >
                  Apply
                </Button>
                <Button variant="outline" onClick={() => setProposal(null)}>
                  Keep as is
                </Button>
              </div>
            </div>
          ) : null}

          {cost ? (
            <PulseCard card={{ type: "cost", estimate: cost, label: "This trip" }} ui={[]} onUi={() => {}} />
          ) : null}

          {message ? <p className="text-[11px] leading-5 text-white/50">{message}</p> : null}

          <div className="pm-panel p-5">
            <p className="pm-chip mb-2">How this was built</p>
            <p className="text-[11px] leading-5 text-white/55">
              Stops come from real Google Places data, distances from the routing engine, and money
              from a planning table — never from a model's imagination. Anything that needed a live
              quote is marked as not included.
            </p>
          </div>
        </div>
      </div>
    </PulseShell>
  );
}
