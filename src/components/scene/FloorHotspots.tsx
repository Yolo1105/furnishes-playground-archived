"use client";

import { useMemo, useState } from "react";
import * as THREE from "three";
import { useStore } from "@studio/store";

/**
 * Clickable disks on the floor that drop the user into first-person
 * walk mode at that spot. Replaces the previous hardcoded six-point
 * grid (which assumed the apartment was centered at world origin —
 * after we switched normalize.ts to preserve raw Blender coords,
 * the apartment is no longer at origin and those positions landed
 * outside the actual room).
 *
 * Placement strategy now:
 *   1. Compute a contracted bounding box around all visible
 *      furniture. Furniture bounds are guaranteed to be inside
 *      the apartment (the items live indoors), so anchoring on
 *      them gives us "stuff is inside this rectangle." The
 *      contraction (negative margin) pulls hotspots away from
 *      walls so they don't sit visually-on-top of the wall lines.
 *   2. Lay a coarse grid of candidate spots across the contracted
 *      box.
 *   3. Drop any candidate that's within `MIN_FURNITURE_DIST` of an
 *      item — keeps hotspots in walkable floor area, not right on
 *      top of the sofa.
 *
 * The result: hotspots scale automatically with the apartment;
 * swapping the GLB doesn't require re-tuning hardcoded positions.
 */

interface FloorHotspotsProps {
  /** Called with the clicked hotspot's (x, _, z). Scene wires this
   *  to set walkTeleportTarget + switch cameraMode to "walk". */
  onPick: (pos: [number, number, number]) => void;
}

const HOTSPOT_RADIUS_OUTER = 0.32;
const HOTSPOT_RADIUS_INNER = 0.18;
const FURNITURE_MARGIN = -0.6; // contract the bbox inward by 0.6m
const GRID_STEP = 1.4; // spacing between hotspot candidates, m
const MIN_FURNITURE_DIST = 0.55; // skip if too close to any furniture

export function FloorHotspots({ onPick }: FloorHotspotsProps) {
  const enabled = useStore((s) => s.showHotspots);
  const furniture = useStore((s) => s.furniture);
  const apartmentRoot = useStore((s) => s.apartmentRoot);
  const [hovered, setHovered] = useState<number | null>(null);

  const positions = useMemo<Array<[number, number, number]>>(() => {
    if (!apartmentRoot) return [];

    // After normalize Y is floor-snapped to 0, but measure to be
    // safe (the GLB might have sub-floor trim that pushes the
    // lowest mesh slightly below 0).
    apartmentRoot.updateMatrixWorld(true);
    const sceneBox = new THREE.Box3().setFromObject(apartmentRoot);
    const floorY = sceneBox.min.y + 0.02;

    const visible = furniture.filter((f) => f.placed && f.visible);
    if (visible.length === 0) return [];

    const itemBounds: Array<{
      x: number;
      z: number;
      hw: number;
      hd: number;
    }> = [];
    let fMinX = Infinity;
    let fMaxX = -Infinity;
    let fMinZ = Infinity;
    let fMaxZ = -Infinity;

    for (const item of visible) {
      if (item.meshes.length === 0) continue;
      const box = new THREE.Box3();
      for (const m of item.meshes) box.expandByObject(m);
      if (box.isEmpty()) continue;
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      const w = box.max.x - box.min.x;
      const d = box.max.z - box.min.z;
      itemBounds.push({ x: cx, z: cz, hw: w / 2, hd: d / 2 });
      if (box.min.x < fMinX) fMinX = box.min.x;
      if (box.max.x > fMaxX) fMaxX = box.max.x;
      if (box.min.z < fMinZ) fMinZ = box.min.z;
      if (box.max.z > fMaxZ) fMaxZ = box.max.z;
    }
    if (!isFinite(fMinX)) return [];

    fMinX -= FURNITURE_MARGIN;
    fMaxX += FURNITURE_MARGIN;
    fMinZ -= FURNITURE_MARGIN;
    fMaxZ += FURNITURE_MARGIN;
    if (fMaxX <= fMinX || fMaxZ <= fMinZ) return [];

    const result: Array<[number, number, number]> = [];
    for (let x = fMinX + GRID_STEP / 2; x <= fMaxX; x += GRID_STEP) {
      for (let z = fMinZ + GRID_STEP / 2; z <= fMaxZ; z += GRID_STEP) {
        let blocked = false;
        for (const item of itemBounds) {
          const cx = Math.max(item.x - item.hw, Math.min(x, item.x + item.hw));
          const cz = Math.max(item.z - item.hd, Math.min(z, item.z + item.hd));
          if (Math.hypot(x - cx, z - cz) < MIN_FURNITURE_DIST) {
            blocked = true;
            break;
          }
        }
        if (!blocked) result.push([x, floorY, z]);
      }
    }

    // Cap the count so a huge open floor doesn't produce 50+ disks.
    if (result.length > 18) {
      const stride = Math.ceil(result.length / 14);
      return result.filter((_, i) => i % stride === 0);
    }
    return result;
  }, [apartmentRoot, furniture]);

  if (!enabled || positions.length === 0) return null;

  return (
    <group>
      {positions.map((pos, i) => (
        <group key={i}>
          {/* v0.40.50: invisible solid disk that acts as the hit-test
              target. Previously the hotspot was just a ring (annulus
              with hollow center 0.18m radius) plus a tiny inner dot
              (0.12m radius); clicks that landed in the gap between
              0.12m and 0.18m — i.e. most clicks aimed at the visible
              orange circle — hit empty space, fell through to
              OrbitControls, and produced no response. The user
              reported "I click on the orange circle on the ground
              and it doesn't move the camera" — that was exactly
              this hit-test gap. We now render a fully-solid disk at
              the outer radius with opacity 0 (invisible) but with
              the onClick + onPointer handlers, so any click anywhere
              within the visible hotspot area registers. The visible
              ring + dot stay decorative and have no handlers. */}
          <mesh
            position={pos}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={999}
            onClick={(e) => {
              e.stopPropagation();
              onPick(pos);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHovered(i);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              setHovered(null);
              document.body.style.cursor = "";
            }}
          >
            <circleGeometry args={[HOTSPOT_RADIUS_OUTER, 48]} />
            <meshBasicMaterial
              transparent
              opacity={0}
              depthTest={false}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* Decorative ring */}
          <mesh
            position={pos}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={999}
          >
            <ringGeometry
              args={[HOTSPOT_RADIUS_INNER, HOTSPOT_RADIUS_OUTER, 48]}
            />
            <meshBasicMaterial
              color={new THREE.Color("#FF5A1F")}
              transparent
              opacity={hovered === i ? 0.95 : 0.7}
              depthTest={false}
              depthWrite={false}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>

          {/* Decorative inner dot */}
          <mesh
            position={[pos[0], pos[1] + 0.001, pos[2]]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={999}
          >
            <circleGeometry args={[0.12, 32]} />
            <meshBasicMaterial
              color={new THREE.Color("#FF5A1F")}
              transparent
              opacity={hovered === i ? 0.55 : 0.32}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
