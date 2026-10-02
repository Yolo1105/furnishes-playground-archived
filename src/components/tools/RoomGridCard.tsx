"use client";

import { useState, useMemo } from "react";
import { useStore } from "@studio/store";
import { useDraggable } from "@studio/hooks/useDraggable";
import { useAutoPlaceOnOpen } from "@studio/layout/useAutoPlaceOnOpen";

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";
const UI_FONT = "var(--font-app), system-ui, sans-serif";

/**
 * v0.40.49 RoomGridCard — custom-footprint room builder. The user
 * asked for a way to define non-rectangular room shapes (L-shaped,
 * T-shaped, etc.) by tapping squares in a grid. Tapped squares
 * become part of the footprint; squares stuck together define the
 * room's overall shape. A "Generate" action then submits a
 * description of the shape as a chat prompt, leveraging the
 * existing orchestrator path rather than introducing a parallel
 * pipeline.
 *
 * Why a description-based hand-off rather than passing the cell
 * grid all the way down to the orchestrator's RoomShell type:
 *
 *   1. The orchestrator already understands shape language ("L-shaped
 *      4x5m room with a 2x2m alcove"). It produces walls, openings,
 *      and pieces from prose. Re-using that path means we don't
 *      need to teach RoomShell to carry arbitrary polygons.
 *   2. The user can refine via chat afterwards ("make the alcove
 *      a reading nook"), which a direct-cell-passing pipeline
 *      wouldn't support without more code.
 *   3. The grid UI is the affordance; the description is the
 *      contract. If we later add a grid-aware orchestrator path,
 *      we can keep the same UI and swap the submission internals.
 *
 * Each cell represents 1m × 1m. A 6×6 grid covers the typical
 * SG HDB range (3-room ~70m², 4-room ~95m²) and most studios.
 * Users can scale later via direct chat ("make it 8m wide" etc.).
 */

const GRID_SIZE = 8; // 8x8 = up to 64m² rooms, plenty for HDB scope
const CELL_PX = 28;
const CELL_GAP = 2;

type CellKey = string; // "x,y" with x,y in 0..GRID_SIZE-1

function key(x: number, y: number): CellKey {
  return `${x},${y}`;
}

function unkey(k: CellKey): { x: number; y: number } {
  const [x, y] = k.split(",").map(Number);
  return { x, y };
}

/** Compute connected components via flood fill so we can detect
 *  whether the user's cells form one contiguous footprint. A room
 *  with two disconnected blobs would confuse the orchestrator —
 *  we surface a warning when that happens. */
function isContiguous(cells: Set<CellKey>): boolean {
  if (cells.size === 0) return false;
  const visited = new Set<CellKey>();
  const start = cells.values().next().value as CellKey;
  const queue: CellKey[] = [start];
  visited.add(start);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const { x, y } = unkey(cur);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nk = key(x + dx, y + dy);
      if (cells.has(nk) && !visited.has(nk)) {
        visited.add(nk);
        queue.push(nk);
      }
    }
  }
  return visited.size === cells.size;
}

/** Bounding-box dimensions of the cell set, in meters. */
function bounds(cells: Set<CellKey>): { w: number; d: number; cells: number } {
  if (cells.size === 0) return { w: 0, d: 0, cells: 0 };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const k of cells) {
    const { x, y } = unkey(k);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    w: maxX - minX + 1,
    d: maxY - minY + 1,
    cells: cells.size,
  };
}

/** Generate a prose description of the footprint to feed to the
 *  orchestrator. Strategy: detect simple rectangular case first,
 *  then identify L-shape. The output is the user-prompt-style
 *  English the existing pipeline expects. */
function describeShape(cells: Set<CellKey>): string {
  if (cells.size === 0) return "";
  const b = bounds(cells);
  const totalRect = b.w * b.d;
  // Pure rectangle: every cell in the bounding box is filled.
  if (cells.size === totalRect) {
    return `Generate a ${b.w} × ${b.d} m rectangular room (about ${cells.size} m²).`;
  }
  // L-shape detection: if exactly one rectangular notch is missing
  // from one corner of the bounding box, name it an L.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const k of cells) {
    const { x, y } = unkey(k);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const missing: CellKey[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!cells.has(key(x, y))) missing.push(key(x, y));
    }
  }
  // If the missing cells form their own rectangle anchored at one
  // corner of the bounding box, it's an L. Compute missing's bounds
  // and check rectangularity.
  if (missing.length > 0) {
    let mMinX = Infinity,
      mMaxX = -Infinity,
      mMinY = Infinity,
      mMaxY = -Infinity;
    for (const k of missing) {
      const { x, y } = unkey(k);
      if (x < mMinX) mMinX = x;
      if (x > mMaxX) mMaxX = x;
      if (y < mMinY) mMinY = y;
      if (y > mMaxY) mMaxY = y;
    }
    const missingRectArea = (mMaxX - mMinX + 1) * (mMaxY - mMinY + 1);
    const missingFillsBox = missingRectArea === missing.length;
    const anchoredAtCorner =
      (mMinX === minX || mMaxX === maxX) && (mMinY === minY || mMaxY === maxY);
    if (missingFillsBox && anchoredAtCorner) {
      const notchW = mMaxX - mMinX + 1;
      const notchD = mMaxY - mMinY + 1;
      return `Generate an L-shaped room: an overall ${b.w} × ${b.d} m bounding area with a ${notchW} × ${notchD} m corner cut out (total floor area ${cells.size} m²).`;
    }
  }
  // Fallback: irregular
  return `Generate an irregular room with ${cells.size} m² of floor area, fitting within a ${b.w} × ${b.d} m bounding rectangle.`;
}

export function RoomGridCard() {
  const [cells, setCells] = useState<Set<CellKey>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<"add" | "remove">("add");

  const { onMouseDown, onPointerDownCapture, positionStyle, zIndex } = useDraggable("tool-room-grid");
  useAutoPlaceOnOpen("tool-room-grid", 268, 360);
  const setMessage = useStore(
    (s) => (s as unknown as { setMessage: (m: string) => void }).setMessage,
  );
  const sendMessage = useStore(
    (s) => (s as unknown as { sendMessage: () => void }).sendMessage,
  );
  const toggleTool = useStore((s) => s.toggleTool);

  const stats = useMemo(() => bounds(cells), [cells]);
  const contiguous = useMemo(() => isContiguous(cells), [cells]);

  const toggleCell = (k: CellKey, mode?: "add" | "remove") => {
    setCells((prev) => {
      const next = new Set(prev);
      if (mode === "add") next.add(k);
      else if (mode === "remove") next.delete(k);
      else if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const clear = () => setCells(new Set());

  const generate = () => {
    if (cells.size === 0) return;
    const description = describeShape(cells);
    // Push the prompt into the chat input and submit. The user can
    // see what gets sent (full description text), and could refine
    // it before pressing Send if they prefer — but we also fire the
    // submit so the typical "click Generate, room appears" flow
    // works without an extra click.
    setMessage?.(description);
    // Defer sendMessage to the next tick so React has applied the
    // setMessage update before the chat-slice reads its store.
    setTimeout(() => {
      sendMessage?.();
    }, 30);
    // Close the card so the chat-mode thinking log + scene have
    // room. The user can re-open from the Tools menu.
    toggleTool("room-grid");
  };

  // Pre-compute filled-cell map for O(1) lookups during render.
  const filledMap = cells;

  return (
    <aside
      data-card-id="tool-room-grid"
      onMouseDown={onMouseDown}
      onPointerDownCapture={onPointerDownCapture}
      className="glass"
      style={{
        position: "fixed",
        top: 290,
        left: 14,
        width: GRID_SIZE * (CELL_PX + CELL_GAP) + 28,
        borderRadius: 14,
        padding: 14,
        zIndex: zIndex ?? 4,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontFamily: UI_FONT,
        cursor: "grab",
        ...positionStyle,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>
          Room shape
        </div>
        <div style={{ fontSize: 10, color: "rgba(26, 26, 26, 0.5)" }}>
          Tap cells • each = 1 m
        </div>
      </div>

      {/* Grid */}
      <div
        data-no-drag="true"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_PX}px)`,
          gridAutoRows: `${CELL_PX}px`,
          gap: CELL_GAP,
          userSelect: "none",
        }}
        onMouseLeave={() => setIsDragging(false)}
        onMouseUp={() => setIsDragging(false)}
      >
        {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, i) => {
          const x = i % GRID_SIZE;
          const y = Math.floor(i / GRID_SIZE);
          const k = key(x, y);
          const filled = filledMap.has(k);
          return (
            <div
              key={k}
              role="button"
              aria-pressed={filled}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const mode = filled ? "remove" : "add";
                setDragMode(mode);
                setIsDragging(true);
                toggleCell(k, mode);
              }}
              onMouseEnter={() => {
                if (isDragging) toggleCell(k, dragMode);
              }}
              style={{
                width: CELL_PX,
                height: CELL_PX,
                borderRadius: 4,
                background: filled
                  ? "rgba(255, 90, 31, 0.85)"
                  : "rgba(26, 26, 26, 0.04)",
                border: filled
                  ? "1px solid rgba(255, 90, 31, 1)"
                  : "1px solid rgba(26, 26, 26, 0.06)",
                cursor: "pointer",
                transition: "background 0.08s ease",
              }}
            />
          );
        })}
      </div>

      {/* Stats */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 10,
          color: "rgba(26, 26, 26, 0.6)",
        }}
      >
        <div>
          {stats.cells === 0 ? (
            <span>Select cells to begin</span>
          ) : (
            <span>
              {stats.cells} m² · {stats.w} × {stats.d} m bounds
              {!contiguous && (
                <span style={{ color: "#D94040", marginLeft: 6 }}>
                  · cells must connect
                </span>
              )}
            </span>
          )}
        </div>
        {cells.size > 0 && (
          <button
            type="button"
            onClick={clear}
            data-no-drag="true"
            style={{
              border: "none",
              background: "transparent",
              color: "rgba(26, 26, 26, 0.55)",
              fontSize: 10,
              cursor: "pointer",
              padding: "2px 4px",
              fontFamily: UI_FONT,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Generate button */}
      <button
        type="button"
        data-no-drag="true"
        onClick={generate}
        disabled={cells.size === 0 || !contiguous}
        style={{
          padding: "9px 12px",
          borderRadius: 9,
          border: "none",
          background:
            cells.size === 0 || !contiguous ? "rgba(26, 26, 26, 0.08)" : ACCENT,
          color:
            cells.size === 0 || !contiguous
              ? "rgba(26, 26, 26, 0.4)"
              : "#FFFFFF",
          fontSize: 12,
          fontWeight: 600,
          cursor: cells.size === 0 || !contiguous ? "not-allowed" : "pointer",
          fontFamily: UI_FONT,
          letterSpacing: "0.01em",
        }}
      >
        Generate this room
      </button>
    </aside>
  );
}
