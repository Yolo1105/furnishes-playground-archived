/**
 * Shared studio-snapshot builder.
 *
 * Both `buildBrainPayload` (chat-slice) and `buildSuggestionsRequestPayload`
 * (suggestions-payload) need to convert the live store state into the
 * `StudioSnapshotPayload` shape that the server's Zod schema validates.
 *
 * Before consolidation the two builders had drifted:
 *   - chat-slice respected the schema caps (80 furniture / 48 walls /
 *     24 openings) and projected the style-bible fields one by one
 *     into a clean object that satisfies the schema's `.optional()`
 *     fields.
 *   - suggestions-payload didn't cap and forwarded the raw store
 *     fields as-is, which meant a project with 100+ furniture items
 *     would pass the chat schema (truncated to 80) but fail the
 *     suggestions schema (rejected at 81).
 *
 * Centralising here:
 *   - `buildStudioSnapshotForBrain` does the full projection, capped,
 *     defensively coerced. Returns a `StudioSnapshotPayload` ready to
 *     post.
 *
 * The function takes the slice of state it needs as a single object
 * (rather than the whole store) so callers can pass a typed view
 * without leaking every slice's interface.
 */

import type { StudioSnapshotPayload } from "./studio-snapshot-schema";

/** The slice of live store state needed to build a studio snapshot.
 *  Callers usually pass `state` directly — TypeScript narrows the
 *  field set here so a cross-slice read on the assembled store
 *  produces a payload without explicit typing. */
export type StudioSnapshotInputs = {
  projectId: string;
  projectTitle?: string | null;
  sceneSource?: "viewer" | "room-director" | string | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roomMeta?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  walls?: any[] | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openings?: any[] | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  furniture?: any[] | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  styleBible?: any | null | undefined;
  /** The reference image URL, if set. The chat route auto-promotes
   *  this into the attachments array; suggestions just passes it
   *  through. Either way, the value comes from store.referenceImage.url. */
  referenceImageUrl?: string | null | undefined;
  /** Mode is included in the snapshot for compatibility with the
   *  legacy snapshot serializer (which prints "Active mode: ..."
   *  on the studio prompt block). The brain route also reads mode
   *  from the top-level body for the Layer 8.5 directive. */
  mode?: string | null | undefined;
};

// Caps mirror the server-side Zod schema. Keeping them as constants
// here makes audit / schema-bump coordination easier than inlining.
const FURNITURE_CAP = 80;
const WALLS_CAP = 48;
const OPENINGS_CAP = 24;
const FORBIDDEN_STYLES_CAP = 20;

/** Project a single furniture item to the snapshot shape. Strict
 *  type coercion with `String()` / `Number()` / `Boolean()` so a
 *  partially-typed store value still produces something the schema
 *  validates. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function projectFurnitureItem(f: any) {
  return {
    id: String(f.id ?? ""),
    label: String(f.label ?? ""),
    category: String(f.category ?? ""),
    width: Number(f.width ?? 0),
    depth: Number(f.depth ?? 0),
    height: Number(f.height ?? 0),
    x: Number(f.x ?? 0),
    z: Number(f.z ?? 0),
    rotation: Number(f.rotation ?? 0),
    visible: Boolean(f.visible),
    placed: Boolean(f.placed),
    ...(f.meta?.source ? { metaSource: String(f.meta.source) } : {}),
    ...(f.meta?.glbUrl ? { metaGlbUrl: String(f.meta.glbUrl) } : {}),
  };
}

/** Project a single wall record. Walls are simple line segments. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function projectWall(w: any) {
  return {
    id: String(w.id ?? ""),
    x1: Number(w.x1 ?? 0),
    z1: Number(w.z1 ?? 0),
    x2: Number(w.x2 ?? 0),
    z2: Number(w.z2 ?? 0),
  };
}

/** Project a single opening (door / window). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function projectOpening(o: any) {
  return {
    id: String(o.id ?? ""),
    kind: o.kind === "window" ? ("window" as const) : ("door" as const),
    x1: Number(o.x1 ?? 0),
    z1: Number(o.z1 ?? 0),
    x2: Number(o.x2 ?? 0),
    z2: Number(o.z2 ?? 0),
    ...(typeof o.height === "number" ? { height: o.height } : {}),
  };
}

/** Project the room metadata block. The schema has a single shape
 *  with optional minY/maxY for 3D-aware paths. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function projectRoomMeta(roomMeta: any) {
  if (!roomMeta) return null;
  return {
    width: Number(roomMeta.width ?? 0),
    depth: Number(roomMeta.depth ?? 0),
    height: Number(roomMeta.height ?? 0),
    minX: Number(roomMeta.minX ?? 0),
    maxX: Number(roomMeta.maxX ?? 0),
    minZ: Number(roomMeta.minZ ?? 0),
    maxZ: Number(roomMeta.maxZ ?? 0),
    ...(typeof roomMeta.minY === "number" ? { minY: roomMeta.minY } : {}),
    ...(typeof roomMeta.maxY === "number" ? { maxY: roomMeta.maxY } : {}),
  };
}

/** Project the style-bible block, mirroring the schema's optional-field
 *  layout. Empty fields get omitted (rather than serialized as undefined)
 *  so the JSON payload is compact. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function projectStyleBible(styleBible: any) {
  if (!styleBible) return null;
  return {
    name: String(styleBible.name ?? "Untitled style"),
    ...(styleBible.palette?.walls
      ? { paletteWalls: String(styleBible.palette.walls) }
      : {}),
    ...(styleBible.palette?.accent
      ? { paletteAccent: String(styleBible.palette.accent) }
      : {}),
    ...(styleBible.dominantWood
      ? { dominantWood: String(styleBible.dominantWood) }
      : {}),
    ...(styleBible.primaryTextile
      ? { primaryTextile: String(styleBible.primaryTextile) }
      : {}),
    ...(styleBible.metal ? { metal: String(styleBible.metal) } : {}),
    ...(styleBible.lighting
      ? { lighting: String(styleBible.lighting) }
      : {}),
    ...(styleBible.mood ? { mood: String(styleBible.mood) } : {}),
    ...(Array.isArray(styleBible.forbidden)
      ? {
          forbidden: styleBible.forbidden
            .slice(0, FORBIDDEN_STYLES_CAP)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((s: any) => String(s).slice(0, 120)),
        }
      : {}),
  };
}

/**
 * Build a studio-snapshot payload from store state. Used by both
 * chat-slice (`buildBrainPayload`) and suggestions-payload
 * (`buildSuggestionsRequestPayload`).
 *
 * Caps applied:
 *   - furniture: 80
 *   - walls: 48
 *   - openings: 24
 *   - forbidden styles: 20 (inside style bible)
 *
 * Anything beyond the cap is silently truncated; the model still gets
 * a plausible snapshot. Schema validation matches these caps so the
 * truncated payload always passes.
 */
export function buildStudioSnapshotForBrain(
  inputs: StudioSnapshotInputs,
): StudioSnapshotPayload {
  const furniture = (inputs.furniture ?? [])
    .slice(0, FURNITURE_CAP)
    .map(projectFurnitureItem);

  const walls = (inputs.walls ?? []).slice(0, WALLS_CAP).map(projectWall);
  const openings = (inputs.openings ?? [])
    .slice(0, OPENINGS_CAP)
    .map(projectOpening);

  return {
    projectId: inputs.projectId,
    projectTitle: inputs.projectTitle ?? undefined,
    sceneSource:
      inputs.sceneSource === "room-director" ? "room-director" : "viewer",
    roomMeta: projectRoomMeta(inputs.roomMeta),
    walls,
    openings,
    furniture,
    styleBible: projectStyleBible(inputs.styleBible),
    referenceImageUrl: inputs.referenceImageUrl ?? null,
    mode:
      inputs.mode === "Ask" ||
      inputs.mode === "Interior Design" ||
      inputs.mode === "Furniture" ||
      inputs.mode === "Room Layout"
        ? inputs.mode
        : undefined,
  };
}
