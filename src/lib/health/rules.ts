// Design-rule engine. Each rule reads the current placed scene plus
// the user's requirements, and returns zero or more violations. The
// Health tab renders the aggregated violation list.
//
// Rules are pure functions over the scene state — they read the
// store but don't write to it. The tab calls runHealthChecks(...)
// once per render and gets back a typed violation list.
//
// Adding a rule: write a new RuleFn, push it to the RULES array.
// No other plumbing needed; the tab will pick it up automatically.

import {
  itemCollidesWithWalls,
  distanceFromItemToNearestWall,
  findOverlappingIds,
  boundsFromWalls,
} from "@studio/collision";
import type { PlacedItem } from "@studio/store/furniture-slice";
import type { Wall } from "@studio/floorplan/types";
import type { RequirementsSnapshot } from "@studio/persistence/snapshot";

export type Severity = "error" | "warning" | "info";

export interface Violation {
  /** Stable id for the violation — used as React key. Combines the
   *  rule id and the offending item id(s) so the same violation
   *  reused across renders has the same key. */
  id: string;
  /** Severity drives the color treatment in the UI: error = red,
   *  warning = orange, info = neutral. */
  severity: Severity;
  /** Short summary line shown as the row title. */
  title: string;
  /** Longer description, optional. Displayed below the title in
   *  smaller muted text. */
  description?: string;
  /** Item ids relevant to this violation. Clicking the row in the
   *  Health tab selects the FIRST id (highlights in 3D) so the
   *  user can see what's wrong. */
  itemIds: string[];
}

export interface RuleContext {
  placed: PlacedItem[];
  walls: Wall[];
  requirements: RequirementsSnapshot;
  lockedIds: Record<string, boolean>;
}

type RuleFn = (ctx: RuleContext) => Violation[];

// ── Rule: items not intersecting walls ─────────────────────────────
const ruleNoWallIntersect: RuleFn = ({ placed, walls }) => {
  if (walls.length === 0) return [];
  const out: Violation[] = [];
  for (const item of placed) {
    if (!item.visible) continue;
    const hw = item.width / 2;
    const hd = item.depth / 2;
    if (itemCollidesWithWalls(item.x, item.z, hw, hd, walls)) {
      out.push({
        id: `wall-intersect:${item.id}`,
        severity: "error",
        title: `${item.label} intersects a wall`,
        description:
          "The piece overlaps the room shell. Move or rotate it back inside the wall line.",
        itemIds: [item.id],
      });
    }
  }
  return out;
};

// ── Rule: no two items overlap ─────────────────────────────────────
const ruleNoOverlap: RuleFn = ({ placed }) => {
  // Build the input the collision overlap function expects: the
  // generic AABBInput shape with `id`. We have all those fields on
  // PlacedItem already.
  const visible = placed.filter((p) => p.visible);
  const offending = findOverlappingIds(visible);
  if (offending.size === 0) return [];
  const out: Violation[] = [];
  for (const id of offending) {
    const item = visible.find((v) => v.id === id);
    if (!item) continue;
    out.push({
      id: `overlap:${item.id}`,
      severity: "error",
      title: `${item.label} overlaps another piece`,
      description:
        "Two pieces share floor space. Move one to free a clear footprint.",
      itemIds: [item.id],
    });
  }
  return out;
};

// ── Rule: bed against wall ─────────────────────────────────────────
const ruleBedAgainstWall: RuleFn = ({ placed, walls, requirements }) => {
  if (requirements.bedAgainstWall === "off" || walls.length === 0) return [];
  const out: Violation[] = [];
  // Match items whose label contains "bed" (case-insensitive). We
  // could match on category but the catalog's category strings are
  // inconsistent — label-substring is more reliable for now.
  const beds = placed.filter((p) => p.visible && /\bbed\b/i.test(p.label));
  const THRESHOLD = 0.25; // meters — closer than this counts as "against"
  for (const bed of beds) {
    const hw = bed.width / 2;
    const hd = bed.depth / 2;
    const dist = distanceFromItemToNearestWall(bed.x, bed.z, hw, hd, walls);
    if (dist > THRESHOLD) {
      const severity: Severity =
        requirements.bedAgainstWall === "required" ? "error" : "warning";
      out.push({
        id: `bed-wall:${bed.id}`,
        severity,
        title: `${bed.label} is not against a wall`,
        description: `Currently ${dist.toFixed(2)}m from the nearest wall — your requirement is ${requirements.bedAgainstWall === "required" ? "required" : "preferred"} bed-against-wall.`,
        itemIds: [bed.id],
      });
    }
  }
  return out;
};

// ── Rule: items inside room bounds ─────────────────────────────────
const ruleInBounds: RuleFn = ({ placed, walls }) => {
  const bounds = boundsFromWalls(walls);
  if (!bounds) return [];
  const out: Violation[] = [];
  // Tolerance: half the item's footprint can hang outside the centerline
  // and still feel correct. Stricter checks happen in ruleNoWallIntersect.
  for (const item of placed) {
    if (!item.visible) continue;
    if (
      item.x < bounds.minX ||
      item.x > bounds.maxX ||
      item.z < bounds.minZ ||
      item.z > bounds.maxZ
    ) {
      out.push({
        id: `out-of-bounds:${item.id}`,
        severity: "error",
        title: `${item.label} is outside the room`,
        description:
          "The item's center sits outside the apartment's bounding box.",
        itemIds: [item.id],
      });
    }
  }
  return out;
};

// ── Rule: must-include categories present ──────────────────────────
const ruleMustInclude: RuleFn = ({ placed, requirements }) => {
  const out: Violation[] = [];
  for (const [category, required] of Object.entries(requirements.mustInclude)) {
    if (!required) continue;
    const has = placed.some(
      (p) => p.visible && new RegExp(`\\b${category}\\b`, "i").test(p.label),
    );
    if (!has) {
      out.push({
        id: `must-include:${category}`,
        severity: "warning",
        title: `Missing required item: ${category}`,
        description: `Your Requirements tab marks "${category}" as must-include, but no visible piece in the scene matches.`,
        itemIds: [],
      });
    }
  }
  return out;
};

const RULES: RuleFn[] = [
  ruleNoWallIntersect,
  ruleNoOverlap,
  ruleBedAgainstWall,
  ruleInBounds,
  ruleMustInclude,
];

export function runHealthChecks(ctx: RuleContext): Violation[] {
  const all: Violation[] = [];
  for (const rule of RULES) {
    try {
      all.push(...rule(ctx));
    } catch {
      // A bad rule shouldn't crash the panel. Swallow individual
      // rule failures; the rest of the violations still surface.
    }
  }
  // Stable sort: errors first, warnings, info last; within a tier
  // preserve rule order so the panel reads consistently.
  const sevRank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return all.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
}
