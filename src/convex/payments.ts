"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * Creates a Stripe Checkout Session for an order without pulling in the Stripe
 * SDK, so the app builds and runs whether or not a key is configured.
 *
 * Add STRIPE_SECRET_KEY in the Keys tab to switch card payments on. Until then
 * this reports `configured: false` and the UI offers "pay on arrival".
 */
export const createCheckoutSession = action({
  args: {
    orderId: v.id("orders"),
    origin: v.string(),
  },
  handler: async (ctx, args) => {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return { configured: false as const, url: null };

    const order = await ctx.runQuery(api.orders.get, { id: args.orderId });
    if (!order) throw new Error("That order no longer exists.");

    const origin = args.origin.replace(/\/$/, "");
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][quantity]": String(order.partySize ?? 1),
      "line_items[0][price_data][currency]": order.currency,
      "line_items[0][price_data][unit_amount]": String(
        Math.round(order.amountCents / Math.max(order.partySize ?? 1, 1)),
      ),
      "line_items[0][price_data][product_data][name]": order.experienceTitle,
      success_url: `${origin}/dashboard?paid=1`,
      cancel_url: `${origin}/checkout/${order._id}?cancelled=1`,
      "metadata[orderId]": order._id,
    });

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const payload = (await response.json()) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!response.ok || !payload.url) {
      throw new Error(payload.error?.message ?? "Stripe could not open a checkout session.");
    }
    await ctx.runMutation(api.orders.attachProviderRef, {
      id: args.orderId,
      providerRef: payload.id ?? "stripe_session",
    });
    return { configured: true as const, url: payload.url };
  },
});
