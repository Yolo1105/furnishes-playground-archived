/**
 * Wire event shapes — the simplified SSE format we emit to the client.
 *
 * Anthropic's HTTP streaming response is verbose: one event per type
 * (message_start, content_block_start, content_block_delta,
 * content_block_stop, message_delta, message_stop, ping). The client
 * doesn't need that detail; it only cares about "more text arrived"
 * and "we're done." So the brain pump translates Anthropic's stream
 * into a simpler 3-event protocol on its way out:
 *
 *   - **delta** — a chunk of text to append to the assistant bubble
 *   - **done** — final text was N characters; no more events coming
 *   - **error** — generation failed; failure category attached
 *
 * One event per SSE record (`data: {...}\n\n`). The `event:` line is
 * always set so EventSource clients can dispatch by type if they
 * choose, but the inline `type` field carries the same info for
 * clients that just parse `data` JSON.
 *
 * Why a translation layer instead of forwarding Anthropic events:
 *   1. Decouples our wire shape from Anthropic's. If we ever change
 *      provider, only this module needs updating.
 *   2. Hides verbose framing (Anthropic emits ~10 events for a single
 *      sentence). Our consumer just sees deltas.
 *   3. Lets us unify primary-stream events with recovery events. When
 *      primary fails and recovery (non-stream) succeeds, the client
 *      sees a single `done` event with the recovery text — no
 *      protocol switch.
 *
 * The error event carries a `category` from the Turn 1 failure
 * taxonomy plus a user-facing display string from `chat-copy.ts`.
 * Two complementary signals: the category for telemetry / retry
 * logic, the display string for the bubble.
 */

import type { ChatGenerationFailureCategory } from "../core/chat-generation-failure";

/** Text fragment to append. Sent multiple times during a stream. */
export type WireDeltaEvent = {
  type: "delta";
  /** Raw text fragment. Already sanitized via stream-display
   *  sanitizer (lenient pass that preserves partial tokens). */
  text: string;
};

/** Stream finished successfully. Sent once at the end. */
export type WireDoneEvent = {
  type: "done";
  /** Total length of the assembled output, in characters. The client
   *  uses this to verify it received everything and detect truncation. */
  totalLength: number;
  /** Whether the strict sanitizer collapsed output and we fell back
   *  to lenient guards. Telemetry only — the client doesn't change
   *  behavior based on this. */
  usedLenientFallback: boolean;
};

/** Stream failed. Sent once; no more events follow. */
export type WireErrorEvent = {
  type: "error";
  /** Stable enum from chat-generation-failure.ts. Client uses this
   *  for retry classification and dashboard correlation. */
  category: ChatGenerationFailureCategory;
  /** User-facing display string from chat-copy.ts. The chat dock
   *  renders this verbatim in the failed assistant bubble. */
  displayMessage: string;
};

export type WireEvent = WireDeltaEvent | WireDoneEvent | WireErrorEvent;

/** Encode a wire event as an SSE record. Returns the raw string
 *  including the trailing double-newline that ends an SSE record. */
export function encodeWireEvent(event: WireEvent): string {
  // Use a named SSE event type so EventSource clients can dispatch
  // on it. The data line carries the full payload as JSON for
  // parser-based clients (most fetch-stream consumers).
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Encode multiple events at once (useful when we have buffered
 *  deltas to flush). */
export function encodeWireEvents(events: readonly WireEvent[]): string {
  return events.map(encodeWireEvent).join("");
}
