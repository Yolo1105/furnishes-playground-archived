// Furniture-vs-furniture overlap detection. Given a list of items,
// return the set of ids that overlap at least one other item.
//
// Adapted from the zip's lib/collision/overlap.ts. Uses our generic
// AABBInput shape rather than the zip's `FurnitureItem` so it can
// be applied to any item collection without coupling to a slice
// shape. Until Phase C2 (rotation gizmo) and Phase E1 (AI generation)
// give furniture explicit positions in the store, this is dormant
// — it'll come alive once items have x/z/rotation fields.

import { getAABB, aabbsOverlap, type AABBInput } from "./aabb";

/** Default tolerance: items can come within 8cm of each other
 *  before overlap is reported. Avoids false positives where two
 *  pieces are tightly placed but visually distinct (sofa flush
 *  against an end-table is fine; sofa intersecting end-table is
 *  not). Matches the zip's OVERLAP_TOLERANCE constant. */
const OVERLAP_TOLERANCE = 0.08;

export interface OverlapPair {
  a: string;
  b: string;
}

/** Returns the set of ids that overlap at least one other item.
 *  O(n²) — fine for our scales (<100 items). Items must have an
 *  `id` field plus the AABBInput shape (x, z, width, depth,
 *  rotation). */
export function findOverlappingIds<T extends AABBInput & { id: string }>(
  items: readonly T[],
): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const aBox = getAABB(items[i]);
    for (let j = i + 1; j < items.length; j++) {
      const bBox = getAABB(items[j]);
      // Negative margin = require items to overlap by more than
      // the tolerance before flagging. Equivalent to the zip's
      // shrink-each-AABB-by-tol approach.
      if (aabbsOverlap(aBox, bBox, -OVERLAP_TOLERANCE)) {
        result.add(items[i].id);
        result.add(items[j].id);
      }
    }
  }
  return result;
}

/** Returns the id of the first item that would collide with the
 *  proposed (targetX, targetZ) position for the given moving id.
 *  Returns null when the move is clear. Used by the rotation-gizmo
 *  drag handler (Phase C2) to gate commits, and by the AI
 *  generation validator (Phase E1) to reject candidates that
 *  place items on top of each other. */
export function findCollision<T extends AABBInput & { id: string }>(
  movingId: string,
  targetX: number,
  targetZ: number,
  items: readonly T[],
): string | null {
  const moving = items.find((i) => i.id === movingId);
  if (!moving) return null;
  const probe = getAABB({ ...moving, x: targetX, z: targetZ });
  for (const other of items) {
    if (other.id === movingId) continue;
    const otherBox = getAABB(other);
    if (aabbsOverlap(probe, otherBox, -0.001)) return other.id;
  }
  return null;
}
