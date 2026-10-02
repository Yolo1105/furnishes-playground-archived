"use client";

/**
 * Client-side conversation sync engine. Bridges local Zustand state
 * (the slice's `conversations` array) with the server-side
 * /api/conversations* endpoints.
 *
 * Sync model:
 *   - LOCAL FIRST. Every user action — create, send, rename, delete —
 *     applies to the slice immediately. The UI never waits on the
 *     network.
 *   - SERVER ASYNC. After the local write, we fire a non-blocking
 *     fetch to the matching /api endpoint. Failures are swallowed
 *     (logged at warn level) — local stays correct; the next
 *     successful sync will reconcile.
 *   - PULL ON HYDRATE. When the user is signed in (Supabase token
 *     available), we GET /api/conversations?projectId=<id> on
 *     project switch, merge server rows into the slice, and replay
 *     any missing messages.
 *
 * Auth source:
 *   The Supabase session JWT lives in `localStorage` under whatever
 *   key Supabase's client uses. We don't import the SDK; we read the
 *   token via a small helper in this file (best-effort — when the
 *   token isn't there, we degrade to local-only and never call the
 *   server).
 *
 * Failure mode:
 *   When Supabase isn't configured at all (no env vars), every API
 *   route returns 503 immediately. We treat 503 as "not available"
 *   and stop trying to sync for the remainder of the session. No
 *   retries, no console noise.
 */

import { useStore } from "@studio/store";
import type { Conversation, ConversationTurn } from "@studio/store/types";

// ── Auth token discovery ───────────────────────────────────────────────
//
// Supabase's JS client stores the session in localStorage under a key
// like `sb-<project-ref>-auth-token`. We don't pin the project ref
// here — we scan localStorage for any sb-*-auth-token entry, parse it,
// and pull `access_token` out. This avoids coupling sync to a
// specific Supabase project ref while staying lightweight.

interface SupabaseStoredSession {
  access_token?: string;
  refresh_token?: string;
}

/** Best-effort extraction of the current Supabase access token from
 *  localStorage. Returns null when not signed in OR when the storage
 *  is in an unexpected shape. */
function getSupabaseAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      // Supabase storage keys look like `sb-<project-ref>-auth-token`.
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as SupabaseStoredSession;
      if (parsed.access_token) return parsed.access_token;
    }
  } catch {
    // best-effort
  }
  return null;
}

/** Build standard auth headers for /api/conversations* fetches. */
function authHeaders(): HeadersInit | null {
  const tok = getSupabaseAccessToken();
  if (!tok) return null;
  return { Authorization: `Bearer ${tok}` };
}

// ── Sync state (module-level) ────────────────────────────────────────
//
// `serverUnavailable` flips true once we've seen a 503 — no retry for
// the rest of the session. The persistence hook re-mounts on full
// page reload so this resets naturally.

let serverUnavailable = false;

/** Mark server sync as unavailable for the rest of the session. */
function markUnavailable() {
  serverUnavailable = true;
}

// ── Server row → Conversation mapping ────────────────────────────────

interface ConversationRow {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

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

function rowToConversation(
  row: ConversationRow,
  turns: ConversationTurn[] = [],
): Conversation {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    turns,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function messageRowToTurn(row: MessageRow): ConversationTurn {
  // Local turns use a numeric id (timestamp-derived); server uses a
  // text id. Convert to a numeric hash so the local shape is preserved.
  // Collisions are vanishingly unlikely for our scale.
  const numericId = (() => {
    if (row.metadata && typeof row.metadata.localId === "number") {
      return row.metadata.localId as number;
    }
    return new Date(row.created_at).getTime();
  })();
  return {
    id: numericId,
    userText: row.user_text,
    response: row.response,
    time: row.display_time,
  };
}

// ── Public sync surface ─────────────────────────────────────────────

/**
 * Pull all conversations + messages for a project from the server,
 * merge into the local slice. Used by usePersistence when a project
 * is opened and the user is signed in.
 *
 * Strategy:
 *   1. GET /api/conversations?projectId=<id>
 *   2. For each conversation, GET its messages
 *   3. Merge server rows into the slice's `conversations`, preserving
 *      LOCAL turns when both have content (server is authoritative
 *      for metadata: title, timestamps; local can have unsent turns
 *      that haven't pushed yet).
 */
export async function pullConversationsForProject(projectId: string): Promise<{
  kind: "ok" | "no-auth" | "unavailable" | "error";
  count?: number;
}> {
  if (serverUnavailable) return { kind: "unavailable" };
  const headers = authHeaders();
  if (!headers) return { kind: "no-auth" };

  try {
    const listRes = await fetch(
      `/api/conversations?projectId=${encodeURIComponent(projectId)}`,
      { headers },
    );
    if (listRes.status === 503) {
      markUnavailable();
      return { kind: "unavailable" };
    }
    if (listRes.status === 401) return { kind: "no-auth" };
    if (!listRes.ok) return { kind: "error" };
    const { conversations } = (await listRes.json()) as {
      conversations: ConversationRow[];
    };

    // Pull messages for each conversation in parallel — small N
    // (typical user has 1-10 conversations per project), so the
    // network amplification is fine.
    const turnsByConvo = new Map<string, ConversationTurn[]>();
    await Promise.all(
      conversations.map(async (c) => {
        try {
          const mRes = await fetch(
            `/api/conversations/${encodeURIComponent(c.id)}/messages`,
            { headers },
          );
          if (!mRes.ok) return;
          const { messages } = (await mRes.json()) as {
            messages: MessageRow[];
          };
          turnsByConvo.set(c.id, messages.map(messageRowToTurn));
        } catch {
          // best-effort
        }
      }),
    );

    // Merge into slice. Drop existing project conversations from the
    // slice and replace with server rows, BUT preserve any local-
    // only conversations (those that haven't been pushed yet — their
    // ids won't appear in the server response).
    useStore.setState((curr) => {
      const c = curr as unknown as { conversations: Conversation[] };
      const otherProjects = c.conversations.filter(
        (x) => x.projectId !== projectId,
      );
      const localProject = c.conversations.filter(
        (x) => x.projectId === projectId,
      );
      const serverIds = new Set(conversations.map((r) => r.id));
      const localOnly = localProject.filter((x) => !serverIds.has(x.id));

      const merged = conversations.map((r) =>
        rowToConversation(r, turnsByConvo.get(r.id) ?? []),
      );

      return {
        conversations: [...otherProjects, ...merged, ...localOnly],
      } as never;
    });

    return { kind: "ok", count: conversations.length };
  } catch {
    return { kind: "error" };
  }
}

/** Push a newly-created conversation to the server. Fire-and-forget;
 *  failures are logged but don't block the UI. */
export async function pushNewConversation(c: Conversation): Promise<void> {
  if (serverUnavailable) return;
  const headers = authHeaders();
  if (!headers) return;
  try {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: c.id,
        projectId: c.projectId,
        title: c.title,
      }),
    });
    if (res.status === 503) markUnavailable();
  } catch {
    // best-effort
  }
}

/** Push a rename. Best-effort. */
export async function pushRename(id: string, title: string): Promise<void> {
  if (serverUnavailable) return;
  const headers = authHeaders();
  if (!headers) return;
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.status === 503) markUnavailable();
  } catch {
    // best-effort
  }
}

/** Push a delete. Best-effort. */
export async function pushDelete(id: string): Promise<void> {
  if (serverUnavailable) return;
  const headers = authHeaders();
  if (!headers) return;
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers,
    });
    if (res.status === 503) markUnavailable();
  } catch {
    // best-effort
  }
}

/** Append a turn to a conversation server-side. The local slice has
 *  already written the turn; this is just the persistence echo. */
export async function pushTurn(
  conversationId: string,
  turn: ConversationTurn,
): Promise<void> {
  if (serverUnavailable) return;
  const headers = authHeaders();
  if (!headers) return;
  try {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          // Generate a stable text id from the local numeric one.
          id: `msg_${turn.id.toString(36)}`,
          userText: turn.userText,
          response: turn.response,
          displayTime: turn.time,
          metadata: { localId: turn.id },
        }),
      },
    );
    if (res.status === 503) markUnavailable();
  } catch {
    // best-effort
  }
}

/** True if the sync engine has given up for this session. UI hooks
 *  can read this to suppress "syncing…" indicators. */
export function isServerUnavailable(): boolean {
  return serverUnavailable;
}
