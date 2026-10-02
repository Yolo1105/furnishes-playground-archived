import type { StateCreator } from "zustand";

/**
 * Requirements slice. User-stated design preferences that shape the
 * Planner's arrangement generation. Pure form-state today (Phase F1)
 * — Phase E1 will read this slice when calling /api/arrange to drive
 *  what Claude knows about the user's must-haves, constraints, and
 *  priorities.
 *
 * Adapted from the zip's lib/store/requirements-slice.ts. Behavior is
 * identical: editing any field sets `presetName: null` so the active
 * preset selector clears (the user has "tweaked" off the preset).
 * Preset application is the only path that sets a preset name.
 *
 * Currently isolated from arrangement application — no consumer reads
 * these values yet because Phase E1 hasn't shipped. The slice exists
 * so the Requirements tab UI can persist edits across panel close/
 * reopen and across sessions (when persistence lands in Phase G).
 */

export type BedAgainstWall = "prefer" | "required" | "off";

/** Canonical list of categories the Requirements tab exposes as
 *  "must-include" switches. Single source of truth — consumed by the
 *  slice defaults, presets, and the RequirementsTab UI. */
export const MUST_INCLUDE_CATEGORIES = ["bed", "desk", "wardrobe"] as const;

/** Canonical list of "optional include" categories. Same single-
 *  source rule. */
export const OPTIONAL_INCLUDE_CATEGORIES = [
  "rug",
  "nightstand",
  "lamp",
] as const;

export type MustIncludeCategory = (typeof MUST_INCLUDE_CATEGORIES)[number];
export type OptionalIncludeCategory =
  (typeof OPTIONAL_INCLUDE_CATEGORIES)[number];

/** Build an initial Record<string, boolean> from a list of keys + a
 *  default value. Avoids repeating the three-item object literal in
 *  defaults + every preset. */
export function categoryMap<K extends string>(
  keys: readonly K[],
  value: boolean,
): Record<K, boolean> {
  return keys.reduce(
    (acc, k) => {
      acc[k] = value;
      return acc;
    },
    {} as Record<K, boolean>,
  );
}

export interface RequirementsSlice {
  // ── State ──────────────────────────────────────────────────────
  /** Active preset name. Null when the user has hand-tweaked values
   *  away from any preset, OR when no preset has been applied yet. */
  presetName: string | null;
  /** Must-include items keyed by category. The Requirements tab
   *  renders one toggle per key. Defaults: bed/desk/wardrobe = on. */
  mustInclude: Record<string, boolean>;
  /** Optional-include items, same shape. Defaults all off so the
   *  user has to opt in. */
  optionalInclude: Record<string, boolean>;
  /** Walkway minimum width in centimetres. UI displays inches but
   *  we store cm to avoid round-tripping through unit conversions
   *  on every set. Default 75cm ≈ 30in. */
  walkwayMinCm: number;
  /** Maintain unobstructed door clearance? Default on. */
  doorClearance: boolean;
  /** Avoid blocking window access (no tall items in front)? Default on. */
  windowAccess: boolean;
  /** Bed-against-wall preference — "prefer" / "required" / "off". */
  bedAgainstWall: BedAgainstWall;
  /** Priority slider, 0..100. 0 = maximize Flow (open paths), 100 =
   *  maximize Storage (more pieces). The arrangement generator uses
   *  this to score candidates. Default 50 (balanced). */
  flowVsStorage: number;
  /** Priority slider, 0..100. 0 = Open (sparse, airy), 100 = Cozy
   *  (more pieces, layered). Default 50 (balanced). */
  opennessVsCozy: number;

  // ── Actions ─────────────────────────────────────────────────────
  setPreset: (name: string | null) => void;
  setMustInclude: (key: string, value: boolean) => void;
  setOptionalInclude: (key: string, value: boolean) => void;
  setWalkwayMinCm: (v: number) => void;
  setDoorClearance: (v: boolean) => void;
  setWindowAccess: (v: boolean) => void;
  setBedAgainstWall: (v: BedAgainstWall) => void;
  setFlowVsStorage: (v: number) => void;
  setOpennessVsCozy: (v: number) => void;
  /** Replace fields atomically. Used by preset application and by
   *  persistence hydration when projects load. */
  hydrateRequirements: (partial: Partial<RequirementsSlice>) => void;
  resetRequirements: () => void;
}

const DEFAULTS = {
  presetName: null as string | null,
  mustInclude: categoryMap(MUST_INCLUDE_CATEGORIES, true),
  optionalInclude: categoryMap(OPTIONAL_INCLUDE_CATEGORIES, false),
  walkwayMinCm: 75,
  doorClearance: true,
  windowAccess: true,
  bedAgainstWall: "prefer" as BedAgainstWall,
  flowVsStorage: 50,
  opennessVsCozy: 50,
};

export const createRequirementsSlice: StateCreator<RequirementsSlice> = (
  set,
) => ({
  ...DEFAULTS,

  setPreset: (name) => set({ presetName: name }),
  // Each individual setter ALSO clears presetName — editing a field
  // means you've moved off the preset's curated values.
  setMustInclude: (key, value) =>
    set((s) => ({
      presetName: null,
      mustInclude: { ...s.mustInclude, [key]: value },
    })),
  setOptionalInclude: (key, value) =>
    set((s) => ({
      presetName: null,
      optionalInclude: { ...s.optionalInclude, [key]: value },
    })),
  setWalkwayMinCm: (v) => set({ presetName: null, walkwayMinCm: v }),
  setDoorClearance: (v) => set({ presetName: null, doorClearance: v }),
  setWindowAccess: (v) => set({ presetName: null, windowAccess: v }),
  setBedAgainstWall: (v) => set({ presetName: null, bedAgainstWall: v }),
  setFlowVsStorage: (v) => set({ presetName: null, flowVsStorage: v }),
  setOpennessVsCozy: (v) => set({ presetName: null, opennessVsCozy: v }),

  hydrateRequirements: (partial) => set(partial),
  resetRequirements: () => set({ ...DEFAULTS }),
});
