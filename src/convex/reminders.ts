import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isAdmin, requireUserId } from "./access";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const items = await ctx.db
      .query("reminders")
      .withIndex("by_user_due", (q) => q.eq("userId", userId))
      .order("asc")
      .take(200);
    return await Promise.all(
      items.map(async (item) => {
        const memory = item.memoryId ? await ctx.db.get(item.memoryId) : null;
        return {
          ...item,
          memoryTitle: memory?.title ?? null,
          memoryPlace: memory?.placeName ?? null,
          imageUrl: memory?.mediaId ? await ctx.storage.getUrl(memory.mediaId) : null,
        };
      }),
    );
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    body: v.optional(v.string()),
    dueAt: v.number(),
    memoryId: v.optional(v.id("memories")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const title = args.title.trim();
    if (!title) throw new Error("Give the reminder a title.");
    return await ctx.db.insert("reminders", {
      userId,
      title: title.slice(0, 140),
      body: args.body?.trim().slice(0, 500),
      dueAt: args.dueAt,
      done: false,
      memoryId: args.memoryId,
      createdAt: Date.now(),
    });
  },
});

export const setDone = mutation({
  args: { id: v.id("reminders"), done: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const reminder = await ctx.db.get(args.id);
    if (!reminder) return;
    const admin = await isAdmin(ctx);
    if (reminder.userId !== userId && !admin) {
      throw new Error("That reminder belongs to someone else.");
    }
    await ctx.db.patch(args.id, { done: args.done });
  },
});

export const remove = mutation({
  args: { id: v.id("reminders") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const reminder = await ctx.db.get(args.id);
    if (!reminder) return;
    const admin = await isAdmin(ctx);
    if (reminder.userId !== userId && !admin) {
      throw new Error("That reminder belongs to someone else.");
    }
    await ctx.db.delete(args.id);
  },
});

/** Snooze helper: "remind me again in a month". */
export const snooze = mutation({
  args: { id: v.id("reminders"), days: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const reminder = await ctx.db.get(args.id);
    if (!reminder) return;
    if (reminder.userId !== userId) throw new Error("That reminder belongs to someone else.");
    const days = Math.min(Math.max(Math.round(args.days), 1), 365);
    await ctx.db.patch(args.id, {
      dueAt: Math.max(Date.now(), reminder.dueAt) + days * 24 * 60 * 60 * 1000,
      done: false,
    });
  },
});
