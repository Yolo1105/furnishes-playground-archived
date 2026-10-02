/**
 * Chat generation failure taxonomy (server + client).
 *
 * Categories are logged on the server for every failure branch; the
 * client may attach the same enum to failed assistant messages for
 * correlation with `chatRequestId` (see `X-Chat-Request-Id` response
 * header).
 *
 * Where each category is set:
 *
 * - **primary_stream_empty** — stream ended with no text on primary
 *   model (before fallback stream).
 * - **fallback_stream_empty** — after fallback stream + aggregated
 *   recovery, still no text.
 * - **primary_stream_exception** — error while reading primary
 *   textStream (non-abort).
 * - **fallback_stream_exception** — error while reading fallback
 *   textStream (non-abort).
 * - **recovery_generate_text_exception** — generateText recovery
 *   threw for a model attempt.
 * - **recovery_generate_text_blank** — generateText returned empty/
 *   whitespace after finalize.
 * - **sanitization_collapsed_output** — finalizeAssistantOutput
 *   emptied usable text (stream or recovery).
 * - **client_abort** — request signal aborted during recovery loop
 *   or stream read (server-side disconnect).
 * - **stream_interrupted** — stream read failed for reasons other
 *   than AbortError (provider/network).
 * - **final_empty_reply** — all recovery paths exhausted; user sees
 *   CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED.
 * - **all_models_failed** — both streamText calls threw before any
 *   stream (503 to client).
 * - **llm_unavailable_http** — non-stream 503 or LLM error before
 *   body.
 * - **unknown_chat_failure** — catch-all when classification is
 *   ambiguous.
 *
 * Logs: search for `event` names in chat route
 * (chat_primary_stream_empty, …) or `failureCategory` on structured
 * `chat_generation` log lines.
 *
 * Ported from eva/core/chat-generation-failure.ts. Enum values
 * preserved exactly so any persisted message rows from eva-style
 * sessions still classify correctly.
 */

export const CHAT_GENERATION_FAILURE = {
  PRIMARY_STREAM_EMPTY: "primary_stream_empty",
  FALLBACK_STREAM_EMPTY: "fallback_stream_empty",
  PRIMARY_STREAM_EXCEPTION: "primary_stream_exception",
  FALLBACK_STREAM_EXCEPTION: "fallback_stream_exception",
  RECOVERY_GENERATE_TEXT_EXCEPTION: "recovery_generate_text_exception",
  RECOVERY_GENERATE_TEXT_BLANK: "recovery_generate_text_blank",
  SANITIZATION_COLLAPSED_OUTPUT: "sanitization_collapsed_output",
  CLIENT_ABORT: "client_abort",
  STREAM_INTERRUPTED: "stream_interrupted",
  FINAL_EMPTY_REPLY: "final_empty_reply",
  ALL_MODELS_FAILED: "all_models_failed",
  LLM_UNAVAILABLE_HTTP: "llm_unavailable_http",
  UNKNOWN_CHAT_FAILURE: "unknown_chat_failure",
} as const;

export type ChatGenerationFailureCategory =
  (typeof CHAT_GENERATION_FAILURE)[keyof typeof CHAT_GENERATION_FAILURE];

/** Response headers (machine-readable, safe for clients — not user-visible copy). */
export const CHAT_RESPONSE_HEADER = {
  REQUEST_ID: "X-Chat-Request-Id",
  /** Set on non-stream errors when the category is known before the body. */
  GENERATION_FAILURE: "X-Chat-Generation-Failure",
  /** Echo of optional client body field for retry correlation. */
  CLIENT_ATTEMPT_ID: "X-Chat-Client-Attempt-Id",
} as const;

/** Telemetry / structured log event names (align server logs with dashboards). */
export const CHAT_GENERATION_TELEMETRY = {
  PRIMARY_STREAM_STARTED: "chat_primary_stream_started",
  PRIMARY_STREAM_EMPTY: "chat_primary_stream_empty",
  PRIMARY_STREAM_FAILED: "chat_primary_stream_failed",
  FALLBACK_STREAM_STARTED: "chat_fallback_stream_started",
  FALLBACK_STREAM_EMPTY: "chat_fallback_stream_empty",
  FALLBACK_STREAM_FAILED: "chat_fallback_stream_failed",
  RECOVERY_GENERATE_TEXT_ATTEMPT: "chat_recovery_generateText_attempt",
  RECOVERY_GENERATE_TEXT_BLANK: "chat_recovery_generateText_blank",
  RECOVERY_GENERATE_TEXT_SUCCESS: "chat_recovery_generateText_success",
  SANITIZATION_COLLAPSED_OUTPUT: "chat_sanitization_collapsed_output",
  STREAM_INTERRUPTED: "chat_stream_interrupted",
  CLIENT_ABORT: "chat_client_abort",
  FINAL_FAILURE_RETRYABLE: "chat_final_failure_retryable",
} as const;

import {
  CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED,
  CHAT_FAILURE_SANITIZATION_EMPTIED,
} from "./chat-copy";

/** Map exact user-facing terminal strings to failure categories
 *  (client + server). Useful when the only signal we have is the
 *  rendered bubble text — e.g. a failed turn that was persisted
 *  before we started writing the X-Chat-Generation-Failure header. */
export function inferGenerationFailureCategoryFromDisplayContent(
  content: string,
): ChatGenerationFailureCategory | undefined {
  const t = content.trim();
  if (t === CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED)
    return CHAT_GENERATION_FAILURE.FINAL_EMPTY_REPLY;
  if (t === CHAT_FAILURE_SANITIZATION_EMPTIED)
    return CHAT_GENERATION_FAILURE.SANITIZATION_COLLAPSED_OUTPUT;
  return undefined;
}
