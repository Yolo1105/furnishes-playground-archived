/**
 * SSE stream consumer for /api/generate-room.
 *
 * Wraps the fetch + ReadableStream + parseSSE plumbing into an async
 * generator that yields validated StreamEvents. Retries on transient
 * connection failures (before any events have arrived) with exponential
 * backoff: 500ms → 1500ms → 4000ms, max 3 attempts.
 *
 * After the stream has started yielding events we do NOT retry — at
 * that point partial state is visible to the UI (placeholder boxes
 * rendered, status bubbles posted) and a retry would duplicate work
 * or confuse the user. The orchestrator emits per-piece error events
 * for in-stream failures; only connection-level failures are retried.
 *
 * Threading the abort signal:
 *   - Caller passes opts.signal (typically tied to a "Stop" button)
 *   - We forward it to fetch() so cancellation propagates to the
 *     server, which threads it through to the orchestrator, which
 *     stops scheduling new fal.ai work
 *   - We also wire it into the retry sleep so a Stop click during
 *     backoff exits cleanly instead of waiting out the delay
 *
 * Usage:
 *
 *     const ctl = new AbortController();
 *     for await (const event of startDesignStream({ prompt, signal: ctl.signal })) {
 *       switch (event.kind) { ... }
 *     }
 */

import { StreamEventZ, type StreamEvent } from "./schema";
import { createSSEParser } from "@studio/utils/parseSSE";
import type { SgHdbProfile } from "@studio/profiles/sg-hdb";
import { getAuthHeaders } from "@studio/client/auth-headers";

export interface DesignStreamOptions {
  prompt: string;
  quality?: "preview" | "hero";
  skipStyleAnchor?: boolean;
  /** When true, the orchestrator skips per-piece mesh generation —
   *  used by Room Layout chat mode. Server returns the layout in
   *  ~5–15s; pieces ship without GLBs and render as placeholder
   *  boxes. See orchestrator.ts OrchestratorOptions for details. */
  skipPieceMeshes?: boolean;
  /** Optional reference image (data URL or HTTPS). When present,
   *  /api/generate-room threads it through to the orchestrator,
   *  which uses it as the scene's reference_image_url AND feeds it
   *  to Claude as a vision input so the StyleBible matches the
   *  reference's look. */
  referenceImageUrl?: string;
  /** v0.40.37: optional Singapore HDB profile. Threaded through to
   *  the orchestrator so room dimensions + architecture come from
   *  the HDB spec instead of Claude's invention. */
  profile?: SgHdbProfile;
  signal?: AbortSignal;
  /** Max retry attempts on transient connection failure. Default 3. */
  maxRetries?: number;
}

const RETRY_DELAYS_MS = [500, 1500, 4000];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
      };
      // If already aborted, fire immediately.
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort);
      }
    }
  });
}

async function connect(opts: DesignStreamOptions): Promise<Response> {
  const res = await fetch("/api/generate-room", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // v0.40.48: forward the Supabase Bearer token. Without this,
      // every Room Layout generation 401's against the auth-gated
      // route. Was missing since the route was added; the user
      // reported it as "Furniture and Room Layout both result in
      // an error page." getAuthHeaders() returns {} when not
      // signed in, so unauth'd dev environments still work.
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      prompt: opts.prompt,
      quality: opts.quality ?? "preview",
      skipStyleAnchor: opts.skipStyleAnchor ?? false,
      skipPieceMeshes: opts.skipPieceMeshes ?? false,
      referenceImageUrl: opts.referenceImageUrl,
      profile: opts.profile,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Stream failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }

  return res;
}

/** Consume the SSE stream as an async generator of StreamEvents. */
export async function* startDesignStream(
  opts: DesignStreamOptions,
): AsyncGenerator<StreamEvent, void, unknown> {
  const maxRetries = opts.maxRetries ?? 3;
  let attempt = 0;
  let res: Response | null = null;
  let lastError: Error | null = null;

  // ── Connect with retry/backoff ───────────────────────────────────
  while (attempt <= maxRetries) {
    try {
      res = await connect(opts);
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // User aborted — surface immediately, never retry.
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      // Out of retries — surface the last error.
      if (attempt >= maxRetries) {
        throw lastError;
      }
      // Tell the UI we're retrying so the chat dock shows a stage
      // hint instead of looking frozen.
      yield {
        kind: "progress",
        stage: "reconnecting",
        detail: `Reconnecting attempt ${attempt + 1} of ${maxRetries}…`,
      };
      const delay = RETRY_DELAYS_MS[attempt] ?? 4000;
      try {
        await sleep(delay, opts.signal);
      } catch {
        // Aborted during the delay — surface the original error.
        throw lastError;
      }
      attempt++;
    }
  }

  if (!res || !res.body) {
    throw lastError ?? new Error("Stream unavailable");
  }

  // ── Read + parse the body ────────────────────────────────────────
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser<unknown>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const events = parser.feed(chunk);
      for (const raw of events) {
        // Validate at the consumer boundary. This is defense in depth
        // — the orchestrator validates before emitting, but a bad
        // proxy or middleware could mangle bytes and we want a single
        // chokepoint that throws-or-yields-clean.
        const parsed = StreamEventZ.safeParse(raw);
        if (parsed.success) {
          yield parsed.data;
        } else {
          // Surface as a progress event rather than throwing — a
          // single malformed event shouldn't kill the whole stream.
          yield {
            kind: "progress",
            stage: "unknown",
            detail: `Unparseable event: ${parsed.error.message.slice(0, 100)}`,
          };
        }
      }
    }
    // Flush any final buffered event (rare — SSE responses normally
    // end with the [DONE] terminator + blank line).
    for (const raw of parser.flush()) {
      const parsed = StreamEventZ.safeParse(raw);
      if (parsed.success) yield parsed.data;
    }
  } finally {
    reader.releaseLock();
  }
}
