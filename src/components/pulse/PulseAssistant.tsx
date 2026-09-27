import type { AssistantUi } from "@/convex/assistant";
import { usePulse } from "@/components/pulse/PulseProvider";
import { PulseCard, ProposalRow } from "@/components/pulse/cards";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * The conversational door into Pulse.
 *
 * Desktop: a panel that slides in from the right, sitting above the app rather
 * than replacing it, because the useful thing is usually to look at the map and
 * ask about it at once. Mobile: a bottom sheet that can grow to full height.
 *
 * Everything shown here came from a real call — places, routes, climate,
 * estimates. Cards that would need data we do not have say so.
 */

const SUGGESTIONS = [
  "Where should I go next?",
  "Plan a 5 day trip to Kyoto",
  "What's the best month for me to travel?",
  "Could I do this for ₹60,000?",
  "Show me places like my memories",
  "Find mountain towns I haven't visited",
];

/** Turns a card's action into real navigation, wherever the person is. */
function useUiDispatch() {
  const navigate = useNavigate();
  const location = useLocation();

  return (action: AssistantUi) => {
    const onMap = location.pathname.startsWith("/map");
    if (action.kind === "openPlace" && action.placeId) {
      if (onMap) {
        window.dispatchEvent(new CustomEvent("pulse:open-place", { detail: { placeId: action.placeId } }));
      } else {
        navigate(`/map?place=${encodeURIComponent(action.placeId)}`);
      }
      return;
    }
    if (action.kind === "focusGlobe" || action.kind === "showRoute") {
      const detail = { lat: action.lat, lng: action.lng, spanKm: action.spanKm ?? 60 };
      if (onMap) {
        window.dispatchEvent(new CustomEvent("pulse:focus", { detail }));
      } else if (typeof detail.lat === "number" && typeof detail.lng === "number") {
        navigate(`/map?focus=${detail.lat},${detail.lng},${detail.spanKm}`);
      }
      return;
    }
    if (action.kind === "openTrip" && action.tripId) {
      navigate(`/trips/${action.tripId}`);
    }
  };
}

export function PulseTrigger({ variant = "floating" }: { variant?: "floating" | "bar" }) {
  const { togglePulse, open } = usePulse();
  const location = useLocation();
  // On the map the nav controls own the bottom-right corner, so the launcher
  // steps up out of their way instead of covering them.
  const onMap = location.pathname.startsWith("/map");

  if (variant === "bar") {
    return (
      <button
        type="button"
        onClick={togglePulse}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-1.5 text-[12px] font-semibold text-white/80 transition hover:border-[#ff6a2c]/60 hover:text-white"
      >
        <Sparkles className="size-3.5 text-[#ff6a2c]" aria-hidden="true" />
        Ask Pulse
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={togglePulse}
      aria-expanded={open}
      aria-label="Open Pulse, your travel assistant"
      className={`pm-pulse-launcher ${onMap ? "bottom-24 lg:bottom-6 lg:right-6" : "bottom-5 right-5"}`}
    >
      <Sparkles className="size-5" aria-hidden="true" />
      <span className="pm-pulse-launcher-label">Pulse</span>
    </button>
  );
}

export function PulseAssistant() {
  const { open, closePulse, turns, asking, ask, seed, clearSeed, confirmProposal } = usePulse();
  const dispatch = useUiDispatch();
  /**
   * A surface can open Pulse with a question already framed. The seed is the
   * value the box shows until the person types over it, so nothing has to be
   * copied into state when it arrives.
   */
  const [typed, setTyped] = useState<{ seed: string | null; value: string }>({
    seed: null,
    value: "",
  });
  const draft = typed.seed === seed ? typed.value : (seed ?? "");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open && seed) inputRef.current?.focus();
  }, [open, seed]);

  function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    setTyped({ seed: null, value: "" });
    clearSeed();
    void ask(trimmed);
  }

  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [open, turns.length, asking]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closePulse();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePulse, open]);

  if (!open) return null;

  const empty = turns.length === 0;

  return (
    <>
      <button
        type="button"
        aria-label="Close Pulse"
        className="pm-pulse-scrim"
        onClick={closePulse}
      />
      <aside className="pm-pulse-panel" role="dialog" aria-label="Pulse assistant">
        <header className="pm-pulse-head">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-full bg-[#ff6a2c]/15">
              <Sparkles className="size-4 text-[#ff6a2c]" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[13px] font-bold tracking-[-0.01em] text-white">Pulse</p>
              <p className="text-[11px] text-white/45">Travel intelligence for your own map</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closePulse}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full border border-white/10 text-white/60 transition hover:text-white"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div ref={scrollRef} className="pm-pulse-thread">
          {empty ? (
            <div className="space-y-3">
              <p className="text-[12px] leading-6 text-white/60">
                Ask about anywhere on your map, your own memories, what a trip would cost, or when to
                go. I answer from your history and real place data — and I will say when something
                is not available rather than guess.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void ask(suggestion)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-white/70 transition hover:border-[#ff6a2c]/50 hover:text-white"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {turns.map((turn) =>
            turn.role === "user" ? (
              <div key={turn.id} className="pm-pulse-msg pm-pulse-msg-user">
                {turn.text}
              </div>
            ) : (
              <div key={turn.id} className="space-y-2">
                <div className={`pm-pulse-msg ${turn.error ? "pm-pulse-msg-error" : ""}`}>{turn.text}</div>
                {turn.cards?.map((card, index) => (
                  <PulseCard
                    key={`${turn.id}-card-${index}`}
                    card={card}
                    ui={turn.ui?.filter((action) => {
                      if (action.kind === "openPlace") return card.type === "place" && action.placeId === card.placeId;
                      if (action.kind === "focusGlobe") return card.type === "destination";
                      return card.type === "route" || card.type === "itinerary";
                    }) ?? []}
                    onUi={dispatch}
                  />
                ))}
                {turn.proposals && turn.proposals.length > 0 ? (
                  <ProposalRow proposals={turn.proposals} onConfirm={(proposal) => void confirmProposal(proposal)} />
                ) : null}
                {turn.followUps && turn.followUps.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {turn.followUps.map((followUp) => (
                      <button
                        key={followUp}
                        type="button"
                        onClick={() => void ask(followUp)}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/65 transition hover:border-[#ff6a2c]/50 hover:text-white"
                      >
                        {followUp}
                      </button>
                    ))}
                  </div>
                ) : null}
                {turn.sources && turn.sources.length > 0 ? (
                  <p className="text-[10px] leading-4 text-white/30">Sources: {turn.sources.join(" · ")}</p>
                ) : null}
              </div>
            ),
          )}

          {asking ? (
            <div className="pm-pulse-msg flex items-center gap-2 text-white/50">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Reading your map and real place data…
            </div>
          ) : null}
        </div>

        <form
          className="pm-pulse-compose"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setTyped({ seed, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            rows={2}
            placeholder="Ask about a place, a trip, a budget or a month…"
            className="pm-pulse-input"
          />
          <button
            type="submit"
            disabled={asking || draft.trim().length === 0}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ff6a2c] text-white transition hover:brightness-110 disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="size-4" aria-hidden="true" />
          </button>
        </form>
      </aside>
    </>
  );
}
