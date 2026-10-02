"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@studio/store";
import type { CatalogItem } from "@studio/catalog/types";
import {
  LayoutGridIcon,
  SearchIcon,
  PlusCircleIcon,
} from "@studio/icons";
import {
  CATALOG_DRAG_MIME,
  catalogDragPayload,
  placeFromCatalog,
} from "@studio/catalog/placeFromCatalog";
import {
  PANEL_CATEGORY_FILTERS,
  panelCategoryCatalog,
  type PanelCategory,
} from "@studio/cad/openFrontBox";

/**
 * Catalog — horizontal strip docked just below the top function bar.
 * Same width as the chat box (600px). Panel construction templates:
 * Shelf / Divider / Back Panel (filter chips + search).
 */

const STRIP_WIDTH = 600;
const STRIP_GAP_BELOW_TOPBAR = 8;
const MAX_BATCH = 10;
const TILE_WIDTH = 96;

type CategoryFilter = PanelCategory | "all";

export function CatalogCard() {
  const openTools = useStore((s) => s.openTools);
  const isOpen = openTools.includes("catalog");
  const bringCardToFront = useStore((s) => s.bringCardToFront);

  const items = useMemo(() => panelCategoryCatalog(), []);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [capFlash, setCapFlash] = useState<string | null>(null);
  const [topPx, setTopPx] = useState(56);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sit just below the top function bar.
  useEffect(() => {
    if (!isOpen) return;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const bar = document.querySelector(
        "[data-top-bar]",
      ) as HTMLElement | null;
      if (!bar) {
        setTopPx(56);
        return;
      }
      const r = bar.getBoundingClientRect();
      setTopPx(Math.round(r.bottom + STRIP_GAP_BELOW_TOPBAR));
    };
    const settle = () => {
      measure();
      const bar = document.querySelector(
        "[data-top-bar]",
      ) as HTMLElement | null;
      ro?.disconnect();
      if (bar) {
        ro = new ResizeObserver(measure);
        ro.observe(bar);
      }
    };
    raf = requestAnimationFrame(settle);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setCategory("all");
      setSelectedIds([]);
      setCapFlash(null);
    }
  }, [isOpen]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (category !== "all" && it.category !== category) return false;
      if (q && !`${it.label} ${it.category} ${it.id}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [items, search, category]);

  // Vertical wheel → horizontal scroll on the tile row.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isOpen) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isOpen, filteredItems.length]);

  const flashAtCap = () => {
    const msg = `Max ${MAX_BATCH} per batch`;
    setCapFlash(msg);
    window.setTimeout(() => {
      setCapFlash((curr) => (curr === msg ? null : curr));
    }, 2400);
  };

  const toggleSelect = (it: CatalogItem) => {
    setSelectedIds((prev) => {
      if (prev.includes(it.id)) return prev.filter((x) => x !== it.id);
      if (prev.length >= MAX_BATCH) {
        flashAtCap();
        return prev;
      }
      return [...prev, it.id];
    });
  };

  const handleAddBatch = () => {
    if (selectedIds.length === 0) return;
    const batch = filteredItems.filter((it) => selectedIds.includes(it.id));
    placeFromCatalog(batch.map(catalogDragPayload));
    setSelectedIds([]);
  };

  if (!isOpen) return null;

  return (
    <aside
      data-card-id="tool-catalog"
      className="glass"
      onPointerDownCapture={() => bringCardToFront("tool-catalog")}
      role="dialog"
      aria-label="Catalog — shelf, divider, and back panel"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        top: topPx,
        width: STRIP_WIDTH,
        maxWidth: "calc(100vw - 32px)",
        borderRadius: 12,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        zIndex: 6,
        overflow: "hidden",
        fontFamily: "var(--font-app), system-ui, sans-serif",
        transition: "top 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {/* Top bar: title + filters + search + add */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px 6px 10px",
          borderBottom: "1px solid rgba(124, 80, 50, 0.1)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            color: "#1A1A1A",
            flexShrink: 0,
          }}
        >
          <LayoutGridIcon size={12} />
          <span style={{ fontSize: 11, fontWeight: 500 }}>Catalog</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
          }}
        >
          {PANEL_CATEGORY_FILTERS.map((f) => {
            const active = category === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setCategory(f.id)}
                style={{
                  padding: "3px 7px",
                  borderRadius: 6,
                  border: "1px solid",
                  borderColor: active
                    ? "rgba(255, 90, 31, 0.45)"
                    : "rgba(124, 80, 50, 0.14)",
                  background: active
                    ? "rgba(255, 90, 31, 0.1)"
                    : "rgba(255, 255, 255, 0.4)",
                  color: active ? "#C2410C" : "rgba(26, 26, 26, 0.7)",
                  fontFamily: "var(--font-app), system-ui, sans-serif",
                  fontSize: 9.5,
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 5,
            minWidth: 0,
            padding: "3px 8px",
            borderRadius: 7,
            background: "rgba(255, 255, 255, 0.45)",
            border: "1px solid rgba(124, 80, 50, 0.12)",
          }}
        >
          <SearchIcon size={11} style={{ color: "rgba(26, 26, 26, 0.4)" }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: "var(--font-app), system-ui, sans-serif",
              fontSize: 11,
              fontWeight: 500,
              color: "#1A1A1A",
              padding: 0,
              minWidth: 0,
            }}
          />
        </div>

        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255, 90, 31, 0.9)",
              fontFamily: "var(--font-app), system-ui, sans-serif",
              fontSize: 9.5,
              fontWeight: 600,
              cursor: "pointer",
              padding: 0,
              flexShrink: 0,
            }}
          >
            Clear {selectedIds.length}
          </button>
        )}

        <button
          type="button"
          onClick={handleAddBatch}
          disabled={selectedIds.length === 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 10px",
            borderRadius: 7,
            border: "none",
            background:
              selectedIds.length > 0 ? "#FF5A1F" : "rgba(26, 26, 26, 0.08)",
            color:
              selectedIds.length > 0 ? "#FFF4EC" : "rgba(26, 26, 26, 0.4)",
            fontFamily: "var(--font-app), system-ui, sans-serif",
            fontSize: 11,
            fontWeight: 500,
            cursor: selectedIds.length > 0 ? "pointer" : "not-allowed",
            flexShrink: 0,
          }}
        >
          <PlusCircleIcon size={11} />
          {selectedIds.length === 0 ? "Add" : `Add ${selectedIds.length}`}
        </button>
      </div>

      {/* Horizontal scroller — swipe / wheel / trackpad, no arrows */}
      <div
        ref={scrollRef}
        className="no-scrollbar"
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          gap: 6,
          padding: "8px 10px 9px 10px",
          scrollBehavior: "smooth",
          minWidth: 0,
        }}
      >
        {filteredItems.length === 0 && (
          <div
            style={{
              fontSize: 10,
              color: "rgba(26, 26, 26, 0.5)",
              padding: "12px 16px",
              whiteSpace: "nowrap",
            }}
          >
            No matches.
          </div>
        )}
        {filteredItems.map((it) => (
          <ItemCard
            key={it.id}
            item={it}
            selected={selectedIds.includes(it.id)}
            onClick={() => toggleSelect(it)}
          />
        ))}
      </div>

      {capFlash && (
        <div
          style={{
            padding: "4px 10px 6px",
            fontSize: 9.5,
            fontWeight: 500,
            color: "rgba(26, 26, 26, 0.7)",
          }}
        >
          {capFlash}
        </div>
      )}
    </aside>
  );
}

interface ItemCardProps {
  item: CatalogItem;
  selected: boolean;
  onClick: () => void;
}

function ItemCard({ item, selected, onClick }: ItemCardProps) {
  const ratio = Math.max(
    0.25,
    Math.min(item.width / Math.max(0.1, item.depth), 4),
  );
  const shapeWidth = Math.min(36, 16 * ratio);
  const shapeHeight = 16;
  const dragRef = useRef(false);

  return (
    <button
      type="button"
      draggable
      title="Click to select · drag onto the scene to place"
      onDragStart={(e) => {
        dragRef.current = true;
        e.dataTransfer.setData(
          CATALOG_DRAG_MIME,
          JSON.stringify(catalogDragPayload(item)),
        );
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          dragRef.current = false;
        }, 0);
      }}
      onClick={() => {
        if (dragRef.current) return;
        onClick();
      }}
      style={{
        position: "relative",
        flex: `0 0 ${TILE_WIDTH}px`,
        width: TILE_WIDTH,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        padding: "6px 6px 5px 6px",
        borderRadius: 8,
        border: "1px solid",
        borderColor: selected
          ? "rgba(255, 90, 31, 0.55)"
          : "rgba(124, 80, 50, 0.16)",
        background: selected
          ? "rgba(255, 90, 31, 0.08)"
          : "rgba(255, 255, 255, 0.55)",
        cursor: "grab",
        fontFamily: "var(--font-app), system-ui, sans-serif",
        textAlign: "left",
        gap: 4,
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      {selected && (
        <span
          aria-label="Selected"
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#FF5A1F",
            boxShadow: "0 0 0 1.5px #FFF4EC",
          }}
        />
      )}

      <div
        style={{
          width: "100%",
          height: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255, 255, 255, 0.55)",
          borderRadius: 5,
          border: "1px dashed rgba(124, 80, 50, 0.15)",
        }}
      >
        <div
          style={{
            width: shapeWidth,
            height: shapeHeight,
            borderRadius: 2,
            background: selected
              ? "rgba(255, 90, 31, 0.6)"
              : "rgba(26, 26, 26, 0.28)",
          }}
        />
      </div>

      <span
        style={{
          fontSize: 9.5,
          fontWeight: 600,
          color: "#1A1A1A",
          lineHeight: 1.2,
          width: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.label}
      </span>

      <span
        style={{
          fontSize: 8,
          fontWeight: 500,
          color: "rgba(26, 26, 26, 0.5)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.15,
          width: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.width.toFixed(2)}×{item.depth.toFixed(2)}×{item.height.toFixed(2)}
      </span>
    </button>
  );
}
