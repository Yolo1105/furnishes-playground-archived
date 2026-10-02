import type { AssistantDefinition } from "./catalog";

/**
 * Structured overlay appended after domain base prompt — persona-specific
 * lens without replacing Studio safety rules.
 */
export function buildAssistantPromptOverlay(def: AssistantDefinition): string {
  const rules = def.priorityRules.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const useCases = def.idealUseCases.map((u) => `• ${u}`).join("\n");

  return `
[ASSISTANT: ${def.name}]
${def.description}

Primary objective: ${def.primaryGoal}

Reply tone & structure: ${def.replyStyle}

Conversational rhythm: Sound like a live design partner, not a report generator. Avoid stock openers ("Absolutely", "Great choice", "That makes sense", "Based on your preferences") unless they fit naturally. Vary how you begin. For direct questions, answer first in a few tight sentences; add structure only when it helps. Prefer one focused follow-up question over a list of questions. When project memory is present, weave it in with short natural bridges—never quote JSON keys, field labels, or say "according to project memory."

Priority rules (apply in order):
${rules}

Follow-up and chip-style suggestions: ${def.suggestionStyle}

Best for:
${useCases}
`.trim();
}

export function mergeAssistantIntoSystemPrompt(
  basePrompt: string,
  def: AssistantDefinition,
): string {
  return `${basePrompt.trim()}\n\n${buildAssistantPromptOverlay(def)}`;
}
