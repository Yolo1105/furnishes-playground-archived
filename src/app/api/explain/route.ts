import { NextResponse } from "next/server";
import { z } from "zod";
import { BRAIN_ANTHROPIC_MODEL } from "@/lib/chat-brain/core/anthropic-model";

// ──────────────────────────────────────────────────────────────────────────
// /api/explain — Phase F5: narrate the reasoning behind one candidate.
//
// Input shape:
//   {
//     candidate: { label, notes, moves },
//     furniture: Array<{id, label, width, depth, x, z, rotation}>,
//     bounds:    {minX, maxX, minZ, maxZ} | null,
//     requirements: { ...full requirements snapshot },
//   }
//
// Output shape:
//   {
//     summary:   string,                // 2-3 sentence headline
//     principles: Array<{title, body}>, // 3-5 design principles applied
//     tradeoffs:  Array<{title, body}>, // 1-3 trade-offs the AI made
//     suggestions: string[],            // optional follow-up directions
//   }
//
// Same rate limit + Supabase auth gating as other AI routes.
// ──────────────────────────────────────────────────────────────────────────

const requestLog = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 20;

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

const ExplainResponseZ = z.object({
  summary: z.string().min(10).max(500),
  principles: z
    .array(
      z.object({
        title: z.string().min(2).max(80),
        body: z.string().min(10).max(400),
      }),
    )
    .min(1)
    .max(6),
  tradeoffs: z
    .array(
      z.object({
        title: z.string().min(2).max(80),
        body: z.string().min(10).max(400),
      }),
    )
    .max(4)
    .default([]),
  suggestions: z.array(z.string().min(5).max(200)).max(5).default([]),
});

const SYSTEM_PROMPT = `You are an interior-design AI explaining the reasoning behind a furniture
arrangement candidate to its designer. The user has just generated this
candidate; they want to understand WHY it works (or doesn't) given their
stated requirements.

RESPONSE FORMAT (strict — return only this JSON, no other text):
{
  "summary": "<2-3 sentence headline>",
  "principles": [
    {"title": "<short principle name>", "body": "<2-4 sentence explanation>"}
  ],
  "tradeoffs": [
    {"title": "<short trade-off name>", "body": "<2-4 sentence explanation>"}
  ],
  "suggestions": ["<short follow-up direction>", ...]
}

GUIDANCE:
- summary: capture the layout's design philosophy in plain language. The
  user should be able to read just this and grasp the candidate's identity.
- principles: 3-5 design principles this layout applies. Each title is
  short (e.g. "Conversation triangle", "Cross-room sightline", "Walking
  perimeter"); each body explains how this candidate embodies it
  concretely, referencing specific items where helpful.
- tradeoffs: 1-3 honest compromises. What did this layout give up to
  achieve its identity? Don't be defensive — the user values truth.
- suggestions: 0-3 follow-up directions. "Want it warmer? Try…" or "If
  you'd swap X for Y, this layout becomes…". Keep them short and
  actionable.
- Reference items by their human label (e.g. "the sofa", "the dining
  table"), not by id. The user thinks in items, not IDs.

Return ONLY the JSON object. No prose, no markdown, no code fences.`;

export const maxDuration = 60;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI assistant is not configured on this server" },
      { status: 503 },
    );
  }

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
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }
  }

  const body = await req.json();
  const { candidate, furniture, bounds, requirements } = body ?? {};
  if (!candidate || !candidate.label || !Array.isArray(candidate.moves)) {
    return NextResponse.json(
      { error: "Missing candidate" },
      { status: 400 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rlKey = authHeader?.startsWith("Bearer ")
    ? `tok:${authHeader.slice(7, 47)}`
    : `ip:${ip}`;
  if (!rateLimitOk(rlKey)) {
    return NextResponse.json(
      { error: "Rate limit: 20 requests/hour" },
      { status: 429 },
    );
  }

  const itemsText = (
    furniture as Array<{
      id: string;
      label: string;
      width: number;
      depth: number;
      x: number;
      z: number;
      rotation: number;
    }>
  )
    .map(
      (f) =>
        `  ${f.id} · ${f.label} · ${f.width.toFixed(2)}×${f.depth.toFixed(2)}m · current at (${f.x.toFixed(2)}, ${f.z.toFixed(2)}, rot ${f.rotation}°)`,
    )
    .join("\n");

  const movesText = (
    candidate.moves as Array<{ id: string; x: number; z: number; rotation: number }>
  )
    .map(
      (m) => `  ${m.id} → (${m.x.toFixed(2)}, ${m.z.toFixed(2)}, rot ${m.rotation}°)`,
    )
    .join("\n");

  const reqText = requirements
    ? JSON.stringify(requirements, null, 2)
    : "(none provided)";
  const boundsText = bounds
    ? `Bounds: minX=${bounds.minX.toFixed(2)}, maxX=${bounds.maxX.toFixed(2)}, minZ=${bounds.minZ.toFixed(2)}, maxZ=${bounds.maxZ.toFixed(2)}`
    : "Bounds: not provided";

  const userPayload = [
    `Explain this candidate.`,
    "",
    `Candidate: "${candidate.label}"`,
    `Notes: ${candidate.notes ?? "(none)"}`,
    "",
    "Current scene items:",
    itemsText,
    "",
    "Proposed moves (item id → new (x, z, rotation)):",
    movesText || "(no moves — this candidate proposes keeping the layout)",
    "",
    boundsText,
    "",
    `Requirements: ${reqText}`,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: BRAIN_ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPayload }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json(
      { error: `Upstream: ${res.status} ${err}` },
      { status: 502 },
    );
  }
  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? "";

  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json(
      { error: "Model did not return valid JSON", raw: text.slice(0, 500) },
      { status: 502 },
    );
  }
  const validation = ExplainResponseZ.safeParse(parsed);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Schema mismatch", issues: validation.error.issues },
      { status: 502 },
    );
  }
  return NextResponse.json(validation.data);
}
