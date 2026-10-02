// Rotation-aware axis-aligned bounding box for a placeable item.
// Returns world-space {minX, maxX, minZ, maxZ} accounting for the
// item's rotation. Right-angle rotations (0/90/180/270) swap width
// and depth; arbitrary angles fall back to the AABB of the rotated
// rectangle's four corners (a slight over-approximation, fine for
// collision-prevention purposes).
//
// Ported from the zip's lib/collision/aabb.ts. Decoupled from the
// zip's `FurnitureItem` shape via a structural input — any object
// with x/z/width/depth (and optional rotation) works. This way the
// module is reusable when our furniture-slice eventually grows
// position + rotation fields without requiring a rename pass.

/** Generic input shape — any item with a center (x,z), an axis-
 *  aligned footprint (width × depth), and optionally a rotation
 *  in degrees. Rotation defaults to 0 when absent. */
export interface AABBInput {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation?: number;
}

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function getAABB(item: AABBInput): AABB {
  const rot = (((item.rotation ?? 0) % 360) + 360) % 360;
  // Fast path for right-angle rotations: just swap dimensions.
  if (rot === 0 || rot === 90 || rot === 180 || rot === 270) {
    const isRotated = rot === 90 || rot === 270;
    const w = isRotated ? item.depth : item.width;
    const d = isRotated ? item.width : item.depth;
    const hw = w / 2;
    const hd = d / 2;
    return {
      minX: item.x - hw,
      maxX: item.x + hw,
      minZ: item.z - hd,
      maxZ: item.z + hd,
    };
  }
  // Slow path for arbitrary angles: rotate the four corners and
  // take the bounding box. Returns an over-approximation (the
  // axis-aligned envelope of the rotated rect), which is what
  // we want for collision-prevention — false positives are safer
  // than false negatives.
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = item.width / 2;
  const hd = item.depth / 2;
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [lx, lz] of corners) {
    const wx = item.x + lx * cos - lz * sin;
    const wz = item.z + lx * sin + lz * cos;
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wz < minZ) minZ = wz;
    if (wz > maxZ) maxZ = wz;
  }
  return { minX, maxX, minZ, maxZ };
}

/** Two AABBs overlap iff their projections on both axes overlap.
 *  `margin` adds a buffer on all sides — useful for walkable-gap
 *  checks where you want at least N cm of clearance between items. */
export function aabbsOverlap(a: AABB, b: AABB, margin = 0): boolean {
  return (
    a.minX - margin < b.maxX &&
    a.maxX + margin > b.minX &&
    a.minZ - margin < b.maxZ &&
    a.maxZ + margin > b.minZ
  );
}
