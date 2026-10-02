/**
 * /api/conversations/[id]
 *
 *   PATCH  → rename (body: { title })
 *   DELETE → delete
 *
 * Messages live under /api/conversations/[id]/messages.
 *
 * All operations are RLS-gated — the user can only touch their own
 * rows. We don't even pass user_id; PostgREST + the Bearer token
 * handle the scope.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readSupabaseConfig,
  verifySupabaseUser,
  pgUpdate,
  pgDelete,
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

const RenameRequestZ = z.object({
  title: z.string().min(1).max(200),
});

// ── PATCH ─────────────────────────────────────────────────────────────

export async function PATCH(
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
  const parsed = RenameRequestZ.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.message.slice(0, 300) },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    const rows = await pgUpdate<ConversationRow>(
      cfg,
      "conversations",
      `id=eq.${encodeURIComponent(id)}`,
      { title: parsed.data.title },
    );
    if (rows.length === 0) {
      // Either the row doesn't exist or RLS hid it — same response
      // either way (don't disclose which to anonymous probers).
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ conversation: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 500 },
    );
  }
}

// ── DELETE ────────────────────────────────────────────────────────────

export async function DELETE(
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
  try {
    // ON DELETE CASCADE on the messages table fk drops messages
    // automatically.
    await pgDelete(cfg, "conversations", `id=eq.${encodeURIComponent(id)}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
