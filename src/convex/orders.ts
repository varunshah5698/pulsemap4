import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { currentUser, requireAdmin, requireUserId } from "./access";

export const get = query({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const order = await ctx.db.get(args.id);
    if (!order) return null;
    if (order.userId !== user?._id && user?.role !== "admin") return null;
    const booking = await ctx.db.get(order.bookingId);
    const experience = booking ? await ctx.db.get(booking.experienceId) : null;
    return {
      ...order,
      experienceTitle: experience?.title ?? "Trail removed",
      experienceSlug: experience?.slug ?? "",
      startsAt: booking?.startsAt ?? null,
      partySize: booking?.partySize ?? null,
      guestName: booking?.guestName ?? "",
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const items = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return await Promise.all(
      items.map(async (order) => {
        const booking = await ctx.db.get(order.bookingId);
        const experience = booking ? await ctx.db.get(booking.experienceId) : null;
        return {
          ...order,
          experienceTitle: experience?.title ?? "Trail removed",
          startsAt: booking?.startsAt ?? null,
          partySize: booking?.partySize ?? null,
        };
      }),
    );
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const items = await ctx.db.query("orders").order("desc").take(200);
    return await Promise.all(
      items.map(async (order) => {
        const [booking, buyer] = await Promise.all([
          ctx.db.get(order.bookingId),
          ctx.db.get(order.userId),
        ]);
        const experience = booking ? await ctx.db.get(booking.experienceId) : null;
        return {
          ...order,
          experienceTitle: experience?.title ?? "Trail removed",
          guestName: booking?.guestName ?? "",
          buyer: buyer?.name ?? buyer?.email ?? "Unknown",
        };
      }),
    );
  },
});

/**
 * Opens a checkout for an existing booking. Card payments need
 * STRIPE_SECRET_KEY in the deployment environment; staying with
 * "pay on arrival" keeps the booking whole without it.
 */
export const createForBooking = mutation({
  args: {
    bookingId: v.id("bookings"),
    method: v.union(v.literal("card"), v.literal("on_arrival")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error("That booking no longer exists.");
    if (booking.userId !== userId) throw new Error("That booking belongs to someone else.");
    if (booking.status === "cancelled") throw new Error("That booking was cancelled.");
    if (booking.status === "completed") throw new Error("That visit is already behind us.");

    const existing = await ctx.db
      .query("orders")
      .withIndex("by_booking", (q) => q.eq("bookingId", args.bookingId))
      .order("desc")
      .first();

    const status = args.method === "on_arrival" ? "requires_payment" : "requires_payment";
    if (existing && existing.status !== "cancelled") {
      await ctx.db.patch(existing._id, { method: args.method, status });
      return existing._id;
    }
    return await ctx.db.insert("orders", {
      userId,
      bookingId: args.bookingId,
      amountCents: booking.totalCents,
      currency: booking.currency,
      status,
      method: args.method,
      createdAt: Date.now(),
    });
  },
});

export const attachProviderRef = mutation({
  args: { id: v.id("orders"), providerRef: v.string() },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.id);
    if (!order) throw new Error("That order no longer exists.");
    await ctx.db.patch(args.id, { providerRef: args.providerRef });
  },
});

/** Marks an order paid and confirms the booking behind it. */
export const markPaid = mutation({
  args: { id: v.id("orders"), providerRef: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const order = await ctx.db.get(args.id);
    if (!order) throw new Error("That order no longer exists.");
    const user = await ctx.db.get(userId);
    if (order.userId !== userId && user?.role !== "admin") {
      throw new Error("That order belongs to someone else.");
    }
    await ctx.db.patch(args.id, {
      status: "paid",
      paidAt: Date.now(),
      providerRef: args.providerRef ?? order.providerRef,
    });
    await ctx.db.patch(order.bookingId, { status: "confirmed" });
  },
});

/** Keeps the booking without taking money now: the guide is paid on the day. */
export const confirmOnArrival = mutation({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const order = await ctx.db.get(args.id);
    if (!order) throw new Error("That order no longer exists.");
    const user = await ctx.db.get(userId);
    if (order.userId !== userId && user?.role !== "admin") {
      throw new Error("That order belongs to someone else.");
    }
    await ctx.db.patch(args.id, { method: "on_arrival", status: "requires_payment" });
    await ctx.db.patch(order.bookingId, { status: "confirmed" });
  },
});

export const refund = mutation({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const order = await ctx.db.get(args.id);
    if (!order) return;
    await ctx.db.patch(args.id, { status: "refunded" });
    await ctx.db.patch(order.bookingId, { status: "cancelled" });
  },
});
