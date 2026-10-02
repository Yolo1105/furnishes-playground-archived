"use client";

interface Props {
  tabLabel: string;
  comingInPhase: string;
}

/**
 * Placeholder body for Planner tabs that haven't shipped yet.
 * Replaces the generic "coming soon" stub with one that names the
 * specific phase responsible — gives the user (and future-me)
 * confidence the absence is intentional + tracked, not a bug.
 *
 * Visual: centered icon, tab name, and a small phase pill plus a
 * one-line description of what the tab will do once built.
 */
export function PlaceholderTab({ tabLabel, comingInPhase }: Props) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 32,
        color: "rgba(26, 26, 26, 0.55)",
        textAlign: "center",
      }}
    >
      {/* Decorative dotted square — suggests "this space reserved
          for a future feature" without being heavy-handed. */}
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          border: "2px dashed rgba(26, 26, 26, 0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "rgba(255, 90, 31, 0.55)",
          }}
        />
      </div>

      <div
        style={{
          fontFamily: "var(--font-app), system-ui, sans-serif",
          fontSize: 18,
          fontWeight: 500,
          color: "rgba(26, 26, 26, 0.85)",
        }}
      >
        {tabLabel}
      </div>

      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: "4px 10px",
          borderRadius: 999,
          background: "rgba(255, 90, 31, 0.1)",
          color: "#FF5A1F",
          letterSpacing: "0.02em",
        }}
      >
        Coming in Phase {comingInPhase}
      </div>

      <p
        style={{
          margin: 0,
          maxWidth: 360,
          fontSize: 13,
          lineHeight: 1.5,
          color: "rgba(26, 26, 26, 0.55)",
        }}
      >
        This tab is reserved space — the Requirements tab on the left works
        today and persists what you set there across sessions. The rest of the
        Planner is wired up phase by phase.
      </p>
    </div>
  );
}
