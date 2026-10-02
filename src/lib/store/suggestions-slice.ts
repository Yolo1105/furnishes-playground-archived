import type { StateCreator } from "zustand";
import { consumeChatBrainStream } from "@studio/chat/wire-stream-consumer";

/**
 * Suggestions slice — in-memory state for the proactive design
 * suggestions feature.
 *
 * # What lives here
 *
 * - **suggestions**: the current list of parsed `Suggestion` cards.
 *   Empty when nothing has been generated this session.
 *
 * - **streamingText**: the raw, cumulative text being streamed from
 *   the brain right now. Used for two things: (1) parsing into
 *   `suggestions` as new `### Suggestion N` boundaries appear, and
 *   (2) rendering the in-progress card with its body still arriving.
 *
 * - **isGenerating**: true while a generation request is in flight.
 *   The Generate button shows a spinner; new requests are ignored.
 *
 * - **error**: a user-facing error string. Set by the API call when
 *   the brain is disabled, the cap is hit, or something else goes
 *   wrong. Cleared when a new request starts.
 *
 * - **remainingToday**: the daily-cap counter from the server, if
 *   known. Null when we haven't asked yet (initial state) or when
 *   the brain is disabled (no cap). The UI shows "X / cap today".
 *
 * - **capPerDay**: the cap value the server is using. Same null
 *   semantics as remainingToday.
 *
 * - **lastGeneratedAt**: timestamp (ms) of the most recent successful
 *   generation. Used to show "Last generated 3 minutes ago" in the UI.
 *
 * - **brainEnabled**: whether the server has the brain pipeline on.
 *   Determined by the GET /api/suggestions response. Null until first
 *   probed.
 *
 * # What does NOT live here
 *
 * - Server-side state. The daily-cap counter on the server is
 *   independent; we read it from response headers / GET endpoint.
 * - Persistence. Refreshing the page wipes everything. Re-generating
 *   is one click. Persistence would require a schema bump.
 * - Modal open/close state. That lives in ui-flags-slice next to the
 *   other modal toggles.
 */

export type Suggestion = {
  /** 1-based index of the suggestion in the current generation. */
  number: number;
  /** Short heading text from `### Suggestion N: Title`. */
  title: string;
  /** Body paragraph(s) following the heading. May be partial when the
   *  card is still streaming in. */
  body: string;
  /** When true, this card is the in-progress one (last in the list,
   *  body still being streamed). UI may render a streaming cursor. */
  inProgress: boolean;
};

export interface SuggestionsSlice {
  suggestions: Suggestion[];
  streamingText: string;
  isGenerating: boolean;
  error: string | null;
  remainingToday: number | null;
  capPerDay: number | null;
  lastGeneratedAt: number | null;
  brainEnabled: boolean | null;

  /** Probe GET /api/suggestions to populate remainingToday + capPerDay
   *  + brainEnabled. Doesn't consume a slot. Idempotent — safe to call
   *  on every modal open. */
  probeSuggestionsState: () => Promise<void>;

  /** Start a generation. POSTs to /api/suggestions with the current
   *  brain payload (snapshot + preferences + recent turns), parses the
   *  SSE stream incrementally, and updates `suggestions` as cards
   *  appear. */
  generateSuggestions: () => Promise<void>;

  /** Clear current suggestions list + error. Used by the regenerate
   *  flow before kicking off a new generation. */
  clearSuggestions: () => void;
}

/**
 * Parse the cumulative streaming text into a list of Suggestion
 * cards. The convention from the system prompt is:
 *
 *     ### Suggestion N: Title
 *     Body line 1
 *     Body line 2
 *
 *     ### Suggestion N+1: Title
 *     ...
 *
 * The parser splits on the `### Suggestion ` token (with leading
 * whitespace tolerated) and extracts the number, title, and body for
 * each block. The last card is marked `inProgress` when the text
 * doesn't end on a clean boundary — useful for the streaming UI.
 *
 * Robustness: if the model deviates (extra text before the first
 * heading, headings without colons, etc.), the parser does its best
 * and skips malformed entries rather than crashing.
 */
export function parseStreamingSuggestions(
  text: string,
  isStreamComplete = false,
): Suggestion[] {
  if (!text) return [];
  // Split on the heading boundary. The boundary INCLUDES the "###" so
  // we need to put it back when reconstructing each block.
  const parts = text.split(/^###\s+Suggestion\s+/im);
  // parts[0] is whatever came before the first heading (preamble or
  // empty). Skip it. The rest each begin with "N: Title\nBody...".
  const blocks = parts.slice(1);
  if (blocks.length === 0) return [];
  return blocks.map((block, idx) => {
    const lines = block.split("\n");
    const headingLine = lines[0] ?? "";
    // Match "N: Title" or just "N - Title" tolerantly.
    const headingMatch = headingLine.match(/^(\d+)\s*[:.\-—]\s*(.+)$/);
    const number = headingMatch
      ? Number.parseInt(headingMatch[1], 10)
      : idx + 1;
    const title = headingMatch
      ? headingMatch[2].trim()
      : headingLine.trim() || `Suggestion ${idx + 1}`;
    const body = lines.slice(1).join("\n").trim();
    // The last block is in-progress unless the stream has completed
    // (signaled by isStreamComplete).
    const inProgress = !isStreamComplete && idx === blocks.length - 1;
    return { number, title, body, inProgress };
  });
}

export const createSuggestionsSlice: StateCreator<SuggestionsSlice> = (
  set,
  get,
) => ({
  suggestions: [],
  streamingText: "",
  isGenerating: false,
  error: null,
  remainingToday: null,
  capPerDay: null,
  lastGeneratedAt: null,
  brainEnabled: null,

  probeSuggestionsState: async () => {
    try {
      const res = await fetch("/api/suggestions", { method: "GET" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        remainingToday: number | null;
        capPerDay: number | null;
        brainEnabled: boolean;
      };
      set({
        remainingToday: data.remainingToday,
        capPerDay: data.capPerDay,
        brainEnabled: data.brainEnabled,
      });
    } catch {
      // Network / parse failure — leave state alone. The UI will fall
      // back to "unknown" for the counter, which is fine.
    }
  },

  clearSuggestions: () => {
    set({
      suggestions: [],
      streamingText: "",
      error: null,
    });
  },

  generateSuggestions: async () => {
    const state = get() as unknown as {
      isGenerating: boolean;
      suggestions: Suggestion[];
      // Cross-slice access for the brain payload. This is the same
      // pattern chat-slice uses to read snapshot/preferences/turns.
      [k: string]: unknown;
    };
    if (state.isGenerating) return;

    set({
      isGenerating: true,
      error: null,
      suggestions: [],
      streamingText: "",
    });

    // Build the brain payload using the same helper as chat. Imported
    // dynamically to avoid a circular dependency (chat-slice imports
    // from this slice in the assembled store, and the helper imports
    // from chat-slice's source).
    const { buildSuggestionsRequestPayload } =
      await import("./suggestions-payload");
    const payload = buildSuggestionsRequestPayload(get());

    let res: Response;
    try {
      res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      set({
        isGenerating: false,
        error: `Couldn't reach the server: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      });
      return;
    }

    // Read the cap headers when present — these update the counter
    // even when the body is the soft-fail JSON.
    const remHeader = res.headers.get("X-Suggestions-Remaining-Today");
    const capHeader = res.headers.get("X-Suggestions-Cap-Per-Day");
    if (remHeader !== null) {
      set({ remainingToday: Number.parseInt(remHeader, 10) });
    }
    if (capHeader !== null) {
      set({ capPerDay: Number.parseInt(capHeader, 10) });
    }

    const ct = res.headers.get("Content-Type") ?? "";
    if (!res.ok || !ct.includes("text/event-stream")) {
      // Server returned JSON — error path or cap-exceeded soft fail.
      let bodyText = "";
      try {
        const j = await res.json();
        bodyText =
          typeof j?.error === "string"
            ? j.error
            : `Suggestions request failed: ${res.status}`;
        if (typeof j?.remainingToday === "number") {
          set({ remainingToday: j.remainingToday });
        }
        if (typeof j?.capPerDay === "number") {
          set({ capPerDay: j.capPerDay });
        }
      } catch {
        bodyText = `Suggestions request failed: ${res.status}`;
      }
      set({ isGenerating: false, error: bodyText });
      return;
    }

    // Stream consumer — uses the shared helper from
    // chat-brain/generation/wire-stream-consumer.ts (same parser as
    // chat-slice). Suggestions add their own per-event business logic
    // (parse cards, update store) but the SSE plumbing is shared.
    if (!res.body) {
      set({ isGenerating: false, error: "Empty stream from server." });
      return;
    }

    let accumulated = "";
    let done = false;

    try {
      await consumeChatBrainStream(res.body, (ev) => {
        if (ev.type === "delta" && typeof ev.text === "string") {
          accumulated += ev.text;
          const parsed = parseStreamingSuggestions(accumulated, false);
          set({
            streamingText: accumulated,
            suggestions: parsed,
          });
        } else if (ev.type === "done") {
          done = true;
          const parsed = parseStreamingSuggestions(accumulated, true);
          set({
            streamingText: accumulated,
            suggestions: parsed,
            isGenerating: false,
            lastGeneratedAt: Date.now(),
          });
        } else if (ev.type === "error") {
          done = true;
          set({
            isGenerating: false,
            error:
              ev.displayMessage ??
              "I couldn't finish that suggestion list. Try regenerating.",
            // Keep any partial cards we already produced.
          });
        }
      });
      if (!done) {
        // Stream closed without an explicit done event. Treat as
        // completed with whatever we have.
        const parsed = parseStreamingSuggestions(accumulated, true);
        set({
          streamingText: accumulated,
          suggestions: parsed,
          isGenerating: false,
          lastGeneratedAt: Date.now(),
        });
      }
    } catch (err) {
      set({
        isGenerating: false,
        error: `Stream interrupted: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      });
    }
  },
});
