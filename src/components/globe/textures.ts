import * as THREE from "three";
import { useEffect, useState } from "react";

/* ------------------------------------------------------------------ *
 * Procedural textures. Generated once, shared forever, never recreated
 * per marker — these are pure canvas work, no network involved.
 * ------------------------------------------------------------------ */

let glowTexture: THREE.Texture | null = null;
let circleTexture: THREE.Texture | null = null;
let locationTexture: THREE.Texture | null = null;
let savedTexture: THREE.Texture | null = null;
const countTextures = new Map<number, THREE.Texture>();

/** Soft radial falloff, used for marker glows and the landing glow. */
export function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.18, "rgba(255,255,255,0.62)");
    gradient.addColorStop(0.48, "rgba(255,255,255,0.16)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

/** Hard-edged circle mask, so a photo reads as a round badge on the globe. */
export function getCircleTexture(): THREE.Texture {
  if (circleTexture) return circleTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(0.86, "#fff");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  circleTexture = new THREE.CanvasTexture(canvas);
  return circleTexture;
}

/**
 * A category badge for a real Google place: a tinted disc with the category's
 * glyph. Cached per glyph, so a hundred cafes share one texture.
 */
const placeTextures = new Map<string, THREE.Texture>();

export function getPlaceTexture(glyph: string, color: string): THREE.Texture {
  const key = `${glyph}|${color}`;
  const cached = placeTextures.get(key);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 54, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255,255,255,0.82)";
    ctx.stroke();
    ctx.font =
      "64px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Twemoji Mozilla',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(glyph, size / 2, size / 2 + 4);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  placeTextures.set(key, texture);
  return texture;
}

/** The "you are here" crosshair, used for a granted GPS fix. */
export function getLocationTexture(): THREE.Texture {
  if (locationTexture) return locationTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(size / 2, 6);
    ctx.lineTo(size / 2, 30);
    ctx.moveTo(size / 2, size - 6);
    ctx.lineTo(size / 2, size - 30);
    ctx.moveTo(6, size / 2);
    ctx.lineTo(30, size / 2);
    ctx.moveTo(size - 6, size / 2);
    ctx.lineTo(size - 30, size / 2);
    ctx.stroke();
  }
  locationTexture = new THREE.CanvasTexture(canvas);
  locationTexture.colorSpace = THREE.SRGBColorSpace;
  return locationTexture;
}

/** A saved place reads as a ring around a dot, quieter than a memory. */
export function getSavedTexture(): THREE.Texture {
  if (savedTexture) return savedTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 42, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(94,234,212,0.22)";
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#5eead4";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 15, 0, Math.PI * 2);
    ctx.fillStyle = "#5eead4";
    ctx.fill();
  }
  savedTexture = new THREE.CanvasTexture(canvas);
  savedTexture.colorSpace = THREE.SRGBColorSpace;
  return savedTexture;
}

/** A count badge for a cluster of memories, cached per number. */
export function getCountTexture(count: number): THREE.Texture {
  const cached = countTextures.get(count);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(16,16,20,0.86)";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,140,74,0.85)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 62px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(count > 99 ? "99+" : String(count), size / 2, size / 2 + 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  countTextures.set(count, texture);
  return texture;
}

/* ------------------------------------------------------------------ *
 * Uploaded photographs, loaded lazily and cached by URL.
 * ------------------------------------------------------------------ */

const MAX_CACHED_IMAGES = 48;
const imageCache = new Map<string, THREE.Texture>();

function rememberImage(url: string, texture: THREE.Texture) {
  if (imageCache.size >= MAX_CACHED_IMAGES) {
    const oldestKey = imageCache.keys().next().value;
    if (oldestKey) {
      imageCache.get(oldestKey)?.dispose();
      imageCache.delete(oldestKey);
    }
  }
  imageCache.set(url, texture);
}

/**
 * Loads a memory photograph as a texture, but only when `enabled` — so a globe
 * with hundreds of pins never pulls hundreds of images at once.
 */
export function useImageTexture(
  url: string | null | undefined,
  enabled: boolean,
): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(() =>
    url && enabled ? (imageCache.get(url) ?? null) : null,
  );

  useEffect(() => {
    if (!url || !enabled) return;
    const cached = imageCache.get(url);
    if (cached) {
      setTexture(cached);
      return;
    }

    let cancelled = false;
    const loader = new THREE.TextureLoader();
    // Convex storage serves uploads cross-origin, so textures need CORS.
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (loaded) => {
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.anisotropy = 4;
        rememberImage(url, loaded);
        if (!cancelled) setTexture(loaded);
      },
      undefined,
      () => {
        if (!cancelled) setTexture(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  return texture;
}
