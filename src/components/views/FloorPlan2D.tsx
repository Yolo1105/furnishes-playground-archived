"use client";

import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useStore } from "@studio/store";
import { wallFragments } from "@studio/floorplan/symbols";
import { RoomDirectorCadPlan } from "./RoomDirectorCadPlan";
import { CadWorkplane } from "./CadWorkplane";
import {
  isSnapPanel,
  magneticSnapPanelView,
  magneticSnapXZ,
  resolveStudioY,
  snapNeighborsFor,
} from "@studio/collision/magneticSnap";

/**
 * Top-down 2D floor plan, ported from the zip's left-bottom panel.
 *
 * Two layers, both sharing one world coordinate frame:
 *
 *   1. Walls — extracted at GLB-load time by slicing the apartment's
 *      structure mesh (`1_*` and `3_*` nodes) horizontally at chest
 *      height. The slicer reads each vertex through `mesh.matrixWorld`,
 *      so segments come out directly in world space — same coord
 *      frame as everything else mesh-derived. Stored on the slice
 *      after `Apartment` extracts them.
 *
 *   2. Furniture footprints — for each placed-and-visible item we
 *      read its mesh refs' aggregate `Box3` (also via `matrixWorld`).
 *      The X/Z extent of that box becomes the rectangle on the plan.
 *
 * Because both layers come from the same `matrixWorld` reads, they
 * end up in the same coordinate frame regardless of the GLB's
 * internal transform stack (Sketchfab wrapper + .fbx wrapper +
 * RootNode + our normalize). No coordinate-space gymnastics needed
 * inside this component.
 *
 * Selection is bidirectional with Inventory + the 3D wireframe:
 * `selectFurniture(id)` is the single source of truth, and clicking
 * any of the three surfaces updates that field.
 *
 * NOTE on door visualization: the floor plan deliberately does NOT
 * draw door swing arcs. Earlier versions ran a runtime opening-
 * detector (`detectOpenings`) and drew an arc for each detected
 * gap, but the detector produces many false positives in a real
 * apartment mesh — every pair of non-collinear wall endpoints in
 * the cross-section can land in the door-width range, even ones
 * that aren't actually doors. The result was a screen full of
 * spurious arcs. We just show clean walls + furniture; the user
 * can identify door openings visually from gaps in the wall lines.
 *
 * `compact` shrinks padding + omits item labels — used inside the
 * small Reference card.
 */

interface FloorPlan2DProps {
  compact?: boolean;
}

const PADDING = 0.8;
const ITEM_STROKE = 0.04;
const SELECTED_STROKE = 0.08;
const LABEL_SIZE = 0.18;
// Wall styling matches the zip's FloorPlan2D — neutral gray at 60%
// opacity reads as architectural drawing rather than as a hard
// outline. Note this is intentionally NOT the brand brown; floor
// plans look more like blueprints when walls are quietly gray.
const WALL_COLOR = "#888";
const WALL_STROKE = 0.08;
const ACCENT = "#FF5A1F";

interface Footprint {
  id: string;
  label: string;
  /** World-space center X */
  x: number;
  /** World-space center Z */
  z: number;
  width: number;
  depth: number;
  /** "circle" / "thin-rect" / "l-shape" / "rect", classified at
   *  seed time. Drives which SVG primitive renders below. */
  shape: string;
  /** Per-item palette color (deterministic from id). */
  color: string;
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
}

export function FloorPlan2D({ compact = false }: FloorPlan2DProps) {
  const apartmentRoot = useStore((s) => s.apartmentRoot);
  const walls = useStore((s) => s.walls);
  const openings = useStore((s) => s.openings);
  const furniture = useStore((s) => s.furniture);
  const selectedId = useStore((s) => s.selectedId);
  const selectFurniture = useStore((s) => s.selectFurniture);
  // v0.40.42: 2D drag → bidirectional sync with 3D. Previously the
  // floor plan was read-only — clicking selected, but the user
  // couldn't reposition pieces from the 2D view. Now pointerdown on
  // a footprint starts a drag; pointermove updates `setItemTransform`
  // continuously; pointerup commits + releases. The 3D scene
  // re-renders automatically because both surfaces subscribe to the
  // same store. Locked items skip the drag (selection still works).
  const setItemTransform = useStore((s) => s.setItemTransform);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    // Item's center in world coords at drag start. We track the
    // delta from this anchor as the pointer moves, so the piece
    // doesn't jump if the user grabs it off-center.
    startItemX: number;
    startItemZ: number;
    // Pointer position in WORLD space at drag start (mapped from
    // screen via the SVG's getScreenCTM). Same frame as startItemX/Z.
    startPointerX: number;
    startPointerZ: number;
  } | null>(null);
  const [, setDragTick] = useState(0);
  // v0.40.33: sceneSource discriminator. When "room-director" we
  // route to the new CAD-style rendering (poché walls, door arcs,
  // dimension chains, etc.). When "viewer" — the preconfigured
  // apartamento.glb — we keep the original rendering bit-for-bit
  // because that scene's organic walls don't fit the rectangular
  // CAD assumptions cleanly.
  const sceneSource = useStore((s) => s.sceneSource);
  // roomMeta — the explicit room shell from a generation. When walls
  // is empty (auto-rectangle case) AND there's no apartmentRoot to
  // derive bounds from (room-director scenes), we still need to know
  // the room's outer rectangle so the floor plan has anything to draw.
  // Without this, a freshly-generated room-director scene shows the
  // empty placeholder forever — the previous bounds derivation only
  // looked at walls + footprint meshes, neither of which exist when
  // the room is rectangle + the pieces are placeholder boxes (no
  // attached mesh refs yet).
  const roomMeta = useStore((s) => s.roomMeta);
  const blankScene = useStore((s) =>
    Boolean(s.projects.find((p) => p.id === s.currentProjectId)?.blankScene),
  );
  // Asset generations — used as a fallback "first-generation" preview
  // when no scene bounds exist yet.
  const assetGenerations = useStore(
    (s) =>
      (s as unknown as { assetGenerations?: unknown[] }).assetGenerations ?? [],
  );
  // Waypoint mode + custom waypoints — when mode is on, clicks on
  // empty SVG background drop a pin at that world (X, Z). Pins are
  // rendered below the furniture so click-to-select still works.
  const waypointMode = useStore((s) => s.waypointMode);
  const customWaypoints = useStore((s) => s.customWaypoints);
  const addWaypoint = useStore((s) => s.addWaypoint);
  const removeWaypoint = useStore((s) => s.removeWaypoint);

  // Tour state — when active, render an animated marker that walks
  // along `tourPath` at the current `tourProgress` fraction. The
  // marker is the 2D companion to the in-canvas TourCamera so users
  // can track tour position on the floor plan while the camera
  // animates inside the apartment. `tourPath` may differ from
  // `customWaypoints` (the auto-path generator falls back to
  // furniture sweep if no waypoints are placed) — we follow the
  // actual tour path, not the waypoint visual.
  const tourActive = useStore((s) => s.tourActive);
  const tourPath = useStore((s) => s.tourPath);
  const tourProgress = useStore((s) => s.tourProgress);

  // Derive each placed item's world-space footprint from its mesh
  // refs. Recomputed when furniture changes (placement / removal /
  // visibility flips). The matrixWorld values these reads depend on
  // were last refreshed by `extractWalls` during seed, which called
  // `root.updateMatrixWorld(true)`. Subsequent R3F frames keep them
  // Footprints. Two paths:
  //
  //   A. Mesh-derived (existing). For viewer-source scenes the
  //      apartamento.glb is loaded, every PlacedItem.meshes[] has
  //      real Three.js Object3Ds, and we compute world-space bounding
  //      boxes from those. Most accurate — picks up the actual mesh
  //      extents after any user transform.
  //
  //   B. Transform-derived (room-director / placeholder pieces). When
  //      a piece has no attached meshes (Room Layout mode skips mesh
  //      generation, so pieces ship as placeholder boxes), we fall
  //      back to the PlacedItem's stored x/z/width/depth/rotation.
  //      That gives us a plan-view footprint without needing GLBs.
  //
  // The choice is per-item: if `meshes.length > 0`, use path A;
  // otherwise path B. This keeps both modes working in one component.
  const footprints: Footprint[] = useMemo(() => {
    const out: Footprint[] = [];
    for (const item of furniture) {
      if (!item.placed || !item.visible) continue;

      if (item.meshes.length > 0) {
        // Path A: mesh-derived bounds.
        if (apartmentRoot) apartmentRoot.updateMatrixWorld(true);
        const box = new THREE.Box3();
        for (const m of item.meshes) box.expandByObject(m);
        if (box.isEmpty()) continue;

        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        // Skip degenerate footprints (e.g. a 0-width mesh).
        if (size.x < 0.02 && size.z < 0.02) continue;

        out.push({
          id: item.id,
          label: item.label,
          x: center.x,
          z: center.z,
          width: Math.max(size.x, 0.05),
          depth: Math.max(size.z, 0.05),
          shape: item.shape,
          color: item.color,
        });
      } else {
        // Path B: transform-derived. The PlacedItem's x/z is the
        // piece's center, width/depth are its plan-view extents
        // (in meters, axis-aligned in piece local space). Rotation
        // would matter for non-square pieces; for v1 the floor-plan
        // SVG renders rectangles axis-aligned in WORLD space, which
        // means a rotated piece appears as a slightly-larger
        // bounding rect. Acceptable for a placeholder visualization.
        if (item.width < 0.02 && item.depth < 0.02) continue;
        out.push({
          id: item.id,
          label: item.label,
          x: item.x,
          z: item.z,
          width: Math.max(item.width, 0.05),
          depth: Math.max(item.depth, 0.05),
          shape: item.shape,
          color: item.color,
        });
      }
    }
    return out;
  }, [furniture, apartmentRoot]);

  // ViewBox bounds: union of walls', furniture's, and roomMeta's
  // bounding boxes. roomMeta is the explicit room shell from a
  // room-director generation — when walls is empty (auto-rectangle
  // case) it's the only source of room extents. Without consulting
  // it, a freshly-generated layout-only scene would show "no plan"
  // forever because walls would be empty and there were no meshes
  // to derive footprints from.
  const bounds: Bounds | null = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const w of walls) {
      minX = Math.min(minX, w.x1, w.x2);
      maxX = Math.max(maxX, w.x1, w.x2);
      minZ = Math.min(minZ, w.z1, w.z2);
      maxZ = Math.max(maxZ, w.z1, w.z2);
    }
    for (const f of footprints) {
      minX = Math.min(minX, f.x - f.width / 2);
      maxX = Math.max(maxX, f.x + f.width / 2);
      minZ = Math.min(minZ, f.z - f.depth / 2);
      maxZ = Math.max(maxZ, f.z + f.depth / 2);
    }
    // RoomMeta fallback: explicit room extents from a generation.
    if (roomMeta) {
      minX = Math.min(minX, roomMeta.minX);
      maxX = Math.max(maxX, roomMeta.maxX);
      minZ = Math.min(minZ, roomMeta.minZ);
      maxZ = Math.max(maxZ, roomMeta.maxZ);
    }

    if (!isFinite(minX)) return null;
    return {
      minX,
      maxX,
      minZ,
      maxZ,
      width: maxX - minX,
      depth: maxZ - minZ,
    };
  }, [walls, footprints, roomMeta]);

  // Blank project: always the single-panel CAD workplane (ortho
  // dims for one board). Never RoomDirectorCadPlan — that draws a
  // multi-wall room poche and is what made Reference look like a
  // 4×3 m framed "Panel" assembly.
  if (blankScene) {
    return <CadWorkplane compact={compact} />;
  }

  // When there's no floor plan to render (no walls, no placed
  // furniture footprints), we have two cases:
  //
  //   1. A blank canvas where the user just generated their first
  //      piece — show the 2D product-shot image from the most
  //      recent asset generation. This matches the user's mental
  //      model: "I generated something, it should appear in the
  //      reference card." Without this fallback the user saw
  //      "Loading plan…" forever even though the piece had landed.
  //
  //   2. Truly nothing — show "No plan yet" instead of "Loading
  //      plan…" which was misleading wording (nothing was actually
  //      loading).
  // v0.40.33: room-director rendering path. When the active scene
  // came from a generation (orchestrator emitted roomMeta + openings
  // + pieces in their final positions), render the CAD-style plan
  // instead of the schematic top-down. This is what lets the user's
  // generated rooms look like a real architectural drawing — poché
  // walls, door arcs, window break-lines, dimension chains — rather
  // than the previous "rectangle with squares inside" rendering.
  //
  // The viewer-source path (the preconfigured apartamento.glb) is
  // untouched: it falls through to the existing block below because
  // sceneSource === "viewer" makes this branch a no-op.
  //
  // We require roomMeta to be present. Without it we can't determine
  // the room rectangle (walls alone might have gaps from openings,
  // and footprints don't carry boundaries). roomMeta is set by
  // applyScene the moment the orchestrator's final scene event lands,
  // so by the time this component re-renders for a new generation
  // it's already there.
  if (sceneSource === "room-director" && roomMeta) {
    return (
      <RoomDirectorCadPlan
        roomMeta={roomMeta}
        openings={openings}
        footprints={footprints}
        selectedId={selectedId}
        onSelect={(id) => selectFurniture(id)}
        compact={compact}
      />
    );
  }

  if (!bounds) {
    // Type-safe pull of the most recent asset's preview image. The
    // selector returns `unknown[]` to avoid coupling FloorPlan2D to
    // the AssetGeneration type; we narrow inline.
    const recentAsset = assetGenerations[0] as
      | { label?: string; imageUrl?: string }
      | undefined;
    const recentImageUrl = recentAsset?.imageUrl;
    if (recentImageUrl) {
      return (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {}
          <img
            src={recentImageUrl}
            alt={recentAsset?.label ?? "Generated piece"}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 4,
              userSelect: "none",
            }}
          />
        </div>
      );
    }
    // Empty non-demo project: CAD workplane (grid + rulers + axes).
    // Viewer / Demo apartment keeps a quiet loading state until walls
    // seed — never swap in the CAD page over the hardcoded GLB plan.
    if (sceneSource === "viewer") {
      return (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-app), system-ui, sans-serif",
            fontSize: 11,
            color: "rgba(26, 26, 26, 0.4)",
          }}
        >
          Loading plan…
        </div>
      );
    }
    return <CadWorkplane compact={compact} />;
  }

  const pad = compact ? PADDING * 0.6 : PADDING;
  const vbX = bounds.minX - pad;
  const vbZ = bounds.minZ - pad;
  const vbW = bounds.width + pad * 2;
  const vbH = bounds.depth + pad * 2;

  return (
    <svg
      viewBox={`${vbX} ${vbZ} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      onClick={(e) => {
        // v0.40.48: in waypoint mode, the previous gate
        // `e.target !== e.currentTarget` blocked clicks that landed
        // on any svg child (the floor rect, walls, dimension labels,
        // even the compact-view annotations group). On a freshly
        // generated room with a typical furniture density and the
        // new compact annotations, almost every click hit a child
        // first. The user reported "can't add tour waypoint on the
        // newly-generated 2D reference" — that was this gate. In
        // waypoint mode, accept the click regardless of which child
        // was hit (footprints already stopPropagation, so they
        // never reach here). In normal mode, keep the bg-only gate
        // so clicking a piece doesn't trigger deselect.
        const svgEl = e.currentTarget as SVGSVGElement;
        if (waypointMode) {
          const pt = svgEl.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const ctm = svgEl.getScreenCTM();
          if (ctm) {
            const { x, y } = pt.matrixTransform(ctm.inverse());
            addWaypoint({ x, z: y });
          }
          return;
        }
        if (e.target !== e.currentTarget) return;
        selectFurniture(null);
      }}
      style={{
        display: "block",
        cursor: waypointMode ? "crosshair" : "default",
      }}
    >
      {/* Walls — gray at 60% opacity, matching the zip's
          architectural-blueprint look. When the orchestrator emitted
          explicit wall segments (L-shape, U-shape rooms), we render
          those. Otherwise we synthesize a 4-wall rectangle from
          roomMeta bounds — matches GeneratedApartment's wall logic
          exactly so 2D and 3D agree on the room shape. */}
      <g opacity={0.6}>
        {(walls.length > 0
          ? walls
          : roomMeta
            ? [
                {
                  id: "auto-n",
                  x1: roomMeta.minX,
                  z1: roomMeta.maxZ,
                  x2: roomMeta.maxX,
                  z2: roomMeta.maxZ,
                  thickness: 0.15,
                },
                {
                  id: "auto-s",
                  x1: roomMeta.minX,
                  z1: roomMeta.minZ,
                  x2: roomMeta.maxX,
                  z2: roomMeta.minZ,
                  thickness: 0.15,
                },
                {
                  id: "auto-e",
                  x1: roomMeta.maxX,
                  z1: roomMeta.minZ,
                  x2: roomMeta.maxX,
                  z2: roomMeta.maxZ,
                  thickness: 0.15,
                },
                {
                  id: "auto-w",
                  x1: roomMeta.minX,
                  z1: roomMeta.minZ,
                  x2: roomMeta.minX,
                  z2: roomMeta.maxZ,
                  thickness: 0.15,
                },
              ]
            : []
        ).flatMap((w) =>
          wallFragments(w, []).map((frag, i) => (
            <line
              key={`${w.id}-${i}`}
              x1={frag.x1}
              y1={frag.z1}
              x2={frag.x2}
              y2={frag.z2}
              stroke={WALL_COLOR}
              strokeWidth={WALL_STROKE}
              strokeLinecap="round"
            />
          )),
        )}
      </g>

      {/* Furniture — three-shape branching matches the zip's
          FloorPlan2D exactly:
            • "circle"    → ellipse + center dot
            • "thin-rect" → rect with rx=0.01 (sharp corners read
                            as picture / mirror / TV)
            • else        → rect rx=0.05 + small triangle at the
                            "front" face (direction indicator)
          Per-item color comes from the deterministic palette set
          at seed time. */}
      {footprints.map((f) => {
        const isSelected = f.id === selectedId;
        const isCircle = f.shape === "circle";
        const isThinRect = f.shape === "thin-rect";

        const strokeColor = isSelected ? ACCENT : f.color;
        const sw = isSelected ? SELECTED_STROKE : ITEM_STROKE;
        const fillOpacity = isSelected ? 0.5 : 0.3;
        // Labels: show when the item is reasonably-sized. The previous
        // gating excluded labels in compact mode entirely, which made
        // the Reference card's floor plan unreadable — the user saw
        // overlapping unlabeled rectangles and asked "does this even
        // make sense?" Even compact-mode plans benefit from labels on
        // items with at least a 0.6m max-extent.
        const showLabel =
          isSelected || Math.max(f.width, f.depth) > (compact ? 0.6 : 0.4);
        const hw = f.width / 2;
        const hd = f.depth / 2;

        // v0.40.42 drag handlers. We attach to the outer <g> so any
        // child (rect, ellipse, label, indicator) is a valid drag
        // start target. Locked items short-circuit out and only
        // handle selection — same convention as the 3D drag.
        const item = furniture.find((it) => it.id === f.id);
        const isLocked = !!item?.locked;

        const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
          // Only left button (or touch). Right-click should not drag.
          if (e.button !== 0 && e.pointerType === "mouse") return;
          if (isLocked) {
            // Selection still works; no drag.
            return;
          }
          // Map screen-space pointer to world (SVG user-space) coords.
          // Same getScreenCTM trick the waypoint click uses above.
          const svgEl = (e.currentTarget.ownerSVGElement ??
            null) as SVGSVGElement | null;
          if (!svgEl) return;
          const ctm = svgEl.getScreenCTM();
          if (!ctm) return;
          const pt = svgEl.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const world = pt.matrixTransform(ctm.inverse());

          dragRef.current = {
            id: f.id,
            pointerId: e.pointerId,
            startItemX: f.x,
            startItemZ: f.z,
            startPointerX: world.x,
            // SVG y axis = world z (top-down).
            startPointerZ: world.y,
          };
          // Capture the pointer so we keep getting move events even
          // when the cursor leaves the SVG bounds during the drag.
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          // Select on grab so the wireframe in 3D follows along.
          selectFurniture(f.id);
          // Stop propagation so the SVG-background pointerdown
          // doesn't fire (which would deselect or drop a waypoint).
          e.stopPropagation();
        };

        const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
          const d = dragRef.current;
          if (!d || d.id !== f.id || d.pointerId !== e.pointerId) return;
          const svgEl = (e.currentTarget.ownerSVGElement ??
            null) as SVGSVGElement | null;
          if (!svgEl) return;
          const ctm = svgEl.getScreenCTM();
          if (!ctm) return;
          const pt = svgEl.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const world = pt.matrixTransform(ctm.inverse());
          const dx = world.x - d.startPointerX;
          const dz = world.y - d.startPointerZ;
          // Commit through setItemTransform — same code path the 3D
          // drag uses, so persistence + undo + 3D re-render happen
          // automatically. Magnetic edge snap joins nearby pieces.
          const proposed = {
            x: d.startItemX + dx,
            z: d.startItemZ + dz,
          };
          const piece = furniture.find((it) => it.id === d.id);
          let snapped: {
            x: number;
            z: number;
            studioY?: number;
          } = proposed;
          if (piece && !e.altKey) {
            const neighbors = snapNeighborsFor(furniture, d.id);
            if (isSnapPanel(piece)) {
              snapped = magneticSnapPanelView(
                piece,
                {
                  ...proposed,
                  studioY: resolveStudioY(piece),
                },
                neighbors,
                "top",
              );
            } else {
              snapped = magneticSnapXZ(piece, proposed, neighbors);
            }
          }
          setItemTransform(d.id, {
            x: snapped.x,
            z: snapped.z,
            ...(typeof snapped.studioY === "number"
              ? { studioY: snapped.studioY }
              : null),
          });
          // Force a local rerender so this footprint's <rect> follows
          // the pointer immediately on the same frame (the store
          // subscription would also rerender, but doing it locally
          // avoids a one-frame visual lag for users with many pieces).
          setDragTick((t) => t + 1);
          e.stopPropagation();
        };

        const onPointerUp = (e: React.PointerEvent<SVGGElement>) => {
          if (!dragRef.current || dragRef.current.id !== f.id) return;
          (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
          dragRef.current = null;
          e.stopPropagation();
        };

        return (
          <g
            key={f.id}
            style={{
              cursor: isLocked ? "pointer" : "grab",
              touchAction: "none",
            }}
            onClick={(e) => {
              e.stopPropagation();
              // v0.40.47: don't toggle. onPointerDown already calls
              // selectFurniture(f.id) — if we then run
              // selectFurniture(isSelected ? null : f.id) here, the
              // pointerdown will have just set isSelected=true, and
              // this click immediately deselects it. Net effect: tap
              // a piece, watch it select then instantly deselect, so
              // the Properties panel never gets to mount and the
              // selection wireframe flickers off in the same frame.
              //
              // The fix: this onClick is a no-op for left-click
              // selection (pointerdown already handled it). Keep the
              // handler so e.stopPropagation() still suppresses the
              // SVG-background click that would otherwise deselect.
              // For locked items (which short-circuit out of
              // pointerdown's drag setup before selecting), we still
              // need to toggle here.
              if (isLocked) {
                selectFurniture(isSelected ? null : f.id);
              }
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {isCircle ? (
              <ellipse
                cx={f.x}
                cy={f.z}
                rx={hw}
                ry={hd}
                fill={f.color}
                fillOpacity={fillOpacity}
                stroke={strokeColor}
                strokeWidth={sw}
              />
            ) : isThinRect ? (
              <rect
                x={f.x - hw}
                y={f.z - hd}
                width={f.width}
                height={f.depth}
                rx={0.01}
                fill={f.color}
                fillOpacity={fillOpacity}
                stroke={strokeColor}
                strokeWidth={sw}
              />
            ) : (
              <rect
                x={f.x - hw}
                y={f.z - hd}
                width={f.width}
                height={f.depth}
                rx={0.05}
                fill={f.color}
                fillOpacity={fillOpacity}
                stroke={strokeColor}
                strokeWidth={sw}
              />
            )}

            {/* Center dot for circular items — zip pattern. Helps
                tiny ellipses (vases, lamps) read as 'a thing here'
                even when their fill blends into the background. */}
            {isCircle && (
              <circle
                cx={f.x}
                cy={f.z}
                r={0.04}
                fill={isSelected ? ACCENT : f.color}
                pointerEvents="none"
              />
            )}

            {/* Direction indicator for non-circle items — small
                triangle at the top edge points to the item's
                'front' face. Architectural convention from the zip.
                Skipped for circles (no front) and for very small
                items (< 0.3m on either side) where the triangle
                would dominate the shape. */}
            {!isCircle && Math.min(f.width, f.depth) > 0.3 && (
              <polygon
                points={`${f.x},${f.z - hd + 0.03} ${f.x - 0.06},${f.z - hd + 0.12} ${f.x + 0.06},${f.z - hd + 0.12}`}
                fill={isSelected ? ACCENT : f.color}
                fillOpacity={0.7}
                pointerEvents="none"
              />
            )}

            {showLabel && (
              <text
                x={f.x}
                y={f.z + (isCircle ? hd + 0.2 : 0.05)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={LABEL_SIZE}
                fill={isSelected ? "#1A1A1A" : "rgba(26, 26, 26, 0.7)"}
                fontWeight={isSelected ? 600 : 500}
                pointerEvents="none"
                style={{
                  userSelect: "none",
                  fontFamily: "var(--font-app), system-ui, sans-serif",
                }}
              >
                {f.label.length > 14 ? `${f.label.substring(0, 13)}…` : f.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Waypoints — drawn last so they sit on top of walls + items.
          Connecting line shows the visit order; each pin is a
          numbered orange dot. Click a pin to delete it (only while
          waypoint mode is active, otherwise we'd accidentally
          remove pins on a normal click). */}
      {customWaypoints.length > 1 && (
        <polyline
          points={customWaypoints.map((w) => `${w.x},${w.z}`).join(" ")}
          fill="none"
          stroke={ACCENT}
          strokeWidth={0.04}
          strokeOpacity={0.45}
          strokeDasharray="0.12 0.08"
          pointerEvents="none"
        />
      )}
      {customWaypoints.map((wp, i) => (
        <g
          key={wp.id}
          style={{ cursor: waypointMode ? "pointer" : "default" }}
          onClick={(e) => {
            e.stopPropagation();
            // Only allow removing pins while waypoint mode is on.
            // Otherwise pins are display-only — keeps them safe
            // from being accidentally clicked when the user is
            // browsing the plan.
            if (waypointMode) removeWaypoint(wp.id);
          }}
        >
          <circle
            cx={wp.x}
            cy={wp.z}
            r={0.18}
            fill={ACCENT}
            fillOpacity={0.85}
            stroke="#fff"
            strokeWidth={0.035}
          />
          <text
            x={wp.x}
            y={wp.z}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={0.16}
            fontWeight={700}
            fill="#fff"
            pointerEvents="none"
            style={{ userSelect: "none" }}
          >
            {i + 1}
          </text>
        </g>
      ))}

      {/* Tour walk-path marker — animated orange disk that walks
          along `tourPath` at the live `tourProgress` fraction.
          Visible only while tourActive. The math mirrors what
          TourCamera does in 3D, but on the 2D plan: total path
          length, find segment by progress, lerp within segment.
          A pulsing halo ring + bold inner disk make it readable
          even when the polyline is dashed-faint underneath. */}
      {tourActive &&
        tourPath.length >= 2 &&
        (() => {
          let total = 0;
          const segLens: number[] = [];
          for (let i = 1; i < tourPath.length; i++) {
            const dx = tourPath[i].x - tourPath[i - 1].x;
            const dz = tourPath[i].z - tourPath[i - 1].z;
            const len = Math.hypot(dx, dz);
            segLens.push(len);
            total += len;
          }
          if (total <= 0) return null;
          const target = tourProgress * total;
          let acc = 0;
          let segIdx = 0;
          for (let i = 0; i < segLens.length; i++) {
            if (acc + segLens[i] >= target) {
              segIdx = i;
              break;
            }
            acc += segLens[i];
          }
          const segStart = tourPath[segIdx];
          const segEnd = tourPath[segIdx + 1];
          const segT =
            segLens[segIdx] > 0 ? (target - acc) / segLens[segIdx] : 0;
          const mx = segStart.x + (segEnd.x - segStart.x) * segT;
          const mz = segStart.z + (segEnd.z - segStart.z) * segT;
          return (
            <g pointerEvents="none">
              {/* Pulsing halo (CSS-driven for the radius/opacity). */}
              <circle
                cx={mx}
                cy={mz}
                r={0.35}
                fill={ACCENT}
                fillOpacity={0.18}
                className="walk-marker-halo"
              />
              {/* Solid inner dot. */}
              <circle
                cx={mx}
                cy={mz}
                r={0.16}
                fill={ACCENT}
                stroke="#fff"
                strokeWidth={0.04}
              />
            </g>
          );
        })()}
      {/* v0.40.44: architectural annotations — small overlay
          elements that turn the plan from "boxes-with-labels" into
          something that reads as a real plan drawing. Only render
          in compact mode (the Reference card miniature) and only
          when we have meaningful bounds; the full-screen view has
          its own dimension chains via RoomDirectorCadPlan.

          Three additions:
            • Room dimensions in the top-left corner (W × D in m)
            • Compass rose (N arrow) in the top-right corner
            • Scale ruler in the bottom-right corner (1m segment)

          All three are pointerEvents:none so they don't intercept
          drag/click. Sizes are picked in SVG user-units (which are
          meters in our world frame) and read appropriately when
          the SVG scales to the Reference card's pixel size. */}
      {compact && bounds && (
        <g pointerEvents="none">
          {/* Top-left dimension stamp. Reads as architectural
              metadata (width × depth in meters). Two-line stack
              so it doesn't sprawl horizontally on narrow rooms. */}
          <g>
            <rect
              x={vbX + pad * 0.25}
              y={vbZ + pad * 0.25}
              width={2.4}
              height={0.7}
              fill="rgba(255, 248, 241, 0.85)"
              stroke="rgba(124, 80, 50, 0.18)"
              strokeWidth={0.012}
              rx={0.06}
            />
            <text
              x={vbX + pad * 0.25 + 0.12}
              y={vbZ + pad * 0.25 + 0.28}
              fontSize={0.22}
              fontWeight={600}
              fill="rgba(26, 26, 26, 0.85)"
              dominantBaseline="middle"
              style={{
                fontFamily: "var(--font-app), system-ui, sans-serif",
                userSelect: "none",
              }}
            >
              {`${bounds.width.toFixed(2)} × ${bounds.depth.toFixed(2)} m`}
            </text>
            <text
              x={vbX + pad * 0.25 + 0.12}
              y={vbZ + pad * 0.25 + 0.55}
              fontSize={0.16}
              fill="rgba(26, 26, 26, 0.55)"
              dominantBaseline="middle"
              letterSpacing="0.04em"
              style={{
                fontFamily: "var(--font-app), system-ui, sans-serif",
                textTransform: "uppercase",
                userSelect: "none",
              }}
            >
              {`${(bounds.width * bounds.depth).toFixed(1)} m²`}
            </text>
          </g>

          {/* Top-right compass rose. Conventional architectural N
              arrow: filled triangle pointing up, with the letter N
              above. Anchored just inside the viewBox padding. */}
          {(() => {
            const cx = vbX + vbW - pad * 0.45;
            const cy = vbZ + pad * 0.45;
            return (
              <g transform={`translate(${cx} ${cy})`}>
                {/* Outer ring */}
                <circle
                  cx={0}
                  cy={0}
                  r={0.32}
                  fill="rgba(255, 248, 241, 0.85)"
                  stroke="rgba(124, 80, 50, 0.18)"
                  strokeWidth={0.012}
                />
                {/* Tick marks at the 4 cardinal directions */}
                <line
                  x1={0}
                  y1={-0.32}
                  x2={0}
                  y2={-0.24}
                  stroke="rgba(26, 26, 26, 0.4)"
                  strokeWidth={0.018}
                />
                <line
                  x1={0}
                  y1={0.24}
                  x2={0}
                  y2={0.32}
                  stroke="rgba(26, 26, 26, 0.25)"
                  strokeWidth={0.018}
                />
                <line
                  x1={-0.32}
                  y1={0}
                  x2={-0.24}
                  y2={0}
                  stroke="rgba(26, 26, 26, 0.25)"
                  strokeWidth={0.018}
                />
                <line
                  x1={0.24}
                  y1={0}
                  x2={0.32}
                  y2={0}
                  stroke="rgba(26, 26, 26, 0.25)"
                  strokeWidth={0.018}
                />
                {/* North arrow — filled triangle pointing up */}
                <polygon
                  points="0,-0.18 0.06,0.04 0,-0.02 -0.06,0.04"
                  fill={ACCENT}
                />
                {/* N label */}
                <text
                  x={0}
                  y={-0.36}
                  fontSize={0.14}
                  fontWeight={700}
                  fill="rgba(26, 26, 26, 0.7)"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontFamily: "var(--font-app), system-ui, sans-serif",
                    userSelect: "none",
                  }}
                >
                  N
                </text>
              </g>
            );
          })()}

          {/* Bottom-right scale ruler. 1m segment with tick marks
              at 0 and 1 and a small label. Functions as a visual
              calibration so the user knows what "1m" looks like in
              the rendered plan. */}
          {(() => {
            const x0 = vbX + vbW - pad * 0.25 - 1.0;
            const x1 = vbX + vbW - pad * 0.25;
            const y = vbZ + vbH - pad * 0.35;
            return (
              <g>
                {/* Background pill */}
                <rect
                  x={x0 - 0.08}
                  y={y - 0.18}
                  width={1.16}
                  height={0.36}
                  fill="rgba(255, 248, 241, 0.85)"
                  stroke="rgba(124, 80, 50, 0.18)"
                  strokeWidth={0.012}
                  rx={0.06}
                />
                {/* Bar */}
                <line
                  x1={x0}
                  y1={y}
                  x2={x1}
                  y2={y}
                  stroke="rgba(26, 26, 26, 0.7)"
                  strokeWidth={0.022}
                />
                {/* End ticks */}
                <line
                  x1={x0}
                  y1={y - 0.07}
                  x2={x0}
                  y2={y + 0.07}
                  stroke="rgba(26, 26, 26, 0.7)"
                  strokeWidth={0.022}
                />
                <line
                  x1={x1}
                  y1={y - 0.07}
                  x2={x1}
                  y2={y + 0.07}
                  stroke="rgba(26, 26, 26, 0.7)"
                  strokeWidth={0.022}
                />
                {/* Mid tick */}
                <line
                  x1={(x0 + x1) / 2}
                  y1={y - 0.04}
                  x2={(x0 + x1) / 2}
                  y2={y + 0.04}
                  stroke="rgba(26, 26, 26, 0.5)"
                  strokeWidth={0.016}
                />
                {/* "1m" label */}
                <text
                  x={(x0 + x1) / 2}
                  y={y + 0.18}
                  fontSize={0.13}
                  fontWeight={500}
                  fill="rgba(26, 26, 26, 0.7)"
                  textAnchor="middle"
                  dominantBaseline="hanging"
                  letterSpacing="0.04em"
                  style={{
                    fontFamily: "var(--font-app), system-ui, sans-serif",
                    textTransform: "uppercase",
                    userSelect: "none",
                  }}
                >
                  1 m
                </text>
              </g>
            );
          })()}
        </g>
      )}
    </svg>
  );
}
