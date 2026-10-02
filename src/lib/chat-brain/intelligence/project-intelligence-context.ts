/**
 * Project intelligence context.
 *
 * Heavily adapted from eva/intelligence/project-intelligence-context.ts.
 * Eva's version reads everything from Prisma: shortlist items, decision
 * context, recommendations snapshot, project artifacts, workflow stage.
 * **None of those concepts exist in furnishes-studio.** Our intelligence
 * context is leaner: preferences from the slice, scene state from the
 * scene-source slice, recent turn excerpts from the active conversation.
 *
 * Phase 0 doc 01 logged this as ADAPT (drop workflow). The output type
 * collapses from eva's 20+ fields to 6 we actually use.
 *
 * # What's in the context
 *
 *   - `preferences`: extracted user preferences (Preference[])
 *   - `recentTurnExcerpt`: a compact "User: X / Assistant: Y" summary
 *     of the last few turns (Risk: long context windows can crowd out
 *     grounding, so we cap aggressively)
 *   - `projectId` / `projectTitle`: routing metadata
 *   - `sceneSummary`: one-line text of the scene state (caller can
 *     pass the studio snapshot block too if they need richer detail)
 *
 * Pure function. Caller passes the slice fields directly — no I/O.
 * The pipeline assembles this once per request from the in-memory
 * store; no DB read needed.
 */

import { INTELLIGENCE_LIMITS } from "./intelligence-constants";
import type { Preference } from "@/lib/store/preferences-slice";
import type { ConversationTurn } from "@/lib/store/types";

export interface ProjectIntelligenceContext {
  projectId: string;
  projectTitle: string | null;
  /** Preferences for this project, status-filtered by the caller
   *  (we expect rejected preferences NOT to be in this array). */
  preferences: Preference[];
  /** Compact recent-turn excerpt, capped to
   *  `recentChatExcerptMaxChars`. null when conversation is empty. */
  recentTurnExcerpt: string | null;
  /** One-liner about the scene. null when no scene context exists. */
  sceneSummary: string | null;
  builtAt: string;
}

export interface BuildProjectIntelligenceContextInput {
  projectId: string;
  projectTitle?: string | null;
  preferences: readonly Preference[];
  /** Recent turns from the active conversation. Caller passes the
   *  full turn array; we trim. Most-recent last (chronological order). */
  recentTurns: readonly ConversationTurn[];
  /** Optional one-liner about the scene. Caller can pass something
   *  like "5x4m room, 8 pieces placed, Mid-century modern style". */
  sceneSummary?: string | null;
}

/**
 * Build a compact recent-turn excerpt, capped to `recentChatExcerptMaxChars`
 * total. Format:
 *
 *     User: [first 400 chars of turn 1's userText]…
 *     Assistant: [first 400 chars of turn 1's response]…
 *     User: [...]
 *
 * Most-recent turn last (matches eva's chronological-after-reverse
 * pattern). If the conversation has fewer than `recentChatMessagesTake`
 * turns, returns whatever's there.
 */
function buildRecentTurnExcerpt(
  turns: readonly ConversationTurn[],
): string | null {
  if (turns.length === 0) return null;

  const take = INTELLIGENCE_LIMITS.recentChatMessagesTake;
  // Take last N turns; if fewer than N exist, use all of them.
  const lastN = turns.slice(-take);

  const preview = INTELLIGENCE_LIMITS.recentChatMessagePreviewChars;
  const maxTotal = INTELLIGENCE_LIMITS.recentChatExcerptMaxChars;

  const parts: string[] = [];
  for (const t of lastN) {
    if (t.userText && t.userText.trim()) {
      const text = t.userText.trim();
      const truncated =
        text.length > preview ? `${text.slice(0, preview)}…` : text;
      parts.push(`User: ${truncated}`);
    }
    if (t.response && t.response.trim()) {
      const text = t.response.trim();
      const truncated =
        text.length > preview ? `${text.slice(0, preview)}…` : text;
      parts.push(`Assistant: ${truncated}`);
    }
  }

  if (parts.length === 0) return null;
  const joined = parts.join("\n");
  return joined.length > maxTotal ? `${joined.slice(0, maxTotal)}…` : joined;
}

/** Build the intelligence context. Pure, no I/O. */
export function buildProjectIntelligenceContext(
  input: BuildProjectIntelligenceContextInput,
): ProjectIntelligenceContext {
  return {
    projectId: input.projectId,
    projectTitle: input.projectTitle ?? null,
    preferences: [...input.preferences],
    recentTurnExcerpt: buildRecentTurnExcerpt(input.recentTurns),
    sceneSummary: input.sceneSummary ?? null,
    builtAt: new Date().toISOString(),
  };
}

/**
 * Format the intelligence context as a system-prompt block. Reuses the
 * project-memory-prompt formatter for the preferences section, then
 * appends the recent-turn excerpt and scene summary if present.
 *
 * This is the function the prompt stack assembly calls (Turn 2d).
 */
export function formatIntelligenceContextForPrompt(
  ctx: ProjectIntelligenceContext,
  formatPreferences: (prefs: readonly Preference[]) => string,
): string {
  const blocks: string[] = [];

  // Preferences via the existing formatter
  const prefBlock = formatPreferences(ctx.preferences);
  if (prefBlock) blocks.push(prefBlock);

  // Scene summary
  if (ctx.sceneSummary) {
    blocks.push(`[SCENE SUMMARY]\n${ctx.sceneSummary}`);
  }

  // Recent turn excerpt
  if (ctx.recentTurnExcerpt) {
    blocks.push(
      `[RECENT CONVERSATION — last few turns]\n${ctx.recentTurnExcerpt}`,
    );
  }

  return blocks.join("\n\n");
}
