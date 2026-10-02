/**
 * Design-rule selector + formatter.
 *
 * Picks 0-4 relevant rules from the library based on the scene state
 * and user message, then formats them as a system-prompt block.
 *
 * # Selection cap
 *
 * Hard cap at 4 rules per turn. Each rule body is ~5 lines / 250
 * chars; 4 rules = ~1000 chars added to the prompt. That's a
 * meaningful chunk of context budget but worth it for the grounding
 * value when the rules genuinely apply. If the selector returns more
 * than 4 (rules in priority order), we keep the first 4.
 *
 * # Empty case
 *
 * When 0 rules apply, the formatter returns "" so the caller skips
 * the layer entirely. This is the typical case for greetings, simple
 * questions ("what time is it"), or scenes with no relevant context.
 * No padding, no "(no rules apply)" placeholder.
 *
 * # Why no rule combiners
 *
 * Eva had a "rule combiner" layer that merged related rules (e.g.
 * "walkway" + "traffic flow" become a single block about
 * circulation). We don't bother. With 6 hand-written rules and a
 * cap of 4, individual rules are clear enough on their own. If the
 * library grows past ~15 rules, revisit.
 */

import {
  DESIGN_RULES,
  type DesignRule,
  type RuleSelectorContext,
} from "./design-rule-library";
import type { StudioSnapshotPayload } from "../studio/studio-snapshot-schema";

const RULE_CAP = 4;

/**
 * Select up to {@link RULE_CAP} relevant rules from the library.
 * Rules are returned in library order (which is roughly priority
 * order — walkway first, conversation grouping last).
 */
export function selectRelevantDesignRules(
  snapshot: StudioSnapshotPayload | null,
  userMessage: string,
): DesignRule[] {
  const ctx: RuleSelectorContext = {
    snapshot,
    userMessageLower: (userMessage ?? "").toLowerCase(),
  };
  const matched: DesignRule[] = [];
  for (const rule of DESIGN_RULES) {
    if (rule.appliesWhen(ctx)) {
      matched.push(rule);
      if (matched.length >= RULE_CAP) break;
    }
  }
  return matched;
}

/**
 * Format a list of design rules as a system-prompt block. Empty
 * input → empty output (caller skips the layer).
 *
 * Output shape:
 *
 *     [DESIGN PRINCIPLES — apply when relevant]
 *     The principles below ground specific suggestions. Reference them
 *     naturally; do not list them as a checklist.
 *
 *     • Walkway clearance:
 *     Walkway clearance: leave at least 75-90cm between major pieces...
 *
 *     • TV viewing distance:
 *     TV viewing distance: optimal viewing distance is 2-3x the...
 */
export function formatDesignRulesForPrompt(
  rules: readonly DesignRule[],
): string {
  if (rules.length === 0) return "";
  const lines: string[] = [];
  lines.push("[DESIGN PRINCIPLES — apply when relevant]");
  lines.push(
    "The principles below ground specific suggestions. Reference them",
    "naturally; do not list them as a checklist.",
  );
  lines.push("");
  for (const rule of rules) {
    lines.push(`• ${rule.title}:`);
    lines.push(rule.body);
    lines.push("");
  }
  // Drop the trailing blank line.
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

/** Convenience: select and format in one call. Used by the prompt
 *  stack assembly. */
export function buildDesignRulesPromptBlock(
  snapshot: StudioSnapshotPayload | null,
  userMessage: string,
): string {
  const rules = selectRelevantDesignRules(snapshot, userMessage);
  return formatDesignRulesForPrompt(rules);
}

/**
 * Select rules using ONLY scene-state conditions, ignoring the
 * message-keyword gate. Used by the suggestions endpoint where the
 * "user message" is a synthetic trigger ("Review this space") and
 * the scene alone determines which rules apply.
 *
 * Implementation: passes a wildcard message containing every keyword
 * the library's selectors look for, so the message-side condition
 * is always true. The scene-side condition (sceneHasTV, sceneHasDoor,
 * etc.) still gates inclusion.
 *
 * The cap of {@link RULE_CAP} still applies.
 */
const SCENE_REVIEW_WILDCARD_MESSAGE = [
  // Cover every keyword family the selectors check. Order doesn't
  // matter; presence does.
  "review the full layout and arrangement and placement",
  "considering walkway circulation flow and tightness",
  "the door swing and entry threshold",
  "the tv viewing seating and screen orientation",
  "the bed bedroom and sleeping headboard",
  "windows and natural light and view sightlines",
  "seating conversation grouping facing toward each other",
].join(", ");

export function selectAllApplicableDesignRules(
  snapshot: StudioSnapshotPayload | null,
): DesignRule[] {
  return selectRelevantDesignRules(snapshot, SCENE_REVIEW_WILDCARD_MESSAGE);
}

export function buildSceneReviewDesignRulesBlock(
  snapshot: StudioSnapshotPayload | null,
): string {
  const rules = selectAllApplicableDesignRules(snapshot);
  return formatDesignRulesForPrompt(rules);
}
