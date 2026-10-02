/**
 * Cost tracker — in-memory only.
 *
 * Eva's version writes per-call cost to a Postgres `costs` table via
 * `recordCost()`, then reads aggregates via `getSessionCost()` and
 * `getDailyGlobalCost()`. We acknowledged in Phase 0 (doc 01,
 * question 2) that we're keeping cost tracking in-memory only for the
 * foreseeable future. If you later want persistent cost analytics,
 * add a Supabase `chat_costs` table and rewrite the four functions
 * here to read/write through it; the public surface
 * (checkCostLimit + checkGlobalDailyCostLimit + recordCost) won't
 * need to change.
 *
 * Ported from eva/core/cost-tracker.ts. Behaviour preserved:
 *   - Per-conversation cost limit with 80% warning threshold
 *   - Global daily cap (resets at UTC midnight)
 *   - 0 = "skip the global check entirely" (so dev environments can
 *     opt out of the cap)
 *
 * NOTE on memory: the in-memory maps grow until the process restarts.
 * For a typical dev session that's fine (a session running for hours
 * accumulates tens of conversation entries, not millions). For long-
 * running production processes you'd want either (a) a TTL cleanup
 * job, or (b) the Supabase-backed version.
 */

const DEFAULT_GLOBAL_DAILY_CAP_USD = 100;
const DEFAULT_SESSION_COST_LIMIT_USD = 2.0;

/** Warn when total session LLM cost reaches this fraction of the limit. */
const SESSION_COST_WARNING_RATIO = 0.8;

/** Per-conversation accumulated cost in USD. */
const sessionCosts = new Map<string, number>();

/** Daily global cost: { dayKey: "YYYY-MM-DD UTC", cost: number }. */
let globalDailyState: { dayKey: string; cost: number } = {
  dayKey: utcDayKey(),
  cost: 0,
};

function utcDayKey(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rolloverGlobalIfNeeded(): void {
  const today = utcDayKey();
  if (globalDailyState.dayKey !== today) {
    globalDailyState = { dayKey: today, cost: 0 };
  }
}

/** Get the current session cost for a conversation. */
async function getSessionCost(conversationId: string): Promise<number> {
  return sessionCosts.get(conversationId) ?? 0;
}

/** Get the cumulative global cost for the current UTC day. */
async function getDailyGlobalCost(): Promise<number> {
  rolloverGlobalIfNeeded();
  return globalDailyState.cost;
}

/**
 * Record a cost increment for a conversation. The brain's pipeline
 * calls this after each model invocation with the calculated USD
 * amount. Both the session counter and the global daily counter
 * advance.
 *
 * Always succeeds (in-memory, no I/O failures possible).
 */
export function recordCost(conversationId: string, costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  sessionCosts.set(
    conversationId,
    (sessionCosts.get(conversationId) ?? 0) + costUsd,
  );
  rolloverGlobalIfNeeded();
  globalDailyState.cost += costUsd;
}

/**
 * Public helper for resetting a single session's cost (used when a
 * conversation is deleted, or when the user explicitly resets).
 */
export function resetSessionCost(conversationId: string): void {
  sessionCosts.delete(conversationId);
}

/**
 * Per-conversation cost cap with 80% warning threshold. The brain
 * pipeline calls this before each request and reads `warning` to
 * surface a header (`X-Cost-Warning: approaching-limit`) so the
 * client can show a banner before the limit is hit.
 *
 * `limit` is read from env var `BRAIN_SESSION_COST_LIMIT_USD` if set,
 * otherwise defaults to $2.00 — generous enough for normal conversation,
 * tight enough to prevent runaway loops. Adjust per environment.
 */
export async function checkCostLimit(conversationId: string): Promise<{
  allowed: boolean;
  warning: boolean;
  currentCost: number;
  limit: number;
}> {
  const envLimit = Number(process.env.BRAIN_SESSION_COST_LIMIT_USD);
  const limit = Number.isFinite(envLimit) && envLimit > 0
    ? envLimit
    : DEFAULT_SESSION_COST_LIMIT_USD;
  const currentCost = await getSessionCost(conversationId);
  const warning = currentCost >= limit * SESSION_COST_WARNING_RATIO;
  return { allowed: currentCost < limit, warning, currentCost, limit };
}

/**
 * Caps aggregate spend for the current UTC day across all
 * conversations. When `BRAIN_GLOBAL_DAILY_COST_LIMIT_USD=0`, the
 * check is skipped entirely (allowed: true, limit: 0) — useful for
 * local dev where you don't want a global cap.
 *
 * Default: $100/day across all conversations on this server process.
 */
export async function checkGlobalDailyCostLimit(): Promise<{
  allowed: boolean;
  currentCost: number;
  limit: number;
}> {
  const envLimit = process.env.BRAIN_GLOBAL_DAILY_COST_LIMIT_USD;
  const parsed = envLimit !== undefined ? Number(envLimit) : NaN;
  if (parsed === 0) {
    const currentCost = await getDailyGlobalCost();
    return { allowed: true, currentCost, limit: 0 };
  }
  const limit = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_GLOBAL_DAILY_CAP_USD;
  const currentCost = await getDailyGlobalCost();
  return { allowed: currentCost < limit, currentCost, limit };
}
