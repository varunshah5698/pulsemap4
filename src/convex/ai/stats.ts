import type { Doc } from "../_generated/dataModel";
import type { ContextBundle } from "./context";

/**
 * The slice of the context these calculations actually need. Queries assemble
 * it straight from the tables, so a screen can show counted insights without an
 * action, and without loading anything it does not read.
 */
export type InsightInput = Pick<
  ContextBundle,
  "stats" | "memories" | "insights" | "countries" | "cities" | "saved" | "trips" | "feedback"
>;

/**
 * The parts of intelligence that need no model at all.
 *
 * Tallies, shares and "you have never been to X" are arithmetic on real rows.
 * They are also what the model is given as ground truth, so a preference can
 * always be traced back to a count instead of a vibe — and the insights screen
 * can never show something that is not statistically supported.
 */

export type Tally = { key: string; count: number; share: number };

function tally(values: string[]): Tally[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0) || 1;
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count, share: Number((count / total).toFixed(3)) }))
    .sort((a, b) => b.count - a.count);
}

export type Signals = {
  activities: Tally[];
  interests: Tally[];
  environments: Tally[];
  destinationTypes: Tally[];
  styles: Tally[];
  tags: Tally[];
  /** Everything the model may treat as fact when it writes a profile. */
  summary: string;
};

/** Count what the memories actually contain, from analysis plus raw tags. */
export function signals(bundle: InsightInput): Signals {
  const insights: Doc<"memoryInsights">[] = bundle.insights;
  const activities = tally(insights.flatMap((insight) => insight.activities));
  const interests = tally(insights.flatMap((insight) => insight.interests));
  const environments = tally(insights.flatMap((insight) => insight.environment));
  const destinationTypes = tally(insights.map((insight) => insight.destinationType));
  const styles = tally(insights.flatMap((insight) => insight.travelStyle));
  const tags = tally(bundle.memories.flatMap((memory) => memory.tags.filter((tag) => tag !== "saved")));

  const list = (label: string, rows: Tally[]) =>
    rows.length > 0
      ? `${label}: ${rows
          .slice(0, 8)
          .map((row) => `${row.key} ${row.count}/${row.share.toFixed(2)}`)
          .join(", ")}`
      : null;

  const summary =
    [
      list("Activity counts", activities),
      list("Interest counts", interests),
      list("Environment counts", environments),
      list("Destination types", destinationTypes),
      list("Travel styles", styles),
      list("Memory tags", tags),
      `Analysed memories: ${insights.length} of ${bundle.stats.memories}`,
      `Countries: ${bundle.countries.map((row) => `${row.name} x${row.count}`).join(", ") || "none recorded"}`,
    ]
      .filter(Boolean)
      .join("\n");

  return { activities, interests, environments, destinationTypes, styles, tags, summary };
}

/** Where a country sits, for "you have not explored…" lines. */
const REGIONS: Record<string, string> = {
  Japan: "East Asia",
  China: "East Asia",
  "South Korea": "East Asia",
  Taiwan: "East Asia",
  Thailand: "South-East Asia",
  Vietnam: "South-East Asia",
  Indonesia: "South-East Asia",
  Malaysia: "South-East Asia",
  Singapore: "South-East Asia",
  Philippines: "South-East Asia",
  Cambodia: "South-East Asia",
  Laos: "South-East Asia",
  India: "South Asia",
  Nepal: "South Asia",
  "Sri Lanka": "South Asia",
  Maldives: "South Asia",
  Bhutan: "South Asia",
  France: "Western Europe",
  Italy: "Southern Europe",
  Spain: "Southern Europe",
  Portugal: "Southern Europe",
  Greece: "Southern Europe",
  Croatia: "Southern Europe",
  Germany: "Western Europe",
  Netherlands: "Western Europe",
  Belgium: "Western Europe",
  Austria: "Western Europe",
  Switzerland: "Western Europe",
  Ireland: "Western Europe",
  "United Kingdom": "Northern Europe",
  Iceland: "Northern Europe",
  Norway: "Northern Europe",
  Sweden: "Northern Europe",
  Denmark: "Northern Europe",
  Finland: "Northern Europe",
  Poland: "Central Europe",
  "Czech Republic": "Central Europe",
  Czechia: "Central Europe",
  Hungary: "Central Europe",
  Turkey: "Middle East",
  UAE: "Middle East",
  "United Arab Emirates": "Middle East",
  Jordan: "Middle East",
  Israel: "Middle East",
  Egypt: "North Africa",
  Morocco: "North Africa",
  Tunisia: "North Africa",
  Kenya: "East Africa",
  Tanzania: "East Africa",
  Rwanda: "East Africa",
  "South Africa": "Southern Africa",
  Namibia: "Southern Africa",
  "United States": "North America",
  USA: "North America",
  Canada: "North America",
  Mexico: "North America",
  Cuba: "Caribbean",
  "Costa Rica": "Central America",
  Peru: "South America",
  Chile: "South America",
  Argentina: "South America",
  Brazil: "South America",
  Colombia: "South America",
  Australia: "Oceania",
  "New Zealand": "Oceania",
  Fiji: "Oceania",
};

export function regionOf(country: string): string | null {
  return REGIONS[country] ?? null;
}

export type Insight = {
  id: string;
  text: string;
  /** Where the number came from, so it can be shown as evidence. */
  evidence: string;
  kind: "history" | "taste" | "pace" | "season" | "gap";
};

/**
 * Insights that are only ever shown when the arithmetic supports them: a count
 * of at least two, or a share of at least a third.
 */
export function deterministicInsights(bundle: InsightInput): Insight[] {
  const found: Insight[] = [];
  const stats = bundle.stats;
  const statsSignals = signals(bundle);

  if (stats.countries >= 1) {
    found.push({
      id: "countries",
      kind: "history",
      text: `You have pinned memories in ${stats.countries} ${stats.countries === 1 ? "country" : "countries"} across ${stats.cities} ${stats.cities === 1 ? "city" : "cities"}.`,
      evidence: `${stats.memories} memories in your map`,
    });
  }

  if (stats.monthsActive >= 3 && stats.firstAt && stats.lastAt) {
    const first = new Date(stats.firstAt).getFullYear();
    const last = new Date(stats.lastAt).getFullYear();
    found.push({
      id: "span",
      kind: "history",
      text: `Your memories spread across ${Math.max(1, last - first + 1)} ${last - first === 0 ? "year" : "years"}, from ${first} to ${last}.`,
      evidence: `First pin ${new Date(stats.firstAt).toISOString().slice(0, 10)}`,
    });
  }

  const strongest = [...statsSignals.interests, ...statsSignals.environments].sort(
    (a, b) => b.share - a.share,
  )[0];
  if (strongest && strongest.count >= 2 && strongest.share >= 0.3) {
    found.push({
      id: `taste-${strongest.key}`,
      kind: "taste",
      text: `Most of your analysed memories lean ${strongest.key} — ${strongest.count} of them.`,
      evidence: `${Math.round(strongest.share * 100)}% of analysed memories`,
    });
  }

  if (stats.avgTripDays >= 2) {
    found.push({
      id: "pace",
      kind: "pace",
      text: `Your trips usually run about ${stats.avgTripDays} days.`,
      evidence: `Average across ${stats.trips} trips`,
    });
  }

  if (stats.savedPlaces >= 3) {
    found.push({
      id: "saves",
      kind: "taste",
      text: `You have saved ${stats.savedPlaces} places you have not been to yet.`,
      evidence: "Places saved from the map",
    });
  }

  const regions = new Set(
    bundle.countries.map((row) => regionOf(row.name)).filter((value): value is string => Boolean(value)),
  );
  const major = [
    "South-East Asia",
    "South Asia",
    "East Asia",
    "Western Europe",
    "Southern Europe",
    "North America",
    "South America",
    "Oceania",
    "North Africa",
    "East Africa",
  ];
  const gap = major.find((region) => !regions.has(region));
  if (gap && stats.memories >= 4) {
    found.push({
      id: `gap-${gap}`,
      kind: "gap",
      text: `No memories from ${gap} yet.`,
      evidence: `${stats.countries} countries in your history, none from there`,
    });
  }

  const months = bundle.memories.map((memory) => new Date(memory.happenedAt).getUTCMonth());
  const counts = Array.from({ length: 12 }, (_, index) => months.filter((month) => month === index).length);
  const peak = counts.indexOf(Math.max(...counts));
  if (months.length >= 4 && counts[peak] >= 2) {
    found.push({
      id: "season",
      kind: "season",
      text: `You travel most often in ${new Date(Date.UTC(2024, peak, 1)).toLocaleString("en", { month: "long" })}.`,
      evidence: `${counts[peak]} of ${months.length} memories fall in that month`,
    });
  }

  return found;
}

/** Tag counts that also carry their evidence, used when saving a profile. */
export function evidenceFor(bundle: InsightInput, label: string): string[] {
  const lowered = label.toLowerCase();
  const hits = bundle.insights
    .filter((insight) =>
      [...insight.interests, ...insight.activities, ...insight.environment, insight.destinationType].some(
        (value) => value.toLowerCase().includes(lowered) || lowered.includes(value.toLowerCase()),
      ),
    )
    .map((insight) => insight.memoryId);
  const memories = bundle.memories.filter((memory) => hits.includes(memory._id));
  const where = memories.slice(0, 3).map((memory) => memory.placeName);
  if (where.length > 0) return where;
  const tagged = bundle.memories.filter((memory) =>
    memory.tags.some((tag) => tag.toLowerCase().includes(lowered)),
  );
  return tagged.slice(0, 3).map((memory) => memory.placeName);
}
