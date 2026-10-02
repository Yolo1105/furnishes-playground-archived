/**
 * Daily cap for suggestions generation.
 *
 * # What this protects against
 *
 * The suggestions endpoint streams a full Anthropic call per click.
 * Each call costs roughly the same as a chat turn but generates more
 * output (3-5 cards, ~400-800 tokens each). Without a cap, a stuck
 * UI bug or a curious user could rack up real spend in minutes.
 *
 * # Design choices
 *
 * - **In-memory, per-server.** No Redis, no database. The Map lives
 *   in module scope; survives across requests within the same Node
 *   process but resets on process restart. That's fine for a single-
 *   user dev deployment; if we ever go multi-user with multiple
 *   serverless workers, this needs to be redone with a real backend.
 *
 * - **UTC-midnight reset.** The cap is "X per UTC day". Reset is
 *   automatic on the first request after UTC midnight. We don't run
 *   a cron — the next call notices the date changed and reinitializes
 *   the counter.
 *
 * - **Soft fail at the cap.** When the cap is hit, the endpoint
 *   returns a friendly message ("you've used today's suggestions
 *   budget") rather than a 429. The UI shows the message to the
 *   user. This is gentler UX and makes debugging easier.
 *
 * - **Per-key counting.** The keying strategy is left to the caller
 *   (pass any stable string). For our deployment we use a fixed
 *   "global" key — the cap is per-server, not per-user. When user
 *   accounts land, the caller passes the user id instead.
 *
 * # Configuration
 *
 * `BRAIN_SUGGESTIONS_DAILY_CAP` env var. Default 50. Reads on every
 * call (so changes take effect without restart, useful for testing).
 *
 * Setting `BRAIN_SUGGESTIONS_DAILY_CAP=0` disables the cap entirely
 * (always allowed). Useful for local dev.
 */

const GLOBAL_KEY = "global";
const DEFAULT_CAP = 50;

type CounterEntry = {
  /** UTC date string (YYYY-MM-DD) the counter is for. When we see a
   *  newer date on a request, we reset the count to 0. */
  date: string;
  count: number;
};

/** In-memory counter map. Module-scope so it persists across
 *  requests in a single Node process. Cleared on process restart
 *  (which is fine for our scale). */
const counters: Map<string, CounterEntry> = new Map();

function getUtcDateString(now: Date = new Date()): string {
  // YYYY-MM-DD in UTC. ISO date format.
  return now.toISOString().slice(0, 10);
}

function getCap(): number {
  const raw = process.env.BRAIN_SUGGESTIONS_DAILY_CAP;
  if (raw === undefined) return DEFAULT_CAP;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CAP;
  return parsed;
}

/**
 * Try to consume one slot from today's budget for the given key.
 *
 * Returns:
 *   - `allowed: true, remaining: N` — slot consumed; N more remaining today.
 *   - `allowed: false, remaining: 0` — at cap; no slot consumed.
 *
 * When the cap is 0, always returns allowed=true with remaining=Infinity.
 */
export function tryConsumeSuggestionSlot(
  key: string = GLOBAL_KEY,
  now: Date = new Date(),
): { allowed: boolean; remaining: number; cap: number } {
  const cap = getCap();
  if (cap === 0) {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, cap: 0 };
  }

  const today = getUtcDateString(now);
  const entry = counters.get(key);

  if (!entry || entry.date !== today) {
    // First request today (or first ever) for this key. Reset.
    counters.set(key, { date: today, count: 1 });
    return { allowed: true, remaining: cap - 1, cap };
  }

  if (entry.count >= cap) {
    return { allowed: false, remaining: 0, cap };
  }

  entry.count += 1;
  return { allowed: true, remaining: cap - entry.count, cap };
}

/**
 * Inspect the current count for a key without consuming a slot.
 * Used by the UI to show "X / 50 today" without burning quota.
 */
export function getSuggestionRemaining(
  key: string = GLOBAL_KEY,
  now: Date = new Date(),
): { remaining: number; cap: number } {
  const cap = getCap();
  if (cap === 0) {
    return { remaining: Number.POSITIVE_INFINITY, cap: 0 };
  }
  const today = getUtcDateString(now);
  const entry = counters.get(key);
  if (!entry || entry.date !== today) {
    return { remaining: cap, cap };
  }
  return { remaining: Math.max(0, cap - entry.count), cap };
}

/**
 * Test-only: clear all counters. Used by sanity scripts to start
 * from a clean state. Not exported through any public surface.
 */
export function __resetCountersForTest(): void {
  counters.clear();
}
