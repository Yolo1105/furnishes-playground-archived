/**
 * Line-based SSE (Server-Sent Events) parser.
 *
 * The fetch streaming API gives us raw text chunks. SSE events are
 * separated by blank lines and look like:
 *
 *     data: { "kind": "intent", "intent": {...} }
 *
 *     data: { "kind": "style", "style": {...} }
 *
 * Two challenges solved here:
 *
 *   1. Chunk boundaries don't align to event boundaries. A chunk can
 *      arrive with a half-finished event at the end (`data: {"kind":
 *      "intent", "inten`) followed by the rest in the next chunk. We
 *      keep a buffer that holds the trailing incomplete line until
 *      the next chunk completes it.
 *
 *   2. Some events have malformed JSON (rare — provider hiccup, mid-
 *      generation error). We skip those instead of throwing, so a
 *      single bad event doesn't kill the whole stream. The orchestrator
 *      can also emit explicit `error` events when something goes
 *      wrong; those have well-formed JSON and are surfaced normally.
 *
 * The terminator `[DONE]` is fal.ai/OpenAI convention: it signals the
 * stream is finished. We don't emit it as a parsed event — the
 * caller knows the stream is over because the fetch readable closes.
 *
 * Usage:
 *
 *     const parser = createSSEParser<StreamEvent>();
 *     for await (const chunk of streamReader()) {
 *       for (const event of parser.feed(chunk)) {
 *         handleEvent(event);
 *       }
 *     }
 *     // optional: parser.flush() returns any remaining buffered event
 */

export interface SSEParser<T> {
  /** Feed a new chunk of text from the stream. Returns any events
   *  that completed inside this chunk (zero, one, or many). */
  feed(chunk: string): T[];
  /** Flush any remaining buffered event. Call once after the stream
   *  closes; usually returns an empty array unless the server didn't
   *  emit a final blank line. */
  flush(): T[];
  /** Reset the buffer. Call when restarting a stream (retry). */
  reset(): void;
}

export function createSSEParser<T = unknown>(): SSEParser<T> {
  let buffer = "";

  function parseEvent(eventText: string): T | null {
    // An event is a sequence of `field: value` lines, terminated by
    // a blank line. We only care about `data:` lines here — other
    // SSE fields (id, retry, event) are ignored because the
    // orchestrator doesn't use them.
    const lines = eventText.split("\n");
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {
        // Strip the "data:" prefix and a single optional space after.
        const value = line.slice(5).replace(/^ /, "");
        dataLines.push(value);
      }
    }
    if (dataLines.length === 0) return null;
    const joined = dataLines.join("\n").trim();
    if (joined === "[DONE]") return null;
    if (joined === "") return null;
    try {
      return JSON.parse(joined) as T;
    } catch {
      // Malformed JSON — skip, log, keep going. We don't surface
      // this as an error because the orchestrator's well-formed
      // `error` event is the user-visible failure path. A skipped
      // malformed event is invisible by design.

      console.warn(
        "[parseSSE] Skipping malformed event:",
        joined.slice(0, 200),
      );
      return null;
    }
  }

  return {
    feed(chunk: string): T[] {
      buffer += chunk;
      const events: T[] = [];
      // Events are separated by `\n\n`. Walk the buffer and pull
      // out completed events; keep the trailing incomplete bit
      // for the next call.
      let separatorIdx = buffer.indexOf("\n\n");
      while (separatorIdx !== -1) {
        const eventText = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 2);
        const parsed = parseEvent(eventText);
        if (parsed !== null) events.push(parsed);
        separatorIdx = buffer.indexOf("\n\n");
      }
      return events;
    },
    flush(): T[] {
      if (!buffer.trim()) return [];
      const parsed = parseEvent(buffer);
      buffer = "";
      return parsed !== null ? [parsed] : [];
    },
    reset(): void {
      buffer = "";
    },
  };
}
