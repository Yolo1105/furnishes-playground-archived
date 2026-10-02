/**
 * Chat POST body schema, parsed by the brain pipeline's validation
 * stage.
 *
 * Adapted from eva/chat/request/parse-chat-request.ts. Differences:
 *   - **Removed:** `assistantId` (no assistant catalog), the strict
 *     `ChatAttachmentSchema` import (lives in eva-only attachments
 *     module), and `ClientMessageSourceSchema` / `ClientSurfaceSchema`
 *     (eva-dashboard analytics).
 *   - **Kept:** every field we need in Turns 2-5 — message text,
 *     conversation/project ids, preferences, retry correlation IDs,
 *     studio snapshot pass-through, attachments (loose schema for
 *     now; tightened in Turn 3).
 *
 * The attachments field accepts `unknown[]` for Turn 1 — Turn 3's
 * resolve-chat-attachments stage will Zod-validate at use time. The
 * trade-off: looser at the parse boundary, but the only caller is
 * our own client which always sends well-formed shapes.
 *
 * `studioSnapshot` is `unknown` because the snapshot serializer
 * (Turn 2) is the canonical Zod boundary for that payload.
 *
 * `mode` is new — added so the brain pipeline knows whether the
 * caller wants Ask (read-only) or Interior Design (actions allowed)
 * routing. Defaults to "Interior Design" when omitted for backward
 * compat with existing client code that doesn't yet send `mode`.
 */

import { z } from "zod";

export const buildChatPostBodySchema = (maxMessageLength: number) =>
  z.object({
    conversationId: z.string().optional(),
    projectId: z.string().optional(),
    message: z.string().min(1).max(maxMessageLength),
    preferences: z.record(z.string(), z.string()).optional(),
    skipExtraction: z.boolean().optional(),
    clientAttemptId: z.string().max(128).optional(),
    priorChatRequestId: z.string().max(128).optional(),
    studioSnapshot: z.unknown().optional(),
    /** Loose array of attachments. Turn 3's `resolveChatAttachments`
     *  validates each entry against the proper schema. Capped at 8 to
     *  match eva's policy. */
    attachments: z.array(z.unknown()).max(8).optional(),
    /** Turn 4's Ask-mode addition. Defaults to "Interior Design" when
     *  omitted so older clients that pre-date the mode field continue
     *  to work. */
    mode: z
      .enum(["Ask", "Interior Design", "Furniture", "Room Layout"])
      .optional(),
    /** Turn 4's actions-allowed flag. Always derivable from `mode`
     *  (Ask → false; everything else → true) but accepting it
     *  explicitly lets clients override per-request if they want. */
    actionsAllowed: z.boolean().optional(),
    /** Global Eva persona for this request (non-retroactive). */
    assistantId: z
      .enum(["eva-general", "eva-style", "eva-plan", "eva-budget"])
      .optional(),
    /** Alias used by the design contract — same as assistantId. */
    personaId: z
      .enum(["eva-general", "eva-style", "eva-plan", "eva-budget"])
      .optional(),
  });

export type ParsedChatPostBody = z.infer<
  ReturnType<typeof buildChatPostBodySchema>
>;
