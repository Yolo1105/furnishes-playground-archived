import type { StateCreator } from "zustand";

/**
 * Generations slice. Owns the most-recent set of arrangement
 * candidates returned by /api/arrange, plus the index of the
 * currently-selected (or applied) candidate.
 *
 * Lifted out of OptionsTab's local state in Phase F2 so multiple
 * planner tabs can read the same candidate list:
 *   - OptionsTab     — generates + applies (writes via setCandidates,
 *                      setAppliedIndex)
 *   - InspectTab     — diffs the candidate against current scene
 *                      (reads currentCandidate via inspectIndex)
 *   - PlacedTab (F3) — review of the applied candidate
 *   - ExplainTab (F5) — AI-narrated reasoning per candidate
 *
 * Two indexes:
 *   - `appliedIndex` — set by OptionsTab when the user clicks Apply.
 *     Drives the "Applied" treatment on that card AND tells later
 *     tabs which candidate is currently committed to the scene.
 *   - `inspectIndex` — set by InspectTab's dropdown. Independent of
 *     applied — you can inspect candidate B while candidate A is
 *     applied, comparing what B would do without committing yet.
 *
 * Candidates are NOT persisted (they're transient generation results,
 * not user-edited state). Cleared on `resetGenerations`.
 */

export interface ArrangeMove {
  id: string;
  x: number;
  z: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface ArrangeCandidate {
  label: string;
  notes: string;
  moves: ArrangeMove[];
}

export interface GenerationRun {
  /** Unique id (timestamp-based). Used as React key + as the
   *  identifier the bar tile passes when the user picks one. */
  id: string;
  /** When the generation completed (ms since epoch). */
  generatedAt: number;
  /** The candidate set the run produced. */
  candidates: ArrangeCandidate[];
  /** Whether any of these candidates was applied to the scene. */
  applied: boolean;
}

export interface GenerationsSlice {
  /** Most-recent set of candidates from /api/arrange, in the order
   *  the model returned them. Empty when no generation has run yet
   *  or after `resetGenerations`. */
  candidates: ArrangeCandidate[];
  /** Index of the candidate the user has applied to the scene, or
   *  null when no apply has happened. The OptionsTab card with this
   *  index gets the "Applied" treatment. */
  appliedIndex: number | null;
  /** Index of the candidate the InspectTab is currently diffing, or
   *  null when nothing is selected for inspection. Defaults to
   *  appliedIndex when set; falls back to 0 when there are
   *  candidates but no apply yet. */
  inspectIndex: number | null;
  /** History of past generation runs, oldest first. The Recent
   *  Generations bar (Phase E2) renders tiles for each run; clicking
   *  a tile reloads that run's candidates into the active slot.
   *  Capped at MAX_HISTORY entries so memory doesn't grow unbounded
   *  during a long session. */
  history: GenerationRun[];

  /** Asset generations from /api/generate-asset (Turn 3+ pipeline).
   *  Each is a single piece the user generated via the chat in
   *  "Furniture" mode. The Recent Generations bar (Turn 6 expansion)
   *  renders these as click-to-place tiles alongside arrangement
   *  candidates. Capped at MAX_HISTORY entries. */
  assetGenerations: AssetGeneration[];

  setCandidates: (candidates: ArrangeCandidate[]) => void;
  setAppliedIndex: (idx: number | null) => void;
  setInspectIndex: (idx: number | null) => void;
  /** Restore a previous generation run as the active one. Sets
   *  `candidates` from the run, clears applied + inspect indices
   *  to defaults so the user can re-pick from this run's set. */
  restoreFromHistory: (runId: string) => void;
  /** Drop a single past run from history. Useful when the user
   *  wants to clear noise without resetting everything. */
  removeFromHistory: (runId: string) => void;
  /** Push a freshly-generated asset into the asset history. */
  addAssetGeneration: (asset: AssetGeneration) => void;
  /** Drop a single asset (e.g. user clicked × on a tile). */
  removeAssetGeneration: (assetId: string) => void;
  resetGenerations: () => void;
}

/** A single generated artifact — surfaced in the Generations card
 *  as a clickable tile. Two kinds:
 *
 *    • "asset"  — Furniture mode produces a single GLB piece. Tile
 *                 click re-places this piece in the scene.
 *    • "room"   — Room Layout mode produces a multi-piece scene
 *                 (no single GLB). Tile click re-applies the entire
 *                 saved scene snapshot via applyScene.
 *
 *  Older entries (pre-v0.40.16) didn't have `kind` and are treated as
 *  "asset" by consumers. The `glbUrl` is required for asset entries
 *  but optional/unused for room entries.
 */
export interface AssetGeneration {
  /** Unique id for React key + tile-pick. */
  id: string;
  /** Discriminator. Default "asset" when absent (back-compat with
   *  entries persisted before v0.40.16). */
  kind?: "asset" | "room";
  /** Short label for the tile (typically the piece description trimmed
   *  to ~60 chars, or for rooms: "<style> <dims>m room"). */
  label: string;
  /** GLB URL — the actual mesh. Required for kind === "asset"; absent
   *  for kind === "room". fal.ai CDN URLs expire; the GLB cache
   *  (Turn 4) keeps a copy locally for 30 days so refreshes don't
   *  re-fetch. */
  glbUrl?: string;
  /** Optional 2D image URL — Flux's intermediate render. Used as the
   *  tile thumbnail. */
  imageUrl?: string;
  /** The PieceRequest Claude derived from the user's prompt. Carries
   *  dimensions + category + description so a click-to-place can
   *  position the piece sensibly. */
  piece?: unknown; // PieceRequest from /director/schema (typed
  // as unknown here to keep this slice's import surface small;
  // consumers cast at use site).
  /** The StyleBible Claude derived. Useful for follow-up generations
   *  that should match this piece's style. */
  style?: unknown; // StyleBible — same rationale as `piece`.
  /** Frozen scene snapshot for kind === "room". Stored as the same
   *  shape applyScene takes; clicking the tile rehydrates this. */
  scene?: unknown;
  /** When the artifact was generated (ms since epoch). */
  createdAt: number;
}

const MAX_HISTORY = 12;

export const createGenerationsSlice: StateCreator<GenerationsSlice> = (
  set,
) => ({
  candidates: [],
  appliedIndex: null,
  inspectIndex: null,
  history: [],
  assetGenerations: [],

  setCandidates: (candidates) =>
    set((s) => {
      // Push the previous candidate set into history before
      // overwriting — preserves what the user just generated so
      // they can return to it via the Recent Generations bar.
      const prevHadCandidates = s.candidates.length > 0;
      const newRun: GenerationRun = {
        id: `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        generatedAt: Date.now(),
        candidates,
        applied: false,
      };
      // The previous run only goes into history if it actually has
      // candidates (the very first generation has nothing prior).
      const updatedPrior: GenerationRun[] = prevHadCandidates
        ? [
            {
              id: `gen_${(s.history[s.history.length - 1]?.generatedAt ?? Date.now() - 1000).toString(36)}`,
              generatedAt: Date.now() - 1,
              candidates: s.candidates,
              applied: s.appliedIndex !== null,
            },
            ...s.history,
          ].slice(0, MAX_HISTORY)
        : s.history;

      return {
        candidates,
        appliedIndex: null,
        inspectIndex: candidates.length > 0 ? 0 : null,
        history: [newRun, ...updatedPrior].slice(0, MAX_HISTORY),
      };
    }),
  setAppliedIndex: (idx) =>
    set((s) => ({
      appliedIndex: idx,
      inspectIndex: idx ?? s.inspectIndex,
      // Mark the most-recent run in history as applied when an
      // index is set — useful for the bar's visual indicator.
      history:
        idx !== null && s.history.length > 0
          ? s.history.map((run, i) =>
              i === 0 ? { ...run, applied: true } : run,
            )
          : s.history,
    })),
  setInspectIndex: (idx) => set({ inspectIndex: idx }),
  restoreFromHistory: (runId) =>
    set((s) => {
      const run = s.history.find((r) => r.id === runId);
      if (!run) return {};
      return {
        candidates: run.candidates,
        appliedIndex: null,
        inspectIndex: run.candidates.length > 0 ? 0 : null,
      };
    }),
  removeFromHistory: (runId) =>
    set((s) => ({ history: s.history.filter((r) => r.id !== runId) })),
  addAssetGeneration: (asset) =>
    set((s) => ({
      // Newest first; cap to MAX_HISTORY so memory stays bounded.
      assetGenerations: [asset, ...s.assetGenerations].slice(0, MAX_HISTORY),
    })),
  removeAssetGeneration: (assetId) =>
    set((s) => ({
      assetGenerations: s.assetGenerations.filter((a) => a.id !== assetId),
    })),
  resetGenerations: () =>
    set({
      candidates: [],
      appliedIndex: null,
      inspectIndex: null,
      history: [],
      assetGenerations: [],
    }),
});
