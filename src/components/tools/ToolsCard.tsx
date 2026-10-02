"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useStore } from "@studio/store";
import type { ToolName } from "@studio/store/ui-flags-slice";
import { useDraggable } from "@studio/hooks/useDraggable";
import {
  SlidersIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ImageIcon,
  LayoutGridIcon,
  BoxesIcon,
  MessageSquareIcon,
  SparkleIcon,
} from "@studio/icons";

/**
 * Tools card — top-LEFT, sits 6px under the project card. Ported 1:1
 * from the JSX prototype's tools surface, restricted to the tools we
 * actually ship: Reference, Catalog, Inventory, Generations, Chat history.
 *
 * Earlier versions had Planner + Health tiles. Both were removed in
 * v0.40.4: Planner's separate workspace modal didn't surface anything
 * the per-card UIs don't already cover (Inventory replaces Placed,
 * Generations replaces Options); Health was a stub that never
 * graduated to a real implementation. If they come back as real
 * features in the future, add the rows here.
 *
 * Two states:
 *   • Expanded (default) — header (sliders icon + "Tools" label +
 *                          collapse chevron) above a thin top border
 *                          and a stack of tool rows.
 *   • Collapsed         — single pill with the sliders icon, the
 *                          "Tools" label, and a down-chevron. Click
 *                          to expand again.
 *
 * Each tool row toggles its tool's floating card. Multiple tool cards
 * may be open at once. Membership in `openTools` drives the per-row
 * "active" state.
 *
 * Click targeting:
 *   • Header / padding / chevron → Tools rail comes to the front
 *   • A feature row → only that feature opens / raises (Tools does
 *     not steal the top of the stack on that press)
 */

interface ToolRow {
  /** Display label and key. MUST match a ToolName value. */
  name: ToolName;
  label: string;
  icon: ReactNode;
}

const ROWS: ToolRow[] = [
  { name: "reference", label: "Reference", icon: <ImageIcon size={14} /> },
  { name: "catalog", label: "Catalog", icon: <LayoutGridIcon size={14} /> },
  { name: "inventory", label: "Inventory", icon: <BoxesIcon size={14} /> },
  {
    name: "generations",
    label: "Generations",
    icon: <SparkleIcon size={14} />,
  },
  {
    name: "chat-history",
    label: "Chat history",
    icon: <MessageSquareIcon size={14} />,
  },
  // v0.40.49: room-grid — custom-footprint room shape builder.
  // Tap cells in a grid to define non-rectangular rooms (L, T, U
  // shapes), then submit to the orchestrator as a chat prompt.
  {
    name: "room-grid",
    label: "Room shape",
    icon: (
      <svg
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor" />
        <rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  // v0.40.31: starred — cross-project favorites. Star icon as
  // inline SVG to avoid importing a whole icon set just for this.
  {
    name: "starred",
    label: "Starred",
    icon: (
      <svg
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="12 2 15 9 22 9 16 14 19 21 12 17 5 21 8 14 2 9 9 9 12 2" />
      </svg>
    ),
  },
];

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";
const UI_FONT = "var(--font-app), system-ui, sans-serif";

export function ToolsCard() {
  const open = useStore((s) => s.toolsCardOpen);
  const setOpen = useStore((s) => s.setToolsCardOpen);
  const openTools = useStore((s) => s.openTools);
  const toggleTool = useStore((s) => s.toggleTool);

  // Self-hiding card data sources. Inventory's card returns null
  // when no furniture is placed; Generations returns null when no
  // assets have been generated yet. The Tools tile reflects this:
  // even if the tool is in `openTools`, we don't show the active-
  // orange treatment when the card is hidden — otherwise the user
  // sees a "selected" tile with no corresponding card on screen.
  const placedCount = useStore(
    (s) => (s.furniture ?? []).filter((f) => f.placed).length,
  );
  const generationCount = useStore((s) => (s.assetGenerations ?? []).length);

  // Drag-to-reposition. The whole card is draggable; the chevron
  // button and tool tiles opt out via `data-no-drag="true"` so
  // clicking them doesn't start a drag.
  const {
    onMouseDown,
    onPointerDownCapture: raiseToolsOnPress,
    positionStyle,
    zIndex,
  } = useDraggable("tools");

  // Chrome / empty space on the Tools rail → bring Tools to front.
  // Feature tiles → do NOT raise Tools; `toggleTool` opens/raises
  // that feature card instead (otherwise Tools steals top first and
  // stacking / close-on-second-click breaks).
  const onPointerDownCapture = (e: ReactPointerEvent<HTMLElement>) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("[data-tool-tile]")) return;
    raiseToolsOnPress(e);
  };

  return (
    <aside
      data-card-id="tools"
      onMouseDown={onMouseDown}
      onPointerDownCapture={onPointerDownCapture}
      style={{
        position: "fixed",
        top: 76,
        left: 14,
        zIndex: zIndex ?? 4,
        cursor: "grab",
        ...positionStyle,
      }}
    >
      {open ? (
        <div
          className="glass"
          style={{
            display: "flex",
            flexDirection: "column",
            borderRadius: 14,
            padding: 12,
            gap: 10,
            width: 168,
            fontFamily: UI_FONT,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                color: INK,
              }}
            >
              <SlidersIcon size={13} />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Tools
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Collapse tools"
              className="tools-chevron"
              data-no-drag="true"
              style={{
                width: 20,
                height: 20,
                borderRadius: 5,
                border: "none",
                background: "transparent",
                color: "rgba(26, 26, 26, 0.55)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                transition: "background 0.15s ease, color 0.15s ease",
              }}
            >
              <ChevronUpIcon size={12} />
            </button>
          </div>

          {/* Tool list — stacked rows */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              paddingTop: 6,
              borderTop: "1px solid rgba(124, 80, 50, 0.1)",
              marginTop: -2,
            }}
          >
            {ROWS.map((row) => {
              // Whether the tool is in `openTools`. For self-hiding
              // cards (Inventory, Generations) the actual card may
              // still render null if its data is empty, so we also
              // check the card's data source. Showing the orange
              // active treatment without a corresponding visible card
              // confused users — the tile looks selected, nothing
              // appears to happen on click.
              // v0.40.25: previously the active-orange treatment was
              // suppressed for Inventory/Generations when they were
              // empty (their cards self-hide). For Generations, the
              // card no longer self-hides — it shows an empty-state
              // message instead — so the active treatment is no
              // longer suppressed. Inventory keeps its existing
              // suppression because that card still self-hides.
              // v0.40.48: dropped the "inventory + placedCount === 0
              // suppresses isActive" branch. v0.40.46 removed the
              // InventoryCard auto-hide so an empty placed list now
              // renders an empty-state message rather than nothing.
              // Suppressing the row's active highlight on empty made
              // the user think clicking the tile did nothing — exact
              // same broken-feeling behavior as a tile that doesn't
              // mount its card. The row should always reflect its
              // actual openTools membership.
              const isOpen = openTools.includes(row.name);
              const isActive = isOpen;
              return (
                <button
                  key={row.name}
                  type="button"
                  onClick={() => toggleTool(row.name)}
                  className="tool-tile"
                  data-tool-tile="true"
                  data-no-drag="true"
                  data-active={isActive || undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "6px 10px",
                    border: "none",
                    borderRadius: 999,
                    background: isActive
                      ? "rgba(255, 90, 31, 0.1)"
                      : "transparent",
                    cursor: "pointer",
                    fontFamily: UI_FONT,
                    fontSize: 11,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? ACCENT : "rgba(26, 26, 26, 0.55)",
                    textAlign: "left",
                    transition: "background 0.15s ease, color 0.15s ease",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      flexShrink: 0,
                      color: isActive ? ACCENT : "rgba(26, 26, 26, 0.65)",
                    }}
                  >
                    {row.icon}
                  </span>
                  <span>{row.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        // Collapsed: compact pill with Tools label + chevron-down.
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open tools"
          className="tools-collapsed-pill"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 12px",
            borderRadius: 12,
            border: "1px solid rgba(124, 80, 50, 0.18)",
            background: "rgba(255, 255, 255, 0.6)",
            color: "rgba(26, 26, 26, 0.8)",
            cursor: "pointer",
            fontFamily: UI_FONT,
            fontSize: 12,
            fontWeight: 500,
            transition: "background 0.15s ease, border-color 0.15s ease",
          }}
        >
          <SlidersIcon size={13} style={{ color: INK }} />
          <span>Tools</span>
          <ChevronDownIcon
            size={11}
            style={{ color: "rgba(26, 26, 26, 0.55)" }}
          />
        </button>
      )}
    </aside>
  );
}
