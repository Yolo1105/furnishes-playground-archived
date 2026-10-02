import type { CatalogItem } from "@studio/catalog/types";
import {
  classifyShape,
  getDisplayLabel,
  itemColor,
} from "@studio/catalog/classify";
import { useStore } from "@studio/store";
import type { PlacedItem } from "@studio/store/furniture-slice";

export const CATALOG_DRAG_MIME = "application/x-furnishes-catalog";

/** Payload written into the HTML5 drag dataTransfer. */
export type CatalogDragPayload = Pick<
  CatalogItem,
  "id" | "label" | "category" | "width" | "depth" | "height" | "shape"
>;

export function catalogDragPayload(item: CatalogItem): CatalogDragPayload {
  return {
    id: item.id,
    label: item.label,
    category: item.category,
    width: item.width,
    depth: item.depth,
    height: item.height,
    shape: item.shape,
  };
}

function buildPlaceholder(
  item: CatalogDragPayload,
  at?: { x: number; z: number },
): PlacedItem {
  const isPanelTemplate = item.id.startsWith("template-");
  const id = isPanelTemplate
    ? `${item.id.replace(/^template-/, "panel-")}-${Date.now().toString(36)}`
    : item.id;
  const classifiedShape = classifyShape(item.id, item.width, item.depth);
  const panelCategory =
    item.category === "shelf" ||
    item.category === "divider" ||
    item.category === "back-panel"
      ? item.category
      : undefined;
  return {
    id,
    label: getDisplayLabel(item.id, item.label),
    category: item.category,
    shape: classifiedShape,
    color: itemColor(id),
    width: item.width,
    depth: item.depth,
    height: item.height,
    x: at?.x ?? 0,
    z: at?.z ?? 0,
    rotation: 0,
    locked: false,
    placed: true,
    visible: true,
    meshes: [],
    meta: {
      source: isPanelTemplate ? "carcass-panel" : "room-director",
      studioY: item.height / 2,
      provenance: "catalog-drop",
      ...(panelCategory ? { panelCategory } : null),
    },
  };
}

/**
 * Place one or more catalog pieces into the scene and select the
 * last one. Works for GLB-seeded items (flip `placed`) and for blank
 * scenes (upsert a placeholder box). Optional `at` moves the piece
 * to the drop point on the floor.
 */
export function placeFromCatalog(
  items: CatalogDragPayload[],
  at?: { x: number; z: number },
): void {
  if (items.length === 0) return;
  const store = useStore.getState();
  const byId = new Map(store.furniture.map((f) => [f.id, f]));
  let furniture = [...store.furniture];
  const touched: string[] = [];

  for (const item of items) {
    const isPanelTemplate = item.id.startsWith("template-");
    const existing = !isPanelTemplate ? byId.get(item.id) : undefined;
    if (existing) {
      furniture = furniture.map((f) =>
        f.id === item.id
          ? {
              ...f,
              placed: true,
              visible: true,
              ...(at ? { x: at.x, z: at.z } : null),
            }
          : f,
      );
      touched.push(item.id);
    } else {
      const fresh = buildPlaceholder(item, at);
      furniture = [...furniture, fresh];
      byId.set(fresh.id, fresh);
      touched.push(fresh.id);
    }
  }

  useStore.setState({ furniture });
  const last = touched[touched.length - 1];
  if (last) store.selectFurniture(last);
}

export function parseCatalogDrag(
  dataTransfer: DataTransfer,
): CatalogDragPayload | null {
  const raw = dataTransfer.getData(CATALOG_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CatalogDragPayload;
    if (!parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}
