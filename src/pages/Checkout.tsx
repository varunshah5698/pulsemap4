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

const OUTLINE_BUTTON =
  "h-11 gap-2 rounded-full border-white/12 bg-transparent px-5 text-white/85 hover:bg-white/5";

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
        <p className="text-sm text-white/50">Fetching the booking…</p>
      </PulseShell>
    );
  }

  if (order === null) {
    return (
      <PulseShell eyebrow="Checkout" title="That order is not available">
        <p className="text-sm text-white/50">
          <Link to="/dashboard" className="text-[#ff6a2c] hover:underline">
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
        <Button asChild variant="outline" className={OUTLINE_BUTTON}>
          <Link to="/dashboard">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Dashboard
          </Link>
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          {paid || confirmed ? (
            <div className="pm-panel p-6">
              <span className="grid size-11 place-items-center rounded-full bg-[#ff6a2c] text-white">
                <BadgeCheck className="size-5" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-white">
                {paid ? "Payment received" : "Seat confirmed"}
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-white/55">
                {paid
                  ? "Your card payment went through and the booking is locked in."
                  : "Your place is held and you will settle up with the guide on the day. Bring the name on the booking."}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild className="h-11 rounded-full px-5 font-semibold">
                  <Link to="/dashboard">See it on the dashboard</Link>
                </Button>
                {order.experienceSlug ? (
                  <Button asChild variant="outline" className={OUTLINE_BUTTON}>
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
                    "flex flex-col items-start gap-2 rounded-[26px] border p-5 text-left transition-colors",
                    method === "card"
                      ? "border-[#ff6a2c] bg-[#ff6a2c]/10"
                      : "border-white/[0.07] bg-[#17171a] hover:border-white/20",
                  )}
                >
                  <CreditCard
                    className={cn(
                      "size-5",
                      method === "card" ? "text-[#ff6a2c]" : "text-white/50",
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-lg font-bold text-white">Card payment</span>
                  <span className="text-xs leading-5 text-white/50">
                    Secure Stripe checkout. Confirms instantly and emails a receipt.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMethod("on_arrival")}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-[26px] border p-5 text-left transition-colors",
                    method === "on_arrival"
                      ? "border-[#ff6a2c] bg-[#ff6a2c]/10"
                      : "border-white/[0.07] bg-[#17171a] hover:border-white/20",
                  )}
                >
                  <Wallet
                    className={cn(
                      "size-5",
                      method === "on_arrival" ? "text-[#ff6a2c]" : "text-white/50",
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-lg font-bold text-white">
                    Pay the guide on the day
                  </span>
                  <span className="text-xs leading-5 text-white/50">
                    The seat is held now. Settle in cash or by card at the meeting point.
                  </span>
                </button>
              </div>

              {notice ? (
                <p className="mt-5 rounded-2xl border-l-2 border-[#ff6a2c] bg-[#ff6a2c]/10 px-4 py-3 text-sm leading-6 text-white/80">
                  {notice}
                </p>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  className="h-11 rounded-full px-5 font-semibold"
                  disabled={busy}
                  onClick={method === "card" ? payByCard : payOnArrival}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {method === "card"
                    ? `Pay ${formatMoney(order.amountCents, order.currency)}`
                    : "Confirm my seat"}
                </Button>
                <span className="flex items-center gap-2 text-xs text-white/40">
                  <Lock className="size-3.5" aria-hidden="true" />
                  Card details are handled by Stripe, never by Pulsemap.
                </span>
              </div>
            </>
          )}
        </div>

        <aside className="pm-panel h-fit p-5">
          <span className="pm-chip">Order summary</span>
          <h2 className="mt-4 text-lg font-bold tracking-[-0.015em] text-white">
            {order.experienceTitle}
          </h2>
          <dl className="mt-5 flex flex-col gap-3 border-y border-white/[0.07] py-5 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-white/40">Starts</dt>
              <dd className="text-white/85">
                {order.startsAt ? formatDateTime(order.startsAt) : "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-white/40">People</dt>
              <dd className="text-white/85">{order.partySize ?? 1}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-white/40">Booked for</dt>
              <dd className="truncate text-white/85">{order.guestName}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-white/40">Status</dt>
              <dd className="text-white/85 capitalize">
                {order.status.replace("_", " ")}
              </dd>
            </div>
          </dl>
          <div className="mt-5 flex items-end justify-between gap-4">
            <span className="micro-label">Total</span>
            <p className="text-2xl leading-none font-bold text-white tabular-nums">
              {formatMoney(order.amountCents, order.currency)}
            </p>
          </div>
        </aside>
      </div>
    </PulseShell>
  );
}
