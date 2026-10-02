/**
 * Conversation context builder.
 *
 * Heavily adapted from eva/core/context-builder.ts. Eva's version
 * calls OpenAI's `generateText` to summarize older history when the
 * conversation gets long. We DON'T do that for Turn 2:
 *   1. We use Anthropic; eva's OpenAI summarizer wouldn't drop in
 *      cleanly anyway.
 *   2. Adding an extra Claude call per request just for summarization
 *      doubles latency for long conversations and isn't worth it
 *      until we have data showing it's needed.
 *   3. The 6000-token context budget (domain-config.ts) is generous
 *      enough that simple last-N trimming serves typical sessions.
 *
 * Turn 3's full pipeline can revisit this — there's a Phase 0 doc 04
 * note about adding an Anthropic-based summarizer behind a flag.
 *
 * What this module does, in plain terms:
 *
 *   - Estimate total tokens in the conversation history (4 chars ≈
 *     1 token, eva's heuristic; close enough for trim decisions).
 *   - If we're under the budget AND under the message-count threshold,
 *     pass the messages through unchanged.
 *   - If we're OVER, walk backward from the most recent message and
 *     keep messages until we hit the budget. Older messages are dropped.
 *   - Always return at least the user's most recent turn — never strip
 *     all messages.
 *
 * Returns:
 *   - `systemSuffix`: a small JSON-ish string appended to the system
 *     prompt with current preferences (when present). Eva's pattern.
 *   - `messages`: the trimmed array, ready for the model API call.
 */

const CHARS_PER_TOKEN = 4;

export interface MessageForContext {
  role: string;
  content: string;
}

export interface BuildContextResult {
  systemSuffix: string;
  messages: MessageForContext[];
}

function estimateTokens(text: string): number {
  return Math.max(0, Math.floor(text.length / CHARS_PER_TOKEN));
}

/**
 * Build the trimmed message list + a preferences suffix string for
 * the system prompt.
 *
 * @param messages chronological order, oldest first.
 * @param preferences flat key/value pairs to append to the system prompt
 *                    suffix. Optional — empty record produces empty suffix.
 * @param options.maxContextTokens cap on total context tokens. Default 4000.
 * @param options.summarizeAfter ignored in this build (no summarizer);
 *                               retained for shape compatibility with eva.
 */
export function buildContext(
  messages: MessageForContext[],
  preferences: Record<string, string>,
  options: {
    maxContextTokens?: number;
    summarizeAfter?: number;
  } = {},
): BuildContextResult {
  const maxContextTokens = options.maxContextTokens ?? 4000;
  const approxChars = maxContextTokens * CHARS_PER_TOKEN;

  const systemSuffix =
    Object.keys(preferences).length > 0
      ? `\n\nCurrent preferences (use for context): ${JSON.stringify(preferences)}`
      : "";

  // Total tokens; bail-out fast if we're under budget.
  let totalTokens = 0;
  for (const m of messages) {
    totalTokens += estimateTokens(m.content || "") + 5;
  }

  if (totalTokens <= maxContextTokens) {
    return {
      systemSuffix,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content || "",
      })),
    };
  }

  // Over budget: walk backward, keep newest until we'd exceed.
  // Always preserve the very last message even if it alone is over —
  // truncating that would mean dropping the user's current turn.
  const out: MessageForContext[] = [];
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const cost = (m.content?.length ?? 0) + 20;
    if (count + cost > approxChars && out.length > 0) break;
    out.unshift({ role: m.role, content: m.content || "" });
    count += cost;
  }

  return { systemSuffix, messages: out };
}
