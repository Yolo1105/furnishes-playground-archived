"use client";

import { useStore } from "@studio/store";
import { CloseIcon, MapIcon } from "@studio/icons";

/**
 * Small "Coming soon" floating card that appears top-center, just
 * below the top bar, when the user clicks Planner or Tour. It tells
 * the user the feature is coming and lists what it will eventually
 * do, so the click isn't a dead end.
 *
 * Lifecycle is controlled by the store — `comingSoonCard` is the
 * target id (`"planner"` / `"tour"` / `null`). Clicking the × or
 * outside the card sets it back to `null`.
 *
 * One card at a time is sufficient since the two entry points share
 * the same surface; future conversions of these stubs into real
 * floating cards (with their own components) replace this one
 * surface per tool.
 */

const TARGETS = {
  tour: {
    title: "Tour",
    icon: <MapIcon size={15} />,
    body: "Tour authoring will let you drop waypoints, generate walkable paths between them, validate clearances, and play back a guided camera walkthrough. Coming soon.",
  },
} as const;

export function ComingSoonCard() {
  const target = useStore((s) => s.comingSoonCard);
  const setTarget = useStore((s) => s.setComingSoonCard);

  if (!target) return null;
  const cfg = TARGETS[target];

  return (
    <>
      {/* Click-outside catcher. Sits below the card's z-index but
          above the rest of the app, so any click that misses the
          card dismisses it. */}
      <div
        onClick={() => setTarget(null)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          background: "transparent",
        }}
      />

      <div
        role="dialog"
        aria-label={`${cfg.title} — coming soon`}
        className="glass-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: 64,
          left: "50%",
          transform: "translateX(-50%)",
          width: 320,
          maxWidth: "calc(100vw - 32px)",
          padding: "14px 16px 16px 16px",
          borderRadius: 14,
          zIndex: 41,
          fontFamily: "var(--font-app), system-ui, sans-serif",
          animation: "bubble-in 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              color: "rgba(26, 26, 26, 0.78)",
            }}
          >
            <span style={{ display: "inline-flex" }}>{cfg.icon}</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "#1A1A1A",
              }}
            >
              {cfg.title}
            </span>
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#FF5A1F",
                padding: "2px 6px",
                borderRadius: 5,
                background: "rgba(255, 90, 31, 0.1)",
                border: "1px solid rgba(255, 90, 31, 0.25)",
              }}
            >
              Soon
            </span>
          </div>
          <button
            type="button"
            onClick={() => setTarget(null)}
            aria-label="Close"
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: "rgba(26, 26, 26, 0.55)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <CloseIcon size={11} />
          </button>
        </div>

        {/* Body */}
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "rgba(26, 26, 26, 0.7)",
          }}
        >
          {cfg.body}
        </p>
      </div>
    </>
  );
}
