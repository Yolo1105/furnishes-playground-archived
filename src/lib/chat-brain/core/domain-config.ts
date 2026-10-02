/**
 * Domain configuration for furnishes-studio.
 *
 * Eva loaded this from a `config/domain.json` file at runtime so the
 * brand could be customized per deployment. We don't have a multi-
 * brand product, so the config is hardcoded here. Keep the same
 * shape eva uses so future imports + the prompt-stack assembly
 * code can read fields from a stable interface.
 *
 * This module is the single source of truth for:
 *   - Studio voice (designer, conversational, scene-aware)
 *   - System prompt base text the brain prepends to every turn
 *   - Conversation limits (max history, summarize threshold)
 *   - Rate limits (per-conversation cost, global daily cap — these
 *     are also overridable by env vars in cost-tracker.ts; the env
 *     wins)
 *   - Guardrails (max message length, injection detection toggle)
 *
 * If you want to A/B-test prompt variants, edit `system_prompt`
 * here and ship a new version. There's no runtime overrides system —
 * by design; we want every deployment to behave the same.
 */

export interface DomainConfig {
  name: string;
  /** The base system prompt the brain layers on top of. Voice +
   *  persona + boundaries. Studio context, preferences, and other
   *  layered grounding go ABOVE this in the assembly order. */
  system_prompt: string;
  guardrails: {
    moderation_enabled: boolean;
    injection_detection: boolean;
    max_message_length: number;
  };
  conversation: {
    max_history: number;
    summarize_after: number;
    max_context_tokens: number;
  };
  rate_limits: {
    requests_per_minute: number;
    session_cost_limit_usd: number;
    /** 0 = disabled. */
    global_daily_cost_limit_usd: number;
  };
}

const FURNISHES_STUDIO_CONFIG: DomainConfig = {
  name: "furnishes-studio",
  system_prompt: [
    "You are an interior design assistant inside furnishes-studio — a 3D",
    "studio app where the user is currently looking at a real, editable",
    "scene of their room. You can see what's in the scene, what styles",
    "they've expressed, and what they've already placed. Respond like a",
    "thoughtful designer: warm, specific, grounded in what's actually in",
    "front of them.",
    "",
    "Voice:",
    "- Talk like a studio conversation, not a feature spec or a sales",
    "  pitch. Short sentences win.",
    "- When you suggest changes, anchor them to a real piece, dimension,",
    "  or constraint from the scene — not generic platitudes.",
    "- If you don't know something, say so. The user can see the room",
    "  too; pretending to know what isn't visible breaks trust fast.",
    "",
    "Boundaries:",
    "- You're an interior design assistant ONLY. If the user asks about",
    "  unrelated topics (medical, legal, financial, harmful), redirect",
    "  back to design. You're not a general-purpose assistant.",
    "- Never invent specific products, prices, or SKUs. If the user asks",
    '  "where can I buy X", say you can describe what to look for but',
    "  can't link to specific listings.",
    "- Don't reopen settled choices unless something new conflicts. If",
    "  the user has already picked a style, work within it.",
    "",
    "Mode discipline (CRITICAL):",
    "- The system will tell you what mode the user is in. In Ask mode,",
    "  you answer questions and explain. You do NOT trigger any actions",
    "  on the scene. In Interior Design mode, your suggestions can be",
    "  acted on by the user — but the user always confirms before",
    "  anything moves.",
  ].join("\n"),
  guardrails: {
    moderation_enabled: false, // We don't have OpenAI moderation wired
    injection_detection: true,
    max_message_length: 10000,
  },
  conversation: {
    max_history: 50,
    summarize_after: 20,
    max_context_tokens: 4000,
  },
  rate_limits: {
    requests_per_minute: 30,
    session_cost_limit_usd: 2.0,
    global_daily_cost_limit_usd: 100.0,
  },
};

/**
 * Get the active domain config. Always returns the same object —
 * this is intentionally a no-op for now. If we ever want runtime
 * overrides (test mode, dev mode, brand switching), this is the
 * function to expand.
 */
export function getDomainConfig(): DomainConfig {
  return FURNISHES_STUDIO_CONFIG;
}
