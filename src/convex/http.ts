import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Streams a Google place photograph.
 *
 * Google photo resource names need the API key to resolve, and the key must
 * never reach the browser. We also refuse any name that is not already on a
 * place row in our own cache, so this cannot be used as an open proxy.
 */
http.route({
  path: "/places/photo",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    const ref = new URL(request.url).searchParams.get("ref");
    if (!key || !ref) return new Response("Not found", { status: 404 });

    const match = /^places\/([^/]+)\/photos\/[^/]+$/.exec(ref);
    if (!match) return new Response("Not found", { status: 404 });

    const allowed = await ctx.runQuery(internal.places.photoAllowed, {
      googlePlaceId: match[1],
      ref,
    });
    if (!allowed) return new Response("Not found", { status: 404 });

    const media = await fetch(
      `https://places.googleapis.com/v1/${ref}/media?maxHeightPx=900&key=${encodeURIComponent(key)}`,
    );
    if (!media.ok || !media.body) {
      return new Response("Photo unavailable", { status: 502 });
    }

    return new Response(media.body, {
      headers: {
        "Content-Type": media.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }),
});

export default http;
