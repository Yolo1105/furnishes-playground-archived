/**
 * Mode policy.
 *
 * Each chat turn arrives with a `mode` selected by the user from
 * the chat dock dropdown:
 *
 *   - **Ask** — read-only Q&A. The brain describes, explains, and
 *     teaches. It does NOT propose changes to the scene. If the user
 *     asks "should I move my sofa", the brain answers with reasoning
 *     and tradeoffs but does not say "I'd move it 30cm toward the
 *     window" — instead it might say "the trade-off is X vs Y".
 *
 *   - **Interior Design** — full design conversation. The brain
 *     suggests changes, proposes layouts, contrasts options. This is
 *     the default mode and the richest voice tier.
 *
 *   - **Furniture** — single-piece generation context. The user is
 *     producing one new furniture item; the brain helps shape the
 *     piece's specification (dimensions, materials, style) before
 *     generation runs.
 *
 *   - **Room Layout** — room-director generation context. The user
 *     is producing a full room. The brain helps with room intent
 *     (style bible, room type, layout direction) before generation.
 *
 * # Why mode-as-policy and not mode-as-flag
 *
 * Eva (and our Turn 2 domain config) already mention mode discipline
 * as a *directive* in the static system prompt. The model reads it
 * but treats it as guidance — and a sufficiently insistent user can
 * talk it into ignoring the rule. That's fine for soft enforcement
 * (which is all we have today; we don't have a structured-action
 * gate), but the directive is more effective when it's *current* —
 * delivered as the LAST instruction the model reads before
 * generation, after all the studio context and preferences.
 *
 * That's what this module does: produces a per-mode prompt amendment
 * the prompt-stack assembly slots in just before the scope-restriction
 * footer (Layer 9.5). It re-asserts the mode's contract right before
 * the model speaks, where it has the most weight.
 *
 * # Why not enforce at the output layer
 *
 * The "right" enforcement is structural: in Ask mode, the model
 * shouldn't be ABLE to emit action proposals (because there's no
 * action-emission slot). We don't have action proposals yet (Turn
 * 4 explicitly defers them — see TURN_PROGRESS.md), so we
 * have nothing to gate. When action proposals land, that's the
 * place to turn this soft policy into a hard one.
 */

import type { Mode } from "@/lib/store/types";

/**
 * Per-mode policy directive. Returns a short prompt block to insert
 * just before the scope-restriction footer. Empty string when
 * `mode` is undefined (legacy clients) so the caller can skip the
 * layer entirely.
 *
 * Format: a `[MODE POLICY]` headline followed by 2-3 lines of
 * imperative voice. Short on purpose — long policy blocks at the
 * end of the prompt risk being treated as preamble rather than
 * binding rules.
 */
export function getModePolicyDirective(mode: Mode | undefined): string {
  if (!mode) return "";

  switch (mode) {
    case "Ask":
      return [
        "[MODE POLICY — Ask mode]",
        "The user is in Ask mode. They want explanations, descriptions,",
        "and reasoning — not action proposals. Describe trade-offs and",
        "principles. Do NOT say things like \"I'd move the sofa\" or",
        "\"let's swap the chairs\" — instead, describe the considerations",
        "(\"placing it closer to the window means more morning light but",
        "less wall space\"). When tempted to propose a specific change,",
        "explain the principle behind it instead.",
      ].join("\n");

    case "Interior Design":
      return [
        "[MODE POLICY — Interior Design mode]",
        "The user is in full design mode. Suggest concrete changes,",
        "propose layouts, contrast specific options. Frame suggestions",
        "as something the user can act on. Anchor every suggestion to",
        "a real piece, dimension, or constraint from the scene — not",
        "generic principles.",
      ].join("\n");

    case "Furniture":
      return [
        "[MODE POLICY — Furniture mode]",
        "The user is shaping a single piece of furniture they're about",
        "to generate. Help them specify the piece (style, materials,",
        "dimensions, intended use). Stay focused on this one piece —",
        "don't drift into room layout.",
      ].join("\n");

    case "Room Layout":
      return [
        "[MODE POLICY — Room Layout mode]",
        "The user is shaping a full room they're about to generate.",
        "Help them specify the room intent (room type, style bible,",
        "key pieces, mood). Talk about the room as a whole — composition,",
        "flow, mood — not individual furniture details.",
      ].join("\n");
  }
}

/**
 * True when the mode allows the brain to propose actions. Today this
 * is informational — we don't have an action-emission gate. Future
 * structured-actions feature will check this before allowing the
 * model to emit a tool call.
 */
export function modeAllowsActions(mode: Mode | undefined): boolean {
  if (!mode) return true; // legacy default
  return mode !== "Ask";
}
