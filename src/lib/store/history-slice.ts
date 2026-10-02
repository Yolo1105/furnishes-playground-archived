import type { StateCreator } from "zustand";

/**
 * History slice — undo/redo stacks for scene-state mutations.
 *
 * Right now there is no scene state to undo (the GLB is static and no
 * furniture edits are wired). Both stacks stay empty and the actions
 * are no-ops, but the slice exists so the top bar's Undo / Redo
 * buttons can read `undoDepth` / `redoDepth` and disable themselves
 * truthfully — if the depth is 0, the button is disabled.
 *
 * When furniture editing lands in a future step, every mutating
 * action will call `pushSnapshot(...)` before applying the change,
 * and `undo` / `redo` will pop / push between the two stacks. The
 * snapshot shape is intentionally typed as `unknown` here so the
 * future furniture slice can pick its own snapshot format without
 * forcing a refactor of this file.
 */
export interface ChangeSnapshot {
  /** Short human-readable description of the change ("Move sofa",
   *  "Apply Cozy template", etc). Used as the toast text. */
  label: string;
  /** Opaque snapshot payload. The slice that pushed it owns the
   *  shape; consumers don't read this. */
  state: unknown;
}

const HISTORY_DEPTH = 50;

export interface HistorySlice {
  undoStack: ChangeSnapshot[];
  redoStack: ChangeSnapshot[];

  /** Push a new snapshot onto the undo stack and clear redo
   *  (since a new action invalidates the forward history). */
  pushSnapshot: (snap: ChangeSnapshot) => void;
  /** Pop the top of the undo stack onto the redo stack. Returns
   *  the popped snapshot so the caller can restore from it; returns
   *  `null` if the undo stack is empty. */
  undo: () => ChangeSnapshot | null;
  /** Pop the top of the redo stack back onto the undo stack. */
  redo: () => ChangeSnapshot | null;
  /** Clear both stacks — used on project switch / project load. */
  clearHistory: () => void;
}

export const createHistorySlice: StateCreator<HistorySlice> = (set, get) => ({
  undoStack: [],
  redoStack: [],

  pushSnapshot: (snap) => {
    set((s) => {
      const next = [...s.undoStack, snap];
      // Cap the stack to keep memory predictable.
      const trimmed =
        next.length > HISTORY_DEPTH ? next.slice(-HISTORY_DEPTH) : next;
      return { undoStack: trimmed, redoStack: [] };
    });
  },

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return null;
    const popped = undoStack[undoStack.length - 1];
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, popped],
    }));
    return popped;
  },

  redo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return null;
    const popped = redoStack[redoStack.length - 1];
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, popped],
    }));
    return popped;
  },

  clearHistory: () => set({ undoStack: [], redoStack: [] }),
});
