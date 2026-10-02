/**
 * Pipeline-stage type unions. Each major stage of the chat brain
 * pipeline (validation, conversation resolution, etc.) returns one
 * of these `outcome: "ok" | "reject"` discriminated unions so the
 * orchestrator's branches stay flat.
 *
 * Adapted from eva/chat/post/chat-post-types.ts. Differences:
 *   - **Dropped:** `AssistantDefinition` (no assistant catalog →
 *     dropped from the resolution payload).
 *   - **Loosened:** `ChatGenerationLogContext` (eva-only) becomes
 *     a structural type defined here.
 *   - **Loosened:** `StudioSnapshotPayload` typed as `unknown` for
 *     Turn 1; Turn 2's snapshot serializer will narrow it.
 *   - **Loosened:** attachment array typed as `unknown[]` for Turn 1;
 *     Turn 3's resolver narrows it.
 *
 * Why keep the wrapping union types: the orchestrator (Turn 3) reads
 * `outcome === "ok"` to advance; an `outcome === "reject"` carries
 * the response object the route should return immediately. Same
 * pattern eva uses.
 */

import type { ParsedChatPostBody } from "../request/parse-chat-request";

/** Standard early exit: validation, auth, rate limits, moderation.
 *  Carries a Response object the route returns directly. */
export type ChatPostStageReject = { outcome: "reject"; response: Response };

/** After request body and guardrails succeed, before conversation
 *  resolution. */
export type ChatPostValidatedRequestPayload = {
  parsed: ParsedChatPostBody;
  /** Studio snapshot from the client. Turn 2 narrows this via Zod
   *  through the snapshot normalizer. Loose `unknown` for now. */
  studioSnapshotPayload: unknown | null;
  /** Attachments — Turn 3 narrows this. Loose `unknown[]` for Turn 1. */
  attachmentList: unknown[];
  chatRequestId: string;
  traceId: string | null;
};

export type ChatPostValidatedRequest =
  | ChatPostStageReject
  | { outcome: "ok"; payload: ChatPostValidatedRequestPayload };

/** Logging context threaded through the pipeline. Replaces eva's
 *  `ChatGenerationLogContext`. Carries enough to correlate every
 *  log line back to a single request. */
export type ChatGenerationLogContext = {
  chatRequestId: string;
  traceId: string | null;
  conversationId: string | null;
  projectId: string | null;
  /** "claude.ai", "ip:x.x.x.x", or "user:<id>" — coarse identity
   *  for rate limiting & abuse correlation. Not for analytics. */
  clientIdentity: string;
};

/** Result of resolving/creating the conversation and persisting the
 *  user turn. */
export type ChatConversationResolution =
  | ChatPostStageReject
  | {
      outcome: "ok";
      value: {
        convoId: string;
        /** Eva returns a Set-Cookie header for session continuity.
         *  We use Supabase JWT instead — left optional so a future
         *  cookie-backed identity scheme can re-enable it. */
        setCookieHeader: string | undefined;
        userMessage: { id: string };
        costWarning: boolean;
        chatGenLogCtx: ChatGenerationLogContext;
      };
    };

/**
 * Shared shape for `streamText` / `generateText` (minus `model`)
 * used by the chat brain. The `system` field carries the assembled
 * prompt stack output; `messages` is the trimmed conversation
 * history; `abortSignal` propagates user-cancel through every layer.
 */
export type ChatPromptCoreGeneration = {
  system: string;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  abortSignal: AbortSignal;
};
