"use client";

import { useStore } from "@studio/store";
import { LightbulbIcon } from "@studio/icons";

const SUGGESTIONS = [
  "Mood image",
  "Floorplan",
  "Color palette",
  "Cozy living room",
  "Small bedroom",
  "Lighting ideas",
  "Minimalist tips",
];

/**
 * Strip of preset prompt chips that appears above the input box when
 * the user toggles the lightbulb in the toolbar. Tapping a chip drops
 * its text into the free-form draft (no-op when the user is in guided
 * mode — the JSX behavior).
 */
export function QuickSuggestions() {
  const open = useStore((s) => s.suggestionsOpen);
  const setMessage = useStore((s) => s.setMessage);
  const guidedContext = useStore((s) => s.guidedContext);

  // v0.40.42: removed the `isThinking` co-gate that previously hid
  // the chips while the assistant was processing. The intent was
  // "don't stack ThinkingLog and QuickSuggestions vertically," but
  // the side effect was that clicking the lightbulb during or right
  // after a generation appeared to do nothing — toggling the flag
  // had no visible result. The user could not figure out whether
  // their click registered. Honoring the explicit toggle always is
  // the right call; vertical stacking with ThinkingLog is fine
  // because the chips are short.
  if (!open) return null;

  return (
    <div style={{ padding: "0 4px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 500,
          color: "rgba(26, 26, 26, 0.7)",
          marginBottom: 8,
          letterSpacing: "-0.005em",
        }}
      >
        <LightbulbIcon size={12} style={{ color: "#FF5A1F", flexShrink: 0 }} />
        <span style={{ color: "#FF5A1F", fontWeight: 600 }}>
          Quick suggestions
        </span>
        <span>for your space:</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {SUGGESTIONS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              if (!guidedContext) setMessage(label);
            }}
            disabled={guidedContext}
            className="suggestion-chip"
            style={{
              padding: "5px 10px",
              borderRadius: 999,
              border: "1px solid rgba(124, 80, 50, 0.2)",
              background: "rgba(255, 255, 255, 0.6)",
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: 11,
              fontWeight: 500,
              color: "rgba(26, 26, 26, 0.7)",
              cursor: guidedContext ? "not-allowed" : "pointer",
              opacity: guidedContext ? 0.5 : 1,
              letterSpacing: "-0.005em",
              whiteSpace: "nowrap",
              transition:
                "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
