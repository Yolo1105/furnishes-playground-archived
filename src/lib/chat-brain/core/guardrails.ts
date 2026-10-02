/**
 * Input guardrails: validate length, detect prompt injection, and
 * a `buildSafeSystemPrompt` helper that wraps the base prompt with a
 * scope-restriction footer.
 *
 * Ported from eva/core/guardrails.ts. Differences:
 *   - **Dropped:** the OpenAI moderation endpoint call. Eva conditionally
 *     called it when an OpenAI key was present; we use Anthropic, no
 *     moderation API to plug into. The export is kept as a no-op stub
 *     so callers don't break.
 *   - **Adapted:** reads max length from our domain config, not from
 *     `config/domain.json` at runtime.
 *
 * Injection patterns are kept verbatim — they're a battle-tested set.
 */

import { getDomainConfig } from "./domain-config";

function getMaxMessageLength(): number {
  return getDomainConfig().guardrails.max_message_length;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|above)\s+instructions/i,
  /you\s+are\s+now\s+(a\s+)?(DAN|unrestricted|unfiltered|evil|jailbr)/i,
  /new\s+instructions\s*:/i,
  /^\s*system\s*:\s*/im,
  /\[system\]/i,
  /<\|(im_start|system)\|>/i,
  /^\s*human\s*:\s*/im,
  /^\s*assistant\s*:\s*/im,
  /\bjailbreak\b/i,
  /override\s+(your\s+)?(instructions|rules|programming|guidelines)/i,
  /act\s+as\s+if\s+you\s+(are|were)\s+(a\s+)?(different|new|unrestricted|unfiltered)/i,
  /pretend\s+you\s+(are|have)\s+(no|a\s+different|new)\s+(rules|restrictions|guidelines|instructions|persona)/i,
];

export function checkInjection(message: string): {
  safe: boolean;
  reason?: string;
} {
  if (typeof message !== "string") return { safe: true };
  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(message)) {
      return { safe: false, reason: "Possible prompt injection detected" };
    }
  }
  return { safe: true };
}

export function validateInput(content: string): {
  valid: boolean;
  reason?: string;
} {
  if (typeof content !== "string") {
    return { valid: false, reason: "Invalid message" };
  }
  if (content.length > getMaxMessageLength()) {
    return { valid: false, reason: "Message too long" };
  }
  if (content.trim().length === 0) {
    return { valid: false, reason: "Empty message" };
  }
  const guardrails = getDomainConfig().guardrails;
  if (guardrails.injection_detection !== false) {
    const inj = checkInjection(content);
    if (!inj.safe) return { valid: false, reason: inj.reason };
  }
  return { valid: true };
}

/**
 * No-op stub. Eva's version called OpenAI's moderation endpoint when
 * configured. We don't have moderation wired (Anthropic doesn't expose
 * a comparable endpoint, and we don't want to add an extra round-trip
 * to OpenAI just for moderation). Always returns safe.
 *
 * If you later want moderation, plug Anthropic's content filtering API
 * into this function — the rest of the pipeline already calls it at
 * the right point.
 */
export async function checkModeration(
  _message: string,
): Promise<{ safe: boolean; reason?: string }> {
  return { safe: true };
}

/** Wrap the base system prompt with a hard scope-restriction footer.
 *  This is the "you are an interior design assistant ONLY" guardrail
 *  that prevents the model from being talked into off-topic territory. */
export function buildSafeSystemPrompt(base: string): string {
  return `${base}

IMPORTANT: You are an interior design assistant ONLY. If the user asks about topics unrelated to design, home improvement, furniture, or decor, politely redirect them back to design topics. Never provide advice on medical, legal, financial, or harmful topics.`;
}

// Re-export sanitizeOutput for convenience — eva's guardrails module
// did this so callers had one import for the safety surface.
export { sanitizeOutput } from "./output-sanitize";
