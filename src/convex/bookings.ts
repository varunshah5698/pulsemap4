import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { currentUser, displayName, isAdmin, requireUserId } from "./access";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const items = await ctx.db
      .query("bookings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return await Promise.all(
      items.map(async (booking) => {
        const experience = await ctx.db.get(booking.experienceId);
        const order = await ctx.db
          .query("orders")
          .withIndex("by_booking", (q) => q.eq("bookingId", booking._id))
          .order("desc")
          .first();
        return {
          ...booking,
          experienceTitle: experience?.title ?? "Trail removed",
          experienceSlug: experience?.slug ?? "",
          experienceCity: experience?.city ?? "",
          imageUrl: experience?.imageUrl ?? "",
          orderStatus: order?.status ?? null,
          orderId: order?._id ?? null,
        };
      }),
    );
  },
});

export const create = mutation({
  args: {
    slug: v.string(),
    startsAt: v.number(),
    partySize: v.number(),
    guestName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const experience = await ctx.db
      .query("experiences")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!experience) throw new Error("That trail is no longer available.");
    if (!experience.published) throw new Error("That trail is not open for booking yet.");

    const partySize = Math.min(Math.max(Math.round(args.partySize), 1), 12);
    const existing = await ctx.db
      .query("bookings")
      .withIndex("by_experience_start", (q) =>
        q.eq("experienceId", experience._id).eq("startsAt", args.startsAt),
      )
      .collect();
    const taken = existing
      .filter((booking) => booking.status !== "cancelled")
      .reduce((sum, booking) => sum + booking.partySize, 0);
    if (taken + partySize > experience.capacity) {
      throw new Error("That time slot just filled up. Please choose another.");
    }

    const guestName = args.guestName.trim();
    if (!guestName) throw new Error("We need a name for the booking.");

    return await ctx.db.insert("bookings", {
      experienceId: experience._id,
      userId,
      startsAt: args.startsAt,
      partySize,
      guestName: guestName.slice(0, 120),
      email: args.email.trim().slice(0, 160),
      phone: args.phone?.trim().slice(0, 40),
      notes: args.notes?.trim().slice(0, 600),
      status: "pending",
      totalCents: experience.priceCents * partySize,
      currency: experience.currency,
      createdAt: Date.now(),
    });
  },
});

export const cancel = mutation({
  args: { id: v.id("bookings") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const booking = await ctx.db.get(args.id);
    if (!booking) return;
    const admin = await isAdmin(ctx);
    if (booking.userId !== userId && !admin) {
      throw new Error("That booking belongs to someone else.");
    }
    await ctx.db.patch(args.id, { status: "cancelled" });
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_booking", (q) => q.eq("bookingId", args.id))
      .collect();
    for (const order of orders) {
      if (order.status !== "paid") await ctx.db.patch(order._id, { status: "cancelled" });
    }
  },
});

/** Small helper used by the checkout page. */
export const get = query({
  args: { id: v.id("bookings") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const booking = await ctx.db.get(args.id);
    if (!booking) return null;
    const admin = user?.role === "admin";
    if (booking.userId !== user?._id && !admin) return null;
    const experience = await ctx.db.get(booking.experienceId);
    return {
      ...booking,
      experienceTitle: experience?.title ?? "Trail removed",
      experienceSlug: experience?.slug ?? "",
      experienceCity: experience?.city ?? "",
      experienceGuide: experience?.guide ?? "",
      imageUrl: experience?.imageUrl ?? "",
    };
  },
});
