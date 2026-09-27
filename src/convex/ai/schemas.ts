import { z } from "zod";

/**
 * Every shape a model is allowed to answer in, in one place.
 *
 * The intelligence layer never trusts free-form JSON: a call either validates
 * against one of these or it failed, and a failed call shows up as an honest
 * "unavailable" state rather than invented travel data. Confidence lives on the
 * inferences themselves, because an inference is not a fact.
 */

/* --- Evidence-carrying affinities ------------------------------------ */

export const AffinitySchema = z.object({
  key: z.string().min(1).max(48),
  label: z.string().min(1).max(64),
  /** 0–1: how much of this person's travel leans this way. */
  weight: z.number().min(0).max(1),
  /** 0–1: how much evidence there is behind the weight. */
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().max(160)).max(4),
});
export type Affinity = z.infer<typeof AffinitySchema>;

export const InferenceSchema = z.object({
  preference: z.string().min(2).max(64),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(200),
});
export type Inference = z.infer<typeof InferenceSchema>;

/* --- Travel intelligence profile ------------------------------------ */

export const TravelProfileSchema = z.object({
  summary: z.string().min(10).max(320),
  preferences: z.array(AffinitySchema).max(14),
  destinationAffinities: z.array(AffinitySchema).max(14),
  travelStyle: z.array(z.string().max(48)).max(8),
  seasonal: z.array(z.string().max(160)).max(6),
  pace: z.enum(["slow", "balanced", "packed"]),
  budgetLean: z.enum(["budget", "balanced", "comfort", "luxury"]),
});
export type TravelProfile = z.infer<typeof TravelProfileSchema>;

/* --- Memory analysis ------------------------------------------------ */

export const MemoryAnalysisSchema = z.object({
  destinationType: z.string().min(2).max(64),
  activities: z.array(z.string().max(48)).max(8),
  interests: z.array(z.string().max(48)).max(8),
  environment: z.array(z.string().max(48)).max(6),
  season: z.string().max(24).optional(),
  travelStyle: z.array(z.string().max(48)).max(6),
  inferred: z
    .array(
      z.object({
        preference: z.string().min(2).max(64),
        confidence: z.number().min(0).max(1),
        evidence: z.string().max(200),
      }),
    )
    .max(4),
  summary: z.string().min(8).max(280),
  confidence: z.number().min(0).max(1),
});
export type MemoryAnalysis = z.infer<typeof MemoryAnalysisSchema>;

/* --- Recommendations ------------------------------------------------ */

export const RecommendationItemSchema = z.object({
  /** Which real row this came from, so the UI can act on it. */
  placeId: z.string().optional(),
  name: z.string().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  categoryLabel: z.string().max(60).optional(),
  /** Short "because" lines, each tied to real user context. */
  why: z.array(z.string().max(160)).min(1).max(4),
  evidence: z.array(z.string().max(160)).max(4).optional(),
  bestMonths: z.array(z.string().max(24)).max(6).optional(),
  estimatedCost: z
    .object({
      currency: z.string().min(1).max(8),
      low: z.number().nonnegative(),
      high: z.number().nonnegative(),
    })
    .optional(),
  tags: z.array(z.string().max(32)).max(6).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type RecommendationItem = z.infer<typeof RecommendationItemSchema>;

export const RecommendationListSchema = z.object({
  headline: z.string().max(120),
  items: z.array(RecommendationItemSchema).max(8),
});
export type RecommendationList = z.infer<typeof RecommendationListSchema>;

/* --- Destination intelligence --------------------------------------- */

export const DestinationInsightSchema = z.object({
  whyVisit: z.array(z.string().max(180)).min(1).max(4),
  whyFits: z.array(z.string().max(180)).max(4),
  bestMonths: z
    .array(
      z.object({
        month: z.string().max(16),
        note: z.string().max(140),
        score: z.number().min(0).max(1),
      }),
    )
    .max(12),
  stay: z.object({
    min: z.number().min(1).max(60),
    max: z.number().min(1).max(90),
    rationale: z.string().max(200),
  }),
  activities: z.array(z.string().max(90)).max(8),
  transport: z.array(z.string().max(140)).max(6),
  food: z.array(z.string().max(120)).max(6),
  accommodation: z.array(z.string().max(140)).max(4),
  alternatives: z.array(z.string().max(90)).max(6),
  similar: z.array(z.string().max(90)).max(6),
  cautions: z.array(z.string().max(160)).max(4),
  confidence: z.number().min(0).max(1),
});
export type DestinationInsight = z.infer<typeof DestinationInsightSchema>;

/* --- Trip planning -------------------------------------------------- */

export const TripPlanItemSchema = z.object({
  kind: z.enum(["place", "activity", "food", "stay", "transport", "rest"]),
  title: z.string().min(1).max(120),
  detail: z.string().max(240).optional(),
  googlePlaceId: z.string().max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  startMinute: z.number().min(0).max(1439).optional(),
  durationMinutes: z.number().min(5).max(720).optional(),
  /** Whole currency units, so the estimate reads the way people talk. */
  cost: z.number().nonnegative().optional(),
});

export const TripPlanSchema = z.object({
  title: z.string().min(2).max(80),
  days: z
    .array(
      z.object({
        day: z.number().min(1).max(60),
        theme: z.string().max(80),
        items: z.array(TripPlanItemSchema).min(1).max(10),
      }),
    )
    .min(1)
    .max(21),
  notes: z.array(z.string().max(160)).max(5),
  assumptions: z.array(z.string().max(160)).max(5),
});
export type TripPlan = z.infer<typeof TripPlanSchema>;

/* --- Routes --------------------------------------------------------- */

export const RoutePlanSchema = z.object({
  /** Order is computed from real coordinates, not asked of the model. */
  stops: z
    .array(
      z.object({
        name: z.string().max(120),
        lat: z.number(),
        lng: z.number(),
        placeId: z.string().max(200).optional(),
        nights: z.number().min(0).max(30).optional(),
      }),
    )
    .min(2)
    .max(12),
  rationale: z.array(z.string().max(180)).max(5),
});
export type RoutePlan = z.infer<typeof RoutePlanSchema>;

/* --- Costs ---------------------------------------------------------- */

export const CostOutlineSchema = z.object({
  /** Only the parts arithmetic cannot know: what kind of trip this is. */
  lines: z
    .array(
      z.object({
        label: z.string().min(2).max(48),
        rationale: z.string().max(160),
      }),
    )
    .min(3)
    .max(8),
  assumptions: z.array(z.string().max(160)).max(6),
  exclusions: z.array(z.string().max(120)).max(4),
});
export type CostOutline = z.infer<typeof CostOutlineSchema>;

/* --- Assistant ------------------------------------------------------ */

export const AssistantPlanSchema = z.object({
  /** What the person actually asked for, in one line. */
  intent: z.string().max(120),
  action: z.enum([
    "answer",
    "searchPlaces",
    "findNearbyPlaces",
    "getPlaceDetails",
    "getRoute",
    "getWeather",
    "searchFlights",
    "estimateTripCost",
    "getRecommendations",
    "destinationInsight",
    "planTrip",
    "optimizeItinerary",
    "memoryConnections",
    "proposeSavePlace",
    "proposeCreateTrip",
    "proposeAddToTrip",
  ]),
  /** Free-form-but-validated arguments for that action. */
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  needsConfirmation: z.boolean(),
  /** Short clarification back to the person when the request is thin. */
  clarify: z.string().max(200).optional(),
});
export type AssistantPlan = z.infer<typeof AssistantPlanSchema>;

export const AssistantAnswerSchema = z.object({
  answer: z.string().min(1).max(900),
  /** Pointers into the data cards that were already gathered. */
  highlights: z.array(z.string().max(160)).max(5),
  followUps: z.array(z.string().max(80)).max(4),
});
export type AssistantAnswer = z.infer<typeof AssistantAnswerSchema>;

/* --- Area intelligence (the globe's "ask about this area") ---------- */

export const AreaIntelSchema = z.object({
  headline: z.string().min(6).max(120),
  observations: z
    .array(
      z.object({
        heading: z.string().min(2).max(60),
        body: z.string().min(10).max(260),
        /** Real place names already on our map, never invented ones. */
        places: z.array(z.string().max(90)).max(5).optional(),
      }),
    )
    .min(1)
    .max(5),
  confidence: z.number().min(0).max(1),
});
export type AreaIntel = z.infer<typeof AreaIntelSchema>;

/* --- Writing help while pinning a memory ---------------------------- */

export const DraftAssistSchema = z.object({
  title: z.string().min(3).max(90),
  note: z.string().min(10).max(400),
  tags: z.array(z.string().max(32)).min(1).max(6),
  destination: z.string().max(80),
  category: z.string().max(48),
  /** Left empty when the draft is too thin to say anything useful. */
  caution: z.string().max(200).optional(),
});
export type DraftAssist = z.infer<typeof DraftAssistSchema>;

/* --- Travel stories ------------------------------------------------- */

export const TravelStorySchema = z.object({
  title: z.string().min(2).max(90),
  subtitle: z.string().max(140),
  chapters: z
    .array(
      z.object({
        heading: z.string().max(80),
        body: z.string().min(20).max(600),
        memoryIds: z.array(z.string()).max(12),
      }),
    )
    .min(1)
    .max(10),
  highlights: z.array(z.string().max(120)).max(6),
});
export type TravelStory = z.infer<typeof TravelStorySchema>;

/** Errors the model layer can report without ever inventing an answer. */
export type AIUnavailable = {
  ok: false;
  reason: "unavailable" | "invalid" | "rate-limited" | "network" | "budget";
  message: string;
};
