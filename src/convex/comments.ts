import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { displayName, isAdmin, requireUserId } from "./access";

export const listForMemory = query({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("comments")
      .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
      .order("asc")
      .take(200);
    return await Promise.all(
      items.map(async (item) => {
        const author = await ctx.db.get(item.userId);
        return { ...item, authorName: displayName(author) };
      }),
    );
  },
});

export const add = mutation({
  args: { memoryId: v.id("memories"), body: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const body = args.body.trim();
    if (!body) throw new Error("Write something before posting.");
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("That memory no longer exists.");
    if (memory.visibility === "private" && memory.userId !== userId) {
      throw new Error("This memory is private to its owner.");
    }
    return await ctx.db.insert("comments", {
      memoryId: args.memoryId,
      userId,
      body: body.slice(0, 1000),
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("comments") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const comment = await ctx.db.get(args.id);
    if (!comment) return;
    const admin = await isAdmin(ctx);
    if (comment.userId !== userId && !admin) {
      throw new Error("You can only delete your own comments.");
    }
    await ctx.db.delete(args.id);
  },
});
