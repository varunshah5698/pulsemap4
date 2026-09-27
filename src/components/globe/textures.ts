import * as THREE from "three";
import { useEffect, useState } from "react";

/* ------------------------------------------------------------------ *
 * Procedural textures. Generated once, shared forever, never recreated
 * per marker — these are pure canvas work, no network involved.
 * ------------------------------------------------------------------ */

let glowTexture: THREE.Texture | null = null;
let circleTexture: THREE.Texture | null = null;
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
