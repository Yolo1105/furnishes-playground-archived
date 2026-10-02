/**
 * Chat route header re-exports + the `getMaxMessageLength` helper.
 *
 * Eva's version reads `max_message_length` from the brand-specific
 * domain config. Our domain config lands in Turn 2, so for now we
 * inline the same default eva uses (10,000 chars). Once the domain
 * config exists, this function will read from it.
 *
 * The re-exports of CHAT_OUTBOUND_HTTP / CHAT_ROUTE_HEADER are kept
 * so callers can `import {...} from "@/lib/chat-brain/post/chat-route-headers"`
 * without separately importing `chat-http-header-names`. Pure
 * convenience layer matching eva's structure.
 */

export {
  CHAT_OUTBOUND_HTTP,
  CHAT_ROUTE_HEADER,
} from "../core/chat-http-header-names";

const DEFAULT_MAX_MESSAGE_LENGTH = 10000;

/**
 * Maximum length of an inbound user message in chars. Reads from
 * env var `BRAIN_MAX_MESSAGE_LENGTH` if set; otherwise 10000.
 *
 * In Turn 2, this will read from the domain config instead. Both
 * call paths land at the same default, so swapping later is a
 * one-line change with no behaviour shift.
 */
export function getMaxMessageLength(): number {
  const env = Number(process.env.BRAIN_MAX_MESSAGE_LENGTH);
  if (Number.isFinite(env) && env > 0) return env;
  return DEFAULT_MAX_MESSAGE_LENGTH;
}
