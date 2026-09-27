import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

/** The palette a pin, card or trail can carry. Keeps the map colourful but calm. */
export const toneValidator = v.union(
  v.literal("quiet"),
  v.literal("golden"),
  v.literal("bright"),
  v.literal("storm"),
  v.literal("night"),
);
export type Tone = Infer<typeof toneValidator>;

export const visibilityValidator = v.union(
  v.literal("private"),
  v.literal("circle"),
  v.literal("public"),
);
export type Visibility = Infer<typeof visibilityValidator>;

export const bookingStatusValidator = v.union(
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("completed"),
  v.literal("cancelled"),
);
export type BookingStatus = Infer<typeof bookingStatusValidator>;

export const orderStatusValidator = v.union(
  v.literal("requires_payment"),
  v.literal("paid"),
  v.literal("refunded"),
  v.literal("cancelled"),
);
export type OrderStatus = Infer<typeof orderStatusValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // A pinned memory: one honest note about one place at one time.
    memories: defineTable({
      userId: v.id("users"),
      title: v.string(),
      note: v.string(),
      placeName: v.string(),
      lat: v.number(),
      lng: v.number(),
      happenedAt: v.number(),
      tone: toneValidator,
      tags: v.array(v.string()),
      visibility: visibilityValidator,
      mediaId: v.optional(v.id("_storage")),
      /** Set when the pin was saved from a real Google place. */
      googlePlaceId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_visibility", ["visibility"])
      .searchIndex("search_title", {
        searchField: "title",
        filterFields: ["visibility"],
      }),

    // Threads under a memory, so a place keeps its conversations.
    comments: defineTable({
      memoryId: v.id("memories"),
      userId: v.id("users"),
      body: v.string(),
      createdAt: v.number(),
    }).index("by_memory", ["memoryId"]),

    // Gentle nudges: "you were here a year ago".
    reminders: defineTable({
      userId: v.id("users"),
      memoryId: v.optional(v.id("memories")),
      title: v.string(),
      body: v.optional(v.string()),
      dueAt: v.number(),
      done: v.boolean(),
      createdAt: v.number(),
    }).index("by_user_due", ["userId", "dueAt"]),

    // The bookable catalogue: guided memory walks.
    experiences: defineTable({
      slug: v.string(),
      title: v.string(),
      summary: v.string(),
      description: v.string(),
      city: v.string(),
      country: v.string(),
      lat: v.number(),
      lng: v.number(),
      durationMinutes: v.number(),
      priceCents: v.number(),
      currency: v.string(),
      capacity: v.number(),
      guide: v.string(),
      tone: toneValidator,
      imageUrl: v.string(),
      highlights: v.array(v.string()),
      rating: v.number(),
      reviewCount: v.number(),
      published: v.boolean(),
      createdAt: v.number(),
    })
      .index("by_slug", ["slug"])
      .searchIndex("search_title", {
        searchField: "title",
        filterFields: ["published", "city"],
      }),

    bookings: defineTable({
      experienceId: v.id("experiences"),
      userId: v.id("users"),
      startsAt: v.number(),
      partySize: v.number(),
      guestName: v.string(),
      email: v.string(),
      phone: v.optional(v.string()),
      notes: v.optional(v.string()),
      status: bookingStatusValidator,
      totalCents: v.number(),
      currency: v.string(),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_experience_start", ["experienceId", "startsAt"])
      .index("by_status", ["status"]),

    // Real Google Places, cached so panning the globe costs nothing.
    places: defineTable({
      googlePlaceId: v.string(),
      name: v.string(),
      /** Google's primary type, e.g. "cafe" — our filter key. */
      category: v.string(),
      /** Google's localised label, e.g. "Cafe". */
      categoryLabel: v.string(),
      lat: v.number(),
      lng: v.number(),
      /** Grid cell the row was discovered in, so reads stay index-only. */
      cell: v.string(),
      address: v.optional(v.string()),
      shortAddress: v.optional(v.string()),
      rating: v.optional(v.number()),
      reviewCount: v.optional(v.number()),
      priceLevel: v.optional(v.string()),
      businessStatus: v.optional(v.string()),
      website: v.optional(v.string()),
      phone: v.optional(v.string()),
      googleMapsUri: v.optional(v.string()),
      /** Google photo resource names; images stream through our own proxy. */
      photos: v.optional(v.array(v.string())),
      openNow: v.optional(v.boolean()),
      /** Weekday opening lines, exactly as Google words them. */
      hours: v.optional(v.array(v.string())),
      summary: v.optional(v.string()),
      types: v.optional(v.array(v.string())),
      /** Which lookups have contributed to this row. */
      sources: v.array(v.string()),
      /** Which category filters this row was discovered for. */
      scopes: v.optional(v.array(v.string())),
      fetchedAt: v.number(),
      /** When a full Place Details call last filled in the rich fields. */
      detailsAt: v.optional(v.number()),
    })
      .index("by_cell", ["cell"])
      .index("by_google_id", ["googlePlaceId"]),

    // Which areas we have already asked Google about, and how widely.
    placeScans: defineTable({
      cell: v.string(),
      /** "all" or a category key, so each filter is billed at most once. */
      scope: v.string(),
      radiusKm: v.number(),
      count: v.number(),
      scannedAt: v.number(),
    }).index("by_cell_scope", ["cell", "scope"]),

    orders: defineTable({
      userId: v.id("users"),
      bookingId: v.id("bookings"),
      amountCents: v.number(),
      currency: v.string(),
      status: orderStatusValidator,
      method: v.union(v.literal("card"), v.literal("on_arrival")),
      providerRef: v.optional(v.string()),
      createdAt: v.number(),
      paidAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_booking", ["bookingId"])
      .index("by_status", ["status"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
