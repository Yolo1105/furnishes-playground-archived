"use client";

import { useLayoutEffect, useRef } from "react";
import { useStore } from "@studio/store";
import type { CardId } from "@studio/store/card-positions-slice";
import { placeFloatingCard } from "@studio/layout/placeFloatingCard";

/** Serialize placements so concurrent mounts (boot openTools) don't
 *  all claim the same slot before store positions update. */
let placeQueue: Promise<void> = Promise.resolve();

/**
 * On mount (tool just opened), pack this card into the next free slot:
 * left-column stack first (or right for reference/generations), then a
 * new column. Avoids overlap when possible; always brings the card to
 * front so a forced overlap still wins.
 */
export function useAutoPlaceOnOpen(
  cardId: CardId,
  width?: number,
  height?: number,
) {
  const placedOnce = useRef(false);

  useLayoutEffect(() => {
    if (placedOnce.current) return;
    placedOnce.current = true;

    placeQueue = placeQueue
      .then(async () => {
        // Let anchors (Tools / Project) paint first.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const state = useStore.getState();
        const result = placeFloatingCard(cardId, {
          width,
          height,
          positions: state.cardPositions,
        });
        state.setCardPosition(cardId, { x: result.x, y: result.y });
        state.bringCardToFront(cardId);
        // Yield so the next queued place sees this position in the store.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        // Already in CAD: paint the pack slot, then inset for rulers.
        if (useStore.getState().mainViewMode === "2d") {
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
          useStore.getState().applyCadEdgeNudge();
        }
      })
      .catch(() => {
        // keep queue alive
      });
  }, [cardId, height, width]);
}
