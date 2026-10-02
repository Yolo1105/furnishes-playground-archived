/**
 * Client-side wire-event stream consumer.
 *
 * Both the chat slice and the suggestions slice consume an SSE stream
 * with the 3-event protocol (delta/done/error) defined by
 * `wire-events.ts` on the server. Before this module, each slice had
 * its own copy of the parser and stream-reading loop — byte-for-byte
 * identical except for one extra optional field (`totalLength`).
 *
 * Consolidating here:
 *   - `decodeWireRecord`: parse one SSE record (the bytes between
 *     blank lines) into a typed event, or null if the record is a
 *     keep-alive comment / malformed JSON / unknown event type.
 *   - `consumeChatBrainStream`: read a Response body's stream, split
 *     records on the SSE blank-line boundary, dispatch each decoded
 *     event to a callback, and handle abort signals + partial chunks.
 *
 * Why is this in `chat-brain/generation/` and not `lib/store/`? Two
 * reasons:
 *   1. The wire shape is owned by the server's wire-events module.
 *      Putting the client-side decoder next to it keeps the producer
 *      and consumer of the protocol in the same neighbourhood.
 *   2. Future callers (a CLI consumer, a worker thread) won't be in
 *      the Zustand store. The helper shouldn't import slice types.
 */

/**
 * The shape of a decoded wire event. Mirrors `WireEvent` from
 * `wire-events.ts` on the server side, but with all fields optional
 * because the consumer has to handle records that arrived during
 * partial decoding (e.g. an event-type-only record with no JSON
 * payload yet).
 */
export type DecodedWireEvent = {
  type: "delta" | "done" | "error";
  /** Text fragment for `delta` events. */
  text?: string;
  /** Total length the server reports on a `done` event. */
  totalLength?: number;
  /** Failure category from the chat-generation-failure taxonomy. */
  category?: string;
  /** User-facing message for `error` events. */
  displayMessage?: string;
  /** Whether the server fell back to the lenient sanitizer (telemetry). */
  usedLenientFallback?: boolean;
};

/**
 * Decode one SSE record. Records are separated by a blank line in the
 * stream; this function operates on the bytes between separators.
 *
 * Returns null when the record is:
 *   - empty after trimming (whitespace-only)
 *   - a comment (line starts with `:`)
 *   - missing a `data:` line
 *   - JSON-malformed in the data payload
 *   - typed as something other than delta/done/error
 *
 * Callers should treat null as "skip this record and keep reading."
 */
export function decodeWireRecord(record: string): DecodedWireEvent | null {
  const trimmed = record.trim();
  if (!trimmed) return null;
  let event = "";
  const dataLines: string[] = [];
  for (const line of trimmed.split("\n")) {
    if (line.startsWith(":")) continue; // SSE comment
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
    // Ignore id:, retry: — we don't use them.
  }
  if (dataLines.length === 0) return null;

  try {
    const data = JSON.parse(dataLines.join("\n"));
    if (
      data?.type === "delta" ||
      data?.type === "done" ||
      data?.type === "error"
    ) {
      return data;
    }
    // Some emitters send the type only on the `event:` line and leave
    // `data:` empty. Synthesize the event from the named type.
    if (event === "delta" || event === "done" || event === "error") {
      return { type: event };
    }
  } catch {
    // Malformed JSON in the data line. Skip rather than crash the
    // consumer — Anthropic occasionally emits partial frames during
    // transient connection issues, and we'd rather drop one event
    // than a whole stream.
  }
  return null;
}

/**
 * Consume the body of a streaming Response (Content-Type:
 * text/event-stream), invoking `onEvent` for each decoded wire event.
 * Resolves when the stream closes (clean or error).
 *
 * Partial-record handling: SSE records can span multiple network
 * packets. The consumer accumulates bytes in a buffer and only emits
 * complete records (those followed by `\n\n`). The trailing partial
 * stays in the buffer until more bytes arrive.
 *
 * Abort handling: pass `signal` to cancel the read. The reader is
 * cancelled and the function returns without invoking further
 * callbacks. Without a signal, the only way the function returns is
 * stream completion.
 */
export async function consumeChatBrainStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (ev: DecodedWireEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) {
        try {
          reader.cancel();
        } catch {
          // already gone
        }
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let recordEnd: number;
      while ((recordEnd = buffer.indexOf("\n\n")) !== -1) {
        const record = buffer.slice(0, recordEnd);
        buffer = buffer.slice(recordEnd + 2);
        const decoded = decodeWireRecord(record);
        if (decoded) onEvent(decoded);
      }
    }
    // The stream may close without a final `\n\n` if the server
    // ended the connection cleanly mid-record. Try to decode the
    // trailing buffer in case it contains a complete record.
    if (buffer.trim()) {
      const decoded = decodeWireRecord(buffer);
      if (decoded) onEvent(decoded);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}
