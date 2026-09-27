import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Flights, told honestly.
 *
 * There is no free flight-pricing feed, and a made-up fare is worse than no
 * fare: people budget real money against these numbers. So this module speaks
 * to a provider only when one is actually configured (`FLIGHTS_API_BASE_URL` +
 * `FLIGHTS_API_KEY`), and otherwise says so in the same shape it would use for
 * real results — the interface renders "Live flight pricing unavailable"
 * instead of a number nobody can honour.
 */

export const FLIGHTS_UNAVAILABLE =
  "Live flight pricing unavailable — no flight data provider is connected.";

export type FlightOffer = {
  airline: string;
  from: string;
  to: string;
  departAt: string | null;
  arriveAt?: string | null;
  stops: number;
  durationMinutes?: number;
  price: number;
  currency: string;
  bookingUrl?: string;
};

export type FlightSearch = {
  available: boolean;
  source: string;
  offers: FlightOffer[];
  reason?: string;
  checkedAt: number;
};

function provider(): { url: string; key: string; path: string } | null {
  const base = process.env.FLIGHTS_API_BASE_URL?.trim();
  const key = process.env.FLIGHTS_API_KEY?.trim();
  if (!base || !key) return null;
  const path = process.env.FLIGHTS_API_PATH?.trim() ?? "/offers";
  return { url: `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`, key, path };
}

export function flightsConfigured(): boolean {
  return provider() !== null;
}

export const search = internalAction({
  args: {
    from: v.string(),
    to: v.string(),
    departAt: v.optional(v.string()),
    travellers: v.optional(v.number()),
    currency: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<FlightSearch> => {
    const found = provider();
    const checkedAt = Date.now();
    if (!found) {
      return { available: false, source: "none", offers: [], reason: FLIGHTS_UNAVAILABLE, checkedAt };
    }

    let response: Response;
    try {
      response = await fetch(found.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${found.key}` },
        body: JSON.stringify({
          origin: args.from,
          destination: args.to,
          departureDate: args.departAt,
          adults: args.travellers ?? 1,
          currency: args.currency ?? "USD",
        }),
      });
    } catch {
      return {
        available: false,
        source: "provider",
        offers: [],
        reason: "The flight provider could not be reached just now.",
        checkedAt,
      };
    }

    if (!response.ok) {
      return {
        available: false,
        source: "provider",
        offers: [],
        reason:
          response.status === 401 || response.status === 403
            ? "The flight provider rejected the request. Check the flight API key."
            : "The flight provider returned an error.",
        checkedAt,
      };
    }

    const body = (await response.json().catch(() => null)) as { offers?: unknown[] } | null;
    const offers: FlightOffer[] = [];
    for (const raw of body?.offers ?? []) {
      const offer = raw as {
        airline?: string;
        origin?: string;
        destination?: string;
        departAt?: string;
        arriveAt?: string;
        stops?: number;
        durationMinutes?: number;
        price?: number;
        currency?: string;
        bookingUrl?: string;
      };
      if (typeof offer.price !== "number") continue;
      offers.push({
        airline: offer.airline ?? "Unknown carrier",
        from: offer.origin ?? args.from,
        to: offer.destination ?? args.to,
        departAt: offer.departAt ?? null,
        arriveAt: offer.arriveAt ?? null,
        stops: offer.stops ?? 0,
        durationMinutes: offer.durationMinutes,
        price: offer.price,
        currency: offer.currency ?? args.currency ?? "USD",
        bookingUrl: offer.bookingUrl,
      });
    }

    if (offers.length === 0) {
      return {
        available: false,
        source: "provider",
        offers: [],
        reason: "The flight provider had no offers for that pair of airports.",
        checkedAt,
      };
    }

    return { available: true, source: "provider", offers: offers.slice(0, 8), checkedAt };
  },
});
