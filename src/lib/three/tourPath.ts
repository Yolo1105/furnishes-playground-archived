import type { PlacedItem } from "@studio/store/furniture-slice";
import * as THREE from "three";

/**
 * Build a tour path through the apartment. Used by the Tour button
 * to generate the camera flythrough route.
 *
 * Priority order:
 *
 *   1. **User-placed waypoints** win — if the user has dropped any
 *      pins on the 2D plan, the tour visits them in placement
 *      order. The user is telling us exactly where to go.
 *
 *   2. **Auto-generated path** as fallback — picks a representative
 *      subset of large furniture items, sorts them by clockwise
 *      angle from the apartment center, and visits each. This
 *      produces a roughly circular tour that hits every "zone" of
 *      the apartment (sofa, kitchen, bedroom, bathroom) without
 *      backtracking.
 *
 * In both cases, the apartmentCenter is pre-pended as a starting
 * point and re-appended as the closing waypoint so the tour begins
 * and ends in the middle of the room — gives a natural "look around
 * from the center first" framing rather than dropping the camera
 * directly onto the first piece of furniture.
 */
export function buildTourPath(
  customWaypoints: Array<{ x: number; z: number }>,
  furniture: PlacedItem[],
  apartmentCenter: [number, number] | null,
): Array<{ x: number; z: number }> {
  // ── Custom-waypoint path ──────────────────────────────────────
  if (customWaypoints.length >= 1) {
    const path = customWaypoints.map((w) => ({ x: w.x, z: w.z }));
    if (apartmentCenter) {
      const [cx, cz] = apartmentCenter;
      // Start at center if the first waypoint is far from it; this
      // gives the tour a sensible "looking from middle" intro.
      const first = path[0];
      const distToFirst = Math.hypot(first.x - cx, first.z - cz);
      if (distToFirst > 1.5) path.unshift({ x: cx, z: cz });
    }
    return path;
  }

  // ── Auto-generated path ───────────────────────────────────────
  if (!apartmentCenter) return [];
  const [cx, cz] = apartmentCenter;

  // Score each visible item by max footprint dimension (bigger
  // pieces define rooms — sofa, bed, dining table — and make
  // better tour stops than tiny decor).
  const candidates: Array<{
    x: number;
    z: number;
    score: number;
    angle: number;
  }> = [];
  for (const item of furniture) {
    if (!item.placed || !item.visible) continue;
    if (item.meshes.length === 0) continue;
    const box = new THREE.Box3();
    for (const m of item.meshes) box.expandByObject(m);
    if (box.isEmpty()) continue;
    const ix = (box.min.x + box.max.x) / 2;
    const iz = (box.min.z + box.max.z) / 2;
    const w = box.max.x - box.min.x;
    const d = box.max.z - box.min.z;
    const score = Math.max(w, d);
    if (score < 0.5) continue; // skip decor / tiny items
    const angle = Math.atan2(iz - cz, ix - cx);
    candidates.push({ x: ix, z: iz, score, angle });
  }

  // Sort by score descending and take the top N — but we also want
  // *spatial coverage*, not just N biggest items clustered in one
  // corner. So after picking the top 12 by score, sort those by
  // clockwise angle and dedupe spatially-close picks.
  candidates.sort((a, b) => b.score - a.score);
  const topByScore = candidates.slice(0, 12);
  topByScore.sort((a, b) => a.angle - b.angle);

  const stops: Array<{ x: number; z: number }> = [];
  const MIN_STOP_DIST = 1.2; // metres — minimum spacing between stops
  for (const c of topByScore) {
    let tooClose = false;
    for (const s of stops) {
      if (Math.hypot(c.x - s.x, c.z - s.z) < MIN_STOP_DIST) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) stops.push({ x: c.x, z: c.z });
  }

  // Pull each stop slightly toward the center (0.5m) so the camera
  // ends up in walkable floor area rather than sitting on top of
  // the furniture. Without this, the tour would clip through every
  // sofa it visits.
  const PULL = 0.6;
  const pulled = stops.map((s) => {
    const dx = cx - s.x;
    const dz = cz - s.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return s;
    return {
      x: s.x + (dx / len) * PULL,
      z: s.z + (dz / len) * PULL,
    };
  });

  // Bookend with center.
  return [{ x: cx, z: cz }, ...pulled, { x: cx, z: cz }];
}
