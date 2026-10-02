/**
 * Request-id generators.
 *
 * Replaces the inlined `chat_${ts}_${rand}` / `sugg_${ts}_${rand}` /
 * `msg_${ts}_${rand}` patterns that drifted across the chat and
 * suggestions routes. Same shape; the prefix is parameterized.
 *
 * Format: `<prefix>_<ts36>_<rand36>` where:
 *   - `ts36` is the current ms timestamp in base 36 (chronologically
 *     sortable, dense)
 *   - `rand36` is 8 random base-36 chars (collision-resistant within
 *     the same millisecond)
 *
 * The two prefixes used today:
 *   - `chat`  — chat brain requests
 *   - `sugg`  — suggestions requests
 *   - `msg`   — user-message correlation id (orthogonal)
 *
 * Adding a new caller? Pass a short distinctive prefix.
 */

function randomBase36(length: number): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

/**
 * Build a request id with the given prefix.
 * Default rand-suffix length is 8; bump it if collision rates ever
 * matter (they don't at our scale).
 */
export function generateRequestId(prefix: string, randLength = 8): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBase36(randLength)}`;
}

/** Chat brain request correlation id. Echoed in `X-Chat-Request-Id`. */
export function generateChatRequestId(): string {
  return generateRequestId("chat");
}

/** Suggestions request correlation id. Echoed in `X-Chat-Request-Id`
 *  on the suggestions response so logs can join across endpoints. */
export function generateSuggestionsRequestId(): string {
  return generateRequestId("sugg");
}

/**
 * User-message correlation id. Slightly shorter rand suffix because
 * collisions matter less here — it just labels the user's bubble in
 * client-side state.
 */
export function generateUserMessageId(): string {
  return generateRequestId("msg", 6);
}
