/**
 * /api/conversations
 *
 *   GET  /api/conversations?projectId=<id>  → list conversations
 *   POST /api/conversations                 → create one
 *
 * Both require the user to be signed in via Supabase (Bearer token).
 * When Supabase isn't configured at all, both return 503 — the
 * client treats that as "fall back to local-only persistence".
 *
 * Schema (row shape on the wire):
 *   { id, user_id, project_id, title, created_at, updated_at }
 *
 * The `id` is generated client-side ("convo_<base36>_<rand>") so the
 * client doesn't need to wait for a server roundtrip to know the id —
 * it writes locally first, then fires-and-forgets the server insert.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readSupabaseConfig,
  verifySupabaseUser,
  pgSelect,
  pgInsert,
} from "@/lib/persistence/supabase-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConversationRow {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

// ── GET ───────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const cfg = readSupabaseConfig(req);
  if (!cfg) {
    return NextResponse.json(
      { error: "Server-side persistence not configured" },
      { status: 503 },
    );
  }

  const userId = await verifySupabaseUser(cfg);
  if (!userId) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json(
      { error: "Missing projectId" },
      { status: 400 },
    );
  }

  // RLS already restricts to user's own rows; we only filter by
  // project_id here. Sort by updated_at desc so the dropdown
  // pre-orders by recency without client-side sort.
  const query = `select=*&project_id=eq.${encodeURIComponent(projectId)}&order=updated_at.desc`;
  try {
    const rows = await pgSelect<ConversationRow>(cfg, "conversations", query);
    return NextResponse.json({ conversations: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "select failed" },
      { status: 500 },
    );
  }
}

// ── POST ──────────────────────────────────────────────────────────────

const CreateRequestZ = z.object({
  /** Client-generated ID — `convo_<base36>_<rand>`. The server uses
   *  this as the row primary key so subsequent local writes match
   *  without an id rewrite. */
  id: z.string().min(1).max(120),
  projectId: z.string().min(1).max(120),
  title: z.string().min(1).max(200).default("Conversation 1"),
});

export async function POST(req: Request) {
  const cfg = readSupabaseConfig(req);
  if (!cfg) {
    return NextResponse.json(
      { error: "Server-side persistence not configured" },
      { status: 503 },
    );
  }

  const userId = await verifySupabaseUser(cfg);
  if (!userId) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = CreateRequestZ.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.message.slice(0, 300) },
      { status: 400 },
    );
  }

  try {
    const inserted = await pgInsert<ConversationRow>(cfg, "conversations", {
      id: parsed.data.id,
      user_id: userId,
      project_id: parsed.data.projectId,
      title: parsed.data.title,
    });
    return NextResponse.json({ conversation: inserted[0] }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "insert failed" },
      { status: 500 },
    );
  }
}
