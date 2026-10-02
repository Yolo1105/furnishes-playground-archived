"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { useStore } from "@studio/store";
import { findOverlappingIds } from "@studio/collision";

/**
 * Collision outlines. Renders a red wireframe box around any
 * placed item that currently overlaps another item, so the user
 * has persistent at-a-glance "this is wrong" feedback even without
 * opening the Health tab.
 *
 * Sister component to F4 Health's overlap rule — same predicate
 * (findOverlappingIds), different surface. Health gives the user
 * a clickable text row; this gives them a 3D indicator. Both are
 * useful — Health for "what specifically is wrong" detail, this
 * for "something is wrong, look at the red box."
 *
 * Implementation notes:
 *   - The outline box is sized 3% larger than the item's AABB so
 *     it sits visibly outside the mesh rather than z-fighting with
 *     it. depthTest false + renderOrder 998 = always visible.
 *   - Rotation is applied per-item — the outline rotates with the
 *     item so it stays aligned with the actual furniture footprint.
 *   - Y position is hardcoded to height/2 (item sits on the floor;
 *     wrapping-group setup means item.y doesn't exist as a state
 *     field; vertical placement comes from the GLB authoring).
 *   - useMemo on the overlap set + the item lookup so we don't
 *     recompute pairwise AABB on every render. Recomputes only
 *     when the furniture array reference changes (which the
 *     gizmo + apply path both update through setItemTransform).
 *   - No subscriber/slice surface — pure derivation from existing
 *     state. Adding a slice field would be redundant when F4
 *     Health already does the same computation inline.
 */

// Subtle desaturated red so the outline reads as "warning" without
// fighting the orange accent palette. depthTest:false on the
// material means it draws over the meshes so users always see it.
const OUTLINE_COLOR = "#cc2222";
const OUTLINE_OPACITY = 0.7;
const OUTLINE_GROW_FACTOR = 1.03;

const CollisionBox = React.memo(function CollisionBox({
  x,
  z,
  width,
  height,
  depth,
  rotationDeg,
}: {
  x: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotationDeg: number;
}) {
  // Cache the EdgesGeometry per dimension triple. Three's BoxGeometry
  // is cheap, but EdgesGeometry computes the silhouette once; reusing
  // it across renders keeps GPU buffers stable for items whose size
  // never changes (which is all of them).
  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(
      width * OUTLINE_GROW_FACTOR,
      height * OUTLINE_GROW_FACTOR,
      depth * OUTLINE_GROW_FACTOR,
    );
    return new THREE.EdgesGeometry(box);
  }, [width, height, depth]);

  return (
    <lineSegments
      position={[x, height / 2, z]}
      rotation={[0, (rotationDeg * Math.PI) / 180, 0]}
      renderOrder={998}
    >
      <primitive object={edges} attach="geometry" />
      <lineBasicMaterial
        color={OUTLINE_COLOR}
        transparent
        opacity={OUTLINE_OPACITY}
        depthTest={false}
      />
    </lineSegments>
  );
});

export function CollisionOutlines() {
  const furniture = useStore((s) => s.furniture);

  // Compute the overlap set + the items to outline in one memo so
  // we don't iterate twice. Same pattern HealthTab uses for its
  // ruleNoOverlap row.
  const offendingItems = useMemo(() => {
    const placedVisible = furniture.filter((f) => f.placed && f.visible);
    if (placedVisible.length < 2) return [];
    const aabbInputs = placedVisible.map((f) => ({
      id: f.id,
      x: f.x,
      z: f.z,
      width: f.width,
      depth: f.depth,
      rotation: f.rotation,
    }));
    const overlapIds = findOverlappingIds(aabbInputs);
    if (overlapIds.size === 0) return [];
    return placedVisible.filter((f) => overlapIds.has(f.id));
  }, [furniture]);

  if (offendingItems.length === 0) return null;

  return (
    <group>
      {offendingItems.map((f) => (
        <CollisionBox
          key={f.id}
          x={f.x}
          z={f.z}
          width={f.width}
          height={f.height}
          depth={f.depth}
          rotationDeg={f.rotation}
        />
      ))}
    </group>
  );
}
