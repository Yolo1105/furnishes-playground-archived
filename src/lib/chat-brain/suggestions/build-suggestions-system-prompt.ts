/**
 * Suggestions system prompt builder.
 *
 * Reuses the chat-brain prompt layers (domain config, studio context,
 * design rules, project memory) but replaces the conversational voice
 * tier with a proactive-observer voice. Output format is asked for as
 * `### Suggestion N: Title\nBody` so the client can split on
 * boundaries and render cards as text streams in.
 *
 * # What's different from chat
 *
 * - **No user message.** The brain is generating proactively, not
 *   responding to a question. The synthetic user message we feed the
 *   pump is just "Generate suggestions for this scene."
 *
 * - **Proactive-observer voice.** Tells the model it's an interior
 *   designer reviewing the user's space and surfacing observations,
 *   rather than responding to a request. Different cadence — short
 *   declarative cards, not conversational prose.
 *
 * - **Card output format.** Asks for 3-5 numbered suggestions with a
 *   short title and a 1-3 sentence body. The client parses on the
 *   `### Suggestion N:` boundaries.
 *
 * - **Mode policy is inert.** Mode policy (Turn 4) doesn't apply here
 *   — suggestions are always proactive. We omit it from the layer
 *   stack.
 *
 * # What's the same as chat
 *
 * - Studio context layer (Turn 2) — same scene serialization
 * - Design rules layer (Turn 4) — same rule library, same selector
 * - Project memory layer (Turn 2) — same preference rendering
 * - Domain config base voice (Turn 2) — same designer persona
 * - Scope footer (Turn 1) — keeps the model on topic
 *
 * # Empty-scene handling
 *
 * When the snapshot is null or the room has zero placed pieces, we
 * append a small note to the prompt asking the model to suggest
 * starting points (largest piece first, anchor furniture, etc.)
 * rather than nag about a missing scene. The model still produces
 * 3-5 suggestions; they just look different.
 */

import { getDomainConfig } from "../core/domain-config";
import { buildSafeSystemPrompt } from "../core/guardrails";
import { studioSnapshotToPromptBlock } from "../studio/snapshot-to-prompt";
import { buildSceneReviewDesignRulesBlock } from "../design-rules/select-design-rules";
import {
  buildProjectIntelligenceContext,
  formatIntelligenceContextForPrompt,
} from "../intelligence/project-intelligence-context";
import { formatProjectMemoryForSystemPrompt } from "../intelligence/project-memory-prompt";
import type { StudioSnapshotPayload } from "../studio/studio-snapshot-schema";
import type { Preference } from "@/lib/store/preferences-slice";
import type { ConversationTurn } from "@/lib/store/types";

/** The synthetic user message we send to the pump. The model never
 *  sees a real user prompt — this is the trigger that asks for
 *  suggestions. */
export const SUGGESTIONS_TRIGGER_MESSAGE =
  "Review this space and surface 3 to 5 prioritized design observations.";

/**
 * The proactive-observer voice block. Replaces the conversational
 * voice tier from chat. Tells the model it's reviewing the space and
 * noting what would make it work better — not chatting.
 *
 * Kept short on purpose; verbose voice instructions tend to confuse
 * the model when paired with strict output-format instructions.
 */
const PROACTIVE_OBSERVER_VOICE = [
  "[VOICE — proactive design review]",
  "You are reviewing this space as an experienced interior designer.",
  "You're not chatting — you're walking through and noting what would",
  "make the room work better. Each observation should be specific and",
  "grounded in something visible in the scene. Avoid generic platitudes",
  "(\"good lighting matters\"). Anchor each suggestion to a real piece,",
  "dimension, or principle that applies HERE.",
].join("\n");

/**
 * The output-format directive. The model must produce 3-5 numbered
 * suggestions with the exact heading shape:
 *
 *     ### Suggestion N: Short title
 *     Body text. 1-3 sentences. Specific.
 *
 * The client parses on `### Suggestion` boundaries to split into
 * cards. Deviation from the heading shape breaks parsing — we ask
 * for it firmly. Most modern Anthropic models follow heading
 * directives reliably.
 */
const OUTPUT_FORMAT_DIRECTIVE = [
  "[OUTPUT FORMAT — strict]",
  "Produce exactly 3 to 5 suggestions. Each suggestion uses this",
  "format with no deviation:",
  "",
  "### Suggestion N: Short title",
  "Body text — 1 to 3 sentences. Specific. Grounded in the scene.",
  "",
  "### Suggestion N+1: Short title",
  "Body text...",
  "",
  "Rules:",
  "- Begin each suggestion with `### Suggestion ` (three hashes, space).",
  "- Number suggestions consecutively starting at 1.",
  "- The title is short (≤8 words). The body is 1 to 3 sentences.",
  "- Order by impact: most useful suggestion first.",
  "- Do NOT add preamble before the first heading or commentary",
  "  between suggestions. Just the cards, in order.",
].join("\n");

/**
 * Empty-scene hint. Appended only when the snapshot is null or the
 * room has zero placed pieces. Tells the model to suggest starting
 * points instead of complaining about an empty scene.
 */
const EMPTY_SCENE_HINT = [
  "[NOTE — empty space]",
  "The user hasn't placed furniture yet. Suggestions should help them",
  "start: what to place first, layout direction, anchor pieces, style",
  "decisions. Don't comment on the empty state itself; just propose",
  "concrete starting points.",
].join("\n");

export type SuggestionsPromptParameters = {
  /** Studio snapshot from the client; null when the client didn't
   *  attach one. The studio block is only rendered when this is
   *  present, but suggestions still generate (with empty-scene
   *  hint fallback). */
  studioSnapshotPayload: StudioSnapshotPayload | null;

  /** Project preferences (status-filtered to non-rejected by
   *  caller). Empty array → memory block is skipped. */
  preferences: readonly Preference[];

  /** Recent conversation turns for the active conversation. Most-
   *  recent last. Empty → recent excerpt skipped. The brain reads
   *  these to align suggestions with what the user has been
   *  discussing. */
  recentTurns: readonly ConversationTurn[];

  /** Project metadata. */
  projectId: string;
  projectTitle: string | null;

  /** A one-liner about the scene used by the intelligence context. */
  sceneSummary: string | null;
};

export type SuggestionsPromptResult = {
  systemPrompt: string;
  /** The synthetic user message to feed the pump. */
  triggerMessage: string;
};

/**
 * Build the system prompt for a suggestions generation. Same layer
 * structure as chat (Turn 2-4), with the conversational voice tier
 * replaced by the proactive-observer voice and the output-format
 * directive appended at the end (just before the scope footer).
 */
export function buildSuggestionsSystemPrompt(
  params: SuggestionsPromptParameters,
): SuggestionsPromptResult {
  const {
    studioSnapshotPayload,
    preferences,
    recentTurns,
    projectId,
    projectTitle,
    sceneSummary,
  } = params;

  const domainConfig = getDomainConfig();
  let basePrompt = (domainConfig.system_prompt || "").trim();

  // Layer 4: studio context (when snapshot present).
  if (studioSnapshotPayload) {
    basePrompt += `\n\n${studioSnapshotToPromptBlock(studioSnapshotPayload)}`;
  }

  // Layer 4.7: design rules. For suggestions, we use the scene-only
  // selector (skips the message-keyword gate) — the trigger message
  // is generic and the user is reviewing the WHOLE space, so any
  // rule whose scene-state conditions are met should be included.
  const designRulesBlock = buildSceneReviewDesignRulesBlock(
    studioSnapshotPayload,
  );
  if (designRulesBlock) {
    basePrompt += `\n\n${designRulesBlock}`;
  }

  // Layer 5: project memory + recent excerpt + scene summary.
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

  // Voice override — replaces the conversational voice tier.
  basePrompt += `\n\n${PROACTIVE_OBSERVER_VOICE}`;

  // Empty-scene fallback — appended only when there's nothing to
  // observe in the room.
  const placedCount = studioSnapshotPayload?.furniture
    ? studioSnapshotPayload.furniture.filter((f) => f.placed && f.visible).length
    : 0;
  if (!studioSnapshotPayload || placedCount === 0) {
    basePrompt += `\n\n${EMPTY_SCENE_HINT}`;
  }

  // Output format directive — ALWAYS last before the scope footer
  // so it has the most weight. The model reads format instructions
  // best when they're proximate to generation.
  basePrompt += `\n\n${OUTPUT_FORMAT_DIRECTIVE}`;

  // Scope footer (always last via buildSafeSystemPrompt).
  const systemPrompt = buildSafeSystemPrompt(basePrompt);

  return {
    systemPrompt,
    triggerMessage: SUGGESTIONS_TRIGGER_MESSAGE,
  };
}
