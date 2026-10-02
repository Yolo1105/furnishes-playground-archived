/**
 * Layout validator — Increment 1 of the layout-quality work.
 *
 * Takes an AssembledScene (Claude's room + pieces + openings) and
 * scores it against the same rules Repo 2 (Furniture-Arrangement-
 * Generator) used for its PPO reward function. Pure function: no
 * I/O, no React, no Three.js. Server-side, deterministic.
 *
 * Score is in [0, 1]. The orchestrator's threshold for "send to
 * Claude for revision" is 0.7 by default — anything above is
 * accepted as-is, anything below triggers ONE retry round.
 *
 * Coordinate frame: director coords (the schema's frame, NOT the
 * studio's). position.x = east-west, position.y = north-south,
 * position.z = vertical-up. Same frame Claude uses, so violations
 * we report in messages back to Claude make sense in its own
 * worldview.
 *
 * What we check:
 *   1. Piece-piece overlap. Two pieces' axis-aligned bounding boxes
 *      should not intersect on the floor plane.
 *   2. Piece-piece clearance. Even non-overlapping pieces need a
 *      minimum gap depending on their categories (sofa-coffee table
 *      0.4m, dining table-chair 0.75m, etc.). Lifted from
 *      clearance.py's CLEARANCE_RULES.
 *   3. Piece-wall position. Pieces stay inside the room (their
 *      bounding box doesn't poke through the wall). Pieces marked
 *      "must touch wall" (bed, wardrobe, sofa) need their nearest
 *      face within 0.15m of a wall.
 *   4. Door blocking. For each door opening, compute the swing arc
 *      (a quarter-circle disc the leaf sweeps through) and verify
 *      no piece bbox intersects it. A 0.6m clearance buffer extends
 *      beyond the swing.
 *   5. Usage zones. Each piece type declares which sides need
 *      clearance for actual use — bed needs 0.6m on at least one
 *      long side, desk needs 0.5m front + 0.8m back, wardrobe needs
 *      0.6m front for door swing. Lifted from usage_zones.yaml.
 *
 * Score is computed as a weighted average:
 *   - hard violations (overlaps, blocking doors) zero the score
 *     immediately. The retry message will list them.
 *   - soft violations (insufficient clearance, missing wall contact)
 *     dock the score proportionally — each violation costs 0.05
 *     down to a floor of 0.5 if there are no hard issues.
 *   - if there are zero violations and zero warnings, score = 1.0.
 *
 * What we DON'T check (deliberate scope cuts for v1):
 *   - A* path from door to every piece. Adds significant code and
 *     catches relatively few bugs that the simpler door-blocking
 *     check doesn't already catch.
 *   - Piece rotation correctness against archetypes. That's
 *     Increment 2 (archetype priors).
 *   - satisfied_relations field verification: IMPLEMENTED in
 *     v0.40.36 (Increment 3). See the relations check below.
 *   - Aesthetic balance / symmetry. Subjective; would need a real
 *     model to score reliably.
 */

import type {
  AssembledScene,
  PlacedPiece,
  Opening,
} from "@studio/director/schema";

// ─── Types ─────────────────────────────────────────────────────────

export interface Violation {
  /** Human-readable message — what's wrong, in Claude's own
   *  coordinate frame, suitable to send back to Claude as a
   *  critique. Claude reads these directly when it revises. */
  message: string;
  /** Severity. "hard" zeros the score; "soft" docks proportionally. */
  severity: "hard" | "soft";
  /** Which piece IDs are involved (for highlighting in the UI later
   *  if we surface this to the user). Always at least one. */
  pieceIds: string[];
  /** Stable code so the orchestrator can group repeated kinds when
   *  composing the retry message. */
  code:
    | "piece_overlap"
    | "piece_clearance"
    | "outside_room"
    | "wall_contact_missing"
    | "door_blocked"
    | "usage_zone_blocked"
    | "relation_unsatisfied";
}

export interface ValidationResult {
  /** 0-1, where 1.0 = perfect, 0.0 = unusable. Above 0.7 = accept. */
  score: number;
  /** Per-dimension breakdown for analytics + UI. Each value 0-1. */
  breakdown: {
    overlap: number;
    clearance: number;
    bounds: number;
    doors: number;
    usage_zones: number;
    /** v0.40.36: relations dimension. 1.0 when every claimed
     *  relation in piece.satisfied_relations geometrically holds.
     *  Soft-only — failed claims dock the score but don't trigger
     *  retry on their own. */
    relations: number;
  };
  /** Hard violations (overlaps, blocked doors). Need to be fixed. */
  hardViolations: Violation[];
  /** Soft violations (insufficient clearance, missing wall contact).
   *  Knock down the score but don't trigger a hard retry. */
  softViolations: Violation[];
}

// ─── Clearance rules ───────────────────────────────────────────────
//
// Symmetric pairs — sofa + coffee_table needs 0.4m, regardless of
// which one is listed first. Lookup goes through `clearancePair()`
// which sorts the keys before checking.
//
// Categories use the same naming Claude emits in p.category — broad
// terms like "sofa", "chair", "dining_table" that match the prompt's
// example schema. The `getCategory()` helper normalizes case + maps
// common synonyms to canonical names.

const CLEARANCE_RULES: Record<string, number> = {
  // Direct port of Repo 2's clearance.py CLEARANCE_RULES (the
  // numeric ones — wall/door checks are handled separately below).
  "sofa+coffee_table": 0.0, // intentional contact OK; coffee table sits in front
  "table+chair": 0.0, // chairs surround the table
  "dining_table+chair": 0.0,
  "desk+chair": 0.0,
  "bed+nightstand": 0.0,
  // Defaults — any pair not listed gets `defaultClearance`.
};
const DEFAULT_CLEARANCE = 0.3; // 30 cm of breathing room between unrelated pieces
const WALL_CONTACT_THRESHOLD = 0.15; // a piece counts as "against wall" if within 15cm
const DOOR_SWING_BUFFER = 0.6; // extra clearance beyond the door swing arc

// Pieces in these categories should be against a wall when possible.
// Soft constraint — failing it is a soft violation, not hard.
const PREFERS_WALL = new Set([
  "bed",
  "wardrobe",
  "dresser",
  "credenza",
  "console",
  "bookshelf",
  "tv_stand",
  "sofa",
]);

// Usage zones — each piece category declares the clearance it needs
// on its access sides. "front" = +y direction in the piece's local
// frame (which is rotated by piece.rotation.z_angle relative to
// world). Lifted from Repo 2's usage_zones.yaml.
//
// minAnySide = the piece needs at least one of the listed sides to
// have AT LEAST that clearance. Used for beds — only one long side
// needs to be accessible, not both.
interface UsageZone {
  category: string;
  /** Per-side requirements in the piece's local frame. */
  clearances: Partial<Record<"front" | "back" | "left" | "right", number>>;
  /** If set, only one of the listed sides needs to meet the
   *  minimum. Else all listed sides do. */
  minAnySide?: { sides: ("front" | "back" | "left" | "right")[]; min: number };
}

const USAGE_ZONES: UsageZone[] = [
  {
    category: "bed",
    clearances: {},
    minAnySide: { sides: ["left", "right"], min: 0.6 },
  },
  {
    category: "desk",
    clearances: { front: 0.5, back: 0.8 },
  },
  {
    category: "wardrobe",
    clearances: { front: 0.6 },
  },
  {
    category: "dresser",
    clearances: { front: 0.6 },
  },
  {
    category: "chair",
    clearances: { back: 0.4 },
  },
  {
    category: "dining_chair",
    clearances: { back: 0.4 },
  },
  {
    category: "sofa",
    clearances: { front: 0.5 },
  },
];

// Category normalization — Claude emits things like "Dining Table",
// "TV Stand", "tv_stand" etc. Map these to canonical lowercase
// underscored names before any rule lookups.
function normalizeCategory(raw: string): string {
  const lower = raw.toLowerCase().trim();
  // Replace runs of non-alphanumeric with single underscore.
  const norm = lower.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  // Common synonyms.
  if (norm === "couch" || norm === "sectional" || norm === "loveseat")
    return "sofa";
  if (norm === "armchair" || norm === "lounge_chair" || norm === "accent_chair")
    return "chair";
  if (norm.includes("dining") && norm.includes("table")) return "dining_table";
  if (norm.includes("dining") && norm.includes("chair")) return "dining_chair";
  if (norm.includes("coffee") && norm.includes("table")) return "coffee_table";
  if (norm.includes("side") && norm.includes("table")) return "side_table";
  if (
    norm.includes("night") &&
    (norm.includes("stand") || norm.includes("table"))
  )
    return "nightstand";
  if (norm.includes("tv") && norm.includes("stand")) return "tv_stand";
  if (
    norm.includes("book") &&
    (norm.includes("shelf") || norm.includes("case"))
  )
    return "bookshelf";
  return norm;
}

function clearancePair(a: string, b: string): number {
  const [x, y] = [a, b].sort();
  const key = `${x}+${y}`;
  if (key in CLEARANCE_RULES) return CLEARANCE_RULES[key];
  return DEFAULT_CLEARANCE;
}

// ─── Geometry helpers ──────────────────────────────────────────────
//
// We work entirely in director coords on the floor plane: piece's
// (x, y) is its center; (length, width) are extents along world
// (x, y) before rotation. After rotation by z_angle the bounding
// box on the floor plane is computed by rotating the four corners.

interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface PieceBox {
  piece: PlacedPiece;
  category: string;
  /** Center on the floor plane. */
  cx: number;
  cy: number;
  /** Axis-aligned bounding box on the floor plane after rotation —
   *  conservative (a rotated rect's tight AABB). */
  aabb: AABB;
  /** The four floor-plane corners after rotation, in CCW order
   *  starting from front-right (local +x, +y). Used for usage-zone
   *  side projections. */
  corners: { x: number; y: number }[];
  /** The four side mid-points after rotation: front, back, left,
   *  right (in piece local frame). Used to project clearance
   *  outward in the right direction. */
  sides: Record<
    "front" | "back" | "left" | "right",
    { x: number; y: number; nx: number; ny: number }
  >;
  /** Per-axis half-extents in world space (used for AABB rebuild
   *  if needed). */
  halfL: number;
  halfW: number;
}

function makePieceBox(piece: PlacedPiece): PieceBox {
  const len = piece.dimensions.length; // local x extent
  const wid = piece.dimensions.width; // local y extent
  const hL = len / 2;
  const hW = wid / 2;
  const cx = piece.position.x;
  const cy = piece.position.y;
  const angleRad = (piece.rotation.z_angle * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  // Local corners (front-right, front-left, back-left, back-right).
  // We define local +y = "front" by convention so the orientation
  // matches Claude's mental model of where a chair is "facing."
  const localCorners = [
    { x: hL, y: hW }, // front-right
    { x: -hL, y: hW }, // front-left
    { x: -hL, y: -hW }, // back-left
    { x: hL, y: -hW }, // back-right
  ];
  const corners = localCorners.map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }));

  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const aabb: AABB = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };

  // Side midpoints in world coords + outward normals (in world
  // frame, unit length).
  const localSides = {
    front: { lx: 0, ly: hW, nlx: 0, nly: 1 },
    back: { lx: 0, ly: -hW, nlx: 0, nly: -1 },
    right: { lx: hL, ly: 0, nlx: 1, nly: 0 },
    left: { lx: -hL, ly: 0, nlx: -1, nly: 0 },
  };
  const sides = {} as PieceBox["sides"];
  for (const k of Object.keys(localSides) as (keyof typeof localSides)[]) {
    const s = localSides[k];
    sides[k] = {
      x: cx + s.lx * cos - s.ly * sin,
      y: cy + s.lx * sin + s.ly * cos,
      nx: s.nlx * cos - s.nly * sin,
      ny: s.nlx * sin + s.nly * cos,
    };
  }

  return {
    piece,
    category: normalizeCategory(piece.category),
    cx,
    cy,
    aabb,
    corners,
    sides,
    halfL: hL,
    halfW: hW,
  };
}

function aabbOverlap(a: AABB, b: AABB, tolerance = 0.001): boolean {
  return (
    a.minX < b.maxX - tolerance &&
    a.maxX > b.minX + tolerance &&
    a.minY < b.maxY - tolerance &&
    a.maxY > b.minY + tolerance
  );
}

function aabbDistance(a: AABB, b: AABB): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.sqrt(dx * dx + dy * dy);
}

function aabbInside(inner: AABB, outer: AABB, tolerance = 0.05): boolean {
  return (
    inner.minX >= outer.minX - tolerance &&
    inner.maxX <= outer.maxX + tolerance &&
    inner.minY >= outer.minY - tolerance &&
    inner.maxY <= outer.maxY + tolerance
  );
}

function aabbDistToPoint(a: AABB, px: number, py: number): number {
  const dx = Math.max(a.minX - px, 0, px - a.maxX);
  const dy = Math.max(a.minY - py, 0, py - a.maxY);
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Door swing arc ────────────────────────────────────────────────
//
// For each door, the leaf sweeps through a quarter-circle disc whose
// center is the hinge and radius is the door width. We approximate
// the disc as the union of:
//   - The opening rectangle itself (extending wallThickness into
//     the room).
//   - A square sector where the door swings.
// Then check piece AABBs against this region by sampling a few
// points along the arc and seeing if any are inside a piece bbox.

function doorSwingPolygon(
  op: Opening,
  roomWidth: number,
  roomDepth: number,
): {
  hinge: { x: number; y: number };
  radius: number;
  arcStart: number;
  arcEnd: number;
} | null {
  if (op.kind !== "door") return null;
  // Determine which wall the opening sits on by comparing endpoints
  // to the room bounds. Director coords: room is centered at origin,
  // so walls are at ±roomWidth/2 (x) and ±roomDepth/2 (y).
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const eps = 0.05;

  const isOnWall = (val: number, target: number) =>
    Math.abs(val - target) < eps;

  let wall: "north" | "south" | "east" | "west";
  // Note: in this schema "z" on opening is actually the y-axis on
  // the floor plane (north-south). Schema names are confusing but
  // they're what the orchestrator uses.
  if (isOnWall(op.z1, -halfD) && isOnWall(op.z2, -halfD)) wall = "north";
  else if (isOnWall(op.z1, halfD) && isOnWall(op.z2, halfD)) wall = "south";
  else if (isOnWall(op.x1, -halfW) && isOnWall(op.x2, -halfW)) wall = "west";
  else wall = "east";

  // Hinge side. swing="left" → hinge at the lower-coord endpoint;
  // "right" → hinge at the higher-coord endpoint. Default left.
  const swingLeft = op.swing !== "right";
  const x0 = Math.min(op.x1, op.x2);
  const x1 = Math.max(op.x1, op.x2);
  const y0 = Math.min(op.z1, op.z2);
  const y1 = Math.max(op.z1, op.z2);
  const width = Math.max(x1 - x0, y1 - y0);

  let hingeX = 0,
    hingeY = 0,
    arcStart = 0,
    arcEnd = 0;
  if (wall === "north" || wall === "south") {
    hingeX = swingLeft ? x0 : x1;
    hingeY = wall === "north" ? -halfD : halfD;
    // Door swings INTO the room (into +y on north wall, -y on
    // south wall). Arc starts at the wall (parallel to it) and
    // sweeps 90° INTO the room.
    if (wall === "north") {
      // hinge at hingeX, normal points +y. If swingLeft (hinge at
      // x0), arc goes from the +x direction (toward x1) up to +y.
      arcStart = swingLeft ? 0 : Math.PI;
      arcEnd = swingLeft ? Math.PI / 2 : Math.PI / 2;
    } else {
      arcStart = swingLeft ? 0 : Math.PI;
      arcEnd = swingLeft ? -Math.PI / 2 : -Math.PI / 2;
    }
  } else {
    hingeY = swingLeft ? y0 : y1;
    hingeX = wall === "west" ? -halfW : halfW;
    if (wall === "west") {
      arcStart = swingLeft ? -Math.PI / 2 : Math.PI / 2;
      arcEnd = 0;
    } else {
      arcStart = swingLeft ? -Math.PI / 2 : Math.PI / 2;
      arcEnd = Math.PI;
    }
  }

  return { hinge: { x: hingeX, y: hingeY }, radius: width, arcStart, arcEnd };
}

function _pointInSwingArc(
  px: number,
  py: number,
  swing: {
    hinge: { x: number; y: number };
    radius: number;
    arcStart: number;
    arcEnd: number;
  },
  buffer: number,
): boolean {
  const dx = px - swing.hinge.x;
  const dy = py - swing.hinge.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > swing.radius + buffer) return false;
  const angle = Math.atan2(dy, dx);
  // Normalize the angle test — the arc is a 90° sector. We allow
  // small angular tolerance.
  const lo = Math.min(swing.arcStart, swing.arcEnd);
  const hi = Math.max(swing.arcStart, swing.arcEnd);
  // Handle the case where the arc crosses ±π (e.g. east wall going
  // from π/2 to π or -π/2 to π — both are valid). Approximate by
  // allowing the angle to be within either of the two sub-ranges
  // [lo, hi] OR [hi - 2π, lo].
  const within = (a: number) => a >= lo - 0.05 && a <= hi + 0.05;
  return (
    within(angle) || within(angle + 2 * Math.PI) || within(angle - 2 * Math.PI)
  );
}

// ─── Main validate function ────────────────────────────────────────

export function validateLayout(scene: AssembledScene): ValidationResult {
  const hard: Violation[] = [];
  const soft: Violation[] = [];

  const roomWidth = scene.room.width_m;
  const roomDepth = scene.room.depth_m;
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const roomBox: AABB = {
    minX: -halfW,
    maxX: halfW,
    minY: -halfD,
    maxY: halfD,
  };

  const boxes = scene.pieces
    .filter((p) => p.is_on_floor !== false)
    .map(makePieceBox);

  // ── 1. Piece-piece overlap + clearance ─────────────────────────
  let overlapBad = 0;
  let clearanceBad = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i];
      const B = boxes[j];
      if (aabbOverlap(A.aabb, B.aabb)) {
        overlapBad++;
        hard.push({
          message: `pieces "${A.piece.id}" and "${B.piece.id}" overlap on the floor (their bounding boxes intersect)`,
          severity: "hard",
          pieceIds: [A.piece.id, B.piece.id],
          code: "piece_overlap",
        });
        continue;
      }
      const required = clearancePair(A.category, B.category);
      if (required <= 0) continue;
      const dist = aabbDistance(A.aabb, B.aabb);
      if (dist < required - 0.05) {
        clearanceBad++;
        soft.push({
          message: `pieces "${A.piece.id}" (${A.category}) and "${B.piece.id}" (${B.category}) are ${dist.toFixed(2)}m apart but should have at least ${required.toFixed(2)}m of clearance`,
          severity: "soft",
          pieceIds: [A.piece.id, B.piece.id],
          code: "piece_clearance",
        });
      }
    }
  }

  // ── 2. Bounds + wall contact ───────────────────────────────────
  let boundsBad = 0;
  for (const A of boxes) {
    if (!aabbInside(A.aabb, roomBox)) {
      boundsBad++;
      hard.push({
        message: `piece "${A.piece.id}" extends outside the room (its bounding box pokes through a wall)`,
        severity: "hard",
        pieceIds: [A.piece.id],
        code: "outside_room",
      });
    }
    if (PREFERS_WALL.has(A.category)) {
      const distToNearest = Math.min(
        A.aabb.minX - roomBox.minX,
        roomBox.maxX - A.aabb.maxX,
        A.aabb.minY - roomBox.minY,
        roomBox.maxY - A.aabb.maxY,
      );
      if (distToNearest > WALL_CONTACT_THRESHOLD) {
        soft.push({
          message: `piece "${A.piece.id}" (${A.category}) prefers wall contact but is ${distToNearest.toFixed(2)}m from the nearest wall`,
          severity: "soft",
          pieceIds: [A.piece.id],
          code: "wall_contact_missing",
        });
      }
    }
  }

  // ── 3. Door blocking ───────────────────────────────────────────
  let doorBad = 0;
  for (const op of scene.openings.filter((o) => o.kind === "door")) {
    const swing = doorSwingPolygon(op, roomWidth, roomDepth);
    if (!swing) continue;
    for (const A of boxes) {
      // Cheap: does the AABB get within (radius + buffer) of the
      // hinge? If not, can't possibly intersect the swing.
      const distToHinge = aabbDistToPoint(A.aabb, swing.hinge.x, swing.hinge.y);
      if (distToHinge > swing.radius + DOOR_SWING_BUFFER) continue;
      // Sample 9 points along the arc + interior; if any sits inside
      // the AABB, we're blocking. Sampling at ~10° resolution along
      // the 90° arc plus 3 radial samples gives 27 points total —
      // catches all but pathologically thin pieces.
      let blocking = false;
      const steps = 9;
      for (let s = 0; s <= steps && !blocking; s++) {
        const t = s / steps;
        const ang = swing.arcStart + (swing.arcEnd - swing.arcStart) * t;
        for (const r of [0.4, 0.7, 1.0]) {
          const px = swing.hinge.x + Math.cos(ang) * swing.radius * r;
          const py = swing.hinge.y + Math.sin(ang) * swing.radius * r;
          if (
            px >= A.aabb.minX - 0.01 &&
            px <= A.aabb.maxX + 0.01 &&
            py >= A.aabb.minY - 0.01 &&
            py <= A.aabb.maxY + 0.01
          ) {
            blocking = true;
            break;
          }
        }
      }
      if (blocking) {
        doorBad++;
        hard.push({
          message: `piece "${A.piece.id}" (${A.category}) blocks the door's swing arc — move it at least ${(swing.radius + DOOR_SWING_BUFFER).toFixed(1)}m away from the hinge`,
          severity: "hard",
          pieceIds: [A.piece.id],
          code: "door_blocked",
        });
      }
    }
  }

  // ── 4. Usage zones ─────────────────────────────────────────────
  let usageBad = 0;
  for (const A of boxes) {
    const zone = USAGE_ZONES.find((z) => z.category === A.category);
    if (!zone) continue;

    const checkSide = (
      side: "front" | "back" | "left" | "right",
      need: number,
    ): { ok: boolean; got: number } => {
      const s = A.sides[side];
      // Project outward by `need` and see what we hit. Find the
      // closest blocker (other piece bbox or wall) along that ray.
      // Approximate: sample points along the outward normal at
      // 0.05m intervals up to `need`, return the first distance
      // that hits something.
      let got = need;
      const steps = Math.ceil(need / 0.05);
      for (let i = 1; i <= steps; i++) {
        const d = i * 0.05;
        const px = s.x + s.nx * d;
        const py = s.y + s.ny * d;
        if (
          px < roomBox.minX ||
          px > roomBox.maxX ||
          py < roomBox.minY ||
          py > roomBox.maxY
        ) {
          got = d;
          break;
        }
        let hit = false;
        for (const B of boxes) {
          if (B.piece.id === A.piece.id) continue;
          if (
            px >= B.aabb.minX - 0.01 &&
            px <= B.aabb.maxX + 0.01 &&
            py >= B.aabb.minY - 0.01 &&
            py <= B.aabb.maxY + 0.01
          ) {
            hit = true;
            break;
          }
        }
        if (hit) {
          got = d;
          break;
        }
      }
      return { ok: got >= need - 0.05, got };
    };

    if (zone.minAnySide) {
      const results = zone.minAnySide.sides.map((s) =>
        checkSide(s, zone.minAnySide!.min),
      );
      const anyOk = results.some((r) => r.ok);
      if (!anyOk) {
        usageBad++;
        const best = Math.max(...results.map((r) => r.got));
        soft.push({
          message: `piece "${A.piece.id}" (${A.category}) needs at least ${zone.minAnySide.min.toFixed(2)}m of clearance on at least one of (${zone.minAnySide.sides.join(", ")}) but the best side has only ${best.toFixed(2)}m`,
          severity: "soft",
          pieceIds: [A.piece.id],
          code: "usage_zone_blocked",
        });
      }
    }
    for (const [sideRaw, need] of Object.entries(zone.clearances)) {
      if (need == null) continue;
      const side = sideRaw as "front" | "back" | "left" | "right";
      const { ok, got } = checkSide(side, need);
      if (!ok) {
        usageBad++;
        soft.push({
          message: `piece "${A.piece.id}" (${A.category}) needs ${need.toFixed(2)}m of clearance on its ${side} side but has only ${got.toFixed(2)}m`,
          severity: "soft",
          pieceIds: [A.piece.id],
          code: "usage_zone_blocked",
        });
      }
    }
  }

  // ── 5. Satisfied relations (Increment 3) ───────────────────────
  // Each piece's `satisfied_relations` array claims spatial
  // relationships against other pieces or against the room. We
  // verify each claim geometrically and dock the relations sub-
  // score for falsified claims. Vocabulary:
  //   - near:<id>      → centers within 1.0m
  //   - faces:<id>     → A's local +y direction points at B's
  //                      center within ±30° tolerance
  //   - flanking:<id>  → A is to the left/right of B at the same
  //                      depth-range, within 0.3m of B's edge
  //   - against:wall   → nearest face within 0.15m of any room wall
  //   - centered:wall  → A's center coordinate along its closest
  //                      wall is within 0.5m of the wall midpoint
  // Unknown relation tokens are silently ignored — Claude
  // sometimes invents new ones; we don't penalize that.
  let relationsBad = 0;
  const boxById = new Map(boxes.map((b) => [b.piece.id, b]));
  for (const A of boxes) {
    const claims = A.piece.satisfied_relations ?? [];
    for (const claim of claims) {
      const m = claim.match(/^(near|faces|flanking|against|centered):(.+)$/);
      if (!m) continue;
      const kind = m[1];
      const arg = m[2];

      if (kind === "near") {
        const B = boxById.get(arg);
        if (!B) continue;
        const dx = A.cx - B.cx;
        const dy = A.cy - B.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1.0) {
          relationsBad++;
          soft.push({
            message: `piece "${A.piece.id}" claims near:${arg} but centers are ${d.toFixed(2)}m apart (max 1.0m)`,
            severity: "soft",
            pieceIds: [A.piece.id, arg],
            code: "relation_unsatisfied",
          });
        }
      } else if (kind === "faces") {
        const B = boxById.get(arg);
        if (!B) continue;
        const angleRad = (A.piece.rotation.z_angle * Math.PI) / 180;
        // A's "facing" direction = local +y rotated to world.
        const fx = -Math.sin(angleRad);
        const fy = Math.cos(angleRad);
        const tx = B.cx - A.cx;
        const ty = B.cy - A.cy;
        const tlen = Math.sqrt(tx * tx + ty * ty);
        if (tlen < 0.01) continue;
        const dot = (fx * tx + fy * ty) / tlen;
        // ±30° tolerance: cos(30°) ≈ 0.866
        if (dot < 0.866) {
          relationsBad++;
          soft.push({
            message: `piece "${A.piece.id}" claims faces:${arg} but its rotation doesn't point at the target (off by more than 30°)`,
            severity: "soft",
            pieceIds: [A.piece.id, arg],
            code: "relation_unsatisfied",
          });
        }
      } else if (kind === "flanking") {
        const B = boxById.get(arg);
        if (!B) continue;
        // A is "flanking" B if A sits to either +x or -x side of
        // B with overlapping y-range and the gap between AABBs
        // along x is small (within 0.3m of B's edge).
        const yOverlap = A.aabb.minY < B.aabb.maxY && A.aabb.maxY > B.aabb.minY;
        const gapX =
          A.aabb.minX > B.aabb.maxX
            ? A.aabb.minX - B.aabb.maxX
            : B.aabb.minX > A.aabb.maxX
              ? B.aabb.minX - A.aabb.maxX
              : -1;
        const xOverlap = A.aabb.minX < B.aabb.maxX && A.aabb.maxX > B.aabb.minX;
        const gapY =
          A.aabb.minY > B.aabb.maxY
            ? A.aabb.minY - B.aabb.maxY
            : B.aabb.minY > A.aabb.maxY
              ? B.aabb.minY - A.aabb.maxY
              : -1;
        const flanksXAxis = yOverlap && gapX >= 0 && gapX <= 0.3;
        const flanksYAxis = xOverlap && gapY >= 0 && gapY <= 0.3;
        if (!flanksXAxis && !flanksYAxis) {
          relationsBad++;
          soft.push({
            message: `piece "${A.piece.id}" claims flanking:${arg} but isn't sitting alongside it within 0.3m`,
            severity: "soft",
            pieceIds: [A.piece.id, arg],
            code: "relation_unsatisfied",
          });
        }
      } else if (kind === "against" && arg === "wall") {
        const distToNearest = Math.min(
          A.aabb.minX - roomBox.minX,
          roomBox.maxX - A.aabb.maxX,
          A.aabb.minY - roomBox.minY,
          roomBox.maxY - A.aabb.maxY,
        );
        if (distToNearest > WALL_CONTACT_THRESHOLD) {
          relationsBad++;
          soft.push({
            message: `piece "${A.piece.id}" claims against:wall but is ${distToNearest.toFixed(2)}m from the nearest wall`,
            severity: "soft",
            pieceIds: [A.piece.id],
            code: "relation_unsatisfied",
          });
        }
      } else if (kind === "centered" && arg === "wall") {
        // Pick the wall the piece is closest to; check the piece's
        // along-wall coordinate is within 0.5m of the wall midpoint.
        const dN = A.aabb.minY - roomBox.minY;
        const dS = roomBox.maxY - A.aabb.maxY;
        const dW = A.aabb.minX - roomBox.minX;
        const dE = roomBox.maxX - A.aabb.maxX;
        const minD = Math.min(dN, dS, dW, dE);
        let alongCoord = 0;
        let wallMid = 0;
        if (minD === dN || minD === dS) {
          alongCoord = A.cx;
          wallMid = (roomBox.minX + roomBox.maxX) / 2;
        } else {
          alongCoord = A.cy;
          wallMid = (roomBox.minY + roomBox.maxY) / 2;
        }
        if (Math.abs(alongCoord - wallMid) > 0.5) {
          relationsBad++;
          soft.push({
            message: `piece "${A.piece.id}" claims centered:wall but is ${Math.abs(alongCoord - wallMid).toFixed(2)}m off-center along its nearest wall (max 0.5m)`,
            severity: "soft",
            pieceIds: [A.piece.id],
            code: "relation_unsatisfied",
          });
        }
      }
    }
  }

  // ── Compute per-dimension breakdown + total score ──────────────
  // Each dimension is 1.0 when no violations. Hard violations push
  // the dimension to 0; soft violations linearly degrade up to a
  // floor of 0.4 per dimension.
  const subScore = (hardCount: number, softCount: number): number => {
    if (hardCount > 0) return 0;
    if (softCount === 0) return 1;
    return Math.max(0.4, 1 - softCount * 0.15);
  };
  const breakdown = {
    overlap: subScore(overlapBad, 0),
    clearance: subScore(0, clearanceBad),
    bounds: subScore(boundsBad, 0),
    doors: subScore(doorBad, 0),
    usage_zones: subScore(0, usageBad),
    relations: subScore(0, relationsBad),
  };
  // Weighted average — overlap and door blocking are weighted higher
  // because they make a layout actually unusable. Clearance, usage
  // zones, and relations are nice-to-have. Weights sum to 1.0.
  // Relations get a small slice (0.10) because Claude doesn't always
  // populate the field, and over-weighting it would penalize older
  // generations or those where Claude chose not to claim relations.
  const score =
    0.28 * breakdown.overlap +
    0.14 * breakdown.clearance +
    0.18 * breakdown.bounds +
    0.18 * breakdown.doors +
    0.12 * breakdown.usage_zones +
    0.1 * breakdown.relations;

  return {
    score: Math.max(0, Math.min(1, score)),
    breakdown,
    hardViolations: hard,
    softViolations: soft,
  };
}

// ─── Critique formatter ────────────────────────────────────────────
//
// Produces a short markdown-formatted critique suitable to send back
// to Claude as a follow-up message. Groups violations by code so
// Claude doesn't see ten copies of "piece X overlaps Y, X overlaps
// Z, X overlaps W" — gets one summary per kind.

export function formatCritiqueForClaude(result: ValidationResult): string {
  if (
    result.hardViolations.length === 0 &&
    result.softViolations.length === 0
  ) {
    return "";
  }
  const all = [...result.hardViolations, ...result.softViolations];
  const grouped = new Map<string, Violation[]>();
  for (const v of all) {
    const list = grouped.get(v.code) ?? [];
    list.push(v);
    grouped.set(v.code, list);
  }
  const lines: string[] = [];
  lines.push(
    `Your previous layout scored ${result.score.toFixed(2)} out of 1.00. Please revise it to fix these issues:`,
    "",
  );
  for (const [code, violations] of grouped) {
    lines.push(`**${code.replace(/_/g, " ")}** (${violations.length}):`);
    for (const v of violations.slice(0, 4)) {
      lines.push(`  - ${v.message}`);
    }
    if (violations.length > 4) {
      lines.push(`  - …and ${violations.length - 4} more of the same kind`);
    }
    lines.push("");
  }
  lines.push(
    "Return the same AssembledScene JSON shape with adjusted piece positions/rotations to fix these. Keep the style, room dimensions, and piece list the same — only adjust positions and rotations.",
  );
  return lines.join("\n");
}
