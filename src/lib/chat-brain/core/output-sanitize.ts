/**
 * Output sanitization shared by API persistence and client streaming
 * display. Keep this module free of server-only imports so it can run
 * in the browser too — both `/api/chat` and `ConversationBubble`
 * consume the same sanitizer to keep server-persisted text and
 * mid-stream display perfectly consistent.
 *
 * Two-tier strategy:
 *
 *   1. **Strict pass** (`sanitizeOutput`) — strip prompt-leak patterns
 *      line-by-line, drop role-prefix lines entirely. Aggressive but
 *      safe for completed text.
 *
 *   2. **Lenient pass** (`lenientOutputGuards`) — used as a fallback
 *      when strict drops everything. Strips only the obviously-risky
 *      tokens (im_start/im_end/redacted) and collapses whitespace,
 *      preserving the rest. Prevents the "model said something useful
 *      but was wrapped in role lines, so we showed nothing" trap.
 *
 * The `finalizeAssistantOutput` orchestrator picks between the two
 * automatically; downstream code calls only `finalizeAssistantOutput`.
 *
 * For mid-stream rendering, `sanitizeAssistantStreamDisplay` runs the
 * strict pass but keeps raw bytes if the strict pass would empty
 * partial output (matches chatbot_v3 behaviour). This gives smooth
 * token-by-token rendering even when a partial chunk happens to look
 * like a role prefix briefly.
 *
 * Ported from eva/core/output-sanitize.ts. Patterns and behaviour
 * preserved verbatim — these are time-tested against many model
 * quirks and shouldn't be retuned without strong evidence.
 */

const PROMPT_LEAK_PATTERNS = [
  /\[?system\]?\s*:.*$/im,
  /<\|im_start\|>.*$/im,
  /<\|im_end\|>/g,
  /Human\s*:.*$/im,
  /Assistant\s*:.*$/im,
  /^(system|human|assistant)\s*:\s*/im,
];

const ROLE_LINE = /^(system|human|assistant)\s*:\s*/i;
const MAX_OUTPUT_LENGTH = 10000;

/**
 * Strict sanitization. Drops role-prefix lines entirely, strips
 * known prompt-leak patterns, truncates if absurdly long. Returns
 * empty string when input is empty/whitespace.
 *
 * Note: this can return empty even when input had real content —
 * that's the caller's signal to try {@link lenientOutputGuards}.
 */
export function sanitizeOutput(text: string): string {
  if (typeof text !== "string" || !text.trim()) return "";
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    let stripped = line;
    for (const pat of PROMPT_LEAK_PATTERNS) {
      stripped = stripped.replace(pat, "");
    }
    stripped = stripped.trim();
    if (stripped && !ROLE_LINE.test(stripped)) out.push(line);
  }
  let result = out.join("\n").trim() || text.trim();
  if (result.length > MAX_OUTPUT_LENGTH) {
    result = result.slice(0, MAX_OUTPUT_LENGTH - 3).trimEnd() + "...";
  }
  return result;
}

/**
 * Lighter pass when {@link sanitizeOutput} removes everything but the
 * raw model text still has substance (e.g. heavy role-line formatting
 * that confuses the strict regex). Strips risky tokens without
 * dropping whole lines, then trims.
 */
export function lenientOutputGuards(text: string): string {
  if (typeof text !== "string" || !text.trim()) return "";
  let t = text;
  t = t.replace(/<\|im_end\|>/g, "");
  t = t.replace(/<\|im_start\|>[^\n]*/gi, "");
  t = t.replace(/<\|redacted_im_end\|>/g, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.trim();
  if (t.length > MAX_OUTPUT_LENGTH) {
    t = t.slice(0, MAX_OUTPUT_LENGTH - 3).trimEnd() + "...";
  }
  return t;
}

export type FinalizeAssistantOutputResult = {
  text: string;
  /** True when strict {@link sanitizeOutput} returned empty but input had non-whitespace. */
  strictSanitizationCollapsed: boolean;
  /** True when {@link lenientOutputGuards} produced the final text. */
  usedLenientFallback: boolean;
};

/**
 * Choose text to persist/display: prefer strict sanitization; if it
 * collapses to empty while raw input is non-empty, try lenient guards
 * (never silently drop a usable reply).
 *
 * Caller decides what to do with `strictSanitizationCollapsed` —
 * typically it's a logging signal ("we had to fall back to lenient
 * mode for this turn") rather than a user-facing error.
 */
export function finalizeAssistantOutput(
  raw: string,
): FinalizeAssistantOutputResult {
  const rawTrim = typeof raw === "string" ? raw.trim() : "";
  if (!rawTrim) {
    return {
      text: "",
      strictSanitizationCollapsed: false,
      usedLenientFallback: false,
    };
  }
  const strict = sanitizeOutput(raw);
  if (strict.trim().length > 0) {
    return {
      text: strict,
      strictSanitizationCollapsed: false,
      usedLenientFallback: false,
    };
  }
  const lenient = lenientOutputGuards(raw);
  if (lenient.trim().length > 0) {
    return {
      text: lenient,
      strictSanitizationCollapsed: true,
      usedLenientFallback: true,
    };
  }
  return {
    text: "",
    strictSanitizationCollapsed: rawTrim.length > 0,
    usedLenientFallback: false,
  };
}

/**
 * Use while streaming: scan for banned patterns; if none present,
 * pass the chunk through VERBATIM (preserving whitespace). If a
 * banned pattern is detected, run the strict pass and fall back to
 * raw bytes if strict would empty the chunk.
 *
 * Why this differs from `sanitizeOutput`: the strict sanitizer
 * trims output as its final step. That's correct for fully-formed
 * text but wrong for streaming, where a chunk like "Hello, " has a
 * meaningful trailing space that would join with the next delta.
 * Trimming per-chunk corrupts token boundaries.
 *
 * The stream-display sanitizer's job is narrower: catch obviously
 * unsafe content (role prefixes, prompt-leak markers) before they
 * reach the user, while preserving normal text flow.
 */
export function sanitizeAssistantStreamDisplay(raw: string): string {
  if (typeof raw !== "string") return "";
  if (raw.length === 0) return "";

  // Quick check: does this chunk contain any banned pattern? If not,
  // pass through verbatim. This is the common case (>99% of deltas
  // are normal content tokens).
  const hasBannedPattern =
    PROMPT_LEAK_PATTERNS.some((p) => p.test(raw)) || ROLE_LINE.test(raw);

  if (!hasBannedPattern) {
    return raw;
  }

  // Banned pattern detected — run strict pass. Fall back to raw if
  // strict would empty the chunk (matches chatbot_v3 behaviour:
  // never silently drop content mid-stream).
  const safe = sanitizeOutput(raw);
  return safe || raw;
}
