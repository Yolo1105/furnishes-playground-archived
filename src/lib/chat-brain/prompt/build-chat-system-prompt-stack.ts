/**
 * System prompt stack assembly.
 *
 * Combines all the layered prompt modules into the final
 * `{ systemPrompt, modelMessages }` pair the brain pipeline ships
 * to the model.
 *
 * Layer order (top → bottom in the system prompt):
 *
 *   1. Domain base prompt (designer voice + boundaries)
 *   2. + (optional) preferences suffix from buildContext
 *   3. Critical-turn facts block (parsed from THIS user message)
 *   4. Studio context block (the scene state — walls, openings,
 *      placed pieces, style bible, mode)
 *   5. Project memory block (preferences with source quotes,
 *      recent turn excerpt, scene summary)
 *   6. Response-length instruction (adaptive to the user's message
 *      type — greeting / brevity / recommendation / question / default)
 *   7. Compare-intent voice nudge (when the user says "compare X to Y"
 *      or similar)
 *   8. Designer recommendation voice (when project memory exists)
 *   9. Safe-system-prompt scope-restriction footer (interior design
 *      ONLY — refuses off-topic requests)
 *
 * Each layer is optional except 1 and 9 — empty layers contribute
 * nothing and don't add separator noise. The output stays clean even
 * when there's no scene state (first-message scenarios).
 *
 * Adapted from eva/chat/prompt/build-chat-system-prompt-stack.ts.
 * Differences from early Studio drops:
 *   - **Restored:** assistant/persona catalog overlay when `assistantId`
 *     is provided (global Eva · Style / Plan / Budget lens).
 *   - **Dropped:** design-workflow merge (no workflow stages).
 *   - **Dropped:** playbook node-config suffix (no playbook).
 *   - **Dropped:** grounding layers from Turn 3 (attachments,
 *     retrieval, design rules, layout) — they slot into the same
 *     positions when Turn 3 lands; placeholder no-ops here.
 *   - **Replaced:** project memory now reads our `Preference[]`
 *     instead of eva's `ProjectIntelligenceContext`. Same semantic
 *     role — preferences-with-source for the model to ground on.
 */

import { getDomainConfig } from "../core/domain-config";
import { buildSafeSystemPrompt } from "../core/guardrails";
import { getResponseLengthInstruction } from "../core/response-length";
import {
  appendCompareIntentGuidance,
  appendRecommendationChatVoice,
} from "../core/chat-conversation-prompt";
import {
  criticalTurnFactsToPromptBlock,
  extractCriticalTurnFacts,
} from "../core/critical-turn-extraction";
import { getModePolicyDirective } from "../core/mode-policy";
import { studioSnapshotToPromptBlock } from "../studio/snapshot-to-prompt";
import type { StudioSnapshotPayload } from "../studio/studio-snapshot-schema";
import {
  chatAttachmentsToPromptBlock,
  type ChatAttachment,
} from "../attachments/chat-attachment";
import { buildDesignRulesPromptBlock } from "../design-rules/select-design-rules";
import { formatProjectMemoryForSystemPrompt } from "../intelligence/project-memory-prompt";
import {
  buildProjectIntelligenceContext,
  formatIntelligenceContextForPrompt,
} from "../intelligence/project-intelligence-context";
import type { Preference } from "@/lib/store/preferences-slice";
import type { ConversationTurn, Mode } from "@/lib/store/types";
import {
  getAssistantById,
  normalizeAssistantId,
} from "@/lib/eva/assistants/catalog";
import { mergeAssistantIntoSystemPrompt } from "@/lib/eva/assistants/prompt";

export type ChatPromptStackParameters = {
  /** The user's current message (used by critical-turn extraction
   *  + response-length adaptation). */
  message: string;

  /** Studio snapshot from the client; null when the client didn't
   *  attach one (signed-out / fresh project). The studio block is
   *  only rendered when this is present. */
  studioSnapshotPayload: StudioSnapshotPayload | null;

  /** Project preferences (status-filtered to non-rejected by
   *  caller). Empty array → memory block is skipped. */
  preferences: readonly Preference[];

  /** Recent conversation turns for the active conversation. Most-
   *  recent last. Empty → recent excerpt skipped. */
  recentTurns: readonly ConversationTurn[];

  /** Project metadata. */
  projectId: string;
  projectTitle: string | null;

  /** A one-liner about the scene used by the intelligence context.
   *  When null, that line is skipped. The studio block already
   *  renders rich detail from the snapshot; this is a tighter
   *  summary for the memory layer. */
  sceneSummary: string | null;

  /** Optional preferences suffix from buildContext (the flat
   *  Record<string,string> projection). Distinct from `preferences`
   *  above — that's the structured preference array; this is the
   *  legacy flat-record projection eva used. Omitted when empty. */
  preferencesFlatSuffix?: string;

  /** Image attachments the user sent this turn. Empty array →
   *  attachments layer skipped. The block is descriptive (model
   *  vision handles the actual pixels). Turn 3+. */
  attachments?: readonly ChatAttachment[];

  /** Mode the user is in (Ask / Interior Design / Furniture / Room
   *  Layout). Drives the mode-policy layer (Layer 8.5). When
   *  undefined (legacy clients), the layer is skipped. Turn 4+. */
  mode?: Mode;

  /** Active Eva persona id. Merges a coaching-lens overlay after the
   *  domain base prompt. Defaults to eva-general when omitted. */
  assistantId?: string;
};

export type ChatModelPromptResult = {
  systemPrompt: string;
  modelMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
};

/**
 * Assemble the final system prompt + model messages.
 *
 * @param params  layered inputs (see ChatPromptStackParameters)
 * @param messagesFromContext  trimmed conversation history (output of
 *                             buildContext.messages)
 */
export function buildChatSystemPromptStack(
  params: ChatPromptStackParameters,
  messagesFromContext: Array<{ role: string; content: string }>,
): ChatModelPromptResult {
  const {
    message,
    studioSnapshotPayload,
    preferences,
    recentTurns,
    projectId,
    projectTitle,
    sceneSummary,
    preferencesFlatSuffix,
  } = params;

  const domainConfig = getDomainConfig();
  let basePrompt = (domainConfig.system_prompt || "").trim();

  // Layer 1.5: persona overlay (global, non-retroactive coaching lens).
  const assistant = getAssistantById(
    normalizeAssistantId(params.assistantId),
  );
  basePrompt = mergeAssistantIntoSystemPrompt(basePrompt, assistant);

  // Layer 2: preferences flat suffix (eva-style). Optional — typically
  // empty for us because the structured preferences flow goes through
  // the memory block instead.
  if (preferencesFlatSuffix && preferencesFlatSuffix.trim()) {
    basePrompt += preferencesFlatSuffix;
  }

  // Layer 3: critical-turn facts. Dropped as a layer when no facts
  // were extracted (criticalTurnFactsToPromptBlock returns "").
  const criticalFacts = extractCriticalTurnFacts(message);
  const criticalBlock = criticalTurnFactsToPromptBlock(criticalFacts);
  if (criticalBlock) {
    basePrompt += `\n\n${criticalBlock}`;
  }

  // Layer 4: studio context.
  if (studioSnapshotPayload) {
    basePrompt += `\n\n${studioSnapshotToPromptBlock(studioSnapshotPayload)}`;
  }

  // Layer 4.5: attachments. Goes right after studio context because
  // both are "what is the user looking at" grounding. Empty when no
  // attachments.
  const attachmentsBlock = chatAttachmentsToPromptBlock(
    Array.isArray(params.attachments) ? [...params.attachments] : [],
  );
  if (attachmentsBlock) {
    basePrompt += `\n\n${attachmentsBlock}`;
  }

  // Layer 4.7: design rules (Turn 4). Selects 0-4 relevant rules from
  // the curated library based on scene state + user message keywords.
  // Empty when no rules apply (typical for greetings or scenes
  // without relevant context). The selector is conservative — better
  // to add nothing than to add rules that don't fit.
  const designRulesBlock = buildDesignRulesPromptBlock(
    studioSnapshotPayload,
    message,
  );
  if (designRulesBlock) {
    basePrompt += `\n\n${designRulesBlock}`;
  }

  // Layer 5: project memory + recent excerpt + scene summary.
  // We assemble the intelligence context inline from the inputs; the
  // formatter handles empty cases.
  const intelCtx = buildProjectIntelligenceContext({
    projectId,
    projectTitle,
    preferences,
    recentTurns,
    sceneSummary,
  });
  const intelBlock = formatIntelligenceContextForPrompt(
    intelCtx,
    formatProjectMemoryForSystemPrompt,
  );
  if (intelBlock) {
    basePrompt += `\n\n${intelBlock}`;
  }

  // Layer 6: response-length instruction.
  basePrompt += `\n\n${getResponseLengthInstruction(message)}`;

  // Layer 7: compare-intent voice nudge (no-op when not applicable).
  basePrompt = appendCompareIntentGuidance(basePrompt, message);

  // Layer 8: designer recommendation voice (when memory or visual
  // context exists — preferences, studio, or attachments).
  if (
    preferences.length > 0 ||
    studioSnapshotPayload ||
    (Array.isArray(params.attachments) && params.attachments.length > 0)
  ) {
    basePrompt = appendRecommendationChatVoice(basePrompt);
  }

  // Layer 8.5: mode policy (Turn 4). Re-asserts the user's selected
  // mode contract right before generation. Ask mode gets the
  // strongest "describe and explain only" framing; the other modes
  // get permissive framing matching their intent. Empty when mode
  // is undefined (legacy clients).
  const modeDirective = getModePolicyDirective(params.mode);
  if (modeDirective) {
    basePrompt += `\n\n${modeDirective}`;
  }

  // Layer 9: scope-restriction footer (always last).
  const systemPrompt = buildSafeSystemPrompt(basePrompt);

  // Pass the messages through; we don't re-shape them here.
  const modelMessages = messagesFromContext.map((row) => ({
    role: row.role as "user" | "assistant" | "system",
    content: row.content,
  }));

  return { systemPrompt, modelMessages };
}
