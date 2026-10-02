/**
 * Orthographic CAD views — project a 3D AABB (mm) onto a 2D drafting
 * plane with axis labels for dimension chains.
 *
 * World frame (Furnishes plan):
 *   X — right
 *   Y — depth (north on plan; CadWorkplane “Y”)
 *   Z — up (height)
 */

export type OrthoView =
  | "front"
  | "back"
  | "top"
  | "bottom"
  | "left"
  | "right";

export const ORTHO_VIEWS: { id: OrthoView; label: string }[] = [
  { id: "front", label: "Front" },
  { id: "top", label: "Top" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "bottom", label: "Bottom" },
];

/** Axis-aligned box in millimetres. */
export type CadBoxMm = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export type ProjectedRect = {
  /** Horizontal axis on the drawing (world → u). */
  u0: number;
  u1: number;
  /** Vertical axis on the drawing (world → v), before SVG Y flip. */
  v0: number;
  v1: number;
  widthMm: number;
  heightMm: number;
  /** Short names for status / dim labels. */
  uAxis: string;
  vAxis: string;
  floorHint: string | null;
};

export function projectBox(box: CadBoxMm, view: OrthoView): ProjectedRect {
  const { minX, maxX, minY, maxY, minZ, maxZ } = box;
  switch (view) {
    case "top":
      return {
        u0: minX,
        u1: maxX,
        v0: minY,
        v1: maxY,
        widthMm: maxX - minX,
        heightMm: maxY - minY,
        uAxis: "X",
        vAxis: "Y",
        floorHint: "Y = 0 (plan)",
      };
    case "bottom":
      return {
        u0: minX,
        u1: maxX,
        v0: -maxY,
        v1: -minY,
        widthMm: maxX - minX,
        heightMm: maxY - minY,
        uAxis: "X",
        vAxis: "Y",
        floorHint: null,
      };
    case "front":
      // Looking toward +Y (from south): X right, Z up
      return {
        u0: minX,
        u1: maxX,
        v0: minZ,
        v1: maxZ,
        widthMm: maxX - minX,
        heightMm: maxZ - minZ,
        uAxis: "X",
        vAxis: "Z",
        floorHint: "Z = 0 (floor)",
      };
    case "back":
      return {
        u0: -maxX,
        u1: -minX,
        v0: minZ,
        v1: maxZ,
        widthMm: maxX - minX,
        heightMm: maxZ - minZ,
        uAxis: "X",
        vAxis: "Z",
        floorHint: "Z = 0 (floor)",
      };
    case "left":
      // Looking toward +X: −Y right, Z up
      return {
        u0: -maxY,
        u1: -minY,
        v0: minZ,
        v1: maxZ,
        widthMm: maxY - minY,
        heightMm: maxZ - minZ,
        uAxis: "Y",
        vAxis: "Z",
        floorHint: "Z = 0 (floor)",
      };
    case "right":
      return {
        u0: minY,
        u1: maxY,
        v0: minZ,
        v1: maxZ,
        widthMm: maxY - minY,
        heightMm: maxZ - minZ,
        uAxis: "Y",
        vAxis: "Z",
        floorHint: "Z = 0 (floor)",
      };
  }
}

/** Default height for the single draft side panel (elevations). */
export const DEFAULT_PANEL_HEIGHT_MM = 2000;
/** @deprecated Alias — CAD subject is a panel, not a room. */
export const DEFAULT_ROOM_HEIGHT_MM = DEFAULT_PANEL_HEIGHT_MM;

/** Plan draft (X/Y mm) + panel height → AABB for ortho projection. */
export function draftToBox(
  draft: { minX: number; minY: number; maxX: number; maxY: number },
  heightMm = DEFAULT_PANEL_HEIGHT_MM,
): CadBoxMm {
  return {
    minX: draft.minX,
    maxX: draft.maxX,
    minY: draft.minY,
    maxY: draft.maxY,
    minZ: 0,
    maxZ: heightMm,
  };
}

/**
 * PlacedItem sizes are metres in the studio store. Build a mm AABB
 * on the floor plan (Z up) centered at (x, z). Vertical placement
 * uses `meta.studioY` (metres, mesh center) so shelves sit at their
 * real height — matching the 3D scene. Values already in mm
 * (heuristic: any axis ≥ 20) are left as-is.
 */
export function placedItemToBoxMm(item: {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  meta?: { studioY?: number } | null;
}): CadBoxMm {
  const toMm = (v: number) => (Math.abs(v) >= 20 ? v : v * 1000);
  const w = toMm(item.width);
  const d = toMm(item.depth);
  const h = Math.max(1, toMm(item.height));
  const cx = toMm(item.x);
  const cy = toMm(item.z);
  const studioY = item.meta?.studioY;
  const centerZ =
    typeof studioY === "number" && Number.isFinite(studioY)
      ? toMm(studioY)
      : h / 2;
  return {
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minY: cy - d / 2,
    maxY: cy + d / 2,
    minZ: centerZ - h / 2,
    maxZ: centerZ + h / 2,
  };
}

const ELEVATION_VIEWS: OrthoView[] = ["front", "back", "left", "right"];

/**
 * Pick the elevation (not top/bottom) that shows the most face area —
 * for a thin side panel, Left/Right (depth×height) beats Front (thickness×height).
 * Open-front carcasses prefer Front so 2D matches looking into the box in 3D
 * (open side toward +Y / furniture +Z).
 */
export function bestFaceElevationView(
  items: Array<{
    id?: string;
    x: number;
    z: number;
    width: number;
    depth: number;
    height: number;
    meta?: { studioY?: number; panelCategory?: string; source?: string } | null;
  }>,
): OrthoView {
  if (items.length === 0) return "front";
  const openFront = items.some(
    (i) =>
      i.id === "carcass-back" ||
      i.meta?.panelCategory === "back-panel" ||
      (i.meta?.source === "carcass-panel" && items.length >= 4),
  );
  if (openFront) return "front";

  let best: OrthoView = "left";
  let bestArea = -1;
  for (const view of ELEVATION_VIEWS) {
    let area = 0;
    for (const item of items) {
      const p = projectBox(placedItemToBoxMm(item), view);
      area += Math.abs(p.widthMm) * Math.abs(p.heightMm);
    }
    if (area > bestArea) {
      bestArea = area;
      best = view;
    }
  }
  return best;
}

/** Painter order for ortho SVG: large faces first so thin shelves /
 *  edges paint on top (otherwise the back panel hides interior shelves). */
export function sortOrthoDrawOrder<
  T extends { projected: ProjectedRect; id?: string },
>(views: T[], orthoView: OrthoView): T[] {
  const elev =
    orthoView === "front" ||
    orthoView === "back" ||
    orthoView === "left" ||
    orthoView === "right";
  if (!elev) return views;
  return [...views].sort((a, b) => {
    const areaA = Math.abs(a.projected.widthMm * a.projected.heightMm);
    const areaB = Math.abs(b.projected.widthMm * b.projected.heightMm);
    if (areaB !== areaA) return areaB - areaA;
    // Stable tie-break: back panel under shelves.
    const rank = (id?: string) =>
      id === "carcass-back" ? 0 : id?.includes("shelf") || id?.includes("mid") || id?.includes("bottom") || id?.includes("top") ? 1 : 2;
    return rank(a.id) - rank(b.id);
  });
}
