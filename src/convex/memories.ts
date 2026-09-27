import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { displayName, isAdmin, requireUserId } from "./access";
import { toneValidator, visibilityValidator } from "./schema";

type Memory = Doc<"memories">;

export type SerializedMemory = Memory & {
  mediaUrl: string | null;
  authorName: string;
  authorImage: string | null;
};

async function serialize(ctx: QueryCtx | MutationCtx, memory: Memory): Promise<SerializedMemory> {
  const [mediaUrl, author] = await Promise.all([
    memory.mediaId ? ctx.storage.getUrl(memory.mediaId) : Promise.resolve(null),
    ctx.db.get(memory.userId),
  ]);
  return {
    ...memory,
    mediaUrl,
    authorName: displayName(author),
    authorImage: author?.image ?? null,
  };
}

function visibleTo(memory: Memory, userId: Id<"users"> | null) {
  if (memory.visibility === "public") return true;
  return userId !== null && memory.userId === userId;
}

/** Everything the signed-in person has pinned, newest memory first. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const items = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);
    return await Promise.all(items.map((item) => serialize(ctx, item)));
  },
});

/** Pins the current person may see: their own plus everything marked public. */
export const mapPins = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const [mine, shared] = await Promise.all([
      userId
        ? ctx.db
            .query("memories")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .order("desc")
            .take(300)
        : Promise.resolve([] as Memory[]),
      ctx.db
        .query("memories")
        .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
        .order("desc")
        .take(300),
    ]);

    const seen = new Set<string>();
    const merged: Memory[] = [];
    for (const item of [...mine, ...shared]) {
      if (seen.has(item._id)) continue;
      seen.add(item._id);
      merged.push(item);
    }
    merged.sort((a, b) => b.createdAt - a.createdAt);
    return await Promise.all(merged.slice(0, 400).map((item) => serialize(ctx, item)));
  },
});

/** The public catalogue of places worth remembering. */
export const catalog = query({
  args: {
    search: v.optional(v.string()),
    tone: v.optional(toneValidator),
  },
  handler: async (ctx, args) => {
    const term = args.search?.trim() ?? "";
    let items: Memory[];
    if (term.length > 0) {
      items = await ctx.db
        .query("memories")
        .withSearchIndex("search_title", (q) =>
          q.search("title", term).eq("visibility", "public"),
        )
        .take(60);
    } else {
      items = await ctx.db
        .query("memories")
        .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
        .order("desc")
        .take(60);
    }
    const filtered = args.tone ? items.filter((item) => item.tone === args.tone) : items;
    return await Promise.all(filtered.map((item) => serialize(ctx, item)));
  },
});

export const get = query({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.id);
    if (!memory) return null;
    const userId = await getAuthUserId(ctx);
    if (!visibleTo(memory, userId)) return null;
    return await serialize(ctx, memory);
  },
});

/** Counters for the dashboard header. */
export const myStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const [mine, reminders] = await Promise.all([
      ctx.db.query("memories").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("reminders").withIndex("by_user_due", (q) => q.eq("userId", userId)).collect(),
    ]);
    const now = Date.now();
    const places = new Set(
      mine.map((item) => `${item.placeName.toLowerCase()}|${item.lat.toFixed(1)}`),
    );
    return {
      memories: mine.length,
      places: places.size,
      shared: mine.filter((item) => item.visibility !== "private").length,
      pendingReminders: reminders.filter((item) => !item.done && item.dueAt >= now).length,
      overdueReminders: reminders.filter((item) => !item.done && item.dueAt < now).length,
      latest: mine.sort((a, b) => b.createdAt - a.createdAt)[0]?.title ?? null,
    };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
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
    /** Present when the pin was saved straight off a real Google place. */
    googlePlaceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const title = args.title.trim();
    if (!title) throw new Error("Every memory needs a title.");
    if (Number.isNaN(args.lat) || Number.isNaN(args.lng)) {
      throw new Error("Drop the pin on the map first.");
    }
    const now = Date.now();
    const memoryId = await ctx.db.insert("memories", {
      userId,
      title: title.slice(0, 120),
      note: args.note.trim().slice(0, 2000),
      placeName: args.placeName.trim().slice(0, 120) || "Unnamed place",
      lat: args.lat,
      lng: args.lng,
      happenedAt: args.happenedAt,
      tone: args.tone,
      tags: args.tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 6),
      visibility: args.visibility,
      mediaId: args.mediaId,
      googlePlaceId: args.googlePlaceId,
      createdAt: now,
      updatedAt: now,
    });

    // Hand the saved memory straight back, photograph URL included, so the
    // globe can fly to it and the notification can show the real photo.
    const created = await ctx.db.get(memoryId);
    if (!created) throw new Error("The memory could not be read back.");
    return await serialize(ctx, created);
  },
});

export const update = mutation({
  args: {
    id: v.id("memories"),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    placeName: v.optional(v.string()),
    tone: v.optional(toneValidator),
    visibility: v.optional(visibilityValidator),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const memory = await ctx.db.get(args.id);
    if (!memory) throw new Error("That memory no longer exists.");
    const admin = await isAdmin(ctx);
    if (memory.userId !== userId && !admin) {
      throw new Error("You can only edit your own memories.");
    }
    await ctx.db.patch(args.id, {
      title: args.title?.trim().slice(0, 120) ?? memory.title,
      note: args.note?.trim().slice(0, 2000) ?? memory.note,
      placeName: args.placeName?.trim().slice(0, 120) ?? memory.placeName,
      tone: args.tone ?? memory.tone,
      visibility: args.visibility ?? memory.visibility,
      tags: args.tags
        ? args.tags
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 6)
        : memory.tags,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const memory = await ctx.db.get(args.id);
    if (!memory) return;
    const admin = await isAdmin(ctx);
    if (memory.userId !== userId && !admin) {
      throw new Error("You can only delete your own memories.");
    }
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_memory", (q) => q.eq("memoryId", args.id))
      .collect();
    for (const comment of comments) await ctx.db.delete(comment._id);
    if (memory.mediaId) await ctx.storage.delete(memory.mediaId);
    await ctx.db.delete(args.id);
  },
});

/** Seeds a handful of public pins so a new workspace is not an empty sheet. */
export const seedCommunityPins = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db.query("memories").take(1);
    if (existing.length > 0) return { seeded: 0 };
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const seeds: Array<{
      title: string;
      note: string;
      placeName: string;
      lat: number;
      lng: number;
      tone: "quiet" | "golden" | "bright" | "storm" | "night";
      tags: string[];
      daysAgo: number;
    }> = [
      {
        title: "First light on the old bridge",
        note: "Nobody on the arch yet. The stone holds the night's cold and the river keeps talking.",
        placeName: "Stari Most, Mostar",
        lat: 43.3373,
        lng: 17.8149,
        tone: "golden",
        tags: ["bridge", "morning"],
        daysAgo: 12,
      },
      {
        title: "Copper and hammering",
        note: "A coppersmith pressed a small engraved tray into my hands and refused to take money for it.",
        placeName: "Kujundziluk, Mostar",
        lat: 43.3379,
        lng: 17.8158,
        tone: "bright",
        tags: ["bazaar", "craft"],
        daysAgo: 26,
      },
      {
        title: "Rain from the minaret",
        note: "Climbed the Koski Mehmed Pasha minaret in a downpour. The whole town went grey and quiet.",
        placeName: "Koski Mehmed Pasha Mosque, Mostar",
        lat: 43.3352,
        lng: 17.8153,
        tone: "storm",
        tags: ["viewpoint", "rain"],
        daysAgo: 41,
      },
      {
        title: "Riverside coffee, second cup",
        note: "Sat on the same bench for two hours and watched the divers wait for a crowd.",
        placeName: "Neretva riverside, Mostar",
        lat: 43.3361,
        lng: 17.8136,
        tone: "quiet",
        tags: ["coffee", "river"],
        daysAgo: 55,
      },
      {
        title: "Kajtaz House, the quiet room",
        note: "Low ceilings, worn rugs, and shutters that turn a whole summer afternoon into shade.",
        placeName: "Kajtaz House, Mostar",
        lat: 43.3341,
        lng: 17.8188,
        tone: "night",
        tags: ["architecture", "ottoman"],
        daysAgo: 63,
      },
    ];
    for (const seed of seeds) {
      await ctx.db.insert("memories", {
        userId,
        title: seed.title,
        note: seed.note,
        placeName: seed.placeName,
        lat: seed.lat,
        lng: seed.lng,
        happenedAt: now - seed.daysAgo * day,
        tone: seed.tone,
        tags: seed.tags,
        visibility: "public",
        createdAt: now - seed.daysAgo * day,
        updatedAt: now - seed.daysAgo * day,
      });
    }
    return { seeded: seeds.length };
  },
});
