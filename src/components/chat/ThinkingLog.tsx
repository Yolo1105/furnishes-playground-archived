"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@studio/store";
import { THINKING_STATES } from "@studio/chat/thinkingStates";
import { selectActiveConversationTurns } from "@studio/store/chat-slice";
import type { ThinkingHistoryEntry } from "@studio/store/types";

// v0.40.43: pulled from 1700ms to 2400ms. The faster tick read as
// nervous — strings flickered past faster than the eye could read
// them. Slower pacing matches the studio's restrained brand voice
// and lets each line register before the next replaces it.
const TICK_MS = 2400;
// Visible-history cap. v0.40.12 dropped this from 12 → 4 because
// 12 visible lines were producing visual overload — the user couldn't
// quickly read the active line for all the noise of fading older
// lines. With 4, the user sees: current (full opacity) + two fading
// + one barely visible. The rolling-progress feel is preserved with
// far less visual cost.
//
// v0.40.26: dropped further to 3 visible lines + a pinned user-message
// ghost line above. The smaller cap keeps the processing footprint
// minimal (the user's design ask: "only use little space"). The
// pinned user-msg line gives back the context they wanted ("at least
// what they sent").
const HISTORY_CAP = 3;

/** Strip a trailing ellipsis ("…", "...", "....") so the displayed
 *  thinking line doesn't double-up on dots when we add the animated
 *  blinking dots span next to it. The data layer (THINKING_STATES,
 *  pickSubStages) writes lines like "Sketching the floor plan…",
 *  and the render layer adds an animated "..." span after the latest
 *  line. Without stripping, the latest line shows "Sketching the
 *  floor plan… ...". v0.40.26 fix. */
function stripTrailingDots(text: string): string {
  return text.replace(/\s*[…\.]+\s*$/u, "").trimEnd();
}

// Heartbeat: how often to check whether to push a sub-stage.
const HEARTBEAT_MS = 2200;
// Quiet threshold: only push a sub-stage when the most recent line
// is older than this. Prevents heartbeat from firing right after a
// real backend event lands.
const QUIET_THRESHOLD_MS = 2000;

/**
 * Sub-stage fragments keyed off the lowercased real stage. When the
 * heartbeat detects quiet time, it rotates through these to keep the
 * log moving. The text is deliberately fuzzy — we don't actually
 * know what the backend is doing during quiet time, just that it's
 * still working.
 *
 * Each list rotates indefinitely (modulo wrap), so a long quiet
 * stretch reads as "Reading the prompt… → Considering structure… →
 * Reading the prompt…" rather than running out of new lines.
 */
function pickSubStages(currentRealStage: string): string[] {
  const stage = currentRealStage.toLowerCase();
  // Match the most-distinctive substring of the real stage to a
  // sub-stage list. Order matters — more specific matches come first.
  if (stage.includes("intent")) {
    return [
      "Reading the prompt…",
      "Identifying the room type…",
      "Considering scale and proportion…",
      "Drafting an approach…",
    ];
  }
  if (stage.includes("style")) {
    return [
      "Cross-referencing materials…",
      "Building the palette…",
      "Choosing wood tones…",
      "Tuning the mood…",
    ];
  }
  // v0.40.19: "Sketching the floor plan" replaces the old generic
  // "Placing N pieces" message. Sub-stages walk through the layout
  // reasoning the orchestrator is doing in this window — checking
  // clearances around walls, aligning sightlines from the seating
  // group toward the focal piece, refining piece positions.
  if (
    stage.includes("sketching") ||
    stage.includes("placing") ||
    stage.includes("piece")
  ) {
    return [
      "Checking clearances…",
      "Aligning sight lines…",
      "Refining positions…",
      "Sketching the floor plan…",
    ];
  }
  // "Rendered (3 of 7): low futon sofa" — the v0.40.19 piece-ready
  // stage. We don't actually have intermediate sub-stages here (each
  // piece_ready event is a single instant), but we still want the
  // log to feel busy during the gap between events. Use texturing /
  // material-pass language that fits "we just got a mesh, the next
  // one is being baked."
  if (
    stage.includes("rendered") ||
    stage.includes("rendering mesh") ||
    stage.includes("mesh ")
  ) {
    return [
      "Baking textures…",
      "Compositing materials…",
      "Generating UVs…",
      "Finalizing the mesh…",
    ];
  }
  if (stage.includes("initializ")) {
    return [
      "Warming up the model…",
      "Preparing the canvas…",
      "Setting up the run…",
    ];
  }
  // Fallback for stages we haven't enumerated.
  return ["Working on it…", "Almost there…", "Hang tight…"];
}

/** Count how many lines, starting from the most recent, are NOT the
 *  current real stage. Used to rotate through the sub-stage list so
 *  the user doesn't see the same heartbeat sub-stage twice in a row. */
function countSubStagesSinceRealStage(
  history: Array<{ id: number; text: string }>,
): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    // The "real stage" markers always end in "…" but so do sub-stages.
    // Easier to detect by walking back until we hit a stage that
    // starts with one of the orchestrator's known-real prefixes.
    const t = history[i].text;
    if (
      t.startsWith("Initializing") ||
      t.startsWith("Parsing intent") ||
      t.startsWith("Style:") ||
      t.startsWith("Sketching") ||
      t.startsWith("Placing ") ||
      t.startsWith("Rendered ") ||
      t.startsWith("Rendering mesh") ||
      t.startsWith("Mesh ")
    ) {
      break;
    }
    count++;
  }
  return count;
}

/**
 * Rolling animated log of thinking states shown above the input while
 * the assistant is "thinking." Two modes:
 *
 *   1. Chat mode (Interior Design path) — no real progress info is
 *      available, so we cycle generic THINKING_STATES on a 1700ms
 *      interval. Each tick appends a new line; older lines fade.
 *
 *   2. Generation mode (Furniture / Room Layout) — the orchestrator
 *      emits real stage strings ("Parsing intent…", "Style: Mid-
 *      century modern", "Mesh 3 of 6…") into `generationStage`. We
 *      append a new line every time `generationStage` changes —
 *      no fixed-interval cycling, just real progress as it arrives.
 *      A static sparkle icon stands in for the per-state icons used
 *      in chat mode.
 *
 * In both modes the latest line gets the accent color, a pulsing
 * icon, and three blinking dots; older lines fade. The log unmounts
 * when isThinking flips off.
 */
export function ThinkingLog() {
  const isThinking = useStore((s) => s.isThinking);
  const isGenerating = useStore((s) => s.isGenerating);
  const generationStage = useStore((s) => s.generationStage);

  // v0.40.27: read the in-flight user text directly from the store
  // instead of via the conversation array. The conversation isn't
  // updated until the turn finishes (finishTurn pushes it), so during
  // processing the latest turn is either missing (first message) or
  // points at a PRIOR turn's text. pendingUserText is set at send-
  // time and cleared on finish — exactly the lifetime we want for
  // the pinned echo line.
  const pendingUserText = useStore(
    (s) => (s as unknown as { pendingUserText?: string }).pendingUserText ?? "",
  );
  // Fall back to the conversation's last turn for legacy paths that
  // might not flow through pendingUserText (e.g. an external sync).
  const conversation = useStore(selectActiveConversationTurns);
  const latestUserText =
    pendingUserText ||
    (conversation.length > 0
      ? conversation[conversation.length - 1].userText
      : "");

  // History entries for the chat-mode (cycling) path. Each carries
  // an index into THINKING_STATES.
  const [cycleHistory, setCycleHistory] = useState<ThinkingHistoryEntry[]>([]);

  // History for the generation-mode path — each entry is a literal
  // stage string from the orchestrator. The same HISTORY_CAP cap
  // applies; the same fade applies.
  const [stageHistory, setStageHistory] = useState<
    Array<{ id: number; text: string }>
  >([]);
  const lastStageRef = useRef<string>("");

  // ── Chat-mode tick ──────────────────────────────────────────────
  // Only runs when isThinking is true AND we're NOT in a generation
  // (the generation path drives content directly from store state,
  // so a fixed-interval tick would fight it).
  useEffect(() => {
    if (!isThinking || isGenerating) {
      setCycleHistory([]);
      return;
    }
    setCycleHistory([{ idx: 0, id: Date.now() }]);
    const interval = setInterval(() => {
      setCycleHistory((prev) => {
        const lastIdx = prev.length > 0 ? prev[prev.length - 1].idx : -1;
        const nextIdx = (lastIdx + 1) % THINKING_STATES.length;
        const next = [
          ...prev,
          { idx: nextIdx, id: Date.now() + Math.random() },
        ];
        return next.length > HISTORY_CAP ? next.slice(-HISTORY_CAP) : next;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [isThinking, isGenerating]);

  // ── Generation-mode stage append ────────────────────────────────
  // Fires every time `generationStage` changes (and only when we're
  // in a generation). Each new non-empty stage becomes a new line.
  // Skip duplicates so a no-op set("Initializing…") doesn't echo.
  useEffect(() => {
    if (!isGenerating) {
      setStageHistory([]);
      lastStageRef.current = "";
      return;
    }
    const stage = generationStage.trim();
    if (!stage || stage === lastStageRef.current) return;
    lastStageRef.current = stage;
    setStageHistory((prev) => {
      const next = [...prev, { id: Date.now() + Math.random(), text: stage }];
      return next.length > HISTORY_CAP ? next.slice(-HISTORY_CAP) : next;
    });
  }, [isGenerating, generationStage]);

  // ── Generation-mode HEARTBEAT ──────────────────────────────────
  // Real backend events arrive at their own pace — sometimes there's
  // 5–15 seconds of silence (Anthropic intent step is slow). Without
  // a heartbeat the log stalls on the last real line and the user
  // thinks generation died.
  //
  // This effect fires every HEARTBEAT_MS, and IF the time since the
  // last appended stage exceeds QUIET_THRESHOLD_MS, it appends one
  // sub-stage drawn from a list keyed off the current real stage.
  // The sub-stages are intentionally vague ("Drafting layout…",
  // "Sketching options…") because we don't actually know what the
  // backend is doing — they just communicate "still working."
  //
  // When the next real stage arrives, the effect's dependency on
  // generationStage resets the timer (and the duplicate-stage
  // filter above prevents loops).
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      setStageHistory((prev) => {
        // Quiet check: if the most-recent line landed less than
        // QUIET_THRESHOLD_MS ago, don't push a sub-stage yet —
        // there's still real progress in the user's recent past.
        const last = prev[prev.length - 1];
        if (last) {
          const ageMs = Date.now() - last.id;
          if (ageMs < QUIET_THRESHOLD_MS) return prev;
        }

        // Pick the next sub-stage from the list keyed off the most
        // recent REAL stage (not a previously-appended sub-stage).
        // We track the last real stage in lastStageRef.
        const realStage = lastStageRef.current.toLowerCase();
        const subStages = pickSubStages(realStage);
        // Rotate: count how many sub-stages we've already appended
        // for this real stage and pick the next one in the list.
        const subStagesAppended = countSubStagesSinceRealStage(prev);
        const next = subStages[subStagesAppended % subStages.length];
        // Don't echo: if the most-recent line is already this sub-
        // stage (short cycle), skip this beat.
        if (last && last.text === next) return prev;

        const updated = [
          ...prev,
          { id: Date.now() + Math.random(), text: next },
        ];
        return updated.length > HISTORY_CAP
          ? updated.slice(-HISTORY_CAP)
          : updated;
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [isGenerating, generationStage]);

  if (!isThinking) return null;

  // Pick which list to render. Generation overrides chat-mode
  // because the user explicitly asked for a generation, so the
  // real-stage feed is what they want to see.
  const useGenerationFeed = isGenerating;
  const lines: Array<{
    id: number;
    text: string;
    icon: React.ReactNode;
  }> = useGenerationFeed
    ? stageHistory.map((e) => ({
        id: e.id,
        // Strip trailing dots — the animated "..." span on the
        // latest line is the sole orange accent, no double dots.
        text: stripTrailingDots(e.text),
        icon: <SparkleIcon />,
      }))
    : cycleHistory.map((e) => ({
        id: e.id,
        text: stripTrailingDots(THINKING_STATES[e.idx].text),
        icon: THINKING_STATES[e.idx].icon,
      }));

  // While generation is initializing (no stages yet), show a single
  // priming line so the log isn't empty.
  if (lines.length === 0 && useGenerationFeed) {
    lines.push({ id: 0, text: "Initializing", icon: <SparkleIcon /> });
  }

  return (
    <div
      style={{
        padding: "10px 4px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      {/* v0.40.43 eyebrow label. "Drafting" replaces the previous
          generic "Working" — it's what an architect actually does
          (sketches and revises on paper), and it shares the
          10/600/uppercase/+0.12em treatment with the EmptyCanvas
          eyebrow ("Furnishes Studio") so the surfaces read as one
          design language. The accent color (vs. the empty state's
          ink/50%) signals that something is actively in progress. */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "rgba(255, 90, 31, 0.7)",
          padding: "0 0 4px",
        }}
      >
        Drafting
      </div>
      {/* Pinned user-message echo. v0.40.26: the user wanted a
          minimal processing UI that still shows what they sent.
          Renders as a faded prefix-arrow line ABOVE the thinking
          stream. Stays put while the lines below scroll/fade. */}
      {latestUserText && (
        <div
          style={{
            // -webkit-box display + 1-line clamp so a long prompt
            // doesn't blow out the dock. We need the WebKit clamp
            // for the ellipsis, which requires display:-webkit-box.
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            alignItems: "center",
            gap: 8,
            fontSize: 11.5,
            color: "rgba(26, 26, 26, 0.45)",
            fontStyle: "italic",
            fontWeight: 500,
            letterSpacing: "-0.005em",
            padding: "2px 0 6px",
            overflow: "hidden",
            // Subtle entrance — fade in once when processing starts
            // and stay put. No translate / scale.
            animation: "thinking-userecho-in 0.25s ease",
          }}
        >
          <span
            style={{
              color: "rgba(26, 26, 26, 0.4)",
              flexShrink: 0,
              fontStyle: "normal",
              marginRight: 6,
            }}
          >
            ›
          </span>
          <span>{latestUserText}</span>
        </div>
      )}

      {lines.map((entry, i) => {
        const isLatest = i === lines.length - 1;
        const olderFade = Math.max(0.25, 1 - (lines.length - 1 - i) * 0.15);
        return (
          <div
            key={entry.id}
            className="thinking-line"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              // v0.40.43: latest line at 14px (matches body / chip
              // tier of the studio scale); older lines at 12px so
              // they read as quieter, fading metadata. The size step
              // reinforces the "this is what's happening NOW" cue
              // beyond the existing color + weight + shimmer.
              fontSize: isLatest ? 14 : 12,
              color: isLatest
                ? "rgba(26, 26, 26, 0.85)"
                : `rgba(26, 26, 26, ${olderFade * 0.55})`,
              // Active line gets weight 600; older lines drop to 400
              // so they don't compete with the active line for
              // attention. Previously older was 500.
              fontWeight: isLatest ? 600 : 400,
              letterSpacing: "-0.005em",
              padding: "4px 0",
              overflow: "hidden",
              // v0.40.42: per-line entrance + active-line shimmer.
              // Entrance plays once when the line first appears
              // (key by entry.id); the shimmer keeps the latest line
              // looking alive while the backend works.
              animation: isLatest
                ? "thinking-line-in 0.32s cubic-bezier(0.22, 1, 0.36, 1)"
                : "thinking-line-in 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
              ...(isLatest && {
                backgroundImage:
                  "linear-gradient(90deg, transparent 0%, rgba(255, 90, 31, 0.08) 50%, transparent 100%)",
                backgroundSize: "200% 100%",
                backgroundRepeat: "no-repeat",
                animationName: "thinking-line-in, thinking-line-shimmer",
                animationDuration: "0.32s, 2.5s",
                animationTimingFunction:
                  "cubic-bezier(0.22, 1, 0.36, 1), linear",
                animationIterationCount: "1, infinite",
                borderRadius: 4,
                paddingLeft: 4,
                marginLeft: -4,
              }),
            }}
          >
            <span
              className="thinking-icon"
              style={{
                display: "flex",
                color: isLatest ? "#FF5A1F" : "rgba(26, 26, 26, 0.5)",
                flexShrink: 0,
                // v0.40.42: gentle pulse on the active line's icon
                // so the eye is drawn to "what's happening now"
                // without a hard blink.
                animation: isLatest
                  ? "thinking-icon-pulse 1.6s ease-in-out infinite"
                  : "none",
              }}
            >
              {entry.icon}
            </span>
            <span>{entry.text}</span>
            {isLatest && (
              <span
                className="thinking-dots"
                style={{
                  display: "inline-flex",
                  gap: 2,
                  marginLeft: 2,
                  color: "#FF5A1F",
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    animation: "thinking-dot-bounce 1.4s ease-in-out infinite",
                    animationDelay: "0s",
                    display: "inline-block",
                  }}
                >
                  .
                </span>
                <span
                  style={{
                    animation: "thinking-dot-bounce 1.4s ease-in-out infinite",
                    animationDelay: "0.15s",
                    display: "inline-block",
                  }}
                >
                  .
                </span>
                <span
                  style={{
                    animation: "thinking-dot-bounce 1.4s ease-in-out infinite",
                    animationDelay: "0.3s",
                    display: "inline-block",
                  }}
                >
                  .
                </span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Simple 4-point sparkle. Same 12px size as the THINKING_STATES
 *  icons so the layout is consistent across chat and generation
 *  modes. Used as the static icon for every generation-stage line. */
function SparkleIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3 L13.5 10.5 L21 12 L13.5 13.5 L12 21 L10.5 13.5 L3 12 L10.5 10.5 Z" />
    </svg>
  );
}
