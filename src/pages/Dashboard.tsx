import { MemoryCard } from "@/components/pulsemap/MemoryCard";
import { PinMemoryDialog } from "@/components/pulsemap/PinMemoryDialog";
import { PulseShell, SectionHeading } from "@/components/pulsemap/AppShell";
import { formatDateTime, formatMoney, relativeDay } from "@/components/pulsemap/tone";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import {
  BellRing,
  CalendarDays,
  Check,
  MapPin,
  Plus,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const { user } = useAuth();
  const stats = useQuery(api.memories.myStats);
  const memories = useQuery(api.memories.listMine);
  const reminders = useQuery(api.reminders.listMine);
  const bookings = useQuery(api.bookings.listMine);
  const catalog = useQuery(api.experiences.list, {});
  const seedPins = useMutation(api.memories.seedCommunityPins);
  const seedCatalog = useMutation(api.experiences.seedCatalog);
  const setReminderDone = useMutation(api.reminders.setDone);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const openReminders = (reminders ?? []).filter((item) => !item.done);
  const recent = (memories ?? []).slice(0, 6);
  const isEmpty = (memories ?? []).length === 0;
  const catalogEmpty = (catalog ?? []).length === 0;

  async function prepareWorkspace() {
    setSeeding(true);
    try {
      await seedCatalog();
      if (isEmpty) await seedPins();
    } finally {
      setSeeding(false);
    }
  }

  const stats_ = [
    {
      label: "Memories pinned",
      value: stats?.memories ?? 0,
      hint: stats?.latest ? `Newest: ${stats.latest}` : "Nothing pinned yet",
    },
    {
      label: "Places mapped",
      value: stats?.places ?? 0,
      hint: "Rounded to one decimal of a degree",
    },
    {
      label: "Open reminders",
      value: stats?.pendingReminders ?? 0,
      hint: stats?.overdueReminders
        ? `${stats.overdueReminders} already due`
        : "Nothing overdue",
    },
    {
      label: "Visits booked",
      value: (bookings ?? []).length,
      hint: `${(bookings ?? []).filter((b) => b.status === "confirmed").length} confirmed`,
    },
  ];

  return (
    <PulseShell
      eyebrow={`${greeting()}${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
      title="Your memory map"
      description="Every pin you keep, every reminder you set and every trail you book, on one quiet page. Nothing here is public unless you say so."
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-sm border-[var(--rule)]"
            onClick={prepareWorkspace}
            disabled={seeding}
          >
            <Sparkles className="size-4" aria-hidden="true" />
            {catalogEmpty ? "Load the starter content" : "Refresh starter content"}
          </Button>
          <Button type="button" className="gap-2" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Pin a memory
          </Button>
        </>
      }
    >
      <div className="grid gap-px border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-4">
        {stats_.map((item) => (
          <div key={item.label} className="bg-card px-5 py-6">
            <p className="micro-label">{item.label}</p>
            <p className="font-display mt-4 text-4xl leading-none">{item.value}</p>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {item.hint}
            </p>
          </div>
        ))}
      </div>

      {isEmpty ? (
        <section className="mt-8 border border-[var(--rule)] bg-card p-6">
          <p className="micro-label">Getting started</p>
          <h2 className="font-display mt-3 text-3xl">
            Your map is blank paper, which is a good start.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Load the starter content to see how a filled map reads, or pin your own first
            memory. Pins drop exactly where you click, so start with a place you can
            still picture.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" className="gap-2" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Pin my first memory
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2 rounded-sm border-[var(--rule)]"
              onClick={prepareWorkspace}
              disabled={seeding}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Load the starter content
            </Button>
            <Link
              to="/map"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm underline decoration-[var(--rule-strong)] underline-offset-4"
            >
              <MapPin className="size-4" aria-hidden="true" />
              Open the live map
            </Link>
          </div>
        </section>
      ) : null}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <section>
          <SectionHeading
            label="Recent pins"
            title="Last memories"
            action={
              <Link
                to="/map"
                className="text-sm underline decoration-[var(--rule-strong)] underline-offset-4"
              >
                See all on the map
              </Link>
            }
          />
          {recent.length === 0 ? (
            <p className="border border-dashed border-[var(--rule)] px-5 py-10 text-center text-sm text-muted-foreground">
              No memories yet. The first pin takes about twenty seconds.
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              {recent.map((memory) => (
                <MemoryCard key={memory._id} memory={memory} />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHeading label="Nudges" title="Reminders" />
          {openReminders.length === 0 ? (
            <p className="border border-dashed border-[var(--rule)] px-5 py-10 text-center text-sm text-muted-foreground">
              No reminders set. Open any memory and choose when to be reminded.
            </p>
          ) : (
            <ul className="hairline-grid border border-[var(--rule)] bg-card">
              {openReminders.slice(0, 6).map((reminder) => (
                <li key={reminder._id} className="flex items-start gap-3 px-4 py-4">
                  <BellRing
                    className="mt-0.5 size-4 shrink-0 text-[var(--tone-bright)]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-5 font-medium">{reminder.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(reminder.dueAt)} · {relativeDay(reminder.dueAt)}
                    </p>
                    {reminder.memoryTitle ? (
                      <Link
                        to="/map"
                        className="mt-2 inline-block text-xs underline decoration-[var(--rule-strong)] underline-offset-2"
                      >
                        {reminder.memoryTitle}
                      </Link>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0"
                    aria-label={`Mark "${reminder.title}" as done`}
                    onClick={() =>
                      setReminderDone({ id: reminder._id, done: !reminder.done })
                    }
                  >
                    {reminder.done ? (
                      <Undo2 className="size-4" aria-hidden="true" />
                    ) : (
                      <Check className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-10">
            <SectionHeading label="Upcoming" title="Bookings and orders" />
            {(bookings ?? []).length === 0 ? (
              <p className="border border-dashed border-[var(--rule)] px-5 py-10 text-center text-sm text-muted-foreground">
                Nothing booked.{" "}
                <Link to="/explore" className="underline">
                  Browse the trails
                </Link>
                .
              </p>
            ) : (
              <div className="border border-[var(--rule)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trail</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(bookings ?? []).slice(0, 5).map((booking) => (
                      <TableRow key={booking._id}>
                        <TableCell className="max-w-[160px]">
                          <Link
                            to={`/trails/${booking.experienceSlug}`}
                            className="line-clamp-2 text-sm font-medium hover:underline"
                          >
                            {booking.experienceTitle}
                          </Link>
                          <p className="micro-label mt-1">{booking.status}</p>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <CalendarDays className="mb-0.5 size-3.5" aria-hidden="true" />
                          <span className="block">{formatDateTime(booking.startsAt)}</span>
                        </TableCell>
                        <TableCell className="text-right text-sm whitespace-nowrap">
                          {formatMoney(booking.totalCents, booking.currency)}
                          {booking.orderId ? (
                            <Link
                              to={`/checkout/${booking.orderId}`}
                              className="micro-label mt-1 block underline"
                            >
                              {booking.orderStatus === "paid" ? "Receipt" : "Finish checkout"}
                            </Link>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </section>
      </div>

      <PinMemoryDialog open={dialogOpen} onOpenChange={setDialogOpen} coords={null} />
    </PulseShell>
  );
}
