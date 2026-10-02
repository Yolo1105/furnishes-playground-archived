import type { StateCreator } from "zustand";

/**
 * Selection slice. Owns which furniture item is currently selected.
 *
 * Single piece of state (`selectedId: string | null`) plus a single
 * setter, but it lives in its own slice because:
 *   1. Multiple surfaces consume it — Properties panel, Inventory
 *      row highlight, 3D wireframe indicator, planner Inspect tab
 *      (when ported). Centralizing it under a name that means what
 *      it is (`selection-slice`) is clearer than burying it in
 *      `furniture-slice` next to placement logic.
 *   2. The zip's source-of-truth structure has selection as its
 *      own slice. Aligning now means imports of Phase E/F code from
 *      the zip drop in without rewiring.
 *
 * Note: removeFurniture (in furniture-slice) clears selection when
 * removing the currently-selected item. That cross-slice write is
 * fine — Zustand slices share one merged state object, so any slice
 * can write any field. Type-side we widen the StateCreator at the
 * barrel level.
 */
export interface SelectionSlice {
  selectedId: string | null;
  /** Select an item, or pass `null` to deselect. */
  selectFurniture: (id: string | null) => void;
}

export const createSelectionSlice: StateCreator<SelectionSlice> = (set) => ({
  selectedId: null,
  selectFurniture: (id) => set({ selectedId: id }),
});
