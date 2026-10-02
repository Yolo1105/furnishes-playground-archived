"use client";

/**
 * GeneratedApartment — renders the room shell for scenes produced by
 * the AI generation pipeline (not from /apartamento.glb).
 *
 * Mounted by Scene.tsx when `sceneSource === "room-director"`. Replaces
 * the `<Apartment>` component that loads the static GLB.
 *
 * What it draws:
 *   - A floor plane at y=0 sized to roomMeta.width × roomMeta.depth,
 *     tinted from `currentStyleBible.palette.floor_tint` when present,
 *     falling back to a neutral cream
 *   - Walls — either user/orchestrator-supplied wall segments from the
 *     walls slice, or four bounding walls auto-generated from roomMeta
 *     bounds when no explicit walls exist. Wall color comes from
 *     `currentStyleBible.palette.walls`.
 *   - Door / window markers as semi-transparent colored boxes.
 *
 * Dollhouse view: walls between the camera and room interior are
 * hidden so the user can always see inside. Each frame, every wall
 * is tested: if the camera is on the wall's outside, the wall is
 * "in front of" the room from the camera's perspective and gets
 * hidden. As the camera orbits, hidden walls swap automatically —
 * exactly the open-dollhouse pattern (the back-far-from-camera walls
 * always visible, the front-near-camera walls always invisible).
 *
 * Coordinate convention: y-UP world space, origin at room center.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Vector3 } from "three";
import type { Mesh } from "three";
import { useStore } from "@studio/store";
import type { StyleBible } from "@studio/director/schema";
import {
  makeFloorTexture,
  makeWallTexture,
} from "@studio/scene/procedural-textures";

const FALLBACK_FLOOR_COLOR = "#F0E6D8";
const FALLBACK_WALL_COLOR = "#EAD9C0";
const WALL_THICKNESS = 0.15;

const DOOR_MARKER_COLOR = "#C4915A";
const WINDOW_MARKER_COLOR = "#8FB5D4";
const MARKER_OPACITY = 0.35;

// Dollhouse hide threshold. Hide any wall whose camera-to-wall dot
// with the outward normal is above this. Small negative threshold
// prevents flickering at exactly broadside angles.
const DOLLHOUSE_HIDE_THRESHOLD = -0.05;

function resolveFloorColor(style: StyleBible | null): string {
  return style?.palette?.floor_tint ?? FALLBACK_FLOOR_COLOR;
}

function resolveWallColor(style: StyleBible | null): string {
  return style?.palette?.walls ?? FALLBACK_WALL_COLOR;
}

export function GeneratedApartment() {
  const roomMeta = useStore((s) => s.roomMeta);
  const walls = useStore((s) => s.walls);
  const openings = useStore((s) => s.openings);
  const styleBible = useStore((s) => s.currentStyleBible);

  // ─── ALL HOOKS MUST APPEAR BEFORE ANY EARLY RETURN ─────────────
  //
  // React's Rules of Hooks require hooks to be called in the same
  // order on every render. An earlier version of this component
  // had `if (!roomMeta) return null;` BEFORE the texture useMemos —
  // when roomMeta toggled between null and non-null between renders
  // (e.g., when applyScene fired or a project was switched), React
  // saw a different number of hooks called and threw "Rendered more
  // hooks than during the previous render."
  //
  // Fix: derive every value the hooks need defensively (with safe
  // fallbacks for the null-roomMeta case), then call all hooks
  // unconditionally, then do the null check after the hook block.
  // The hook outputs aren't used in the null-roomMeta render path
  // anyway since we return null in that case.
  const floorColor = resolveFloorColor(styleBible);
  const wallColor = resolveWallColor(styleBible);
  const width = roomMeta?.width ?? 1;
  const depth = roomMeta?.depth ?? 1;

  // Procedural floor texture. Memoize across renders so we don't
  // re-build the canvas every paint. The texture function itself
  // is module-cached by base color, so this useMemo is mostly
  // defensive — it prevents triggering React's reference-equality
  // check on the material's `map` prop (which would force the
  // material to recompile its shader uniforms).
  const floorTexture = useMemo(() => {
    const tex = makeFloorTexture(floorColor);
    // Tile the floor texture across the actual room dimensions. One
    // tile of the canvas = ~2 meters in the world. So a 5m × 6m room
    // shows ~2.5 × 3 tiles, giving the user plenty of plank seams
    // without any single plank looking unnaturally large.
    tex.repeat.set(width / 2, depth / 2);
    return tex;
  }, [floorColor, width, depth]);

  const wallTexture = useMemo(() => makeWallTexture(wallColor), [wallColor]);

  // ─── Early return AFTER all hooks ──────────────────────────────
  if (!roomMeta) return null;

  const { height } = roomMeta;
  const wallCenterY = height / 2;

  // Empty walls = intentional (CAD single-panel stage). Do not
  // synthesize a 4-wall room around the panel footprint.
  const wallSegments = walls;
  // Panel-only stage: infinite grid ground (PanelStageGround in Scene).
  // Do not draw a solid room floor pad — it read as a stray square.
  const showFloor = wallSegments.length > 0;

  return (
    <group name="generated-apartment">
      {/* Floor — only for real rooms (walled). */}
      {showFloor && (
        <mesh
          position={[0, 0, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[width, depth]} />
          <meshStandardMaterial map={floorTexture} roughness={0.85} />
        </mesh>
      )}

      {/* Walls — each wrapped in DollhouseWall for camera-aware hide. */}
      {wallSegments.map((w) => {
        const dx = w.x2 - w.x1;
        const dz = w.z2 - w.z1;
        const len = Math.max(Math.sqrt(dx * dx + dz * dz), 0.001);
        const cx = (w.x1 + w.x2) / 2;
        const cz = (w.z1 + w.z2) / 2;
        const yaw = Math.atan2(dz, dx);

        return (
          <DollhouseWall
            key={w.id}
            position={[cx, wallCenterY, cz]}
            rotation={[0, -yaw, 0]}
            geometry={[len, height, w.thickness]}
            // Wall length scales the texture's horizontal repeat so
            // a long wall doesn't show a stretched-out single tile.
            // Roughly one tile per 2 meters of wall length.
            wallLength={len}
            wallHeight={height}
            wallTexture={wallTexture}
          />
        );
      })}

      {/* Opening markers */}
      {openings.map((o) => {
        const cx = (o.x1 + o.x2) / 2;
        const cz = (o.z1 + o.z2) / 2;
        const dx = o.x2 - o.x1;
        const dz = o.z2 - o.z1;
        const len = Math.max(Math.sqrt(dx * dx + dz * dz), 0.001);
        const yaw = Math.atan2(dz, dx);
        const markerHeight = o.kind === "door" ? o.height : 0.9;
        const markerY = o.kind === "door" ? o.height / 2 : 1.0;
        const color =
          o.kind === "door" ? DOOR_MARKER_COLOR : WINDOW_MARKER_COLOR;

        return (
          <mesh key={o.id} position={[cx, markerY, cz]} rotation={[0, -yaw, 0]}>
            <boxGeometry args={[len, markerHeight, WALL_THICKNESS * 1.1]} />
            <meshStandardMaterial
              color={color}
              transparent
              opacity={MARKER_OPACITY}
            />
          </mesh>
        );
      })}
    </group>
  );
}

interface DollhouseWallProps {
  position: [number, number, number];
  rotation: [number, number, number];
  geometry: [number, number, number];
  /** Wall length in meters — used to compute the texture's
   *  horizontal-axis repeat so a long wall doesn't show one
   *  stretched-out tile of plaster. */
  wallLength: number;
  /** Wall height in meters — same logic for the vertical axis. */
  wallHeight: number;
  /** Procedural plaster texture from makeWallTexture(). The texture's
   *  `repeat` is set per-wall via a useMemo'd clone so each wall can
   *  scale to its own length without mutating the shared texture. */
  wallTexture: THREE.Texture;
}

/**
 * Single wall mesh with camera-aware visibility (dollhouse view).
 * Each frame, computes the camera-to-wall normal dot product. Walls
 * "in front of" the room interior from the camera's perspective get
 * hidden via mesh.visible = false (free in three.js).
 *
 * Texture handling: a single shared procedural plaster texture is
 * passed in from the parent. Setting `texture.repeat` mutates the
 * shared instance, which would cause every wall to use whichever
 * `repeat` was set last. We clone the texture per-wall so each wall
 * can scale its UV repeat independently. Cloned textures share the
 * same image source — no extra GPU memory, just per-wall repeat
 * settings.
 */
function DollhouseWall({
  position,
  rotation,
  geometry,
  wallLength,
  wallHeight,
  wallTexture,
}: DollhouseWallProps) {
  const ref = useRef<Mesh>(null);

  // Per-wall texture clone with repeat sized to the wall's actual
  // length × height. ~1 tile per 2 meters horizontally, ~1 tile per
  // 2.4 meters vertically (roughly the wall's full height).
  const myTexture = useMemo(() => {
    const t = wallTexture.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(wallLength / 2, 1), Math.max(wallHeight / 2.4, 1));
    return t;
  }, [wallTexture, wallLength, wallHeight]);

  // Stable working vectors — created once per wall instance.
  const work = useMemo(
    () => ({
      cameraToWall: new Vector3(),
      wallToCenter: new Vector3(),
      wallNormal: new Vector3(),
      roomCenter: new Vector3(0, 0, 0),
    }),
    [],
  );

  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh) return;

    // Wall's local +Z in world space.
    work.wallNormal.set(0, 0, 1).applyQuaternion(mesh.quaternion);

    // Vector from wall midpoint to room center.
    work.wallToCenter.copy(work.roomCenter).sub(mesh.position);

    // If the local +Z points TOWARD the room center, flip it so
    // it points outward (away from the room).
    if (work.wallNormal.dot(work.wallToCenter) > 0) {
      work.wallNormal.multiplyScalar(-1);
    }

    // Vector from wall midpoint to camera.
    work.cameraToWall.copy(camera.position).sub(mesh.position);

    // Positive dot → camera is on the wall's OUTSIDE → wall is
    // between camera and interior → hide.
    const dot = work.cameraToWall.dot(work.wallNormal);
    mesh.visible = dot < DOLLHOUSE_HIDE_THRESHOLD;
  });

  return (
    <mesh
      ref={ref}
      position={position}
      rotation={rotation}
      castShadow
      receiveShadow
    >
      <boxGeometry args={geometry} />
      <meshStandardMaterial map={myTexture} roughness={0.85} />
    </mesh>
  );
}
