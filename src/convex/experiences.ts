import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./access";

export const list = query({
  args: {
    search: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const term = args.search?.trim() ?? "";
    let items;
    if (term.length > 0) {
      items = await ctx.db
        .query("experiences")
        .withSearchIndex("search_title", (q) =>
          q.search("title", term).eq("published", true),
        )
        .take(60);
    } else {
      items = await ctx.db.query("experiences").take(60);
      items = items.filter((item) => item.published);
    }
    const filtered = args.city
      ? items.filter((item) => item.city.toLowerCase() === args.city!.toLowerCase())
      : items;
    return filtered.sort((a, b) => a.priceCents - b.priceCents);
  },
});

export const cities = query({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("experiences").collect();
    const set = new Set(items.filter((item) => item.published).map((item) => item.city));
    return Array.from(set).sort();
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("experiences")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

/** Open time slots for the next three weeks, with seats left on each. */
export const availability = query({
  args: { slug: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const experience = await ctx.db
      .query("experiences")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!experience) return [];

    const horizon = Math.min(Math.max(args.days ?? 14, 1), 42);
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_experience_start", (q) => q.eq("experienceId", experience._id))
      .collect();

    const dayMs = 24 * 60 * 60 * 1000;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);

    const slots: Array<{ startsAt: number; remaining: number; label: string }> = [];
    for (let day = 0; day < horizon; day += 1) {
      const base = start.getTime() + day * dayMs;
      for (const hour of [9, 13, 17]) {
        const startsAt = base + hour * 60 * 60 * 1000;
        if (startsAt < Date.now() + 2 * 60 * 60 * 1000) continue;
        const taken = bookings
          .filter((booking) => booking.startsAt === startsAt && booking.status !== "cancelled")
          .reduce((sum, booking) => sum + booking.partySize, 0);
        slots.push({
          startsAt,
          remaining: Math.max(0, experience.capacity - taken),
          label: `${hour.toString().padStart(2, "0")}:00`,
        });
      }
    }
    return slots;
  },
});

/** Loads the starter catalogue of guided memory walks. Safe to call twice. */
export const seedCatalog = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    const existing = await ctx.db.query("experiences").collect();
    if (existing.length > 0) return { seeded: 0 };

    const stamp = (
      slug: string,
      title: string,
      summary: string,
      description: string,
      city: string,
      lat: number,
      lng: number,
      durationMinutes: number,
      priceCents: number,
      capacity: number,
      guide: string,
      tone: "quiet" | "golden" | "bright" | "storm" | "night",
      imageUrl: string,
      highlights: string[],
      rating: number,
      reviewCount: number,
    ) => ({
      slug,
      title,
      summary,
      description,
      city,
      country: "Bosnia and Herzegovina",
      lat,
      lng,
      durationMinutes,
      priceCents,
      currency: "eur",
      capacity,
      guide,
      tone,
      imageUrl,
      highlights,
      rating,
      reviewCount,
      published: true,
      createdAt: Date.now(),
    });

    const catalog = [
      stamp(
        "stari-most-memory-walk",
        "The Stari Most memory walk",
        "Two hours along the Neretva, pinning the bridge from four angles.",
        "We start before the crowds, cross the arch twice, and stop wherever the light asks us to. You leave with a map of pins, a short written note for each one, and the habit of noticing.",
        "Mostar",
        43.3373,
        17.8149,
        120,
        3800,
        12,
        "Amra Delic",
        "golden",
        "https://raft-blast-61784561.figma.site/_assets/v11/c6a6d8ef49bca43f708aa852692942c45ec950d4.png",
        ["Four bridge viewpoints", "Written note per pin", "Small group of twelve"],
        4.9,
        128,
      ),
      stamp(
        "kujundziluk-copper-quarter",
        "The copper quarter hour by hour",
        "An evening in the old bazaar, one craftsperson at a time.",
        "Kujundziluk is a single street that has been working for five centuries. We visit three workshops, learn what a hand-hammered tray should sound like, and pin the stories that are not in any guidebook.",
        "Mostar",
        43.3379,
        17.8158,
        90,
        2600,
        10,
        "Emir Softic",
        "bright",
        "https://raft-blast-61784561.figma.site/_assets/v11/864afe00e41e2fa20a5aa546e15cb807e0f81384.png",
        ["Three working workshops", "Coffee and sweets included", "Ten-person group"],
        4.8,
        94,
      ),
      stamp(
        "neretva-riverside-evenings",
        "Riverside evenings on the Neretva",
        "Late light, cold water, and the slowest two hours of your trip.",
        "A deliberately unhurried walk along the east bank while the town cools down. We end at a riverside table with tasting plates and a stack of blank cards for the notes you did not know you wanted to write.",
        "Mostar",
        43.3361,
        17.8136,
        150,
        4400,
        14,
        "Lejla Hadzic",
        "quiet",
        "https://raft-blast-61784561.figma.site/_assets/v11/ba75252bab2b1c510987b74837770f7bc8a6b2d4.png",
        ["Golden-hour route", "Tasting plates", "Printed memory map"],
        4.9,
        76,
      ),
      stamp(
        "blagaj-spring-day",
        "Blagaj spring, full day",
        "From the old town to the mouth of the Buna, with a picnic at the cliff.",
        "Half a day out of Mostar to the strongest spring in the region. We take the ridge road, walk the last kilometre, and spend an hour at the water with no schedule at all. Transport and picnic included.",
        "Blagaj",
        43.2569,
        17.9006,
        300,
        7200,
        8,
        "Amra Delic",
        "storm",
        "https://raft-blast-61784561.figma.site/_assets/v11/7536d7b60a1fce482cf6edf3f0bffd3bad5d0f8a.png",
        ["Return transport", "Ridge walking route", "Picnic at the spring"],
        4.7,
        52,
      ),
      stamp(
        "context-session-war-photo",
        "Context session: reporting the siege",
        "Seventy-five careful minutes with a local historian.",
        "The recent history of Mostar is not a sightseeing stop. A historian walks you through the exhibition room by room, answers what you actually want to ask, and leaves you with a reading list rather than a souvenir.",
        "Mostar",
        43.3388,
        17.8131,
        75,
        2200,
        16,
        "Emir Softic",
        "night",
        "https://raft-blast-61784561.figma.site/_assets/v11/16b5007d9c93971e26ffe4e0e3e37946f6bd538c.png",
        ["Local historian guide", "Reading list to take away", "Group of sixteen"],
        5,
        38,
      ),
    ];

    for (const item of catalog) await ctx.db.insert("experiences", item);
    return { seeded: catalog.length };
  },
});
