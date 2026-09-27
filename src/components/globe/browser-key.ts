/**
 * The Maps JavaScript API key, as far as the browser is concerned.
 *
 * Only ever a key that is *meant* to be public:
 *
 *  1. `VITE_GOOGLE_MAPS_BROWSER_KEY` — the build-time browser key. In Google
 *     Cloud this one should be restricted to the site's own HTTP referrers and
 *     allowed only the Maps JavaScript API.
 *  2. A key the backend holds under `GOOGLE_MAPS_BROWSER_KEY` and hands out to
 *     signed-in callers through `api.places.config`.
 *
 * The server key (`GOOGLE_MAPS_API_KEY`) is deliberately unreachable from here:
 * it is what calls Places API, and it must never reach client code.
 */

/** Real Google keys are long; anything shorter is a placeholder or a stub. */
const MIN_KEY_LENGTH = 20;

/**
 * Some environments write secrets through a vault, so a variable can come back
 * as `encrypted:<base64>` rather than plain text. That string is not a key —
 * Google answers it with an opaque auth failure — so it is treated as "no key"
 * and the UI says what is missing instead of failing silently.
 */
const SEALED = /^(?:encrypted|sealed|vault|secret):/i;

/** Is this string something we can actually hand to Google? */
export function usableKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < MIN_KEY_LENGTH) return null;
  if (SEALED.test(trimmed)) return null;
  return trimmed;
}

/** The build-time browser key for this deployment, if it has one. */
export function viteBrowserKey(): string | null {
  return usableKey(import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY);
}

/**
 * The key the flat map should use: the build-time browser key when it is
 * present and usable, otherwise a dedicated browser key supplied by the
 * backend. Never the server key.
 */
export function resolveBrowserKey(fromServer: string | null | undefined): string | null {
  return viteBrowserKey() ?? usableKey(fromServer);
}
