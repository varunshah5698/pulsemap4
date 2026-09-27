import { PulseShell, SectionHeading } from "@/components/pulsemap/AppShell";
import { formatDateTime, formatMoney } from "@/components/pulsemap/tone";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  BadgeCheck,
  CreditCard,
  Loader2,
  Lock,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

export default function Checkout() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const cancelled = searchParams.get("cancelled") === "1";

  const order = useQuery(
    api.orders.get,
    orderId ? { id: orderId as Id<"orders"> } : "skip",
  );
  const createSession = useAction(api.payments.createCheckoutSession);
  const confirmOnArrival = useMutation(api.orders.confirmOnArrival);

  const [method, setMethod] = useState<"card" | "on_arrival">("card");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    cancelled ? "The card payment was cancelled. Your booking is still held." : null,
  );
  const [done, setDone] = useState(false);

  if (order === undefined) {
    return (
      <PulseShell eyebrow="Checkout" title="Loading your order">
        <p className="text-sm text-muted-foreground">Fetching the booking…</p>
      </PulseShell>
    );
  }

  if (order === null) {
    return (
      <PulseShell eyebrow="Checkout" title="That order is not available">
        <p className="text-sm text-muted-foreground">
          <Link to="/dashboard" className="underline">
            Back to your dashboard
          </Link>
        </p>
      </PulseShell>
    );
  }

  const paid = order.status === "paid";
  const confirmed = order.status === "requires_payment" && done;

  async function payByCard() {
    setNotice(null);
    setBusy(true);
    try {
      const result = await createSession({
        orderId: order!._id,
        origin: window.location.origin,
      });
      if (result.configured && result.url) {
        window.location.href = result.url;
        return;
      }
      setNotice(
        "Card payments need a Stripe key on this deployment. Add STRIPE_SECRET_KEY in the Keys tab, or choose to pay the guide on the day.",
      );
      setMethod("on_arrival");
    } catch (cardError) {
      setNotice(
        cardError instanceof Error ? cardError.message : "Stripe could not be reached.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function payOnArrival() {
    setNotice(null);
    setBusy(true);
    try {
      await confirmOnArrival({ id: order!._id });
      setDone(true);
    } catch (arrivalError) {
      setNotice(
        arrivalError instanceof Error
          ? arrivalError.message
          : "The booking could not be confirmed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <PulseShell
      eyebrow="Checkout"
      title={paid ? "Paid and confirmed" : "Finish your booking"}
      description="Nothing is charged until you confirm. Card payments run through Stripe; paying the guide on the day keeps the same seat."
      actions={
        <Button asChild variant="outline" className="gap-2 rounded-sm border-[var(--rule)]">
          <Link to="/dashboard">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Dashboard
          </Link>
        </Button>
      }
    >
      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div>
          {paid || confirmed ? (
            <div className="border border-[var(--rule)] bg-card p-6">
              <span className="flex size-10 items-center justify-center rounded-full bg-[var(--tone-quiet)] text-white">
                <BadgeCheck className="size-5" aria-hidden="true" />
              </span>
              <h2 className="font-display mt-4 text-3xl">
                {paid ? "Payment received" : "Seat confirmed"}
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                {paid
                  ? "Your card payment went through and the booking is locked in."
                  : "Your place is held and you will settle up with the guide on the day. Bring the name on the booking."}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild className="rounded-sm">
                  <Link to="/dashboard">See it on the dashboard</Link>
                </Button>
                {order.experienceSlug ? (
                  <Button asChild variant="outline" className="rounded-sm border-[var(--rule)]">
                    <Link to={`/trails/${order.experienceSlug}`}>Back to the trail</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <SectionHeading label="Step two of two" title="How would you like to pay?" />
              <div className="grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMethod("card")}
                  className={cn(
                    "flex flex-col items-start gap-2 border px-5 py-5 text-left transition-colors",
                    method === "card"
                      ? "border-[var(--foreground)] bg-card"
                      : "border-[var(--rule)] text-muted-foreground hover:border-[var(--rule-strong)]",
                  )}
                >
                  <CreditCard className="size-5" aria-hidden="true" />
                  <span className="font-display text-xl">Card payment</span>
                  <span className="text-xs leading-5">
                    Secure Stripe checkout. Confirms instantly and emails a receipt.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMethod("on_arrival")}
                  className={cn(
                    "flex flex-col items-start gap-2 border px-5 py-5 text-left transition-colors",
                    method === "on_arrival"
                      ? "border-[var(--foreground)] bg-card"
                      : "border-[var(--rule)] text-muted-foreground hover:border-[var(--rule-strong)]",
                  )}
                >
                  <Wallet className="size-5" aria-hidden="true" />
                  <span className="font-display text-xl">Pay the guide on the day</span>
                  <span className="text-xs leading-5">
                    The seat is held now. Settle in cash or by card at the meeting point.
                  </span>
                </button>
              </div>

              {notice ? (
                <p className="mt-5 border-l-2 border-[var(--tone-golden)] bg-[var(--muted)] px-4 py-3 text-sm leading-6">
                  {notice}
                </p>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  className="rounded-sm"
                  disabled={busy}
                  onClick={method === "card" ? payByCard : payOnArrival}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {method === "card"
                    ? `Pay ${formatMoney(order.amountCents, order.currency)}`
                    : "Confirm my seat"}
                </Button>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden="true" />
                  Card details are handled by Stripe, never by Pulsemap.
                </span>
              </div>
            </>
          )}
        </div>

        <aside className="border border-[var(--rule)] bg-card px-5 py-6">
          <p className="micro-label">Order summary</p>
          <h2 className="font-display mt-3 text-2xl leading-tight">
            {order.experienceTitle}
          </h2>
          <dl className="mt-5 flex flex-col gap-3 border-y border-[var(--rule)] py-5 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Starts</dt>
              <dd>{order.startsAt ? formatDateTime(order.startsAt) : "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">People</dt>
              <dd>{order.partySize ?? 1}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Booked for</dt>
              <dd>{order.guestName}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="capitalize">{order.status.replace("_", " ")}</dd>
            </div>
          </dl>
          <div className="mt-5 flex items-end justify-between">
            <p className="micro-label">Total</p>
            <p className="font-display text-3xl leading-none">
              {formatMoney(order.amountCents, order.currency)}
            </p>
          </div>
        </aside>
      </div>
    </PulseShell>
  );
}
