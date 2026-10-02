/**
 * Stream pump — orchestrates primary streaming + recovery non-stream.
 *
 * Strategy (simplified from eva's 3-tier):
 *
 *   1. **Primary**: open Anthropic SSE stream, accumulate deltas.
 *      Yield each delta to the caller as it arrives. Track total
 *      length and bail on `done`.
 *
 *   2. **Recovery (only if primary failed or returned empty)**: call
 *      Anthropic non-streaming with a slightly higher temperature
 *      (so we don't repeat the empty-output trap), wait for the
 *      full body, yield its text as one big delta, then `done`.
 *
 *   3. **Final failure**: if recovery also failed or returned empty,
 *      emit an error event with the appropriate failure category
 *      and the user-facing display message from chat-copy.
 *
 * The pump is an async generator yielding wire events. Caller
 * (build-stream-response.ts) pipes them into the SSE Response body.
 *
 * Why a generator and not a callback / push: lets the route handler
 * thread the events into its Response body using a TransformStream
 * without imposing a specific runtime API on the pump itself. Pump
 * stays runtime-agnostic.
 *
 * Failure classification matrix:
 *
 *   Primary stream throws AbortError       → CLIENT_ABORT
 *   Primary stream throws (other)          → PRIMARY_STREAM_EXCEPTION
 *   Primary stream completes but text=""   → PRIMARY_STREAM_EMPTY
 *   Recovery throws                        → RECOVERY_GENERATE_TEXT_EXCEPTION
 *   Recovery completes but sanitized=""    → RECOVERY_GENERATE_TEXT_BLANK
 *   Recovery completes, no fall-through    → no error event (success via recovery)
 *
 * If primary succeeds with non-empty text, we never call recovery.
 * If primary succeeds but sanitization collapses the text to empty,
 * we still emit `done` (the sanitizer's collapse is logged but
 * doesn't trigger recovery — the text we produced IS the right
 * answer, sanitized empty just means it was unsafe).
 *
 * Cost note: a recovery call doubles the model spend for that turn.
 * The session cost tracker (already in place) will catch run-away
 * recovery loops.
 */

import {
  CHAT_GENERATION_FAILURE,
  type ChatGenerationFailureCategory,
} from "../core/chat-generation-failure";
import {
  CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED,
  CHAT_FAILURE_AI_TEMPORARILY_UNAVAILABLE,
  CHAT_FAILURE_SANITIZATION_EMPTIED,
} from "../core/chat-copy";
import { finalizeAssistantOutput } from "../core/output-sanitize";
import {
  AnthropicStreamError,
  callAnthropicNonStreaming,
  streamAnthropicMessages,
  type AnthropicStreamRequest,
} from "./anthropic-stream";
import {
  CHAT_STREAM_RECOVERY_GENERATE_TEXT_TEMPERATURE,
  CHAT_STREAM_RECOVERY_GENERATE_TEXT_TIMEOUT_MS,
} from "./chat-stream-recovery-constants";
import type { WireEvent } from "./wire-events";

export interface PumpResult {
  /** The final text the user saw (after recovery if any, after
   *  sanitization). Empty when all paths failed. */
  finalText: string;
  /** When non-null, we emitted an error event and the bubble is a
   *  failure state. When null, the turn succeeded. */
  failureCategory: ChatGenerationFailureCategory | null;
  /** Which path produced finalText. "primary" = streaming worked,
   *  "recovery" = non-streaming fallback ran, "none" = total failure. */
  path: "primary" | "recovery" | "none";
  /** Whether sanitization collapsed strict pass and we used the
   *  lenient fallback. Telemetry signal. */
  usedLenientFallback: boolean;
}

/** Run the pump and yield wire events. Returns a summary of what
 *  happened so the caller can attach it to logs / response headers. */
export async function* runStreamPump(
  req: AnthropicStreamRequest,
): AsyncGenerator<WireEvent, PumpResult, void> {
  // ── PRIMARY: open the stream and forward deltas ────────────────
  let primaryText = "";
  let primaryFailedWith: ChatGenerationFailureCategory | null = null;

  try {
    for await (const ev of streamAnthropicMessages(req)) {
      if (ev.kind === "delta") {
        primaryText += ev.text;
        yield { type: "delta", text: ev.text };
      } else if (ev.kind === "done") {
        break;
      }
    }
  } catch (err) {
    if (err instanceof AnthropicStreamError) {
      primaryFailedWith = err.category;
    } else {
      primaryFailedWith = CHAT_GENERATION_FAILURE.PRIMARY_STREAM_EXCEPTION;
    }
    // Primary failed mid-stream. Don't yield error yet — try recovery.
  }

  // Primary success path: stream completed (with or without text).
  if (primaryFailedWith === null) {
    // Sanitize the accumulated text. If strict collapses it but we
    // have raw text, we still consider this a primary success (the
    // sanitizer's job is to clean output, not declare failure).
    const finalized = finalizeAssistantOutput(primaryText);
    if (finalized.text.length > 0) {
      yield {
        type: "done",
        totalLength: finalized.text.length,
        usedLenientFallback: finalized.usedLenientFallback,
      };
      return {
        finalText: finalized.text,
        failureCategory: null,
        path: "primary",
        usedLenientFallback: finalized.usedLenientFallback,
      };
    }

    // Primary ran but produced no usable text. Three sub-cases:
    //   - Sanitizer collapsed real input → SANITIZATION_COLLAPSED_OUTPUT
    //   - Stream produced zero bytes → PRIMARY_STREAM_EMPTY
    if (primaryText.trim().length > 0) {
      // Had real text; sanitization removed it.
      yield {
        type: "error",
        category: CHAT_GENERATION_FAILURE.SANITIZATION_COLLAPSED_OUTPUT,
        displayMessage: CHAT_FAILURE_SANITIZATION_EMPTIED,
      };
      return {
        finalText: "",
        failureCategory: CHAT_GENERATION_FAILURE.SANITIZATION_COLLAPSED_OUTPUT,
        path: "none",
        usedLenientFallback: false,
      };
    }
    // Empty primary — fall through to recovery.
    primaryFailedWith = CHAT_GENERATION_FAILURE.PRIMARY_STREAM_EMPTY;
  }

  // Don't try recovery on client abort — the client is gone.
  if (primaryFailedWith === CHAT_GENERATION_FAILURE.CLIENT_ABORT) {
    yield {
      type: "error",
      category: CHAT_GENERATION_FAILURE.CLIENT_ABORT,
      displayMessage: CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED,
    };
    return {
      finalText: "",
      failureCategory: CHAT_GENERATION_FAILURE.CLIENT_ABORT,
      path: "none",
      usedLenientFallback: false,
    };
  }

  // ── RECOVERY: non-streaming Anthropic call ─────────────────────
  // Higher temperature so we don't repeat the empty-output trap.
  // Bounded timeout via AbortController.
  const recoveryAbort = new AbortController();
  const timer = setTimeout(
    () => recoveryAbort.abort(),
    CHAT_STREAM_RECOVERY_GENERATE_TEXT_TIMEOUT_MS,
  );

  // If the user's abort signal also fires, propagate it.
  if (req.abortSignal) {
    if (req.abortSignal.aborted) recoveryAbort.abort();
    else
      req.abortSignal.addEventListener("abort", () => recoveryAbort.abort(), {
        once: true,
      });
  }

  let recoveryText = "";
  let recoveryFailedWith: ChatGenerationFailureCategory | null = null;
  try {
    recoveryText = await callAnthropicNonStreaming({
      ...req,
      temperature: CHAT_STREAM_RECOVERY_GENERATE_TEXT_TEMPERATURE,
      abortSignal: recoveryAbort.signal,
    });
  } catch (err) {
    recoveryFailedWith =
      err instanceof AnthropicStreamError
        ? err.category
        : CHAT_GENERATION_FAILURE.RECOVERY_GENERATE_TEXT_EXCEPTION;
  } finally {
    clearTimeout(timer);
  }

  if (recoveryFailedWith !== null) {
    // Recovery threw. Final failure.
    const display =
      recoveryFailedWith === CHAT_GENERATION_FAILURE.LLM_UNAVAILABLE_HTTP
        ? CHAT_FAILURE_AI_TEMPORARILY_UNAVAILABLE
        : CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED;
    yield {
      type: "error",
      category: recoveryFailedWith,
      displayMessage: display,
    };
    return {
      finalText: "",
      failureCategory: recoveryFailedWith,
      path: "none",
      usedLenientFallback: false,
    };
  }

  // Recovery returned. Sanitize.
  const finalized = finalizeAssistantOutput(recoveryText);
  if (finalized.text.length === 0) {
    // Recovery returned empty (or sanitized to empty). Final failure.
    const cat = recoveryText.trim().length > 0
      ? CHAT_GENERATION_FAILURE.SANITIZATION_COLLAPSED_OUTPUT
      : CHAT_GENERATION_FAILURE.RECOVERY_GENERATE_TEXT_BLANK;
    yield {
      type: "error",
      category: cat,
      displayMessage:
        cat === CHAT_GENERATION_FAILURE.SANITIZATION_COLLAPSED_OUTPUT
          ? CHAT_FAILURE_SANITIZATION_EMPTIED
          : CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED,
    };
    return {
      finalText: "",
      failureCategory: cat,
      path: "none",
      usedLenientFallback: false,
    };
  }

  // Recovery succeeded. Stream the recovered text out as one big
  // delta, then `done`. Client renders this as a single chunk
  // appearing at once — the user sees a slight delay but a complete
  // response.
  yield { type: "delta", text: finalized.text };
  yield {
    type: "done",
    totalLength: finalized.text.length,
    usedLenientFallback: finalized.usedLenientFallback,
  };

  return {
    finalText: finalized.text,
    failureCategory: null,
    path: "recovery",
    usedLenientFallback: finalized.usedLenientFallback,
  };
}
