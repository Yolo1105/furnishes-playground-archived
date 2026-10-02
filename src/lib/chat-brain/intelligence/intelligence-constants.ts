/**
 * Intelligence-layer limits.
 *
 * Adapted from eva/intelligence/intelligence-constants.ts. We strip
 * fields tied to the dropped subsystems (workflow refinement, ranking
 * factors that depend on the playbook, decision-context schemas) and
 * keep only what our brain actually consumes:
 *   - prompt cap sizes for memory/context blocks
 *   - recent-turn excerpt sizing
 *   - preference-extraction thresholds (Risk 4)
 *
 * These are tuned values, not arbitrary — eva ran with these in
 * production and the trade-offs are well-understood. Don't retune
 * without evidence.
 */

export const INTELLIGENCE_LIMITS = {
  /** Brief lines (key/value bullets) included in the project memory
   *  prompt. Each line is small (~50 chars) so 10 lines is ~500 chars. */
  promptBriefLineMax: 10,

  /** Constraint strings embedded in the prompt. Full list lives in
   *  the slice; the prompt only needs the most-recent ones. */
  promptConstraintsMax: 20,

  /** Open follow-ups / unresolved items in the prompt. */
  promptSupplementaryOpenMax: 8,

  /** Cap on number of recent turn excerpts. Eva took 4; we match. */
  recentChatMessagesTake: 4,

  /** Per-turn excerpt char cap before "…" truncation. */
  recentChatMessagePreviewChars: 400,

  /** Total cap on the recent-conversation excerpt block. The brain's
   *  prompt stack has many other layers; capping the excerpt prevents
   *  a verbose conversation from crowding out grounding. */
  recentChatExcerptMaxChars: 1200,

  /** Cap on insights blockers ("primary blockers" list). */
  projectInsightsBlockersMax: 8,

  // ── Preference extraction (Risk 4 mitigation) ───────────────────
  //
  // Persistence policy (confirmation UX):
  //   confidence < provisional → drop entirely
  //   confidence ≥ provisional → status="provisional" (proposal)
  //   User Accept → status="confirmed" (memory)
  //
  // High/medium/low confidence only affects presentation (inline vs
  // panel). Never auto-confirm — inferred ≠ remembered.
  //
  // `preferenceConfirmedConfidence` remains the UI threshold for the
  // "High confidence" label (≥0.9).

  /** Below this confidence, the extractor drops the candidate
   *  entirely. Set high so noise doesn't pollute the store. */
  preferenceMinConfidence: 0.7,

  /** At or above this, the UI shows "High confidence". Accept is
   *  still required before the preference becomes memory. */
  preferenceConfirmedConfidence: 0.9,

  /** Max preferences to surface in the prompt block per turn.
   *  Beyond this we summarise. */
  promptPreferencesMax: 12,

  /** Max length of the source-text quote we keep per preference.
   *  We don't need the entire turn — just the substring that proves
   *  the user said it. */
  preferenceSourceTextMaxChars: 200,
} as const;
