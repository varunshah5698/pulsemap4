import { PulseShell, SectionHeading } from "@/components/pulsemap/AppShell";
import { formatDateTime, formatDuration, formatMoney, toneMeta } from "@/components/pulsemap/tone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Check, Clock, Loader2, MapPin, Star, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

export default function TrailDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const trail = useQuery(api.experiences.getBySlug, slug ? { slug } : "skip");
  const slots = useQuery(
    api.experiences.availability,
    slug ? { slug, days: 21 } : "skip",
  );
  const createBooking = useMutation(api.bookings.create);
  const createOrder = useMutation(api.orders.createForBooking);

  const [startsAt, setStartsAt] = useState<number | null>(null);
  const [partySize, setPartySize] = useState("2");
  const [guestName, setGuestName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => {
    const grouped = new Map<string, { startsAt: number; remaining: number; label: string }[]>();
    for (const slot of slots ?? []) {
      const key = new Date(slot.startsAt).toDateString();
      const bucket = grouped.get(key);
      if (bucket) bucket.push(slot);
      else grouped.set(key, [slot]);
    }
    return Array.from(grouped.values());
  }, [slots]);

  if (trail === undefined) {
    return (
      <PulseShell eyebrow="Guided trail" title="Loading the route">
        <p className="text-sm text-muted-foreground">Fetching the trail…</p>
      </PulseShell>
    );
  }

  if (trail === null) {
    return (
      <PulseShell eyebrow="Guided trail" title="That trail is not on the map">
        <p className="text-sm text-muted-foreground">
          <Link to="/explore" className="underline">
            Back to the catalogue
          </Link>{" "}
          to pick another route.
        </p>
      </PulseShell>
    );
  }

  const meta = toneMeta(trail.tone);
  const total = trail.priceCents * Number(partySize || "1");

  async function handleBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!startsAt) {
      setError("Choose a date and a start time first.");
      return;
    }
    setSaving(true);
    try {
      const bookingId = await createBooking({
        slug: trail!.slug,
        startsAt,
        partySize: Number(partySize),
        guestName,
        email,
        phone: phone || undefined,
        notes: notes || undefined,
      });
      const orderId = await createOrder({ bookingId, method: "on_arrival" });
      navigate(`/checkout/${orderId}`);
    } catch (bookingError) {
      setError(
        bookingError instanceof Error ? bookingError.message : "The booking was not saved.",
      );
      setSaving(false);
    }
  }

  return (
    <PulseShell
      eyebrow={`${trail.city} · ${formatDuration(trail.durationMinutes)}`}
      title={trail.title}
      description={trail.summary}
      actions={
        <Button asChild variant="outline" className="gap-2 rounded-sm border-[var(--rule)]">
          <Link to="/explore">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All trails
          </Link>
        </Button>
      }
    >
      <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <div
            className="relative h-72 overflow-hidden border border-[var(--rule)]"
            style={{
              background: `linear-gradient(180deg, ${meta.hex}1f 0%, ${meta.hex}55 100%)`,
            }}
          >
            <img
              src={trail.imageUrl}
              alt=""
              className="absolute bottom-0 left-1/2 h-[94%] w-auto max-w-none -translate-x-1/2 object-contain"
            />
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-1"
              style={{ background: meta.hex }}
            />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-px border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-4">
            {[
              {
                label: "Duration",
                value: formatDuration(trail.durationMinutes),
                icon: Clock,
              },
              { label: "Group", value: `Up to ${trail.capacity}`, icon: Users },
              { label: "Guide", value: trail.guide, icon: MapPin },
              {
                label: "Rating",
                value: `${trail.rating.toFixed(1)} (${trail.reviewCount})`,
                icon: Star,
              },
            ].map((item) => (
              <div key={item.label} className="bg-card px-4 py-4">
                <p className="micro-label">{item.label}</p>
                <p className="mt-2 flex items-center gap-1.5 text-sm">
                  <item.icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{item.value}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <SectionHeading label="What this walk is" title="About the route" />
            <p className="max-w-3xl text-base leading-8">{trail.description}</p>
            <ul className="mt-6 hairline-grid border border-[var(--rule)] bg-card">
              {trail.highlights.map((highlight) => (
                <li key={highlight} className="flex items-center gap-3 px-5 py-4 text-sm">
                  <Check className="size-4 shrink-0 text-[var(--tone-quiet)]" aria-hidden="true" />
                  {highlight}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <aside>
          <form
            onSubmit={handleBooking}
            className="border border-[var(--rule)] bg-card px-5 py-6 lg:sticky lg:top-24"
          >
            <p className="micro-label">Book a place</p>
            <p className="font-display mt-3 text-3xl leading-none">
              {formatMoney(trail.priceCents, trail.currency)}
              <span className="ml-2 align-middle font-sans text-xs tracking-wide text-muted-foreground uppercase">
                per person
              </span>
            </p>

            <div className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>Choose a start time</Label>
                <Select
                  value={startsAt ? String(startsAt) : ""}
                  onValueChange={(value) => setStartsAt(Number(value))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick a day and hour" />
                  </SelectTrigger>
                  <SelectContent>
                    {days.length === 0 ? (
                      <SelectItem value="none" disabled>
                        No open slots in the next three weeks
                      </SelectItem>
                    ) : (
                      days.flatMap((group) =>
                        group.map((slot) => (
                          <SelectItem key={slot.startsAt} value={String(slot.startsAt)}>
                            {formatDateTime(slot.startsAt)} · {slot.remaining} left
                          </SelectItem>
                        )),
                      )
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Slots run three times a day, three weeks ahead. Seats update live.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="party">People</Label>
                <Select value={partySize} onValueChange={setPartySize}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: Math.min(trail.capacity, 8) }).map((_, index) => (
                      <SelectItem key={index + 1} value={String(index + 1)}>
                        {index + 1} {index === 0 ? "person" : "people"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="guest">Name on the booking</Label>
                <Input
                  id="guest"
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="phone">Phone, optional</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="notes">Anything the guide should know</Label>
                <Textarea
                  id="notes"
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Slow pace, one wheelchair, a birthday…"
                />
              </div>
            </div>

            <div className="mt-6 flex items-end justify-between border-t border-[var(--rule)] pt-5">
              <div>
                <p className="micro-label">Total</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {Number(partySize)} × {formatMoney(trail.priceCents, trail.currency)}
                </p>
              </div>
              <p className="font-display text-3xl leading-none">
                {formatMoney(total, trail.currency)}
              </p>
            </div>

            {error ? (
              <p className="mt-4 border-l-2 border-[var(--destructive)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--destructive)]">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="mt-5 w-full rounded-sm" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Reserve my place
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              You choose how to pay on the next step.
            </p>
          </form>

          <p className={cn("mt-4 text-xs leading-5 text-muted-foreground")}>
            Free cancellation up to 24 hours before the walk. Times are shown in your
            device's clock.
          </p>
        </aside>
      </div>
    </PulseShell>
  );
}
