/**
 * Playground snapshot persistence validation (API routes + tests).
 * Do not import from client components — keep usage server-side only.
 */
import { z } from "zod";

/** Max raw JSON body size for PUT (characters ≈ bytes for UTF-8 ASCII-heavy payloads). */
export const PLAYGROUND_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Structural validation for the client `ProjectSnapshot` root
 * (`lib/studio/persistence/snapshot.ts`). Deep leaves are `unknown`
 * to avoid duplicating the full client schema in Zod; caps limit abuse.
 */
export const PlaygroundProjectSnapshotSchema = z.object({
  schemaVersion: z.string().min(1).max(40),
  id: z.string().min(1).max(128),
  name: z.string().max(500),
  createdAt: z.number(),
  updatedAt: z.number(),
  sceneSource: z.enum(["viewer", "room-director"]),
  items: z.array(z.unknown()).max(600),
  furnitureFull: z.array(z.unknown()).max(600),
  roomMeta: z.unknown().nullable(),
  walls: z.array(z.unknown()).max(200),
  openings: z.array(z.unknown()).max(200),
  styleBible: z.unknown().nullable(),
  originalScene: z.unknown().nullable(),
  referenceImageUrl: z.union([z.string().max(4096), z.null()]),
  requirements: z.unknown(),
  conversations: z.array(z.unknown()).max(200),
  activeConversationId: z.union([z.string().max(256), z.null()]),
  preferences: z.array(z.unknown()).max(800),
  generations: z.unknown(),
  profile: z.unknown().nullable(),
});

export type PlaygroundProjectSnapshotWire = z.infer<
  typeof PlaygroundProjectSnapshotSchema
>;

export const PlaygroundPersistedEnvelopeSchema = z.object({
  revision: z.number().int().min(1),
  snapshot: PlaygroundProjectSnapshotSchema,
});

export type PlaygroundPersistedEnvelope = z.infer<
  typeof PlaygroundPersistedEnvelopeSchema
>;

export const PutPlaygroundSnapshotBodySchema = z.object({
  /** Omit, `null`, or `0` when no server row exists yet. Otherwise must match current `revision`. */
  expectedRevision: z.union([z.number().int().min(0), z.null()]).optional(),
  snapshot: PlaygroundProjectSnapshotSchema,
});

export type PutPlaygroundSnapshotBody = z.infer<
  typeof PutPlaygroundSnapshotBodySchema
>;

export function parsePersistedEnvelope(
  raw: unknown,
):
  | { ok: true; value: PlaygroundPersistedEnvelope }
  | { ok: false; error: string } {
  const r = PlaygroundPersistedEnvelopeSchema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      error: r.error.flatten().formErrors.join("; ") || "invalid envelope",
    };
  }
  return { ok: true, value: r.data };
}
