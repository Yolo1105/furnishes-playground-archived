import type { StateCreator } from "zustand";
import * as THREE from "three";
import type { CatalogItem } from "@studio/catalog/types";
import {
  classifyShape,
  getDisplayLabel,
  itemColor,
} from "@studio/catalog/classify";
import { isDraftCadSubject } from "@studio/cad/draftRoom";
import { getPanelMaterial } from "@studio/catalog/panel-materials";

/**
 * One catalog item registered with the scene. The mental model is
 * that there is a single, fixed *universe* of items (the 65 entries
 * in the catalog whose meshes are present in apartamento.glb) and
 * each item is either currently `placed` in the scene or not.
 *
 *   • Inventory tool   — shows items with `placed: true`
 *   • Catalog modal    — shows items with `placed: false`
 *
 * The two are complementary views over the same array. Adding from
 * Catalog flips `placed` true; deleting from Inventory flips it
 * false. There is no separate "list of placed things" — there is
 * one list, and a flag.
 *
 * `meshes` holds direct references to the THREE.Object3D nodes
 * inside the apartamento scene graph that correspond to this item.
 * The Apartment component subscribes to slice changes and applies
 * `mesh.visible = item.placed && item.visible` to each ref on
 * every frame the relevant flags change. Because these refs are
 * non-serializable, the slice is in-memory only — fine, since
 * apartament state is rebuilt from the GLB on every page load.
 */
export interface PlacedItem {
  /** The catalog id; doubles as the unique key in this slice
   *  because the universe is fixed (no duplicates). */
  id: string;
  /** Display label, classified at seed time via `getDisplayLabel`.
   *  May differ from the catalog's raw label — e.g. catalog says
   *  "Bathroom Flush", we show "Toilet". */
  label: string;
  category: string;
  /** Floor-plan shape — "circle" / "thin-rect" / "l-shape" / "rect".
   *  Derived at seed time from `classifyShape(id, w, d)`, NOT read
   *  from the catalog (the catalog's shape strings like "lamp" or
   *  "decor" don't match the renderer's branching). */
  shape: string;
  /** Per-item color from `itemColor(id)`, deterministic palette
   *  hash so the same id always hashes to the same color across
   *  loads. Used for the floor plan's fill + stroke. */
  color: string;
  width: number;
  depth: number;
  height: number;
  /** World-space centroid X of the item at seed time. The wrapping
   *  group's position.x is kept equal to this value at runtime;
   *  the rotation gizmo edits this to translate the item. */
  x: number;
  /** World-space centroid Z of the item at seed time. Mirrors `x`. */
  z: number;
  /** Y rotation in degrees. Applied to the wrapping group's
   *  rotation.y, which means the meshes rotate around the
   *  group's origin = the item's seed centroid. Phase F1 doesn't
   *  set this; the rotation gizmo (re-introduced in Phase C2-redux)
   *  is the only writer. */
  rotation: number;
  /** True when the user has marked this item as locked. Locked
   *  items are excluded from /api/arrange's move set (Claude is
   *  told not to move them), and the F4 Health tab skips
   *  "out of place" warnings on them — the user pinned the item
   *  there on purpose. Toggled via the Properties card lock button. */
  locked: boolean;
  /** True when the item is currently part of the scene (visible
   *  to the inventory + invisible to the catalog picker). */
  placed: boolean;
  /** Visibility (eye toggle in inventory). Only meaningful when
   *  `placed` is true. */
  visible: boolean;
  /** Live THREE.Object3D refs from the apartamento.glb scene graph.
   *  Empty until `seedFromGlb` is called by the Apartment component
   *  at GLB load time. */
  meshes: THREE.Object3D[];
  /** Optional per-item metadata bag. Used by the room-director
   *  pipeline (Turn 1+) to attach a `glbUrl`, `previewGlbUrl`,
   *  satisfied relations, and provenance ("source: viewer" vs
   *  "source: room-director") to generated pieces. Pieces that
   *  came from the apartamento.glb don't have meta — only generated
   *  pieces do. The Apartment subscriber + GeneratedPieceMesh check
   *  for `meta?.source === "room-director"` to decide which
   *  rendering path to take.
   *
   *  Treated as opaque by every existing slice action — extending
   *  meta doesn't require slice plumbing changes. The director
   *  adapter is the canonical writer; everything else reads. */
  meta?: Record<string, unknown>;
}

/**
 * Furniture slice. Holds the catalog-derived universe of items and
 * the seeded-flag (so we don't double-seed). Walls / openings /
 * apartmentRoot / apartmentCenter live in `walls-slice`; selection
 * lives in `selection-slice`. This slice is intentionally narrow:
 * the items themselves and their placed/visible state.
 */
export interface FurnitureSlice {
  furniture: PlacedItem[];
  /** Set to true after Apartment has seeded the slice from the GLB
   *  scene graph. The seeding happens once per page load; this flag
   *  prevents duplicate seeds during HMR or remount. */
  seeded: boolean;

  /** One-time seed: walk the catalog, find each entry's nodeNames
   *  in the provided scene root, and register one PlacedItem per
   *  catalog entry that resolves. Idempotent — second calls are
   *  no-ops while `seeded` is true. Walls / openings / center are
   *  written separately by Apartment via walls-slice's `setWalls`,
   *  not as a side effect of this call. */
  seedFromGlb: (catalog: CatalogItem[], root: THREE.Object3D) => void;
  /** Place item(s) currently not placed (Catalog → Inventory flow).
   *  Items already placed are silently skipped. */
  placeItems: (ids: string[]) => void;
  /** Remove an item from the scene (Inventory trash). Flips the
   *  `placed` flag to false; the Apartment subscriber hides the
   *  meshes. Item stays in `furniture` so it reappears in the
   *  Catalog grid for re-adding. Also clears selection if the
   *  removed item was selected. */
  removeFurniture: (id: string) => void;
  /** Eye-toggle visibility. Only meaningful while placed. */
  toggleFurnitureVisibility: (id: string) => void;
  /** Toggle the locked flag for an item. Locked items are pinned
   *  in place — /api/arrange won't move them, F4 Health skips
   *  out-of-place rules on them. */
  toggleFurnitureLock: (id: string) => void;
  /** Patch position and/or rotation for a single item. Phase C2-redux
   *  approach: the Apartment subscriber subscribes specifically to
   *  this item's x/z/rotation and writes those values to the item's
   *  wrapping group, NEVER touching the meshes' local transforms. The
   *  rotation gizmo writes here on every pointermove. */
  setItemTransform: (
    id: string,
    patch: { x?: number; z?: number; rotation?: number; studioY?: number },
  ) => void;
  /** Set surface material (color + optional wood texture id). */
  setFurnitureMaterial: (id: string, materialId: string) => void;
}

export const createFurnitureSlice: StateCreator<FurnitureSlice> = (set) => ({
  furniture: [],
  seeded: false,

  seedFromGlb: (catalog, root) =>
    set((s) => {
      if (s.seeded) return s;

      // Build a name → Object3D index over the scene graph once.
      const byName = new Map<string, THREE.Object3D>();
      root.traverse((node) => {
        if (node.name) byName.set(node.name, node);
      });

      // Pre-compute, per-base-prefix, how many catalog items share
      // it. The 22 books items all share the base "7_books"; this
      // count gates whether `getDisplayLabel` appends an instance
      // number to the curated label. Single-instance items (where
      // the trailing `_06` is just part of the mesh name, not an
      // instance counter) skip the suffix and fall through to
      // their auto label.
      const baseCount = new Map<string, number>();
      for (const entry of catalog) {
        const m = entry.id.match(/^(.+?)_(\d+)$/);
        if (m) baseCount.set(m[1], (baseCount.get(m[1]) ?? 0) + 1);
      }

      const seeded: PlacedItem[] = [];
      for (const entry of catalog) {
        const meshes: THREE.Object3D[] = [];
        for (const nodeName of entry.nodeNames) {
          const node = byName.get(nodeName);
          if (node) meshes.push(node);
        }
        // Skip catalog entries whose meshes aren't in this GLB.
        // Right now apartamento.glb contains all 65, but if the
        // GLB is swapped out, the catalog might list more.
        if (meshes.length === 0) continue;

        // Override the catalog's raw `label` and `shape` with
        // runtime-classified values. The catalog's shape strings
        // ("lamp", "decor", "box") don't match the 2D-plan
        // renderer's branching, so we'd otherwise lose all visual
        // variety. The label override picks up curated names like
        // "Toilet" instead of the auto-label "Bathroom Flush".
        const classifiedShape = classifyShape(
          entry.id,
          entry.width,
          entry.depth,
        );
        const idMatch = entry.id.match(/^(.+?)_(\d+)$/);
        const isMultiInstance =
          idMatch !== null && (baseCount.get(idMatch[1]) ?? 0) > 1;
        const displayLabel = getDisplayLabel(
          entry.id,
          entry.label,
          isMultiInstance,
        );
        const color = itemColor(entry.id);

        // ── Phase C2-redux: per-item wrapping group ────────────────
        // Compute world-space centroid of this item's combined
        // bounding box. The wrapping group sits at this centroid
        // in WORLD space; rotating the wrapper around Y rotates the
        // meshes around the item's center.
        const itemBox = new THREE.Box3();
        for (const m of meshes) itemBox.expandByObject(m);
        const seedX = (itemBox.min.x + itemBox.max.x) / 2;
        const seedZ = (itemBox.min.z + itemBox.max.z) / 2;

        // Create the wrapper unparented at world (seedX, 0, seedZ).
        // While unparented, position == world position. We then use
        // `root.attach(wrapper)` rather than `root.add(wrapper)` —
        // attach preserves the wrapper's WORLD transform across the
        // reparenting, automatically computing the right local
        // position relative to root regardless of root's own
        // transform (normalize.ts translates root in Y to floor-snap
        // the apartment, so root.position.y is non-zero).
        const wrapper = new THREE.Group();
        wrapper.name = `__item_wrapper_${entry.id}`;
        wrapper.position.set(seedX, 0, seedZ);
        wrapper.userData.itemId = entry.id;
        wrapper.userData.seedX = seedX;
        wrapper.userData.seedZ = seedZ;
        wrapper.updateMatrixWorld(true);
        root.attach(wrapper);

        // Reparent each mesh into the wrapper. `wrapper.attach(mesh)`
        // is the key — it preserves the mesh's WORLD transform across
        // the reparenting. The earlier manual world-to-local math
        // (`mesh.position.set(worldPos.x - seedX, ...)`) was wrong
        // because it didn't account for root's transform, leaving
        // every mesh shifted in Y by root.position.y. With attach,
        // the math is delegated to three.js's built-in routine which
        // gets the frame composition right every time.
        for (const meshRoot of meshes) {
          wrapper.attach(meshRoot);
        }

        seeded.push({
          id: entry.id,
          label: displayLabel,
          category: entry.category,
          shape: classifiedShape,
          color,
          width: entry.width,
          depth: entry.depth,
          height: entry.height,
          x: seedX,
          z: seedZ,
          rotation: 0,
          locked: false,
          placed: true, // Items present in the GLB start placed.
          visible: true,
          meshes,
        });

        // Tag every mesh in this item's tree with its item id so
        // 3D click-to-select can resolve a hit back to a furniture
        // item by walking up parents and reading userData.itemId.
        for (const meshRoot of meshes) {
          meshRoot.traverse((node) => {
            node.userData.itemId = entry.id;
          });
        }
      }

      return {
        furniture: seeded,
        seeded: true,
      };
    }),

  placeItems: (ids) =>
    set((s) => ({
      furniture: s.furniture.map((f) =>
        ids.includes(f.id) ? { ...f, placed: true, visible: true } : f,
      ),
    })),

  removeFurniture: (id) =>
    set((s) => {
      // Draft CAD panel is structural — keep it in Inventory / 3D.
      const target = s.furniture.find((f) => f.id === id);
      if (target && isDraftCadSubject(target)) return s;

      const wider = s as unknown as { selectedId: string | null };
      const next: Partial<FurnitureSlice> & { selectedId?: string | null } = {
        furniture: s.furniture.map((f) =>
          f.id === id ? { ...f, placed: false } : f,
        ),
      };
      if (wider.selectedId === id) next.selectedId = null;
      return next;
    }),

  toggleFurnitureVisibility: (id) =>
    set((s) => ({
      furniture: s.furniture.map((f) =>
        f.id === id ? { ...f, visible: !f.visible } : f,
      ),
    })),

  toggleFurnitureLock: (id) =>
    set((s) => ({
      furniture: s.furniture.map((f) =>
        f.id === id ? { ...f, locked: !f.locked } : f,
      ),
    })),

  setItemTransform: (id, patch) =>
    set((s) => ({
      furniture: s.furniture.map((f) => {
        if (f.id !== id) return f;
        const next = {
          ...f,
          x: patch.x ?? f.x,
          z: patch.z ?? f.z,
          rotation: patch.rotation ?? f.rotation,
        };
        if (typeof patch.studioY === "number" && Number.isFinite(patch.studioY)) {
          return {
            ...next,
            meta: {
              ...(f.meta ?? {}),
              studioY: patch.studioY,
            },
          };
        }
        return next;
      }),
    })),

  setFurnitureMaterial: (id, materialId) =>
    set((s) => {
      const mat = getPanelMaterial(materialId);
      return {
        furniture: s.furniture.map((f) =>
          f.id === id
            ? {
                ...f,
                color: mat.color,
                meta: {
                  ...(f.meta ?? {}),
                  materialId: mat.id,
                  materialFinish: mat.finish,
                },
              }
            : f,
        ),
      };
    }),
});

/**
 * Selectors. Inventory shows placed items only; Catalog filters out
 * placed items so they disappear from the picker once added.
 */
export function selectPlaced(s: FurnitureSlice): PlacedItem[] {
  return s.furniture.filter((f) => f.placed);
}

export function selectVisibleCount(s: FurnitureSlice): number {
  return s.furniture.filter((f) => f.placed && f.visible).length;
}

export function selectPlacedIds(s: FurnitureSlice): Set<string> {
  const out = new Set<string>();
  for (const f of s.furniture) if (f.placed) out.add(f.id);
  return out;
}
