/**
 * Studio snapshot — the structured payload the client sends with every
 * `/api/chat` request to ground the brain in the user's current 3D
 * scene.
 *
 * Eva's snapshot was a text rail (free-form prompt + tags + budget
 * notes). Ours is a real scene snapshot: actual room dimensions in
 * meters, opening positions, placed furniture with x/z/dimensions,
 * the active style bible, and the source of the scene (viewer vs
 * room-director). The brain reads these to make grounded
 * recommendations — "your sofa is 60cm from the wall, walkway needs
 * 75cm" — instead of generic suggestions.
 *
 * The schema is loose deliberately:
 *   - We don't validate every PlacedItem field because the client is
 *     trusted (same-origin, same store). Validating types we just
 *     wrote is wasted work.
 *   - We DO cap array lengths and string lengths to prevent malformed
 *     or oversize payloads from inflating prompts unbounded.
 *
 * Optional everywhere so `studioSnapshot: undefined` (not signed in /
 * empty project) doesn't reject. The pipeline treats null/undefined
 * as "no studio context" and skips that prompt-stack layer.
 *
 * Capacity rationale (don't tighten without evidence):
 *   - 64 furniture items: our apartamento.glb seeds ~65, room-director
 *     scenes typically have 4-12. Margin for L-shaped open floor plans.
 *   - 32 walls / 16 openings: matches our floorplan extractor's
 *     observed maximums.
 *   - 200 char description per item: covers our longest catalog
 *     labels with room to spare.
 *
 * Naming: the schema lives under `chat-brain/studio/` so the brain's
 * prompt-stack code can import directly. The client (chat-slice in
 * Turn 2e) imports it too to build the payload.
 */

import { z } from "zod";

const PlacedItemSnapZ = z.object({
  id: z.string().max(120),
  label: z.string().max(200),
  category: z.string().max(80),
  width: z.number(),
  depth: z.number(),
  height: z.number(),
  x: z.number(),
  z: z.number(),
  rotation: z.number(),
  visible: z.boolean(),
  placed: z.boolean(),
  /** Optional metadata — we look at `meta.source` to distinguish
   *  generated pieces from viewer-catalog pieces in the prompt block. */
  metaSource: z.string().max(60).optional(),
  metaGlbUrl: z.string().max(2048).optional(),
});

const WallSnapZ = z.object({
  id: z.string().max(120),
  x1: z.number(),
  z1: z.number(),
  x2: z.number(),
  z2: z.number(),
});

const OpeningSnapZ = z.object({
  id: z.string().max(120),
  kind: z.enum(["door", "window"]),
  x1: z.number(),
  z1: z.number(),
  x2: z.number(),
  z2: z.number(),
  height: z.number().optional(),
});

const RoomMetaSnapZ = z.object({
  width: z.number(),
  depth: z.number(),
  height: z.number(),
  minX: z.number(),
  maxX: z.number(),
  minZ: z.number(),
  maxZ: z.number(),
  minY: z.number().optional(),
  maxY: z.number().optional(),
});

const StyleBibleSnapZ = z.object({
  name: z.string().max(120),
  paletteWalls: z.string().max(40).optional(),
  paletteAccent: z.string().max(40).optional(),
  dominantWood: z.string().max(80).optional(),
  primaryTextile: z.string().max(80).optional(),
  metal: z.string().max(80).optional(),
  lighting: z.string().max(40).optional(),
  mood: z.string().max(200).optional(),
  forbidden: z.array(z.string().max(120)).max(20).optional(),
});

export const StudioSnapshotSchema = z.object({
  /** Project we're scoped to. Caller passes the same id used in
   *  `/api/conversations` so server-side storage stays consistent. */
  projectId: z.string().max(160).nullable(),
  /** Human-readable title. Keeps the prompt grounded without
   *  exposing only an opaque id. */
  projectTitle: z.string().max(240).optional(),
  /** Where the scene came from: viewer (apartamento.glb load) or
   *  room-director (text-to-3D generation). The serializer surfaces
   *  this distinction so the assistant gives appropriate advice
   *  ("you're working with a generated room sized 5m × 4m" vs "the
   *  apartment template includes ..."). */
  sceneSource: z.enum(["viewer", "room-director"]),
  roomMeta: RoomMetaSnapZ.nullable(),
  walls: z.array(WallSnapZ).max(48),
  openings: z.array(OpeningSnapZ).max(24),
  furniture: z.array(PlacedItemSnapZ).max(80),
  styleBible: StyleBibleSnapZ.nullable(),
  referenceImageUrl: z.string().max(4096).nullable().optional(),
  /** Mode the user is in (UI dropdown). Helps the brain calibrate
   *  voice — Ask is read-only Q&A, Interior Design wants advice with
   *  actions, Furniture/Room are generation paths. */
  mode: z
    .enum(["Ask", "Interior Design", "Furniture", "Room Layout"])
    .optional(),
});

export type StudioSnapshotPayload = z.infer<typeof StudioSnapshotSchema>;

/** Validate a raw payload from the client. Used by the chat brain's
 *  validation stage (Turn 3). For Turn 2 the serializer accepts
 *  pre-validated input directly — same shape, no double-parse. */
export function parseStudioSnapshot(
  raw: unknown,
):
  | { success: true; data: StudioSnapshotPayload }
  | { success: false; error: string } {
  const parsed = StudioSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.flatten().formErrors.join("; ") || "invalid snapshot",
    };
  }
  return { success: true, data: parsed.data };
}
