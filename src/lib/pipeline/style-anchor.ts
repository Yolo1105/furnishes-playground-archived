/**
 * Style anchor pipeline — the ArtiScene 2D-first pattern.
 *
 * Why this exists:
 *
 *   Image-to-3D models generate each piece independently. Without
 *   coordination, pieces end up visually inconsistent — a mid-century
 *   sofa next to a Victorian lamp next to a Japanese table. The
 *   ArtiScene paper (CVPR 2025) introduces a fix:
 *
 *     1. Generate ONE reference image of an empty (or minimally-
 *        furnished) room in the target style using Flux.
 *     2. For each piece, build a Flux prompt that references the
 *        style bible AND explicitly cites the same materials / palette
 *        / mood as the reference.
 *     3. The downstream image-to-3D pass conditions on prompts that
 *        share linguistic anchors. Pieces inherit style coherence
 *        without any model coupling.
 *
 *   It works because Flux is sensitive to phrasing and these prompts
 *   share the same phrasing for materials / palette / lighting / mood.
 *
 * Each per-piece Flux call costs ~5s + ~$0.005, so a 6-piece room
 * generates ~$0.04 in image cost. The mesh providers downstream are
 * the dominant cost — caching the 2D images would only save the Flux
 * cost (small slice of the total). Cache layer is deferred.
 *
 * "Server-only" because every function calls fal.ai with the
 * server-side API key.
 */

import "server-only";

import { getImageGenerator } from "../providers";
import type { StyleBible } from "../director/schema";

/** Anything with a description — both PieceRequest (the planning input)
 *  and PlacedPiece (the post-layout output) satisfy this. The prompt
 *  builder reads description plus optional dimensions; we type loosely
 *  so the same helper works in both call sites. v0.40.21 added the
 *  optional `dimensions` field so the prompt builder can emit a
 *  proportion hint to guide Flux's composition. */
export type PromptablePiece = {
  description: string;
  dimensions?: { length: number; width: number; height: number };
};

// ======================================================================
// Reference image (style anchor) prompt construction
// ======================================================================

/** Build the prompt that produces the room-level style reference image.
 *  This image is what downstream piece prompts cite — the goal isn't a
 *  beautiful render, it's a stable visual anchor. */
export function buildReferenceImagePrompt(style: StyleBible): string {
  const { name, palette, materials, lighting, mood } = style;

  const materialParts: string[] = [];
  if (materials.dominant_wood)
    materialParts.push(`${materials.dominant_wood} wood`);
  if (materials.primary_textile)
    materialParts.push(`${materials.primary_textile} textiles`);
  if (materials.metal) materialParts.push(`${materials.metal} accents`);

  const lightingDesc = lightingToPromptPhrase(lighting);

  return [
    `Wide-angle interior view of an empty ${name} style room`,
    materialParts.length
      ? `featuring ${materialParts.join(", ")}`
      : "with natural materials",
    `walls in ${palette.walls}, floor with ${palette.floor_tint ?? "neutral"} tones, ${palette.accent} accent color`,
    lightingDesc,
    mood,
    style.forbidden.length > 0
      ? `avoid ${style.forbidden.slice(0, 3).join(", ")}`
      : "",
    "studio photography, architectural magazine quality, high detail, realistic",
  ]
    .filter(Boolean)
    .join(", ");
}

function lightingToPromptPhrase(lighting: StyleBible["lighting"]): string {
  switch (lighting) {
    case "warm-soft":
      return "warm soft lighting, golden hour feel, 3200K tungsten";
    case "cool-bright":
      return "bright cool daylight, even 5600K illumination";
    case "dramatic":
      return "dramatic directional lighting, strong shadows, cinematic";
    case "neutral":
      return "balanced natural lighting, even exposure";
    default: {
      // Exhaustiveness guard — if the enum gets a new variant, this
      // becomes a compile error pointing here. Without it TS doesn't
      // see the switch as total in strict mode.
      const _exhaustive: never = lighting;
      return _exhaustive;
    }
  }
}

/** Generate the room-level style anchor reference image via Flux. */
export async function generateStyleAnchor(
  style: StyleBible,
): Promise<{ url: string; prompt: string }> {
  const prompt = buildReferenceImagePrompt(style);
  const flux = getImageGenerator("flux-schnell");
  const result = await flux.generate({
    prompt,
    image_size: 1024,
    // Wide aspect for a "room view" anchor — gives Flux room to
    // compose furniture-in-context.
    aspect: "landscape_4_3",
  });
  return { url: result.url, prompt };
}

// ======================================================================
// Per-piece 2D prompt construction
// ======================================================================

/** Build the Flux prompt for a single piece's product-shot image. The
 *  output is fed directly to image-to-3D providers, so the prompt has
 *  to nail the "isolated object on neutral background" composition the
 *  3D models expect — anything else degrades mesh quality.
 *
 *  Critical phrases (do not remove without testing):
 *    "studio product photography" — primes Flux for the right framing
 *    "centered composition" — keeps the piece centered
 *    "neutral white background" — image-to-3D models hate cluttered backgrounds
 *    "no shadows" — shadows confuse depth estimation
 *    "3/4 view angle" — best information density for 3D reconstruction */
/** Compute a short proportion hint for the image prompt. The image
 *  generator (Flux) doesn't see the piece's dimensions — it sees only
 *  the description. Without dimensional context, it draws whatever it
 *  thinks fits, and the resulting mesh comes back with arbitrary
 *  proportions that don't match what Claude planned. A "low futon
 *  sofa" might come out tall and narrow if Flux's training data
 *  biased that way; a "tall bookshelf" might come out as a chest of
 *  drawers.
 *
 *  This function turns Claude's planned dimensions into a short
 *  natural-language proportion hint that primes Flux to draw the
 *  right shape:
 *
 *    2.0 × 0.6 × 0.9 (sofa: long × short-tall × medium-deep)
 *      → "long horizontal piece, 3× wider than tall"
 *    0.4 × 1.6 × 0.4 (floor lamp)
 *      → "tall vertical piece, 4× taller than wide"
 *    1.0 × 0.5 × 1.0 (square low table)
 *      → "wide and shallow, 2× wider than tall"
 *
 *  The hint goes into the image prompt right after the description so
 *  Flux uses it to pick framing + composition. This dramatically
 *  improves mesh quality — image-to-3D models can only reconstruct
 *  what's in the source image, so getting the shape right at the 2D
 *  step is the leverage point.
 *
 *  Heuristic chosen over precise aspect numbers: Flux interprets
 *  natural language proportions ("long horizontal", "tall narrow")
 *  much more reliably than numeric aspect ratios. The numeric ratio
 *  ("3× wider") is included as a backup for the cases where the
 *  natural language isn't specific enough.
 */
function proportionHint(length: number, width: number, height: number): string {
  // Sort dimensions to find longest, middle, shortest.
  const dims = [
    { name: "length", value: length, axis: "horizontal" },
    { name: "width", value: width, axis: "horizontal" },
    { name: "height", value: height, axis: "vertical" },
  ];
  const sorted = [...dims].sort((a, b) => b.value - a.value);
  const longest = sorted[0];
  const shortest = sorted[2];
  const ratio = shortest.value > 0 ? longest.value / shortest.value : 1;

  // Three cases based on which dimension is dominant:
  if (longest.axis === "vertical") {
    // Tall piece — height is the longest. Floor lamps, bookshelves,
    // wardrobes, tall plants.
    if (ratio > 3)
      return `tall vertical piece, ${ratio.toFixed(1)}× taller than wide`;
    if (ratio > 1.8) return `taller than wide, vertical orientation`;
    return `roughly square proportions, slightly tall`;
  }
  // Horizontal piece — width or depth is the longest. Sofas, beds,
  // dining tables, low cabinets.
  if (height > 0 && longest.value / height > 2.5) {
    return `long low horizontal piece, ${(longest.value / height).toFixed(1)}× longer than tall`;
  }
  if (height > 0 && longest.value / height > 1.5) {
    return `wider than tall, horizontal orientation`;
  }
  return `roughly square proportions`;
}

/** Build the image-generation prompt for a single piece.

  The prompt is image-generator-grade, not user-grade — its precise
 *  output is fed directly to image-to-3D providers, so the prompt has
 *  to nail the "isolated object on neutral background" composition the
 *  3D models expect — anything else degrades mesh quality.
 *
 *  Critical phrases (do not remove without testing):
 *    "studio product photography" — primes Flux for the right framing
 *    "centered composition" — keeps the piece centered
 *    "neutral white background" — image-to-3D models hate cluttered backgrounds
 *    "no shadows" — shadows confuse depth estimation
 *    "front view, eye level" — fixes orientation. Without these, the
 *      generated mesh comes back rotated arbitrarily (chairs upside
 *      down, beds on their side, pieces tilted at 45°). Front-view
 *      eye-level framing forces Flux to draw the piece upright with
 *      a consistent axis convention; image-to-3D models then output
 *      a mesh with Y-up and front-facing-Z that our scene can use
 *      without hand-rolling rotation correction.
 *
 *  v0.40.21: Includes a proportion hint derived from the piece's
 *  planned dimensions so Flux generates an image with the right
 *  aspect ratio. Without this, mesh proportions came back arbitrary
 *  and downstream auto-scaling produced visibly squashed/melted
 *  pieces. The hint is the leverage point — fix the shape at the
 *  2D step, the 3D step inherits the fix automatically.
 *
 *  v0.40.22: Switched "3/4 view angle" → "front view, eye level,
 *  upright orientation" because the user reported pieces coming back
 *  in random orientations (a chair tilted 45°, a bed lying on its
 *  side). 3/4 view gives image-to-3D models more visual information
 *  but no consistent reconstruction axis, so the mesh's local Y can
 *  end up anywhere. Front-view-upright framing pins the orientation
 *  so the downstream mesh has predictable up/forward axes. */
export function buildPiecePrompt(
  piece: PromptablePiece,
  style: StyleBible,
): string {
  const materialParts: string[] = [];
  if (style.materials.dominant_wood)
    materialParts.push(style.materials.dominant_wood);
  if (style.materials.primary_textile)
    materialParts.push(style.materials.primary_textile);

  // Proportion hint — only included when the piece has dimensions.
  // generate-asset's PromptablePiece may or may not carry them
  // depending on the call site; we read defensively.
  const dims = (
    piece as { dimensions?: { length: number; width: number; height: number } }
  ).dimensions;
  const propHint = dims
    ? proportionHint(dims.length, dims.width, dims.height)
    : "";

  return [
    piece.description,
    propHint,
    `in ${style.name} style`,
    materialParts.length ? `using ${materialParts.join(" and ")}` : "",
    `color palette: ${style.palette.walls} background, ${style.palette.accent} accents`,
    // Studio-shot conventions — CRITICAL for downstream image-to-3D.
    "studio product photography",
    "centered composition",
    "neutral white background",
    "soft even lighting",
    "no shadows",
    "sharp focus",
    // v0.40.23 orientation pins (strengthened from v0.40.22):
    //
    // The TripoSR paper explicitly notes that the model "guesses"
    // camera parameters during inference rather than enforcing a
    // canonical output orientation. Their evaluation methodology
    // uses brute-force ICP rotation search to align outputs to
    // ground truth — i.e. the model's natural output IS slightly
    // rotated by varying amounts.
    //
    // The countermeasure is to make the input image as close to a
    // technical-drawing front elevation as possible. When the
    // input is dead-on orthographic-front, TripoSR has the most
    // consistent reconstruction frame. The tradeoff: orthographic-
    // style images give image-to-3D models less depth information,
    // but for furniture (mostly box-like with a clear front) the
    // resulting mesh is more reliably oriented than from 3/4 view.
    //
    // Phrases that pin the camera angle:
    //   "orthographic front elevation" — technical drawing primer,
    //     forces zero perspective distortion.
    //   "no perspective distortion" — explicit reinforcement.
    //   "level camera, no tilt" — pins the vertical axis.
    //   "piece sits on horizontal floor surface" — gives Flux a
    //     ground-plane reference so the piece's bottom is clearly
    //     "down" in the image.
    "orthographic front elevation",
    "no perspective distortion",
    "level camera angle, no tilt",
    "upright orientation, piece sits on horizontal floor surface",
    "showing full piece from front",
    "isolated object",
    style.forbidden.length > 0 ? `avoid: ${style.forbidden.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** Generate a per-piece product-shot image via Flux. Returns both the
 *  URL (for the next mesh-generation step) and the prompt (so the
 *  orchestrator can attach it to the piece's metadata for debugging
 *  and lineage display). */
export async function generatePiece2D(
  piece: PromptablePiece,
  style: StyleBible,
): Promise<{ url: string; prompt: string }> {
  const prompt = buildPiecePrompt(piece, style);
  const flux = getImageGenerator("flux-schnell");
  const result = await flux.generate({
    prompt,
    image_size: 1024,
    // Square is the canonical image-to-3D input shape — most providers
    // crop or letterbox other aspect ratios.
    aspect: "square",
  });
  return { url: result.url, prompt };
}
