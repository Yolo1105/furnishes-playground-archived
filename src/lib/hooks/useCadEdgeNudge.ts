"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@studio/store";

/**
 * When the main view flips to CAD (2D), nudge floating cards that
 * hug the viewport edges inward so the rulers show. Flip back →
 * restore those auto-nudges unless the user dragged the card since.
 *
 * While already in CAD, newly opened Tools tabs also get the inset
 * (incremental nudge) — not their flush 3D-edge placement.
 */
export function useCadEdgeNudge() {
  const mainViewMode = useStore((s) => s.mainViewMode);
  const openToolsKey = useStore((s) => s.openTools.join(","));
  const applyCadEdgeNudge = useStore((s) => s.applyCadEdgeNudge);
  const revertCadEdgeNudge = useStore((s) => s.revertCadEdgeNudge);
  const prevMode = useRef(mainViewMode);
  const prevOpenToolsKey = useRef(openToolsKey);

  useEffect(() => {
    const from = prevMode.current;
    if (from === mainViewMode) return;
    prevMode.current = mainViewMode;

    if (from === "3d" && mainViewMode === "2d") {
      // Let the CAD chrome paint one frame, then measure card rects.
      const id = requestAnimationFrame(() => {
        applyCadEdgeNudge();
      });
      return () => cancelAnimationFrame(id);
    }

    if (from === "2d" && mainViewMode === "3d") {
      revertCadEdgeNudge();
    }
  }, [mainViewMode, applyCadEdgeNudge, revertCadEdgeNudge]);

  // Tools opened while already in grid mode — wait for the card to
  // paint at its pack slot, then extend the CAD nudge session.
  useEffect(() => {
    if (mainViewMode !== "2d") {
      prevOpenToolsKey.current = openToolsKey;
      return;
    }
    if (prevOpenToolsKey.current === openToolsKey) return;
    prevOpenToolsKey.current = openToolsKey;

    let cancelled = false;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (!cancelled) applyCadEdgeNudge();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [openToolsKey, mainViewMode, applyCadEdgeNudge]);
}
