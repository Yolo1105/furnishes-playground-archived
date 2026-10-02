"use client";

/**
 * FurnitureMeshes — renders generated pieces inside the 3D scene.
 *
 * IMPORTANT: this component ONLY renders pieces with
 * `meta.source === "room-director"`. Viewer-source pieces (those
 * loaded from /apartamento.glb) are visualized entirely by the
 * `<Apartment>` GLB tree + the existing wrapping-group system; this
 * component contributes nothing for them.
 *
 * Per generated piece, three rendering states:
 *
 *   1. No GLB url yet (just-after-`layout`-event placeholder)
 *      → opaque colored box at the piece's exact dimensions. Same
 *        color as the per-item `color` field so the placeholder reads
 *        as a stylized stand-in, not a generic gray cube.
 *
 *   2. GLB url present (after `piece_ready`)
 *      → real <GeneratedPieceMesh>, which loads the GLB through the
 *        cache, auto-scales it to the piece's dimensions, and renders
 *        a wrapped <primitive>. Always wrapped in a transparent hit
 *        cube of the same dimensions for click handling.
 *
 *   3. Item is hidden / unplaced
 *      → skipped entirely.
 *
 * Click-to-select: our Apartment.tsx wrapping-group system handles
 * selection for viewer-source pieces by tagging meshes with
 * `userData.itemId`. Generated pieces don't go through that path
 * (no GLB to wrap), so this component owns its own click handler
 * that calls `selectFurniture(item.id)` directly.
 *
 * Wrapping-group convention:
 *   The hit cube is positioned at (x, studioY, z) with rotation y =
 *   -item.rotation in radians. studioY comes from `meta.studioY`
 *   (stashed by the adapter); for floor pieces it's height/2 so the
 *   piece's bottom sits at world Y=0. This matches how the existing
 *   wrapping groups are positioned — generated pieces drop into the
 *   same coordinate convention without needing a separate path in
 *   gizmos / selection / persistence.
 */

import React, { useCallback, useMemo, useState } from "react";
import * as THREE from "three";
import { useStore } from "@studio/store";
import type { PlacedItem } from "@studio/store/furniture-slice";
import { GeneratedPieceMesh } from "./GeneratedPieceMesh";
import { makeFloorTexture } from "@studio/scene/procedural-textures";
import {
  resolveItemMaterial,
  type PanelMaterialFinish,
} from "@studio/catalog/panel-materials";
import { isDraftCadSubject } from "@studio/cad/draftRoom";
import { isCarcassPanel } from "@studio/cad/openFrontBox";

function isRenderableStudioPanel(meta?: {
  source?: string;
} | null): boolean {
  const src = meta?.source;
  return (
    src === "room-director" ||
    src === "draft-panel" ||
    src === "carcass-panel"
  );
}

export function FurnitureMeshes() {
  const furniture = useStore((s) => s.furniture);
  const selectedId = useStore((s) => s.selectedId);
  const selectFurniture = useStore((s) => s.selectFurniture);

  return (
    <group name="generated-furniture">
      {furniture.map((f) => {
        const meta = f.meta as
          | { source?: string; glbUrl?: string; studioY?: number }
          | undefined;
        // Viewer-source items live in the apartment GLB. CAD draft +
        // open-front carcass panels render here as dimensioned boxes.
        if (!isRenderableStudioPanel(meta) && !isCarcassPanel(f)) {
          return null;
        }
        // Skip hidden / unplaced.
        if (!f.placed || !f.visible) return null;

        return (
          <GeneratedHitCube
            key={f.id}
            item={f}
            selected={f.id === selectedId}
            onSelect={selectFurniture}
          />
        );
      })}
    </group>
  );
}

interface HitCubeProps {
  item: PlacedItem;
  selected: boolean;
  onSelect: (id: string | null) => void;
}

function PanelSurfaceMaterial({
  color,
  finish,
}: {
  color: string;
  finish: PanelMaterialFinish;
}) {
  const map = useMemo(() => {
    if (finish !== "wood") return null;
    const tex = makeFloorTexture(color);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.5, 1.5);
    return tex;
  }, [color, finish]);

  return (
    <meshStandardMaterial
      color={color}
      map={map ?? undefined}
      roughness={finish === "wood" ? 0.72 : 0.42}
      metalness={0}
    />
  );
}

const GeneratedHitCube = React.memo(function GeneratedHitCube({
  item,
  selected,
  onSelect,
}: HitCubeProps) {
  const [hovered, setHovered] = useState(false);
  const showWireframe = useStore((s) => s.showWireframe);
  const meta = item.meta as
    | {
        glbUrl?: string;
        studioY?: number;
        pitchDeg?: number;
        rollDeg?: number;
        // v0.40.30: quaternion-based orientation override. Replaces
        // pitchDeg/rollDeg as the source of truth for the pitch+roll
        // rotation gizmo. Stored as [x, y, z, w] (Three.js quat
        // ordering). When absent, falls back to Euler from legacy
        // pitchDeg/rollDeg fields below.
        orientationQuat?: [number, number, number, number];
        // v0.40.32: when this item came from a starred entry, the
        // starredGlbKey points into the dedicated starred-glb-bucket
        // IndexedDB store. The GLB resolver checks that bucket FIRST
        // so starred meshes don't 404 when fal.ai URLs expire.
        starredGlbKey?: string;
      }
    | undefined;

  // Y coord — adapter stashed height/2 for floor pieces in
  // meta.studioY. Fall back to height/2 if missing (shouldn't be —
  // adapter always writes it — but defense in depth).
  const cy = meta?.studioY ?? item.height / 2;

  const hasGlb = typeof meta?.glbUrl === "string" && meta.glbUrl.length > 0;
  const isDraftPanel = isDraftCadSubject(item);
  const isCarcass = isCarcassPanel(item);
  const material = resolveItemMaterial(item);
  // Draft / carcass / chosen material: real surface. Incomplete
  // room-director placeholders without a material stay alert-orange.
  const useSurfaceMaterial =
    !hasGlb &&
    (isDraftPanel ||
      isCarcass ||
      typeof item.meta?.materialId === "string");

  // v0.40.30: orientation override now stored as a quaternion to fix
  // a bug where Euler XYZ ordering caused pitch and roll to interact
  // unexpectedly (clicking "roll" after "pitch" rotated around the
  // wrong axis). The quat is computed once per render either from
  // the new meta.orientationQuat field, or — for legacy items — by
  // composing an Euler from the pre-v0.40.30 pitchDeg/rollDeg.
  // Both paths produce a Quaternion that the inner <group> applies
  // verbatim, no order-dependence.
  const orientationQuat = (() => {
    if (meta?.orientationQuat && meta.orientationQuat.length === 4) {
      return meta.orientationQuat;
    }
    // Migrate from legacy Euler. Same XYZ order as the old render
    // path, so visual orientation is preserved on first read.
    const pitchRad = ((meta?.pitchDeg ?? 0) * Math.PI) / 180;
    const rollRad = ((meta?.rollDeg ?? 0) * Math.PI) / 180;
    if (pitchRad === 0 && rollRad === 0) return null; // identity
    const e = new THREE.Euler(pitchRad, 0, rollRad, "XYZ");
    const q = new THREE.Quaternion().setFromEuler(e);
    return [q.x, q.y, q.z, q.w] as [number, number, number, number];
  })();

  const handleClick = useCallback(
    (e: { stopPropagation?: () => void }) => {
      e.stopPropagation?.();
      onSelect(item.id);
    },
    [item.id, onSelect],
  );

  const handlePointerOver = useCallback(
    (e: { stopPropagation?: () => void }) => {
      e.stopPropagation?.();
      setHovered(true);
      if (typeof document !== "undefined") {
        document.body.style.cursor = "pointer";
      }
    },
    [],
  );

  const handlePointerOut = useCallback(() => {
    setHovered(false);
    if (typeof document !== "undefined") {
      document.body.style.cursor = "default";
    }
  }, []);

  // Rotation: PlacedItem.rotation is degrees; three uses radians and
  // the existing wrapping-group system rotates around Y by
  // (item.rotation * π / 180). Same convention here so generated
  // pieces face the same direction the gizmos expect.
  const rotationY = (item.rotation * Math.PI) / 180;

  return (
    <group
      position={[item.x, cy, item.z]}
      rotation={[0, rotationY, 0]}
      userData={{ itemId: item.id }}
    >
      {/* Hit cube — transparent when a GLB is present (the GLB
          provides the visible mesh). Opaque colored box when no
          GLB yet, so the user sees something at this position
          during the streaming phase. */}
      <mesh
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        userData={{ itemId: item.id }}
      >
        <boxGeometry args={[item.width, item.height, item.depth]} />
        {hasGlb ? (
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        ) : useSurfaceMaterial ? (
          <PanelSurfaceMaterial
            color={material.color}
            finish={material.finish}
          />
        ) : (
          // Incomplete generated piece (no GLB yet) — alert orange.
          <meshStandardMaterial
            color="#FF7755"
            roughness={0.55}
            metalness={0.05}
            transparent
            opacity={0.78}
          />
        )}
      </mesh>

      {/* v0.40.31: wireframe overlay on incomplete placeholders only. */}
      {!hasGlb && !useSurfaceMaterial && showWireframe && (
        <mesh>
          <boxGeometry
            args={[item.width * 1.005, item.height * 1.005, item.depth * 1.005]}
          />
          <meshBasicMaterial
            color="#B8330D"
            wireframe
            transparent
            opacity={0.55}
          />
        </mesh>
      )}

      {/* Real mesh — only when the GLB url has been attached.
          Wrapped in an inner group so we can apply user-applied
          pitch (X rotation) and roll (Z rotation) from meta WITHOUT
          affecting the hit cube's bbox (which represents the
          requested item dims and stays axis-aligned for selection
          + clearance checks). v0.40.23. */}
      {hasGlb && (
        <group quaternion={orientationQuat ?? undefined}>
          <GeneratedPieceMesh
            glbUrl={meta!.glbUrl!}
            starredGlbKey={meta?.starredGlbKey}
            width={item.width}
            depth={item.depth}
            height={item.height}
            color={item.color}
          />
        </group>
      )}

      {/* Selection / hover — clean edge outline flush with faces.
          Absolute +0.8mm only (not %), so thin panels don't float. */}
      {(selected || hovered) && (
        <group quaternion={orientationQuat ?? undefined}>
          <lineSegments renderOrder={999}>
            <edgesGeometry
              args={[
                new THREE.BoxGeometry(
                  item.width + 0.0008,
                  item.height + 0.0008,
                  item.depth + 0.0008,
                ),
              ]}
            />
            <lineBasicMaterial
              color={selected ? "#FF5A1F" : "#FFFFFF"}
              transparent
              opacity={selected ? 0.95 : 0.55}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </lineSegments>
        </group>
      )}
    </group>
  );
}, equalProps);

/** Custom memo equality — only re-render the hit cube when one of
 *  the props that affects visuals actually changes. Without this,
 *  every store update (typing, scrolling, anything) would re-render
 *  every piece because `furniture` reference would change.
 *
 *  v0.40.42: include `meta.orientationQuat` in the comparison.
 *  Without this, clicking the pitch / roll buttons in RotationGizmo
 *  updates the store correctly but the memo decides "no relevant
 *  change, skip render" — and the rotation never reaches the DOM.
 *  Users perceived this as "Z rotation doesn't work." Comparing the
 *  quaternion's four components element-wise is fine; pitch/roll
 *  changes only happen on user click, not on every frame, so this
 *  isn't a hot path. */
function equalProps(prev: HitCubeProps, next: HitCubeProps): boolean {
  const a = prev.item;
  const b = next.item;
  const aMeta = a.meta as
    | {
        glbUrl?: string;
        materialId?: string;
        orientationQuat?: [number, number, number, number];
      }
    | undefined;
  const bMeta = b.meta as
    | {
        glbUrl?: string;
        materialId?: string;
        orientationQuat?: [number, number, number, number];
      }
    | undefined;
  const aQ = aMeta?.orientationQuat;
  const bQ = bMeta?.orientationQuat;
  const sameQuat =
    (aQ == null && bQ == null) ||
    (aQ != null &&
      bQ != null &&
      aQ[0] === bQ[0] &&
      aQ[1] === bQ[1] &&
      aQ[2] === bQ[2] &&
      aQ[3] === bQ[3]);
  return (
    a.x === b.x &&
    a.z === b.z &&
    a.width === b.width &&
    a.depth === b.depth &&
    a.height === b.height &&
    a.rotation === b.rotation &&
    a.placed === b.placed &&
    a.visible === b.visible &&
    a.color === b.color &&
    aMeta?.glbUrl === bMeta?.glbUrl &&
    aMeta?.materialId === bMeta?.materialId &&
    sameQuat &&
    prev.selected === next.selected
  );
}

// Suppress unused warning for THREE import — it's used implicitly by
// the boxGeometry / meshStandardMaterial JSX which resolves via R3F's
// internal three reconciler. Keep the import present so the file
// reads as "yes this is a three.js module" without surprise.
void THREE;
