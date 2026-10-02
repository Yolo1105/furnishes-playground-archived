/**
 * Shared user-message triggers + extra system prompt lines for chat
 * (compare / options). Keeps regex and copy in one place — used by
 * the brain's prompt-stack assembly to swap voice based on the user's
 * intent.
 *
 * Two augmentations:
 *   - {@link appendCompareIntentGuidance} — when the user's message
 *     looks like they want to weigh options ("vs", "compare", "which
 *     one"), tell the model to use plain-language contrasts instead
 *     of score matrices.
 *   - {@link appendRecommendationChatVoice} — when project context
 *     exists (any project-aware turn), nudge the model toward studio-
 *     conversation voice rather than spec-block voice.
 *
 * Both are idempotent in spirit — re-applying isn't harmful because
 * the system prompt isn't read by the user. But callers should still
 * apply each at most once per request; the prompt stack assembly
 * does this automatically.
 *
 * Ported as-is from eva/core/chat-conversation-prompt.ts.
 */

/** User message looks like they want to weigh options or narrow choices. */
export const USER_MESSAGE_COMPARE_INTENT_PATTERN =
  /\b(compare|vs\.?|versus|shortlist|trade-?off|pick between|narrow down|which (one|option))\b/i;

const COMPARE_GUIDANCE_SUFFIX =
  "[CONVERSATION] When weighing options, use brief plain-language contrasts (e.g. safer vs bolder, budget-first vs statement piece). Skip score-style or matrix language unless the user asks for criteria.";

/**
 * Appends compare-style guidance when the trigger matches.
 * Idempotent if caller already merged similar hints.
 */
export function appendCompareIntentGuidance(
  basePrompt: string,
  userMessage: string,
): string {
  if (!USER_MESSAGE_COMPARE_INTENT_PATTERN.test(userMessage)) return basePrompt;
  return `${basePrompt}\n\n${COMPARE_GUIDANCE_SUFFIX}`;
}

const RECOMMENDATION_CHAT_VOICE_SUFFIX =
  "[VOICE — OPTIONS IN CHAT] When you suggest directions, products, or layouts here, talk it through like a studio conversation: the tradeoff they're choosing (e.g. cozier vs airier, budget vs statement), why it fits what they care about, and at most one contrasting option if it genuinely helps. Skip numbered spec blocks, scores, or field labels unless they ask for criteria.";

/** Richer conversational framing when project context exists (any stage). */
export function appendRecommendationChatVoice(basePrompt: string): string {
  return `${basePrompt.trim()}\n\n${RECOMMENDATION_CHAT_VOICE_SUFFIX}`;
}
