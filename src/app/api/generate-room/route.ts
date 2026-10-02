/**
 * /api/generate-room — SSE-streamed whole-room generation.
 *
 * Replaces the 503 stub with a real endpoint backed by the Turn 2
 * orchestrator. Accepts a prompt + options, streams StreamEvents back
 * to the client until the generation is complete or aborted.
 *
 * Used by the chat-slice's "Generate Room" mode (Turn 3 wiring).
 *
 * Flow:
 *   1. Client POSTs { prompt, quality, skipStyleAnchor, maxConcurrency }
 *   2. Server runs `runOrchestrator` which yields StreamEvents
 *   3. Each event is serialized as `data: <json>\n\n` (SSE format)
 *   4. Client's `startDesignStream` (Turn 3) consumes via parseSSE
 *
 * Event sequence (happy path):
 *   intent → style → layout → piece_ready (×N) → scene → [DONE]
 *
 * The response is held open for the duration of the generation
 * (typically 1-5 minutes). `maxDuration: 300` (5 min) — past that,
 * Vercel kills the response anyway.
 *
 * Auth + rate-limit: same pattern as /api/chat. Optional Supabase
 * gating, in-memory rate limit at 8 generations/hour per key (lower
 * than chat's 20 because each generation is much more expensive).
 */

import { runOrchestrator } from "@/lib/pipeline/orchestrator";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ── Request schema ─────────────────────────────────────────────────────

const SgHdbProfileZ = z
  .object({
    kind: z.literal("sg-hdb"),
    flatType: z.enum(["3-room", "4-room", "5-room"]),
    room: z.enum([
      "master_bedroom",
      "common_bedroom_1",
      "common_bedroom_2",
      "living_dining",
      "kitchen",
    ]),
  })
  .optional();

const RequestZ = z.object({
  prompt: z.string().min(1).max(2000),
  quality: z.enum(["preview", "hero"]).default("preview"),
  skipStyleAnchor: z.boolean().default(false),
  /** When true, the orchestrator returns the layout without
   *  generating per-piece 3D meshes. Pieces ship as placeholder
   *  boxes (no glb_url). Used by Room Layout chat mode where the
   *  deliverable is the floor plan, not the meshes — much faster
   *  (~5–15s instead of 60+s) and zero fal.ai mesh-gen spend. */
  skipPieceMeshes: z.boolean().default(false),
  maxConcurrency: z.number().int().min(1).max(5).default(3),
  referenceImageUrl: z.string().max(15_000_000).optional(),
  /** Singapore HDB profile — forwarded to the orchestrator. */
  profile: SgHdbProfileZ,
});

// ── Rate limiter (same shape as /api/chat) ─────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 8; // Per-hour generations per key — lower than
// chat's 20 because each generation costs ~$0.20+ and runs for minutes.

const requestLog = new Map<string, number[]>();

function rateLimitOk(clientId: string): boolean {
  const now = Date.now();
  const hits = (requestLog.get(clientId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (hits.length >= RATE_LIMIT_MAX) return false;
  hits.push(now);
  requestLog.set(clientId, hits);
  return true;
}

// ── SSE formatter ──────────────────────────────────────────────────────

function sseFormat(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ── POST handler ───────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Key gate first — fail fast if Anthropic isn't configured.
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "ANTHROPIC_API_KEY not configured on this server",
      }),
      {
        status: 503,
        headers: { "content-type": "application/json" },
      },
    );
  }

  // Optional Supabase auth gating, identical pattern to /api/chat.
  const authHeader = req.headers.get("authorization");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseAnon) {
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not signed in" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnon, Authorization: authHeader },
    });
    if (!verifyRes.ok) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
  }

  // Body parse + Zod validate.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const parsed = RequestZ.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: `Invalid request: ${parsed.error.message.slice(0, 300)}`,
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  // Rate limit (same key derivation as /api/chat).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rlKey = authHeader?.startsWith("Bearer ")
    ? `tok:${authHeader.slice(7, 47)}`
    : `ip:${ip}`;
  if (!rateLimitOk(rlKey)) {
    return new Response(
      JSON.stringify({ error: "Rate limit: 8 generations/hour" }),
      { status: 429, headers: { "content-type": "application/json" } },
    );
  }

  const {
    prompt,
    quality,
    skipStyleAnchor,
    skipPieceMeshes,
    maxConcurrency,
    referenceImageUrl,
    profile,
  } = parsed.data;

  // Wire the client's abort signal through to the orchestrator. When
  // the user clicks the Stop button (Turn 3), the fetch aborts, this
  // request signal fires, and the orchestrator's signal aborts —
  // Promise.allSettled inside the per-piece loop completes the
  // in-flight pieces but the outer loop bails on the next iteration
  // check. fal.ai calls in-flight will continue to charge until they
  // complete (we can't abort fal.ai mid-call), but no further work
  // starts.
  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort());

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runOrchestrator({
          prompt,
          quality,
          skipStyleAnchor,
          skipPieceMeshes,
          maxConcurrency,
          referenceImageUrl,
          profile,
          signal: abortController.signal,
        })) {
          if (abortController.signal.aborted) break;
          controller.enqueue(encoder.encode(sseFormat(event)));
        }
        // SSE convention — terminator that consumers can recognize.
        // Our parseSSE filters this out so it never surfaces as an
        // event to the client code.
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        // The orchestrator should never throw (it converts every
        // error into a `kind: "error"` event), but defensively
        // catch anyway in case some unexpected code path slips
        // through. Emit one error event then close.
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(sseFormat({ kind: "error", message: msg })),
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Browser closed the stream — propagate abort.
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Disable nginx's response buffering so SSE chunks ship
      // immediately, not in 4KB batches.
      "x-accel-buffering": "no",
    },
  });
}
