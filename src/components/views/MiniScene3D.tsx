"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Apartment } from "@studio/scene/Apartment";
import { GeneratedApartment } from "@studio/scene/GeneratedApartment";
import { FurnitureMeshes } from "@studio/scene/FurnitureMeshes";
import { GlContextLifecycle } from "@studio/scene/GlContextLifecycle";
import { RevealWhenLit } from "@studio/scene/RevealWhenLit";
import { useStudioShellKind } from "@studio/hooks/useStudioShellKind";
import { isPanelOnlyFurniture } from "@studio/cad/draftRoom";
import { CAMERA_PRESETS, panelOrbitFrame } from "@studio/three/cameraPresets";
import { useStore } from "@studio/store";

/**
 * Compact 3D scene used inside the Reference card when the main
 * viewport is in 2D mode. Shares the GLB through drei's `useGLTF`
 * cache so loading the apartment a second time is instant — only
 * a fresh WebGL context + light pass is added.
 *
 * Blank panel stages use the same tight orbit frame as the main
 * Scene so the board fills the Reference card.
 *
 * Shell branching matches `Scene.tsx` via `useStudioShellKind`.
 */

function MiniCameraFrame({
  freeOrbit,
  heightM,
  center,
}: {
  freeOrbit: boolean;
  heightM: number;
  center: [number, number] | null;
}) {
  const { camera, controls } = useThree() as {
    camera: THREE.PerspectiveCamera;
    controls: {
      target: THREE.Vector3;
      update: () => void;
      addEventListener?: (type: string, fn: () => void) => void;
      removeEventListener?: (type: string, fn: () => void) => void;
    } | null;
  };

  const applied = useRef(false);
  const userMoved = useRef(false);

  useEffect(() => {
    if (!controls?.addEventListener) return;
    const mark = () => {
      userMoved.current = true;
    };
    controls.addEventListener("start", mark);
    return () => controls.removeEventListener?.("start", mark);
  }, [controls]);

  useEffect(() => {
    if (userMoved.current) return;
    if (applied.current && !freeOrbit) return;

    const frame = freeOrbit
      ? (() => {
          const p = panelOrbitFrame(heightM);
          return {
            position: new THREE.Vector3(
              p.position[0] * 0.85,
              p.position[1],
              p.position[2] * 0.85,
            ),
            target: new THREE.Vector3(...p.target),
          };
        })()
      : {
          position: new THREE.Vector3(...CAMERA_PRESETS[0]!.position),
          target: new THREE.Vector3(...CAMERA_PRESETS[0]!.target),
        };

    const ox = center?.[0] ?? 0;
    const oz = center?.[1] ?? 0;
    camera.position.set(
      frame.position.x + ox,
      frame.position.y,
      frame.position.z + oz,
    );
    if (controls) {
      controls.target.set(
        frame.target.x + ox,
        frame.target.y,
        frame.target.z + oz,
      );
      controls.update();
    } else {
      camera.lookAt(frame.target.x + ox, frame.target.y, frame.target.z + oz);
    }
    applied.current = true;
  }, [camera, center, controls, freeOrbit, heightM]);

  return null;
}

export function MiniScene3D() {
  const envPreset = useStore((s) => s.envPreset);
  const shellKind = useStudioShellKind();
  const currentProjectId = useStore((s) => s.currentProjectId);
  const apartmentCenter = useStore((s) => s.apartmentCenter);
  const roomMeta = useStore((s) => s.roomMeta);
  const furniture = useStore((s) => s.furniture);
  const wallCount = useStore((s) => s.walls?.length ?? 0);

  const freeOrbit =
    shellKind === "blank" ||
    (shellKind === "generated" && wallCount === 0) ||
    (shellKind === "apartment" &&
      (furniture ?? []).filter((f) => f.placed).length <= 1);

  const panelOnly = isPanelOnlyFurniture(furniture ?? []);
  const heightM =
    panelOnly && roomMeta ? roomMeta.height : (roomMeta?.height ?? 2);

  const [canvasKey, setCanvasKey] = useState(0);
  const remountCanvas = useCallback(() => {
    setCanvasKey((k) => k + 1);
  }, []);

  const boot = freeOrbit
    ? panelOrbitFrame(heightM)
    : CAMERA_PRESETS[0]!;
  const bootPos: [number, number, number] = [
    boot.position[0] + (apartmentCenter?.[0] ?? 0),
    boot.position[1],
    boot.position[2] + (apartmentCenter?.[1] ?? 0),
  ];

  return (
    <Canvas
      key={canvasKey}
      camera={{ position: bootPos, fov: 40, near: 0.05, far: 100 }}
      gl={{
        alpha: true,
        antialias: true,
        logarithmicDepthBuffer: true,
        powerPreference: "default",
      }}
      dpr={[1, 1.5]}
      style={{ background: "transparent" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.style.opacity = "0";
      }}
    >
      <GlContextLifecycle onRemountCanvas={remountCanvas} />
      <RevealWhenLit />
      <ambientLight color={0xfff2e4} intensity={0.45} />
      <directionalLight color={0xffd8b0} intensity={0.8} position={[5, 7, 4]} />
      <directionalLight
        color={0xffffff}
        intensity={0.18}
        position={[-4, 3, -2]}
      />

      <Suspense fallback={null}>
        <Environment preset={envPreset} background={false} />
        {shellKind === "generated" ? (
          <GeneratedApartment />
        ) : shellKind === "apartment" ? (
          <Apartment
            key={currentProjectId || "apartment"}
            url="/studio/apartamento.glb"
          />
        ) : null}
        <FurnitureMeshes />
      </Suspense>

      <MiniCameraFrame
        freeOrbit={freeOrbit}
        heightM={heightM}
        center={apartmentCenter}
      />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        enablePan
        enableZoom
        enableRotate
        zoomSpeed={1.1}
        minDistance={freeOrbit ? 0.05 : 1.2}
        maxDistance={freeOrbit ? 24 : 22}
        minPolarAngle={freeOrbit ? 0 : 0.1}
        maxPolarAngle={freeOrbit ? Math.PI : Math.PI / 2 - 0.05}
        makeDefault
      />
    </Canvas>
  );
}
