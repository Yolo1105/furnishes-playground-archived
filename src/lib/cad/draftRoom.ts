import type { RoomMeta } from "@studio/director/adapter";
import type { Wall } from "@studio/floorplan/types";
import type { PlacedItem } from "@studio/store/furniture-slice";
import { DEFAULT_PANEL_HEIGHT_MM } from "@studio/views/cadOrtho";
import {
  DEFAULT_PANEL_MATERIAL_ID,
  getPanelMaterial,
} from "@studio/catalog/panel-materials";

/** Stable inventory id for the editable CAD draft panel. */
export const DRAFT_PANEL_ITEM_ID = "draft-panel";
/** Legacy id — still stripped on upsert / ignored for delete. */
export const DRAFT_ROOM_ITEM_ID = "draft-room";

/**
 * Default CAD subject footprint (mm, SW origin): open-front box
 * plan 800 × 400. Matches DEFAULT_OPEN_FRONT_DRAFT.
 */
export const DEFAULT_CAD_DRAFT = {
  minX: 0,
  minY: 0,
  maxX: 800,
  maxY: 400,
} as const;

export type CadDraftRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function isDraftCadSubject(item: {
  id?: string;
  meta?: { source?: string } | null;
}): boolean {
  const src = item.meta?.source;
  return (
    item.id === DRAFT_PANEL_ITEM_ID ||
    item.id === DRAFT_ROOM_ITEM_ID ||
    src === "draft-panel" ||
    src === "draft-room"
  );
}

/** True when furniture is empty or only CAD / carcass panels. */
export function isPanelOnlyFurniture(
  furniture: {
    id?: string;
    placed?: boolean;
    meta?: { source?: string } | null;
  }[],
): boolean {
  const placed = furniture.filter((f) => f.placed !== false);
  if (placed.length === 0) return true;
  return placed.every(
    (f) =>
      isDraftCadSubject(f) ||
      f.meta?.source === "carcass-panel" ||
      Boolean(f.id?.startsWith("carcass-")),
  );
}

/**
 * Old blank projects seeded a 4×3 m room rectangle. Those plan
 * footprints are not a single furniture panel — detect so we can
 * re-seed the open-front box footprint.
 */
export function isLegacyRoomDraft(draft: CadDraftRect): boolean {
  const w = Math.abs(draft.maxX - draft.minX);
  const d = Math.abs(draft.maxY - draft.minY);
  return w >= 2000 && d >= 2000;
}

/**
 * Panel plan (mm) → stage RoomMeta (metres). Bounds match the panel
 * footprint exactly so persistence `roomMetaToCadDraft` round-trips.
 * No wall loop — blank 3D is the panel standing on a grid ground.
 */
export function draftMmToPanelStageMeta(
  draft: CadDraftRect,
  heightMm = DEFAULT_PANEL_HEIGHT_MM,
): RoomMeta {
  const minX = draft.minX / 1000;
  const maxX = draft.maxX / 1000;
  const minZ = draft.minY / 1000;
  const maxZ = draft.maxY / 1000;
  const height = heightMm / 1000;
  return {
    width: Math.max(0.001, maxX - minX),
    depth: Math.max(0.001, maxZ - minZ),
    height,
    minX,
    maxX,
    minZ,
    maxZ,
    minY: 0,
    maxY: height,
  };
}

/** @deprecated Prefer draftMmToPanelStageMeta for CAD drafts. Kept for
 *  room-generation / persistence helpers that still speak "room". */
export function draftMmToRoomMeta(
  draft: CadDraftRect,
  heightMm = DEFAULT_PANEL_HEIGHT_MM,
): RoomMeta {
  return draftMmToPanelStageMeta(draft, heightMm);
}

/** Inverse of draftMmToPanelStageMeta for hydrate / persistence restore. */
export function roomMetaToCadDraft(meta: RoomMeta): CadDraftRect {
  return {
    minX: meta.minX * 1000,
    maxX: meta.maxX * 1000,
    minY: meta.minZ * 1000,
    maxY: meta.maxZ * 1000,
  };
}

export function wallsFromRoomMeta(meta: RoomMeta): Wall[] {
  const { minX, maxX, minZ, maxZ } = meta;
  return [
    { id: "auto-n", x1: minX, z1: maxZ, x2: maxX, z2: maxZ, thickness: 0.15 },
    { id: "auto-s", x1: minX, z1: minZ, x2: maxX, z2: minZ, thickness: 0.15 },
    { id: "auto-e", x1: maxX, z1: minZ, x2: maxX, z2: maxZ, thickness: 0.15 },
    { id: "auto-w", x1: minX, z1: minZ, x2: minX, z2: maxZ, thickness: 0.15 },
  ];
}

/** Inventory + 3D placeholder for the single draft panel. */
export function draftPanelPlacedItem(
  draft: CadDraftRect,
  heightMm = DEFAULT_PANEL_HEIGHT_MM,
  materialId = DEFAULT_PANEL_MATERIAL_ID,
): PlacedItem {
  const width = Math.max(0.001, (draft.maxX - draft.minX) / 1000);
  const depth = Math.max(0.001, (draft.maxY - draft.minY) / 1000);
  const height = heightMm / 1000;
  const mat = getPanelMaterial(materialId);
  return {
    id: DRAFT_PANEL_ITEM_ID,
    label: "Panel",
    category: "structure",
    shape: "rect",
    color: mat.color,
    width,
    depth,
    height,
    x: (draft.minX + draft.maxX) / 2000,
    z: (draft.minY + draft.maxY) / 2000,
    rotation: 0,
    locked: true,
    placed: true,
    visible: true,
    meshes: [],
    meta: {
      source: "draft-panel",
      kind: "panel",
      studioY: height / 2,
      materialId: mat.id,
      materialFinish: mat.finish,
    },
  };
}

/** @deprecated Use draftPanelPlacedItem. */
export function draftRoomPlacedItem(draft: CadDraftRect): PlacedItem {
  return draftPanelPlacedItem(draft);
}

export function upsertDraftPanelInFurniture(
  furniture: PlacedItem[],
  draft: CadDraftRect,
  heightMm = DEFAULT_PANEL_HEIGHT_MM,
): PlacedItem[] {
  const existing = furniture.find(
    (f) => f.id === DRAFT_PANEL_ITEM_ID || f.id === DRAFT_ROOM_ITEM_ID,
  );
  const materialId =
    typeof existing?.meta?.materialId === "string"
      ? existing.meta.materialId
      : DEFAULT_PANEL_MATERIAL_ID;
  const panel = draftPanelPlacedItem(draft, heightMm, materialId);
  // Keep lock/visibility from prior row when resizing the draft.
  if (existing) {
    panel.locked = existing.locked;
    panel.visible = existing.visible;
  }
  const without = furniture.filter(
    (f) => f.id !== DRAFT_PANEL_ITEM_ID && f.id !== DRAFT_ROOM_ITEM_ID,
  );
  return [panel, ...without];
}

/** @deprecated Use upsertDraftPanelInFurniture. */
export function upsertDraftRoomInFurniture(
  furniture: PlacedItem[],
  draft: CadDraftRect,
): PlacedItem[] {
  return upsertDraftPanelInFurniture(furniture, draft);
}
