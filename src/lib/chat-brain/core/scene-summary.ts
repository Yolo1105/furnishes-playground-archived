/**
 * Scene-summary line builder.
 *
 * Produces the one-line scene description ("5.0m × 4.0m room, 4 pieces
 * placed, mid-century modern style") used by:
 *   - chat-slice's `buildBrainPayload`
 *   - suggestions-payload's `buildSuggestionsRequestPayload`
 *
 * Both feed into the prompt-stack's intelligence-context layer, which
 * uses this as a tighter alternative to re-rendering the full studio
 * snapshot. Keeping the two payload builders agreed on the format
 * prevents the model from seeing inconsistent summaries depending on
 * which endpoint generated the request.
 *
 * Returns null when there's nothing to summarize (no room metadata,
 * zero pieces, no style).
 */

export type SceneSummaryInputs = {
  /** Room footprint dimensions, when set. Width × depth in metres. */
  roomMeta: { width: number; depth: number } | null | undefined;
  /** How many pieces are both placed AND visible. */
  placedCount: number;
  /** Style bible name, if the project has chosen one. */
  styleBibleName: string | null | undefined;
};

export function buildSceneSummary(
  inputs: SceneSummaryInputs,
): string | null {
  const parts: string[] = [];
  if (inputs.roomMeta) {
    const dim = `${Number(inputs.roomMeta.width).toFixed(1)}m × ${Number(inputs.roomMeta.depth).toFixed(1)}m`;
    parts.push(`${dim} room`);
  }
  parts.push(
    `${inputs.placedCount} piece${inputs.placedCount === 1 ? "" : "s"} placed`,
  );
  if (inputs.styleBibleName) {
    parts.push(`${inputs.styleBibleName} style`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}
