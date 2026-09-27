import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { currentUser, displayName, requireAdmin, requireUserId } from "./access";
import { ROLES, roleValidator } from "./schema";

/** True when the signed-in person may open the admin area. */
export const access = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    const admins = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), ROLES.ADMIN))
      .take(1);
    return {
      isAdmin: user?.role === ROLES.ADMIN,
      hasAnyAdmin: admins.length > 0,
      role: user?.role ?? null,
    };
  },
});

/**
 * The first person to claim the workspace becomes its administrator.
 * Once an administrator exists, only they can hand the role on.
 */
export const claimWorkspace = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const admins = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), ROLES.ADMIN))
      .take(1);
    if (admins.length > 0) {
      throw new Error("This workspace already has an administrator.");
    }
    await ctx.db.patch(userId, { role: ROLES.ADMIN });
    return { role: ROLES.ADMIN };
  },
});

export const setUserRole = mutation({
  args: { userId: v.id("users"), role: roleValidator },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (admin._id === args.userId && args.role !== ROLES.ADMIN) {
      throw new Error("You cannot remove your own administrator access.");
    }
    await ctx.db.patch(args.userId, { role: args.role });
  },
});

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [memories, bookings, orders, users, experiences] = await Promise.all([
      ctx.db.query("memories").collect(),
      ctx.db.query("bookings").collect(),
      ctx.db.query("orders").collect(),
      ctx.db.query("users").collect(),
      ctx.db.query("experiences").collect(),
    ]);
    const paidOrders = orders.filter((order) => order.status === "paid");
    return {
      memories: memories.length,
      publicMemories: memories.filter((memory) => memory.visibility === "public").length,
      bookings: bookings.length,
      pendingBookings: bookings.filter((booking) => booking.status === "pending").length,
      revenueCents: paidOrders.reduce((sum, order) => sum + order.amountCents, 0),
      paidOrders: paidOrders.length,
      openOrders: orders.filter((order) => order.status === "requires_payment").length,
      accounts: users.length,
      experiences: experiences.length,
      publishedExperiences: experiences.filter((item) => item.published).length,
    };
  },
});

export const listMemories = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const items = await ctx.db.query("memories").order("desc").take(200);
    return await Promise.all(
      items.map(async (memory) => {
        const author = await ctx.db.get(memory.userId);
        return {
          ...memory,
          authorName: displayName(author),
          mediaUrl: memory.mediaId ? await ctx.storage.getUrl(memory.mediaId) : null,
        };
      }),
    );
  },
});

export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(200);
    return users.map((user) => ({
      _id: user._id,
      name: displayName(user),
      email: user.email ?? null,
      role: user.role ?? ROLES.USER,
      isAnonymous: user.isAnonymous ?? false,
    }));
  },
});
