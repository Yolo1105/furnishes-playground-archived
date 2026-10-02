import {
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore } from "@studio/store";
import {
  CARD_BASE_Z_INDEX,
  cardZIndexFromRank,
  type CardId,
  type CardPosition,
} from "@studio/store/card-positions-slice";

/**
 * Make a card draggable with the mouse. Returns props for the card root:
 *
 *   • `onPointerDownCapture` — raises the card on any press (click or
 *     drag), using capture so child `stopPropagation` can't block it
 *   • `onMouseDown` — drag gesture (respects data-no-drag / handles)
 *   • `positionStyle` / `zIndex` — layout + stacking
 *
 * Stacking is rank-based: only the clicked card gets a new higher
 * rank; every other card keeps its previous rank so relative order
 * underneath is unchanged.
 */
export function useDraggable(cardId: CardId) {
  const position = useStore((s) => s.cardPositions[cardId]);
  const setCardPosition = useStore((s) => s.setCardPosition);
  const bringCardToFront = useStore((s) => s.bringCardToFront);
  const stackRank = useStore((s) => s.cardStackRank[cardId] ?? 0);
  const zIndex = cardZIndexFromRank(stackRank);

  const dragging = useRef(false);
  const rafPending = useRef(0);
  const latestPos = useRef<CardPosition | null>(null);

  const onPointerDownCapture = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      bringCardToFront(cardId);
    },
    [bringCardToFront, cardId],
  );

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (e.button !== 0) return;

      let node: HTMLElement | null = e.target as HTMLElement;
      while (node && node !== e.currentTarget) {
        if (node.dataset.dragHandle === "true") {
          return;
        }
        if (node.dataset.noDrag === "true") return;
        node = node.parentElement;
      }

      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startCardX = rect.left;
      const startCardY = rect.top;

      const DRAG_THRESHOLD = 4;
      let movedPastThreshold = false;

      const flushPosition = () => {
        rafPending.current = 0;
        const next = latestPos.current;
        if (next) setCardPosition(cardId, next);
      };

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startMouseX;
        const dy = ev.clientY - startMouseY;

        if (
          !movedPastThreshold &&
          Math.abs(dx) < DRAG_THRESHOLD &&
          Math.abs(dy) < DRAG_THRESHOLD
        ) {
          return;
        }

        if (!movedPastThreshold) {
          movedPastThreshold = true;
          dragging.current = true;
          el.dataset.dragging = "true";
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }

        const maxX = window.innerWidth - rect.width;
        const maxY = window.innerHeight - rect.height;
        latestPos.current = {
          x: Math.max(0, Math.min(maxX, startCardX + dx)),
          y: Math.max(0, Math.min(maxY, startCardY + dy)),
        };

        const pos = latestPos.current;
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y}px`;
        el.style.right = "auto";
        el.style.bottom = "auto";
        // Keep current computed stack z during the gesture; React
        // will sync from rank on the next render after bring-to-front.
        const liveZ = el.style.zIndex || String(CARD_BASE_Z_INDEX);
        el.style.zIndex = liveZ;

        if (!rafPending.current) {
          rafPending.current = requestAnimationFrame(flushPosition);
        }
      };

      const onUp = () => {
        if (rafPending.current) {
          cancelAnimationFrame(rafPending.current);
          rafPending.current = 0;
        }
        if (movedPastThreshold && latestPos.current) {
          setCardPosition(cardId, latestPos.current);
        }
        dragging.current = false;
        delete el.dataset.dragging;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [cardId, setCardPosition],
  );

  const positionStyle: React.CSSProperties | undefined = position
    ? {
        top: position.y,
        left: position.x,
        right: "auto",
        bottom: "auto",
        transform: "none",
      }
    : undefined;

  return {
    onMouseDown,
    onPointerDownCapture,
    positionStyle,
    /** Always a number — merge as `zIndex` (no `?? 4` needed). */
    zIndex,
  };
}
