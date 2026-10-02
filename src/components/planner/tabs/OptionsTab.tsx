"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@studio/store";
import { boundsFromWalls } from "@studio/collision";
import type { ArrangeCandidate } from "@studio/store/generations-slice";
import { getAuthHeaders } from "@studio/client/auth-headers";

/**
 * Options tab — Phase E1's core deliverable, with Phase F2's lift
 * of candidate state from local React state to the generations-slice
 * so the InspectTab can read the same candidate set.
 *
 * Three states the tab cycles between:
 *   1. Idle (default) — generate button visible, no candidates yet.
 *   2. Generating     — generate button shows "Generating…", spinner
 *                       overlay; the request typically takes 8-20s.
 *   3. Results        — list of candidate cards. Each card shows the
 *                       label, notes, move count, and an "Apply"
 *                       button. Applying writes to setItemTransform
 *                       and sets the appliedIndex in generations-slice.
 *   4. Error          — banner shows the error message; generate
 *                       button is re-enabled to retry.
 *
 * State boundaries:
 *   - generating + error are LOCAL to this tab — they're transient
 *     UI states that only matter while the user is in this tab.
 *   - candidates + appliedIndex live in the generations-slice — they
 *     persist across tab switches and are read by InspectTab/PlacedTab.
 */

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";

export function OptionsTab() {
  const furniture = useStore((s) => s.furniture);
  const walls = useStore((s) => s.walls);
  const setItemTransform = useStore((s) => s.setItemTransform);

  const candidates = useStore((s) => s.candidates);
  const appliedIndex = useStore((s) => s.appliedIndex);
  const setCandidates = useStore((s) => s.setCandidates);
  const setAppliedIndex = useStore((s) => s.setAppliedIndex);

  const requirements = useStore(
    useShallow((s) => ({
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

  const placedFurniture = furniture.filter((f) => f.placed);
  const canGenerate = placedFurniture.length > 0 && !generating;

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const bounds = boundsFromWalls(walls);
      const lockedItems = placedFurniture.filter((f) => f.locked);
      const movableItems = placedFurniture.filter((f) => !f.locked);
      const res = await fetch("/api/arrange", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          // Movable items — Claude is asked to produce moves for these.
          furniture: movableItems.map((f) => ({
            id: f.id,
            label: f.label,
            width: f.width,
            depth: f.depth,
            x: f.x,
            z: f.z,
            rotation: f.rotation,
          })),
          // Locked items — Claude sees them as scene context (so it
          // can route around them) but is told NOT to propose moves
          // for them. The route's prompt enforces this.
          lockedFurniture: lockedItems.map((f) => ({
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
          k: 3,
        }),
      });

      if (res.status === 503) {
        setError(
          "AI is not configured on this server. Set ANTHROPIC_API_KEY in .env.local to generate options.",
        );
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? `Request failed: ${res.status}`);
        return;
      }
      const data = (await res.json()) as { candidates: ArrangeCandidate[] };
      setCandidates(data.candidates);
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

  const applyCandidate = (idx: number) => {
    const cand = candidates[idx];
    if (!cand) return;
    const byId = new Map<string, (typeof furniture)[number]>(
      furniture.map((f) => [f.id, f]),
    );
    for (const move of cand.moves) {
      const item = byId.get(move.id);
      if (!item) continue;
      // Defense-in-depth: never apply moves to locked items even
      // if Claude returned them. The route's prompt already tells
      // Claude to leave locked items alone, but a stray move
      // shouldn't override the user's lock.
      if (item.locked) continue;
      setItemTransform(move.id, {
        x: move.x,
        z: move.z,
        rotation: move.rotation,
      });
    }
    setAppliedIndex(idx);
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
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px",
        }}
      >
        {/* Intro line + generate button */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div>
            <h3
              style={{
                margin: "0 0 4px",
                fontSize: 14,
                fontWeight: 700,
                color: INK,
              }}
            >
              Layout candidates
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "rgba(26, 26, 26, 0.55)",
              }}
            >
              Claude proposes 3 distinct arrangements based on your scene + the
              Requirements tab.
            </p>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={!canGenerate}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: "none",
              background: canGenerate ? ACCENT : "rgba(26, 26, 26, 0.1)",
              color: canGenerate ? "white" : "rgba(26, 26, 26, 0.4)",
              fontSize: 12,
              fontWeight: 700,
              cursor: canGenerate ? "pointer" : "not-allowed",
              transition: "background 0.15s ease",
              flexShrink: 0,
            }}
          >
            {generating ? "Generating…" : "Generate options"}
          </button>
        </div>

        {/* Error banner */}
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

        {/* Candidate cards */}
        {candidates.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {candidates.map((c, i) => (
              <article
                key={i}
                style={{
                  padding: "14px 16px",
                  borderRadius: 12,
                  background:
                    appliedIndex === i ? "rgba(255, 90, 31, 0.06)" : "#FFF8F1",
                  border: `1px solid ${
                    appliedIndex === i ? ACCENT : "rgba(26, 26, 26, 0.08)"
                  }`,
                  transition: "border 0.15s ease, background 0.15s ease",
                }}
              >
                <header
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: 4,
                  }}
                >
                  <h4
                    style={{
                      margin: 0,
                      fontSize: 14,
                      fontWeight: 700,
                      color: INK,
                    }}
                  >
                    {c.label}
                  </h4>
                  <span
                    style={{
                      fontSize: 11,
                      color: "rgba(26, 26, 26, 0.5)",
                      fontWeight: 500,
                    }}
                  >
                    {c.moves.length} moves
                  </span>
                </header>
                <p
                  style={{
                    margin: "0 0 10px",
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "rgba(26, 26, 26, 0.7)",
                  }}
                >
                  {c.notes}
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => applyCandidate(i)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 999,
                      border:
                        appliedIndex === i
                          ? `1px solid ${ACCENT}`
                          : "1px solid rgba(26, 26, 26, 0.12)",
                      background: appliedIndex === i ? ACCENT : "transparent",
                      color:
                        appliedIndex === i ? "white" : "rgba(26, 26, 26, 0.75)",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {appliedIndex === i ? "Applied" : "Apply"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!generating && candidates.length === 0 && !error && (
          <div
            style={{
              textAlign: "center",
              padding: "40px 24px",
              color: "rgba(26, 26, 26, 0.5)",
              fontSize: 13,
            }}
          >
            No options generated yet. Click <strong>Generate options</strong> to
            ask Claude for arrangements based on your current scene and
            Requirements settings.
          </div>
        )}

        {/* Generating spinner row */}
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
            <span>
              Asking Claude for layout candidates… typically 8–20 seconds.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
