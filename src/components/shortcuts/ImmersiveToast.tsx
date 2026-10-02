"use client";

import { useEffect, useState } from "react";
import { useStore } from "@studio/store";

/**
 * Top-center toast that appears the moment immersive mode is entered
 * and tells the user how to exit. Fades out on its own after a few
 * seconds — the user doesn't need to dismiss it.
 *
 * Lifecycle:
 *   • immersive flips false → true:  phase = "visible" for 2.6s,
 *                                    then "fading" for 0.6s,
 *                                    then "hidden" (unmounted)
 *   • immersive flips true → false:  phase = "hidden" immediately
 *
 * The toast styles deliberately diverge from the rest of the app's
 * cream-glass language — during immersive mode the only visible
 * surface is the 3D scene, so the toast needs strong contrast. A
 * dark pill with cream text reads cleanly against any room interior
 * the GLB might show.
 *
 * Keeps showing on every entry (no "first-time only" suppression);
 * the cost of seeing it once more is nil, and it remains useful as
 * a reminder for users who haven't memorized Esc yet.
 */

type Phase = "hidden" | "visible" | "fading";

const VISIBLE_MS = 2600;
const FADE_MS = 600;

export function ImmersiveToast() {
  const immersive = useStore((s) => s.immersive);
  const [phase, setPhase] = useState<Phase>("hidden");

  useEffect(() => {
    if (!immersive) {
      setPhase("hidden");
      return;
    }
    setPhase("visible");
    const fadeTimer = setTimeout(() => setPhase("fading"), VISIBLE_MS);
    const hideTimer = setTimeout(
      () => setPhase("hidden"),
      VISIBLE_MS + FADE_MS,
    );
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [immersive]);

  if (phase === "hidden") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 28,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 50,
        padding: "10px 18px",
        borderRadius: 999,
        background: "rgba(26, 26, 26, 0.85)",
        color: "#FFF4EC",
        fontFamily: "var(--font-app), system-ui, sans-serif",
        fontSize: 12.5,
        fontWeight: 500,
        boxShadow: "0 8px 24px -8px rgba(0, 0, 0, 0.35)",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span>Press</span>
      <kbd
        style={{
          fontFamily: "ui-monospace, 'SF Mono', monospace",
          fontSize: 11,
          fontWeight: 500,
          color: "#FFF4EC",
          background: "rgba(255, 255, 255, 0.15)",
          border: "1px solid rgba(255, 255, 255, 0.22)",
          borderRadius: 4,
          padding: "1px 6px",
          letterSpacing: "0.02em",
        }}
      >
        Esc
      </kbd>
      <span>to exit</span>
    </div>
  );
}
