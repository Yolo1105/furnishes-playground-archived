"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useStore } from "@studio/store";

/**
 * Animates the camera along the customWaypoints polyline while
 * `tourActive` is true. The camera walks the path at a fixed
 * speed, looking forward along the next segment, with smoothed
 * yaw rotation so direction changes through corners don't snap.
 *
 * Mounted instead of WalkControls inside the Canvas while a tour
 * is playing — Scene routes between the two on `tourActive`.
 *
 * Behaviour:
 *   • Eye height locks to 1.6m.
 *   • Forward speed 1.4 m/s — relaxed walking pace.
 *   • Loops at the end (returning to waypoint 0) until the user
 *     calls `stopTour` (top-bar Tour button toggle, or Esc key).
 *
 * Why bake yaw control into this component rather than reusing
 * WalkControls' yaw refs? WalkControls is unmounted while a
 * tour is active; its refs aren't accessible. Computing yaw
 * here from the path direction is also cleaner — the camera
 * always faces "where it's going" without inheriting whatever
 * the user was looking at when they started the tour.
 */

const EYE_HEIGHT = 1.6;
const TOUR_SPEED = 1.4; // m/s
const YAW_SMOOTHING = 6; // higher = snappier turns through corners

export function TourCamera() {
  const camera = useThree((s) => s.camera);
  const tourActive = useStore((s) => s.tourActive);
  const tourPath = useStore((s) => s.tourPath);
  const stopTour = useStore((s) => s.stopTour);
  const setTourProgress = useStore((s) => s.setTourProgress);

  // Path progress in metres along the polyline. Reset whenever a
  // tour starts so we always begin at waypoint 0.
  const distance = useRef(0);
  // Maintained yaw, lerped toward the segment direction so the
  // camera turns gracefully through waypoints rather than snapping.
  const yaw = useRef<number | null>(null);
  // Throttle progress writes so we don't spam zustand 60×/second
  // for what's effectively a UI-only signal. 100ms cadence is
  // smooth enough for a progress bar without churning re-renders.
  const lastProgressWrite = useRef(0);

  useEffect(() => {
    if (tourActive) {
      distance.current = 0;
      yaw.current = null;
      lastProgressWrite.current = 0;
      setTourProgress(0);
    }
  }, [tourActive, setTourProgress]);

  // Esc stops the tour (in addition to the top-bar Tour toggle).
  useEffect(() => {
    if (!tourActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopTour();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tourActive, stopTour]);

  useFrame((_, dt) => {
    if (!tourActive) return;
    if (tourPath.length < 2) {
      stopTour();
      return;
    }

    // Total polyline length and per-segment lengths, recomputed
    // each frame so edits to tourPath during playback reflow the
    // path immediately. Negligible cost at <50 waypoints.
    let total = 0;
    const segLens: number[] = [];
    for (let i = 1; i < tourPath.length; i++) {
      const dx = tourPath[i].x - tourPath[i - 1].x;
      const dz = tourPath[i].z - tourPath[i - 1].z;
      const len = Math.hypot(dx, dz);
      segLens.push(len);
      total += len;
    }
    if (total <= 0) {
      stopTour();
      return;
    }

    distance.current += TOUR_SPEED * dt;
    if (distance.current >= total) distance.current -= total; // loop

    // Live progress fraction for any UI listeners (the in-canvas
    // tour overlay subscribes to it). Throttled to 10 Hz so we
    // don't churn zustand at the canvas's 60 Hz frame rate.
    lastProgressWrite.current += dt;
    if (lastProgressWrite.current > 0.1) {
      setTourProgress(distance.current / total);
      lastProgressWrite.current = 0;
    }

    // Find which segment we're on and how far along it.
    let acc = 0;
    let segIdx = 0;
    for (let i = 0; i < segLens.length; i++) {
      if (acc + segLens[i] >= distance.current) {
        segIdx = i;
        break;
      }
      acc += segLens[i];
    }
    const segStart = tourPath[segIdx];
    const segEnd = tourPath[segIdx + 1];
    const segT =
      segLens[segIdx] > 0 ? (distance.current - acc) / segLens[segIdx] : 0;

    // Position: linear interpolation along the active segment.
    camera.position.x = segStart.x + (segEnd.x - segStart.x) * segT;
    camera.position.z = segStart.z + (segEnd.z - segStart.z) * segT;
    camera.position.y = EYE_HEIGHT;

    // Yaw: face forward along the path. three.js camera default
    // looks down -Z; atan2(-dx, -dz) gives the yaw to face (dx, dz).
    const dx = segEnd.x - segStart.x;
    const dz = segEnd.z - segStart.z;
    const targetYaw = Math.atan2(-dx, -dz);

    if (yaw.current === null) {
      yaw.current = targetYaw;
    } else {
      // Shortest-path lerp on the unit circle: bring the delta
      // into [-π, π) before scaling, so 359° → 1° doesn't sweep
      // the long way around.
      let delta = targetYaw - yaw.current;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      const alpha = 1 - Math.exp(-YAW_SMOOTHING * dt);
      yaw.current += delta * alpha;
    }

    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw.current;
    camera.rotation.x = 0;
    camera.rotation.z = 0;
  });

  return null;
}
