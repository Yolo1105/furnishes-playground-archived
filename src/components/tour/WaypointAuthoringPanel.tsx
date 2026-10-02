"use client";

import { useEffect, useState } from "react";
import { useStore } from "@studio/store";
import { CloseIcon, FootprintsIcon } from "@studio/icons";

/**
 * Waypoint authoring panel. Self-gates render on `waypointMode`.
 *
 * v0.40.42: anchored UNDER the Reference card on the right side
 * (rather than floating top-center). The user pointed out that the
 * mid-screen position was "sort of counter intuitive" — the user
 * clicks the pin button INSIDE the Reference card, then a panel
 * appears in the middle of the screen disconnected from where they
 * just clicked. Placing the panel directly under the Reference card
 * keeps the cause-and-effect relationship visible. Falls back to
 * top-center when the Reference card isn't mounted (which would be
 * weird since pin mode requires it, but defensive).
 *
 * Design note: this panel exists because the previous tour UX was
 * fragmented — Reference card had the pin-mode toggle, FloorPlan2D
 * accepted the clicks, top bar's Play button started playback,
 * but there was no single surface that explained the flow or made
 * it easy to abandon mid-authoring. With this panel, entering
 * waypoint mode pulls up explicit controls so the user always knows
 * what step they're on.
 *
 * Behavior:
 *   - "Done" exits authoring mode (waypointMode → false) but keeps
 *     waypoints — same as toggling the Reference card pin button.
 *   - "Clear" wipes the waypoint list (when there are 1+).
 *   - "Play" runs startTour with the current path. The path is the
 *     waypoint list itself (each waypoint = path point); the tour
 *     camera lerps between them. Disabled when fewer than 2 points
 *     are placed (a tour needs a start and an end).
 */

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";
const UI_FONT = "var(--font-app), system-ui, sans-serif";

export function WaypointAuthoringPanel() {
  const waypointMode = useStore((s) => s.waypointMode);
  const customWaypoints = useStore((s) => s.customWaypoints);
  const setWaypointMode = useStore((s) => s.setWaypointMode);
  const clearWaypoints = useStore((s) => s.clearWaypoints);
  const startTour = useStore((s) => s.startTour);
  const tourActive = useStore((s) => s.tourActive);
  const immersive = useStore((s) => s.immersive);

  // Position resolution — track Reference card's bounding rect.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!waypointMode) return;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    const settle = () => {
      const ref = document.querySelector(
        '[data-card-id="tool-reference"]',
      ) as HTMLElement | null;
      if (!ref) {
        setPos(null);
        return;
      }
      const measure = () => {
        const r = ref.getBoundingClientRect();
        setPos({
          top: r.bottom + 8,
          right: Math.max(14, window.innerWidth - r.right),
        });
      };
      measure();
      ro?.disconnect();
      ro = new ResizeObserver(measure);
      ro.observe(ref);
    };
    raf = requestAnimationFrame(settle);
    window.addEventListener("resize", settle);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", settle);
    };
  }, [waypointMode]);

  if (!waypointMode || immersive || tourActive) return null;

  const canPlay = customWaypoints.length >= 2;

  // Position style — anchored to Reference card if found, otherwise
  // fall back to the original top-center placement so the panel is
  // always reachable.
  const positionStyle: React.CSSProperties = pos
    ? { top: pos.top, right: pos.right, minWidth: 320, maxWidth: 360 }
    : {
        top: 80,
        left: "50%",
        transform: "translateX(-50%)",
        minWidth: 320,
      };

  return (
    <div
      role="region"
      aria-label="Tour authoring"
      style={{
        position: "fixed",
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "10px 14px",
        borderRadius: 12,
        background: "rgba(255, 248, 241, 0.96)",
        backdropFilter: "blur(8px)",
        boxShadow:
          "0 6px 18px rgba(26, 26, 26, 0.1), 0 1px 3px rgba(26, 26, 26, 0.06)",
        fontFamily: UI_FONT,
        transition: "top 0.18s ease, right 0.18s ease",
        ...positionStyle,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "rgba(255, 90, 31, 0.12)",
              color: ACCENT,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FootprintsIcon size={12} />
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: INK,
            }}
          >
            Tour authoring
          </span>
          <span
            style={{
              fontSize: 11,
              color: "rgba(26, 26, 26, 0.55)",
              fontWeight: 500,
              padding: "2px 7px",
              borderRadius: 999,
              background: "rgba(26, 26, 26, 0.05)",
            }}
          >
            {customWaypoints.length} waypoint
            {customWaypoints.length === 1 ? "" : "s"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setWaypointMode(false)}
          aria-label="Done — exit waypoint authoring"
          title="Exit authoring mode (waypoints stay placed)"
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            border: "none",
            background: "rgba(26, 26, 26, 0.06)",
            color: "rgba(26, 26, 26, 0.6)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CloseIcon size={11} />
        </button>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 11,
          color: "rgba(26, 26, 26, 0.6)",
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        Click on the 2D floor plan to drop pins. Click a placed pin to remove
        it. Two or more pins required to play the tour.
      </p>

      <div
        style={{
          display: "flex",
          gap: 6,
          justifyContent: "flex-end",
          marginTop: 2,
        }}
      >
        <button
          type="button"
          onClick={() => clearWaypoints()}
          disabled={customWaypoints.length === 0}
          style={{
            padding: "5px 12px",
            borderRadius: 999,
            border: "1px solid rgba(26, 26, 26, 0.12)",
            background: "transparent",
            color:
              customWaypoints.length === 0
                ? "rgba(26, 26, 26, 0.3)"
                : "rgba(26, 26, 26, 0.65)",
            fontSize: 11,
            fontWeight: 600,
            cursor: customWaypoints.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => {
            if (!canPlay) return;
            startTour(customWaypoints.map((w) => ({ x: w.x, z: w.z })));
            setWaypointMode(false); // exit authoring as playback starts
          }}
          disabled={!canPlay}
          title={
            canPlay
              ? "Play the tour — camera walks through your waypoints"
              : "Need at least 2 waypoints to play"
          }
          style={{
            padding: "5px 12px",
            borderRadius: 999,
            border: "none",
            background: canPlay ? ACCENT : "rgba(26, 26, 26, 0.1)",
            color: canPlay ? "white" : "rgba(26, 26, 26, 0.4)",
            fontSize: 11,
            fontWeight: 500,
            cursor: canPlay ? "pointer" : "not-allowed",
          }}
        >
          Play tour
        </button>
      </div>
    </div>
  );
}
