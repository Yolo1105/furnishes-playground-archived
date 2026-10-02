"use client";

/**
 * Procedural textures for the generated room shell. All textures are
 * generated client-side via <canvas> drawing — no shipped image
 * assets, no network requests. Cached as module-level singletons so
 * the canvas work happens once per session.
 *
 * Why client-side procedural rather than shipped JPEG/PNG textures?
 *   - Zero asset bundle weight.
 *   - Style-driven tinting is trivial: pass a base color, the
 *     generator overlays its noise pattern on top of that color, so
 *     the StyleBible's `floor_tint` actually changes the wood tone
 *     rather than just darkening a fixed-color JPEG.
 *   - No CORS/CDN concerns.
 *
 * Textures are returned as THREE.CanvasTexture instances. The caller
 * applies them as `map` (and optionally `roughnessMap`) on a
 * meshStandardMaterial. Repeat is set so a single texture tiles
 * across the whole floor plane / wall surface; the `repeat` value
 * is computed from the surface dimensions in meters at use site.
 */

import * as THREE from "three";

// Cache: one texture per unique base color + kind. Reuses across
// Apartment remounts (e.g. when sceneSource flips back and forth).
const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Wood-grain floor texture. Generated as a 1024×1024 canvas with
 * vertical streaks (the wood-grain direction) on top of the base
 * color. The streaks are alternating darker/lighter bands at
 * irregular widths, plus subtle noise speckle so it doesn't look
 * machine-perfect.
 *
 * Visually reads as a wide-plank floor when tiled. The user gets
 * "this looks like a wood floor" without any 4K PBR asset.
 */
export function makeFloorTexture(baseColor = "#C9A57B"): THREE.CanvasTexture {
  const cacheKey = `floor:${baseColor}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;

  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Fallback: solid color texture. Used in test environments
    // (jsdom) where canvas 2D context isn't available.
    return solidColorTexture(baseColor);
  }

  // Base fill.
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // Plank dividers — vertical lines at irregular intervals across
  // the canvas. Each plank is a slightly different width (90–180px).
  const plankWidths: number[] = [];
  let totalW = 0;
  while (totalW < size) {
    const w = 90 + Math.floor(Math.random() * 90);
    plankWidths.push(w);
    totalW += w;
  }

  // Per-plank tint variation: each plank gets a subtle hue shift
  // so the floor isn't uniform. Multiply the base color brightness
  // by 0.92–1.08.
  let x = 0;
  for (const w of plankWidths) {
    const tint = 0.92 + Math.random() * 0.16;
    ctx.fillStyle = adjustBrightness(baseColor, tint);
    ctx.fillRect(x, 0, w, size);
    x += w;
  }

  // Wood-grain streaks: many vertical lines per plank with very low
  // alpha, mimicking the grain pattern. The lines are short and
  // segmented so the grain reads as wood, not as rain.
  ctx.lineWidth = 1;
  for (let i = 0; i < 600; i++) {
    const px = Math.random() * size;
    const py = Math.random() * size;
    const len = 80 + Math.random() * 240;
    const alpha = 0.04 + Math.random() * 0.08;
    const dark = Math.random() > 0.5;
    ctx.strokeStyle = dark
      ? `rgba(40, 25, 15, ${alpha})`
      : `rgba(255, 230, 200, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + (Math.random() - 0.5) * 6, py + len);
    ctx.stroke();
  }

  // Plank seam lines — darker vertical lines at each plank divider
  // so the user can clearly see the plank structure.
  x = 0;
  ctx.strokeStyle = "rgba(30, 20, 10, 0.35)";
  ctx.lineWidth = 2;
  for (const w of plankWidths) {
    x += w;
    if (x >= size) break;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  // Salt-and-pepper noise for surface micro-roughness.
  const imgData = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 18;
    imgData.data[i] = clamp(imgData.data[i] + noise);
    imgData.data[i + 1] = clamp(imgData.data[i + 1] + noise);
    imgData.data[i + 2] = clamp(imgData.data[i + 2] + noise);
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(cacheKey, tex);
  return tex;
}

/**
 * Plaster wall texture. v0.40.16 redesigned again. v0.40.14 reduced
 * the texture to ±3 fine noise + 12 vertical streaks; on a near-white
 * base color (#F8F0E4) the noise was so subtle the wall read as
 * "pure white" — the user couldn't see any texture. The new version:
 *
 *   1. Darkens the input base color slightly (0.92×) so the wall has
 *      visible warmth instead of looking like printer paper.
 *   2. Increases noise amplitude from ±3 to ±12 RGB jitter — visible
 *      grain at normal viewing distance, still clean from far away.
 *   3. Adds soft low-frequency "cloud" variations (large radial
 *      patches at ~5% alpha) for that hand-troweled plaster look,
 *      WITHOUT the high-contrast blob problem the v0.40.10 version
 *      had — these are much subtler and ~5× larger so they read
 *      as gentle warmth variation, not stains.
 *   4. Keeps the 12 vertical streaks for paint-direction suggestion.
 *
 * Net visual: warm cream plaster with visible texture grain and very
 * gentle cloud-like warmth variation. Reads as a real painted wall,
 * not a flat color.
 */
export function makeWallTexture(baseColor = "#F0E5D2"): THREE.CanvasTexture {
  const cacheKey = `wall:${baseColor}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;

  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return solidColorTexture(baseColor);

  // Darken the input base ~8% so we have warmth visible against
  // strong studio lighting. Without this, near-white inputs (like
  // the studio's #F8F0E4 fallback) bake out under bright lights and
  // the wall reads as pure white.
  const darkened = adjustBrightness(baseColor, 0.92);
  ctx.fillStyle = darkened;
  ctx.fillRect(0, 0, size, size);

  // Soft cloud-like warmth variations — large, very low-alpha radial
  // gradients. Unlike the v0.40.10 version (which used 80 small blobs
  // at 6-14% alpha and looked stained), these are 8 LARGE patches
  // (radius 100-220px on a 512 canvas, 4-6% alpha) that read as
  // gentle subsurface variation rather than discrete spots.
  for (let i = 0; i < 8; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const r = 100 + Math.random() * 120;
    const dark = Math.random() > 0.5;
    const alpha = 0.04 + Math.random() * 0.025;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(
      0,
      dark ? `rgba(110, 85, 60, ${alpha})` : `rgba(255, 245, 225, ${alpha})`,
    );
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // Fine grain. Amplitude bumped from ±3 to ±12 — at this level the
  // grain is clearly visible at normal viewing distance but doesn't
  // dominate. The +red bias (warmTint) preserves the warm-paint feel.
  const imgData = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 24;
    const warmTint = (Math.random() - 0.5) * 4;
    imgData.data[i] = clamp(imgData.data[i] + noise + warmTint);
    imgData.data[i + 1] = clamp(imgData.data[i + 1] + noise);
    imgData.data[i + 2] = clamp(imgData.data[i + 2] + noise - warmTint);
  }
  ctx.putImageData(imgData, 0, 0);

  // Subtle vertical streaks for brush-direction suggestion. Bumped
  // streak count from 12 to 18 and alpha range slightly higher so
  // the brush direction is faintly visible up close.
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * size;
    const alpha = 0.025 + Math.random() * 0.03;
    ctx.strokeStyle = `rgba(110, 90, 65, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 6, size);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(cacheKey, tex);
  return tex;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Multiply RGB components by a brightness factor; clamp to [0, 255]. */
function adjustBrightness(hex: string, factor: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = clamp(Math.round(parseInt(m[1], 16) * factor));
  const g = clamp(Math.round(parseInt(m[2], 16) * factor));
  const b = clamp(Math.round(parseInt(m[3], 16) * factor));
  return `rgb(${r}, ${g}, ${b})`;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

/** Fallback when canvas isn't available (test envs). 1×1 solid color. */
function solidColorTexture(color: string): THREE.CanvasTexture {
  // DataTexture would be more appropriate but THREE.DataTexture isn't
  // a CanvasTexture; we return a small canvas with the solid color
  // so the type matches.
  const canvas =
    typeof document !== "undefined"
      ? document.createElement("canvas")
      : ({ width: 1, height: 1 } as HTMLCanvasElement);
  canvas.width = 1;
  canvas.height = 1;
  const ctx = "getContext" in canvas ? canvas.getContext("2d") : null;
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
