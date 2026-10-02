/**
 * friendlyError — translate technical error strings from API routes
 * into user-actionable chat messages.
 *
 * The orchestrator catches every failure (Claude refusal, Flux 503,
 * fal.ai rate limit, network drop) and emits an `error` SSE event
 * carrying the raw message. Showing the raw message in chat is
 * unhelpful — `429 rate_limit_exceeded {...}` is noise. This helper
 * matches against common patterns and returns a one-sentence message
 * the user can act on.
 *
 * Pattern-matching order matters: more specific patterns first, more
 * general patterns last. Every pattern is tested in order and the
 * first match wins. Anything unrecognized falls through to the raw
 * message — better to expose a real error than to mask it with a
 * generic "something went wrong."
 */

const TRANSLATIONS: Array<[RegExp, string]> = [
  // ── Missing API keys (most common cause of "it's not working") ──
  [
    /anthropic.*api.*key|claude.*(not configured|missing)|ANTHROPIC_API_KEY/i,
    "Claude API key missing. Set ANTHROPIC_API_KEY in .env.local and restart the dev server.",
  ],
  [
    /fal.*api.*key|fal.*(not configured|missing)|FAL_API_KEY/i,
    "fal.ai key missing. Set FAL_KEY (or FAL_API_KEY) in .env.local and restart the dev server.",
  ],

  // ── Provider quota / billing ──
  [
    /quota|billing|insufficient.*credit|payment/i,
    "API quota exhausted. Top up credits in your provider dashboard, then try again.",
  ],

  // ── Timeouts + cancellation ──
  [
    /timeout|timed? out|AbortError|aborted/i,
    "Request took too long. The provider may be busy — try again in a moment.",
  ],

  // ── Rate limiting ──
  [
    /rate.?limit|429|too many requests/i,
    "You're generating too quickly. Wait a minute and try again.",
  ],

  // ── Network failures ──
  [
    /ECONNREFUSED|fetch failed|network|getaddrinfo|ENOTFOUND/i,
    "Can't reach the generation backend. Check your internet connection.",
  ],

  // ── Schema / parser errors ──
  [
    /schema validation|zod|invalid.*json|malformed/i,
    "The AI returned an unexpected response shape. Try rephrasing your prompt.",
  ],

  // ── Provider returned no output ──
  [
    /returned no (images|mesh|model|url)/i,
    "Generation completed but produced no output. The prompt may have been blocked — try rephrasing.",
  ],
];

/** Translate a raw error string to a user-facing message. Safe to
 *  call with null/undefined (returns a generic fallback). */
export function friendlyError(raw: string | null | undefined): string {
  if (!raw) return "Something went wrong — please try again.";
  for (const [pattern, message] of TRANSLATIONS) {
    if (pattern.test(raw)) return message;
  }
  // Fall through: surface the raw message. Helps debugging real
  // errors that don't match any pattern (and tells us which patterns
  // we should add when we see them in production).
  return raw;
}
