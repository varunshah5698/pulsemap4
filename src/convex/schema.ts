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

/* --- Trips ---------------------------------------------------------- */

export const tripStatusValidator = v.union(
  v.literal("idea"),
  v.literal("planning"),
  v.literal("booked"),
  v.literal("taken"),
);
export type TripStatus = Infer<typeof tripStatusValidator>;

export const budgetModeValidator = v.union(
  v.literal("budget"),
  v.literal("balanced"),
  v.literal("comfort"),
  v.literal("luxury"),
);
export type BudgetMode = Infer<typeof budgetModeValidator>;

export const tripItemKindValidator = v.union(
  v.literal("place"),
  v.literal("activity"),
  v.literal("food"),
  v.literal("stay"),
  v.literal("transport"),
  v.literal("rest"),
);
export type TripItemKind = Infer<typeof tripItemKindValidator>;

/* --- Derived intelligence ------------------------------------------- */

/** A taste with its receipts: what it is, how strong, and what showed it. */
export const affinityValidator = v.object({
  key: v.string(),
  label: v.string(),
  weight: v.number(),
  confidence: v.number(),
  evidence: v.array(v.string()),
});
export type Affinity = Infer<typeof affinityValidator>;

export const placeCountValidator = v.object({
  name: v.string(),
  count: v.number(),
  lastAt: v.number(),
});
export type PlaceCount = Infer<typeof placeCountValidator>;

export const inferenceValidator = v.object({
  preference: v.string(),
  confidence: v.number(),
  evidence: v.string(),
});
export type Inference = Infer<typeof inferenceValidator>;

export const profileStatsValidator = v.object({
  memories: v.number(),
  withPhotos: v.number(),
  countries: v.number(),
  cities: v.number(),
  savedPlaces: v.number(),
  trips: v.number(),
  avgTripDays: v.number(),
  firstAt: v.optional(v.number()),
  lastAt: v.optional(v.number()),
  monthsActive: v.number(),
});
export type ProfileStats = Infer<typeof profileStatsValidator>;

export const derivedFromValidator = v.object({
  memories: v.number(),
  insights: v.number(),
  trips: v.number(),
  saves: v.number(),
  feedback: v.number(),
});
export type DerivedFrom = Infer<typeof derivedFromValidator>;

export const artifactStatusValidator = v.union(
  v.literal("running"),
  v.literal("done"),
  v.literal("error"),
);
export type ArtifactStatus = Infer<typeof artifactStatusValidator>;

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
      /** Direct picture URL, from Google's proxy or a licensed fallback. */
      photoUrl: v.optional(v.string()),
      photoCredit: v.optional(v.string()),
      photoPageUrl: v.optional(v.string()),
      /** True once we have looked for a photograph and come up empty. */
      photoChecked: v.optional(v.boolean()),
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

    /* ---------------------------------------------------------------- *
     * Trips: the plan the intelligence layer reads and writes. These are
     * ordinary user data — the AI proposes changes, the person confirms.
     * ---------------------------------------------------------------- */
    trips: defineTable({
      userId: v.id("users"),
      title: v.string(),
      destination: v.string(),
      lat: v.optional(v.number()),
      lng: v.optional(v.number()),
      status: tripStatusValidator,
      startsAt: v.optional(v.number()),
      endsAt: v.optional(v.number()),
      travellers: v.number(),
      budgetMode: budgetModeValidator,
      budgetCents: v.optional(v.number()),
      currency: v.string(),
      interests: v.array(v.string()),
      notes: v.optional(v.string()),
      /** Where the plan came from, so a person can see when AI drafted it. */
      origin: v.union(v.literal("manual"), v.literal("pulse")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_status", ["userId", "status"]),

    tripItems: defineTable({
      tripId: v.id("trips"),
      userId: v.id("users"),
      day: v.number(),
      order: v.number(),
      kind: tripItemKindValidator,
      title: v.string(),
      detail: v.optional(v.string()),
      lat: v.optional(v.number()),
      lng: v.optional(v.number()),
      googlePlaceId: v.optional(v.string()),
      startMinute: v.optional(v.number()),
      durationMinutes: v.optional(v.number()),
      costCents: v.optional(v.number()),
      source: v.union(v.literal("ai"), v.literal("user")),
      createdAt: v.number(),
    })
      .index("by_trip", ["tripId"])
      .index("by_trip_day", ["tripId", "day", "order"])
      .index("by_user", ["userId"]),

    /* ---------------------------------------------------------------- *
     * Derived intelligence. Nothing here is raw user content sent to a
     * model over and over: it is the compressed result of reading it once.
     * ---------------------------------------------------------------- */
    travelProfiles: defineTable({
      userId: v.id("users"),
      /** Weighted tastes, each carrying its own evidence and confidence. */
      preferences: v.array(affinityValidator),
      destinationAffinities: v.array(affinityValidator),
      countries: v.array(placeCountValidator),
      cities: v.array(placeCountValidator),
      stats: profileStatsValidator,
      /** Seasonal notes, in the person's own terms. */
      seasonal: v.array(v.string()),
      /** How they move through a place, and what they spend like. */
      pace: v.optional(v.string()),
      budgetLean: v.optional(v.string()),
      /** What the profile was built from, so staleness is measurable. */
      derivedFrom: derivedFromValidator,
      /** One short human sentence, written by the model. */
      summary: v.optional(v.string()),
      model: v.optional(v.string()),
      builtAt: v.number(),
    }).index("by_user", ["userId"]),

    memoryInsights: defineTable({
      userId: v.id("users"),
      memoryId: v.id("memories"),
      destinationType: v.string(),
      activities: v.array(v.string()),
      interests: v.array(v.string()),
      environment: v.array(v.string()),
      season: v.optional(v.string()),
      travelStyle: v.array(v.string()),
      /** Inferences, never stated as fact — each with a confidence. */
      inferred: v.array(inferenceValidator),
      summary: v.string(),
      confidence: v.number(),
      model: v.string(),
      /** Hash of the memory at the time of analysis, to skip no-op runs. */
      sourceHash: v.string(),
      analyzedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_memory", ["memoryId"]),

    /**
     * Structured AI output, keyed by kind + a hash of its inputs. Doubles as
     * the request-deduplicator: a second caller for the same key joins the run
     * already in flight instead of paying for another model call.
     */
    aiArtifacts: defineTable({
      userId: v.optional(v.id("users")),
      kind: v.string(),
      key: v.string(),
      status: artifactStatusValidator,
      payload: v.optional(v.any()),
      error: v.optional(v.string()),
      model: v.optional(v.string()),
      tokensIn: v.optional(v.number()),
      tokensOut: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
      expiresAt: v.number(),
    })
      .index("by_kind_key", ["kind", "key"])
      .index("by_user_kind", ["userId", "kind"])
      .index("by_expires", ["expiresAt"]),

    /** Per-person spend guard: the reason AI cannot be called every render. */
    aiUsage: defineTable({
      userId: v.id("users"),
      /** UTC day, so the window is stable across timezones. */
      day: v.string(),
      calls: v.number(),
      cached: v.number(),
      rejected: v.number(),
      failures: v.number(),
      tokensIn: v.number(),
      tokensOut: v.number(),
      updatedAt: v.number(),
    }).index("by_user_day", ["userId", "day"]),

    /** Thumbs, dismissals and hides — the loop that keeps suggestions honest. */
    aiFeedback: defineTable({
      userId: v.id("users"),
      kind: v.string(),
      /** The artifact key, or the subject the feedback is about. */
      subject: v.string(),
      vote: v.union(v.literal("up"), v.literal("down"), v.literal("dismiss")),
      reason: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_user_subject", ["userId", "kind", "subject"])
      .index("by_user", ["userId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
