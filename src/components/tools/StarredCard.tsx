"use client";

/**
 * StarredCard — v0.40.31.
 *
 * Right-rail panel showing the cross-project starred collection.
 * Each entry has a thumbnail (the 2D image), a label, and a "+ Use
 * here" button that places the item into the current scene via the
 * existing placement helpers. Empty state explains how to star.
 *
 * Position: anchored below the GenerationsCard (which is itself
 * anchored below the Reference card). When neither GenerationsCard
 * nor any other right-rail card is mounted, falls back to a sensible
 * default.
 *
 * Auto-hide: render nothing when the user has zero starred items
 * AND no item is currently selected — the panel only earns space
 * when there's something to show or do.
 */

import { useEffect, useState } from "react";
import { useStore } from "@studio/store";
import { CloseIcon } from "@studio/icons";
import {
  placeGeneratedAssetIntoScene,
} from "@studio/scene/place-generated-asset";
import type { StarredItem } from "@studio/store/starred-slice";

const UI_FONT = "var(--font-app), system-ui, sans-serif";
const INK = "#1A1A1A";
const ACCENT = "#FF5A1F";
const TILE_THUMB_PX = 36;

export function StarredCard() {
  const starred = useStore((s) => s.starred);
  const removeStarred = useStore((s) => s.removeStarred);
  const apartmentCenter = useStore((s) => s.apartmentCenter);
  const sceneSource = useStore((s) => s.sceneSource);
  const applyScene = useStore((s) => s.applyScene);
  // v0.40.32: catalog items use the apartamento-shell placement
  // path (no GLB URL — they're nodes in the existing apartment).
  const placeItems = useStore((s) => s.placeItems);

  // v0.40.32: minimal helper to bring a starred catalog item back
  // into the scene. The item's catalogId is the same identifier the
  // CatalogModal uses for placeItems(ids). Idempotent — placeItems
  // is a no-op for already-placed items.
  const addCatalogItemToScene = (item: StarredItem) => {
    if (!item.catalogId) return;
    placeItems([item.catalogId]);
  };

  // Centered modal (like CatalogModal); Esc / backdrop click closes.
  const toggleTool = useStore((s) => s.toggleTool);
  const close = () => toggleTool("starred");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // v0.40.42: removed the auto-hide on `starred.length === 0`.
  // Previously the card returned null when empty — but the user
  // toggled it via the Tools menu and saw nothing happen, which
  // looked like a broken button. Now we always render when the
  // card is in `openTools`; an empty state explains how to add
  // items. The Tools menu's Starred row is the user's explicit
  // toggle; respect it.

  // v0.40.32: handleUse now takes a mode. For rooms, "replace"
  // calls applyScene (the original behavior — swaps walls + style +
  // pieces in one go), while "merge" iterates the saved pieces and
  // drops each into the CURRENT scene without touching walls or
  // existing furniture. For asset kind there's only one path —
  // place into the current scene alongside what's there.
  const handleUse = (
    item: StarredItem,
    mode: "replace" | "merge" = "replace",
  ) => {
    if (item.kind === "room") {
      const scene = item.scene as
        | {
            furniture?: Array<Record<string, unknown>>;
            roomMeta?: unknown;
            walls?: unknown;
            openings?: unknown;
            style?: unknown;
            referenceImageUrl?: string;
          }
        | undefined;
      if (!scene || !scene.furniture || !scene.roomMeta) return;

      if (mode === "merge") {
        // Drop each piece individually so the room's walls/style
        // don't override what's already in the scene. Pieces land
        // at their saved world positions; overlaps with existing
        // furniture are the user's call.
        let placed = 0;
        for (const p of scene.furniture) {
          const meta = (p?.meta ?? {}) as {
            glbUrl?: string;
            imageUrl?: string;
          };
          if (!meta.glbUrl) continue;
          const label = typeof p?.label === "string" ? p.label : "merged piece";
          placeGeneratedAssetIntoScene(
            {
              id: `merge_${item.id}_${placed}_${Date.now().toString(36)}`,
              kind: "asset",
              label,
              glbUrl: meta.glbUrl,
              imageUrl: meta.imageUrl,
              piece: {
                dimensions_hint: {
                  length: typeof p?.width === "number" ? p.width : 0.6,
                  width: typeof p?.depth === "number" ? p.depth : 0.6,
                  height: typeof p?.height === "number" ? p.height : 0.6,
                },
              },
              createdAt: Date.now(),
            } as never,
            { apartmentCenter, sceneSource },
          );
          placed++;
        }
        return;
      }

      // Replace mode: apply the entire saved scene.
      applyScene({
        furniture: scene.furniture as never,
        roomMeta: scene.roomMeta as never,
        walls: scene.walls as never,
        openings: scene.openings as never,
        styleBible: scene.style as never,
        referenceImageUrl: scene.referenceImageUrl,
      });
      return;
    }
    // v0.40.32: catalog kind — re-add the catalog item to the
    // current scene. Different placement path (no GLB URL —
    // catalog items are nodes in the apartamento.glb shell).
    if (item.kind === "catalog") {
      // Stub: dispatch an "add catalog item by id" event. The
      // existing CatalogModal exposes a similar action via the
      // store; we wire that up below.
      addCatalogItemToScene(item);
      return;
    }
    // Asset: place into scene without replacing — same affordance
    // the GenerationsCard "+" button uses for furniture.
    if (!item.glbUrl) return;
    placeGeneratedAssetIntoScene(
      {
        id: `starred_${item.id}_${Date.now().toString(36)}`,
        kind: "asset",
        label: item.label,
        glbUrl: item.glbUrl,
        imageUrl: item.imageUrl,
        // v0.40.32: forward the starred bucket key so the placed
        // item's mesh resolves through the dedicated bucket first.
        // Without this, a placed starred item would fall back to
        // the generation cache + fal.ai network — which 404s after
        // the source URL expires, the exact problem we set out to
        // fix.
        starredGlbKey: item.starredGlbKey,
        piece: item.dimensions
          ? {
              dimensions_hint: {
                length: item.dimensions.width,
                width: item.dimensions.depth,
                height: item.dimensions.height,
              },
            }
          : undefined,
        createdAt: Date.now(),
      } as never,
      { apartmentCenter, sceneSource },
    );
  };

  return (
    <div
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Starred — saved rooms and pieces"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26, 18, 10, 0.32)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        fontFamily: UI_FONT,
        // Match CatalogModal's entrance — cubic-bezier ease-out.
        animation: "starred-modal-in 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <aside
        data-card-id="tool-starred"
        onClick={(e) => e.stopPropagation()}
        className="glass-modal"
        style={{
          width: 520,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 96px)",
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRadius: 18,
            padding: 0,
            fontFamily: UI_FONT,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px 9px 14px",
              borderBottom: "1px solid rgba(124, 80, 50, 0.12)",
              color: INK,
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1, color: ACCENT }}>
              ★
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: INK }}>
              Starred
            </span>
            <span
              style={{
                fontSize: 10,
                color: "rgba(26, 26, 26, 0.45)",
                marginLeft: "auto",
              }}
            >
              cross-project
            </span>
          </div>

          {/* List */}
          <div
            data-no-drag="true"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "8px 8px 4px",
              overflowY: "auto",
            }}
          >
            {starred.length === 0 ? (
              <div
                style={{
                  padding: "20px 14px 18px",
                  textAlign: "center",
                  color: "rgba(26, 26, 26, 0.55)",
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                <div
                  style={{
                    fontSize: 22,
                    color: "rgba(255, 90, 31, 0.4)",
                    marginBottom: 6,
                  }}
                >
                  ★
                </div>
                <div style={{ fontWeight: 500, color: INK, marginBottom: 4 }}>
                  No starred items yet
                </div>
                <div>
                  Click the star on any generated piece or saved room to add it
                  here. Starred items survive project switches.
                </div>
              </div>
            ) : (
              starred
                .slice()
                .sort((a, b) => b.starredAt - a.starredAt)
                .map((item) => (
                  <StarredTile
                    key={item.id}
                    item={item}
                    onUse={(mode) => handleUse(item, mode)}
                    onRemove={() => removeStarred(item.id)}
                  />
                ))
            )}
          </div>

          {/* Footer hint */}
          <div
            style={{
              padding: "6px 12px 8px",
              fontSize: 10,
              color: "rgba(26, 26, 26, 0.45)",
              borderTop: "1px solid rgba(124, 80, 50, 0.08)",
              lineHeight: 1.4,
            }}
          >
            Survives project switches. Rooms offer Replace + Merge; pieces add
            alongside.
          </div>
        </div>
      </aside>
    </div>
  );
}

interface TileProps {
  item: StarredItem;
  /** v0.40.32: mode is "replace" for rooms (swap full scene) or
   *  "merge" for rooms (drop pieces into current scene). For
   *  asset/catalog kinds, mode is ignored — there's only one path. */
  onUse: (mode: "replace" | "merge") => void;
  onRemove: () => void;
}

function StarredTile({ item, onUse, onRemove }: TileProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      data-no-drag="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: 6,
        borderRadius: 8,
        background: hovered ? "rgba(255, 90, 31, 0.08)" : "transparent",
        border: hovered
          ? "1px solid rgba(255, 90, 31, 0.25)"
          : "1px solid transparent",
        transition: "background 0.12s ease, border-color 0.12s ease",
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          flexShrink: 0,
          width: TILE_THUMB_PX,
          height: TILE_THUMB_PX,
          borderRadius: 5,
          overflow: "hidden",
          background: "rgba(26, 26, 26, 0.06)",
        }}
      >
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.label}
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              color: ACCENT,
            }}
          >
            ★
          </div>
        )}
      </div>

      {/* Label */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: INK,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.label}
        </span>
        <span
          style={{
            fontSize: 9,
            color: "rgba(26, 26, 26, 0.5)",
          }}
        >
          {item.kind === "room"
            ? "Room"
            : item.kind === "catalog"
              ? "Catalog"
              : "Piece"}
        </span>
      </div>

      {/* Hover actions. v0.40.32: rooms get TWO action buttons —
          ↺ Replace (swap entire scene) and ⤵ Merge (drop pieces
          into current scene). Asset/catalog kinds keep the single
          + button. */}
      {hovered && (
        <div
          style={{
            display: "flex",
            gap: 4,
            flexShrink: 0,
          }}
        >
          {item.kind === "room" ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUse("replace");
                }}
                title="Replace current scene with this room"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  border: "none",
                  background: "rgba(255, 90, 31, 0.18)",
                  color: "#FF5A1F",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1,
                  fontFamily: UI_FONT,
                }}
              >
                ↺
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUse("merge");
                }}
                title="Merge this room's pieces into current scene"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  border: "none",
                  background: "rgba(26, 26, 26, 0.08)",
                  color: "#1A1A1A",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1,
                  fontFamily: UI_FONT,
                }}
              >
                ⤵
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUse("replace");
              }}
              title={
                item.kind === "catalog"
                  ? "Add this catalog item to the scene"
                  : "Add to scene"
              }
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                border: "none",
                background: "rgba(255, 90, 31, 0.18)",
                color: "#FF5A1F",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 500,
                lineHeight: 1,
                fontFamily: UI_FONT,
              }}
            >
              +
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Unstar"
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              border: "none",
              background: "rgba(26, 26, 26, 0.06)",
              color: "rgba(26, 26, 26, 0.65)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CloseIcon size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
