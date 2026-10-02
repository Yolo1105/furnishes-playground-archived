"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "@studio/store";
import { isPanelOnlyFurniture } from "@studio/cad/draftRoom";
import {
  CAMERA_PRESETS,
  panelOrbitFrame,
} from "@studio/three/cameraPresets";

/**
 * Listens to the store's camera-control values and animates the
 * camera + orbit-controls target accordingly.
 *
 *   • `cameraResetVersion` bumps      — fly to default / panel frame
 *   • `cameraPresetIndex` changes     — fly to that preset
 *   • `pendingCameraFly.version` bumps — fly to its position+target
 *
 * Blank panel-only scenes use a tighter orbit frame so the single
 * board fills the view instead of the room-scale default.
 *
 * Critical: any OrbitControls interaction cancels an in-flight lerp
 * so zoom / pan / orbit are not yanked back to the boot pose.
 */

const LERP_SPEED = 4.5;
const FINISHED_EPS = 0.005;

interface PendingFly {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

type OrbitControlsLike = {
  target: THREE.Vector3;
  update: () => void;
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
};

export function CameraController() {
  const { camera, controls } = useThree() as {
    camera: THREE.PerspectiveCamera;
    controls: OrbitControlsLike | null;
  };

  const cameraResetVersion = useStore((s) => s.cameraResetVersion);
  const cameraPresetIndex = useStore((s) => s.cameraPresetIndex);
  const pendingCameraFly = useStore((s) => s.pendingCameraFly);
  const apartmentCenter = useStore((s) => s.apartmentCenter);
  const roomMeta = useStore((s) => s.roomMeta);
  const furniture = useStore((s) => s.furniture);
  const blankScene = useStore((s) =>
    Boolean(s.projects.find((p) => p.id === s.currentProjectId)?.blankScene),
  );

  const panelOnly =
    blankScene && isPanelOnlyFurniture(furniture ?? []) && roomMeta != null;

  const pending = useRef<PendingFly | null>(null);
  const appliedKey = useRef<string | null>(null);

  const offset = (vec: THREE.Vector3): THREE.Vector3 => {
    if (!apartmentCenter) return vec;
    return new THREE.Vector3(
      vec.x + apartmentCenter[0],
      vec.y,
      vec.z + apartmentCenter[1],
    );
  };

  const buildDefaultFrame = (): PendingFly => {
    if (panelOnly && roomMeta) {
      const p = panelOrbitFrame(roomMeta.height);
      return {
        position: offset(new THREE.Vector3(...p.position)),
        target: offset(new THREE.Vector3(...p.target)),
      };
    }
    const p = CAMERA_PRESETS[0]!;
    return {
      position: offset(new THREE.Vector3(...p.position)),
      target: offset(new THREE.Vector3(...p.target)),
    };
  };

  const subjectKey = (() => {
    if (!apartmentCenter) return null;
    return panelOnly
      ? `panel:${roomMeta?.height ?? 0}:${apartmentCenter[0].toFixed(3)}:${apartmentCenter[1].toFixed(3)}`
      : `room:${apartmentCenter[0].toFixed(3)}:${apartmentCenter[1].toFixed(3)}`;
  })();

  // Cancel programmatic fly as soon as the user grabs the orbit.
  useEffect(() => {
    if (!controls?.addEventListener) return;
    const cancel = () => {
      pending.current = null;
    };
    controls.addEventListener("start", cancel);
    controls.addEventListener("end", cancel);
    return () => {
      controls.removeEventListener?.("start", cancel);
      controls.removeEventListener?.("end", cancel);
    };
  }, [controls]);

  const prevReset = useRef(cameraResetVersion);
  const prevPreset = useRef(cameraPresetIndex);
  const prevFlyVersion = useRef(pendingCameraFly?.version ?? 0);

  // Explicit top-bar / fly requests only — never on ambient store churn.
  useEffect(() => {
    let next: PendingFly | null = null;

    if (cameraResetVersion !== prevReset.current) {
      next = buildDefaultFrame();
      appliedKey.current = subjectKey;
    } else if (cameraPresetIndex !== prevPreset.current) {
      if (panelOnly && roomMeta) {
        const base = panelOrbitFrame(roomMeta.height);
        const idx = cameraPresetIndex % 4;
        const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
        const a = angles[idx]!;
        const dist = Math.hypot(base.position[0], base.position[2]);
        next = {
          position: offset(
            new THREE.Vector3(
              Math.sin(a) * dist,
              base.position[1],
              Math.cos(a) * dist,
            ),
          ),
          target: offset(new THREE.Vector3(...base.target)),
        };
      } else {
        const p = CAMERA_PRESETS[cameraPresetIndex % CAMERA_PRESETS.length]!;
        next = {
          position: offset(new THREE.Vector3(...p.position)),
          target: offset(new THREE.Vector3(...p.target)),
        };
      }
    } else if (
      pendingCameraFly &&
      pendingCameraFly.version !== prevFlyVersion.current
    ) {
      next = {
        position: new THREE.Vector3(...pendingCameraFly.position),
        target: new THREE.Vector3(...pendingCameraFly.target),
      };
    }

    prevReset.current = cameraResetVersion;
    prevPreset.current = cameraPresetIndex;
    prevFlyVersion.current = pendingCameraFly?.version ?? 0;

    if (next) pending.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraResetVersion, cameraPresetIndex, pendingCameraFly]);

  // One-shot initial frame when the stage center first appears (or
  // panel height jumps). Does not re-fire while the user is orbiting.
  useEffect(() => {
    if (!subjectKey) return;
    if (appliedKey.current === subjectKey) return;
    appliedKey.current = subjectKey;
    pending.current = buildDefaultFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey]);

  useFrame((_, delta) => {
    const fly = pending.current;
    if (!fly) return;

    const t = 1 - Math.exp(-LERP_SPEED * delta);

    camera.position.lerp(fly.position, t);
    if (controls) {
      controls.target.lerp(fly.target, t);
      controls.update();
    }

    if (
      camera.position.distanceTo(fly.position) < FINISHED_EPS &&
      (!controls || controls.target.distanceTo(fly.target) < FINISHED_EPS)
    ) {
      camera.position.copy(fly.position);
      if (controls) {
        controls.target.copy(fly.target);
        controls.update();
      }
      pending.current = null;
    }
  });

  return null;
}
