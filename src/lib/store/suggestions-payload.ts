/**
 * Suggestions request payload builder.
 *
 * Uses the same snapshot projection as `buildBrainPayload` in
 * chat-slice (`buildStudioSnapshotForBrain`) so caps and field layout
 * cannot drift. Produces the body shape `/api/studio/suggestions`
 * expects on POST — same snapshot + preferences + recent-turns
 * fields, no message field (the trigger is server-side), no top-level
 * mode (suggestions route does not apply mode policy).
 *
 * Lives in its own file so the suggestions slice can import it
 * without creating a circular dependency with chat-slice (which
 * happens when both slices import each other's helpers transitively
 * through the assembled store).
 */

import { selectProjectPreferences } from "./preferences-slice";
import type { Preference } from "./preferences-slice";
import type { ConversationTurn } from "./types";
import { buildSceneSummary } from "@studio/snapshot/scene-summary";
import { buildStudioSnapshotForBrain } from "@studio/snapshot/build-studio-snapshot";

/** The body shape /api/studio/suggestions expects on POST. */
export type SuggestionsRequestPayload = {
  studioSnapshot: Record<string, unknown>;
  preferences: Preference[];
  recentTurns: ConversationTurn[];
  projectId: string;
  projectTitle: string | null;
  sceneSummary: string | null;
};

/**
 * Build the suggestions POST body from the current store state.
 *
 * Reuses the same view of "what does the brain see" as chat — same
 * scene serialization, same preferences scope, same recent-turns
 * window. The server-side prompt builder layers them differently
 * (no mode, proactive voice) but the inputs are identical.
 *
 * Note: `state` is typed as any here on purpose — we read across
 * many slices and the precise typing of the union store would
 * require importing every slice's interface. This function is a
 * boundary; the safety is in the server-side Zod validation.
 */
export function buildSuggestionsRequestPayload(
  state: unknown,
): SuggestionsRequestPayload {
  const s = state as any;

  const projectId: string = String(s.currentProjectId ?? "");
  const project = (s.projects ?? []).find(
    (p: { id: string }) => p?.id === projectId,
  );
  const projectTitle: string | null = project?.name ?? null;

  const snapshotPayload = buildStudioSnapshotForBrain({
    projectId,
    projectTitle,
    sceneSource: s.sceneSource,
    roomMeta: s.roomMeta,
    walls: s.walls,
    openings: s.openings,
    furniture: s.furniture,
    styleBible: s.styleBible,
    referenceImageUrl: s.referenceImage?.url ?? null,
    mode: s.mode,
  });

  const preferences = selectProjectPreferences(
    { preferences: s.preferences ?? [] } as never,
    projectId,
  );

  const conversations = s.conversations ?? [];
  const activeConvo = conversations.find(
    (c: { id: string }) => c?.id === s.activeConversationId,
  );
  const recentTurns: ConversationTurn[] = activeConvo?.turns?.slice?.(-4) ?? [];

  const placedCount = snapshotPayload.furniture.filter(
    (f) => f.placed && f.visible,
  ).length;
  const sceneSummary = buildSceneSummary({
    roomMeta: s.roomMeta ?? null,
    placedCount,
    styleBibleName: s.styleBible?.name ?? null,
  });

  return {
    studioSnapshot: snapshotPayload as unknown as Record<string, unknown>,
    preferences,
    recentTurns,
    projectId,
    projectTitle,
    sceneSummary,
  };
}
