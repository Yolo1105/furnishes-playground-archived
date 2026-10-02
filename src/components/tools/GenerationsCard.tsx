"use client";

import { useEffect, useState } from "react";
import { useStore } from "@studio/store";
import { useDraggable } from "@studio/hooks/useDraggable";
import { useAutoPlaceOnOpen } from "@studio/layout/useAutoPlaceOnOpen";
import { SparkleIcon, CloseIcon } from "@studio/icons";
import {
  placeGeneratedAssetIntoScene,
  replaceCurrentWithGeneratedAsset,
} from "@studio/scene/place-generated-asset";
import type { AssetGeneration } from "@studio/store/generations-slice";
import { GenerationDetailModal } from "./GenerationDetailModal";

/**
 * Generations card — floating side card showing past asset
 * generations as combined 2D+3D tiles. Sits below the Reference
 * card on the right side of the screen.
 *
 * Layout:
 *   • Header     — "Generations" + count badge.
 *   • List       — vertical, scrollable. Each tile shows:
 *                    – The Flux 2D image (left, 56×56)
 *                    – A small 3D-marker chip indicating the GLB exists
 *                    – Label + relative timestamp (right column)
 *                    – ✕ button on hover to remove from history
 *                  Click anywhere on the tile (except the ✕) to drop
 *                  the asset into the scene as the active piece —
 *                  removes any prior generation-source pieces and
 *                  drops this one in at scene center.
 *
 * Empty state: returns null. The Tools card's tile reflects this
 * (the active-orange treatment is suppressed when generationCount === 0).
 *
 * Position: fixed top-right, below ReferenceCard. Tracks the
 * Reference card's bottom edge so the gap stays uniform regardless
 * of whether Reference is at its default 420×300 or has been
 * resized by the user.
 *
 * Drag: card root is draggable via useDraggable("tool-generations").
 * The list and individual tiles opt out via data-no-drag.
 */

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";
const UI_FONT = "var(--font-app), system-ui, sans-serif";
const TILE_THUMB_PX = 56;
const MAX_LIST_HEIGHT = 380;

function relativeTime(ts: number): string {
  const ageMs = Date.now() - ts;
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function GenerationsCard() {
  const generations = useStore((s) => s.assetGenerations ?? []);
  const removeAssetGeneration = useStore((s) => s.removeAssetGeneration);
  const apartmentCenter = useStore((s) => s.apartmentCenter);
  const sceneSource = useStore((s) => s.sceneSource);

  const { onMouseDown, onPointerDownCapture, positionStyle, zIndex } = useDraggable("tool-generations");
  useAutoPlaceOnOpen("tool-generations", 280, 320);

  // v0.40.49: detail-expand modal state. Clicking the new "view
  // details" icon on a hovered tile opens this modal, which shows
  // the full piece list, room dims, style summary. Apply / Close
  // buttons in the modal handle the load decision explicitly so
  // the user can read details before committing.
  const [detailAsset, setDetailAsset] = useState<AssetGeneration | null>(null);

  // v0.40.26: anchor below either the Properties card (if a piece is
  // v0.40.28: Properties no longer sits below Reference (it moved to
  // top-right, LEFT of Reference). So Generations always anchors on
  // Reference now — the prior "prefer Properties when mounted" logic
  // is gone. selectedId still triggers a re-measure as a safety net
  // in case Reference's height changes when Properties appears (e.g.
  // if the user resized cards interactively).
  const selectedId = useStore((s) => s.selectedId);
  const [topPx, setTopPx] = useState<number>(270);
  useEffect(() => {
    // Anchor strictly on Reference now. requestAnimationFrame
    // ensures the DOM is settled before we measure.
    let raf = 0;
    let ro: ResizeObserver | null = null;

    const settle = () => {
      const ref = document.querySelector(
        '[data-card-id="tool-reference"]',
      ) as HTMLElement | null;
      if (!ref) return;
      const measure = () => {
        const r = ref.getBoundingClientRect();
        setTopPx(r.bottom + 8);
      };
      measure();
      ro?.disconnect();
      ro = new ResizeObserver(measure);
      ro.observe(ref);
    };

    raf = requestAnimationFrame(settle);
    window.addEventListener("resize", settle);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", settle);
    };
  }, [selectedId]);

  // v0.40.25: previously `if (generations.length === 0) return null;`
  // auto-hid the card. The Tools tile also suppresses the active-orange
  // treatment when count is zero — so clicking the Generations tile
  // appeared to do nothing (no card, no highlight). User reported this
  // explicitly: "i still can't open my generations in tools."
  //
  // The fix: render the card with a helpful empty-state when there's
  // nothing yet, instead of returning null. The user opens it, sees
  // "no generations yet — generate something via chat," and at least
  // gets feedback that the click worked. The Tools tile's active-state
  // suppression is removed in lockstep so the highlight matches.
  const isEmpty = generations.length === 0;

  // Newest first. We don't sort the slice's array in place because
  // assetGenerations is presumably append-ordered already, but a
  // copy + reverse keeps us safe if that contract ever drifts.
  const sorted = [...generations].sort((a, b) => b.createdAt - a.createdAt);

  const handleTileClick = (asset: AssetGeneration) => {
    // Room tiles re-apply a saved scene snapshot. Asset tiles re-place
    // a single piece. Older entries (pre-v0.40.16) don't have `kind`
    // and are treated as asset by default.
    if (asset.kind === "room" && asset.scene) {
      // Re-apply the room scene. We import dynamically so this card
      // doesn't pull the entire scene-source-slice surface at the
      // top level — it only needs applyScene if the user clicks a
      // room tile, which is rare per session.
      const scene = asset.scene as {
        furniture: unknown[];
        roomMeta: unknown;
        walls: unknown[];
        openings: unknown[];
        style: unknown;
      };
      const after = useStore.getState() as unknown as {
        applyScene?: (s: {
          furniture: unknown[];
          roomMeta: unknown;
          walls: unknown[];
          openings: unknown[];
          styleBible: unknown;
        }) => void;
      };
      after.applyScene?.({
        furniture: scene.furniture,
        roomMeta: scene.roomMeta,
        walls: scene.walls,
        openings: scene.openings,
        styleBible: scene.style,
      });
      return;
    }
    // Asset (default).
    if (!asset.glbUrl) return;
    replaceCurrentWithGeneratedAsset(
      asset as AssetGeneration & { glbUrl: string },
      {
        apartmentCenter,
        sceneSource,
      },
    );
  };

  // "+ Add to scene" appends rather than replaces. Useful when the
  // user wants to keep the previous generation in the scene and bring
  // this one in alongside.
  // v0.40.32: rooms now MERGE — iterate the saved scene's pieces and
  // place each one via placeGeneratedAssetIntoScene. This keeps the
  // current scene's walls/furniture intact and drops the room's
  // pieces into it. Pieces land at their original room-relative
  // positions; the user is responsible for any resulting overlaps.
  const handleTileAdd = (asset: AssetGeneration, e: React.MouseEvent) => {
    e.stopPropagation();
    if (asset.kind === "room") {
      // Pull pieces out of the saved scene snapshot and place each
      // one as if the user had generated them individually.
      const scene = asset.scene as
        | { furniture?: Array<Record<string, unknown>> }
        | undefined;
      const pieces = scene?.furniture;
      if (!Array.isArray(pieces) || pieces.length === 0) {
        // Fall back to the original replace behavior if the snapshot
        // is malformed — better than silently doing nothing.
        handleTileClick(asset);
        return;
      }
      // For each placed piece in the saved room, build an
      // AssetGeneration-shaped record and place it. We pull glbUrl
      // and imageUrl from the piece's meta (set by adapter.ts since
      // v0.40.30). Pieces without a glbUrl are skipped — they'd
      // render as placeholders anyway and "merge a placeholder"
      // isn't a meaningful action.
      let placed = 0;
      for (const p of pieces) {
        const meta = (p?.meta ?? {}) as {
          glbUrl?: string;
          imageUrl?: string;
        };
        if (!meta.glbUrl) continue;
        const label = typeof p?.label === "string" ? p.label : "merged piece";
        const pieceFromAsset: AssetGeneration & { glbUrl: string } = {
          id: `merge_${asset.id}_${placed}_${Date.now().toString(36)}`,
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
        };
        placeGeneratedAssetIntoScene(pieceFromAsset, {
          apartmentCenter,
          sceneSource,
        });
        placed++;
      }
      return;
    }
    if (!asset.glbUrl) return;
    placeGeneratedAssetIntoScene(
      asset as AssetGeneration & { glbUrl: string },
      {
        apartmentCenter,
        sceneSource,
      },
    );
  };

  return (
    <>
      <aside
        data-card-id="tool-generations"
        onMouseDown={onMouseDown}
      onPointerDownCapture={onPointerDownCapture}
        style={{
          position: "fixed",
          top: topPx,
          right: 14,
          width: 280,
          maxHeight: "calc(100vh - 100px)",
          zIndex: zIndex ?? 4,
          cursor: "grab",
          ...positionStyle,
        }}
      >
        <div
          className="glass"
          style={{
            display: "flex",
            flexDirection: "column",
            borderRadius: 14,
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
            <SparkleIcon size={13} />
            <span style={{ fontSize: 12, fontWeight: 500 }}>Generations</span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 500,
                color: "rgba(26, 26, 26, 0.5)",
              }}
            >
              {generations.length}
            </span>
          </div>

          {/* List or empty-state. v0.40.25: when isEmpty, render a
            small inline message instead of an empty list — gives the
            user feedback that the card opened, with hints on how to
            get content into it. */}
          <div
            data-no-drag="true"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: 6,
              maxHeight: MAX_LIST_HEIGHT,
              overflowY: "auto",
            }}
          >
            {isEmpty ? (
              <div
                style={{
                  padding: "20px 14px",
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: "rgba(26, 26, 26, 0.55)",
                  fontFamily: UI_FONT,
                  textAlign: "center",
                }}
              >
                No generations yet.
                <br />
                <span style={{ fontSize: 10, color: "rgba(26, 26, 26, 0.4)" }}>
                  Generated rooms and pieces will appear here as tiles. Try the
                  chat below — describe a room or a furniture piece to generate
                  one.
                </span>
              </div>
            ) : (
              sorted.map((asset) => (
                <GenerationTile
                  key={asset.id}
                  asset={asset}
                  onPick={handleTileClick}
                  onAdd={handleTileAdd}
                  onRemove={() => removeAssetGeneration(asset.id)}
                  onDetail={(a) => setDetailAsset(a)}
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
            Click a tile to show it on screen. Use + to add alongside.
          </div>
        </div>
      </aside>
      {detailAsset && (
        <GenerationDetailModal
          asset={detailAsset}
          onClose={() => setDetailAsset(null)}
          onApply={(a) => handleTileClick(a)}
        />
      )}
    </>
  );
}

/**
 * One tile per generation. The 2D Flux image is shown as a thumbnail
 * on the left; a "3D" chip overlays the bottom-right corner to
 * indicate that a GLB mesh is also available. The text column shows
 * the label and relative timestamp; hover reveals + and ✕ buttons.
 */
interface TileProps {
  asset: AssetGeneration;
  onPick: (asset: AssetGeneration) => void;
  onAdd: (asset: AssetGeneration, e: React.MouseEvent) => void;
  onRemove: () => void;
  onDetail: (asset: AssetGeneration) => void;
}

function GenerationTile({
  asset,
  onPick,
  onAdd,
  onRemove,
  onDetail,
}: TileProps) {
  const [hovered, setHovered] = useState(false);
  // v0.40.30: room/interior-design tiles can expand to show their
  // constituent pieces. Furniture tiles never expand (they're a
  // single piece). The expand chevron only renders when expansion
  // is meaningful AND the saved scene snapshot has piece data.
  const [expanded, setExpanded] = useState(false);
  const isRoom = asset.kind === "room";

  // Pull the per-piece array out of the saved scene snapshot. The
  // shape is AssembledScene from director/schema; we cast to a
  // narrow read-only view to avoid pulling that whole type into
  // this presentational component. Each sub-piece carries the
  // optional image_url field added in v0.40.30.
  const subPieces: Array<{
    id: string;
    description: string;
    image_url?: string;
  }> = (() => {
    if (!isRoom || !asset.scene) return [];
    const scene = asset.scene as { pieces?: unknown };
    const pieces = scene.pieces;
    if (!Array.isArray(pieces)) return [];
    return pieces
      .filter(
        (p): p is { id: string; description: string; image_url?: string } =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as { id?: unknown }).id === "string" &&
          typeof (p as { description?: unknown }).description === "string",
      )
      .slice(0, 16); // cap so a 30-piece room doesn't stretch the row
  })();
  const canExpand = isRoom && subPieces.length > 0;

  const setReferencePreviewImageUrl = useStore(
    (s) => s.setReferencePreviewImageUrl,
  );

  return (
    <div
      data-no-drag="true"
      onClick={() => {
        // v0.40.30: clicking a room tile while it's expanded should
        // NOT collapse it (the user is reading sub-pieces). Click
        // the expand chevron explicitly to collapse. For a non-
        // expanded room tile or any furniture tile, click loads.
        if (canExpand && expanded) return;
        onPick(asset);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={
        canExpand && expanded
          ? `Showing ${subPieces.length} pieces — click chevron to collapse`
          : `Show "${asset.label}" — replaces current`
      }
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 6,
        borderRadius: 8,
        cursor: canExpand && expanded ? "default" : "pointer",
        background: hovered ? "rgba(255, 90, 31, 0.08)" : "transparent",
        border: hovered
          ? "1px solid rgba(255, 90, 31, 0.2)"
          : "1px solid transparent",
        transition: "background 0.12s ease, border-color 0.12s ease",
      }}
    >
      {/* Top row — same as before but with optional expand chevron. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {/* Thumbnail — 2D Flux image with a small 3D chip overlay. */}
        <div
          style={{
            position: "relative",
            flexShrink: 0,
            width: TILE_THUMB_PX,
            height: TILE_THUMB_PX,
          }}
        >
          {asset.imageUrl ? (
            <img
              src={asset.imageUrl}
              alt={asset.label}
              style={{
                width: TILE_THUMB_PX,
                height: TILE_THUMB_PX,
                borderRadius: 6,
                objectFit: "cover",
                background: "rgba(26, 26, 26, 0.06)",
                display: "block",
              }}
            />
          ) : subPieces[0]?.image_url ? (
            /* v0.40.49: when the asset itself has no top-level imageUrl
             (chat-mode generations frequently don't — the orchestrator
             only attaches one when style-anchor produced a hero image),
             fall back to the first piece's image. Better to show a
             real piece than the abstract "+" placeholder. */
            <img
              src={subPieces[0].image_url}
              alt={asset.label}
              style={{
                width: TILE_THUMB_PX,
                height: TILE_THUMB_PX,
                borderRadius: 6,
                objectFit: "cover",
                background: "rgba(26, 26, 26, 0.06)",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                width: TILE_THUMB_PX,
                height: TILE_THUMB_PX,
                borderRadius: 6,
                background: "rgba(255, 90, 31, 0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: ACCENT,
                textTransform: "uppercase",
              }}
              aria-label={asset.label}
            >
              {/* v0.40.49: kind-aware fallback. Pure-text generations
                that produced no image at all show "Room" or "Piece"
                so the user can at least tell what they were looking
                at. Previously every empty tile was the same "+". */}
              {isRoom ? "Room" : "Piece"}
            </div>
          )}
          {/* 3D chip — present when a GLB is available, which is
            essentially always for AssetGeneration entries. We render
            it conditionally anyway in case future paths add image-
            only entries. */}
          {asset.glbUrl && (
            <span
              style={{
                position: "absolute",
                right: 3,
                bottom: 3,
                padding: "1px 5px",
                borderRadius: 4,
                background: "rgba(26, 26, 26, 0.78)",
                color: "#FFFFFF",
                fontSize: 8,
                fontWeight: 500,
                letterSpacing: "0.04em",
                pointerEvents: "none",
              }}
            >
              3D
            </span>
          )}
        </div>

        {/* Text column */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: INK,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {asset.label}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "rgba(26, 26, 26, 0.5)",
            }}
          >
            {relativeTime(asset.createdAt)}
          </span>
        </div>

        {/* Hover actions: + add alongside, ✕ remove from history.
          v0.40.29: the "+" button only makes sense for FURNITURE
          tiles (single-piece additions to the scene). Room tiles
          can't be "added alongside" — they replace the entire scene
          by their nature. So we render "+" conditionally on
          asset.kind being "asset" (or absent, for back-compat with
          pre-v0.40.16 entries that didn't have the discriminator). */}
        {hovered && (
          <div
            data-no-drag="true"
            style={{
              display: "flex",
              gap: 4,
              flexShrink: 0,
            }}
          >
            {/* v0.40.32: "+" now appears for ALL tile kinds. For
              furniture, it adds the piece to the current scene
              alongside what's already there. For rooms / interior-
              design, it MERGES — drops the room's individual pieces
              into the current scene without replacing walls or
              other furniture. (Previously "+" was hidden on rooms
              since "add a room alongside" wasn't well-defined.) */}
            <button
              type="button"
              onClick={(e) => onAdd(asset, e)}
              title={
                asset.kind === "room"
                  ? "Merge this room's pieces into current scene"
                  : "Add to scene without replacing"
              }
              data-no-drag="true"
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                border: "none",
                background: "rgba(26, 26, 26, 0.06)",
                color: INK,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 500,
                lineHeight: 1,
                fontFamily: UI_FONT,
              }}
            >
              +
            </button>
            {/* v0.40.49: Details (i) — opens GenerationDetailModal with
              full piece list, room dims, style summary. Replaces
              the "click → load immediately" with an explicit
              "preview, then choose to load" flow when the user
              wants to inspect what they're applying. */}
            <button
              type="button"
              data-no-drag="true"
              onClick={(e) => {
                e.stopPropagation();
                onDetail(asset);
              }}
              title="View details — pieces, dimensions, style"
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
                fontSize: 12,
                fontWeight: 600,
                fontStyle: "italic",
                lineHeight: 1,
                fontFamily: "Georgia, serif",
              }}
            >
              i
            </button>
            {/* v0.40.30: expand/collapse chevron — only on room tiles
              that have sub-pieces to show. Toggles the inline row
              of per-piece thumbnails below the main tile row. */}
            {canExpand && (
              <button
                type="button"
                data-no-drag="true"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                title={
                  expanded
                    ? "Collapse pieces"
                    : `Show ${subPieces.length} pieces`
                }
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  border: "none",
                  background: expanded
                    ? "rgba(255, 90, 31, 0.16)"
                    : "rgba(26, 26, 26, 0.06)",
                  color: expanded ? "#FF5A1F" : "rgba(26, 26, 26, 0.65)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  lineHeight: 1,
                  transform: expanded ? "rotate(180deg)" : "none",
                  transition: "transform 0.18s ease, background 0.15s ease",
                }}
              >
                ⌄
              </button>
            )}
            {/* v0.40.31: star button — persist this generation across
              project switches. Works for both furniture and rooms.
              Filled accent orange when starred, outlined gray otherwise. */}
            <TileStarButton asset={asset} />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              title="Remove from history"
              data-no-drag="true"
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
      {/* v0.40.30: expanded sub-piece thumbnail row — horizontal
          scroll of per-piece 2D images. Only renders for room
          tiles when expanded. Clicking a thumbnail sets the
          Reference card's ad-hoc preview override so the user
          sees that piece's 2D image WITHOUT having to load the
          whole room first. */}
      {canExpand && expanded && (
        <div
          data-no-drag="true"
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "flex",
            gap: 6,
            overflowX: "auto",
            padding: "4px 2px 6px",
            // Subtle entrance — slight scale + fade so the row
            // doesn't pop in jarringly.
            animation: "tile-row-in 0.22s ease",
          }}
        >
          {subPieces.map((sub) => (
            <button
              key={sub.id}
              type="button"
              data-no-drag="true"
              onClick={(e) => {
                e.stopPropagation();
                if (sub.image_url) {
                  setReferencePreviewImageUrl(sub.image_url);
                }
              }}
              title={sub.description}
              style={{
                flexShrink: 0,
                width: 48,
                height: 48,
                padding: 0,
                borderRadius: 6,
                border: "1px solid rgba(124, 80, 50, 0.18)",
                background: sub.image_url
                  ? "transparent"
                  : "rgba(26, 26, 26, 0.06)",
                cursor: sub.image_url ? "pointer" : "not-allowed",
                overflow: "hidden",
                opacity: sub.image_url ? 1 : 0.5,
              }}
            >
              {sub.image_url ? (
                <img
                  src={sub.image_url}
                  alt={sub.description}
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <span
                  style={{
                    fontSize: 8,
                    color: "rgba(26, 26, 26, 0.5)",
                    padding: 4,
                    display: "block",
                    lineHeight: 1.2,
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                  }}
                >
                  {sub.description.slice(0, 18)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * TileStarButton — v0.40.31.
 *
 * Toggles whether this generation tile is in the cross-project
 * starred collection. Sets / removes via the starred-slice. The
 * button shows a filled accent-orange star when starred, outlined when not.
 *
 * For room/interior-design entries, we save the entire scene
 * snapshot so re-import via the StarredCard can replay the room.
 * For furniture entries, we save the GLB url + image url + the
 * piece's dimensions (extracted from asset.piece) for placement.
 */
function TileStarButton({ asset }: { asset: AssetGeneration }) {
  const isStarred = useStore((s) => s.isStarred(asset.id));
  const addStarred = useStore((s) => s.addStarred);
  const removeStarred = useStore((s) => s.removeStarred);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isStarred) {
      removeStarred(asset.id);
      return;
    }
    // Pull dimensions out of asset.piece for furniture entries.
    // Rooms don't need dims at the top level — their pieces carry
    // their own dimensions inside `scene`.
    let dimensions:
      | { width: number; depth: number; height: number }
      | undefined;
    const piece = asset.piece as
      | {
          dimensions_hint?: {
            length?: number;
            width?: number;
            height?: number;
          };
        }
      | undefined;
    if (piece?.dimensions_hint) {
      const d = piece.dimensions_hint;
      if (
        typeof d.length === "number" &&
        typeof d.width === "number" &&
        typeof d.height === "number"
      ) {
        dimensions = { width: d.length, depth: d.width, height: d.height };
      }
    }
    addStarred({
      id: asset.id,
      kind: asset.kind === "room" ? "room" : "asset",
      label: asset.label,
      glbUrl: asset.glbUrl,
      imageUrl: asset.imageUrl,
      scene: asset.scene,
      dimensions,
      starredAt: Date.now(),
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      data-no-drag="true"
      title={
        isStarred
          ? "Unstar (cross-project)"
          : "Star — survives project switches"
      }
      style={{
        width: 22,
        height: 22,
        borderRadius: 5,
        border: "none",
        background: isStarred
          ? "rgba(255, 90, 31, 0.14)"
          : "rgba(26, 26, 26, 0.06)",
        color: isStarred ? ACCENT : "rgba(26, 26, 26, 0.65)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        lineHeight: 1,
        transition: "background 0.15s ease",
      }}
    >
      {isStarred ? "★" : "☆"}
    </button>
  );
}
