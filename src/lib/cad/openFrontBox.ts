import type { PlacedItem } from "@studio/store/furniture-slice";
import type { RoomMeta } from "@studio/director/adapter";
import type { CatalogItem } from "@studio/catalog/types";
import {
  DEFAULT_PANEL_MATERIAL_ID,
  getPanelMaterial,
} from "@studio/catalog/panel-materials";
import type { CadDraftRect } from "./draftRoom";

/** Construction roles for carcass panels + catalog filters. */
export type PanelCategory = "shelf" | "divider" | "back-panel";

export const PANEL_CATEGORY_FILTERS: {
  id: PanelCategory | "all";
  label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "shelf", label: "Shelf" },
  { id: "divider", label: "Divider" },
  { id: "back-panel", label: "Back Panel" },
];

/** Uniform board thickness in metres (18 mm). Same for every panel —
 *  only length / width / height span differ by role. */
export const PANEL_THICKNESS_M = 0.018;

/** Default open-front box footprint (mm, plan). Front (+Y / +Z) is open. */
export const DEFAULT_OPEN_FRONT_DRAFT: CadDraftRect = {
  minX: 0,
  minY: 0,
  maxX: 800,
  maxY: 400,
};

function makePanel(opts: {
  id: string;
  label: string;
  category: PanelCategory;
  width: number;
  depth: number;
  height: number;
  x: number;
  z: number;
  materialId?: string;
}): PlacedItem {
  const mat = getPanelMaterial(opts.materialId ?? DEFAULT_PANEL_MATERIAL_ID);
  return {
    id: opts.id,
    label: opts.label,
    category: opts.category,
    shape: "rect",
    color: mat.color,
    width: opts.width,
    depth: opts.depth,
    height: opts.height,
    x: opts.x,
    z: opts.z,
    rotation: 0,
    locked: false,
    placed: true,
    visible: true,
    meshes: [],
    meta: {
      source: "carcass-panel",
      kind: "panel",
      panelCategory: opts.category,
      panelThicknessM: PANEL_THICKNESS_M,
      studioY: opts.height / 2,
      materialId: mat.id,
      materialFinish: mat.finish,
    },
  };
}

/**
 * Open-front carcass (no front face) with one interior shelf.
 * Plan: X = width, Z = depth. Open side faces +Z (toward a typical
 * orbit camera in the +X/+Z quadrant).
 *
 * Every board uses PANEL_THICKNESS_M (18 mm) as its thin axis:
 *   • Shelves     — thickness = height
 *   • Dividers    — thickness = width
 *   • Back panel  — thickness = depth
 *
 *   • Bottom + Mid + Top  → Shelf
 *   • Left + Right        → Divider
 *   • Back (−Z)           → Back Panel
 */
export function buildOpenFrontBoxFurniture(
  draft: CadDraftRect = DEFAULT_OPEN_FRONT_DRAFT,
  heightM = 2.0,
  materialId = DEFAULT_PANEL_MATERIAL_ID,
): PlacedItem[] {
  const W = Math.max(0.2, (draft.maxX - draft.minX) / 1000);
  const D = Math.max(0.2, (draft.maxY - draft.minY) / 1000);
  const H = Math.max(0.4, heightM);
  const t = PANEL_THICKNESS_M;
  const cx = (draft.minX + draft.maxX) / 2000;
  const cz = (draft.minY + draft.maxY) / 2000;

  // Sides / back form the outer shell; shelves sit between the sides
  // and in front of the back so edges share one visible 厚度.
  const innerW = Math.max(t, W - 2 * t);
  const shelfD = Math.max(t, D - t);
  const zShelf = cz + t / 2;
  const zBack = cz - D / 2 + t / 2;
  const xLeft = cx - W / 2 + t / 2;
  const xRight = cx + W / 2 - t / 2;

  const shelf = (
    id: string,
    label: string,
  ): ReturnType<typeof makePanel> =>
    makePanel({
      id,
      label,
      category: "shelf",
      width: innerW,
      depth: shelfD,
      height: t,
      x: cx,
      z: zShelf,
      materialId,
    });

  return [
    shelf("carcass-bottom", "Bottom Shelf"),
    shelf("carcass-mid", "Shelf"),
    shelf("carcass-top", "Top Shelf"),
    makePanel({
      id: "carcass-left",
      label: "Left Divider",
      category: "divider",
      width: t,
      depth: D,
      height: H,
      x: xLeft,
      z: cz,
      materialId,
    }),
    makePanel({
      id: "carcass-right",
      label: "Right Divider",
      category: "divider",
      width: t,
      depth: D,
      height: H,
      x: xRight,
      z: cz,
      materialId,
    }),
    makePanel({
      id: "carcass-back",
      label: "Back Panel",
      category: "back-panel",
      width: W,
      depth: t,
      height: H,
      x: cx,
      z: zBack,
      materialId,
    }),
  ].map((p) => {
    if (p.id === "carcass-top") {
      return {
        ...p,
        meta: { ...p.meta, studioY: H - t / 2 },
      };
    }
    if (p.id === "carcass-mid") {
      // Center of the interior volume (between bottom and top boards).
      return {
        ...p,
        meta: { ...p.meta, studioY: H / 2 },
      };
    }
    return p;
  });
}

export function openFrontBoxRoomMeta(
  draft: CadDraftRect = DEFAULT_OPEN_FRONT_DRAFT,
  heightM = 2.0,
): RoomMeta {
  const minX = draft.minX / 1000;
  const maxX = draft.maxX / 1000;
  const minZ = draft.minY / 1000;
  const maxZ = draft.maxY / 1000;
  return {
    width: Math.max(0.001, maxX - minX),
    depth: Math.max(0.001, maxZ - minZ),
    height: heightM,
    minX,
    maxX,
    minZ,
    maxZ,
    minY: 0,
    maxY: heightM,
  };
}

export function isCarcassPanel(item: {
  id?: string;
  meta?: { source?: string } | null;
}): boolean {
  return (
    item.meta?.source === "carcass-panel" ||
    Boolean(item.id?.startsWith("carcass-"))
  );
}

/** Catalog templates — drag these to add more shelves / dividers / backs.
 *  Thickness is always PANEL_THICKNESS_M; only span axes differ. */
export function panelCategoryCatalog(): CatalogItem[] {
  const t = PANEL_THICKNESS_M;
  return [
    {
      id: "template-shelf",
      label: "Shelf",
      category: "shelf",
      shape: "rectangle",
      width: 0.8,
      depth: 0.4,
      height: t,
      nodeNames: [],
    },
    {
      id: "template-divider",
      label: "Divider",
      category: "divider",
      shape: "rectangle",
      width: t,
      depth: 0.4,
      height: 2.0,
      nodeNames: [],
    },
    {
      id: "template-back-panel",
      label: "Back Panel",
      category: "back-panel",
      shape: "rectangle",
      width: 0.8,
      depth: t,
      height: 2.0,
      nodeNames: [],
    },
  ];
}
