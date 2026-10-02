/**
 * Project memory → prompt block.
 *
 * Eva's version emits structured JSON. We use a more readable format
 * that matches our snapshot serializer (designer-style bullets, not
 * raw key:value dumps).
 *
 * The prompt block carries the user's persistent preferences with
 * the right hedge per status:
 *   - confirmed → authoritative ("primary_style: japandi")
 *   - provisional → hedged ("primary_style: japandi (the user
 *     mentioned this; double-check before relying)")
 *   - rejected → excluded entirely (already filtered by selector)
 *
 * Adapted from eva/intelligence/project-memory-prompt.ts. Differences:
 *   - **Replaced JSON output with bullet format.** Models read both
 *     fine, but bullets are easier to inspect when debugging the
 *     prompt and stay consistent with our other prompt layers.
 *   - **Removed snapshot/shortlist/artifacts/highlightedFiles fields.**
 *     None of those exist in our app. The block is preferences-only
 *     (intelligence layer's primary contribution).
 *   - **Source text in the block.** Eva's JSON didn't include the
 *     verbatim source quote. We include a short hint so the model
 *     can reference what the user actually said: "primary_style:
 *     japandi (from: 'I love japandi style')".
 */

import { INTELLIGENCE_LIMITS } from "./intelligence-constants";
import type { Preference } from "@/lib/store/preferences-slice";

export type ProjectMemoryPromptKind = "chat" | "recommendations";

const PROMPT_COPY: Record<
  ProjectMemoryPromptKind,
  { headline: string; instruction: string }
> = {
  chat: {
    headline: "PROJECT MEMORY — what the user has told you in this project",
    instruction:
      "Use these preferences to ground your reply. Reference them naturally (\"since you wanted…\", \"with the walnut you mentioned…\") — don't quote them verbatim or list them as a table. Don't reopen settled choices unless something new conflicts. Only confirmed (accepted) preferences appear here.",
  },
  recommendations: {
    headline:
      "PROJECT MEMORY — rank and explain your recommendations against this",
    instruction:
      "Tie reasons back to confirmed preferences first. Talk through picks like a designer: short contrasts (safer vs bolder, primary pick vs backup) — avoid score matrices, rank tables, or internal IDs in user-facing wording unless they ask for criteria.",
  },
};

function truncateSource(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatOnePreferenceLine(p: Preference): string {
  const sourceHint = p.sourceText
    ? ` (from: "${truncateSource(p.sourceText, 60)}")`
    : "";
  return `  · ${p.key}: ${p.value}${sourceHint}`;
}

/**
 * Format the project's preferences as a system-prompt block. Returns
 * empty string when there are no non-rejected preferences (caller
 * skips the layer entirely in that case).
 */
export function formatProjectMemoryPrompt(
  preferences: readonly Preference[],
  kind: ProjectMemoryPromptKind = "chat",
): string {
  const usable = preferences.filter((p) => p.status === "confirmed");
  if (usable.length === 0) return "";

  const { headline, instruction } = PROMPT_COPY[kind];
  const lines: string[] = [];
  lines.push(`[${headline}]`);
  lines.push(instruction);
  lines.push("");
  lines.push("Preferences on file:");

  // Confirmed only — provisional proposals are not memory until Accept.
  const confirmed = usable.sort((a, b) => b.extractedAt - a.extractedAt);

  const max = INTELLIGENCE_LIMITS.promptPreferencesMax;
  const shown = confirmed.slice(0, max);
  for (const p of shown) {
    lines.push(formatOnePreferenceLine(p));
  }
  if (confirmed.length > max) {
    lines.push(`  · …and ${confirmed.length - max} more (older entries)`);
  }

  return lines.join("\n");
}

export function formatProjectMemoryForSystemPrompt(
  preferences: readonly Preference[],
): string {
  return formatProjectMemoryPrompt(preferences, "chat");
}
