"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Environment, OrbitControls, useEnvironment } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Apartment } from "./Apartment";
import { GeneratedApartment } from "./GeneratedApartment";
import { FurnitureMeshes } from "./FurnitureMeshes";
import { CameraController } from "./CameraController";
import { FloorHotspots } from "./FloorHotspots";
import { SelectionIndicator } from "./SelectionIndicator";
import { RotationGizmo } from "./RotationGizmo";
import { TranslationGizmo } from "./TranslationGizmo";
import { AxisHandles } from "./AxisHandles";
import { WalkControls } from "./WalkControls";
import { TourCamera } from "./TourCamera";
import { CAMERA_PRESETS } from "@studio/three/cameraPresets";
import { useStudioShellKind } from "@studio/hooks/useStudioShellKind";
import { useStore } from "@studio/store";
import { GlContextLifecycle } from "./GlContextLifecycle";
import { registerSceneDropTarget } from "@studio/scene/sceneDropContext";
import { PanelStageGround } from "./PanelStageGround";
import { RevealWhenLit } from "./RevealWhenLit";

/** Keep catalog HTML5-drop raycasts in sync with the live camera. */
function SceneDropRegistrar() {
  const { camera, gl } = useThree();
  useEffect(() => {
    registerSceneDropTarget(camera, gl.domElement);
    return () => registerSceneDropTarget(null, null);
  }, [camera, gl]);
  return null;
}

/**
 * The 3D scene that fills the entire viewport behind the chat. The
 * canvas is rendered with `alpha: true` so the body's radial
 * gradient shows through above the apartment and in any negative
 * space.
 *
 * Composed pieces, mounted as Canvas children:
 *   • Lights         — ambient + key directional + cool fill
 *   • Environment    — drei HDRI; preset is store-driven
 *   • Apartment      — the GLB, suspends while loading
 *   • OrbitControls  — orbit-mode camera (damped, clamped); only
 *                      mounted while `cameraMode === "orbit"`
 *   • WalkControls   — first-person camera; only mounted while
 *                      `cameraMode === "walk"`. WASD + mouse-look
 *                      with wall collision.
 *   • CameraController — animates camera on store events
 *                       (reset / preset shuffle / hotspot fly)
 *   • FloorHotspots  — clickable accent disks; click teleports
 *                      into walk mode at that spot
 */
export function Scene() {
  const envPreset = useStore((s) => s.envPreset);
  const cardinalLightsMode = useStore((s) => s.cardinalLightsMode);
  // v0.40.48: read openings so the cardinal-lights rig can place
  // its directional lights to match actual window positions when
  // the room has them. Falls back to N/S/E/W cardinals when there
  // are no windows in the scene (e.g. viewer-source apartments).
  const openings = useStore((s) => s.openings);
  const cameraMode = useStore((s) => s.cameraMode);
  const setCameraMode = useStore((s) => s.setCameraMode);
  const setWalkTeleportTarget = useStore((s) => s.setWalkTeleportTarget);
  const shellKind = useStudioShellKind();
  const currentProjectId = useStore((s) => s.currentProjectId);
  // Tour mode is exclusive — when active, neither OrbitControls nor
  // WalkControls render; TourCamera fully owns the camera until the
  // path completes (or the user explicitly stops the tour from the
  // top bar).
  const tourActive = useStore((s) => s.tourActive);

  // Free-orbit when inspecting a single piece / panel stage (no room
  // walls to clip into). Apartment + walled generated rooms keep the
  // above-floor clamp. Blank CAD panel used to hit minDistance=3 and
  // feel like zoom/drag were broken.
  const placedCount = useStore(
    (s) => (s.furniture ?? []).filter((f) => f.placed).length,
  );
  const wallCount = useStore((s) => s.walls?.length ?? 0);
  const singlePiecePreview = shellKind === "apartment" && placedCount <= 1;
  const freeOrbit =
    singlePiecePreview ||
    shellKind === "blank" ||
    (shellKind === "generated" && wallCount === 0);

  const defaultPos = CAMERA_PRESETS[0].position;

  const [canvasKey, setCanvasKey] = useState(0);
  const remountCanvas = useCallback(() => {
    setCanvasKey((k) => k + 1);
  }, []);

  return (
      <Canvas
      key={canvasKey}
      camera={{ position: defaultPos, fov: 45, near: 0.1, far: 100 }}
      gl={{
        alpha: true,
        antialias: true,
        // Logarithmic depth eliminates flickering between coplanar
        // surfaces (window glass against walls, layered finishes).
        // The GLB has many of these — without log-depth there is
        // visible z-fighting at distance.
        logarithmicDepthBuffer: true,
        powerPreference: "default",
      }}
      // Cap DPR to reduce VRAM / context-loss risk with HDRI + large GLB.
      dpr={[1, 1.5]}
      style={{ background: "transparent" }}
      onCreated={({ gl }) => {
        // Transparent clear — otherwise the first WebGL frame is an
        // opaque white/black blit before the apartment GLB is in.
        gl.setClearColor(0x000000, 0);
        // Hidden until RevealWhenLit sees the HDRI env map, so the
        // cabinet never shows its unlit (near-black) PBR frame.
        gl.domElement.style.opacity = "0";
      }}
      onPointerMissed={(e) => {
        // Empty click (not on a piece) clears selection so nothing
        // looks selected by default.
        if (e && "button" in e && (e as { button?: number }).button !== 0) {
          return;
        }
        useStore.getState().selectFurniture(null);
      }}
    >
      <GlContextLifecycle onRemountCanvas={remountCanvas} />
      <SceneDropRegistrar />
      <RevealWhenLit />
      {/* Lighting */}
      {cardinalLightsMode ? (
        // v0.40.47/48: model-inspection rig — equal-strength
        // directional lights from each window's outside direction
        // when the scene has windows; falls back to fixed N/S/E/W
        // cardinals when there are none. Each light fills one set
        // of faces so albedo, baked shadows, and one-sided materials
        // show clearly. Ambient is brighter (0.7) and warmer-neutral
        // so the result reads as "studio light" rather than "interior
        // scene." The HDRI <Environment> still contributes for
        // reflections; only the directional rig changes between modes.
        //
        // Coordinate convention: Y-up. World X is east-west, Z is
        // north-south. For each window we place a light OUTSIDE the
        // wall the window sits on, pointing toward the window's
        // midpoint. The outward direction is computed from the
        // window's segment endpoints: a horizontal window (z1 ≈ z2)
        // is on a north or south wall — outside is in the +Z or -Z
        // direction depending on the wall's distance from origin.
        // Likewise vertical windows (x1 ≈ x2) get +X or -X outside.
        <>
          <ambientLight color={0xfff8ee} intensity={0.7} />
          {(() => {
            const windows = (openings ?? []).filter((o) => o.kind === "window");
            if (windows.length === 0) {
              // No windows in scene → use fixed cardinal positions.
              return (
                <>
                  {/* North (+Z) */}
                  <directionalLight
                    color={0xffffff}
                    intensity={0.6}
                    position={[0, 4, 8]}
                  />
                  {/* East (+X) */}
                  <directionalLight
                    color={0xffffff}
                    intensity={0.6}
                    position={[8, 4, 0]}
                  />
                  {/* South (-Z) */}
                  <directionalLight
                    color={0xffffff}
                    intensity={0.6}
                    position={[0, 4, -8]}
                  />
                  {/* West (-X) */}
                  <directionalLight
                    color={0xffffff}
                    intensity={0.6}
                    position={[-8, 4, 0]}
                  />
                </>
              );
            }
            // Place one light per window, on the outside of the
            // wall, casting toward the window's midpoint. Distance
            // 4m beyond the wall keeps the cone wide enough to fill
            // the room without over-exposing edges. Intensity scales
            // 1/N so a many-windowed room doesn't blow out — 0.6 was
            // the per-light intensity for the 4-window cardinal
            // fallback, so we use 0.6 × (4 / N).
            const intensity = 0.6 * (4 / Math.max(windows.length, 4));
            return windows.map((w, i) => {
              const midX = (w.x1 + w.x2) / 2;
              const midZ = (w.z1 + w.z2) / 2;
              const segDX = w.x2 - w.x1;
              const segDZ = w.z2 - w.z1;
              // Outward normal: perpendicular to the segment,
              // pointing away from origin (assume room is roughly
              // centered at 0,0).
              const horizontal = Math.abs(segDX) > Math.abs(segDZ);
              let outX = 0,
                outZ = 0;
              if (horizontal) {
                outZ = midZ >= 0 ? 1 : -1; // outside above/below
              } else {
                outX = midX >= 0 ? 1 : -1; // outside right/left
              }
              const dist = 4;
              return (
                <directionalLight
                  key={w.id ?? `win-${i}`}
                  color={0xffffff}
                  intensity={intensity}
                  position={[midX + outX * dist, 4, midZ + outZ * dist]}
                />
              );
            });
          })()}
        </>
      ) : (
        <>
          <ambientLight color={0xfff2e4} intensity={0.45} />
          <directionalLight
            color={0xffd8b0}
            intensity={0.8}
            position={[5, 7, 4]}
          />
          <directionalLight
            color={0xffffff}
            intensity={0.18}
            position={[-4, 3, -2]}
          />
        </>
      )}

      {/* HDRI + PBR meshes in one boundary so the cabinet does not
          paint a dark unlit frame, then pop to IBL. Inner fallback
          is null so R3F's Block does not unmount the <canvas>. */}
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

        {(shellKind === "blank" ||
          (shellKind === "generated" && wallCount === 0)) && (
          <PanelStageGround />
        )}

        <FurnitureMeshes />
      </Suspense>

      {/* Renders an orange wireframe box around the currently-
          selected inventory item's meshes. Reads from the slice
          and recomputes only when selection / placement / visibility
          changes — no per-frame cost. */}
      <SelectionIndicator />

      {/* Rotation gizmo (Phase C2-redux). Orange torus around the
          selected item; drag to rotate, hold Shift to snap to 15°.
          Self-gates on selectedId, cameraMode === "orbit", and
          !tourActive. Writes to setItemTransform; the Apartment
          subscriber picks up the rotation field and writes it
          to the item's wrapping group. Pure assignment, no drift. */}
      <RotationGizmo />

      {/* Translation gizmo — drag the currently-selected item across
          the floor. Behavior-only mount (renders nothing). Press on
          the selected item's mesh body, drag to translate, release
          to drop. Disables OrbitControls during the drag so the
          camera doesn't orbit at the same time. Locked items are
          skipped. */}
      <TranslationGizmo />

      {/* AxisHandles — visible axis arrows for explicit X/Z drag.
          Self-gates on translateMode (default off). Sibling to
          TranslationGizmo: TranslationGizmo gives users always-on
          body-drag (click + drag the piece itself), AxisHandles
          adds visible arrows when the user wants axis-constrained
          motion. Both write to setItemTransform. */}
      <AxisHandles />

      {/* Collision outlines disabled (was: <CollisionOutlines />). The
          red wireframe overlay was intended as a "this is wrong" hint
          when items overlap, but on initial catalog seed many items
          share the same centroid, so the indicator paints every piece
          red and reads as broken UI rather than helpful warning. F4
          Health's overlap row covers the same data without the visual
          noise. Re-enable by importing + mounting if you want it back
          for a specific debugging session. */}
      {/* Floor hotspots — only rendered in orbit mode and outside
          tour playback. Clicking one stashes the (x, z) into the
          slice's walkTeleportTarget, flips cameraMode to "walk",
          and WalkControls picks up the target on its next frame. */}
      {cameraMode === "orbit" && !tourActive && !freeOrbit && (
        <FloorHotspots
          onPick={([x, _y, z]) => {
            setWalkTeleportTarget({ x, z });
            setCameraMode("walk");
          }}
        />
      )}

      {/* Camera controls — exactly one of three modes is active:
          tour (TourCamera), walk (WalkControls), or orbit
          (OrbitControls). Switching unmounts the previous one so
          neither's frame handlers run while inactive. */}
      {tourActive ? (
        <TourCamera />
      ) : cameraMode === "orbit" ? (
        <OrbitControls
          // Don't pass a fixed `target` — CameraController owns the
          // look-at point; a prop here fought pan/zoom after framing.
          enableDamping
          dampingFactor={0.08}
          enablePan
          enableZoom
          enableRotate
          zoomSpeed={1.1}
          panSpeed={1.0}
          rotateSpeed={0.9}
          // Free panel: allow a comfortable pull-back without going
          // room-scale (old 80 left pieces as specks).
          minDistance={freeOrbit ? 0.08 : 1.2}
          maxDistance={freeOrbit ? 24 : 40}
          minPolarAngle={freeOrbit ? 0 : 0.1}
          maxPolarAngle={freeOrbit ? Math.PI : Math.PI / 2 - 0.05}
          makeDefault
        />
      ) : (
        <WalkControls />
      )}

      {/* CameraController is paused implicitly during tour because
          tourActive blocks any new fly target from being set, but
          we keep it mounted so post-tour resets / shuffles still
          work as soon as the tour ends. */}
      <CameraController />
    </Canvas>
  );
}

// Start the default HDRI download with the Scene module so the
// cabinet is not waiting on a cold fetch after first paint.
useEnvironment.preload({ preset: "apartment" });
