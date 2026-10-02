/**
 * Collision module — public barrel.
 *
 * Two layers:
 *   1. Pure geometry primitives (AABB construction, point-to-segment
 *      distance, bounding-box overlap). These are the building
 *      blocks; everything else composes them.
 *   2. Higher-level predicates (does this rectangle hit a wall?
 *      do these items overlap? what's the apartment bounding box?).
 *
 * Imports here go through this index so consumers don't reach
 * into individual files. As later phases grow the module (door-
 * clearance overlay in Phase C1, walkability grid in Phase F4,
 * AI-generation validator in Phase E1), new functions get added
 * to one of the existing files and re-exported here.
 *
 * Adapted from the zip's lib/collision/. We intentionally diverge
 * on input shapes — the zip's collision module assumes its
 * `FurnitureItem` and `RoomMeta` types; ours uses generic
 * structural types so the module composes with our slice shapes
 * (which differ from the zip's pre-Phase-E coordinate model).
 */

export type { AABB, AABBInput } from "./aabb";
export { getAABB, aabbsOverlap } from "./aabb";

export type { XZBounds } from "./room-bounds";
export { boundsFromWalls, pointInBounds } from "./room-bounds";

export {
  WALL_HALF_THICKNESS,
  pointToSegmentDistSq,
  pointCollidesWithWalls,
  itemCollidesWithWalls,
  distanceFromItemToNearestWall,
} from "./walls";

export type { OverlapPair } from "./overlap";
export { findOverlappingIds, findCollision } from "./overlap";

export {
  MAGNETIC_SNAP_THRESHOLD_M,
  magneticSnapXZ,
  magneticSnapPanel3D,
  magneticSnapPanelView,
  magneticSnapMoving,
  snapNeighborsFor,
  resolveStudioY,
  panelRoleOf,
  isSnapPanel,
} from "./magneticSnap";
export type { SnapPose, PanelSnapPose, PanelRole, SnapOrthoView } from "./magneticSnap";
