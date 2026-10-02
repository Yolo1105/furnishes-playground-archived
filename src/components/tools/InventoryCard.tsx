"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore, selectVisibleCount } from "@studio/store";
import { useDraggable } from "@studio/hooks/useDraggable";
import { useAutoPlaceOnOpen } from "@studio/layout/useAutoPlaceOnOpen";
import { BoxesIcon, EyeIcon, EyeOffIcon, TrashIcon } from "@studio/icons";
import { getItemPrice, formatPrice } from "@studio/catalog/pricing";
import { isDraftCadSubject } from "@studio/cad/draftRoom";

/**
 * Inventory — floating side card listing every piece currently
 * placed in the apartment. Items are seeded from the apartamento
 * GLB at load (~65 catalog-tracked meshes), so the card opens with
 * a meaningful list immediately.
 *
 * Layout:
 *   • Header   — `Inventory · visible/total` count. NO × button —
 *                close via the Inventory tile in the Tools card.
 *   • List     — vertical, scrollable. Capped at ~360px max height
 *                so the card stays compact even with many items.
 *                Empty state ("No items placed yet") gets its own
 *                centered copy pointing the user at the Catalog tile.
 *   • Footer   — `Total value · $X` summed across visible items
 *
 * Inventory is read/manage only — there is intentionally no Add
 * button here. Adding furniture is the Catalog tool's job; the
 * Catalog tile in the Tools card is the single canonical entry
 * point. This avoids the previous overlap where both "Pieces"
 * (now Catalog) and Inventory had Add affordances.
 *
 * Each row carries:
 *   • Eye toggle  — flips visibility on the actual GLB meshes via
 *                   the furniture-slice; hidden rows get strike-
 *                   through label + faded text
 *   • Label       — clickable to select; selected = orange highlight
 *   • Price       — auto-fades on row hover
 *   • Trash       — slides in on row hover. Removes the item from
 *                   the scene (`placed: false` on the slice — the
 *                   meshes go invisible). The item reappears in the
 *                   Catalog grid for re-adding.
 *
 * Card is draggable via `useDraggable("tool-inventory")`.
 * Interactive children (eye / label / trash) opt out of drag with
 * `data-no-drag="true"`. The scrollable list also opts out so the
 * user can scroll without dragging the card.
 */

const MAX_LIST_HEIGHT = 360;

export function InventoryCard() {
  // Read the furniture array directly and derive `placed` here. This
  // avoids the selector returning a freshly-filtered array on every
  // store change, which under zustand's default Object.is equality
  // would cause this card to re-render whenever any unrelated store
  // field changed.
  const furniture = useStore((s) => s.furniture);
  const placed = useMemo(() => furniture.filter((f) => f.placed), [furniture]);

  const selectedId = useStore((s) => s.selectedId);
  const removeFurniture = useStore((s) => s.removeFurniture);
  const toggleVisibility = useStore((s) => s.toggleFurnitureVisibility);
  const selectFurniture = useStore((s) => s.selectFurniture);
  const visibleCount = useStore(selectVisibleCount);

  const { onMouseDown, onPointerDownCapture, positionStyle, zIndex } = useDraggable("tool-inventory");
  useAutoPlaceOnOpen("tool-inventory", 280, 220);

  // v0.40.44: full overflow rule for the left rail. Default: stack
  // below the Tools card. When stacking would push past the chat
  // dock, shift RIGHT of Tools (still on the left half of the
  // viewport, just one column inward) and align top with Tools'
  // top. Mirror image of PropertiesCard / StarredCard's right-side
  // logic.
  //
  // v0.40.46: dropped the MutationObserver on document.body that
  // was firing on every DOM mutation in the entire studio (every
  // keystroke in chat, every animation frame that adds/removes
  // elements, every store-driven re-render). The ResizeObserver
  // on the Tools card already catches the only DOM event that
  // actually matters for this card's positioning — when Tools
  // expands or collapses. Cheaper AND avoids edge-case feedback
  // loops where the MutationObserver fired during the card's own
  // first render.
  const [topPx, setTopPx] = useState<number>(290);
  const [leftPx, setLeftPx] = useState<number>(14);
  useEffect(() => {
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let selfHeight = 320;
    const measure = () => {
      const tools = document.querySelector(
        '[data-card-id="tools"]',
      ) as HTMLElement | null;
      if (!tools) return;

      const self = document.querySelector(
        '[data-card-id="tool-inventory"]',
      ) as HTMLElement | null;
      if (self) selfHeight = self.getBoundingClientRect().height || selfHeight;

      const r = tools.getBoundingClientRect();
      const proposedTop = r.bottom + 6;
      const FOOTER_BUFFER = 100;
      const wouldOverflow =
        proposedTop + selfHeight > window.innerHeight - FOOTER_BUFFER;

      if (wouldOverflow) {
        const desiredLeft = r.right + 8;
        const midlineCap = Math.round(window.innerWidth / 2) - 14;
        setTopPx(r.top);
        setLeftPx(Math.min(desiredLeft, midlineCap));
      } else {
        setTopPx(proposedTop);
        setLeftPx(14);
      }
    };
    const settle = () => {
      const tools = document.querySelector(
        '[data-card-id="tools"]',
      ) as HTMLElement | null;
      if (!tools) return;
      measure();
      ro?.disconnect();
      ro = new ResizeObserver(measure);
      ro.observe(tools);
    };
    raf = requestAnimationFrame(settle);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const totalValue = placed
    .filter((f) => f.visible)
    .reduce((sum, f) => sum + getItemPrice(f), 0);

  // v0.40.46: removed the auto-hide on `placed.length === 0`. The
  // user reported "I can't open my inventory" — clicking the
  // Inventory tile in the Tools menu did nothing visible because
  // the card was self-hiding on the empty case. Same broken pattern
  // StarredCard had in v0.40.31 and we fixed in v0.40.42: the
  // user's explicit toggle always wins. Empty state below explains
  // how to populate the inventory; an empty card with a hint is
  // far better than a button that appears not to work.

  return (
    <aside
      data-card-id="tool-inventory"
      className="glass"
      onMouseDown={onMouseDown}
      onPointerDownCapture={onPointerDownCapture}
      style={{
        position: "fixed",
        top: topPx,
        left: leftPx,
        width: 280,
        // v0.40.44: maxHeight relative to current top so the card
        // always has a body-scroll fallback regardless of whether
        // it's stacked-below or sideways-shifted.
        maxHeight: `calc(100vh - ${topPx + 100}px)`,
        borderRadius: 14,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        zIndex: zIndex ?? 4,
        cursor: "grab",
        overflow: "hidden",
        fontFamily: "var(--font-app), system-ui, sans-serif",
        // Soft slide only for auto-layout (stack under Tools). Once the
        // user has dragged the card, kill the transition — it lag-eases
        // every mouse move and feels unsmooth. Also disabled while
        // `data-dragging` is set by useDraggable.
        transition: positionStyle
          ? undefined
          : "top 0.18s ease, left 0.18s ease",
        ...positionStyle,
      }}
    >
      {/* ─── Header ─────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px 9px 14px",
          borderBottom: "1px solid rgba(124, 80, 50, 0.12)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: "#1A1A1A",
            minWidth: 0,
          }}
        >
          <BoxesIcon size={13} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            Inventory
          </span>
          {placed.length > 0 && (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                color: "rgba(26, 26, 26, 0.5)",
                marginLeft: 2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              · {visibleCount}/{placed.length}
            </span>
          )}
        </div>
      </div>

      {/* ─── List ───────────────────────────────────────────── */}
      <div
        data-no-drag="true"
        className="no-scrollbar"
        style={{
          flex: 1,
          minHeight: placed.length === 0 ? 80 : 60,
          maxHeight: MAX_LIST_HEIGHT,
          overflowY: "auto",
          padding: placed.length === 0 ? "20px 14px" : "8px 8px",
        }}
      >
        {placed.length === 0 ? (
          <div
            style={{
              fontSize: 11.5,
              color: "rgba(26, 26, 26, 0.5)",
              textAlign: "center",
              lineHeight: 1.5,
              fontWeight: 500,
            }}
          >
            No items placed yet.
            <br />
            <span style={{ color: "rgba(26, 26, 26, 0.4)" }}>
              Open the Catalog tool to add furniture.
            </span>
          </div>
        ) : (
          placed.map((item) => {
            const active = item.id === selectedId;
            return (
              <div
                key={item.id}
                className="inventory-row"
                data-active={active || undefined}
                onClick={() => selectFurniture(active ? null : item.id)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 8px",
                  marginBottom: 2,
                  borderRadius: 7,
                  border: "1px solid",
                  borderColor: active
                    ? "rgba(255, 90, 31, 0.5)"
                    : "rgba(124, 80, 50, 0.14)",
                  background: active
                    ? "rgba(255, 90, 31, 0.08)"
                    : "transparent",
                  cursor: "pointer",
                  transition: "background 0.12s ease, border-color 0.12s ease",
                }}
              >
                {/* Visibility toggle */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleVisibility(item.id);
                  }}
                  aria-label={item.visible ? "Hide" : "Show"}
                  title={item.visible ? "Hide" : "Show"}
                  data-no-drag="true"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    border: "none",
                    background: "transparent",
                    color: item.visible
                      ? active
                        ? "#FF5A1F"
                        : "rgba(26, 26, 26, 0.65)"
                      : "rgba(26, 26, 26, 0.35)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    flexShrink: 0,
                    transition: "color 0.12s ease",
                  }}
                >
                  {item.visible ? (
                    <EyeIcon size={12} />
                  ) : (
                    <EyeOffIcon size={12} />
                  )}
                </button>

                {/* Label */}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 11.5,
                    fontWeight: active ? 600 : 500,
                    color: active
                      ? "#FF5A1F"
                      : item.visible
                        ? "#1A1A1A"
                        : "rgba(26, 26, 26, 0.4)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: item.visible ? "none" : "line-through",
                    textDecorationColor: "rgba(26, 26, 26, 0.3)",
                  }}
                >
                  {item.label}
                </span>

                {/* Price fades on hover to make room for delete.
                    Draft panel size stays visible (no delete slot). */}
                <span
                  className={
                    isDraftCadSubject(item)
                      ? "inventory-dims"
                      : "inventory-price"
                  }
                  style={{
                    fontSize: 10,
                    fontVariantNumeric: "tabular-nums",
                    color: active ? "#FF5A1F" : "rgba(26, 26, 26, 0.5)",
                    flexShrink: 0,
                    transition: "opacity 0.15s ease",
                  }}
                >
                  {isDraftCadSubject(item)
                    ? `${Math.round(item.width * 1000)}×${Math.round(item.depth * 1000)}×${Math.round(item.height * 1000)} mm`
                    : formatPrice(getItemPrice(item))}
                </span>

                {/* Delete — hidden for structural draft CAD panel. */}
                {!isDraftCadSubject(item) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFurniture(item.id);
                  }}
                  aria-label={`Delete ${item.label}`}
                  title="Delete"
                  data-no-drag="true"
                  className="inventory-delete"
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    border: "none",
                    background: "transparent",
                    color: "rgba(180, 50, 30, 0.85)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <TrashIcon size={12} />
                </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ─── Footer ─────────────────────────────────────────── */}
      {placed.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            borderTop: "1px solid rgba(124, 80, 50, 0.12)",
            flexShrink: 0,
            background: "rgba(255, 255, 255, 0.35)",
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: "rgba(26, 26, 26, 0.55)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Total value
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#FF5A1F",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatPrice(totalValue)}
          </span>
        </div>
      )}
    </aside>
  );
}
