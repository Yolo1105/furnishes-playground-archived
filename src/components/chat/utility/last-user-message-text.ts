import type { ConversationTurn } from "@studio/store/types";

/**
 * Most recent user message text, scanning a ConversationTurn[]
 * backward.
 *
 * Adapted from eva-dashboard/chat/last-user-message-text.ts. Eva's
 * version walks a flat ChatMessage[] of `{role, content}` objects.
 * Ours walks our richer ConversationTurn[] shape (one entry per
 * full user→assistant exchange) and pulls the `userText` from the
 * latest entry.
 *
 * Returns `""` for empty arrays. The brain's lightweight follow-up
 * routing (Turn 2's intelligence layer) calls this to decide whether
 * a follow-up question references the prior user turn.
 */
export function getLatestUserText(turns: ConversationTurn[]): string {
  if (!Array.isArray(turns) || turns.length === 0) return "";
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t && typeof t.userText === "string" && t.userText.length > 0) {
      return t.userText;
    }
  }
  return "";
}
