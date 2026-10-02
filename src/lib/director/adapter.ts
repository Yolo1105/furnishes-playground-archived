/**
 * Room Director ↔ furnishes-studio adapter.
 *
 * The single place where the z-UP wire format and the y-UP studio
 * coordinate system meet. Every other file uses our PlacedItem
 * natively; this module is the converter.
 *
 * Coordinate system reconciliation:
 *
 *   Room Director schema (z-UP, what Claude/the API emits):
 *     - Position: x (east-west), y (north-south), z (up)
 *     - Dimensions: length (x-axis), width (y-axis), height (z-axis)
 *     - Rotation: { z_angle: degrees }
 *     - Room: width_m, depth_m, height_m (origin at center, ±half each way)
 *
 *   furnishes-studio (y-UP, three.js convention, what our app uses):
 *     - Position: x (east-west), y (UP), z (north-south)
 *     - PlacedItem: width (X-axis), depth (Z-axis), height (Y-axis)
 *     - Rotation: 0|90|180|270 degrees (snapped from z-angle)
 *     - World coords are absolute (not centered on room center)
 *
 * The room-center → world-coords offset is handled by the orchestrator
 * (we tell Claude to plan with origin at room center, then the adapter
 * keeps that frame because our Apartment subscriber + wrapping-group
 * setup also treats coords as absolute world). For room-director scenes
 * the GeneratedApartment renderer is mounted at world origin, so RD's
 * "origin at room center" lines up with our "world origin" 1:1.
 *
 * Why a separate "Y" field on PlacedItem when wrapping groups handle
 * vertical placement: room-director pieces don't go through seedFromGlb
 * (they have no GLB to wrap). They get their wrappers created on the
 * fly via a helper, and the wrapper's Y position is `pieceY + height/2`
 * so the GLB pivot ends up at the piece's center. We persist Y so the
 * wrapper position is recoverable on hydrate.
 */

import type { PlacedItem } from "@studio/store/furniture-slice";
import type { Wall, Opening } from "@studio/floorplan/types";
import type {
  AssembledScene,
  PlacedPiece,
  WallSegment as RdWall,
  Opening as RdOpening,
  Palette,
  StyleBible,
} from "./schema";

/** Room metadata derived from a generated scene. Used by
 *  GeneratedApartment to render synthetic walls + floor at the right
 *  size. Coordinates are world-space y-UP. */
export interface RoomMeta {
  /** Room dimensions in meters. */
  width: number;
  depth: number;
  height: number;
  /** World-space bounds of the floor area. For a centered rectangular
   *  room: minX = -width/2, maxX = +width/2, minZ = -depth/2,
   *  maxZ = +depth/2. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Y bounds: floor at minY=0, ceiling at maxY=height. */
  minY: number;
  maxY: number;
}

// ─── Rotation helpers ──────────────────────────────────────────────────

/** Snap a z-angle in degrees to the nearest 0/90/180/270.
 *  Returns both the snapped value (what the gizmo uses) and the
 *  exact original (preserved in `meta.exactRotation` so re-export
 *  doesn't lose Claude's intent if it ever sent a non-orthogonal
 *  rotation). */
export function snapRotation(degrees: number): {
  snapped: 0 | 90 | 180 | 270;
  exact: number;
} {
  // Normalize to [0, 360).
  const normalized = ((degrees % 360) + 360) % 360;
  const candidates = [0, 90, 180, 270] as const;
  let best: 0 | 90 | 180 | 270 = 0;
  let bestDist = Infinity;
  for (const c of candidates) {
    // Wrap-aware distance: the gap between 350° and 0° is 10, not 350.
    const d = Math.min(
      Math.abs(normalized - c),
      Math.abs(normalized - c - 360),
    );
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { snapped: best, exact: degrees };
}

// ─── Color palette flattening ──────────────────────────────────────────

/** Flatten a Palette into an ordered color list for cycling through
 *  pieces. Used as a fallback when a piece has no explicit color hint. */
function paletteColorsList(palette: Palette): string[] {
  const colors = [palette.accent, palette.walls];
  if (palette.floor_tint) colors.push(palette.floor_tint);
  return colors;
}

// ─── Piece conversion ──────────────────────────────────────────────────

/**
 * Convert one Room Director piece to our PlacedItem.
 *
 * Axis swap (the critical bit):
 *
 *     RD position.x → studio x  (east-west, same axis)
 *     RD position.z → studio Y  (vertical — RD's z is UP, studio's y is UP)
 *     RD position.y → studio z  (north-south — RD's y is depth, studio's z is depth)
 *
 *     RD dims.length → studio width    (x-axis extent, same)
 *     RD dims.width  → studio depth    (z-axis extent — RD's y-extent is studio's z-extent)
 *     RD dims.height → studio height   (y-axis extent — RD's z-extent is studio's y-extent)
 *
 *     RD rotation.z_angle (deg) → studio rotation (snapped to 0/90/180/270)
 *
 * The `floor` flag dictates Y placement: `is_on_floor === true` means
 * the piece's bottom sits at Y=0, so the wrapping-group's Y is set
 * to `height/2` (centroid). For wall-mounted pieces (`is_on_floor`
 * false), the piece's `position.z` (RD's "z" = vertical) is the
 * absolute Y of the centroid.
 */
export function pieceToFurniture(
  p: PlacedPiece,
  scene: AssembledScene,
  pieceIndex: number,
): PlacedItem {
  const { snapped, exact } = snapRotation(p.rotation.z_angle);
  const colors = paletteColorsList(scene.style.palette);
  const color = colors[pieceIndex % colors.length] ?? "#cccccc";

  // Compute studio Y. For floor pieces the wrapper Y is height/2 so
  // the bottom sits at Y=0. For wall-mounted pieces, RD's position.z
  // (the vertical axis there) IS the wrapper Y.
  const studioY = p.is_on_floor ? p.dimensions.height / 2 : p.position.z;

  return {
    id: p.id,
    label: p.description,
    category: "Generated",
    shape: "rect",
    color,
    width: p.dimensions.length, // RD x-extent
    depth: p.dimensions.width, // RD y-extent (north-south)
    height: p.dimensions.height, // RD z-extent (vertical)
    x: p.position.x, // east-west, same
    z: p.position.y, // RD north-south becomes studio z
    rotation: snapped,
    locked: false,
    placed: true,
    visible: true,
    // Generated pieces carry their GLB url + RD-only metadata in `meta`.
    // The Apartment subscriber + GeneratedPieceMesh reach into this
    // to load the mesh; everything else (gizmos, persistence, health)
    // works on the top-level fields.
    meshes: [],
    meta: {
      source: "room-director",
      glbUrl: p.glb_url,
      previewGlbUrl: p.preview_glb_url,
      // v0.40.30: forward per-piece 2D image URL so the Reference
      // card can show it when the piece is selected, AND the
      // Interior Design tile-expansion UI can render per-piece
      // thumbnails. Optional — older entries lack it.
      imageUrl: p.image_url,
      satisfiedRelations: p.satisfied_relations,
      isOnFloor: p.is_on_floor,
      exactRotation: exact,
      sceneStyle: scene.style.name,
      layoutScore: scene.layout_score ?? 0,
      layoutArchetype: scene.layout_archetype,
      // Stash the studio Y so re-hydration can rebuild the wrapper.
      studioY,
    },
  };
}

/** Reverse: PlacedItem → PlacedPiece. Used when persisting a
 *  generated scene back to AssembledScene shape (for snapshot
 *  storage and for follow-up regeneration prompts). */
export function furnitureToPiece(f: PlacedItem): PlacedPiece {
  const meta = (f.meta ?? {}) as Record<string, unknown>;
  const exactRotation =
    typeof meta.exactRotation === "number" ? meta.exactRotation : f.rotation;
  const studioY =
    typeof meta.studioY === "number" ? meta.studioY : f.height / 2;

  return {
    id: f.id,
    category: typeof f.shape === "string" ? f.shape : "box",
    description: f.label,
    dimensions: {
      length: f.width,
      width: f.depth,
      height: f.height,
    },
    position: {
      x: f.x,
      y: f.z, // studio z is RD y
      z: studioY, // studio Y is RD z (vertical)
    },
    rotation: { z_angle: exactRotation },
    is_on_floor: (meta.isOnFloor as boolean) ?? studioY === f.height / 2,
    glb_url: meta.glbUrl as string | undefined,
    preview_glb_url: meta.previewGlbUrl as string | undefined,
    // v0.40.30: round-trip the per-piece image URL.
    image_url: meta.imageUrl as string | undefined,
    satisfied_relations: (meta.satisfiedRelations as string[]) ?? [],
  };
}

// ─── Wall + opening conversion ─────────────────────────────────────────
//
// RD wall coordinates are already in our world-space x/z plane (z-UP
// schemas use x and y for floor coords; we treat RD's y as our z).
// However, the WallSegment/Opening shapes use x1/z1/x2/z2 directly,
// where in RD's z-UP world "z" means vertical and the floor coords
// are (x, y). So we relabel during conversion: RD's y becomes our z.

export function rdWallToStudio(w: RdWall): Wall {
  // RD wall segment uses (x, z1) — but recall RD's z1 here actually
  // refers to the OTHER floor axis (it's named z1 by convention to
  // pair with our Wall type). The reference does this 1:1 because
  // wall coords are already in floor-space, not the vertical RD-z.
  // We pass through unchanged.
  return {
    id: w.id,
    x1: w.x1,
    z1: w.z1,
    x2: w.x2,
    z2: w.z2,
    thickness: w.thickness,
  };
}

export function rdOpeningToStudio(o: RdOpening): Opening {
  // We don't import the RD-specific "arch" kind into our Opening
  // (which only has door/window). Map arches to "door" — they
  // function the same for walkability + clearance purposes.
  const studioKind: Opening["kind"] = o.kind === "arch" ? "door" : o.kind;
  return {
    id: o.id,
    kind: studioKind,
    wallId: o.wallId ?? "",
    x1: o.x1,
    z1: o.z1,
    x2: o.x2,
    z2: o.z2,
    height: o.height,
    swing: o.swing,
  };
}

export function studioWallToRd(w: Wall): RdWall {
  return {
    id: w.id,
    x1: w.x1,
    z1: w.z1,
    x2: w.x2,
    z2: w.z2,
    thickness: w.thickness,
  };
}

export function studioOpeningToRd(o: Opening): RdOpening {
  return {
    id: o.id,
    kind: o.kind,
    wallId: o.wallId,
    x1: o.x1,
    z1: o.z1,
    x2: o.x2,
    z2: o.z2,
    height: o.height,
    swing: o.swing,
  };
}

// ─── Room meta ─────────────────────────────────────────────────────────

/** Derive RoomMeta (centered on world origin) from RD RoomShell.
 *  GeneratedApartment renders a rectangular floor + 4 walls using
 *  these bounds. */
export function roomShellToMeta(room: AssembledScene["room"]): RoomMeta {
  return {
    width: room.width_m,
    depth: room.depth_m,
    height: room.height_m,
    minX: -room.width_m / 2,
    maxX: room.width_m / 2,
    minZ: -room.depth_m / 2,
    maxZ: room.depth_m / 2,
    minY: 0,
    maxY: room.height_m,
  };
}

// ─── Whole-scene conversion ────────────────────────────────────────────

/** A fully-converted scene ready for the studio's slices to consume.
 *  Returned by `assembledSceneToStudio`; the chat-slice's generate-room
 *  handler unpacks this into the various slice setters. */
export interface StudioScene {
  furniture: PlacedItem[];
  roomMeta: RoomMeta;
  walls: Wall[];
  openings: Opening[];
  source: "room-director";
  style: StyleBible;
  layoutScore: number;
  scoreBreakdown: Record<string, number> | null;
  layoutArchetype?: string;
  referenceImageUrl?: string;
}

/** Convert a full AssembledScene into all the pieces the studio needs.
 *  Called by useDesignStream's `scene` event handler. */
export function assembledSceneToStudio(scene: AssembledScene): StudioScene {
  return {
    furniture: scene.pieces.map((p, i) => pieceToFurniture(p, scene, i)),
    roomMeta: roomShellToMeta(scene.room),
    walls: scene.walls.map(rdWallToStudio),
    openings: scene.openings.map(rdOpeningToStudio),
    source: "room-director",
    style: scene.style,
    layoutScore: scene.layout_score ?? 0,
    scoreBreakdown: scene.score_breakdown ?? null,
    layoutArchetype: scene.layout_archetype,
    referenceImageUrl: scene.reference_image_url,
  };
}

/** Reverse: build an AssembledScene from studio state. Used when
 *  saving a generated project — we serialize the AssembledScene
 *  shape so reload reconstructs everything via the same adapter. */
export function studioToAssembledScene(input: {
  furniture: PlacedItem[];
  roomMeta: RoomMeta;
  walls?: Wall[];
  openings?: Opening[];
  inheritedStyle?: StyleBible;
}): AssembledScene {
  const { furniture, roomMeta, walls, openings, inheritedStyle } = input;
  return {
    style: inheritedStyle ?? {
      name: "unknown",
      palette: { walls: "#cccccc", accent: "#5C4A3A" },
      materials: {},
      mood: "neutral",
      lighting: "neutral",
      forbidden: [],
    },
    room: {
      width_m: roomMeta.width,
      depth_m: roomMeta.depth,
      height_m: roomMeta.height,
      shape: "rectangle",
      openings: [],
    },
    pieces: furniture
      .filter((f) => f.placed && f.visible)
      .map(furnitureToPiece),
    walls: (walls ?? []).map(studioWallToRd),
    openings: (openings ?? []).map(studioOpeningToRd),
    layout_score: null,
    score_breakdown: null,
  };
}
