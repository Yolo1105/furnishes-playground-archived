/**
 * /api/conversations/[id]/messages
 *
 *   GET  → list messages oldest-first
 *   POST → append a message (one row = one round-trip; user_text +
 *          response captured together, mirroring ConversationTurn)
 *
 * The conversation's `updated_at` auto-bumps via the BEFORE UPDATE
 * trigger declared in the migration when a write touches the parent
 * row. POST also explicitly bumps the parent so the dropdown's
 * "most recent first" sort reflects new activity.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readSupabaseConfig,
  verifySupabaseUser,
  pgSelect,
  pgInsert,
  pgUpdate,
} from "@/lib/persistence/supabase-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MessageRow {
  id: string;
  conversation_id: string;
  user_text: string;
  response: string;
  display_time: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  position_hint: number;
}

// ── GET ───────────────────────────────────────────────────────────────

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  // RLS scopes to the user's own conversations; this filter gets us
  // just the requested thread.
  const query = `select=*&conversation_id=eq.${encodeURIComponent(id)}&order=created_at.asc,position_hint.asc`;
  try {
    const rows = await pgSelect<MessageRow>(cfg, "messages", query);
    return NextResponse.json({ messages: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "select failed" },
      { status: 500 },
    );
  }
}

// ── POST ──────────────────────────────────────────────────────────────

const AppendRequestZ = z.object({
  /** Client-generated message id ("msg_<base36>_<rand>"). */
  id: z.string().min(1).max(120),
  userText: z.string().max(20_000).default(""),
  response: z.string().max(20_000).default(""),
  displayTime: z.string().max(40).default(""),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const parsed = AppendRequestZ.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.message.slice(0, 300) },
      { status: 400 },
    );
  }

  const { id: convoId } = await params;
  try {
    const inserted = await pgInsert<MessageRow>(cfg, "messages", {
      id: parsed.data.id,
      conversation_id: convoId,
      user_text: parsed.data.userText,
      response: parsed.data.response,
      display_time: parsed.data.displayTime,
      metadata: parsed.data.metadata ?? null,
    });

    // Bump parent so the dropdown's most-recent-first sort reflects
    // this new activity. Don't fail the response if this bump
    // hiccups — the message itself is what matters.
    try {
      await pgUpdate(cfg, "conversations", `id=eq.${encodeURIComponent(convoId)}`, {
        // Setting updated_at to now() works because the trigger
        // also fires on update; we send a sentinel so PostgREST
        // accepts the body.
        updated_at: new Date().toISOString(),
      });
    } catch {
      // best-effort
    }

    return NextResponse.json({ message: inserted[0] }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "insert failed" },
      { status: 500 },
    );
  }
}
