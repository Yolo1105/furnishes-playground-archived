// Room-bounds helpers. The zip derives bounds from a `RoomMeta`
// slice we don't have yet; instead, we compute bounds from the
// extracted walls (which we already have) by taking the min/max
// X/Z over all wall endpoints. Result is the apartment's outer
// bounding box on the floor plane.
//
// Used by future walkability grids (Phase F4) and AI generation
// validators (Phase E1) that need to reject candidate placements
// outside the apartment shell.

import type { Wall } from "@studio/floorplan/types";

export interface XZBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Compute the apartment's XZ bounding box from the wall set.
 *  Returns null when there are no walls (pre-seed state). */
export function boundsFromWalls(walls: readonly Wall[]): XZBounds | null {
  if (walls.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const w of walls) {
    if (w.x1 < minX) minX = w.x1;
    if (w.x2 < minX) minX = w.x2;
    if (w.x1 > maxX) maxX = w.x1;
    if (w.x2 > maxX) maxX = w.x2;
    if (w.z1 < minZ) minZ = w.z1;
    if (w.z2 < minZ) minZ = w.z2;
    if (w.z1 > maxZ) maxZ = w.z1;
    if (w.z2 > maxZ) maxZ = w.z2;
  }
  return { minX, maxX, minZ, maxZ };
}

/** True when the point (px, pz) falls inside the bounds. Inclusive
 *  on the min edges, exclusive on the max edges — matches the
 *  half-open convention used by occupancy-grid cell coordinates. */
export function pointInBounds(
  px: number,
  pz: number,
  bounds: XZBounds,
): boolean {
  return (
    px >= bounds.minX &&
    px < bounds.maxX &&
    pz >= bounds.minZ &&
    pz < bounds.maxZ
  );
}
