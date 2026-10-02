"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@studio/store";
import { runHealthChecks, type Severity } from "@studio/health/rules";

/**
 * Health tab — Phase F4 deliverable. Runs the design-rule engine
 * over the current scene + requirements + lock state and renders
 * the violation list, grouped by severity.
 *
 * Behavior:
 *   - Top-of-tab summary: "All clear" when 0 violations, otherwise
 *     three pills with the per-severity counts.
 *   - Violation list: one row per violation, color-coded by severity.
 *     Clicking a row selects the offending item in the 3D scene
 *     (via selectFurniture), opening the Properties panel and
 *     drawing the orange wireframe around the piece — quick visual
 *     hand-off from "what's wrong" to "let me look at it."
 *   - Locked items annotation: rule violations on locked items are
 *     surfaced as INFO rather than warning/error in some rules
 *     (the engine handles this internally — but the panel itself
 *     can show a 🔒 marker on the row to make it obvious).
 *   - Re-runs every render via useMemo so changes anywhere in the
 *     scene (drag, rotate, lock, requirements toggle) immediately
 *     update the violations.
 *
 * Empty state ("All clear"): the friendly "everything looks good"
 * panel encourages the user to keep going. Health is a confidence
 * signal, not a punishment.
 */

const ACCENT = "#FF5A1F";
const ERROR = "#dc2626";
const WARN = "#d97706";
const INFO_GRAY = "rgba(26, 26, 26, 0.55)";
const INK = "#1A1A1A";

const SEVERITY_COLORS: Record<
  Severity,
  { bg: string; fg: string; label: string }
> = {
  error: { bg: "rgba(220, 38, 38, 0.08)", fg: ERROR, label: "Error" },
  warning: { bg: "rgba(217, 119, 6, 0.08)", fg: WARN, label: "Warning" },
  info: { bg: "rgba(26, 26, 26, 0.04)", fg: INFO_GRAY, label: "Info" },
};

export function HealthTab() {
  const furniture = useStore((s) => s.furniture);
  const walls = useStore((s) => s.walls);

  // Pull requirements as a single object so the useMemo below has
  // a stable dependency tree.
  const requirements = useStore(
    useShallow((s) => ({
      presetName: s.presetName,
      mustInclude: s.mustInclude,
      optionalInclude: s.optionalInclude,
      walkwayMinCm: s.walkwayMinCm,
      doorClearance: s.doorClearance,
      windowAccess: s.windowAccess,
      bedAgainstWall: s.bedAgainstWall,
      flowVsStorage: s.flowVsStorage,
      opennessVsCozy: s.opennessVsCozy,
    })),
  );

  const selectFurniture = useStore((s) => s.selectFurniture);

  const violations = useMemo(() => {
    // Derive a Record<id, true> from each item's `locked` field.
    // The rule engine wants this shape for fast O(1) lookups.
    const lockedIds: Record<string, boolean> = {};
    for (const f of furniture) if (f.locked) lockedIds[f.id] = true;
    return runHealthChecks({
      placed: furniture.filter((f) => f.placed),
      walls,
      requirements,
      lockedIds,
    });
  }, [furniture, walls, requirements]);

  const counts = {
    error: violations.filter((v) => v.severity === "error").length,
    warning: violations.filter((v) => v.severity === "warning").length,
    info: violations.filter((v) => v.severity === "info").length,
  };

  const total = violations.length;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h3
            style={{
              margin: "0 0 4px",
              fontSize: 14,
              fontWeight: 500,
              color: INK,
            }}
          >
            Design checks
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "rgba(26, 26, 26, 0.55)",
            }}
          >
            Continuous validation against your Requirements + spatial
            constraints. Click a violation to highlight the piece in 3D.
          </p>
        </div>

        {/* All-clear / summary */}
        {total === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              padding: "32px 16px",
              borderRadius: 12,
              background: "rgba(34, 197, 94, 0.06)",
              border: "1px solid rgba(34, 197, 94, 0.18)",
            }}
          >
            <div
              aria-hidden
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                background: "rgba(34, 197, 94, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background: "#16a34a",
                  display: "inline-block",
                }}
              />
            </div>
            <div
              style={{
                fontFamily: "var(--font-app), system-ui, sans-serif",
                fontSize: 16,
                fontWeight: 500,
                color: "#15803d",
              }}
            >
              All clear
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "rgba(26, 26, 26, 0.6)",
                textAlign: "center",
                maxWidth: 320,
                lineHeight: 1.5,
              }}
            >
              Your scene passes every check. Keep arranging — or lock the pieces
              you love so AI runs preserve them.
            </p>
          </div>
        ) : (
          <>
            {/* Severity pill row */}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 16,
              }}
            >
              {(["error", "warning", "info"] as const).map((sev) => {
                const c = SEVERITY_COLORS[sev];
                const n = counts[sev];
                if (n === 0) return null;
                return (
                  <span
                    key={sev}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 999,
                      background: c.bg,
                      color: c.fg,
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  >
                    <strong>{n}</strong>
                    <span>{c.label}</span>
                  </span>
                );
              })}
            </div>

            {/* Violation rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {violations.map((v) => {
                const c = SEVERITY_COLORS[v.severity];
                const targetId = v.itemIds[0];
                const target = targetId
                  ? furniture.find((f) => f.id === targetId)
                  : null;
                const isLocked = !!target?.locked;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      if (targetId) selectFurniture(targetId);
                    }}
                    style={{
                      textAlign: "left",
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: `1px solid ${c.bg.replace("0.08", "0.22")}`,
                      background: c.bg,
                      cursor: targetId ? "pointer" : "default",
                      transition: "background 0.15s ease",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        c.bg.replace("0.08", "0.14");
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        c.bg;
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 500,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: c.fg,
                        }}
                      >
                        {c.label}
                      </span>
                      {isLocked && (
                        <span
                          title="This item is locked"
                          style={{
                            fontSize: 9,
                            color: ACCENT,
                            fontWeight: 500,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            padding: "1px 6px",
                            borderRadius: 999,
                            background: "rgba(255, 90, 31, 0.1)",
                          }}
                        >
                          Locked
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: INK,
                      }}
                    >
                      {v.title}
                    </div>
                    {v.description && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "rgba(26, 26, 26, 0.6)",
                          lineHeight: 1.4,
                        }}
                      >
                        {v.description}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
