"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, type DragEvent } from "react";
import { useStore } from "@studio/store";
import { FloorPlan2D } from "@studio/views/FloorPlan2D";
import { DEFAULT_OPEN_FRONT_DRAFT } from "@studio/cad/openFrontBox";
import {
  CATALOG_DRAG_MIME,
  parseCatalogDrag,
  placeFromCatalog,
} from "@studio/catalog/placeFromCatalog";
import { screenToFloorXZ } from "@studio/scene/sceneDropContext";

/**
 * Full-viewport main view. 3D Scene stays mounted (hidden in 2D) so
 * swap does not remount WebGL. Empty blank 2D shows the CAD grid here
 * when the user swaps Reference ↔ main.
 *
 * Accepts catalog tile drops: drag a square/rect from the Catalog
 * card onto this surface to place it under the cursor (3D floor
 * raycast, or 2D SVG plan coords).
 */
const Scene = dynamic(
  () => import("@studio/scene/Scene").then((m) => ({ default: m.Scene })),
  { ssr: false },
);

function screenToPlanXZ(
  clientX: number,
  clientY: number,
): { x: number; z: number } | null {
  const svg = document
    .elementsFromPoint(clientX, clientY)
    .find((el): el is SVGSVGElement => el instanceof SVGSVGElement);
  if (!svg?.createSVGPoint || !svg.getScreenCTM) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const { x, y } = pt.matrixTransform(ctm.inverse());
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // Floor-plan SVG uses x → world X, y → world Z.
  return { x, z: y };
}

export function MainViewport() {
  const mode = useStore((s) => s.mainViewMode);
  const blankScene = useStore((s) =>
    Boolean(s.projects.find((p) => p.id === s.currentProjectId)?.blankScene),
  );
  const apartmentCenter = useStore((s) => s.apartmentCenter);
  const applyCadDraft = useStore((s) => s.applyCadDraft);
  const currentProjectId = useStore((s) => s.currentProjectId);

  // Blank projects: ensure the open-front 柜子 is in the scene (and
  // toilet / old draft Panel inventory is gone). Runs on project focus.
  useEffect(() => {
    if (!blankScene || !currentProjectId) return;
    const s = useStore.getState();
    const furniture = s.furniture ?? [];
    const hasCarcass = furniture.some(
      (f) =>
        f.meta?.source === "carcass-panel" ||
        Boolean(f.id?.startsWith("carcass-")),
    );
    const hasInteriorShelf = furniture.some((f) => f.id === "carcass-mid");
    const hasJunk = furniture.some(
      (f) =>
        f.placed !== false &&
        f.meta?.source !== "carcass-panel" &&
        !f.id?.startsWith("carcass-"),
    );
    if (!hasCarcass || hasJunk || !hasInteriorShelf) {
      applyCadDraft({ ...DEFAULT_OPEN_FRONT_DRAFT });
    }
  }, [blankScene, currentProjectId, applyCadDraft]);

  const show3d = mode === "3d";
  const show2d = mode === "2d";
  // Blank projects always edit on the CAD workplane in 2D (even once
  // the draft panel has a matching 3D stage / Inventory Panel).
  const cadEmpty = show2d && blankScene;

  const resolveDropAt = useCallback(
    (clientX: number, clientY: number): { x: number; z: number } => {
      if (show3d) {
        const hit = screenToFloorXZ(clientX, clientY);
        if (hit) return hit;
      }
      if (show2d) {
        const plan = screenToPlanXZ(clientX, clientY);
        if (plan) return plan;
        // CAD workplane is in mm; furniture store is meters.
        const cad = document
          .elementsFromPoint(clientX, clientY)
          .find(
            (el) =>
              el instanceof HTMLElement &&
              el.dataset.cadDrop === "true",
          ) as HTMLElement | undefined;
        if (cad) {
          const r = cad.getBoundingClientRect();
          const pxPerMm = Number(cad.dataset.pxPerMm || "0");
          const cx = Number(cad.dataset.cx || "0");
          const cy = Number(cad.dataset.cy || "0");
          if (pxPerMm > 0) {
            const sx = clientX - r.left;
            const sy = clientY - r.top;
            const mmX = cx + (sx - r.width / 2) / pxPerMm;
            const mmY = cy - (sy - r.height / 2) / pxPerMm;
            return { x: mmX / 1000, z: mmY / 1000 };
          }
        }
      }
      if (apartmentCenter) {
        return { x: apartmentCenter[0], z: apartmentCenter[1] };
      }
      return { x: 0, z: 0 };
    },
    [show3d, show2d, apartmentCenter],
  );

  const onDragOver = (e: DragEvent) => {
    if (![...e.dataTransfer.types].includes(CATALOG_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (e: DragEvent) => {
    const payload = parseCatalogDrag(e.dataTransfer);
    if (!payload) return;
    e.preventDefault();
    e.stopPropagation();
    placeFromCatalog([payload], resolveDropAt(e.clientX, e.clientY));
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          visibility: show3d ? "visible" : "hidden",
          pointerEvents: show3d ? "auto" : "none",
        }}
        aria-hidden={!show3d}
      >
        <Scene />
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: cadEmpty ? 0 : 40,
          background: "transparent",
          visibility: show2d ? "visible" : "hidden",
          pointerEvents: show2d ? "auto" : "none",
        }}
        aria-hidden={!show2d}
      >
        <div
          style={
            cadEmpty
              ? { width: "100%", height: "100%" }
              : {
                  width: "min(900px, 80vmin)",
                  maxHeight: "85vh",
                  aspectRatio: "200 / 160",
                }
          }
        >
          <FloorPlan2D compact={false} />
        </div>
      </div>
    </div>
  );
}
