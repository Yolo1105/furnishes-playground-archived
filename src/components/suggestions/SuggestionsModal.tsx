"use client";

import { useEffect } from "react";
import { useStore } from "@studio/store";
import { CloseIcon } from "@studio/icons";

/**
 * Suggestions modal — proactive design observations from the brain.
 *
 * Mounted unconditionally; visibility gated on `suggestionsModalOpen`
 * in ui-flags-slice (mirrors the HelpModal pattern). Opens via a
 * top-bar button.
 *
 * Layout:
 *
 *   ┌─ Suggestions ─────────────── × ┐
 *   │                                 │
 *   │  [Generate]   3 / 50 today      │
 *   │                                 │
 *   │  ┌── 1. Anchor with the sofa ─┐ │
 *   │  │ Place it on the long...    │ │
 *   │  └────────────────────────────┘ │
 *   │  ┌── 2. Open the walkway ─────┐ │
 *   │  │ Leave 80cm clear...        │ │
 *   │  └────────────────────────────┘ │
 *   │                                 │
 *   └─────────────────────────────────┘
 *
 * Cards stream in as text arrives from the server. The in-progress
 * card (last in the list) shows a streaming cursor next to its body.
 * On completion, the cursor disappears.
 *
 * Errors and the daily-cap soft-fail message render in place of the
 * cards list.
 *
 * On first open, we GET /api/suggestions to populate the
 * remaining-today counter without consuming a slot. Closing and
 * reopening doesn't re-probe (the counter is updated by the
 * Generate response headers).
 */

export function SuggestionsModal() {
  const open = useStore((s) => s.suggestionsModalOpen);
  const setOpen = useStore((s) => s.setSuggestionsModalOpen);
  const suggestions = useStore((s) => s.suggestions);
  const isGenerating = useStore((s) => s.isGenerating);
  const error = useStore((s) => s.error);
  const remainingToday = useStore((s) => s.remainingToday);
  const capPerDay = useStore((s) => s.capPerDay);
  const lastGeneratedAt = useStore((s) => s.lastGeneratedAt);
  const brainEnabled = useStore((s) => s.brainEnabled);
  const probe = useStore((s) => s.probeSuggestionsState);
  const generate = useStore((s) => s.generateSuggestions);
  const clear = useStore((s) => s.clearSuggestions);

  // Probe on first open; don't re-probe on reopen.
  const probedRef = useStore.getState().brainEnabled !== null;
  useEffect(() => {
    if (open && !probedRef) {
      probe();
    }
  }, [open, probe, probedRef]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const counterText =
    capPerDay === null
      ? brainEnabled === false
        ? "brain pipeline disabled"
        : "—"
      : `${remainingToday ?? "?"} / ${capPerDay} today`;

  const isFresh = !isGenerating && suggestions.length === 0 && !error;

  const handleGenerate = () => {
    if (isGenerating) return;
    clear();
    generate();
  };

  const lastGeneratedText = formatTimeAgo(lastGeneratedAt);

  return (
    <div
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Design suggestions"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26, 18, 10, 0.32)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        fontFamily: "var(--font-app), system-ui, sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal"
        style={{
          width: 540,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 64px)",
          overflowY: "auto",
          borderRadius: 18,
          padding: "20px 22px 22px 22px",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#1A1A1A",
            }}
          >
            Design suggestions
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close suggestions"
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "none",
              background: "transparent",
              color: "rgba(26, 26, 26, 0.55)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CloseIcon size={13} />
          </button>
        </div>

        {/* Generate row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating || brainEnabled === false}
            style={{
              padding: "8px 16px",
              borderRadius: 9,
              border: "none",
              background:
                isGenerating || brainEnabled === false
                  ? "rgba(26, 26, 26, 0.1)"
                  : "#FF5A1F",
              color:
                isGenerating || brainEnabled === false
                  ? "rgba(26, 26, 26, 0.4)"
                  : "#FFFFFF",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 600,
              cursor:
                isGenerating || brainEnabled === false
                  ? "not-allowed"
                  : "pointer",
              transition: "background 120ms ease",
            }}
          >
            {isGenerating
              ? "Generating…"
              : suggestions.length > 0
                ? "Regenerate"
                : "Generate"}
          </button>
          <div
            style={{
              fontSize: 11,
              color: "rgba(26, 26, 26, 0.55)",
              textAlign: "right",
            }}
          >
            <div>{counterText}</div>
            {lastGeneratedText && (
              <div style={{ marginTop: 2, fontSize: 10 }}>
                Last: {lastGeneratedText}
              </div>
            )}
          </div>
        </div>

        {/* Body — fresh / loading / error / cards */}
        {error && (
          <div
            style={{
              padding: "14px 16px",
              borderRadius: 11,
              background: "rgba(220, 38, 38, 0.08)",
              border: "1px solid rgba(220, 38, 38, 0.18)",
              fontSize: 13,
              color: "rgba(120, 20, 20, 0.95)",
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        {!error && isFresh && (
          <div
            style={{
              padding: "20px 16px",
              borderRadius: 11,
              background: "rgba(26, 26, 26, 0.04)",
              fontSize: 13,
              color: "rgba(26, 26, 26, 0.7)",
              textAlign: "center",
              lineHeight: 1.55,
            }}
          >
            Click <strong style={{ color: "#1A1A1A" }}>Generate</strong> to see
            proactive design observations grounded in your scene.
            <br />
            <span style={{ fontSize: 11, opacity: 0.75 }}>
              The brain reviews your room and surfaces 3 to 5 prioritized
              suggestions.
            </span>
          </div>
        )}

        {!error && !isFresh && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {suggestions.map((s) => (
              <SuggestionCard key={s.number} suggestion={s} />
            ))}
            {isGenerating && suggestions.length === 0 && (
              <div
                style={{
                  padding: "16px",
                  borderRadius: 11,
                  background: "rgba(26, 26, 26, 0.04)",
                  fontSize: 12,
                  color: "rgba(26, 26, 26, 0.55)",
                  fontStyle: "italic",
                }}
              >
                Reviewing the space…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
}: {
  suggestion: {
    number: number;
    title: string;
    body: string;
    inProgress: boolean;
  };
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 11,
        background: "rgba(26, 26, 26, 0.035)",
        border: "1px solid rgba(26, 26, 26, 0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#FF5A1F",
            minWidth: 18,
          }}
        >
          {suggestion.number}.
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#1A1A1A",
            lineHeight: 1.4,
          }}
        >
          {suggestion.title}
        </span>
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: "rgba(26, 26, 26, 0.78)",
          lineHeight: 1.55,
          paddingLeft: 26,
          whiteSpace: "pre-wrap",
        }}
      >
        {suggestion.body}
        {suggestion.inProgress && (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 14,
              marginLeft: 2,
              background: "rgba(26, 26, 26, 0.45)",
              verticalAlign: "text-bottom",
              animation: "pulse 1s steps(2, end) infinite",
            }}
          />
        )}
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number | null): string | null {
  if (!timestamp) return null;
  const elapsed = Date.now() - timestamp;
  if (elapsed < 0) return null;
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return null;
}
