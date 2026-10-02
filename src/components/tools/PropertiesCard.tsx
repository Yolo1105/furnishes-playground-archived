"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useStore } from "@studio/store";
import {
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  UnlockIcon,
  TrashIcon,
  ChevronDownIcon,
} from "@studio/icons";
import {
  PANEL_MATERIALS,
  resolveItemMaterial,
} from "@studio/catalog/panel-materials";
import { isDraftCadSubject } from "@studio/cad/draftRoom";

/**
 * Properties — floating card on the right edge of the viewport.
 * Mounts when an item is selected (selectedId in furniture-slice
 * is non-null), unmounts when nothing is selected.
 *
 * The card sits below the Reference card (which lives at top:14
 * right:14) at top:268 right:14, mirroring the left-side card
 * stack pattern (TopProjectCard → ToolsCard).
 *
 * What it shows:
 *   • Display name + category + close button (clears selection)
 *   • Live world-space position (X, Z) computed from the item's
 *     mesh bounding box centroid; updates when state recomputes
 *   • Footprint dimensions (W × D) and height (H), pulled from
 *     the catalog/classifier values stored on the slice
 *   • Item color swatch (the same color the 2D plan uses)
 *   • Visibility toggle (eye icon) — same action as Inventory's
 *     row toggle, exposed here for convenience while the user
 *     has an item selected
 *   • Delete button — flips placed:false, also clears selection
 *
 * Why mount as a separate floating card rather than expanding
 * the Inventory row inline? Because users selecting via 3D click
 * shouldn't have to scroll the Inventory list to find the item
 * they just clicked. The Properties card always sits at the same
 * place regardless of where the selection came from.
 *
 * Mounted under both selection paths: clicking a 3D mesh sets
 * selectedId via the Apartment onClick handler, and clicking
 * an Inventory row sets selectedId via the Inventory click
 * handler. The card subscribes to selectedId and shows whichever
 * is current.
 */

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";
const UI_FONT = "var(--font-app), system-ui, sans-serif";

export function PropertiesCard() {
  const selectedId = useStore((s) => s.selectedId);
  const item = useStore((s) =>
    s.selectedId ? s.furniture.find((f) => f.id === s.selectedId) : null,
  );
  const selectFurniture = useStore((s) => s.selectFurniture);
  const toggleVisibility = useStore((s) => s.toggleFurnitureVisibility);
  const removeFurniture = useStore((s) => s.removeFurniture);
  const toggleLock = useStore((s) => s.toggleFurnitureLock);
  const stackRank = useStore(
    (s) => s.cardStackRank["tool-properties"] ?? 0,
  );
  const bringCardToFront = useStore((s) => s.bringCardToFront);
  // The currently-selected item's locked state. We re-read from the
  // freshest furniture array so an external lock change (e.g. via
  // chat-slice action surface in the future) reflects immediately.
  const isLocked = !!item?.locked;

  // World-space centroid of the selected item's meshes — recomputed
  // when selection or furniture array changes. Returns null if no
  // selection or if the item has no mesh references (defensive —
  // shouldn't happen for items seeded from the GLB but might for
  // catalog-added items that weren't matched to nodes).
  const position = useMemo(() => {
    if (!item || item.meshes.length === 0) return null;
    const box = new THREE.Box3();
    for (const mesh of item.meshes) {
      box.expandByObject(mesh);
    }
    if (box.isEmpty()) return null;
    const center = new THREE.Vector3();
    box.getCenter(center);
    return { x: center.x, y: center.y, z: center.z };
  }, [item]);

  // v0.40.42: Properties now anchors BELOW the Generations card on
  // the right side (or below Reference when Generations isn't open).
  // Previously it sat to the LEFT of Reference, which the user
  // pointed out is counter-intuitive — selection metadata feels like
  // it should live next to the other selection-related cards
  // (Reference shows the same scene; Generations shows the same
  // pieces). The right column is now: Reference → Generations →
  // Properties. We measure whichever is visible at the bottom of
  // the column and pin Properties below it.
  const PROPS_WIDTH = 240;
  const GAP = 8;
  const [cardPos, setCardPos] = useState<{ top: number; right: number }>({
    top: 14 + 300 + GAP, // below default Reference (420×300)
    right: 14,
  });
  useEffect(() => {
    // v0.40.44: full implementation of the user's stated overflow
    // rule — "if anything that should show on right does not have
    // more space, just move to left a little but still right side,
    // never go over down or overlap." Three failure modes the
    // earlier passes mishandled:
    //
    //   1. Stacking below worked on tall screens but on shorter
    //      ones (laptop 13", browser zoom 110%+) the card ran past
    //      the chat dock or got clipped.
    //   2. The previous sideways branch (v0.40.27..v0.40.42 first
    //      pass) triggered too eagerly because the height GUESS was
    //      smaller than reality, putting Properties on the left
    //      half on screens that DID have room. The user saw it
    //      planted next to Reference instead of below Generations.
    //   3. v0.40.42 second pass dropped the sideways branch entirely
    //      to fix #2, but that broke the "never go over down" half
    //      of the user's rule on shorter screens.
    //
    // The fix: keep stacking-below as the default, only trigger the
    // sideways shift when the card's REAL measured height (not a
    // guess) plus the GAP plus a chat-dock buffer would actually
    // cross window.innerHeight. We also cap the leftward shift at
    // window.innerWidth/2 so the card never crosses the midline —
    // if even half the screen isn't enough room, we let it clip and
    // rely on the inner overflow:auto to scroll.
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let selfHeight = 280; // initial guess; replaced after first measure

    const settle = () => {
      const gen = document.querySelector(
        '[data-card-id="tool-generations"]',
      ) as HTMLElement | null;
      const ref = document.querySelector(
        '[data-card-id="tool-reference"]',
      ) as HTMLElement | null;
      const anchor = gen ?? ref;
      if (!anchor) return;
      const measure = () => {
        // Measure ourselves if we've rendered at least once. The
        // first paint uses the guess; subsequent layouts use the
        // real height.
        const self = document.querySelector(
          '[data-card-id="tool-properties"]',
        ) as HTMLElement | null;
        if (self)
          selfHeight = self.getBoundingClientRect().height || selfHeight;

        const r = anchor.getBoundingClientRect();
        const proposedTop = r.bottom + GAP;
        // Chat dock + 14px breathing room.
        const FOOTER_BUFFER = 100;
        const wouldOverflow =
          proposedTop + selfHeight > window.innerHeight - FOOTER_BUFFER;

        if (wouldOverflow) {
          // Side shift: place the card to the LEFT of the anchor,
          // top-aligned with the anchor. The right-offset is
          // computed so the card's right edge sits GAP pixels left
          // of the anchor's left edge. Capped at window.innerWidth/2
          // so we never cross the midline.
          const desiredRight = window.innerWidth - r.left + GAP;
          const midlineCap = Math.round(window.innerWidth / 2) + 14;
          setCardPos({
            top: r.top,
            right: Math.min(desiredRight, midlineCap),
          });
        } else {
          setCardPos({
            top: proposedTop,
            right: Math.max(14, window.innerWidth - r.right),
          });
        }
      };
      measure();
      ro?.disconnect();
      ro = new ResizeObserver(measure);
      ro.observe(anchor);
    };

    raf = requestAnimationFrame(settle);
    const onResize = () => settle();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [selectedId]);

  if (!selectedId || !item) return null;

  return (
    <div
      data-card-id="tool-properties"
      className="glass"
      onPointerDownCapture={() => bringCardToFront("tool-properties")}
      style={{
        position: "fixed",
        top: cardPos.top,
        right: cardPos.right,
        width: PROPS_WIDTH,
        zIndex: 4 + stackRank,
        padding: "14px 14px 12px",
        borderRadius: 14,
        fontFamily: UI_FONT,
        color: INK,
        // Subtle entrance — slide in from the right edge so the
        // panel feels connected to the action that summoned it.
        animation: "properties-card-in 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
        // v0.40.42: smooth recomputed-anchor moves (e.g., Generations
        // expands and pushes Properties down).
        transition: "top 0.18s ease, right 0.18s ease",
        // v0.40.44: never run off the bottom. The placement effect
        // tries to avoid this by shifting sideways, but on extreme
        // resolutions even the shifted position can be too tall.
        // Cap the card height to (viewport - top - chatDockBuffer)
        // and let the body scroll inside.
        maxHeight: `calc(100vh - ${cardPos.top + 100}px)`,
        overflowY: "auto",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              // v0.40.42: drop from 13 → 12 to match the Reference,
              // Generations, and Inventory card titles. Previously
              // PropertiesCard's 13px header read as visually heavier
              // than its peers when stacked alongside them.
              fontSize: 12,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={item.label}
          >
            {item.label}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "rgba(26, 26, 26, 0.5)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginTop: 2,
            }}
          >
            {item.category}
          </div>
        </div>
        <button
          type="button"
          onClick={() => selectFurniture(null)}
          aria-label="Close"
          style={{
            border: "none",
            background: "rgba(26, 26, 26, 0.06)",
            color: INK,
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            cursor: "pointer",
            flexShrink: 0,
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(26, 26, 26, 0.12)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(26, 26, 26, 0.06)";
          }}
        >
          <CloseIcon size={10} />
        </button>
      </div>

      {/* Material textures + dimensions */}
      <div
        style={{
          marginBottom: 10,
          paddingTop: 10,
          borderTop: "1px solid rgba(26, 26, 26, 0.08)",
        }}
      >
        <MaterialPickerRow
          itemId={item.id}
          color={item.color}
          meta={item.meta}
          allowPicker={
            isDraftCadSubject(item) ||
            typeof item.meta?.materialId === "string" ||
            !(item.meta as { glbUrl?: string } | undefined)?.glbUrl
          }
        />
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "rgba(26, 26, 26, 0.55)",
            letterSpacing: "0.02em",
            marginTop: 8,
          }}
        >
          <div>
            <span style={{ color: INK, fontWeight: 600 }}>
              {item.width.toFixed(2)}
            </span>{" "}
            ×{" "}
            <span style={{ color: INK, fontWeight: 600 }}>
              {item.depth.toFixed(2)}
            </span>{" "}
            ×{" "}
            <span style={{ color: INK, fontWeight: 600 }}>
              {item.height.toFixed(2)}
            </span>{" "}
            m
          </div>
          <div style={{ fontSize: 9, marginTop: 2, opacity: 0.7 }}>
            W × D × H
          </div>
        </div>
      </div>

      {/* Position row */}
      {position && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "rgba(26, 26, 26, 0.55)",
            letterSpacing: "0.02em",
            marginBottom: 12,
            paddingTop: 10,
            borderTop: "1px solid rgba(26, 26, 26, 0.08)",
            fontFamily: "'Inter', monospace",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>x</span>
            <span style={{ color: INK, fontWeight: 600 }}>
              {position.x.toFixed(2)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>y</span>
            <span style={{ color: INK, fontWeight: 600 }}>
              {position.y.toFixed(2)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>z</span>
            <span style={{ color: INK, fontWeight: 600 }}>
              {position.z.toFixed(2)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 4,
              paddingTop: 4,
              borderTop: "1px dashed rgba(26, 26, 26, 0.08)",
            }}
            title="Y rotation in degrees — drag the orange ring to change"
          >
            <span>rot</span>
            <span style={{ color: INK, fontWeight: 600 }}>
              {Math.round(item.rotation)}°
            </span>
          </div>
        </div>
      )}

      {/* v0.40.29: Refine button removed — user found it unhelpful.
          Generated pieces are already produced at the user's chosen
          quality tier (Creative Mode → Hunyuan3D). Re-running them
          through a different tier didn't reliably improve results,
          and the button took up valuable vertical space on the
          properties card. */}

      {/* v0.40.31: Regenerate Mesh button — appears ONLY when the
          selected piece is a generated piece (source room-director)
          but its mesh is missing (typical after fal.ai partial
          failure during Room Layout generation). Lets the user
          self-heal placeholder boxes one piece at a time. Hidden
          on pieces that already have a glb_url. */}
      {(() => {
        const m = item.meta as { source?: string; glbUrl?: string } | undefined;
        if (m?.source !== "room-director") return null;
        if (m?.glbUrl && m.glbUrl.length > 0) return null;
        return (
          <RegenerateMeshButton itemId={item.id} pieceLabel={item.label} />
        );
      })()}

      {/* v0.40.31: star/unstar this piece. Persists across project
          switches via localStorage so the user can pull this piece
          into ANY future scene.
          v0.40.32: catalog items can also be starred now (the user
          asked for this; the original "catalog is already re-addable
          from the Catalog UI" rationale was true but didn't help
          when they wanted a personal cross-project favorites list
          that mixes generated pieces and curated items). */}
      <StarPieceButton itemId={item.id} pieceLabel={item.label} />

      {/* Action row — visibility + delete */}
      <div
        style={{
          display: "flex",
          gap: 6,
          paddingTop: 10,
          borderTop: "1px solid rgba(26, 26, 26, 0.08)",
        }}
      >
        <button
          type="button"
          onClick={() => toggleVisibility(item.id)}
          title={item.visible ? "Hide in scene" : "Show in scene"}
          style={{
            flex: 1,
            border: "none",
            background: "rgba(26, 26, 26, 0.06)",
            color: INK,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "7px 10px",
            borderRadius: 7,
            fontFamily: UI_FONT,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(26, 26, 26, 0.12)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(26, 26, 26, 0.06)";
          }}
        >
          {item.visible ? <EyeIcon size={12} /> : <EyeOffIcon size={12} />}
          {item.visible ? "Visible" : "Hidden"}
        </button>
        <button
          type="button"
          onClick={() => toggleLock(item.id)}
          title={
            isLocked
              ? "Unlock — AI arrangement runs may move this item"
              : "Lock position — AI arrangement runs will leave this item alone"
          }
          style={{
            border: "none",
            background: isLocked
              ? "rgba(255, 90, 31, 0.1)"
              : "rgba(26, 26, 26, 0.06)",
            color: isLocked ? ACCENT : INK,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "7px 10px",
            borderRadius: 7,
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = isLocked
              ? "rgba(255, 90, 31, 0.18)"
              : "rgba(26, 26, 26, 0.12)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = isLocked
              ? "rgba(255, 90, 31, 0.1)"
              : "rgba(26, 26, 26, 0.06)";
          }}
        >
          {isLocked ? <LockIcon size={12} /> : <UnlockIcon size={12} />}
        </button>
        <button
          type="button"
          onClick={() => removeFurniture(item.id)}
          title="Remove from room (sends to Catalog)"
          style={{
            border: "none",
            background: "rgba(255, 90, 31, 0.1)",
            color: ACCENT,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "7px 10px",
            borderRadius: 7,
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(255, 90, 31, 0.18)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(255, 90, 31, 0.1)";
          }}
        >
          <TrashIcon size={12} />
        </button>
      </div>
    </div>
  );
}

/**
 * Material texture picker — swatches for wood / paint finishes.
 * Writes color + materialId onto the selected piece so 3D updates.
 */
function MaterialPickerRow({
  itemId,
  color,
  meta,
  allowPicker,
}: {
  itemId: string;
  color: string;
  meta?: Record<string, unknown>;
  allowPicker: boolean;
}) {
  const setFurnitureMaterial = useStore((s) => s.setFurnitureMaterial);
  const current = resolveItemMaterial({ color, meta });
  const [open, setOpen] = useState(false);

  if (!allowPicker) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden
          title="Color"
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: color,
            border: "1px solid rgba(26, 26, 26, 0.1)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(26, 26, 26, 0.55)",
            fontFamily: UI_FONT,
          }}
        >
          Material
        </span>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Click to change material texture"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          border: open
            ? "1px solid rgba(255, 90, 31, 0.35)"
            : "1px solid rgba(124, 80, 50, 0.16)",
          background: open
            ? "rgba(255, 90, 31, 0.06)"
            : "rgba(255, 250, 244, 0.55)",
          borderRadius: 8,
          padding: "7px 8px",
          cursor: "pointer",
          fontFamily: UI_FONT,
          textAlign: "left",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: current.color,
            border: "1px solid rgba(26, 26, 26, 0.12)",
            flexShrink: 0,
            boxShadow:
              current.finish === "wood"
                ? "inset 0 0 0 1px rgba(255,255,255,0.25)"
                : undefined,
          }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 600,
              color: INK,
            }}
          >
            {current.label}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 9,
              fontWeight: 500,
              color: ACCENT,
              marginTop: 1,
            }}
          >
            {open ? "Pick a texture" : "Click to change material"}
          </span>
        </span>
        <ChevronDownIcon size={11} rotated={open} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Material textures"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 6,
            marginTop: 8,
            padding: 6,
            borderRadius: 8,
            background: "rgba(255, 250, 244, 0.65)",
            border: "1px solid rgba(124, 80, 50, 0.12)",
          }}
        >
          {PANEL_MATERIALS.map((m) => {
            const active = m.id === current.id;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={active}
                title={m.label}
                onClick={() => {
                  setFurnitureMaterial(itemId, m.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: 4,
                  border: active
                    ? `1.5px solid ${ACCENT}`
                    : "1px solid rgba(26, 26, 26, 0.08)",
                  borderRadius: 6,
                  background: active
                    ? "rgba(255, 90, 31, 0.08)"
                    : "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                  fontFamily: UI_FONT,
                }}
              >
                <span
                  style={{
                    width: "100%",
                    aspectRatio: "1",
                    borderRadius: 4,
                    background: m.color,
                    border: "1px solid rgba(26, 26, 26, 0.1)",
                    backgroundImage:
                      m.finish === "wood"
                        ? `linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.08) 50%, transparent 100%)`
                        : undefined,
                  }}
                />
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 600,
                    color: active ? ACCENT : "rgba(26, 26, 26, 0.65)",
                    textAlign: "center",
                    lineHeight: 1.2,
                  }}
                >
                  {m.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * RegenerateMeshButton — v0.40.31.
 *
 * Renders only when the selected piece is a generated piece WITHOUT
 * a glb_url (placeholder box state). Posts to /api/generate-asset
 * with the piece's description, then patches meta.glbUrl on success
 * so the placeholder swaps to the real mesh in-place.
 *
 * Why a separate component: encapsulates loading + error state so
 * the parent PropertiesCard stays focused on display. Mirrors the
 * structure of the (now-removed) v0.40.23 RefineButton — but
 * targets a different problem: this is "the mesh never landed,"
 * not "swap to a higher quality."
 */
function RegenerateMeshButton({
  itemId,
  pieceLabel,
}: {
  itemId: string;
  pieceLabel: string;
}) {
  const [working, setWorking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const patchItemMeta = useStore((s) => s.patchItemMeta);

  const regenerate = async () => {
    if (working) return;
    setWorking(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/generate-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: pieceLabel, tier: "preview" }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        glb_url?: string;
        image_url?: string;
      };
      if (!data.glb_url) throw new Error("No GLB URL returned");
      // Patch the item's meta so FurnitureMeshes' hasGlb branch
      // flips on and the real mesh renders. Also persist image_url
      // so the Reference card can show the 2D image once the user
      // selects this piece.
      patchItemMeta?.(itemId, {
        glbUrl: data.glb_url,
        imageUrl: data.image_url,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={regenerate}
        disabled={working}
        title="Regenerate this piece's 3D mesh — its previous attempt failed."
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid rgba(255, 90, 31, 0.35)",
          background: working
            ? "rgba(255, 90, 31, 0.18)"
            : hovered
              ? "rgba(255, 90, 31, 0.14)"
              : "rgba(255, 90, 31, 0.08)",
          color: ACCENT,
          fontFamily: UI_FONT,
          fontSize: 11,
          fontWeight: 600,
          cursor: working ? "wait" : "pointer",
          transition: "background 0.15s ease",
          letterSpacing: "-0.005em",
        }}
      >
        {working ? "Regenerating mesh… ~10s" : "↻ Regenerate mesh"}
      </button>
      {errorMsg && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            color: "rgba(180, 30, 0, 0.85)",
            fontFamily: UI_FONT,
          }}
        >
          {errorMsg}
        </div>
      )}
    </div>
  );
}

/**
 * StarPieceButton — v0.40.31.
 *
 * Toggles whether the selected generated piece is in the user's
 * cross-project starred collection. Reads + writes via the
 * starred-slice (which persists to localStorage). The button shows
 * a filled star when the piece is starred, outlined otherwise.
 *
 * Why a separate component: avoids re-rendering the whole
 * PropertiesCard on every star-state change. The component
 * subscribes to JUST the starred-state for THIS item id.
 */
function StarPieceButton({
  itemId,
  pieceLabel,
}: {
  itemId: string;
  pieceLabel: string;
}) {
  const isStarred = useStore((s) => s.isStarred(itemId));
  const addStarred = useStore((s) => s.addStarred);
  const removeStarred = useStore((s) => s.removeStarred);
  const item = useStore((s) =>
    (s.furniture ?? []).find((f) => f.id === itemId),
  );
  const [hovered, setHovered] = useState(false);

  const toggle = () => {
    if (isStarred) {
      removeStarred(itemId);
      return;
    }
    if (!item) return;
    const meta = item.meta as
      | { glbUrl?: string; imageUrl?: string; source?: string }
      | undefined;
    // v0.40.32: branch on source — catalog items are stored as
    // kind: "catalog" with their stable catalog id (the apartamento
    // node-name list maps back to placeItems()), generated items as
    // kind: "asset" with their fal.ai GLB URL.
    if (meta?.source !== "room-director") {
      // Catalog (or any non-generated) piece — use the item id as
      // the catalogId. The CatalogModal places items by this id
      // via placeItems().
      addStarred({
        id: itemId,
        kind: "catalog",
        label: pieceLabel,
        catalogId: itemId,
        dimensions: {
          width: item.width,
          depth: item.depth,
          height: item.height,
        },
        starredAt: Date.now(),
      });
      return;
    }
    addStarred({
      id: itemId,
      kind: "asset",
      label: pieceLabel,
      glbUrl: meta?.glbUrl,
      imageUrl: meta?.imageUrl,
      dimensions: {
        width: item.width,
        depth: item.depth,
        height: item.height,
      },
      starredAt: Date.now(),
    });
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={toggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={
          isStarred
            ? "Remove from starred (cross-project favorites)"
            : "Add to starred — survives project switches"
        }
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 8,
          border: isStarred
            ? "1px solid rgba(255, 90, 31, 0.35)"
            : "1px solid rgba(124, 80, 50, 0.18)",
          background: isStarred
            ? "rgba(255, 90, 31, 0.12)"
            : hovered
              ? "rgba(26, 26, 26, 0.08)"
              : "rgba(26, 26, 26, 0.04)",
          color: isStarred ? ACCENT : INK,
          fontFamily: UI_FONT,
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          transition: "background 0.15s ease, border-color 0.15s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>
          {isStarred ? "★" : "☆"}
        </span>
        {isStarred ? "Starred" : "Star this piece"}
      </button>
    </div>
  );
}
