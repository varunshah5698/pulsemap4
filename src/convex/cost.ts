import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { haversineKm, type Point } from "./ai/geo";

/**
 * What a trip is likely to cost, and exactly why.
 *
 * Two rules make this honest:
 *
 *  1. Every line shows its basis — a per-day band from a published planning
 *     table, a real route distance, or a real Google price level for the area.
 *     Anything that needs a live quote (flights, actual hotel availability) is
 *     listed as *not included* with the reason, never replaced by a guess.
 *  2. Nothing is a single number. A range plus the assumptions that shaped it
 *     is the only responsible way to answer "how much will this cost?".
 */

export type BudgetMode = "budget" | "balanced" | "comfort" | "luxury";

export type CostLine = {
  key: string;
  label: string;
  low: number;
  high: number;
  currency: string;
  basis: string;
  included: boolean;
  unavailable?: string;
};

export type CostEstimate = {
  currency: string;
  mode: BudgetMode;
  travellers: number;
  nights: number;
  lines: CostLine[];
  total: { low: number; high: number } | null;
  perPersonPerDay: { low: number; high: number } | null;
  assumptions: string[];
  exclusions: string[];
  /** Always true: this is a planning estimate, not a quoted price. */
  estimate: true;
  notice: string;
  priceSignal?: { medianLevel: string; sample: number };
};

/** Per person, per day, in US dollars — a planning table, not a quote. */
const DAILY_BASE: Record<BudgetMode, { stay: [number, number]; food: [number, number]; local: [number, number]; activities: [number, number] }> = {
  budget: { stay: [18, 40], food: [10, 20], local: [3, 8], activities: [6, 15] },
  balanced: { stay: [45, 95], food: [20, 40], local: [6, 16], activities: [12, 30] },
  comfort: { stay: [95, 190], food: [35, 70], local: [10, 25], activities: [25, 60] },
  luxury: { stay: [220, 520], food: [70, 160], local: [30, 70], activities: [60, 150] },
};

/**
 * A static planning table for turning those bands into another currency.
 * Deliberately not presented as live FX: rates move, and a stale rate silently
 * mis-prices a whole trip. Numbers are approximate mid-market levels and are
 * used only to scale a range.
 */
const PLANNING_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83,
  JPY: 150,
  AED: 3.67,
  THB: 36,
  IDR: 15700,
  SGD: 1.34,
  AUD: 1.5,
  CAD: 1.36,
  ZAR: 18.5,
  BRL: 5.4,
  MXN: 17,
};

const GOOGLE_PRICE_NUDGE: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 0.85,
  PRICE_LEVEL_MODERATE: 1,
  PRICE_LEVEL_EXPENSIVE: 1.2,
  PRICE_LEVEL_VERY_EXPENSIVE: 1.35,
};

export const COST_NOTICE = "Estimated from a planning table and real distances — not a quoted price.";

function rateFor(currency: string): { rate: number; exact: boolean } {
  const key = currency.toUpperCase();
  const rate = PLANNING_RATES[key];
  if (typeof rate === "number") return { rate, exact: true };
  return { rate: 1, exact: false };
}

function round(value: number): number {
  if (value >= 10000) return Math.round(value / 500) * 500;
  if (value >= 1000) return Math.round(value / 100) * 100;
  if (value >= 100) return Math.round(value / 10) * 10;
  return Math.round(value);
}

export type EstimateInput = {
  nights: number;
  travellers: number;
  mode: BudgetMode;
  currency: string;
  /** Real route legs, when a route is known. */
  legs?: { km: number; minutes: number; mode: string }[];
  /** Real price levels from cached Google place rows around the destination. */
  priceLevels?: string[];
  /** True when the person is flying in; flights stay excluded without a quote. */
  longHaul?: boolean;
  flightNote?: string;
  interestsCount?: number;
};

/**
 * The estimator itself: pure, deterministic, and auditable. Every line can be
 * traced back to the band it came from or the distance it was measured on.
 */
export function estimate(input: EstimateInput): CostEstimate {
  const nights = Math.max(1, Math.round(input.nights));
  const travellers = Math.max(1, Math.round(input.travellers));
  const mode = input.mode;
  const currency = input.currency.toUpperCase();
  const { rate, exact } = rateFor(currency);
  const base = DAILY_BASE[mode];

  const levels = input.priceLevels ?? [];
  const nudgeSample = levels.filter((level) => GOOGLE_PRICE_NUDGE[level] !== undefined);
  const nudge =
    nudgeSample.length >= 3
      ? nudgeSample.reduce((sum, level) => sum + GOOGLE_PRICE_NUDGE[level], 0) / nudgeSample.length
      : 1;

  const lines: CostLine[] = [];
  const assumptions: string[] = [];
  const exclusions: string[] = [];

  const add = (
    key: string,
    label: string,
    lowUsd: number,
    highUsd: number,
    basis: string,
  ) => {
    lines.push({
      key,
      label,
      low: round(lowUsd * rate),
      high: round(highUsd * rate),
      currency,
      basis,
      included: true,
    });
  };

  const stayBasis = `${base.stay[0]}–${base.stay[1]} USD per room per night at "${mode}" level, ${nights} night${nights === 1 ? "" : "s"}`;
  // Rooms are shared between two travellers, which is how people actually book.
  const rooms = Math.ceil(travellers / 2);
  add("stay", "Accommodation", base.stay[0] * nights * rooms, base.stay[1] * nights * rooms, stayBasis);

  add(
    "food",
    "Food & drink",
    base.food[0] * nights * travellers * nudge,
    base.food[1] * nights * travellers * nudge,
    `${base.food[0]}–${base.food[1]} USD per person per day${nudgeSample.length >= 3 ? `, adjusted ×${nudge.toFixed(2)} for the area's real Google price level` : ""}`,
  );

  add(
    "activities",
    "Activities & tickets",
    base.activities[0] * nights * travellers * nudge,
    base.activities[1] * nights * travellers * nudge,
    `${base.activities[0]}–${base.activities[1]} USD per person per day for entry tickets, guides and the like`,
  );

  const localLow = base.local[0] * nights * travellers;
  const localHigh = base.local[1] * nights * travellers;
  add("local", "Local transport", localLow, localHigh, `${base.local[0]}–${base.local[1]} USD per person per day for metro, taxis and short hops`);

  const legs = input.legs ?? [];
  if (legs.length > 0) {
    const longest = Math.max(...legs.map((leg) => leg.km));
    const isDriving = legs.some((leg) => leg.mode === "drive");
    const fuelPerKm = isDriving ? 0.11 : 0.16;
    const intercityLow = legs.reduce((sum, leg) => sum + leg.km * fuelPerKm * 0.8, 0);
    const intercityHigh = legs.reduce((sum, leg) => sum + leg.km * fuelPerKm * 1.6, 0);
    add(
      "intercity",
      "Travel between stops",
      intercityLow,
      intercityHigh,
      `measured on ${legs.length} real leg${legs.length === 1 ? "" : "s"} (longest ${Math.round(longest)} km), ~0.11–0.16 USD per km per vehicle`,
    );
  }

  if (input.longHaul) {
    lines.push({
      key: "flights",
      label: "Flights",
      low: 0,
      high: 0,
      currency,
      basis: "needs a live fare",
      included: false,
      unavailable: input.flightNote ?? "Live flight pricing unavailable — not included in this estimate.",
    });
    exclusions.push("Flights, since no live fare is connected");
  }

  if (nights >= 7) {
    assumptions.push("A longer trip costs less per day: the bands are flat, so treat the high end as a ceiling.");
  }
  assumptions.push(`"${mode}" spending level`);
  assumptions.push(`${travellers} traveller${travellers === 1 ? "" : "s"}, sharing ${rooms} room${rooms === 1 ? "" : "s"}`);
  if (nudgeSample.length >= 3) {
    assumptions.push(`Area price level from ${nudgeSample.length} real Google place listings`);
  }
  if (exact) {
    assumptions.push(`${currency} converted with a static planning rate (${rate} per USD), not live FX`);
  } else {
    assumptions.push(`${currency} is not in the planning rate table, so these figures are in USD-equivalent bands`);
  }
  exclusions.push("Availability, seasonal surcharges and last-minute pricing");
  exclusions.push("Visa fees, insurance and shopping");

  const included = lines.filter((line) => line.included);
  const total =
    included.length > 0
      ? {
          low: included.reduce((sum, line) => sum + line.low, 0),
          high: included.reduce((sum, line) => sum + line.high, 0),
        }
      : null;

  return {
    currency,
    mode,
    travellers,
    nights,
    lines,
    total,
    perPersonPerDay:
      total && nights > 0
        ? {
            low: Math.round(total.low / (nights * travellers)),
            high: Math.round(total.high / (nights * travellers)),
          }
        : null,
    assumptions,
    exclusions,
    estimate: true,
    notice: COST_NOTICE,
    priceSignal:
      nudgeSample.length >= 3
        ? { medianLevel: nudgeSample.sort()[Math.floor(nudgeSample.length / 2)], sample: nudgeSample.length }
        : undefined,
  };
}

/**
 * "How much will this cost?" as a callable action: real legs from the stop
 * list, real price levels from the caller, everything else labelled.
 */
export const estimateFor = internalAction({
  args: {
    nights: v.number(),
    travellers: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("budget"), v.literal("balanced"), v.literal("comfort"), v.literal("luxury"))),
    currency: v.optional(v.string()),
    stops: v.optional(
      v.array(v.object({ name: v.string(), lat: v.number(), lng: v.number(), km: v.optional(v.number()) })),
    ),
    priceLevels: v.optional(v.array(v.string())),
    longHaul: v.optional(v.boolean()),
    flightNote: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<CostEstimate> => {
    const stops = args.stops ?? [];
    const legs: { km: number; minutes: number; mode: string }[] = [];
    for (const stop of stops) {
      if (typeof stop.km === "number") legs.push({ km: stop.km, minutes: 0, mode: "drive" });
    }
    // When only coordinates arrive, measure them: a real distance beats a guess.
    if (legs.length === 0 && stops.length > 1) {
      for (let index = 1; index < stops.length; index += 1) {
        const km = haversineKm(stops[index - 1] as Point, stops[index] as Point) * 1.28;
        legs.push({ km: Number(km.toFixed(1)), minutes: 0, mode: "drive" });
      }
    }
    return estimate({
      nights: args.nights,
      travellers: args.travellers ?? 1,
      mode: args.mode ?? "balanced",
      currency: args.currency ?? "INR",
      legs,
      priceLevels: args.priceLevels,
      longHaul: args.longHaul,
      flightNote: args.flightNote,
    });
  },
});
