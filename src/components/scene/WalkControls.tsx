"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "@studio/store";
import { pointCollidesWithWalls } from "@studio/collision";

/**
 * First-person walk controls. Active only while
 * `useStore(s).cameraMode === "walk"`. Implements:
 *
 *   • **Pointer-lock mouse-look** — clicking the canvas locks the
 *     pointer to the canvas, mouse motion rotates the camera. The
 *     browser releases the lock when the user presses Esc.
 *
 *   • **WASD / arrow movement** — camera moves along its current
 *     forward / right vectors at a fixed walking pace, with a
 *     short acceleration ramp so direction changes feel natural.
 *     Holding Shift sprints.
 *
 *   • **Wall collision** — extracted wall segments form an axis-
 *     independent collision check: we try the X movement and Z
 *     movement separately, reverting either axis if it would put
 *     the camera inside a wall. Lets the user slide along walls
 *     instead of getting fully stuck on diagonal contacts.
 *
 *   • **Eye height** — Y is held at ~1.6 m (a typical adult
 *     standing eye height) regardless of the camera's previous
 *     position. Smoothly interpolated on entry so the camera
 *     "settles" into walk height rather than snapping.
 *
 *   • **Click-to-walk teleport** — when a hotspot is clicked, the
 *     hotspot dispatcher writes (x, z) into the slice's
 *     `walkTeleportTarget`; this component consumes it on the
 *     next frame, snapping the camera there and clearing the
 *     field. Used to enter walk mode from a specific floor spot.
 *
 * Mounted inside the R3F canvas (so `useFrame` resolves) and
 * conditionally rendered by the Scene only while walk mode is
 * active. Returns null because all its work is imperative state
 * mutation; nothing in the React tree.
 */

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 2.6; // m/s, normal walk pace
const SPRINT_SPEED = 5.0;
const BODY_RADIUS = 0.25; // person's collision radius
const ACCEL_TAU = 0.12; // velocity smoothing time constant
const MOUSE_SENSITIVITY = 0.0025;

// Wall collision lives in lib/collision/walls.ts; we previously had
// an inline implementation but Stage B2 moved it into the shared
// collision module so door-clearance, rotation gizmo, and the
// AI-generation validator can all reuse the same primitive.

export function WalkControls() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const walls = useStore((s) => s.walls);
  const apartmentCenter = useStore((s) => s.apartmentCenter);
  const walkTeleportTarget = useStore((s) => s.walkTeleportTarget);
  const setWalkTeleportTarget = useStore((s) => s.setWalkTeleportTarget);
  const setCameraMode = useStore((s) => s.setCameraMode);

  const keys = useRef({
    w: false,
    a: false,
    s: false,
    d: false,
    shift: false,
  });
  const velocity = useRef(new THREE.Vector3());
  const targetVel = useRef(new THREE.Vector3());
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  // Yaw/pitch we maintain ourselves so pointer-lock motion translates
  // to a clean Euler. Three's camera.rotation accumulates roll
  // otherwise.
  const yaw = useRef(0);
  const pitch = useRef(0);

  // ── Spawn-on-mount: camera enters walk mode at the apartment's
  //    X/Z center, eye height. Otherwise the camera inherits the
  //    orbit-mode position which is high outside the apartment, so
  //    walk mode would start with a view of the building's exterior
  //    (not what the user wants — they want to be standing inside
  //    the room). The teleport target takes precedence if set
  //    (hotspot click → walk), but the default mount is a center
  //    drop. Pitch resets to 0 (looking horizontally), yaw is left
  //    inherited so the user keeps a sensible facing direction.
  useEffect(() => {
    // Teleport target wins; if it's set, the per-frame loop will
    // handle the position snap instead.
    if (walkTeleportTarget) return;
    if (apartmentCenter) {
      const [cx, cz] = apartmentCenter;
      camera.position.set(cx, EYE_HEIGHT, cz);
    } else {
      // No apartment center yet (GLB still loading) — at least
      // pin Y to eye height so we're not at the orbit altitude.
      camera.position.y = EYE_HEIGHT;
    }
    pitch.current = 0;
    // We deliberately don't reset yaw — keeping the user's last
    // facing direction is more natural than snapping to north.
  }, []); // mount-only; later teleports go through walkTeleportTarget

  // ── Pointer lock + Esc-to-exit ─────────────────────────────────
  useEffect(() => {
    const dom = gl.domElement;

    // Initialize yaw/pitch from the camera's current orientation so
    // the first frame doesn't snap the view to (0, 0).
    const initEuler = new THREE.Euler().setFromQuaternion(
      camera.quaternion,
      "YXZ",
    );
    yaw.current = initEuler.y;
    pitch.current = initEuler.x;

    const tryLock = () => {
      if (document.pointerLockElement !== dom) {
        // requestPointerLock returns a promise in modern browsers;
        // older ones return undefined. Either way, the failure case
        // is handled by the user clicking again.
        const r = dom.requestPointerLock?.();
        if (r && typeof (r as Promise<void>).catch === "function") {
          (r as Promise<void>).catch(() => {});
        }
      }
    };

    // Try to lock immediately on mount, plus on every click.
    const t = setTimeout(tryLock, 50);
    const onClick = () => tryLock();
    dom.addEventListener("click", onClick);

    // Mouse-look: only consume motion while pointer is locked.
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== dom) return;
      yaw.current -= e.movementX * MOUSE_SENSITIVITY;
      pitch.current -= e.movementY * MOUSE_SENSITIVITY;
      // Clamp pitch so the user can't tilt past straight up/down.
      const limit = Math.PI / 2 - 0.05;
      pitch.current = Math.max(-limit, Math.min(limit, pitch.current));
    };
    document.addEventListener("mousemove", onMouseMove);

    // Esc release is handled by the browser pointer-lock spec; we
    // Browser-native Esc releases pointer lock. We treat that as
    // an intentional exit signal: user pressed Esc, which means
    // "I'm done with walk mode" — flip back to orbit. We track
    // whether the lock was ever acquired so the initial mount-
    // time non-locked state doesn't immediately bounce us out.
    let everLocked = false;
    const onLockChange = () => {
      if (document.pointerLockElement === dom) {
        everLocked = true;
        return;
      }
      // Lock was released. If we'd previously been locked, treat
      // this as the user's exit gesture and flip back to orbit.
      // The walk-mode button in the top bar reflects cameraMode,
      // so it will visually deselect on this state change.
      if (everLocked) setCameraMode("orbit");
    };
    document.addEventListener("pointerlockchange", onLockChange);

    return () => {
      clearTimeout(t);
      dom.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      // Release the lock when leaving walk mode so the user gets
      // their cursor back.
      if (document.pointerLockElement === dom) {
        document.exitPointerLock?.();
      }
    };
  }, [gl, camera]);

  // ── WASD key listeners ─────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") keys.current.w = true;
      if (k === "s" || k === "arrowdown") keys.current.s = true;
      if (k === "a" || k === "arrowleft") keys.current.a = true;
      if (k === "d" || k === "arrowright") keys.current.d = true;
      if (k === "shift") keys.current.shift = true;
      // Esc exits walk mode entirely. Pressing it also releases
      // pointer lock via the browser.
      if (k === "escape") setCameraMode("orbit");
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") keys.current.w = false;
      if (k === "s" || k === "arrowdown") keys.current.s = false;
      if (k === "a" || k === "arrowleft") keys.current.a = false;
      if (k === "d" || k === "arrowright") keys.current.d = false;
      if (k === "shift") keys.current.shift = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setCameraMode]);

  // ── Per-frame: apply rotation, integrate velocity, collide ────
  useFrame((_, dt) => {
    // Rotate camera from our maintained yaw/pitch. Order is YXZ so
    // pitch is applied AFTER yaw — same convention pointer-lock
    // first-person controls always use.
    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw.current;
    camera.rotation.x = pitch.current;
    camera.rotation.z = 0;

    // Compute forward (camera-direction projected onto floor) and
    // right (cross with world-up). These drive WASD movement along
    // the horizontal plane only — ignoring pitch — so looking up
    // doesn't slow you down.
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    forward.current.normalize();
    right.current.crossVectors(forward.current, camera.up).normalize();

    const speed = keys.current.shift ? SPRINT_SPEED : WALK_SPEED;
    targetVel.current.set(0, 0, 0);
    if (keys.current.w)
      targetVel.current.addScaledVector(forward.current, speed);
    if (keys.current.s)
      targetVel.current.addScaledVector(forward.current, -speed);
    if (keys.current.d) targetVel.current.addScaledVector(right.current, speed);
    if (keys.current.a)
      targetVel.current.addScaledVector(right.current, -speed);

    // Exponential smoothing toward target velocity — small ACCEL_TAU
    // means crisp response, larger TAU means softer ramp.
    const alpha = 1 - Math.exp(-dt / ACCEL_TAU);
    velocity.current.lerp(targetVel.current, alpha);

    // Click-to-walk teleport. Flushed before the integrate step so
    // the user starts at rest at the new position.
    if (walkTeleportTarget) {
      camera.position.x = walkTeleportTarget.x;
      camera.position.z = walkTeleportTarget.z;
      velocity.current.set(0, 0, 0);
      setWalkTeleportTarget(null);
      return;
    }

    // Try X and Z movements independently so the user can slide
    // along walls instead of jamming on diagonals.
    const stepX = velocity.current.x * dt;
    const stepZ = velocity.current.z * dt;

    const haveWalls = walls.length > 0;
    const prevX = camera.position.x;
    const prevZ = camera.position.z;

    camera.position.x = prevX + stepX;
    if (
      haveWalls &&
      pointCollidesWithWalls(camera.position.x, prevZ, BODY_RADIUS, walls)
    ) {
      camera.position.x = prevX;
      velocity.current.x = 0;
    }
    camera.position.z = prevZ + stepZ;
    if (
      haveWalls &&
      pointCollidesWithWalls(
        camera.position.x,
        camera.position.z,
        BODY_RADIUS,
        walls,
      )
    ) {
      camera.position.z = prevZ;
      velocity.current.z = 0;
    }

    // Settle Y to eye height. Using a soft lerp rather than a
    // hard set so entering walk mode from a high orbit position
    // isn't a jarring teleport.
    const targetY = EYE_HEIGHT;
    camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 8);

    // Defensive bounds: if for some reason the camera ends up
    // way outside the apartment (collision miss, teleport bug),
    // pull it back to the apartment center. Without this the user
    // could end up flying through empty space with no walls to
    // collide against.
    if (apartmentCenter) {
      const [cx, cz] = apartmentCenter;
      const FAR = 30;
      if (
        Math.abs(camera.position.x - cx) > FAR ||
        Math.abs(camera.position.z - cz) > FAR
      ) {
        camera.position.x = cx;
        camera.position.z = cz;
        velocity.current.set(0, 0, 0);
      }
    }
  });

  return null;
}
