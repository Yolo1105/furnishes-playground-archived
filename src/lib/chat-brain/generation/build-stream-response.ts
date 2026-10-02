/**
 * Build a streaming Response from the pump's event generator.
 *
 * Glues the pump (which yields wire events) to an HTTP response. The
 * caller — `/api/chat` route — does:
 *
 *     return buildStreamingChatResponse({ pump, headerArgs });
 *
 * The function wires up:
 *   - A ReadableStream that pulls events from the generator and
 *     encodes each one as an SSE record into the response body.
 *   - The X-Chat-* response headers (request id, conversation id,
 *     grounding signals, cost warning) attached at construction.
 *   - An async tail that runs after the pump finishes — used to
 *     log the PumpResult outcome to telemetry.
 *
 * The headers are set BEFORE the body starts streaming, which is
 * standard HTTP. That means we must know studioSnapshot presence,
 * conversation id, and so on at call time. The failure category
 * (when generation fails mid-stream) goes into the SSE body as a
 * `wire-events.WireErrorEvent` rather than a header — headers are
 * already gone by then.
 *
 * Encoding: SSE bodies must be UTF-8, line-separated by \n (not
 * \r\n). The TextEncoder used here produces the correct bytes.
 *
 * Aborts: when the client disconnects, the route's abort signal
 * fires, which the pump propagates to its Anthropic stream. The
 * pump then yields its terminal CLIENT_ABORT error event and the
 * generator returns. The ReadableStream's pull function sees the
 * generator end and closes the body normally.
 */

import { CHAT_OUTBOUND_HTTP, CHAT_ROUTE_HEADER } from "../core/chat-http-header-names";
import { CHAT_RESPONSE_HEADER } from "../core/chat-generation-failure";
import { encodeWireEvent, type WireEvent } from "./wire-events";
import type { PumpResult } from "./stream-pump";
import type {
  AttachmentGroundingSummary,
  RetrievalQualityLevel,
} from "../post/build-chat-stream-response-headers";

export interface BuildStreamingChatResponseArgs {
  /** The pump generator. We consume it; caller relinquishes control. */
  pump: AsyncGenerator<WireEvent, PumpResult, void>;
  /** Request correlation id. Echoed in X-Chat-Request-Id. */
  chatRequestId: string;
  /** Optional client-supplied retry correlation id. */
  clientAttemptId?: string | null;
  /** Active conversation id, when known. */
  conversationId: string | null;
  /** Stable id of the user message we're replying to. */
  userMessageId: string;
  /** True when session cost is approaching the limit. Surfaced
   *  via X-Cost-Warning so the client can show a banner. */
  costWarning: boolean;
  /** Optional cookie passthrough (we don't use cookies today, but
   *  the header builder supports it). */
  setCookieHeader?: string;
  /** Retrieval quality this turn. Phase 3a: always "none" until
   *  Turn 4's retrieval landing. */
  retrievalQuality: RetrievalQualityLevel;
  /** Whether a studio snapshot was attached. */
  studioSnapshotAttached: boolean;
  /** Attachment grounding summary. Phase 3a: always
   *  "none" / hasUsableGrounding=false. Phase 3c populates. */
  attachmentGrounding: AttachmentGroundingSummary;
  /** Optional callback invoked when the pump finishes. Receives the
   *  PumpResult. Useful for telemetry without coupling to a
   *  specific logger. */
  onPumpComplete?: (result: PumpResult) => void;
}

export function buildStreamingChatResponse(
  args: BuildStreamingChatResponseArgs,
): Response {
  const {
    pump,
    chatRequestId,
    clientAttemptId,
    conversationId,
    userMessageId,
    costWarning,
    setCookieHeader,
    retrievalQuality,
    studioSnapshotAttached,
    attachmentGrounding,
    onPumpComplete,
  } = args;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let finalResult: PumpResult | undefined;
      try {
        let next = await pump.next();
        while (!next.done) {
          const event = next.value;
          controller.enqueue(encoder.encode(encodeWireEvent(event)));
          next = await pump.next();
        }
        finalResult = next.value;
      } catch (err) {
        // The pump is supposed to translate errors into wire events
        // and never throw. If it does, emit a generic error event so
        // the client doesn't hang. This is defense-in-depth.
        const fallback: WireEvent = {
          type: "error",
          category: "unknown_chat_failure",
          displayMessage: `Stream errored: ${(err as Error).message}`,
        };
        try {
          controller.enqueue(encoder.encode(encodeWireEvent(fallback)));
        } catch {
          // controller already closed — give up silently.
        }
      } finally {
        try {
          controller.close();
        } catch {
          // controller already in a final state — ignore.
        }
        if (onPumpComplete && finalResult) {
          try {
            onPumpComplete(finalResult);
          } catch {
            // Telemetry callback failures must not affect the response.
          }
        }
      }
    },
    cancel() {
      // Client closed the connection. Returning the generator's
      // remaining events to GC. The pump's abortSignal (passed by
      // the caller into the Anthropic stream request) handles the
      // upstream cancel; we just need to stop iterating here.
      pump.return(undefined as never).catch(() => {
        // pump.return throwing is fine; we're tearing down.
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      [CHAT_OUTBOUND_HTTP.CONTENT_TYPE]: "text/event-stream; charset=utf-8",
      // Disable proxy buffering so deltas reach the client promptly.
      // Documented by every major SSE deployment guide; some hosts
      // (nginx) need it explicitly.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
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
      [CHAT_ROUTE_HEADER.GROUNDING_STUDIO]: studioSnapshotAttached ? "1" : "0",
      [CHAT_ROUTE_HEADER.ATTACHMENT_GROUNDING]:
        attachmentGrounding.responseHeaderValue,
    },
  });
}
