import type { AssistantCard, AssistantProposal, AssistantUi } from "@/convex/assistant";
import type { CostEstimate } from "@/convex/cost";
import { ChevronDown, Info, MapPin, Star } from "lucide-react";
import { useState } from "react";

/**
 * Pulse answers in objects, not walls of text.
 *
 * Every card is a rendering of something real: a Google place, a measured
 * route, a climate archive, a planning-table estimate. The "why" is never
 * hidden — any recommendation can be unfolded into the evidence behind it, and
 * anything that was not available is shown as unavailable rather than filled in.
 */

/* --- Small pieces ---------------------------------------------------- */

export function WhyThis({ lines, evidence }: { lines: string[]; evidence?: string[] }) {
  const [open, setOpen] = useState(false);
  const items = [...lines, ...(evidence ?? [])];
  if (items.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/45 transition hover:text-[#ff6a2c]"
      >
        <Info className="size-3.5" aria-hidden="true" />
        Why am I seeing this?
        <ChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <ul className="mt-2 space-y-1 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
          {items.map((line) => (
            <li key={line} className="text-[11px] leading-5 text-white/60">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Stars({ rating, count }: { rating: number; count: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/70">
      <Star className="size-3.5 text-[#ffb347]" aria-hidden="true" />
      {rating.toFixed(1)}
      {count !== null ? <span className="font-normal text-white/40">({count.toLocaleString()})</span> : null}
    </span>
  );
}

function ActionRow({ ui, onUi }: { ui: AssistantUi[]; onUi: (action: AssistantUi) => void }) {
  if (ui.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {ui.map((action) => (
        <button
          key={`${action.kind}-${action.label}`}
          type="button"
          onClick={() => onUi(action)}
          className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-[#ff6a2c]/60 hover:text-white"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function ProposalRow({
  proposals,
  onConfirm,
}: {
  proposals: AssistantProposal[];
  onConfirm: (proposal: AssistantProposal) => void;
}) {
  const [sent, setSent] = useState<string | null>(null);
  if (proposals.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {proposals.map((proposal) => (
        <div
          key={proposal.label}
          className="rounded-xl border border-[#ff6a2c]/25 bg-[#ff6a2c]/[0.07] px-3 py-2.5"
        >
          <p className="text-[11px] leading-5 text-white/70">{proposal.summary}</p>
          <button
            type="button"
            disabled={sent === proposal.label}
            onClick={() => {
              setSent(proposal.label);
              onConfirm(proposal);
            }}
            className="mt-2 rounded-full bg-[#ff6a2c] px-3.5 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {sent === proposal.label ? "Done" : proposal.label}
          </button>
        </div>
      ))}
    </div>
  );
}

function CostTable({ estimate }: { estimate: CostEstimate }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-white">
          {estimate.total
            ? `${estimate.currency} ${estimate.total.low.toLocaleString()}–${estimate.total.high.toLocaleString()}`
            : "No estimate available"}
        </p>
        <p className="text-[11px] text-white/40">
          {estimate.nights} nights · {estimate.mode} · {estimate.travellers} traveller{estimate.travellers === 1 ? "" : "s"}
        </p>
      </div>
      <ul className="space-y-1">
        {estimate.lines.map((line) => (
          <li key={line.key} className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="text-white/55">{line.label}</span>
            <span className={line.included ? "font-medium text-white/80" : "text-white/35"}>
              {line.included ? `${line.currency} ${line.low.toLocaleString()}–${line.high.toLocaleString()}` : "not included"}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] leading-4 text-white/35">{estimate.notice}</p>
      <WhyThis lines={estimate.assumptions.slice(0, 4)} evidence={estimate.exclusions.slice(0, 2)} />
    </div>
  );
}

/* --- The cards ------------------------------------------------------- */

export function PulseCard({
  card,
  ui,
  onUi,
}: {
  card: AssistantCard;
  ui: AssistantUi[];
  onUi: (action: AssistantUi) => void;
}) {
  if (card.type === "place") {
    return (
      <div className="pm-pulse-card">
        <div className="flex items-start gap-3">
          {card.photoUrl ? (
            <img
              src={card.photoUrl}
              alt=""
              className="size-16 shrink-0 rounded-xl object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03]">
              <MapPin className="size-5 text-white/35" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">{card.name}</p>
            <p className="mt-0.5 text-[11px] text-white/45">
              {card.categoryLabel}
              {card.distanceKm !== null ? ` · ${card.distanceKm} km away` : ""}
            </p>
            {card.address ? <p className="mt-1 text-[11px] leading-4 text-white/50">{card.address}</p> : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              {card.rating !== null ? <Stars rating={card.rating} count={card.reviewCount} /> : null}
              {card.openNow !== null ? (
                <span
                  className={`text-[11px] font-semibold ${card.openNow ? "text-[#7ad39b]" : "text-white/40"}`}
                >
                  {card.openNow ? "Open now" : "Closed now"}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {card.why.length > 0 ? <WhyThis lines={card.why} /> : null}
        <ActionRow ui={ui} onUi={onUi} />
      </div>
    );
  }

  if (card.type === "destination") {
    return (
      <div className="pm-pulse-card">
        <p className="text-[13px] font-semibold text-white">{card.name}</p>
        {card.tags.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {card.tags.map((tag) => (
              <span key={tag} className="pm-chip text-[10px]">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        {card.cost ? (
          <p className="mt-2 text-[12px] font-semibold text-[#ffb347]">
            {card.cost.currency} {card.cost.low.toLocaleString()}–{card.cost.high.toLocaleString()} estimated
          </p>
        ) : null}
        {card.bestMonths.length > 0 ? (
          <p className="mt-1 text-[11px] text-white/50">Best months: {card.bestMonths.join(", ")}</p>
        ) : null}
        <WhyThis lines={card.why} evidence={[`Confidence ${Math.round(card.confidence * 100)}%`]} />
        <ActionRow ui={ui} onUi={onUi} />
      </div>
    );
  }

  if (card.type === "cost") {
    return (
      <div className="pm-pulse-card">
        <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-white/40 uppercase">{card.label}</p>
        <CostTable estimate={card.estimate} />
      </div>
    );
  }

  if (card.type === "route") {
    return (
      <div className="pm-pulse-card">
        <p className="text-[13px] font-semibold text-white">{card.label}</p>
        <p className="mt-0.5 text-[11px] text-white/45">
          {card.totalKm} km · {Math.round(card.totalMinutes / 60)}h {card.totalMinutes % 60}m · {card.source}
        </p>
        <ol className="mt-2 space-y-1.5">
          {card.legs.map((leg) => (
            <li key={`${leg.from}-${leg.to}`} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="min-w-0 truncate text-white/60">
                {leg.from} → {leg.to}
              </span>
              <span className="shrink-0 font-medium text-white/80">
                {leg.km} km{leg.estimate ? " ~" : ""}
              </span>
            </li>
          ))}
        </ol>
        {card.note ? <p className="mt-2 text-[11px] leading-4 text-white/45">{card.note}</p> : null}
        {card.estimated ? (
          <p className="mt-1 text-[10px] text-white/35">
            Some legs are straight-line estimates because the routing engine could not answer.
          </p>
        ) : null}
        <ActionRow ui={ui} onUi={onUi} />
      </div>
    );
  }

  if (card.type === "itinerary") {
    return (
      <div className="pm-pulse-card">
        <p className="text-[13px] font-semibold text-white">{card.title}</p>
        <p className="mt-0.5 text-[11px] text-white/45">{card.destination}</p>
        <div className="mt-3 space-y-3">
          {card.days.map((day) => (
            <div key={day.day}>
              <p className="text-[11px] font-semibold tracking-[0.1em] text-[#ff6a2c] uppercase">
                Day {day.day} · {day.theme}
              </p>
              <ul className="mt-1.5 space-y-1">
                {day.items.map((item) => (
                  <li key={`${day.day}-${item.title}`} className="flex items-start gap-2 text-[11px] leading-5">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/25" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="font-medium text-white/85">{item.title}</span>
                      <span className="text-white/40"> · {item.kind}</span>
                      {item.detail ? <span className="block text-white/45">{item.detail}</span> : null}
                      {!item.real ? (
                        <span className="block text-[10px] text-white/30">Suggested — no matching place on the map</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {card.notes.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {card.notes.map((note) => (
              <li key={note} className="text-[11px] leading-5 text-white/45">
                {note}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (card.type === "weather") {
    const best = [...card.months].sort((a, b) => b.comfort - a.comfort).slice(0, 3);
    return (
      <div className="pm-pulse-card">
        <p className="text-[13px] font-semibold text-white">{card.place}</p>
        {card.available ? (
          <>
            {card.now ? (
              <p className="mt-1 text-[12px] text-white/70">
                {card.now.label} · {card.now.maxC}°C day / {card.now.minC}°C night · {card.now.rainMm} mm
              </p>
            ) : null}
            {card.days.length > 0 ? (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {card.days.map((day) => (
                  <div
                    key={day.date}
                    className="min-w-[68px] rounded-xl border border-white/[0.07] bg-white/[0.03] px-2 py-1.5 text-center"
                  >
                    <p className="text-[10px] text-white/40">{day.date.slice(5)}</p>
                    <p className="text-[12px] font-semibold text-white">
                      {day.maxC}° / {day.minC}°
                    </p>
                    <p className="text-[10px] text-white/45">{day.label}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {best.length > 0 ? (
              <p className="mt-2 text-[11px] text-white/50">
                Most comfortable months: {best.map((month) => month.month).join(", ")}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-[11px] text-white/50">{card.reason ?? "Weather is unavailable for this point."}</p>
        )}
        <p className="mt-2 text-[10px] text-white/30">Source: {card.source}</p>
      </div>
    );
  }

  if (card.type === "memory") {
    return (
      <div className="pm-pulse-card">
        <p className="text-[13px] font-semibold text-white">{card.title}</p>
        <p className="mt-0.5 text-[11px] text-white/45">
          {card.placeName} · {new Date(card.happenedAt).toLocaleDateString("en", { month: "short", year: "numeric" })}
        </p>
        {card.why ? <p className="mt-1.5 text-[11px] leading-5 text-white/60">{card.why}</p> : null}
      </div>
    );
  }

  if (card.type === "flight") {
    return (
      <div className="pm-pulse-card">
        <p className="text-[12px] font-semibold text-white">Flights</p>
        {card.available ? (
          <ul className="mt-2 space-y-1">
            {card.offers.map((offer) => (
              <li key={`${offer.airline}-${offer.price}`} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="text-white/60">
                  {offer.airline} · {offer.stops === 0 ? "direct" : `${offer.stops} stop${offer.stops === 1 ? "" : "s"}`}
                </span>
                <span className="font-medium text-white/85">
                  {offer.currency} {offer.price.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[11px] leading-5 text-white/50">{card.reason}</p>
        )}
      </div>
    );
  }

  return (
    <div className="pm-pulse-card">
      <p className="text-[12px] font-semibold text-white">{card.heading}</p>
      <p className="mt-1.5 whitespace-pre-line text-[11px] leading-5 text-white/60">{card.body}</p>
    </div>
  );
}
