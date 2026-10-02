/**
 * Shared user-facing copy for chat failures (server + client).
 *
 * Import from here only — do not scatter failure strings across
 * components. The copy is intentionally specific (empty model output
 * vs. network vs. safety filter) so users get an actionable hint
 * rather than a generic "something went wrong".
 *
 * Ported from eva/core/chat-copy.ts. Strings preserved exactly so
 * `isAssistantFailureDisplayContent` can identify legacy messages
 * coming back from older sessions.
 */

/**
 * After all streaming + generateText recovery attempts still yield nothing useful.
 * Wording is intentionally specific: empty model output vs. network vs. safety filter.
 */
export const CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED =
  "I couldn't finish that reply just now—try again in a moment, or resend your message.";

/** @deprecated Use {@link CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED} or {@link isAssistantFailureDisplayContent}. */
export const EMPTY_ASSISTANT_STREAM_MESSAGE =
  CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED;

/** Model / filters left nothing safe to show (rare). */
export const CHAT_FAILURE_SANITIZATION_EMPTIED =
  "That reply was filtered for safety and came back empty. Try rephrasing, or send again in a moment.";

/** Generic AI / provider outage (HTTP 503 from API). */
export const CHAT_FAILURE_AI_TEMPORARILY_UNAVAILABLE =
  "I'm having trouble reaching the AI service—try again in a moment.";

/** Stream ended with no bytes (client: missing body). */
export const CHAT_FAILURE_NO_STREAM =
  "I didn't get a readable reply—check your connection and try again.";

/** Legacy assistant terminal line (older sessions / cached clients). */
export const CHAT_FAILURE_LEGACY_EMPTY_REPLY =
  "I couldn't generate a reply this time. Please try again in a moment.";

/** Fetch / client: stream hit the client timeout (not user Stop). */
export const CHAT_FAILURE_STREAM_TIMEOUT =
  "That reply took longer than expected—try again in a moment.";

/** Fetch / client: network error. */
export const CHAT_FAILURE_FETCH_NETWORK =
  "I can't reach the server—check your connection and try again.";

/** Fetch / client: non-network error. */
export const CHAT_FAILURE_FETCH_GENERIC =
  "Something went wrong on my side—try again.";

/** No ReadableStream on a 200 response (client). */
export const CHAT_FAILURE_NO_RESPONSE_STREAM =
  "I didn't receive a streaming reply—check your connection and try again.";

const EXACT_FAILURE_MESSAGES: readonly string[] = [
  CHAT_FAILURE_ALL_RECOVERY_EXHAUSTED,
  CHAT_FAILURE_SANITIZATION_EMPTIED,
  CHAT_FAILURE_AI_TEMPORARILY_UNAVAILABLE,
  CHAT_FAILURE_NO_STREAM,
  CHAT_FAILURE_LEGACY_EMPTY_REPLY,
  CHAT_FAILURE_STREAM_TIMEOUT,
  CHAT_FAILURE_FETCH_NETWORK,
  CHAT_FAILURE_FETCH_GENERIC,
  CHAT_FAILURE_NO_RESPONSE_STREAM,
];

const EXACT_FAILURE_SET = new Set(EXACT_FAILURE_MESSAGES);

/** Partial matches for older infra / stream error phrasing (not full-line copy). */
const INFRASTRUCTURE_FAILURE_SUBSTRINGS: readonly string[] = [
  "Something went wrong",
  "can't reach the server",
  "No response stream",
  "No reply was returned",
  "No text arrived in this reply",
  "No assistant text arrived in this reply",
  "took too long",
];

/**
 * True when assistant bubble content is a known terminal failure
 * string (exact), or matches legacy infrastructure error phrasing
 * (substring).
 *
 * Used by the chat dock to render a "retry" affordance instead of a
 * normal assistant bubble for failed turns.
 */
export function isAssistantFailureDisplayContent(content: string): boolean {
  const t = content.trim();
  if (!t) return false;
  if (EXACT_FAILURE_SET.has(t)) return true;
  return INFRASTRUCTURE_FAILURE_SUBSTRINGS.some((s) => t.includes(s));
}

/**
 * @deprecated Use {@link isAssistantFailureDisplayContent} (same behavior; name clarified).
 */
export function isKnownAssistantFailureMessage(content: string): boolean {
  return isAssistantFailureDisplayContent(content);
}

/** Retry / error UI: assistant row is a failed or terminal copy state. */
export function isAssistantBubbleFailureState(msg: {
  role: string;
  content?: string;
  isError?: boolean;
  errorType?: string;
}): boolean {
  if (msg.role !== "assistant") return false;
  if (msg.isError) return true;
  if (msg.errorType === "empty_reply") return true;
  if (typeof msg.content === "string")
    return isAssistantFailureDisplayContent(msg.content);
  return false;
}
