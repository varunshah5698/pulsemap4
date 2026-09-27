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
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Check, Clock, Loader2, MapPin, Star, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

const OUTLINE_BUTTON =
  "h-11 gap-2 rounded-full border-white/12 bg-transparent px-5 text-white/85 hover:bg-white/5";

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
        <p className="text-sm text-white/50">Fetching the trail…</p>
      </PulseShell>
    );
  }

  if (trail === null) {
    return (
      <PulseShell eyebrow="Guided trail" title="That trail is not on the map">
        <p className="text-sm text-white/50">
          <Link to="/explore" className="text-[#ff6a2c] hover:underline">
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
        <Button asChild variant="outline" className={OUTLINE_BUTTON}>
          <Link to="/explore">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All trails
          </Link>
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <div
            className="pm-panel relative h-72 overflow-hidden"
            style={{
              background: `linear-gradient(160deg, ${meta.hex}66 0%, ${meta.hex}22 100%)`,
            }}
          >
            <img
              src={trail.imageUrl}
              alt=""
              className="absolute bottom-0 left-1/2 h-[94%] w-auto max-w-none -translate-x-1/2 object-contain"
            />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
              <div key={item.label} className="pm-panel-soft px-4 py-4">
                <p className="micro-label">{item.label}</p>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-white/85">
                  <item.icon
                    className="size-3.5 shrink-0 text-[#ff6a2c]"
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.value}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-9">
            <SectionHeading label="What this walk is" title="About the route" />
            <p className="max-w-3xl text-[15px] leading-8 text-white/75">
              {trail.description}
            </p>
            <ul className="pm-panel hairline-grid mt-5 overflow-hidden">
              {trail.highlights.map((highlight) => (
                <li key={highlight} className="flex items-center gap-3 px-5 py-4 text-sm">
                  <Check className="size-4 shrink-0 text-[#ff6a2c]" aria-hidden="true" />
                  <span className="text-white/80">{highlight}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <aside>
          <form onSubmit={handleBooking} className="pm-panel p-5 lg:sticky lg:top-6">
            <div className="flex items-baseline justify-between gap-3">
              <span className="pm-chip">Book a place</span>
              <span className="text-[11px] text-white/45">Free cancellation · 24h</span>
            </div>

            <p className="mt-4 flex items-baseline gap-2">
              <span className="pm-metric">
                {formatMoney(trail.priceCents, trail.currency)}
              </span>
              <span className="pm-metric-unit">per person</span>
            </p>

            <div className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label className="text-white/70">Choose a start time</Label>
                <Select
                  value={startsAt ? String(startsAt) : ""}
                  onValueChange={(value) => setStartsAt(Number(value))}
                >
                  <SelectTrigger className="h-11 w-full rounded-2xl">
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
                <p className="text-xs text-white/40">
                  Slots run three times a day, three weeks ahead. Seats update live.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="party" className="text-white/70">
                  People
                </Label>
                <Select value={partySize} onValueChange={setPartySize}>
                  <SelectTrigger className="h-11 w-full rounded-2xl">
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
                <Label htmlFor="guest" className="text-white/70">
                  Name on the booking
                </Label>
                <Input
                  id="guest"
                  className="h-11 rounded-2xl"
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-white/70">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  className="h-11 rounded-2xl"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="phone" className="text-white/70">
                  Phone, optional
                </Label>
                <Input
                  id="phone"
                  className="h-11 rounded-2xl"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="notes" className="text-white/70">
                  Anything the guide should know
                </Label>
                <Textarea
                  id="notes"
                  rows={3}
                  className="rounded-2xl"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Slow pace, one wheelchair, a birthday…"
                />
              </div>
            </div>

            <div className="mt-6 flex items-end justify-between gap-4 border-t border-white/[0.07] pt-5">
              <div>
                <p className="micro-label">Total</p>
                <p className="mt-2 text-xs text-white/45">
                  {Number(partySize)} × {formatMoney(trail.priceCents, trail.currency)}
                </p>
              </div>
              <p className="text-2xl leading-none font-bold text-white tabular-nums">
                {formatMoney(total, trail.currency)}
              </p>
            </div>

            {error ? (
              <p className="mt-4 rounded-2xl border-l-2 border-[var(--destructive)] bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              className="mt-5 h-11 w-full rounded-full font-semibold"
              disabled={saving}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Reserve my place
            </Button>
            <p className="mt-3 text-center text-xs text-white/40">
              You choose how to pay on the next step.
            </p>
          </form>
        </aside>
      </div>
    </PulseShell>
  );
}
