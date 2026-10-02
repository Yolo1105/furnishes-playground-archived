"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useStore } from "@studio/store";

/**
 * Renders an orange wireframe box around the currently-selected
 * inventory item's actual GLB meshes. The box is computed in world
 * space from `Box3.expandByObject` over each mesh ref the
 * furniture-slice tracks for that item, so it follows the real
 * geometry — not metadata.
 *
 * Behavior:
 *   • Renders only when `selectedId` is set AND the item is `placed`
 *     AND `visible` (no point outlining a hidden mesh).
 *   • Uses `EdgesGeometry` over a `BoxGeometry` sized to the
 *     mesh-aggregate bounding box, so we draw the 12 edges of the
 *     box (no diagonals).
 *   • `depthTest: false` + high `renderOrder` keeps the box visible
 *     even when the camera is on the wrong side of a wall — the
 *     selection cue should always be findable.
 *   • Colored with the brand accent, slight transparency for
 *     subtlety against bright backdrops.
 *
 * Mounted as a child of `<Scene>` so it lives inside the R3F
 * Canvas. When the main view is in 2D mode, `<Scene>` itself isn't
 * mounted, so this component naturally doesn't render in that
 * mode.
 *
 * Recomputed on every change to `selectedId` or to `furniture`
 * (which changes when items are placed / removed / hidden /
 * shown). The `Box3` is computed once per change inside `useMemo`,
 * so frame-time cost is zero — we don't recompute every frame.
 *
 * Future: when items become draggable / repositionable, we'll
 * need a `useFrame` to update the box per-frame. For now the
 * meshes are static at their GLB positions, so a one-shot box
 * suffices.
 */
export function SelectionIndicator() {
  const selectedId = useStore((s) => s.selectedId);
  const furniture = useStore((s) => s.furniture);

  const item = useMemo(() => {
    if (!selectedId) return null;
    const f = furniture.find((x) => x.id === selectedId);
    if (!f || !f.placed || !f.visible) return null;
    return f;
  }, [selectedId, furniture]);

  const boxData = useMemo(() => {
    if (!item || item.meshes.length === 0) return null;

    // Make sure each mesh's world matrix is current before reading
    // its bounds. R3F should keep these up-to-date, but being
    // explicit costs nothing and protects against edge cases (HMR,
    // first-frame races).
    for (const m of item.meshes) {
      m.updateMatrixWorld(true);
    }

    const box = new THREE.Box3();
    for (const mesh of item.meshes) {
      box.expandByObject(mesh);
    }
    if (box.isEmpty()) return null;

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Sub-millimetre pad so edges sit on the border, not floating
    // outside (percent inflate looked huge on tall thin panels).
    const PAD = 0.0008;
    return {
      size: [size.x + PAD, size.y + PAD, size.z + PAD] as const,
      center: [center.x, center.y, center.z] as const,
    };
  }, [item]);

  if (!boxData) return null;

  return (
    <group position={boxData.center as unknown as [number, number, number]}>
      <lineSegments renderOrder={999}>
        <edgesGeometry
          args={[
            new THREE.BoxGeometry(
              ...(boxData.size as unknown as [number, number, number]),
            ),
          ]}
        />
        <lineBasicMaterial
          color="#FF5A1F"
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
