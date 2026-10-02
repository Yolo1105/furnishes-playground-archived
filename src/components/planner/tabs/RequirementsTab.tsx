"use client";

import { useStore } from "@studio/store";
import {
  MUST_INCLUDE_CATEGORIES,
  OPTIONAL_INCLUDE_CATEGORIES,
  type BedAgainstWall,
} from "@studio/store/requirements-slice";

/**
 * Requirements tab body. Reads + writes the requirements-slice. Form
 * fields are organized into thematic groups separated by section
 * headers + thin dividers:
 *
 *   1. Must-Include — three toggle pills (bed / desk / wardrobe).
 *      Defaults true for all three.
 *   2. Optional Include — three toggle pills (rug / nightstand / lamp).
 *      Defaults all false; user opts in.
 *   3. Walkway Width — slider 50..120cm, label shows both cm and
 *      inches. Defaults 75cm ≈ 30".
 *   4. Constraints — door clearance, window access, bed-against-wall
 *      preference. Yes/no toggles + 3-option segmented control for
 *      bed pref ("prefer" / "required" / "off").
 *   5. Priorities — two 0..100 sliders (Flow vs Storage, Open vs Cozy)
 *      with labeled endpoints.
 *
 * Bottom action row: Reset to defaults. Apply/Save isn't needed —
 * every field writes to the slice on change, so the state persists
 * automatically across modal close/reopen + (when Phase G ships)
 * across sessions.
 *
 * Adapted from the zip's RequirementsTab.tsx but our preset support
 * is deferred (the zip's PRESETS file is a separate port). The
 * preset row in this version reads "no presets yet" with a planned-
 * phase note. Single-source-of-truth lists from requirements-slice
 * (MUST_INCLUDE_CATEGORIES + OPTIONAL_INCLUDE_CATEGORIES) drive the
 * toggle rendering so adding a category is a single-line edit.
 */

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";

function cmToInches(cm: number): number {
  return Math.round(cm / 2.54);
}

export function RequirementsTab() {
  const mustInclude = useStore((s) => s.mustInclude);
  const optionalInclude = useStore((s) => s.optionalInclude);
  const walkwayMinCm = useStore((s) => s.walkwayMinCm);
  const doorClearance = useStore((s) => s.doorClearance);
  const windowAccess = useStore((s) => s.windowAccess);
  const bedAgainstWall = useStore((s) => s.bedAgainstWall);
  const flowVsStorage = useStore((s) => s.flowVsStorage);
  const opennessVsCozy = useStore((s) => s.opennessVsCozy);

  const setMustInclude = useStore((s) => s.setMustInclude);
  const setOptionalInclude = useStore((s) => s.setOptionalInclude);
  const setWalkwayMinCm = useStore((s) => s.setWalkwayMinCm);
  const setDoorClearance = useStore((s) => s.setDoorClearance);
  const setWindowAccess = useStore((s) => s.setWindowAccess);
  const setBedAgainstWall = useStore((s) => s.setBedAgainstWall);
  const setFlowVsStorage = useStore((s) => s.setFlowVsStorage);
  const setOpennessVsCozy = useStore((s) => s.setOpennessVsCozy);
  const resetRequirements = useStore((s) => s.resetRequirements);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px",
        }}
      >
        {/* Preset row (deferred — no PRESETS file yet) */}
        <SectionHeader>Preset</SectionHeader>
        <p
          style={{
            margin: "0 0 16px",
            fontSize: 12,
            color: "rgba(26, 26, 26, 0.5)",
          }}
        >
          Curated presets (Studio · Bedroom · Live-Work · Reading Nook) land
          when the AI generation engine ships. For now, set fields manually
          below.
        </p>

        {/* Must-Include */}
        <SectionHeader>Must include</SectionHeader>
        <ToggleRow
          options={MUST_INCLUDE_CATEGORIES.map((k) => ({ key: k, label: k }))}
          selected={mustInclude}
          onToggle={(key, value) => setMustInclude(key, value)}
        />

        <Divider />

        {/* Optional Include */}
        <SectionHeader>Optional include</SectionHeader>
        <ToggleRow
          options={OPTIONAL_INCLUDE_CATEGORIES.map((k) => ({
            key: k,
            label: k,
          }))}
          selected={optionalInclude}
          onToggle={(key, value) => setOptionalInclude(key, value)}
        />

        <Divider />

        {/* Walkway minimum width */}
        <SectionHeader>Minimum walkway width</SectionHeader>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 4,
          }}
        >
          <input
            type="range"
            min={50}
            max={120}
            step={5}
            value={walkwayMinCm}
            onChange={(e) => setWalkwayMinCm(Number(e.target.value))}
            style={{ flex: 1, accentColor: ACCENT }}
          />
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              fontSize: 13,
              fontWeight: 600,
              color: INK,
              minWidth: 92,
              textAlign: "right",
            }}
          >
            {walkwayMinCm}cm · {cmToInches(walkwayMinCm)}″
          </span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: "rgba(26, 26, 26, 0.5)",
          }}
        >
          The arrangement engine will keep at least this much clearance between
          any two pieces along walking routes.
        </p>

        <Divider />

        {/* Constraints */}
        <SectionHeader>Constraints</SectionHeader>
        <YesNoRow
          label="Maintain door clearance"
          value={doorClearance}
          onChange={setDoorClearance}
        />
        <YesNoRow
          label="Avoid blocking windows"
          value={windowAccess}
          onChange={setWindowAccess}
        />
        <SegmentedRow<BedAgainstWall>
          label="Bed against wall"
          value={bedAgainstWall}
          options={[
            { key: "prefer", label: "Prefer" },
            { key: "required", label: "Required" },
            { key: "off", label: "Off" },
          ]}
          onChange={setBedAgainstWall}
        />

        <Divider />

        {/* Priorities */}
        <SectionHeader>Priorities</SectionHeader>
        <PrioritySlider
          leftLabel="Flow"
          rightLabel="Storage"
          value={flowVsStorage}
          onChange={setFlowVsStorage}
        />
        <PrioritySlider
          leftLabel="Open"
          rightLabel="Cozy"
          value={opennessVsCozy}
          onChange={setOpennessVsCozy}
        />
      </div>

      {/* Footer action row */}
      <footer
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "12px 20px",
          borderTop: "1px solid rgba(26, 26, 26, 0.08)",
          background: "#FFF8F1",
        }}
      >
        <button
          type="button"
          onClick={() => resetRequirements()}
          style={{
            padding: "7px 14px",
            borderRadius: 999,
            border: "1px solid rgba(26, 26, 26, 0.12)",
            background: "transparent",
            color: "rgba(26, 26, 26, 0.65)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reset to defaults
        </button>
      </footer>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: "0 0 8px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "rgba(26, 26, 26, 0.55)",
      }}
    >
      {children}
    </h3>
  );
}

function Divider() {
  return (
    <hr
      style={{
        border: "none",
        borderTop: "1px solid rgba(26, 26, 26, 0.06)",
        margin: "16px 0",
      }}
    />
  );
}

interface ToggleRowOption {
  key: string;
  label: string;
}

function ToggleRow({
  options,
  selected,
  onToggle,
}: {
  options: ToggleRowOption[];
  selected: Record<string, boolean>;
  onToggle: (key: string, value: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => {
        const active = !!selected[opt.key];
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onToggle(opt.key, !active)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: `1px solid ${active ? ACCENT : "rgba(26, 26, 26, 0.12)"}`,
              background: active ? "rgba(255, 90, 31, 0.1)" : "transparent",
              color: active ? ACCENT : "rgba(26, 26, 26, 0.65)",
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              textTransform: "capitalize",
              cursor: "pointer",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function YesNoRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: "rgba(26, 26, 26, 0.85)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 4 }}>
        {[
          { key: true, label: "Yes" },
          { key: false, label: "No" },
        ].map((opt) => {
          const active = value === opt.key;
          return (
            <button
              key={String(opt.key)}
              type="button"
              onClick={() => onChange(opt.key)}
              style={{
                padding: "5px 12px",
                borderRadius: 999,
                border: "none",
                background: active
                  ? "rgba(255, 90, 31, 0.1)"
                  : "rgba(26, 26, 26, 0.04)",
                color: active ? ACCENT : "rgba(26, 26, 26, 0.55)",
                fontSize: 11,
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SegmentedRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: "rgba(26, 26, 26, 0.85)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 4 }}>
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              style={{
                padding: "5px 12px",
                borderRadius: 999,
                border: "none",
                background: active
                  ? "rgba(255, 90, 31, 0.1)"
                  : "rgba(26, 26, 26, 0.04)",
                color: active ? ACCENT : "rgba(26, 26, 26, 0.55)",
                fontSize: 11,
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PrioritySlider({
  leftLabel,
  rightLabel,
  value,
  onChange,
}: {
  leftLabel: string;
  rightLabel: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <span style={{ color: value < 50 ? ACCENT : "rgba(26, 26, 26, 0.55)" }}>
          {leftLabel}
        </span>
        <span style={{ color: value > 50 ? ACCENT : "rgba(26, 26, 26, 0.55)" }}>
          {rightLabel}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: ACCENT }}
      />
    </div>
  );
}
