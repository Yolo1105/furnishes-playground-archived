"use client";

import { useStore } from "@studio/store";
import type { ArrangeMove } from "@studio/store/generations-slice";

/**
 * Inspect tab — Phase F2's deliverable. Diffs a chosen candidate
 * against the current scene state, row by row, so the user can
 * preview the impact before applying.
 *
 * Reads from generations-slice + furniture-slice; writes only to
 * generations-slice (inspectIndex via dropdown selection) and to
 * furniture-slice (setItemTransform when the user chooses Apply
 * from this tab — same path the OptionsTab Apply button takes).
 *
 * Layout:
 *   1. Header — dropdown to pick which candidate is being inspected
 *               (1, 2, or 3 from the most recent generate). Below it
 *               a one-line summary: "12 moved, 4 rotated, 18 unchanged".
 *   2. Diff list — one row per item that the candidate touches.
 *                  Each row shows current x/z/rotation in muted gray,
 *                  an arrow, proposed values in accent orange.
 *                  Distance moved displayed as "Δ 1.42m".
 *   3. Footer — Apply button (parity with OptionsTab) + status hint.
 *
 * Empty state: when no candidates have been generated yet, shows a
 * pointer to the Options tab.
 *
 * Why "diff" rather than just "show the candidate's moves": because
 * a move's `x` value alone tells you nothing about how far an item
 * actually moves. The user wants to know "did this candidate barely
 * tweak my layout, or did it rearrange everything?" — that's a
 * before-vs-after question, not a "what does this propose"
 * question. Sorting by Euclidean distance puts the most disrupted
 * items at the top so users can quickly assess scope.
 */

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";

interface DiffRow {
  id: string;
  label: string;
  fromX: number;
  fromZ: number;
  fromRot: number;
  toX: number;
  toZ: number;
  toRot: number;
  /** Euclidean XZ distance in meters. */
  distance: number;
  /** True iff rotation changes. */
  rotates: boolean;
}

export function InspectTab() {
  const candidates = useStore((s) => s.candidates);
  const inspectIndex = useStore((s) => s.inspectIndex);
  const setInspectIndex = useStore((s) => s.setInspectIndex);
  const appliedIndex = useStore((s) => s.appliedIndex);
  const setAppliedIndex = useStore((s) => s.setAppliedIndex);

  const furniture = useStore((s) => s.furniture);
  const setItemTransform = useStore((s) => s.setItemTransform);

  // Empty state — no candidates generated yet.
  if (candidates.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 32,
          color: "rgba(26, 26, 26, 0.55)",
          textAlign: "center",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            border: "2px dashed rgba(26, 26, 26, 0.15)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <span
            style={{
              width: 18,
              height: 2,
              background: "rgba(26, 26, 26, 0.3)",
              borderRadius: 1,
            }}
          />
          <span
            style={{
              width: 18,
              height: 2,
              background: "rgba(26, 26, 26, 0.3)",
              borderRadius: 1,
            }}
          />
        </div>
        <div
          style={{
            fontFamily: "var(--font-app), system-ui, sans-serif",
            fontSize: 16,
            fontWeight: 500,
            color: "rgba(26, 26, 26, 0.85)",
          }}
        >
          Nothing to inspect yet
        </div>
        <p style={{ margin: 0, maxWidth: 360, fontSize: 13, lineHeight: 1.5 }}>
          Generate options first in the <strong>Options</strong> tab. Once there
          are candidates, this tab shows you exactly what each one would change
          about your current scene.
        </p>
      </div>
    );
  }

  // Active candidate — fall back to 0 if inspectIndex is null.
  const idx = inspectIndex ?? 0;
  const cand = candidates[idx];
  if (!cand) return null;

  // Build diff rows. For each move, look up the item's current
  // x/z/rotation and compute the delta. Items not in furniture
  // (shouldn't happen but defensive) get skipped.
  const byId = new Map<string, (typeof furniture)[number]>(
    furniture.map((f) => [f.id, f]),
  );
  const rows: DiffRow[] = [];
  for (const move of cand.moves as ArrangeMove[]) {
    const item = byId.get(move.id);
    if (!item) continue;
    const dx = move.x - item.x;
    const dz = move.z - item.z;
    rows.push({
      id: move.id,
      label: item.label,
      fromX: item.x,
      fromZ: item.z,
      fromRot: item.rotation,
      toX: move.x,
      toZ: move.z,
      toRot: move.rotation,
      distance: Math.hypot(dx, dz),
      rotates: (move.rotation - item.rotation) % 360 !== 0,
    });
  }
  // Sort by distance descending so the biggest impacts are at the top.
  rows.sort((a, b) => b.distance - a.distance);

  // Summary stats.
  const movedCount = rows.filter((r) => r.distance > 0.005).length;
  const rotatedCount = rows.filter((r) => r.rotates).length;
  const unchangedCount = furniture.filter((f) => f.placed).length - rows.length;

  const applyThisCandidate = () => {
    const knownIds = new Set(furniture.map((f) => f.id));
    for (const move of cand.moves as ArrangeMove[]) {
      if (!knownIds.has(move.id)) continue;
      setItemTransform(move.id, {
        x: move.x,
        z: move.z,
        rotation: move.rotation,
      });
    }
    setAppliedIndex(idx);
  };

  const isApplied = appliedIndex === idx;

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
        {/* Header — candidate dropdown + summary line */}
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
            }}
          >
            <label
              htmlFor="inspect-cand"
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "rgba(26, 26, 26, 0.55)",
              }}
            >
              Inspecting
            </label>
            <select
              id="inspect-cand"
              value={idx}
              onChange={(e) => setInspectIndex(Number(e.target.value))}
              style={{
                padding: "5px 10px",
                borderRadius: 8,
                border: "1px solid rgba(26, 26, 26, 0.12)",
                background: "white",
                fontSize: 12,
                fontWeight: 600,
                color: INK,
                cursor: "pointer",
              }}
            >
              {candidates.map((c, i) => (
                <option key={i} value={i}>
                  Option {i + 1} — {c.label}
                  {appliedIndex === i ? " · applied" : ""}
                </option>
              ))}
            </select>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "rgba(26, 26, 26, 0.6)",
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: INK }}>{cand.label}</strong>
            {" — "}
            {cand.notes}
          </p>
        </div>

        {/* Summary stat row */}
        <div
          style={{
            display: "flex",
            gap: 12,
            padding: "10px 14px",
            borderRadius: 10,
            background: "#FFF8F1",
            border: "1px solid rgba(26, 26, 26, 0.06)",
            marginBottom: 18,
            fontSize: 12,
          }}
        >
          <Stat label="moved" value={movedCount} />
          <StatDivider />
          <Stat label="rotated" value={rotatedCount} />
          <StatDivider />
          <Stat label="unchanged" value={Math.max(0, unchangedCount)} />
        </div>

        {/* Diff rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.length === 0 && (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "rgba(26, 26, 26, 0.55)",
                fontStyle: "italic",
              }}
            >
              This candidate doesn&apos;t modify any of your placed items.
            </p>
          )}
          {rows.map((r) => (
            <DiffRowView key={r.id} row={r} />
          ))}
        </div>
      </div>

      {/* Footer — apply parity with OptionsTab */}
      <footer
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          padding: "12px 20px",
          borderTop: "1px solid rgba(26, 26, 26, 0.08)",
          background: "#FFF8F1",
        }}
      >
        <span style={{ fontSize: 11, color: "rgba(26, 26, 26, 0.55)" }}>
          {isApplied
            ? "This candidate is currently applied to the scene."
            : "Click apply to commit these changes to the scene."}
        </span>
        <button
          type="button"
          onClick={applyThisCandidate}
          style={{
            padding: "7px 14px",
            borderRadius: 999,
            border: isApplied ? `1px solid ${ACCENT}` : "none",
            background: isApplied ? "transparent" : ACCENT,
            color: isApplied ? ACCENT : "white",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {isApplied ? "Applied" : "Apply this candidate"}
        </button>
      </footer>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "baseline" }}>
      <strong style={{ color: INK, fontSize: 14, fontWeight: 700 }}>
        {value}
      </strong>
      <span style={{ color: "rgba(26, 26, 26, 0.55)" }}>{label}</span>
    </span>
  );
}

function StatDivider() {
  return (
    <span aria-hidden style={{ color: "rgba(26, 26, 26, 0.18)" }}>
      ·
    </span>
  );
}

function DiffRowView({ row }: { row: DiffRow }) {
  const moved = row.distance > 0.005;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto auto",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        background: moved
          ? "rgba(255, 90, 31, 0.04)"
          : "rgba(26, 26, 26, 0.02)",
        fontSize: 12,
      }}
    >
      <span
        style={{
          fontWeight: 600,
          color: INK,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={row.id}
      >
        {row.label}
      </span>
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          color: "rgba(26, 26, 26, 0.5)",
          fontSize: 11,
        }}
      >
        {row.fromX.toFixed(2)}, {row.fromZ.toFixed(2)} · {row.fromRot}°
      </span>
      <span
        style={{
          color: "rgba(26, 26, 26, 0.4)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        to
      </span>
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          color: moved || row.rotates ? ACCENT : "rgba(26, 26, 26, 0.55)",
          fontWeight: moved || row.rotates ? 700 : 500,
          fontSize: 11,
        }}
        title={
          moved
            ? `Moves ${row.distance.toFixed(2)}m`
            : row.rotates
              ? `Rotates to ${row.toRot}°`
              : "No change"
        }
      >
        {row.toX.toFixed(2)}, {row.toZ.toFixed(2)} · {row.toRot}°
        {moved && (
          <span style={{ marginLeft: 6, opacity: 0.75 }}>
            Δ {row.distance.toFixed(2)}m
          </span>
        )}
      </span>
    </div>
  );
}
