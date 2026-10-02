"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "@studio/store";
import {
  magneticSnapMoving,
  resolveStudioY,
  snapNeighborsFor,
} from "@studio/collision/magneticSnap";

/**
 * AxisHandles — visible axis-arrow gizmo for explicit X/Z drag when
 * `translateMode` is enabled in the topbar. Sibling to TranslationGizmo
 * (which is the always-on body-drag behavior). When translateMode is
 * on, this component renders four arrows + a small center pad around
 * the selected item; dragging an arrow constrains motion to that axis,
 * dragging the pad allows free X/Z motion.
 *
 * Why have both this AND TranslationGizmo?
 *   • TranslationGizmo gives users a discoverable "click + drag the
 *     piece itself" path — works everywhere, no toolbar button
 *     required. But it's invisible — users have to know it exists.
 *   • AxisHandles adds a visible affordance: when the user toggles
 *     translateMode, they SEE arrows around the selected piece and
 *     can drag with confidence. It also constrains motion to a
 *     single axis (impossible with body-drag alone).
 *
 * Design notes:
 *   • Pointer capture on the handle mesh keeps the drag alive even
 *     when store updates re-render the gizmo group.
 *   • Drag math: capture the world floor-plane hit at pointerdown,
 *     compute offset from item center, then on each move compute
 *     new center = currentHit - offset. Constrain to axis if needed.
 *   • Wall clamp uses the same 10cm clearance buffer as the place-
 *     asset path, so dragged pieces can't escape the room.
 */

const ACCENT = "#FF5A1F";
const ACCENT_DIM = "rgba(255, 90, 31, 0.55)";
const ARROW_LEN = 0.6;
const ARROW_HEAD_R = 0.07;
const ARROW_HEAD_LEN = 0.14;
const ARROW_SHAFT_R = 0.012;
const PAD_R = 0.12;
const PAD_HEIGHT = 0.01;
const CLEARANCE = 0.1;

type Axis = "x" | "z" | "free";

export function AxisHandles() {
  const selectedId = useStore((s) => s.selectedId);
  const cameraMode = useStore((s) => s.cameraMode);
  const tourActive = useStore((s) => s.tourActive);
  const translateMode = useStore((s) =>
    Boolean((s as unknown as { translateMode?: boolean }).translateMode),
  );
  const item = useStore((s) =>
    s.selectedId ? s.furniture.find((f) => f.id === s.selectedId) : null,
  );
  const setItemTransform = useStore((s) => s.setItemTransform);
  const roomMeta = useStore((s) => s.roomMeta);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  // Drag state in refs so re-renders don't clobber it.
  const draggingAxisRef = useRef<Axis | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dz: number }>({ dx: 0, dz: 0 });
  const itemRef = useRef(item);
  itemRef.current = item;
  const setTransformRef = useRef(setItemTransform);
  setTransformRef.current = setItemTransform;
  const roomMetaRef = useRef(roomMeta);
  roomMetaRef.current = roomMeta;

  const [hoveredAxis, setHoveredAxis] = useState<Axis | null>(null);

  const floorPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05),
    [],
  );

  useEffect(() => {
    const dom = gl.domElement;
    if (draggingAxisRef.current) dom.style.cursor = "grabbing";
    else if (hoveredAxis) dom.style.cursor = "grab";
    return () => {
      dom.style.cursor = "";
    };
  }, [hoveredAxis, gl]);

  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!groupRef.current) return;
    const it = itemRef.current;
    if (!it) return;
    groupRef.current.position.set(it.x, 0.05, it.z);
  });

  if (
    !selectedId ||
    !item ||
    cameraMode !== "orbit" ||
    tourActive ||
    !translateMode
  )
    return null;

  const hitFloor = (
    clientX: number,
    clientY: number,
  ): { x: number; z: number } | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(floorPlane, hit)) return null;
    return { x: hit.x, z: hit.z };
  };

  // Clamp candidate (x, z) so the item's bbox stays inside roomMeta
  // with 10cm clearance. No clamp when there's no roomMeta (e.g.,
  // viewer-source apartments).
  const clampToRoom = (x: number, z: number, w: number, d: number) => {
    const rm = roomMetaRef.current;
    if (!rm) return { x, z };
    const minX = rm.minX + w / 2 + CLEARANCE;
    const maxX = rm.maxX - w / 2 - CLEARANCE;
    const minZ = rm.minZ + d / 2 + CLEARANCE;
    const maxZ = rm.maxZ - d / 2 - CLEARANCE;
    return {
      x: minX <= maxX ? Math.max(minX, Math.min(maxX, x)) : x,
      z: minZ <= maxZ ? Math.max(minZ, Math.min(maxZ, z)) : z,
    };
  };

  const onDownFor = (axis: Axis) => (e: unknown) => {
    const ev = e as {
      stopPropagation: () => void;
      target: { setPointerCapture?: (id: number) => void };
      pointerId: number;
      clientX: number;
      clientY: number;
    };
    ev.stopPropagation();
    try {
      ev.target.setPointerCapture?.(ev.pointerId);
    } catch {
      // Best-effort capture.
    }
    const it = itemRef.current;
    if (!it) return;
    const hit = hitFloor(ev.clientX, ev.clientY);
    if (!hit) return;
    dragOffsetRef.current = { dx: hit.x - it.x, dz: hit.z - it.z };
    draggingAxisRef.current = axis;
  };

  const onMoveFor = (axis: Axis) => (e: unknown) => {
    if (draggingAxisRef.current !== axis) return;
    const ev = e as {
      stopPropagation: () => void;
      clientX: number;
      clientY: number;
    };
    ev.stopPropagation();
    const it = itemRef.current;
    if (!it) return;
    const hit = hitFloor(ev.clientX, ev.clientY);
    if (!hit) return;
    let nx = hit.x - dragOffsetRef.current.dx;
    let nz = hit.z - dragOffsetRef.current.dz;
    if (axis === "x") nz = it.z;
    else if (axis === "z") nx = it.x;
    const clamped = clampToRoom(nx, nz, it.width, it.depth);
    const furniture = useStore.getState().furniture;
    const snapped = magneticSnapMoving(
      it,
      {
        x: clamped.x,
        z: clamped.z,
        studioY: resolveStudioY(it),
      },
      snapNeighborsFor(furniture, it.id),
    );
    // Keep axis constraint after magnet (don't let Z-snap break X-drag).
    if (axis === "x") snapped.z = it.z;
    else if (axis === "z") snapped.x = it.x;
    setTransformRef.current(it.id, {
      x: snapped.x,
      z: snapped.z,
      ...(typeof snapped.studioY === "number"
        ? { studioY: snapped.studioY }
        : null),
    });
  };

  const onUpHandler = (e: unknown) => {
    const ev = e as {
      target: { releasePointerCapture?: (id: number) => void };
      pointerId: number;
    };
    try {
      ev.target.releasePointerCapture?.(ev.pointerId);
    } catch {
      // Best-effort release.
    }
    draggingAxisRef.current = null;
  };

  const Arrow = ({
    direction,
    color,
  }: {
    direction: [number, number, number];
    color: string;
  }) => {
    const half = ARROW_LEN / 2;
    const tipPos: [number, number, number] = [
      direction[0] * ARROW_LEN,
      0,
      direction[2] * ARROW_LEN,
    ];
    const shaftPos: [number, number, number] = [
      direction[0] * half,
      0,
      direction[2] * half,
    ];
    const shaftRot: [number, number, number] =
      direction[0] !== 0
        ? [0, 0, direction[0] > 0 ? -Math.PI / 2 : Math.PI / 2]
        : [direction[2] > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0];
    return (
      <>
        <mesh position={shaftPos} rotation={shaftRot}>
          <cylinderGeometry
            args={[ARROW_SHAFT_R, ARROW_SHAFT_R, ARROW_LEN, 8]}
          />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
        <mesh position={tipPos} rotation={shaftRot}>
          <coneGeometry args={[ARROW_HEAD_R, ARROW_HEAD_LEN, 12]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      </>
    );
  };

  const isXHovered = hoveredAxis === "x";
  const isZHovered = hoveredAxis === "z";
  const isFreeHovered = hoveredAxis === "free";

  return (
    <group ref={groupRef}>
      {/* Center pad — free X/Z drag. Sits at item center. */}
      <group
        onPointerOver={(e) => {
          (e as unknown as { stopPropagation: () => void }).stopPropagation();
          setHoveredAxis("free");
        }}
        onPointerOut={() => setHoveredAxis(null)}
        onPointerDown={onDownFor("free")}
        onPointerMove={onMoveFor("free")}
        onPointerUp={onUpHandler}
        onPointerCancel={() => {
          draggingAxisRef.current = null;
        }}
      >
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[PAD_R, PAD_R, PAD_HEIGHT, 24]} />
          <meshBasicMaterial
            color={ACCENT}
            transparent
            opacity={isFreeHovered ? 0.85 : 0.4}
            depthTest={false}
          />
        </mesh>
      </group>

      {/* X-axis: +X and -X arrows together */}
      <group
        onPointerOver={(e) => {
          (e as unknown as { stopPropagation: () => void }).stopPropagation();
          setHoveredAxis("x");
        }}
        onPointerOut={() => setHoveredAxis(null)}
        onPointerDown={onDownFor("x")}
        onPointerMove={onMoveFor("x")}
        onPointerUp={onUpHandler}
        onPointerCancel={() => {
          draggingAxisRef.current = null;
        }}
      >
        <Arrow direction={[1, 0, 0]} color={isXHovered ? ACCENT : ACCENT_DIM} />
        <Arrow
          direction={[-1, 0, 0]}
          color={isXHovered ? ACCENT : ACCENT_DIM}
        />
      </group>

      {/* Z-axis: +Z and -Z arrows together */}
      <group
        onPointerOver={(e) => {
          (e as unknown as { stopPropagation: () => void }).stopPropagation();
          setHoveredAxis("z");
        }}
        onPointerOut={() => setHoveredAxis(null)}
        onPointerDown={onDownFor("z")}
        onPointerMove={onMoveFor("z")}
        onPointerUp={onUpHandler}
        onPointerCancel={() => {
          draggingAxisRef.current = null;
        }}
      >
        <Arrow direction={[0, 0, 1]} color={isZHovered ? ACCENT : ACCENT_DIM} />
        <Arrow
          direction={[0, 0, -1]}
          color={isZHovered ? ACCENT : ACCENT_DIM}
        />
      </group>
    </group>
  );
}
