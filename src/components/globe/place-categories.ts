/**
 * Visual language for the real places Google gives us back.
 *
 * Kept deliberately quiet: a tinted disc and one glyph, so the globe stays a
 * memory map with real geography on it rather than a wall of pins.
 */

export type PlaceVisual = {
  glyph: string;
  color: string;
  group: PlaceGroup;
};

export type PlaceGroup =
  | "eat"
  | "cafe"
  | "culture"
  | "stay"
  | "park"
  | "shop"
  | "transport"
  | "other";

const GROUPS: Record<PlaceGroup, { glyph: string; color: string }> = {
  eat: { glyph: "🍴", color: "#e2604a" },
  cafe: { glyph: "☕", color: "#c8873f" },
  culture: { glyph: "🏛", color: "#4f8dd6" },
  stay: { glyph: "🏨", color: "#7c6bd6" },
  park: { glyph: "🌳", color: "#4f9d69" },
  shop: { glyph: "🛍", color: "#c1567f" },
  transport: { glyph: "🚉", color: "#5b6b7c" },
  other: { glyph: "📍", color: "#8a8a97" },
};

/** Ordered: the first pattern that matches wins. */
const RULES: [RegExp, PlaceGroup][] = [
  [/bakery|coffee|tea_house|dessert|ice_cream|juice/, "cafe"],
  [/cafe/, "cafe"],
  [
    /restaurant|meal_|food|pizza|sushi|burger|barbecue|diner|bar$|_bar|pub|night_club|brewery|steak|noodle|ramen|delicatessen|sandwich/,
    "eat",
  ],
  [/museum|gallery|art_gallery|landmark|monument|attraction|amusement_park|zoo|aquarium|stadium|theater|theatre|place_of_worship|church|mosque|temple|synagogue|castle|ruins|tourist/, "culture"],
  [/hotel|lodging|resort|motel|guest_house|campground|hostel|cottage/, "stay"],
  [/park|beach|garden|hiking|marina|nature|forest|viewpoint|scenic/, "park"],
  [/shopping|market|store|supermarket|mall|boutique|jewelry|bazaar/, "shop"],
  [/airport|station|transit|subway|bus_|taxi|port$|ferry|harbor/, "transport"],
];

export function placeVisual(category: string): PlaceVisual {
  const value = (category ?? "").toLowerCase();
  for (const [pattern, group] of RULES) {
    if (pattern.test(value)) {
      return { group, ...GROUPS[group] };
    }
  }
  return { group: "other", ...GROUPS.other };
}

/** Used when Google sends no localised label at all. */
export function fallbackLabel(category: string): string {
  if (!category) return "Place";
  return category
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
