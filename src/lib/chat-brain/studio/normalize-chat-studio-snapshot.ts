/**
 * Studio snapshot normalizer.
 *
 * The chat brain's validation stage (Turn 3) calls this to turn the
 * raw `studioSnapshot` field on the request body into a typed
 * payload (or an HTTP error response).
 *
 * Adapted from eva/chat/studio/normalize-chat-studio-snapshot.ts.
 * Differences:
 *   - **Dropped:** the `clientSurface` gate (eva required
 *     `clientSurface === "studio-rail"` to even consider the
 *     snapshot). Our app is single-surface; if the client sent a
 *     snapshot, treat it as authoritative.
 *   - **Dropped:** the `apiError` helper (eva-internal error envelope
 *     format). We return a plain `Response` with a JSON body,
 *     consistent with the rest of our `/api/chat` route.
 *
 * Behaviour:
 *   - Snapshot omitted → `{ ok: true, studioSnapshotPayload: null }`.
 *     The brain's prompt stack treats null as "no studio context"
 *     and skips the studio layer.
 *   - Snapshot present + valid → `{ ok: true, studioSnapshotPayload }`.
 *   - Snapshot present + invalid → `{ ok: false, response }` with a
 *     400 carrying a human-readable error message.
 */

import {
  parseStudioSnapshot,
  type StudioSnapshotPayload,
} from "./studio-snapshot-schema";

export type NormalizeChatStudioSnapshotResult =
  | { ok: true; studioSnapshotPayload: StudioSnapshotPayload | null }
  | { ok: false; response: Response };

export function normalizeChatStudioSnapshotForPost(args: {
  rawStudioSnapshot: unknown | undefined;
}): NormalizeChatStudioSnapshotResult {
  const { rawStudioSnapshot } = args;
  if (rawStudioSnapshot === undefined || rawStudioSnapshot === null) {
    return { ok: true, studioSnapshotPayload: null };
  }
  const snapshotParse = parseStudioSnapshot(rawStudioSnapshot);
  if (!snapshotParse.success) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "VALIDATION_ERROR",
          message: snapshotParse.error,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    };
  }
  return { ok: true, studioSnapshotPayload: snapshotParse.data };
}
