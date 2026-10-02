import { getAABB, type AABBInput } from "./aabb";

/** How close edges must be (metres) before they magnet-join. ~5 cm. */
export const MAGNETIC_SNAP_THRESHOLD_M = 0.05;

/** Prefer flush panel joins slightly inside the same threshold. */
const ROLE_BIAS = 0.85;

export type SnapOrthoView =
  | "front"
  | "back"
  | "top"
  | "bottom"
  | "left"
  | "right";

export type PanelRole = "shelf" | "divider" | "back-panel";

export type SnapPose = AABBInput & {
  id?: string;
  height?: number;
  studioY?: number;
  category?: string;
  meta?: {
    source?: string;
    panelCategory?: string;
    studioY?: number;
  } | null;
};

export type PanelSnapPose = SnapPose & {
  height: number;
  studioY: number;
};

type AABB3 = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

/**
 * True when the two intervals almost touch or overlap — used so we
 * only magnet X-edges when pieces share a Z band (and vice versa).
 */
function intervalsNear(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  pad: number,
): boolean {
  return a1 + pad >= b0 && b1 + pad >= a0;
}

export function resolveStudioY(item: {
  height: number;
  studioY?: number;
  meta?: { studioY?: number } | null;
}): number {
  if (typeof item.studioY === "number" && Number.isFinite(item.studioY)) {
    return item.studioY;
  }
  const metaY = item.meta?.studioY;
  if (typeof metaY === "number" && Number.isFinite(metaY)) return metaY;
  return item.height / 2;
}

/** Detect carcass / catalog panel role for magnet bias. */
export function panelRoleOf(item: SnapPose): PanelRole | null {
  const cat = item.meta?.panelCategory ?? item.category;
  if (cat === "shelf" || cat === "divider" || cat === "back-panel") {
    return cat;
  }
  const src = item.meta?.source;
  const isPanel =
    src === "carcass-panel" ||
    Boolean(item.id?.startsWith("carcass-")) ||
    Boolean(item.id?.startsWith("panel-"));
  if (!isPanel) return null;

  const t = 0.025;
  const h = item.height ?? 0;
  const w = item.width;
  const d = item.depth;
  if (h > 0 && h <= t * 2) return "shelf";
  if (w <= t * 2) return "divider";
  if (d <= t * 2) return "back-panel";
  return "shelf";
}

export function isSnapPanel(item: SnapPose): boolean {
  return panelRoleOf(item) != null;
}

function getAABB3(item: PanelSnapPose): AABB3 {
  const floor = getAABB(item);
  const h = Math.max(0.001, item.height);
  const cy = item.studioY;
  return {
    minX: floor.minX,
    maxX: floor.maxX,
    minZ: floor.minZ,
    maxZ: floor.maxZ,
    minY: cy - h / 2,
    maxY: cy + h / 2,
  };
}

function joinBias(
  moving: PanelRole | null,
  other: PanelRole | null,
  axis: "x" | "y" | "z",
): number {
  if (!moving || !other) return 1;
  if (
    axis === "x" &&
    ((moving === "shelf" && other === "divider") ||
      (moving === "divider" && other === "shelf"))
  ) {
    return ROLE_BIAS;
  }
  if (
    axis === "z" &&
    (moving === "back-panel" ||
      other === "back-panel" ||
      (moving === "shelf" && other === "divider") ||
      (moving === "divider" && other === "shelf"))
  ) {
    // Shelf/divider rear → back front is the strong Z case.
    if (moving === "back-panel" || other === "back-panel") return ROLE_BIAS;
  }
  if (axis === "y" && moving === "shelf" && other === "shelf") {
    return ROLE_BIAS;
  }
  return 1;
}

/**
 * Pull a moving piece flush against neighboring edges when close.
 * Snaps independently on X and Z (corner joins allowed). Returns
 * the adjusted center `{ x, z }`.
 */
export function magneticSnapXZ(
  moving: SnapPose,
  proposed: { x: number; z: number },
  others: SnapPose[],
  threshold = MAGNETIC_SNAP_THRESHOLD_M,
): { x: number; z: number } {
  if (others.length === 0) return proposed;

  const movingAt: AABBInput = {
    x: proposed.x,
    z: proposed.z,
    width: moving.width,
    depth: moving.depth,
    rotation: moving.rotation,
  };
  const a = getAABB(movingAt);

  let bestDx = 0;
  let bestDxAbs = threshold;
  let bestDz = 0;
  let bestDzAbs = threshold;

  for (const other of others) {
    if (other.id && moving.id && other.id === moving.id) continue;
    const b = getAABB(other);

    // X-edge join when Z bands are nearby (side-by-side).
    if (intervalsNear(a.minZ, a.maxZ, b.minZ, b.maxZ, threshold)) {
      for (const dx of [b.minX - a.maxX, b.maxX - a.minX]) {
        const abs = Math.abs(dx);
        if (abs < bestDxAbs) {
          bestDxAbs = abs;
          bestDx = dx;
        }
      }
    }

    // Z-edge join when X bands are nearby (front-to-back).
    if (intervalsNear(a.minX, a.maxX, b.minX, b.maxX, threshold)) {
      for (const dz of [b.minZ - a.maxZ, b.maxZ - a.minZ]) {
        const abs = Math.abs(dz);
        if (abs < bestDzAbs) {
          bestDzAbs = abs;
          bestDz = dz;
        }
      }
    }
  }

  return {
    x: proposed.x + bestDx,
    z: proposed.z + bestDz,
  };
}

/**
 * Face-based magnet for cabinet panels — X / Y (height) / Z flush
 * joins with light role bias (shelf↔divider on X, ↔back on Z, shelf
 * stack on Y).
 */
export function magneticSnapPanel3D(
  moving: SnapPose,
  proposed: { x: number; z: number; studioY: number },
  others: SnapPose[],
  threshold = MAGNETIC_SNAP_THRESHOLD_M,
): { x: number; z: number; studioY: number } {
  if (others.length === 0) return proposed;

  const height = Math.max(0.001, moving.height ?? 0.018);
  const movingRole = panelRoleOf(moving);
  const a = getAABB3({
    ...moving,
    height,
    x: proposed.x,
    z: proposed.z,
    studioY: proposed.studioY,
  });

  let bestDx = 0;
  let bestDxScore = threshold;
  let bestDy = 0;
  let bestDyScore = threshold;
  let bestDz = 0;
  let bestDzScore = threshold;

  const consider = (
    axis: "x" | "y" | "z",
    delta: number,
    otherRole: PanelRole | null,
  ) => {
    const abs = Math.abs(delta);
    const score = abs * joinBias(movingRole, otherRole, axis);
    if (axis === "x" && score < bestDxScore && abs < threshold * 1.15) {
      bestDxScore = score;
      bestDx = delta;
    } else if (axis === "y" && score < bestDyScore && abs < threshold * 1.15) {
      bestDyScore = score;
      bestDy = delta;
    } else if (axis === "z" && score < bestDzScore && abs < threshold * 1.15) {
      bestDzScore = score;
      bestDz = delta;
    }
  };

  for (const other of others) {
    if (other.id && moving.id && other.id === moving.id) continue;
    const oh = Math.max(0.001, other.height ?? 0.018);
    const b = getAABB3({
      ...other,
      height: oh,
      studioY: resolveStudioY({
        height: oh,
        studioY: other.studioY,
        meta: other.meta,
      }),
    });
    const otherRole = panelRoleOf(other);

    // X faces when Y and Z bands nearby.
    if (
      intervalsNear(a.minY, a.maxY, b.minY, b.maxY, threshold) &&
      intervalsNear(a.minZ, a.maxZ, b.minZ, b.maxZ, threshold)
    ) {
      consider("x", b.minX - a.maxX, otherRole);
      consider("x", b.maxX - a.minX, otherRole);
    }

    // Y faces when X and Z bands nearby (stack / align heights).
    if (
      intervalsNear(a.minX, a.maxX, b.minX, b.maxX, threshold) &&
      intervalsNear(a.minZ, a.maxZ, b.minZ, b.maxZ, threshold)
    ) {
      consider("y", b.minY - a.maxY, otherRole);
      consider("y", b.maxY - a.minY, otherRole);
    }

    // Z faces when X and Y bands nearby.
    if (
      intervalsNear(a.minX, a.maxX, b.minX, b.maxX, threshold) &&
      intervalsNear(a.minY, a.maxY, b.minY, b.maxY, threshold)
    ) {
      consider("z", b.minZ - a.maxZ, otherRole);
      consider("z", b.maxZ - a.minZ, otherRole);
    }
  }

  return {
    x: proposed.x + bestDx,
    z: proposed.z + bestDz,
    studioY: proposed.studioY + bestDy,
  };
}

/**
 * Same face magnets as 3D, but only apply deltas on the axes editable
 * in the given orthographic view (Front: X+Y, Top: X+Z, Left: Z+Y).
 */
export function magneticSnapPanelView(
  moving: SnapPose,
  proposed: { x: number; z: number; studioY: number },
  others: SnapPose[],
  orthoView: SnapOrthoView,
  threshold = MAGNETIC_SNAP_THRESHOLD_M,
): { x: number; z: number; studioY: number } {
  const full = magneticSnapPanel3D(moving, proposed, others, threshold);
  switch (orthoView) {
    case "front":
    case "back":
      return { x: full.x, z: proposed.z, studioY: full.studioY };
    case "top":
    case "bottom":
      return { x: full.x, z: full.z, studioY: proposed.studioY };
    case "left":
    case "right":
      return { x: proposed.x, z: full.z, studioY: full.studioY };
    default:
      return full;
  }
}

/** Dispatch: panels → 3D face snap; other furniture → floor XZ snap. */
export function magneticSnapMoving(
  moving: SnapPose,
  proposed: { x: number; z: number; studioY?: number },
  others: SnapPose[],
  threshold = MAGNETIC_SNAP_THRESHOLD_M,
): { x: number; z: number; studioY?: number } {
  if (isSnapPanel(moving)) {
    const studioY =
      proposed.studioY ??
      resolveStudioY({
        height: moving.height ?? 0.018,
        studioY: moving.studioY,
        meta: moving.meta,
      });
    return magneticSnapPanel3D(
      moving,
      { x: proposed.x, z: proposed.z, studioY },
      others,
      threshold,
    );
  }
  const xz = magneticSnapXZ(moving, proposed, others, threshold);
  return xz;
}

/** Other placed, unlocked-neighbor candidates for snapping. */
export function snapNeighborsFor(
  furniture: Array<
    SnapPose & { id: string; placed?: boolean; visible?: boolean }
  >,
  movingId: string,
): SnapPose[] {
  const out: SnapPose[] = [];
  for (const f of furniture) {
    if (f.id === movingId) continue;
    if (f.placed === false) continue;
    if (f.visible === false) continue;
    out.push({
      id: f.id,
      x: f.x,
      z: f.z,
      width: f.width,
      depth: f.depth,
      height: f.height,
      rotation: f.rotation,
      category: f.category,
      meta: f.meta,
      studioY: resolveStudioY({
        height: f.height ?? 0.018,
        studioY: f.studioY,
        meta: f.meta,
      }),
    });
  }
  return out;
}
