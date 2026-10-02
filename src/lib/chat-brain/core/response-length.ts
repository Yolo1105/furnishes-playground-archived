/**
 * Adaptive response length hints for system prompt augmentation.
 *
 * The brain calls `getResponseLengthInstruction(userMessage)` once
 * per request and appends the returned instruction to the system
 * prompt. The instruction adapts to the kind of message the user
 * sent — a "hi" gets a 1-2 sentence response, a "compare these"
 * gets brief option contrasts, an open question gets a direct
 * answer, etc.
 *
 * Why this matters: without an explicit length hint, models tend to
 * produce 200-word essays for every prompt. With this hint, the
 * model matches the conversational register of the user's message.
 *
 * Ported as-is from eva/core/response-length.ts. The patterns are
 * domain-agnostic — they work just as well for furniture as for
 * eva's original use case.
 */

const GREETING_PATTERNS =
  /^(hi|hello|hey|howdy|good morning|good afternoon|good evening|hi there|hey there)[\s!.,?]*$/i;
const BREVITY_PATTERNS =
  /\b(just|quick|quickly|brief|short|tl;dr|in short|summarize|summary)\b/i;
const RECOMMENDATION_PATTERNS =
  /\b(recommend|suggestion|suggest|what (should i|can i)|which|options?|ideas?|plan|detail|detailed|explain|tell me more|how do i)\b/i;
const YES_NO_PATTERNS = /\b(yes|no|yeah|nope|sure|ok|okay|maybe)\s*[.?!]*$/i;

/**
 * Returns an instruction string to append to the system prompt.
 * Caller wraps this in a "[LENGTH]" tag or similar marker so the
 * model treats it as authoritative.
 */
export function getResponseLengthInstruction(message: string): string {
  const trimmed = message.trim();
  if (GREETING_PATTERNS.test(trimmed)) {
    return "Respond in 1-2 short sentences.";
  }
  if (BREVITY_PATTERNS.test(trimmed)) {
    return "Respond in 1-2 short sentences.";
  }
  if (YES_NO_PATTERNS.test(trimmed) && trimmed.length < 30) {
    return "Respond in 1-2 short sentences.";
  }
  if (RECOMMENDATION_PATTERNS.test(trimmed)) {
    return "Give enough to compare options clearly, but stay conversational—short contrasts and plain language, not a formal report, unless they ask for depth.";
  }
  if (/\?$/.test(trimmed)) {
    return "Answer the question directly first; use at most one follow-up question if you need missing context.";
  }
  return "Prefer 1–2 short paragraphs; add bullets only when comparing options or when they ask for a list.";
}
