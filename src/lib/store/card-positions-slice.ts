import type { StateCreator } from "zustand";
import {
  mergeCadEdgeNudgeSession,
  resolveCadEdgeNudgeRevert,
  type CadEdgeNudgeBackup,
} from "@studio/layout/cadEdgeNudge";

/**
 * Per-card user-positioning + stacking state.
 *
 * Stacking uses a monotonic rank per card (window-manager style):
 * clicking a card assigns it the next highest rank so it paints on
 * top, while every other card keeps its previous rank — relative
 * order below the clicked card is preserved.
 */

export type CardId =
  | "project"
  | "tools"
  | "tool-reference"
  | "tool-catalog"
  | "tool-inventory"
  | "tool-generations"
  | "tool-chat-history"
  | "tool-starred"
  | "tool-properties"
  | "tool-room-grid";

export interface CardPosition {
  x: number;
  y: number;
}

/** Base z-index for floating cards (above canvas, below modals). */
export const CARD_BASE_Z_INDEX = 4;

/** Map Tools-rail names → floating card ids (for bring-to-front on open). */
export const TOOL_NAME_TO_CARD_ID: Record<string, CardId> = {
  reference: "tool-reference",
  catalog: "tool-catalog",
  inventory: "tool-inventory",
  generations: "tool-generations",
  "chat-history": "tool-chat-history",
  "room-grid": "tool-room-grid",
  starred: "tool-starred",
};

export function cardZIndexFromRank(rank: number | undefined): number {
  return CARD_BASE_Z_INDEX + (rank ?? 0);
}

export function isTopStackCard(
  id: CardId,
  ranks: Partial<Record<CardId, number>>,
): boolean {
  const mine = ranks[id] ?? 0;
  let max = 0;
  for (const v of Object.values(ranks)) {
    if (typeof v === "number" && v > max) max = v;
  }
  return mine >= max && mine > 0;
}

export interface CardPositionsSlice {
  cardPositions: Partial<Record<CardId, CardPosition>>;

  /** Monotonic stack rank per card. Higher = more on top. */
  cardStackRank: Partial<Record<CardId, number>>;
  /** Next rank to assign on bring-to-front. */
  cardStackSeq: number;

  /**
   * Snapshot of positions right before a CAD-mode edge nudge.
   * `null` when not in a nudged session. Used to restore on flip
   * back to 3D (unless the user moved the card themselves).
   */
  cadEdgeNudgeBackup: CadEdgeNudgeBackup | null;

  setCardPosition: (id: CardId, pos: CardPosition) => void;
  clearCardPosition: (id: CardId) => void;
  bringCardToFront: (id: CardId) => void;
  /** Nudge edge-hugging cards inward so CAD rulers stay visible. */
  applyCadEdgeNudge: () => void;
  /** Revert auto-nudges that the user hasn't overridden by dragging. */
  revertCadEdgeNudge: () => void;
}

export const createCardPositionsSlice: StateCreator<CardPositionsSlice> = (
  set,
  get,
) => ({
  cardPositions: {},
  cardStackRank: {},
  cardStackSeq: 0,
  cadEdgeNudgeBackup: null,

  setCardPosition: (id, pos) =>
    set((s) => ({
      cardPositions: { ...s.cardPositions, [id]: pos },
    })),

  clearCardPosition: (id) =>
    set((s) => {
      const next = { ...s.cardPositions };
      delete next[id];
      const ranks = { ...s.cardStackRank };
      delete ranks[id];
      return {
        cardPositions: next,
        cardStackRank: ranks,
      };
    }),

  bringCardToFront: (id) =>
    set((s) => {
      const current = s.cardStackRank[id] ?? 0;
      // Already the unique top — no-op (keeps relative order stable).
      if (current > 0 && isTopStackCard(id, s.cardStackRank)) {
        return s;
      }
      const nextSeq = s.cardStackSeq + 1;
      return {
        cardStackSeq: nextSeq,
        cardStackRank: { ...s.cardStackRank, [id]: nextSeq },
      };
    }),

  applyCadEdgeNudge: () => {
    const s = get();
    const { nextPositions, backup, changed } = mergeCadEdgeNudgeSession(
      s.cardPositions,
      s.cadEdgeNudgeBackup,
    );
    // First pass with nothing near an edge still starts the session
    // (empty backup) so later tool opens can extend it.
    if (s.cadEdgeNudgeBackup == null) {
      set({
        cardPositions: nextPositions,
        cadEdgeNudgeBackup: backup,
      });
      return;
    }
    if (!changed) return;
    set({
      cardPositions: nextPositions,
      cadEdgeNudgeBackup: backup,
    });
  },

  revertCadEdgeNudge: () => {
    const s = get();
    if (s.cadEdgeNudgeBackup == null) return;
    const next = resolveCadEdgeNudgeRevert(
      s.cardPositions,
      s.cadEdgeNudgeBackup,
    );
    set({
      cardPositions: next,
      cadEdgeNudgeBackup: null,
    });
  },
});
