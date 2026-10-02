"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { useStore } from "@studio/store";
import { useDraggable } from "@studio/hooks/useDraggable";
import { useAutoPlaceOnOpen } from "@studio/layout/useAutoPlaceOnOpen";
import { ImageIcon, PinIcon } from "@studio/icons";
import { FloorPlan2D } from "@studio/views/FloorPlan2D";
import { CadWorkplane } from "@studio/views/CadWorkplane";

/**
 * Reference floating card — top-right by default (aligned with the
 * Project card's top edge at the opposite corner), draggable,
 * resizable from all four corners and all four edges.
 *
 * The card always shows the *opposite* of the main viewport:
 *   • main = 3D  →  reference shows 2D floor plan
 *   • main = 2D  →  reference shows a compact 3D scene
 *
 * Resize handles are tagged `data-drag-handle="true"` so their
 * mousedown wins over the card's drag handler. Corners scale both
 * axes; edges scale one axis only (e.g. drag top down → shorter /
 * flatter card, width unchanged). Opposite edge/corner stays fixed.
 */

const MiniScene3D = dynamic(
  () =>
    import("@studio/views/MiniScene3D").then((m) => ({
      default: m.MiniScene3D,
    })),
  { ssr: false },
);

type ResizeHandle = "n" | "e" | "s" | "w" | "nw" | "ne" | "sw" | "se";

const MIN_W = 160;
const MIN_H = 140;
const CORNER = 16;
const EDGE = 8;

type HandleLayout = {
  cursor: string;
  top?: number | string;
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  width?: number | string;
  height?: number | string;
};

const HANDLE_STYLE: Record<ResizeHandle, HandleLayout> = {
  n: {
    cursor: "ns-resize",
    top: 0,
    left: CORNER,
    right: CORNER,
    height: EDGE,
  },
  s: {
    cursor: "ns-resize",
    bottom: 0,
    left: CORNER,
    right: CORNER,
    height: EDGE,
  },
  e: {
    cursor: "ew-resize",
    right: 0,
    top: CORNER,
    bottom: CORNER,
    width: EDGE,
  },
  w: {
    cursor: "ew-resize",
    left: 0,
    top: CORNER,
    bottom: CORNER,
    width: EDGE,
  },
  nw: { cursor: "nwse-resize", top: 0, left: 0, width: CORNER, height: CORNER },
  ne: { cursor: "nesw-resize", top: 0, right: 0, width: CORNER, height: CORNER },
  sw: {
    cursor: "nesw-resize",
    bottom: 0,
    left: 0,
    width: CORNER,
    height: CORNER,
  },
  se: {
    cursor: "nwse-resize",
    bottom: 0,
    right: 0,
    width: CORNER,
    height: CORNER,
  },
};

export function ReferenceCard() {
  const mainViewMode = useStore((s) => s.mainViewMode);
  const swapMainViewMode = useStore((s) => s.swapMainViewMode);
  const referenceSize = useStore((s) => s.referenceSize);
  const setReferenceSize = useStore((s) => s.setReferenceSize);
  const setCardPosition = useStore((s) => s.setCardPosition);

  const referencePreviewImageUrl = useStore(
    (s) => s.referencePreviewImageUrl ?? null,
  );
  const setReferencePreviewImageUrl = useStore(
    (s) => s.setReferencePreviewImageUrl,
  );

  const pieceImageUrl = useStore((s) => {
    if (!s.selectedId) return null;
    const item = (s.furniture ?? []).find((f) => f.id === s.selectedId);
    if (!item) return null;
    const meta = item.meta as { imageUrl?: string } | undefined;
    return meta?.imageUrl ?? null;
  });

  const { onMouseDown, onPointerDownCapture, positionStyle, zIndex } = useDraggable("tool-reference");
  useAutoPlaceOnOpen("tool-reference", 420, 300);

  const effectiveImageUrl = referencePreviewImageUrl ?? pieceImageUrl;
  const showing: "2d" | "3d" | "piece-image" = effectiveImageUrl
    ? "piece-image"
    : mainViewMode === "3d"
      ? "2d"
      : "3d";

  const waypointMode = useStore((s) => s.waypointMode);
  const setWaypointMode = useStore((s) => s.setWaypointMode);
  const customWaypoints = useStore((s) => s.customWaypoints);
  const clearWaypoints = useStore((s) => s.clearWaypoints);

  const isThinking = useStore((s) => s.isThinking);
  const isGenerating = useStore((s) => s.isGenerating);
  const isProcessing = isThinking || isGenerating;

  const roomMeta = useStore((s) => s.roomMeta);
  const sceneSource = useStore((s) => s.sceneSource);
  const blankScene = useStore((s) =>
    Boolean(s.projects.find((p) => p.id === s.currentProjectId)?.blankScene),
  );
  const placedCount = useStore(
    (s) => (s.furniture ?? []).filter((f) => f.placed).length,
  );
  // Truly empty (no stage yet). Blank + draft panel still uses CAD.
  const referenceEmpty =
    (blankScene || sceneSource === "room-director") &&
    roomMeta == null &&
    placedCount === 0;

  const selectFurniture = useStore((s) => s.selectFurniture);
  const handleSwapClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isProcessing) return;
    if (showing === "piece-image") {
      setReferencePreviewImageUrl(null);
      selectFurniture(null);
      return;
    }
    swapMainViewMode();
  };

  /** Resize from a corner or edge; opposite side stays fixed. */
  const onResizeDown = useCallback(
    (handle: ResizeHandle, e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();

      const card = e.currentTarget.parentElement;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = rect.width;
      const startH = rect.height;
      const startLeft = rect.left;
      const startTop = rect.top;
      const cursor = HANDLE_STYLE[handle].cursor;
      const moveW = handle.includes("e") || handle.includes("w");
      const moveH = handle.includes("n") || handle.includes("s");
      const fromEast = handle.includes("e");
      const fromWest = handle.includes("w");
      const fromSouth = handle.includes("s");
      const fromNorth = handle.includes("n");

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newW = startW;
        let newH = startH;
        let newLeft = startLeft;
        let newTop = startTop;

        if (moveW) {
          newW = fromEast ? startW + dx : startW - dx;
        }
        if (moveH) {
          newH = fromSouth ? startH + dy : startH - dy;
        }

        newW = Math.max(MIN_W, Math.min(window.innerWidth - 16, newW));
        newH = Math.max(MIN_H, Math.min(window.innerHeight - 16, newH));

        // Keep the opposite edge fixed when a min-size clamp hits.
        if (fromWest) {
          newLeft = startLeft + (startW - newW);
        }
        if (fromNorth) {
          newTop = startTop + (startH - newH);
        }

        newLeft = Math.max(0, Math.min(window.innerWidth - newW, newLeft));
        newTop = Math.max(0, Math.min(window.innerHeight - newH, newTop));

        setReferenceSize({ width: newW, height: newH });
        setCardPosition("tool-reference", { x: newLeft, y: newTop });
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };

      document.body.style.userSelect = "none";
      document.body.style.cursor = cursor;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [setCardPosition, setReferenceSize],
  );

  return (
    <aside
      data-card-id="tool-reference"
      className="glass"
      onMouseDown={onMouseDown}
      onPointerDownCapture={onPointerDownCapture}
      style={{
        position: "fixed",
        top: 14,
        right: 14,
        width: referenceSize.width,
        height: referenceSize.height,
        borderRadius: 14,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        zIndex: zIndex ?? 4,
        cursor: "grab",
        overflow: "visible",
        ...positionStyle,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 2px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "#1A1A1A",
            fontFamily: "var(--font-app), system-ui, sans-serif",
          }}
        >
          <ImageIcon size={13} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {"Reference"}
          </span>
        </div>

        <div
          style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
          data-no-drag="true"
        >
          <button
            type="button"
            disabled={isProcessing}
            onClick={(e) => {
              e.stopPropagation();
              if (isProcessing) return;
              if (e.shiftKey && customWaypoints.length > 0) {
                clearWaypoints();
                return;
              }
              setWaypointMode(!waypointMode);
            }}
            aria-label={
              waypointMode
                ? "Exit waypoint mode"
                : "Enter waypoint mode (click 2D plan to drop pins)"
            }
            title={
              isProcessing
                ? "Disabled while generating"
                : waypointMode
                  ? `Waypoint mode ON — click on 2D plan to add (${customWaypoints.length} placed; shift-click here to clear)`
                  : `Waypoint mode — click 2D plan to drop pins (${customWaypoints.length} placed)`
            }
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: "none",
              background: waypointMode
                ? "rgba(231, 85, 26, 0.16)"
                : "transparent",
              color: isProcessing
                ? "rgba(26, 26, 26, 0.25)"
                : waypointMode
                  ? "#e7551a"
                  : "rgba(26, 26, 26, 0.6)",
              cursor: isProcessing ? "not-allowed" : "pointer",
              opacity: isProcessing ? 0.5 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "background 0.15s ease, opacity 0.15s ease",
            }}
          >
            <PinIcon size={13} />
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={handleSwapClick}
            aria-label={
              isProcessing
                ? "Disabled while generating"
                : showing === "piece-image"
                  ? "Exit piece reference view"
                  : "Swap with main view"
            }
            title={
              isProcessing
                ? "Disabled while generating"
                : showing === "piece-image"
                  ? "Exit piece reference (deselects piece)"
                  : "Swap with main view"
            }
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: isProcessing
                ? "rgba(26, 26, 26, 0.25)"
                : "rgba(26, 26, 26, 0.6)",
              cursor: isProcessing ? "not-allowed" : "pointer",
              opacity: isProcessing ? 0.5 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "opacity 0.15s ease",
            }}
          >
            <svg
              width={13}
              height={13}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
        </div>
      </div>

      <div
        data-no-drag="true"
        style={{
          flex: 1,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {showing === "piece-image" && effectiveImageUrl ? (
          <img
            src={effectiveImageUrl}
            alt="2D reference image"
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              borderRadius: 6,
              userSelect: "none",
            }}
          />
        ) : blankScene && showing === "2d" ? (
          // Blank projects: one panel on the CAD grid — never a room plan.
          <CadWorkplane compact />
        ) : referenceEmpty && showing === "2d" ? (
          <CadWorkplane compact />
        ) : referenceEmpty && showing === "3d" ? (
          // After swap: grid is on main; Reference is empty — text only.
          <p
            style={{
              margin: 0,
              padding: "0 16px",
              textAlign: "center",
              fontFamily: "var(--font-app), system-ui, sans-serif",
              fontSize: 12,
              fontWeight: 500,
              lineHeight: 1.45,
              color: "rgba(26, 26, 26, 0.45)",
            }}
          >
            Nothing to show yet — generate a room or swap back when the
            scene has content.
          </p>
        ) : showing === "3d" ? (
          <MiniScene3D />
        ) : blankScene ? (
          <CadWorkplane compact />
        ) : (
          <FloorPlan2D compact />
        )}
      </div>

      {(
        ["n", "e", "s", "w", "nw", "ne", "sw", "se"] as ResizeHandle[]
      ).map((handle) => {
        const { cursor, ...pos } = HANDLE_STYLE[handle];
        return (
          <div
            key={handle}
            data-drag-handle="true"
            aria-label={`Resize from ${handle} edge`}
            title="Drag to resize"
            onMouseDown={(e) => onResizeDown(handle, e)}
            style={{
              position: "absolute",
              cursor,
              zIndex: 2,
              ...pos,
            }}
          />
        );
      })}
    </aside>
  );
}
