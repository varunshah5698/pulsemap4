import { PinMemoryDialog } from "@/components/pulsemap/PinMemoryDialog";
import { formatDateTime, formatMoney, relativeDay, toneMeta } from "@/components/pulsemap/tone";
import {
  ArcGauge,
  AreaCurve,
  BarsRow,
  Legend,
  Segmented,
  type SeriesPoint,
} from "@/components/dashboard/charts";
import {
  DashboardRail,
  DashboardTopBar,
  GreetingBanner,
  type DashboardTab,
} from "@/components/dashboard/DashboardFrame";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Check,
  Compass,
  Footprints,
  LogOut,
  MapPin,
  MapPinned,
  Plus,
  Sparkles,
  Waves,
} from "lucide-react";
import {
  AITravelStats,
  NextAdventure,
  PersonalizedRecommendations,
  PulseBrief,
  SavedOpportunity,
  TravelInsights,
} from "@/components/pulse/surfaces";
import { usePulsePage } from "@/components/pulse/PulseProvider";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import "../dashboard.css";

/* ------------------------------------------------------------------ *
 * The same remote artwork family the rest of Pulsemap uses.
 * ------------------------------------------------------------------ */
const BRIDGE =
  "https://raft-blast-61784561.figma.site/_assets/v11/c6a6d8ef49bca43f708aa852692942c45ec950d4.png";
const BAZAAR =
  "https://raft-blast-61784561.figma.site/_assets/v11/864afe00e41e2fa20a5aa546e15cb807e0f81384.png";

const RANGES = [
  { value: "1d", label: "1d" },
  { value: "1w", label: "1w" },
  { value: "1m", label: "1m" },
  { value: "1y", label: "1y" },
  { value: "max", label: "ALL" },
] as const;

type Range = (typeof RANGES)[number]["value"];

/** Reference palette: orange leads the arc, then blue, then a muted track. */
const GAUGE_PALETTE = ["#ff6a2c", "#2d6bff", "#565660"];

const DAY = 24 * 60 * 60 * 1000;

function number(value: number) {
  return value.toLocaleString("en-US");
}

function dayStart(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function monthStart(timestamp: number) {
  const date = new Date(timestamp);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function monthLabel(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-GB", { month: "short" });
}

function weekdayLabel(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-GB", { weekday: "narrow" });
}

/** Twelve months of history, oldest first. */
function lastMonths(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    return date.getTime();
  });
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const stats = useQuery(api.memories.myStats);
  const memories = useQuery(api.memories.listMine);
  const reminders = useQuery(api.reminders.listMine);
  const bookings = useQuery(api.bookings.listMine);
  const trails = useQuery(api.experiences.list, {});

  const seedPins = useMutation(api.memories.seedCommunityPins);
  const seedCatalog = useMutation(api.experiences.seedCatalog);
  const setReminderDone = useMutation(api.reminders.setDone);

  const [tab, setTab] = useState<DashboardTab>("overview");
  usePulsePage({ route: "/dashboard" });
  const [range, setRange] = useState<Range>("1m");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const pins = memories ?? [];
  const reminderList = reminders ?? [];
  const bookingsList = bookings ?? [];

  const now = Date.now();
  const openReminders = reminderList.filter((item) => !item.done);
  const upcomingVisits = bookingsList
    .filter((booking) => booking.status !== "cancelled" && booking.startsAt >= now)
    .sort((a, b) => a.startsAt - b.startsAt);
  const nextVisit = upcomingVisits[0] ?? null;

  /* --- twelve month bar series --- */
  const months = useMemo(() => lastMonths(12), []);

  const pinsPerMonth = useMemo(
    () => months.map((start) => {
      const end = monthStart(new Date(start).setMonth(new Date(start).getMonth() + 1));
      return pins.filter((pin) => pin.happenedAt >= start && pin.happenedAt < end).length;
    }),
    [months, pins],
  );

  const placesPerMonth = useMemo(
    () => months.map((start) => {
      const end = monthStart(new Date(start).setMonth(new Date(start).getMonth() + 1));
      const names = new Set(
        pins
          .filter((pin) => pin.happenedAt >= start && pin.happenedAt < end)
          .map((pin) => pin.placeName.toLowerCase()),
      );
      return names.size;
    }),
    [months, pins],
  );

  /* --- tone mix for the gauge --- */
  const toneMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pin of pins) counts.set(pin.tone, (counts.get(pin.tone) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([tone, count]) => ({ tone, count, meta: toneMeta(tone) }))
      .sort((a, b) => b.count - a.count);
  }, [pins]);

  const topTones = toneMix.slice(0, 3);
  const gaugeSegments = topTones.map((item, index) => ({
    value: item.count,
    color: GAUGE_PALETTE[index] ?? GAUGE_PALETTE[GAUGE_PALETTE.length - 1],
  }));

  /* --- pulse score curve --- */
  const series: SeriesPoint[] = useMemo(() => {
    const inRange = (value: number, start: number, end: number) =>
      value >= start && value < end;
    const score = (start: number, end: number) => {
      const pinCount = pins.filter((pin) => inRange(pin.happenedAt, start, end)).length;
      const reminderCount = reminderList.filter((item) =>
        inRange(item.dueAt, start, end),
      ).length;
      const visitCount = bookingsList.filter((booking) =>
        inRange(booking.startsAt, start, end),
      ).length;
      return Math.min(100, 42 + pinCount * 7 + reminderCount * 5 + visitCount * 9);
    };

    if (range === "1d") {
      const start = now - 20 * 60 * 60 * 1000;
      const step = 4 * 60 * 60 * 1000;
      return Array.from({ length: 6 }, (_, index) => {
        const bucketStart = start + index * step;
        return {
          label: `${String(new Date(bucketStart).getHours()).padStart(2, "0")}h`,
          value: score(bucketStart, bucketStart + step),
        };
      });
    }

    if (range === "1w") {
      const start = dayStart(now) - 6 * DAY;
      return Array.from({ length: 7 }, (_, index) => {
        const dayStart_ = start + index * DAY;
        return {
          label: weekdayLabel(dayStart_),
          value: score(dayStart_, dayStart_ + DAY),
        };
      });
    }

    if (range === "1m") {
      const start = dayStart(now) - 27 * DAY;
      return Array.from({ length: 4 }, (_, index) => {
        const bucketStart = start + index * 7 * DAY;
        return {
          label: `W${index + 1}`,
          value: score(bucketStart, bucketStart + 7 * DAY),
        };
      });
    }

    if (range === "1y") {
      return lastMonths(12).map((start) => {
        const end = monthStart(new Date(start).setMonth(new Date(start).getMonth() + 1));
        return { label: monthLabel(start), value: score(start, end) };
      });
    }

    const earliest = pins.length
      ? Math.min(...pins.map((pin) => pin.createdAt))
      : monthStart(now);
    const span = Math.max(
      2,
      Math.min(
        12,
        (new Date(now).getFullYear() - new Date(earliest).getFullYear()) * 12 +
          (new Date(now).getMonth() - new Date(earliest).getMonth()) +
          1,
      ),
    );
    return lastMonths(span).map((start) => {
      const end = monthStart(new Date(start).setMonth(new Date(start).getMonth() + 1));
      return { label: monthLabel(start), value: score(start, end) };
    });
  }, [bookingsList, now, pins, range, reminderList]);

  const scoreNow = series.length ? series[series.length - 1].value : 0;
  const scoreFirst = series.length ? series[0].value : 0;
  const scoreDelta = scoreNow - scoreFirst;
  const trend =
    scoreDelta > 2 ? "Increasing steadily" : scoreDelta < -2 ? "Cooling off" : "Holding steady";

  /* --- profile framing from real data --- */
  const topPlace = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pin of pins) {
      const city = pin.placeName.split(",")[0]?.trim();
      if (!city) continue;
      counts.set(city, (counts.get(city) ?? 0) + 1);
    }
    const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    if (best) return `${best[0]} · ${best[1]} pins`;
    const featured = (trails ?? [])[0];
    return featured ? `${featured.city}, ${featured.country}` : "Nowhere pinned yet";
  }, [pins, trails]);

  const displayName = user?.name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "traveller";
  const catalogEmpty = (trails ?? []).length === 0;

  async function prepareWorkspace() {
    setSeeding(true);
    try {
      await seedCatalog();
      if (pins.length === 0) await seedPins();
    } finally {
      setSeeding(false);
    }
  }

  const statCards = [
    {
      label: "Memories pinned",
      icon: Footprints,
      iconClass: "text-[#ff6a2c]",
      values: pinsPerMonth,
      value: number(stats?.memories ?? 0),
      unit: "total",
    },
    {
      label: "Places mapped",
      icon: MapPinned,
      iconClass: "text-[#2d6bff]",
      values: placesPerMonth,
      value: number(stats?.places ?? 0),
      unit: "unique",
    },
  ];

  return (
    <div className="pm-dark min-h-screen bg-[#0f0f11]">
      <div className="flex">
        <DashboardRail
          onNew={() => setDialogOpen(true)}
          avatarName={user?.name ?? user?.email ?? "Pulsemap"}
          badge={openReminders.length}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <DashboardTopBar
            tab={tab}
            onTab={setTab}
            reminderCount={openReminders.length}
          />

          <div className="flex flex-1 gap-6 px-5 py-6 sm:px-7">
            <main className="min-w-0 flex-1">
              {tab === "overview" ? (
                <div className="mb-5 grid gap-5 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <PulseBrief />
                  </div>
                  <NextAdventure />
                </div>
              ) : null}

              {tab === "overview" ? (
                <div className="mb-5 grid gap-5 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <PersonalizedRecommendations surface="dashboard" limit={3} />
                  </div>
                  <div className="flex flex-col gap-5">
                    <SavedOpportunity />
                    <TravelInsights limit={4} />
                    <AITravelStats />
                  </div>
                </div>
              ) : null}

              {tab === "overview" ? (
                <div className="grid gap-5 lg:grid-cols-3 lg:grid-rows-[auto_auto_minmax(0,1fr)]">
                  <div className="lg:col-span-2 lg:col-start-1 lg:row-start-1">
                    <GreetingBanner
                      name={displayName}
                      memories={stats?.memories ?? 0}
                      reminders={openReminders.length}
                      nextLabel={
                        nextVisit
                          ? `next visit ${formatDateTime(nextVisit.startsAt)}`
                          : "no visit booked yet"
                      }
                    />
                  </div>

                  {statCards.slice(0, 2).map((card, index) => (
                    <section
                      key={card.label}
                      className={cn(
                        "pm-panel pm-rise p-5",
                        index === 0
                          ? "lg:col-start-1 lg:row-start-2"
                          : "lg:col-start-2 lg:row-start-2",
                      )}
                      style={{ animationDelay: `${80 + index * 60}ms` }}
                    >
                      <header className="flex items-start justify-between">
                        <h2 className="pm-panel-title">{card.label}</h2>
                        <card.icon
                          className={cn("size-4", card.iconClass)}
                          aria-hidden="true"
                        />
                      </header>
                      <div className="mt-6">
                        <BarsRow values={card.values} />
                      </div>
                      <p className="mt-6 flex items-baseline gap-2">
                        <span className="pm-metric">{card.value}</span>
                        <span className="pm-metric-unit">{card.unit}</span>
                      </p>
                    </section>
                  ))}

                  <section
                    className="pm-panel pm-rise flex flex-col p-5 lg:col-start-3 lg:row-span-2 lg:row-start-1"
                    style={{ animationDelay: "200ms" }}
                  >
                    <header className="flex items-start justify-between">
                      <h2 className="pm-panel-title">Tone mix</h2>
                      <Sparkles className="size-4 text-white/40" aria-hidden="true" />
                    </header>

                    <div className="relative mt-4 flex flex-1 flex-col justify-center">
                      <ArcGauge segments={gaugeSegments} />
                      <div className="pointer-events-none absolute inset-0 grid place-items-center pb-8 text-center">
                        <div>
                          <p className="pm-metric text-[2.4rem]">
                            {number(stats?.memories ?? 0)}
                          </p>
                          <p className="pm-metric-unit mt-1">pins</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5">
                      {topTones.length ? (
                        <Legend
                          className="justify-between"
                          items={topTones.map((item, index) => ({
                            label: item.meta.label,
                            color:
                              GAUGE_PALETTE[index] ??
                              GAUGE_PALETTE[GAUGE_PALETTE.length - 1],
                          }))}
                        />
                      ) : (
                        <p className="text-center text-xs text-white/40">
                          Pin a memory to see your tone mix.
                        </p>
                      )}
                    </div>
                  </section>

                  <NextVisitCard visit={nextVisit} className="lg:col-start-1 lg:row-start-3" />

                  <section
                    className="pm-panel pm-rise p-5 lg:col-span-2 lg:col-start-2 lg:row-start-3"
                    style={{ animationDelay: "260ms" }}
                  >
                    <header className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="pm-panel-title flex items-center gap-2">
                          <Waves className="size-4 text-[#ff6a2c]" aria-hidden="true" />
                          Pulse score
                        </h2>
                        <p className="mt-2 text-xs text-white/45">
                          {scoreDelta >= 0 ? "+" : ""}
                          {scoreDelta.toFixed(1)} · {trend}
                        </p>
                      </div>
                      <p className="flex items-baseline gap-2">
                        <span className="pm-metric text-[2.1rem]">{scoreNow.toFixed(2)}</span>
                        <span className="pm-metric-unit">pts</span>
                      </p>
                    </header>

                    <div className="mt-4">
                      <AreaCurve points={series} />
                    </div>

                    <div className="mt-5">
                      <Segmented
                        options={RANGES}
                        value={range}
                        onChange={setRange}
                        label="Chart range"
                      />
                    </div>
                  </section>
                </div>
              ) : null}

              {tab === "memories" ? (
                <section>
                  {pins.length === 0 ? (
                    <EmptyPanel
                      title="Your map is blank paper"
                      body="Load the starter content to see how a filled map reads, or pin your own first memory."
                      action={
                        <div className="flex flex-wrap justify-center gap-3">
                          <Button
                            type="button"
                            onClick={() => setDialogOpen(true)}
                            className="rounded-full bg-[#ff6a2c] text-white hover:bg-[#ff7c45]"
                          >
                            <Plus className="size-4" aria-hidden="true" />
                            Pin a memory
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={prepareWorkspace}
                            disabled={seeding}
                            className="rounded-full border-white/12 bg-transparent text-white hover:bg-white/5"
                          >
                            <Sparkles className="size-4" aria-hidden="true" />
                            Load starter content
                          </Button>
                        </div>
                      }
                    />
                  ) : (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                      {pins.map((pin) => (
                        <MemoryTile key={pin._id} memory={pin} />
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {tab === "reminders" ? (
                <section className="pm-panel pm-rise p-5">
                  <header className="flex items-center justify-between">
                    <h2 className="pm-panel-title">Reminders</h2>
                    <span className="pm-chip">{openReminders.length} open</span>
                  </header>
                  {reminderList.length === 0 ? (
                    <p className="py-14 text-center text-sm text-white/40">
                      No reminders yet. Open any memory and choose when to be reminded.
                    </p>
                  ) : (
                    <ul className="mt-3">
                      {reminderList.map((reminder) => (
                        <li key={reminder._id} className="pm-row">
                          <button
                            type="button"
                            onClick={() =>
                              setReminderDone({ id: reminder._id, done: !reminder.done })
                            }
                            aria-label={`Mark "${reminder.title}" as ${
                              reminder.done ? "not done" : "done"
                            }`}
                            className={cn(
                              "grid size-9 shrink-0 place-items-center rounded-full border transition-colors",
                              reminder.done
                                ? "border-[#ff6a2c] bg-[#ff6a2c] text-white"
                                : "border-white/15 text-white/40 hover:border-white/40",
                            )}
                          >
                            <Check className="size-4" aria-hidden="true" />
                          </button>
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                "truncate text-sm font-medium",
                                reminder.done ? "text-white/40 line-through" : "text-white",
                              )}
                            >
                              {reminder.title}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-white/45">
                              {reminder.memoryPlace ?? "No place"} ·{" "}
                              {formatDateTime(reminder.dueAt)}
                            </p>
                          </div>
                          <span className="pm-chip shrink-0">
                            {relativeDay(reminder.dueAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}

              {tab === "visits" ? (
                <section className="pm-panel pm-rise p-5">
                  <header className="flex items-center justify-between">
                    <h2 className="pm-panel-title">Visits and orders</h2>
                    <Link
                      to="/explore"
                      className="text-xs font-medium text-[#ff6a2c] hover:underline"
                    >
                      Browse trails
                    </Link>
                  </header>
                  {bookingsList.length === 0 ? (
                    <p className="py-14 text-center text-sm text-white/40">
                      Nothing booked yet.{" "}
                      <Link to="/explore" className="text-[#ff6a2c] hover:underline">
                        Find a guided trail
                      </Link>
                      .
                    </p>
                  ) : (
                    <ul className="mt-3">
                      {bookingsList.map((booking) => (
                        <li key={booking._id} className="pm-row">
                          <span
                            className="size-10 shrink-0 rounded-xl bg-cover bg-center"
                            style={{ backgroundImage: `url(${booking.imageUrl})` }}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-white">
                              {booking.experienceTitle}
                            </p>
                            <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/45">
                              <CalendarDays className="size-3.5" aria-hidden="true" />
                              {formatDateTime(booking.startsAt)} · {booking.partySize} people
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-white tabular-nums">
                              {formatMoney(booking.totalCents, booking.currency)}
                            </p>
                            {booking.orderId ? (
                              <Link
                                to={`/checkout/${booking.orderId}`}
                                className="text-[11px] text-[#ff6a2c] hover:underline"
                              >
                                {booking.orderStatus === "paid" ? "Receipt" : "Finish checkout"}
                              </Link>
                            ) : (
                              <span className="pm-chip mt-1">{booking.status}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
            </main>

            <aside className="hidden w-[318px] shrink-0 flex-col gap-5 xl:flex">
              <ProfilePanel
                name={user?.name ?? user?.email ?? "Pulsemap traveller"}
                place={topPlace}
                memories={stats?.memories ?? 0}
                places={stats?.places ?? 0}
                visits={bookingsList.length}
                onPrepare={prepareWorkspace}
                seeding={seeding}
                showPrepare={catalogEmpty}
                onSignOut={async () => {
                  await signOut();
                  navigate("/");
                }}
              />

              <section className="pm-panel p-5">
                <header className="flex items-center justify-between">
                  <h2 className="pm-panel-title">Next up</h2>
                  <BellRing className="size-4 text-[#ff6a2c]" aria-hidden="true" />
                </header>
                {openReminders.length === 0 ? (
                  <p className="py-8 text-center text-xs text-white/40">
                    Nothing scheduled. Reminders appear here as they fall due.
                  </p>
                ) : (
                  <ul className="mt-3 -mx-2">
                    {openReminders.slice(0, 4).map((reminder) => {
                      const overdue = reminder.dueAt < now;
                      return (
                        <li key={reminder._id} className="pm-row">
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              overdue ? "bg-[#ff6a2c]" : "bg-white/25",
                            )}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-white">
                              {reminder.title}
                            </p>
                            <p className="truncate text-[11px] text-white/45">
                              {relativeDay(reminder.dueAt)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        </div>
      </div>

      <PinMemoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        coords={null}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function NextVisitCard({
  visit,
  className,
}: {
  visit:
    | {
        _id: string;
        experienceTitle: string;
        experienceSlug: string;
        experienceCity: string;
        imageUrl: string;
        startsAt: number;
        partySize: number;
        orderId?: string | null;
      }
    | null;
  className?: string;
}) {
  const href = visit
    ? visit.orderId
      ? `/checkout/${visit.orderId}`
      : `/trails/${visit.experienceSlug}`
    : "/explore";

  return (
    <section
      className={cn(
        "pm-rise relative overflow-hidden rounded-[26px] p-5 text-white",
        className,
      )}
      style={{
        animationDelay: "230ms",
        background: "linear-gradient(150deg, #3b7dff 0%, #2d6bff 48%, #1e4fd8 100%)",
      }}
    >
      <span className="absolute -bottom-10 left-1/2 w-[215px] max-w-none -translate-x-1/2 opacity-95" aria-hidden="true">
        <img src={visit?.imageUrl || BAZAAR} alt="" className="w-full" />
      </span>

      <div className="relative flex h-full min-h-[248px] flex-col">
        <span className="grid size-9 place-items-center rounded-full bg-white/15">
          <Compass className="size-4" aria-hidden="true" />
        </span>
        <p className="mt-6 text-xs font-medium text-white/75">
          {visit ? "Upcoming trail" : "Nothing booked"}
        </p>
        <h2 className="mt-1 max-w-[80%] text-[1.5rem] leading-tight font-extrabold tracking-[-0.02em]">
          {visit ? visit.experienceTitle : "Find a guided walk"}
        </h2>
        <p className="mt-2 max-w-[62%] text-xs text-white/75">
          {visit
            ? `${formatDateTime(visit.startsAt)} · ${visit.partySize} people`
            : "Curated routes with a local guide, pinned as you walk."}
        </p>

        <Link
          to={href}
          className="pm-circle-cta absolute right-0 bottom-0"
          aria-label={visit ? "Open this visit" : "Browse the trail catalogue"}
        >
          <ArrowRight className="size-5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function MemoryTile({
  memory,
}: {
  memory: {
    _id: string;
    title: string;
    note: string;
    placeName: string;
    happenedAt: number;
    tone: string;
    tags: string[];
    visibility: string;
    mediaUrl?: string | null;
  };
}) {
  const meta = toneMeta(memory.tone);

  return (
    <article className="pm-panel group overflow-hidden transition-transform hover:-translate-y-0.5">
      <div
        className="relative h-36 bg-cover bg-center"
        style={{
          backgroundImage: memory.mediaUrl
            ? `url(${memory.mediaUrl})`
            : `linear-gradient(150deg, ${meta.hex}55, ${meta.hex}18)`,
        }}
      >
        {!memory.mediaUrl ? (
          <img
            src={BRIDGE}
            alt=""
            className="absolute bottom-0 left-1/2 h-[86%] -translate-x-1/2 object-contain opacity-80"
          />
        ) : null}
        <span
          className="absolute top-4 left-4 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-white uppercase"
          style={{ background: `${meta.hex}` }}
        >
          {meta.label}
        </span>
      </div>

      <div className="p-5">
        <p className="text-[11px] text-white/40">{formatDateTime(memory.happenedAt)}</p>
        <h3 className="mt-2 truncate text-[1.05rem] font-bold tracking-[-0.01em] text-white">
          {memory.title}
        </h3>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-white/45">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{memory.placeName}</span>
        </p>
        <p className="mt-3 line-clamp-2 text-[13px] leading-6 text-white/55">{memory.note}</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="pm-chip">{memory.visibility}</span>
          <Link
            to={`/m/${memory._id}`}
            className="flex items-center gap-1.5 text-xs font-medium text-[#ff6a2c] hover:underline"
          >
            Open
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function ProfilePanel({
  name,
  place,
  memories,
  places,
  visits,
  onPrepare,
  seeding,
  showPrepare,
  onSignOut,
}: {
  name: string;
  place: string;
  memories: number;
  places: number;
  visits: number;
  onPrepare: () => void;
  seeding: boolean;
  showPrepare: boolean;
  onSignOut: () => void;
}) {
  return (
    <section className="pm-panel overflow-hidden">
      <div className="flex items-center gap-3 p-5 pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#ff7f45] to-[#ea4f12] text-[13px] font-bold text-white">
          {name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join("")}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/45">
            <MapPin className="size-3" aria-hidden="true" />
            {place}
          </p>
        </div>
      </div>

      <div
        className="relative mx-5 h-[168px] overflow-hidden rounded-[22px]"
        style={{
          background: "linear-gradient(155deg, #ff7f45 0%, #f9601f 55%, #d9460c 100%)",
        }}
      >
        <img
          src={BRIDGE}
          alt=""
          className="absolute -bottom-2 left-1/2 h-[104%] max-w-none -translate-x-1/2 object-contain"
        />
        <div className="absolute inset-x-4 bottom-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.16em] text-white/80 uppercase">
              Memories
            </p>
            <p className="text-2xl leading-none font-extrabold text-white tabular-nums">
              {number(memories)}
            </p>
          </div>
          <span className="pm-chip bg-black/25 text-white/85">{places} places</span>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 px-5 py-5">
        {[
          { label: "Pins", value: number(memories) },
          { label: "Places", value: number(places) },
          { label: "Visits", value: number(visits) },
        ].map((item) => (
          <div key={item.label} className="pm-panel-soft px-3 py-3 text-center">
            <dt className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
              {item.label}
            </dt>
            <dd className="mt-1.5 text-lg font-bold text-white tabular-nums">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2 px-5 pb-5">
        <Button
          asChild
          className="h-11 w-full rounded-full bg-[#ff6a2c] text-sm font-semibold text-white hover:bg-[#ff7c45]"
        >
          <Link to="/map">Open the live map</Link>
        </Button>
        {showPrepare ? (
          <Button
            type="button"
            variant="outline"
            onClick={onPrepare}
            disabled={seeding}
            className="h-11 w-full rounded-full border-white/12 bg-transparent text-sm text-white/80 hover:bg-white/5"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            Load starter content
          </Button>
        ) : null}
        <button
          type="button"
          onClick={onSignOut}
          className="mt-1 flex items-center justify-center gap-2 py-1 text-xs font-medium text-white/40 transition-colors hover:text-white/80"
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </section>
  );
}

function EmptyPanel({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="pm-panel px-6 py-16 text-center">
      <h2 className="text-xl font-bold tracking-[-0.01em] text-white">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/50">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
