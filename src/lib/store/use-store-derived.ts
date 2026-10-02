"use client";

import { useMemo } from "react";
import { useStore } from "./index";

/**
 * Derived selectors. These are computed views on top of the store
 * that are useful in multiple places and benefit from memoization.
 *
 * Pattern: subscribe to the underlying primitive state, then
 * compute the derived shape via useMemo. Components can then
 * import the derived hook instead of recomputing in N places.
 *
 * Why a separate module: keeping derived selectors out of the
 * slice files means slices stay narrow (state + actions only),
 * and composing across slices (e.g., placed furniture × wall
 * proximity) doesn't pollute any single slice. The zip uses
 * the same pattern in its `lib/store/use-store-derived.ts`.
 *
 * As more phases ship, this file accrues selectors. Today it
 * exposes lightweight wrappers around existing per-slice
 * selectors plus a placed-with-positions composite that's
 * useful for the upcoming Phase C door-clearance overlay and
 * Phase E AI-generation pipeline.
 */

/** Placed furniture only — derived via `useMemo` on `furniture` so
 *  `useSyncExternalStore` never sees a fresh array from a selector on
 *  every getSnapshot call (that pattern causes infinite re-renders). */
export function usePlacedFurniture() {
  const furniture = useStore((s) => s.furniture);
  return useMemo(() => furniture.filter((f) => f.placed), [furniture]);
}

/** Set of ids of currently-placed furniture. */
export function usePlacedIds() {
  const furniture = useStore((s) => s.furniture);
  return useMemo(() => {
    const out = new Set<string>();
    for (const f of furniture) if (f.placed) out.add(f.id);
    return out;
  }, [furniture]);
}

/** Currently-selected item, fully resolved. Returns null when
 *  nothing is selected. Computed via useMemo so consumers
 *  re-render only when selection or furniture changes. */
export function useSelectedItem() {
  const selectedId = useStore((s) => s.selectedId);
  const furniture = useStore((s) => s.furniture);
  return useMemo(
    () =>
      selectedId ? (furniture.find((f) => f.id === selectedId) ?? null) : null,
    [selectedId, furniture],
  );
}

/** Has the apartment GLB finished loading and seeding? Combines
 *  the seeded flag with the presence of a wall payload — both
 *  must be true for the scene to be usable. Use this where you'd
 *  otherwise check `seeded && walls.length > 0`. */
export function useApartmentReady() {
  const seeded = useStore((s) => s.seeded);
  const wallsLength = useStore((s) => s.walls.length);
  return seeded && wallsLength > 0;
}
