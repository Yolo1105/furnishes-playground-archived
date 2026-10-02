"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useStore } from "@studio/store";
import { resolveStudioY } from "@studio/collision/magneticSnap";

/**
 * Rotation gizmo — floating bubble above the selected piece.
 *
 * v0.40.23 redesign expands the bubble to handle ALL three rotation
 * axes, not just yaw. Why: TripoSR's output orientation is non-canonical
 * per their published paper (the model "guesses" camera params during
 * inference). Even with the strongest possible image-prompt pinning,
 * some pieces come out tilted or lying on their side. The user needs
 * a fast manual fix that doesn't require leaving the studio.
 *
 * Layout — 2 rows × 3 buttons:
 *
 *   [↶ yaw]   [yaw°]   [yaw ↷]      ← rotate around Y (existing)
 *   [↺ pitch] [reset]  [roll ↻]     ← rotate around X / Z, or reset
 *
 * Yaw is stored on PlacedItem.rotation (degrees, around Y) — the
 * existing convention used by the layout pipeline + 2D floor plan.
 * Pitch (X) and roll (Z) are stored in meta.pitchDeg / meta.rollDeg
 * because (a) only generated GLB pieces need them — the apartamento.glb
 * pieces are already correctly oriented, and (b) extending the
 * top-level rotation field would touch every consumer (gizmos,
 * persistence, the layout engine). Storing in meta keeps the change
 * scoped.
 *
 * Reset clears pitch + roll (sets both to 0) and snaps yaw to the
 * nearest 90° multiple. Useful when the user has fiddled with several
 * rotations and wants a clean slate.
 *
 * Visibility: gated on rotateMode === "cardinal" (topbar Up/Down/L/R).
 * Compact D-pad sits on the selected panel in English, fixed screen size.
 */

const ACCENT = "#FF5A1F";

export function RotationGizmo() {
  const selectedId = useStore((s) => s.selectedId);
  const cameraMode = useStore((s) => s.cameraMode);
  const tourActive = useStore((s) => s.tourActive);
  const rotateMode = useStore((s) => s.rotateMode);
  const item = useStore((s) =>
    s.selectedId ? s.furniture.find((f) => f.id === s.selectedId) : null,
  );
  const setItemTransform = useStore((s) => s.setItemTransform);
  const patchItemMeta = useStore(
    (s) =>
      (
        s as unknown as {
          patchItemMeta?: (id: string, meta: Record<string, unknown>) => void;
        }
      ).patchItemMeta,
  );

  // Hover/pulse state for each button. We track them individually so
  // the visual pulse animation lands on exactly the button the user
  // clicked.
  const [hoverYawLeft, setHoverYawLeft] = useState(false);
  const [hoverYawRight, setHoverYawRight] = useState(false);
  const [hoverPitch, setHoverPitch] = useState(false);
  const [hoverRoll, setHoverRoll] = useState(false);
  const [hoverReset, setHoverReset] = useState(false);
  const [pulse, setPulse] = useState<
    null | "yaw-left" | "yaw-right" | "pitch" | "roll" | "reset"
  >(null);

  useEffect(() => {
    setHoverYawLeft(false);
    setHoverYawRight(false);
    setHoverPitch(false);
    setHoverRoll(false);
    setHoverReset(false);
  }, [selectedId]);

  if (
    !selectedId ||
    !item ||
    cameraMode !== "orbit" ||
    tourActive ||
    rotateMode !== "cardinal"
  )
    return null;

  const meta = item.meta as
    | { source?: string; pitchDeg?: number; rollDeg?: number }
    | undefined;

  // Pulse helper — tags the button that just fired so its style
  // briefly inverts to accent-filled.
  const fire = (which: NonNullable<typeof pulse>) => {
    setPulse(which);
    window.setTimeout(() => setPulse(null), 220);
  };

  // Yaw: rotate around Y. PlacedItem.rotation in degrees, normalized
  // into [-180, 180] after each click.
  const yawBy = (deltaDeg: number, side: "yaw-left" | "yaw-right") => {
    const next = ((item.rotation + deltaDeg + 540) % 360) - 180;
    setItemTransform(item.id, { rotation: next });
    fire(side);
  };

  // ── Quaternion-based pitch/roll (v0.40.30) ────────────────────
  //
  // Why quaternions instead of Euler `pitchDeg` + `rollDeg`?
  // Earlier versions stored pitch and roll as separate float fields
  // and applied them via `<group rotation={[pitchRad, 0, rollRad]}>`.
  // That uses Three.js's default Euler XYZ order: pitch (X) is
  // applied first, which tilts the local Z axis, so the subsequent
  // roll rotation no longer rotates around the WORLD Z axis. From
  // the user's perspective, clicking "roll 90°" after clicking
  // "pitch 90°" produced an unexpected combined rotation — the
  // user reported "Z rotation doesn't work properly."
  //
  // Quaternion premultiply (left-multiply) by a world-axis delta
  // gives each button click a clean WORLD-axis rotation regardless
  // of any prior orientation. Pitch always rotates around world X;
  // roll always rotates around world Z. No gimbal coupling.
  //
  // Storage: `meta.orientationQuat = [x, y, z, w]` — Three.js
  // standard quaternion order. Reset writes [0,0,0,1] (identity).
  // Legacy items with `pitchDeg`/`rollDeg` but no `orientationQuat`
  // are migrated below: we compose an Euler quaternion from their
  // legacy values so the visual orientation is preserved across
  // the upgrade.
  const readQuat = (): THREE.Quaternion => {
    const q = (
      meta as { orientationQuat?: [number, number, number, number] } | undefined
    )?.orientationQuat;
    if (q && q.length === 4) {
      return new THREE.Quaternion(q[0], q[1], q[2], q[3]);
    }
    // Migrate from legacy pitchDeg/rollDeg if present.
    const pitchRad = ((meta?.pitchDeg ?? 0) * Math.PI) / 180;
    const rollRad = ((meta?.rollDeg ?? 0) * Math.PI) / 180;
    const e = new THREE.Euler(pitchRad, 0, rollRad, "XYZ");
    return new THREE.Quaternion().setFromEuler(e);
  };

  const writeQuat = (q: THREE.Quaternion) => {
    patchItemMeta?.(item.id, {
      orientationQuat: [q.x, q.y, q.z, q.w] as [number, number, number, number],
      // Clear legacy fields so they don't compete on future reads.
      pitchDeg: 0,
      rollDeg: 0,
    });
  };

  // Pitch: premultiply current orientation by a 90° rotation around
  // world X. Premultiply (delta * cur, not cur * delta) is the key —
  // it expresses "rotate the already-oriented object further around
  // the WORLD axis," which matches user intent.
  const pitchBy = (deltaDeg: number) => {
    const cur = readQuat();
    const delta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      (deltaDeg * Math.PI) / 180,
    );
    writeQuat(delta.multiply(cur));
    fire("pitch");
  };

  // Roll: premultiply by 90° around world Z.
  const rollBy = (deltaDeg: number) => {
    const cur = readQuat();
    const delta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (deltaDeg * Math.PI) / 180,
    );
    writeQuat(delta.multiply(cur));
    fire("roll");
  };

  // Reset: clear orientation quat to identity; snap yaw to nearest
  // 90° multiple. Also clears the legacy pitchDeg/rollDeg explicitly
  // (writeQuat already does this, but reset is the user's "make it
  // upright" button so being explicit reduces surprise if either
  // field was set externally).
  const resetOrientation = () => {
    const snappedYaw = Math.round(item.rotation / 90) * 90;
    const normalized = ((snappedYaw + 540) % 360) - 180;
    setItemTransform(item.id, { rotation: normalized });
    patchItemMeta?.(item.id, {
      orientationQuat: [0, 0, 0, 1] as [number, number, number, number],
      pitchDeg: 0,
      rollDeg: 0,
    });
    fire("reset");
  };

  // Anchor on the panel body (center height), not floating high above.
  const panelY = resolveStudioY(item);

  // Compact screen-space buttons (Html without distanceFactor stays
  // fixed pixel size — distanceFactor={8} was blowing them up close-up).
  const btnStyle = (
    isHovered: boolean,
    isPulsing: boolean,
  ): React.CSSProperties => ({
    width: 22,
    height: 22,
    borderRadius: 5,
    border: "1px solid rgba(124, 80, 50, 0.2)",
    padding: 0,
    background: isPulsing
      ? ACCENT
      : isHovered
        ? "rgba(255, 90, 31, 0.14)"
        : "rgba(255, 255, 255, 0.92)",
    color: isPulsing ? "white" : isHovered ? ACCENT : "rgba(26, 26, 26, 0.78)",
    borderColor: isHovered
      ? "rgba(255, 90, 31, 0.5)"
      : "rgba(124, 80, 50, 0.2)",
    cursor: "pointer",
    fontFamily: "var(--font-app), system-ui, sans-serif",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition:
      "background 0.12s ease, color 0.12s ease, border-color 0.12s ease",
    transform: isPulsing ? "scale(0.94)" : "scale(1)",
    userSelect: "none",
    lineHeight: 1,
  });

  const swallow = (e: React.SyntheticEvent) => e.stopPropagation();

  const ResetIcon = () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12a9 9 0 1 0 9-9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <polyline
        points="12 3 12 8 17 8"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );

  return (
    <Html
      position={[item.x, panelY, item.z]}
      center
      zIndexRange={[20, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div
        onPointerDown={swallow}
        onPointerUp={swallow}
        onClick={swallow}
        style={{
          pointerEvents: "auto",
          display: "grid",
          gridTemplateColumns: "22px 22px 22px",
          gridTemplateRows: "22px 22px 22px",
          gap: 2,
          padding: 3,
          borderRadius: 8,
          background: "rgba(255, 251, 246, 0.94)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          boxShadow: "0 4px 12px -4px rgba(0, 0, 0, 0.18)",
          border: "1px solid rgba(124, 80, 50, 0.16)",
        }}
      >
        <span />
        <button
          type="button"
          aria-label="Up 90°"
          title="Up — tip 90°"
          style={btnStyle(hoverPitch, pulse === "pitch")}
          onMouseEnter={() => setHoverPitch(true)}
          onMouseLeave={() => setHoverPitch(false)}
          onClick={(e) => {
            swallow(e);
            pitchBy(90);
          }}
        >
          Up
        </button>
        <span />

        <button
          type="button"
          aria-label="Left 90°"
          title="Left — yaw 90°"
          style={btnStyle(hoverYawLeft, pulse === "yaw-left")}
          onMouseEnter={() => setHoverYawLeft(true)}
          onMouseLeave={() => setHoverYawLeft(false)}
          onClick={(e) => {
            swallow(e);
            yawBy(-90, "yaw-left");
          }}
        >
          L
        </button>
        <button
          type="button"
          aria-label="Reset orientation"
          title={`Reset · yaw ${Math.round(item.rotation)}°`}
          style={btnStyle(hoverReset, pulse === "reset")}
          onMouseEnter={() => setHoverReset(true)}
          onMouseLeave={() => setHoverReset(false)}
          onClick={(e) => {
            swallow(e);
            resetOrientation();
          }}
        >
          <ResetIcon />
        </button>
        <button
          type="button"
          aria-label="Right 90°"
          title="Right — yaw 90°"
          style={btnStyle(hoverYawRight, pulse === "yaw-right")}
          onMouseEnter={() => setHoverYawRight(true)}
          onMouseLeave={() => setHoverYawRight(false)}
          onClick={(e) => {
            swallow(e);
            yawBy(90, "yaw-right");
          }}
        >
          R
        </button>

        <span />
        <button
          type="button"
          aria-label="Down 90°"
          title="Down — tip 90°"
          style={btnStyle(hoverRoll, pulse === "roll")}
          onMouseEnter={() => setHoverRoll(true)}
          onMouseLeave={() => setHoverRoll(false)}
          onClick={(e) => {
            swallow(e);
            pitchBy(-90);
            fire("roll");
          }}
        >
          Dn
        </button>
        <span />
      </div>
    </Html>
  );
}
