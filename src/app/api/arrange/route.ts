import { NextResponse } from "next/server";
import { z } from "zod";
import { ARRANGE_SYSTEM_PROMPT } from "@/lib/ai/arrangePrompt";
import { BRAIN_ANTHROPIC_MODEL } from "@/lib/chat-brain/core/anthropic-model";

// ──────────────────────────────────────────────────────────────────────────
// /api/arrange — Phase E1: real Claude call producing K layout candidates.
//
// Input shape:
//   {
//     furniture: Array<{ id, label, width, depth, x, z, rotation }>,
//     bounds:    { minX, maxX, minZ, maxZ } | null,
//     requirements: { mustInclude, optionalInclude, walkwayMinCm, ... },
//     k: number,  // desired candidate count (default 3, max 5)
//   }
//
// Output shape:
//   {
//     candidates: Array<{
//       label: string,
//       notes: string,
//       moves: Array<{ id, x, z, rotation }>,
//     }>
//   }
//
// Rate limiting + Supabase auth gating mirror /api/chat. Each route gets
// its own quota Map so a chat-heavy session doesn't lock out arrangements.
// Both have 20/hr ceilings.
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

const MoveZ = z.object({
  id: z.string(),
  x: z.number(),
  z: z.number(),
  rotation: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
});

const CandidateZ = z.object({
  label: z.string().min(1).max(60),
  notes: z.string().min(1).max(280),
  moves: z.array(MoveZ).max(40),
});

const CandidatesResponseZ = z.object({
  candidates: z.array(CandidateZ).min(1).max(5),
});

export const maxDuration = 90;

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
  const { furniture, lockedFurniture, bounds, requirements, k } = body ?? {};
  if (!Array.isArray(furniture) || furniture.length === 0) {
    return NextResponse.json(
      { error: "Missing furniture list" },
      { status: 400 },
    );
  }
  const candidateCount = Math.max(1, Math.min(5, Number(k) || 3));

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

  const items = (
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
        `  ${f.id} · ${f.label} · ${f.width.toFixed(2)}×${f.depth.toFixed(2)}m · at (x=${f.x.toFixed(2)}, z=${f.z.toFixed(2)}, rot=${f.rotation}°)`,
    )
    .join("\n");

  // Locked items: passed in alongside furniture but live in their own
  // payload block so the prompt's instruction "DO NOT propose moves
  // for these" sticks. The validation step also strips any moves
  // referencing locked ids defensively.
  const lockedArr = Array.isArray(lockedFurniture)
    ? (lockedFurniture as Array<{
        id: string;
        label: string;
        width: number;
        depth: number;
        x: number;
        z: number;
        rotation: number;
      }>)
    : [];
  const lockedItemsBlock =
    lockedArr.length === 0
      ? "(none locked)"
      : lockedArr
          .map(
            (f) =>
              `  ${f.id} · ${f.label} · at (x=${f.x.toFixed(2)}, z=${f.z.toFixed(2)}, rot=${f.rotation}°)`,
          )
          .join("\n");
  const lockedIdSet = new Set(lockedArr.map((f) => f.id));

  const boundsText = bounds
    ? `Room bounds: minX=${bounds.minX.toFixed(2)}, maxX=${bounds.maxX.toFixed(2)}, minZ=${bounds.minZ.toFixed(2)}, maxZ=${bounds.maxZ.toFixed(2)}`
    : "Room bounds: not provided";

  const reqText = requirements
    ? `Requirements:\n${JSON.stringify(requirements, null, 2)}`
    : "Requirements: defaults";

  const userPayload = [
    `Generate ${candidateCount} distinct furniture-arrangement candidates.`,
    "",
    "Current scene (movable items):",
    items,
    "",
    "Locked items (DO NOT propose moves for these — they are pinned in place; reason about them as fixed obstacles):",
    lockedItemsBlock,
    "",
    boundsText,
    "",
    reqText,
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
      max_tokens: 4096,
      system: ARRANGE_SYSTEM_PROMPT,
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
      {
        error: "Model did not return valid JSON",
        raw: text.slice(0, 500),
      },
      { status: 502 },
    );
  }
  const validation = CandidatesResponseZ.safeParse(parsed);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Schema mismatch", issues: validation.error.issues },
      { status: 502 },
    );
  }

  // Defense-in-depth: if Claude proposed moves for locked items
  // (against the prompt's instructions), filter them out here so
  // the client never has to deal with them. The OptionsTab applier
  // also guards on item.locked, but stripping at the route boundary
  // means InspectTab's diff doesn't show false "this would move"
  // signals for locked items.
  const sanitized = {
    candidates: validation.data.candidates.map((c) => ({
      ...c,
      moves: c.moves.filter((m) => !lockedIdSet.has(m.id)),
    })),
  };
  return NextResponse.json(sanitized);
}
