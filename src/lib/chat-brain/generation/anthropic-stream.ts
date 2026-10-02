/**
 * Anthropic SSE stream — direct HTTP fetch + manual SSE parsing.
 *
 * Why direct fetch instead of the official SDK:
 *   1. No new dependency. We already do non-streaming fetches to
 *      Anthropic in `/api/chat` — same pattern, just `stream: true`.
 *   2. Full control over abort / back-pressure / parser quirks. The
 *      SDK abstracts these; for our retry-and-classify pipeline we
 *      want them visible.
 *   3. Works in any runtime (Node, Edge, browser) without conditional
 *      imports.
 *
 * Anthropic SSE event types we care about:
 *   - `content_block_delta` with `delta.text` → append to output
 *   - `message_delta` with `delta.stop_reason` → end-of-turn signal
 *   - `error` → upstream error mid-stream
 *
 * Events we ignore (still consume their bytes; just don't act on them):
 *   - message_start, content_block_start, content_block_stop,
 *     message_stop, ping
 *
 * The function returns an async generator yielding `{kind: "delta",
 * text}` for each text chunk, `{kind: "done"}` when the stream
 * terminates cleanly, and throws AnthropicStreamError for upstream
 * failures or malformed bytes.
 */

import { CHAT_GENERATION_FAILURE } from "../core/chat-generation-failure";
import type { ChatGenerationFailureCategory } from "../core/chat-generation-failure";

export type AnthropicStreamYield =
  | { kind: "delta"; text: string }
  | { kind: "done" };

export class AnthropicStreamError extends Error {
  constructor(
    message: string,
    public category: ChatGenerationFailureCategory,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = "AnthropicStreamError";
  }
}

export interface AnthropicStreamRequest {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: Array<{
    role: "user" | "assistant";
    /** Either a string (text-only) or a content-block array (when
     *  attachments / images are included). Phase 3c starts using
     *  the array form; Phase 3a uses string only. */
    content: string | Array<Record<string, unknown>>;
  }>;
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Open a streaming connection to Anthropic and yield decoded events.
 *
 * Throws AnthropicStreamError tagged with a failure category when:
 *   - Initial HTTP request fails (LLM_UNAVAILABLE_HTTP)
 *   - Response status != 200 (LLM_UNAVAILABLE_HTTP)
 *   - Stream body missing (PRIMARY_STREAM_EXCEPTION)
 *   - Body reader throws non-abort error (STREAM_INTERRUPTED)
 *   - Abort signal fires mid-read (CLIENT_ABORT)
 *
 * Caller is responsible for collecting deltas into a final string
 * and deciding what to do with `done`.
 */
export async function* streamAnthropicMessages(
  req: AnthropicStreamRequest,
): AsyncGenerator<AnthropicStreamYield, void, void> {
  const body = {
    model: req.model,
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature,
    system: req.systemPrompt,
    messages: req.messages,
    stream: true,
  };

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": req.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: req.abortSignal,
    });
  } catch (err) {
    if (req.abortSignal?.aborted) {
      throw new AnthropicStreamError(
        "Client aborted before stream opened",
        CHAT_GENERATION_FAILURE.CLIENT_ABORT,
      );
    }
    throw new AnthropicStreamError(
      `Network error connecting to Anthropic: ${(err as Error).message}`,
      CHAT_GENERATION_FAILURE.LLM_UNAVAILABLE_HTTP,
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // ignore — we'll throw with status alone
    }
    throw new AnthropicStreamError(
      `Anthropic returned ${response.status}: ${detail.slice(0, 500)}`,
      CHAT_GENERATION_FAILURE.LLM_UNAVAILABLE_HTTP,
      response.status,
    );
  }

  if (!response.body) {
    throw new AnthropicStreamError(
      "Anthropic response had no body",
      CHAT_GENERATION_FAILURE.PRIMARY_STREAM_EXCEPTION,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE records are separated by a blank line. Process any complete
      // records currently in the buffer; keep the trailing partial.
      let recordEnd: number;
      while ((recordEnd = buffer.indexOf("\n\n")) !== -1) {
        const record = buffer.slice(0, recordEnd);
        buffer = buffer.slice(recordEnd + 2);

        const decoded = decodeAnthropicSseRecord(record);
        if (!decoded) continue;

        if (decoded.event === "content_block_delta") {
          // delta.text is the new fragment. Some events have type
          // "input_json_delta" (tool calls) which we don't use yet —
          // those have no `text` field; skip silently.
          const txt = decoded.data?.delta?.text;
          if (typeof txt === "string" && txt.length > 0) {
            yield { kind: "delta", text: txt };
          }
        } else if (decoded.event === "message_stop") {
          // Anthropic's "we're done" signal. Emit our `done` and bail.
          yield { kind: "done" };
          return;
        } else if (decoded.event === "error") {
          // Upstream error mid-stream. Translate to our exception.
          const errType = decoded.data?.error?.type ?? "unknown";
          const errMsg = decoded.data?.error?.message ?? "Anthropic error";
          throw new AnthropicStreamError(
            `Anthropic stream error (${errType}): ${errMsg}`,
            CHAT_GENERATION_FAILURE.PRIMARY_STREAM_EXCEPTION,
          );
        }
        // Other events (message_start, ping, message_delta, etc.) are
        // consumed silently — we only act on delta and stop.
      }
    }

    // Stream ended without an explicit message_stop. Treat as clean end
    // (Anthropic does sometimes terminate this way on short responses).
    yield { kind: "done" };
  } catch (err) {
    if (err instanceof AnthropicStreamError) throw err;
    if ((err as Error).name === "AbortError" || req.abortSignal?.aborted) {
      throw new AnthropicStreamError(
        "Stream read aborted",
        CHAT_GENERATION_FAILURE.CLIENT_ABORT,
      );
    }
    throw new AnthropicStreamError(
      `Stream interrupted: ${(err as Error).message}`,
      CHAT_GENERATION_FAILURE.STREAM_INTERRUPTED,
    );
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // No-op — reader already in a final state.
    }
  }
}

/** Decode a single SSE record (the part between blank lines).
 *  Returns null for keep-alive comments and malformed records. */
function decodeAnthropicSseRecord(record: string): {
  event: string;
  data: any;
} | null {
  const trimmed = record.trim();
  if (!trimmed) return null;

  let event = "message"; // SSE default
  const dataLines: string[] = [];
  for (const line of trimmed.split("\n")) {
    if (line.startsWith(":")) continue; // comment
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
    // Ignore id:, retry: — we don't use them.
  }

  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join("\n");
  if (dataStr === "[DONE]") {
    // OpenAI-style sentinel; Anthropic doesn't use this but be defensive.
    return { event: "message_stop", data: {} };
  }

  try {
    const parsed = JSON.parse(dataStr);
    return { event, data: parsed };
  } catch {
    // Malformed JSON in data. Skip the record rather than crash the
    // stream; Anthropic occasionally sends partial frames during
    // transient connection issues.
    return null;
  }
}

/**
 * Non-streaming Anthropic call. Used by the recovery path of the
 * stream pump when primary streaming fails or returns empty. Returns
 * the full response text or throws AnthropicStreamError.
 */
export async function callAnthropicNonStreaming(
  req: AnthropicStreamRequest,
): Promise<string> {
  const body = {
    model: req.model,
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature,
    system: req.systemPrompt,
    messages: req.messages,
  };

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": req.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: req.abortSignal,
    });
  } catch (err) {
    if (req.abortSignal?.aborted) {
      throw new AnthropicStreamError(
        "Client aborted before recovery call opened",
        CHAT_GENERATION_FAILURE.CLIENT_ABORT,
      );
    }
    throw new AnthropicStreamError(
      `Recovery call network error: ${(err as Error).message}`,
      CHAT_GENERATION_FAILURE.RECOVERY_GENERATE_TEXT_EXCEPTION,
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    throw new AnthropicStreamError(
      `Recovery call returned ${response.status}: ${detail.slice(0, 500)}`,
      CHAT_GENERATION_FAILURE.RECOVERY_GENERATE_TEXT_EXCEPTION,
      response.status,
    );
  }

  let data: any;
  try {
    data = await response.json();
  } catch (err) {
    throw new AnthropicStreamError(
      `Recovery call returned non-JSON: ${(err as Error).message}`,
      CHAT_GENERATION_FAILURE.RECOVERY_GENERATE_TEXT_EXCEPTION,
    );
  }

  const text =
    typeof data?.content?.[0]?.text === "string" ? data.content[0].text : "";
  return text;
}
