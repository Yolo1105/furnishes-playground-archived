/**
 * /api/generate-asset — synchronous single-piece generation.
 *
 * Replaces the 503 stub with a real endpoint backed by Flux Schnell
 * (2D image) + a mesh provider (image-to-3D). Accepts a free-form
 * prompt, returns a GLB URL plus the intermediate 2D image and a
 * derived style bible for downstream use.
 *
 * Used by the chat-slice's "Generate Asset" mode (Turn 3 wiring).
 * The user types "a walnut mid-century armchair" in the chat, the
 * chat-slice POSTs to this route, the result drops into the
 * RecentGenerationsBar as a tile they can click to place.
 *
 * Flow:
 *   1. Client POSTs { prompt, tier? }
 *   2. Server asks Claude for a tiny PieceRequest + StyleBible JSON
 *      derived from the prompt (small ~512-token call, fast)
 *   3. Flux Schnell generates a 2D product-shot image
 *   4. Image-to-3D provider generates the GLB
 *   5. Response: { glb_url, image_url, prompt, piece, style, ... }
 *
 * This is a synchronous endpoint — the caller awaits the full pipeline.
 * Expected duration: 5-15s preview, 30-120s hero (Hunyuan Pro / Trellis 2).
 * `maxDuration: 180` (3 min). Meshy v6 as hero often needs longer.
 *
 * Auth + rate-limit: same shape as /api/generate-room. Lower limit
 * (12/hour) since each call is cheaper than a full room (~$0.05) but
 * still costs real money.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { generatePiece2D, buildPiecePrompt } from "@/lib/pipeline/style-anchor";
import { openArchiveRun } from "@/lib/pipeline/generation-archive";
import {
  getDefaultPreviewProvider,
  getDefaultHeroProvider,
} from "@/lib/providers";
import {
  StyleBibleZ,
  PieceRequestZ,
  type StyleBible,
  type PieceRequest,
} from "@/lib/director/schema";
import { BRAIN_ANTHROPIC_MODEL } from "@/lib/chat-brain/core/anthropic-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// ── Request schema ─────────────────────────────────────────────────────
//
// Two shapes accepted:
//
//   1. Chat path: { prompt, tier? } — the route derives piece + style
//      from the prompt via a small Claude call.
//
//   2. Programmatic path: { piece, style, tier?, seed? } — caller
//      passes a fully-formed PieceRequest + StyleBible (e.g. when
//      generating a piece in the same style as the current scene).

const PromptOnlyRequestZ = z.object({
  prompt: z.string().min(1).max(2000),
  tier: z.enum(["preview", "hero"]).default("preview"),
  seed: z.number().int().optional(),
  /** Optional reference image (data URL or HTTPS, capped at ~10MB).
   *  When present, Flux is skipped entirely and the reference is fed
   *  straight to the image-to-3D mesh provider — a faithful
   *  reconstruction of the user's photo as a 3D mesh. */
  referenceImageUrl: z.string().max(15_000_000).optional(),
});

const FullRequestZ = z.object({
  piece: PieceRequestZ,
  style: StyleBibleZ,
  tier: z.enum(["preview", "hero"]).default("preview"),
  seed: z.number().int().optional(),
  referenceImageUrl: z.string().max(15_000_000).optional(),
});

// ── Rate limiter ───────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 12; // ~$0.05 each — bounded but more permissive
// than full-room generation (8/hr).

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

// ── Claude helper for the prompt-only path ─────────────────────────────
//
// Asks Claude to produce a tiny `{ piece, style }` JSON for a
// free-form prompt like "a walnut mid-century armchair". Output is
// validated with Zod just like the orchestrator's main scene-graph
// call.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const PIECE_DERIVATION_PROMPT = `You translate a user's free-form request for a single piece of furniture or decor into a structured JSON descriptor.

Given the user prompt, produce:

{
  "piece": {
    "id": "p_<short-slug>",
    "category": "<one-word category like sofa, chair, table, lamp, rug, art>",
    "description": "<full descriptive prompt for image generation, including materials, color, style — typically 8-20 words>",
    "user_requested": true,
    "dimensions_hint": { "length": <m>, "width": <m>, "height": <m> }
  },
  "style": {
    "name": "<style name like 'mid-century modern', 'industrial', 'japandi'>",
    "palette": { "walls": "<hex>", "accent": "<hex>" },
    "materials": { "dominant_wood": "<wood>", "primary_textile": "<textile>", "metal": "<metal>" },
    "lighting": "warm-soft" | "cool-bright" | "dramatic" | "neutral",
    "mood": "<short mood phrase>",
    "forbidden": []
  }
}

Use realistic furniture dimensions. Length is the longest horizontal axis, width the shorter horizontal axis, height the vertical extent.

Return ONLY JSON. No markdown, no fences, no prose.`;

function stripFences(s: string): string {
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/m;
  const match = s.match(fence);
  return match ? match[1].trim() : s.trim();
}

async function deriveFromPrompt(
  userPrompt: string,
): Promise<{ piece: PieceRequest; style: StyleBible }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: BRAIN_ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: PIECE_DERIVATION_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Claude API returned ${response.status}: ${text.slice(0, 400)}`,
    );
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const raw = data.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();

  const clean = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(`Claude returned invalid JSON: ${clean.slice(0, 200)}…`);
  }

  const PieceDerivationZ = z.object({
    piece: PieceRequestZ,
    style: StyleBibleZ,
  });
  const result = PieceDerivationZ.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Piece derivation failed schema validation: ${result.error.message.slice(0, 400)}`,
    );
  }
  return result.data;
}

// ── POST handler ───────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Key gate.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured on this server" },
      { status: 503 },
    );
  }
  if (!process.env.FAL_KEY && !process.env.FAL_API_KEY) {
    return NextResponse.json(
      { error: "FAL_KEY not configured on this server" },
      { status: 503 },
    );
  }

  // Optional Supabase auth.
  const authHeader = req.headers.get("authorization");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseAnon) {
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnon, Authorization: authHeader },
    });
    if (!verifyRes.ok) {
      return NextResponse.json(
        { error: "Invalid session" },
        { status: 401 },
      );
    }
  }

  // Body parse.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Try the full request shape first, then fall back to prompt-only.
  // This lets programmatic callers pin exact piece + style, while
  // chat callers just pass a string.
  let piece: PieceRequest;
  let style: StyleBible;
  let tier: "preview" | "hero";
  let seed: number | undefined;
  let referenceImageUrl: string | undefined;

  const fullParse = FullRequestZ.safeParse(body);
  if (fullParse.success) {
    piece = fullParse.data.piece;
    style = fullParse.data.style;
    tier = fullParse.data.tier;
    seed = fullParse.data.seed;
    referenceImageUrl = fullParse.data.referenceImageUrl;
  } else {
    const promptParse = PromptOnlyRequestZ.safeParse(body);
    if (!promptParse.success) {
      return NextResponse.json(
        {
          error: `Invalid request: expected { prompt, tier? } or { piece, style, tier? }. Got: ${promptParse.error.message.slice(0, 200)}`,
        },
        { status: 400 },
      );
    }
    tier = promptParse.data.tier;
    seed = promptParse.data.seed;
    referenceImageUrl = promptParse.data.referenceImageUrl;
    try {
      const derived = await deriveFromPrompt(promptParse.data.prompt);
      piece = derived.piece;
      style = derived.style;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Rate limit (after parse so 400s don't burn quota).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rlKey = authHeader?.startsWith("Bearer ")
    ? `tok:${authHeader.slice(7, 47)}`
    : `ip:${ip}`;
  if (!rateLimitOk(rlKey)) {
    return NextResponse.json(
      { error: "Rate limit: 12 asset generations/hour" },
      { status: 429 },
    );
  }

  // Open a local archive run for this asset generation. Same model
  // as the room orchestrator — best-effort, never aborts the actual
  // pipeline. The user's prompt may be empty if the route was called
  // with a fully-formed piece+style; fall back to the piece label.
  const archive = await openArchiveRun({
    prompt: (piece as { description?: string })?.description ?? "(no prompt)",
    kind: "asset",
  });
  void archive.saveJson("piece.json", piece);
  void archive.saveJson("style.json", style);
  if (referenceImageUrl) {
    void archive.saveFromUrl("user_reference.bin", referenceImageUrl);
  }

  // Run the pipeline.
  try {
    // Step 1: 2D image. Two paths:
    //   - User attached a reference photo → skip Flux entirely. We
    //     feed the photo straight to the image-to-3D mesh provider.
    //     This produces a faithful reconstruction of the user's
    //     piece, not a stylized re-imagining of it.
    //   - No reference → Flux generates a styled product shot from
    //     the piece description (existing path).
    const imagePrompt = buildPiecePrompt(piece, style);
    const imageUrlForMesh: string = referenceImageUrl
      ? referenceImageUrl
      : (await generatePiece2D(piece, style)).url;
    // Archive the 2D before mesh generation runs — even if mesh fails
    // we still keep the Flux output.
    void archive.saveFromUrl("piece_2d.png", imageUrlForMesh);

    // Step 2: image-to-3D mesh.
    const provider =
      tier === "hero"
        ? getDefaultHeroProvider()
        : getDefaultPreviewProvider();
    const mesh = await provider.generate({
      image_url: imageUrlForMesh,
      tier,
      seed,
    });
    void archive.saveFromUrl("piece.glb", mesh.glb_url);

    return NextResponse.json({
      glb_url: mesh.glb_url,
      provider: mesh.provider,
      duration_ms: mesh.duration_ms,
      image_url: imageUrlForMesh,
      prompt: imagePrompt,
      piece,
      style,
      reference_image_used: Boolean(referenceImageUrl),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void archive.saveText("error.txt", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
