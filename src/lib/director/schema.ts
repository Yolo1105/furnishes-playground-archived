/**
 * Room Director schema types — the wire format for AI generation.
 *
 * Used by:
 *   - lib/director/adapter.ts    (convert to/from our PlacedItem)
 *   - lib/director/streaming.ts  (SSE event parsing for /api/generate-room)
 *   - lib/pipeline/orchestrator.ts (server-side: emits these events)
 *
 * Why this schema exists separate from PlacedItem:
 *   The "Room Director" wire format is z-UP (z is the vertical axis,
 *   x/y are floor coords). Three.js + our app are y-UP (y is vertical,
 *   x/z are floor coords). The adapter.ts module is the SINGLE place
 *   where the swap happens — schema → adapter → store. Keeping the
 *   wire format in its native shape keeps Claude's prompts simpler
 *   and makes the conversion explicit instead of buried in random
 *   call sites.
 *
 * Coordinate convention (this file): z-UP.
 *   Position: x (east-west), y (north-south), z (up)
 *   Dimensions: length (x), width (y), height (z)
 */

import { z } from "zod";

// ─── Primitives ────────────────────────────────────────────────────────

export const DimensionsZ = z.object({
  length: z.number(), // x-axis (east-west extent)
  width: z.number(), // y-axis (north-south extent)
  height: z.number(), // z-axis (vertical extent — UP in this schema)
});
export type Dimensions = z.infer<typeof DimensionsZ>;

export const PositionZ = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number().default(0), // UP — distance above the floor
});
export type Position = z.infer<typeof PositionZ>;

export const RotationZ = z.object({
  /** Yaw rotation around the vertical (z) axis, in degrees. The
   *  generator is asked to emit only 0/90/180/270 for furniture
   *  to match conventional orientations; the adapter snaps any
   *  drift back to the nearest of those four. */
  z_angle: z.number().default(0),
});
export type Rotation = z.infer<typeof RotationZ>;

// ─── Pieces ────────────────────────────────────────────────────────────

/** A piece request — what the planner is asked to design. Used inside
 *  the per-piece Flux prompt building. */
export const PieceRequestZ = z.object({
  id: z.string(),
  category: z.string(),
  description: z.string(),
  /** True when the user explicitly named this piece in their prompt;
   *  false when Claude added it to round out the room (e.g. user asked
   *  for "a sofa" and Claude added a side table). The chat surface
   *  can show user-requested vs auto-added differently. */
  user_requested: z.boolean().optional().default(true),
  dimensions_hint: DimensionsZ,
});
export type PieceRequest = z.infer<typeof PieceRequestZ>;

/** A placed piece — what the planner emits after deciding position +
 *  rotation. The orchestrator's per-piece pipeline then attaches
 *  glb_url to this once the mesh provider returns. */
export const PlacedPieceZ = z.object({
  id: z.string(),
  category: z.string(),
  description: z.string(),
  dimensions: DimensionsZ,
  position: PositionZ,
  rotation: RotationZ,
  /** True when the piece sits on the floor (most furniture). False
   *  for wall-mounted items (mirrors, art) — those use position.z
   *  for their wall offset directly. */
  is_on_floor: z.boolean().default(true),
  /** Final-quality GLB URL once the mesh provider has finished. */
  glb_url: z.string().optional(),
  /** Preview-tier GLB URL (TripoSR fast generate) — used as
   *  intermediate while waiting for the hero-tier mesh. */
  preview_glb_url: z.string().optional(),
  /** v0.40.30: per-piece 2D image URL (Flux render of just THIS
   *  piece, used as the input to the image-to-3D mesh provider).
   *  Carries through to the placed-item meta so the Reference card
   *  can show the 2D source image when the piece is selected, AND
   *  Interior Design tile expansion can show per-piece thumbnails.
   *  Optional because (a) older entries lack it and (b) generation
   *  failures may produce a piece without an image. */
  image_url: z.string().optional(),
  /** Spatial relations Claude reasoned the piece satisfies, e.g.
   *  ["faces:tv", "near:window"]. Surfaced in the chat dock as
   *  generation rationale. */
  satisfied_relations: z.array(z.string()).default([]),
});
export type PlacedPiece = z.infer<typeof PlacedPieceZ>;

// ─── Style + room ──────────────────────────────────────────────────────

export const PaletteZ = z.object({
  /** Hex string for wall color. */
  walls: z.string(),
  /** Hex string for floor tint (overlay on a default wood floor). */
  floor_tint: z.string().optional(),
  /** Hex string for the accent color used in soft furnishings + art. */
  accent: z.string(),
});
export type Palette = z.infer<typeof PaletteZ>;

export const MaterialsZ = z.object({
  /** Wood species used for case goods, e.g. "walnut", "oak", "teak". */
  dominant_wood: z.string().optional(),
  /** Primary upholstery / textile, e.g. "cream linen", "navy bouclé". */
  primary_textile: z.string().optional(),
  /** Metal finish, e.g. "brushed brass", "matte black". */
  metal: z.string().optional(),
});
export type Materials = z.infer<typeof MaterialsZ>;

export const StyleBibleZ = z.object({
  /** Style name, e.g. "Mid-century modern", "Japandi", "Industrial loft". */
  name: z.string(),
  palette: PaletteZ,
  materials: MaterialsZ,
  lighting: z
    .enum(["warm-soft", "cool-bright", "dramatic", "neutral"])
    .default("neutral"),
  /** A short mood description woven into Flux prompts, e.g. "calm,
   *  evening light, lived-in but tidy". */
  mood: z.string(),
  /** Things to avoid — words Flux/Claude should treat as negative
   *  prompts. E.g. "avoid plastic, neon, chrome". */
  forbidden: z.array(z.string()).default([]),
  /** Reference to a saved style anchor in the project gallery. Lets
   *  a follow-up generation reuse the same style without re-deriving. */
  aesthetic_profile_ref: z.string().optional(),
});
export type StyleBible = z.infer<typeof StyleBibleZ>;

export const RoomShellZ = z.object({
  width_m: z.number(),
  depth_m: z.number(),
  height_m: z.number().default(2.7),
  shape: z.enum(["rectangle", "L-shape", "U-shape"]).default("rectangle"),
  /** Doors + windows authored at the room shell level. The orchestrator
   *  expands these into full Opening segments (with x1/z1/x2/z2) when
   *  building walls. */
  openings: z
    .array(
      z.object({
        wall: z.enum(["north", "south", "east", "west"]),
        x_offset: z.number(),
        width: z.number(),
        kind: z.enum(["door", "window"]),
      }),
    )
    .default([]),
});
export type RoomShell = z.infer<typeof RoomShellZ>;

// ─── Walls + openings (full segment form) ──────────────────────────────

/** Full wall segment in world-space y-up coordinates AFTER the adapter
 *  has translated from RoomShell openings. Matches our existing
 *  `Wall` type from lib/floorplan/types.ts so GeneratedApartment can
 *  feed straight into the same renderer. */
export const WallSegmentZ = z.object({
  id: z.string(),
  x1: z.number(),
  z1: z.number(),
  x2: z.number(),
  z2: z.number(),
  thickness: z.number().default(0.15),
});
export type WallSegment = z.infer<typeof WallSegmentZ>;

/** Opening (door / window / arch) along a wall segment. */
export const OpeningZ = z.object({
  id: z.string(),
  kind: z.enum(["door", "window", "arch"]),
  wallId: z.string().optional(),
  x1: z.number(),
  z1: z.number(),
  x2: z.number(),
  z2: z.number(),
  /** Height from floor to top of opening. Doors typically 2.0-2.1m;
   *  windows typically 0.9-1.5m above the floor with a sill below. */
  height: z.number(),
  /** Door-only: which side the door swings open from. */
  swing: z.enum(["left", "right"]).optional(),
});
export type Opening = z.infer<typeof OpeningZ>;

// ─── AssembledScene ─────────────────────────────────────────────────────

/** The final assembled scene Claude produces. After the orchestrator
 *  fans out per-piece mesh generation, this is the shape that comes
 *  back down to the client as the `scene` event payload. */
export const AssembledSceneZ = z.object({
  style: StyleBibleZ,
  room: RoomShellZ,
  pieces: z.array(PlacedPieceZ),
  /** Optional reference image URL produced by the style-anchor pass.
   *  Surfaced in the chat dock as a thumbnail / "this is the vibe"
   *  visual hint. */
  reference_image_url: z.string().optional(),
  /** Optional: which layout archetype the planner used. E.g.
   *  "conversation-pit", "perimeter-anchored". Useful for analytics
   *  but not required by any UI yet. */
  layout_archetype: z.string().optional(),
  walls: z.array(WallSegmentZ).default([]),
  openings: z.array(OpeningZ).default([]),
  /** Optional self-scoring from the planner. Not used today; reserved
   *  for a future "show me the next-best layout" feature. */
  layout_score: z.number().nullable().optional(),
  score_breakdown: z.record(z.string(), z.number()).nullable().optional(),
  /** v0.40.31: piece IDs whose per-piece mesh generation FAILED
   *  (fal.ai timeout, rate limit, transient 503, etc). Pieces in
   *  this list still appear in `pieces` but with `glb_url = undefined`
   *  — they render as placeholder boxes. The client surfaces this
   *  count in the completion message and offers per-piece retry on
   *  the placeholder via the Properties card. Empty array means
   *  every piece's mesh succeeded. Optional for back-compat with
   *  scenes generated before this version. */
  failed_piece_ids: z.array(z.string()).default([]).optional(),
});
export type AssembledScene = z.infer<typeof AssembledSceneZ>;

// ─── Streaming events ──────────────────────────────────────────────────

/** The discriminated union of events the orchestrator can emit. The
 *  client subscribes to these via SSE and routes each kind into the
 *  store. Order in a happy-path generation:
 *
 *      progress("intent") → intent → style → layout
 *           → piece_ready × N (parallel, any order)
 *           → scene
 *
 *  Failures emit `error` and terminate the stream. Per-piece failures
 *  emit a `progress` event with stage "piece_failed" but don't abort
 *  the rest of the generation. */
export const StreamEventZ = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("intent"), intent: z.unknown() }),
  z.object({ kind: z.literal("style"), style: StyleBibleZ }),
  z.object({
    kind: z.literal("layout"),
    room: RoomShellZ,
    pieces: z.array(PlacedPieceZ),
  }),
  z.object({
    kind: z.literal("piece_ready"),
    piece_id: z.string(),
    glb_url: z.string(),
    preview_glb_url: z.string().optional(),
  }),
  z.object({ kind: z.literal("scene"), scene: AssembledSceneZ }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({
    kind: z.literal("progress"),
    stage: z.string(),
    detail: z.string().optional(),
  }),
]);
export type StreamEvent = z.infer<typeof StreamEventZ>;
