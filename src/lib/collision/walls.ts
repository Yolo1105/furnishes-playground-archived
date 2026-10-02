// Wall geometry primitives. Adapted from the zip's
// lib/collision/walls.ts; the math is identical (squared
// point-to-segment distance is canonical) but it works with
// our `Wall` shape from lib/floorplan/types instead of the
// zip's `WallSegment` (the two are field-compatible).
//
// Three exported predicates:
//   • pointToSegmentDistSq — primitive used by the others
//   • pointCollidesWithWalls — for walk-mode body collision
//     (the walker is a point with a body radius)
//   • itemCollidesWithWalls — for placing rectangular furniture;
//     8-point perimeter test against every wall
//   • distanceFromItemToNearestWall — used by health-system
//     rules like "bed against a wall" (Phase F4)

import type { Wall } from "@studio/floorplan/types";

/** Half-thickness used as the collision threshold against a wall.
 *  Walls are rendered ~0.16m thick on the 2D plan; treating the
 *  centerline + half-thickness as the solid keeps body collisions
 *  feeling correct even though our extracted Wall geometry is the
 *  centerline only. Matches the zip's WALL_HALF_THICKNESS = 0.08. */
export const WALL_HALF_THICKNESS = 0.08;

/** Squared distance from point (px, pz) to the closest point on
 *  segment (x1, z1) → (x2, z2). The squared form avoids a sqrt;
 *  callers compare against `threshold * threshold`. */
export function pointToSegmentDistSq(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  // Degenerate (zero-length) segment: distance to the single point.
  if (lenSq < 1e-10) {
    const ex = px - x1;
    const ez = pz - z1;
    return ex * ex + ez * ez;
  }
  // Project (px,pz) onto the segment, clamp t to [0,1].
  let t = ((px - x1) * dx + (pz - z1) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cz = z1 + t * dz;
  const ex = px - cx;
  const ez = pz - cz;
  return ex * ex + ez * ez;
}

/** Walk-mode body collision. The walker is a point (camera
 *  position) with a body radius; collides with a wall when the
 *  distance from the point to the wall centerline drops below
 *  (radius + WALL_HALF_THICKNESS). */
export function pointCollidesWithWalls(
  px: number,
  pz: number,
  radius: number,
  walls: readonly Wall[],
): boolean {
  const threshold = radius + WALL_HALF_THICKNESS;
  const thresholdSq = threshold * threshold;
  for (const seg of walls) {
    if (
      pointToSegmentDistSq(px, pz, seg.x1, seg.z1, seg.x2, seg.z2) < thresholdSq
    )
      return true;
  }
  return false;
}

/** Furniture-placement collision. The item is a rectangle centered
 *  at (cx, cz) with half-extents (hw, hd); we sample 8 perimeter
 *  points (4 corners + 4 mid-edges) and reject if any of them lies
 *  within wall half-thickness of any wall segment. Used by future
 *  drag-to-place and rotation-gizmo collision checks (Phase C2). */
export function itemCollidesWithWalls(
  cx: number,
  cz: number,
  hw: number,
  hd: number,
  walls: readonly Wall[],
): boolean {
  const testPoints: Array<[number, number]> = [
    [cx - hw, cz - hd],
    [cx + hw, cz - hd],
    [cx - hw, cz + hd],
    [cx + hw, cz + hd],
    [cx, cz - hd],
    [cx, cz + hd],
    [cx - hw, cz],
    [cx + hw, cz],
  ];
  const thresholdSq = WALL_HALF_THICKNESS * WALL_HALF_THICKNESS;
  for (const [px, pz] of testPoints) {
    for (const seg of walls) {
      if (
        pointToSegmentDistSq(px, pz, seg.x1, seg.z1, seg.x2, seg.z2) <
        thresholdSq
      )
        return true;
    }
  }
  return false;
}

/** Minimum distance from any point on a rectangular item's perimeter
 *  to any wall. Approximated via the same 8-point sample that
 *  itemCollidesWithWalls uses. Returns Infinity if there are no
 *  walls. Used by health rules ("bed against a wall" = distance
 *  ≤ threshold). */
export function distanceFromItemToNearestWall(
  cx: number,
  cz: number,
  hw: number,
  hd: number,
  walls: readonly Wall[],
): number {
  if (walls.length === 0) return Infinity;
  const testPoints: Array<[number, number]> = [
    [cx - hw, cz - hd],
    [cx + hw, cz - hd],
    [cx - hw, cz + hd],
    [cx + hw, cz + hd],
    [cx, cz - hd],
    [cx, cz + hd],
    [cx - hw, cz],
    [cx + hw, cz],
  ];
  let minDistSq = Infinity;
  for (const [px, pz] of testPoints) {
    for (const seg of walls) {
      const dSq = pointToSegmentDistSq(px, pz, seg.x1, seg.z1, seg.x2, seg.z2);
      if (dSq < minDistSq) minDistSq = dSq;
    }
  }
  return Math.sqrt(minDistSq);
}
