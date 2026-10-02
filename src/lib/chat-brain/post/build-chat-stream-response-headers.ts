/**
 * Stream response header builder. Combines correlation IDs
 * (request, conversation, user-message), grounding metadata
 * headers (retrieval strength, studio attached, attachment
 * grounding state), cost warnings, and any cookie passthrough into
 * one Record the route returns alongside the streaming body.
 *
 * Adapted from eva/chat/post/build-chat-stream-response-headers.ts.
 * Differences:
 *   - `AttachmentGroundingSummary` is defined inline (Turn 3 will
 *     promote it to a shared type once attachments wire up).
 *   - `RetrievalQualityLevel` is defined inline as the same string
 *     union eva uses.
 *   - `StudioSnapshotPayload` is loose `unknown | null` here — we
 *     only check truthiness for the header value, so the precise
 *     shape doesn't matter at this layer.
 */

import { CHAT_OUTBOUND_HTTP, CHAT_ROUTE_HEADER } from "../core/chat-http-header-names";
import { CHAT_RESPONSE_HEADER } from "../core/chat-generation-failure";

/** Loose retrieval quality enum — Turn 3's grounding layer narrows
 *  this once the RAG layer stub takes a real shape. Keep the same
 *  string values eva uses so logs remain comparable across systems. */
export type RetrievalQualityLevel =
  | "strong"
  | "weak"
  | "none"
  | "unavailable";

/** Attachment grounding result summary. Turn 3's
 *  `enrichAttachmentsWithServerVision` produces this, but we define
 *  the shape here so this header builder can typecheck cleanly
 *  before that lands. */
export type AttachmentGroundingSummary = {
  /** Goes straight into the X-Chat-Attachment-Grounding header. */
  responseHeaderValue:
    | "none"
    | "metadata_only"
    | "partial"
    | "unavailable"
    | "analyzing_skipped";
  /** True when at least one attachment has a usable text summary. */
  hasUsableGrounding: boolean;
};

/**
 * Headers returned with the streamed chat body (grounding +
 * correlation). The route does:
 *
 *     return new Response(stream, { headers: buildChatStreamResponseHeaders({...}) });
 *
 * All values are strings (HTTP headers must be); booleans/null/undefined
 * fields are conditionally spread so unset values don't show up as
 * literal "undefined" strings in the response.
 */
export function buildChatStreamResponseHeaders(args: {
  chatRequestId: string;
  clientAttemptId?: string | null;
  conversationId: string | null;
  userMessageId: string;
  costWarning: boolean;
  setCookieHeader?: string;
  retrievalQuality: RetrievalQualityLevel;
  studioSnapshotPayload: unknown | null;
  attachmentGrounding: AttachmentGroundingSummary;
}): Record<string, string> {
  const {
    chatRequestId,
    clientAttemptId,
    conversationId,
    userMessageId,
    costWarning,
    setCookieHeader,
    retrievalQuality,
    studioSnapshotPayload,
    attachmentGrounding,
  } = args;

  return {
    [CHAT_OUTBOUND_HTTP.CONTENT_TYPE]:
      CHAT_OUTBOUND_HTTP.CONTENT_TYPE_TEXT_PLAIN_UTF8,
    [CHAT_RESPONSE_HEADER.REQUEST_ID]: chatRequestId,
    ...(clientAttemptId
      ? { [CHAT_RESPONSE_HEADER.CLIENT_ATTEMPT_ID]: clientAttemptId }
      : {}),
    ...(conversationId
      ? { [CHAT_OUTBOUND_HTTP.CONVERSATION_ID]: conversationId }
      : {}),
    [CHAT_OUTBOUND_HTTP.USER_MESSAGE_ID]: userMessageId,
    ...(costWarning
      ? {
          [CHAT_OUTBOUND_HTTP.COST_WARNING]:
            CHAT_OUTBOUND_HTTP.COST_WARNING_APPROACHING,
        }
      : {}),
    ...(setCookieHeader
      ? { [CHAT_OUTBOUND_HTTP.SET_COOKIE]: setCookieHeader }
      : {}),
    [CHAT_ROUTE_HEADER.RETRIEVAL_STRENGTH]: retrievalQuality,
    [CHAT_ROUTE_HEADER.GROUNDING_STUDIO]: studioSnapshotPayload ? "1" : "0",
    [CHAT_ROUTE_HEADER.ATTACHMENT_GROUNDING]:
      attachmentGrounding.responseHeaderValue,
  };
}
