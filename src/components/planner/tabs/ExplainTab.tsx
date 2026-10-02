"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@studio/store";
import { boundsFromWalls } from "@studio/collision";
import { getAuthHeaders } from "@studio/client/auth-headers";

/**
 * Explain tab — Phase F5 deliverable. Asks Claude to narrate the
 * reasoning behind a chosen candidate, structured into design
 * principles, trade-offs, and follow-up suggestions.
 *
 * Reads the inspected candidate from generations-slice (whichever
 * the user has selected in the dropdown — defaults to applied or
 * first). Writes nothing to slices; the AI response is local state.
 *
 * Pattern mirrors OptionsTab: idle → generating → results → error.
 * The result is structured (summary + principles + tradeoffs +
 * suggestions) so the UI can render distinct sections rather than
 * one wall of prose.
 *
 * Auto-runs on tab open is tempting but I'm leaving it manual.
 * Each /api/explain call is a real API call against the rate
 * limit; the user explicitly clicking "Explain" makes the cost
 * intentional rather than incidental.
 */

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";

interface PrincipleItem {
  title: string;
  body: string;
}

interface ExplainResponse {
  summary: string;
  principles: PrincipleItem[];
  tradeoffs: PrincipleItem[];
  suggestions: string[];
}

export function ExplainTab() {
  const candidates = useStore((s) => s.candidates);
  const inspectIndex = useStore((s) => s.inspectIndex);
  const setInspectIndex = useStore((s) => s.setInspectIndex);
  const furniture = useStore((s) => s.furniture);
  const walls = useStore((s) => s.walls);
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

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<ExplainResponse | null>(null);

  const idx = inspectIndex ?? 0;
  const cand = candidates[idx];

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
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            color: "rgba(26, 26, 26, 0.3)",
          }}
        >
          ?
        </div>
        <div
          style={{
            fontFamily: "var(--font-app), system-ui, sans-serif",
            fontSize: 16,
            fontWeight: 500,
            color: "rgba(26, 26, 26, 0.85)",
          }}
        >
          Nothing to explain yet
        </div>
        <p style={{ margin: 0, maxWidth: 360, fontSize: 13, lineHeight: 1.5 }}>
          Generate options first in the <strong>Options</strong> tab. Once there
          are candidates, this tab can ask Claude to narrate the reasoning
          behind any of them.
        </p>
      </div>
    );
  }

  if (!cand) return null;

  const explain = async () => {
    setGenerating(true);
    setError(null);
    try {
      const bounds = boundsFromWalls(walls);
      const placedFurniture = furniture.filter((f) => f.placed);
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          candidate: cand,
          furniture: placedFurniture.map((f) => ({
            id: f.id,
            label: f.label,
            width: f.width,
            depth: f.depth,
            x: f.x,
            z: f.z,
            rotation: f.rotation,
          })),
          bounds,
          requirements,
        }),
      });

      if (res.status === 503) {
        setError(
          "AI is not configured on this server. Set ANTHROPIC_API_KEY in .env.local to enable Explain.",
        );
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? `Request failed: ${res.status}`);
        return;
      }
      const data = (await res.json()) as ExplainResponse;
      setExplanation(data);
    } catch (e) {
      setError(
        `Couldn't reach the assistant — ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      );
    } finally {
      setGenerating(false);
    }
  };

  // When the user changes the inspected candidate via the dropdown,
  // clear any prior explanation — it was for the previous candidate.
  const handlePickCandidate = (newIdx: number) => {
    setInspectIndex(newIdx);
    setExplanation(null);
    setError(null);
  };

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
        {/* Header — candidate dropdown + explain trigger */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <label
              htmlFor="explain-cand"
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "rgba(26, 26, 26, 0.55)",
                marginBottom: 6,
              }}
            >
              Explaining
            </label>
            <select
              id="explain-cand"
              value={idx}
              onChange={(e) => handlePickCandidate(Number(e.target.value))}
              style={{
                width: "100%",
                padding: "6px 10px",
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
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={explain}
            disabled={generating}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: "none",
              background: generating ? "rgba(26, 26, 26, 0.1)" : ACCENT,
              color: generating ? "rgba(26, 26, 26, 0.4)" : "white",
              fontSize: 12,
              fontWeight: 500,
              cursor: generating ? "not-allowed" : "pointer",
              flexShrink: 0,
            }}
          >
            {generating ? "Thinking…" : explanation ? "Re-explain" : "Explain"}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(255, 90, 31, 0.08)",
              color: "#7c3008",
              fontSize: 12,
              marginBottom: 16,
              border: "1px solid rgba(255, 90, 31, 0.2)",
            }}
          >
            Error: {error}
          </div>
        )}

        {generating && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "40px 24px",
              fontSize: 13,
              color: "rgba(26, 26, 26, 0.6)",
            }}
          >
            <div
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                border: "2px solid rgba(255, 90, 31, 0.2)",
                borderTopColor: ACCENT,
                animation: "spin 0.8s linear infinite",
              }}
            />
            <span>Asking Claude to narrate the reasoning…</span>
          </div>
        )}

        {!generating && !explanation && !error && (
          <div
            style={{
              textAlign: "center",
              padding: "32px 24px",
              color: "rgba(26, 26, 26, 0.55)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            Click <strong>Explain</strong> to ask Claude to narrate the design
            principles, trade-offs, and follow-up directions for{" "}
            <strong>{cand.label}</strong>.
          </div>
        )}

        {explanation && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Summary */}
            <section>
              <h4 style={sectionHeaderStyle}>Summary</h4>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: INK,
                }}
              >
                {explanation.summary}
              </p>
            </section>

            {/* Principles */}
            {explanation.principles.length > 0 && (
              <section>
                <h4 style={sectionHeaderStyle}>Design principles</h4>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  {explanation.principles.map((p, i) => (
                    <div key={i} style={cardStyle}>
                      <strong style={cardTitleStyle}>{p.title}</strong>
                      <p style={cardBodyStyle}>{p.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Trade-offs */}
            {explanation.tradeoffs.length > 0 && (
              <section>
                <h4 style={sectionHeaderStyle}>Trade-offs</h4>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  {explanation.tradeoffs.map((t, i) => (
                    <div
                      key={i}
                      style={{
                        ...cardStyle,
                        background: "rgba(217, 119, 6, 0.06)",
                        borderColor: "rgba(217, 119, 6, 0.2)",
                      }}
                    >
                      <strong style={cardTitleStyle}>{t.title}</strong>
                      <p style={cardBodyStyle}>{t.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Suggestions */}
            {explanation.suggestions.length > 0 && (
              <section>
                <h4 style={sectionHeaderStyle}>Suggestions</h4>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  {explanation.suggestions.map((s, i) => (
                    <li key={i} style={{ marginBottom: 4, color: INK }}>
                      {s}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const sectionHeaderStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "rgba(26, 26, 26, 0.55)",
};

const cardStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  background: "#FFF8F1",
  border: "1px solid rgba(26, 26, 26, 0.06)",
};

const cardTitleStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: INK,
  marginBottom: 4,
};

const cardBodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.55,
  color: "rgba(26, 26, 26, 0.7)",
};
