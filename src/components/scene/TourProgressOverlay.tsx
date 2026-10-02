"use client";

import { useStore } from "@studio/store";

/**
 * Floating tour-progress overlay. Visible only while `tourActive`
 * is true. Centered top of the viewport, glass-styled to match
 * the rest of the floating UI.
 *
 * Shows three things:
 *   1. Static "Tour playing" label with a small pulsing dot — the
 *      visual cue that the camera isn't responding to user input
 *      because TourCamera owns it.
 *   2. A horizontal progress bar driven by `tourProgress` (0..1)
 *      — TourCamera writes this fraction to the slice on a 10 Hz
 *      throttle, smooth enough to look animated, sparse enough
 *      not to thrash zustand subscriptions.
 *   3. A "Stop" button that calls `stopTour`. Same exit as the
 *      top-bar Tour toggle and Esc, redundantly placed here so
 *      the user doesn't have to hunt for it during playback.
 *
 * Sits at zIndex 30 — above the floating tool cards (4) and
 * brand UI (5), below modals (100). Pointer-events on its glass
 * panel allow the Stop button to receive clicks even while the
 * Canvas is taking pointer-lock for mouse-look (which only
 * matters in walk mode, not in tour mode where mouse-look is
 * disabled — but defensive against future overlap).
 */

export function TourProgressOverlay() {
  const tourActive = useStore((s) => s.tourActive);
  const tourProgress = useStore((s) => s.tourProgress);
  const tourPath = useStore((s) => s.tourPath);
  const stopTour = useStore((s) => s.stopTour);

  if (!tourActive) return null;

  const pct = Math.round(tourProgress * 100);

  return (
    <div
      className="glass"
      style={{
        position: "fixed",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        // Compensate for the top-bar's own glass strip so we sit
        // above it rather than visually colliding. The top-bar is
        // at top:14 too but offset right (centered with content);
        // shift this overlay slightly to keep things readable.
        marginTop: 56,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 14px",
        borderRadius: 12,
        fontFamily: "var(--font-app), system-ui, sans-serif",
        fontSize: 12,
        fontWeight: 600,
        color: "#1A1A1A",
        minWidth: 280,
        pointerEvents: "auto",
      }}
    >
      {/* Pulsing dot + label */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#FF5A1F",
            // Pulse via CSS keyframe (tour-pulse defined in
            // globals.css). Respect prefers-reduced-motion via
            // the keyframe's animation-play-state if needed.
            animation: "tour-pulse 1.2s ease-in-out infinite",
            flexShrink: 0,
          }}
        />
        <span>Tour playing</span>
        <span style={{ color: "rgba(26, 26, 26, 0.45)", fontWeight: 500 }}>
          · {tourPath.length} {tourPath.length === 1 ? "stop" : "stops"}
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          flex: 1,
          height: 4,
          borderRadius: 2,
          background: "rgba(26, 26, 26, 0.08)",
          overflow: "hidden",
          minWidth: 80,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "#FF5A1F",
            transition: "width 0.1s linear",
          }}
        />
      </div>

      {/* Stop button */}
      <button
        type="button"
        onClick={stopTour}
        style={{
          border: "none",
          background: "rgba(26, 26, 26, 0.06)",
          color: "#1A1A1A",
          fontFamily: "var(--font-app), system-ui, sans-serif",
          fontSize: 11,
          fontWeight: 500,
          padding: "5px 10px",
          borderRadius: 7,
          cursor: "pointer",
          transition: "background 0.15s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(26, 26, 26, 0.12)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(26, 26, 26, 0.06)";
        }}
      >
        Stop
      </button>
    </div>
  );
}
