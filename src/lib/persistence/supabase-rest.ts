/**
 * Server-side helper for talking to Supabase's PostgREST endpoint
 * (`/rest/v1/<table>`). Used by the /api/conversations* routes.
 *
 * Why we use REST and not the JS SDK:
 *   - The SDK pulls in extra weight we don't need; one fetch wrapper
 *     is enough for the small CRUD surface we have.
 *   - Authoring the SQL migration ourselves means we know exactly
 *     what columns exist; PostgREST infers the rest.
 *
 * Auth model:
 *   The route handlers extract the Bearer token from the request,
 *   forward it to PostgREST as `Authorization: Bearer <user JWT>`.
 *   PostgREST + Supabase RLS then enforce per-user row visibility
 *   automatically — we never need to filter by `user_id` in our
 *   queries.
 *
 * Failure mode:
 *   When NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   is missing, every helper short-circuits to a "not configured"
 *   error. The route handlers translate that into a 503 response,
 *   and the client sync engine treats 503 as "fall back to local
 *   only".
 */

import "server-only";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  userToken: string;
}

/** Read config from env + the request's Authorization header. Returns
 *  null when Supabase isn't configured OR when the request lacks a
 *  Bearer token (anonymous user). Both cases collapse to "no
 *  server-side persistence available for this request" upstream. */
export function readSupabaseConfig(req: Request): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const userToken = auth.slice("Bearer ".length).trim();
  if (!userToken) return null;

  return { url, anonKey, userToken };
}

/** Verify the user token is valid by calling Supabase's /auth/v1/user
 *  endpoint. Returns the user's id on success, null on any failure.
 *  Routes use this to confirm the bearer token actually belongs to a
 *  signed-in user before trusting it for RLS-gated writes. */
export async function verifySupabaseUser(
  cfg: SupabaseConfig,
): Promise<string | null> {
  try {
    const res = await fetch(`${cfg.url}/auth/v1/user`, {
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.userToken}`,
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}

/** Build common headers for PostgREST calls — apikey + user JWT
 *  (the JWT is what RLS reads to scope rows). */
function pgHeaders(
  cfg: SupabaseConfig,
  extras: Record<string, string> = {},
): Record<string, string> {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.userToken}`,
    "content-type": "application/json",
    ...extras,
  };
}

/** Generic select. `query` is the PostgREST query string after
 *  `?select=...`. Returns the parsed JSON array. Throws on non-200. */
export async function pgSelect<T>(
  cfg: SupabaseConfig,
  table: string,
  query: string,
): Promise<T[]> {
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${query}`, {
    headers: pgHeaders(cfg),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`pgSelect ${table} ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T[];
}

/** Generic insert. Returns the inserted row(s). */
export async function pgInsert<T>(
  cfg: SupabaseConfig,
  table: string,
  rows: object | object[],
): Promise<T[]> {
  const res = await fetch(`${cfg.url}/rest/v1/${table}`, {
    method: "POST",
    headers: pgHeaders(cfg, { Prefer: "return=representation" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`pgInsert ${table} ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T[];
}

/** Generic update. Returns the updated row(s). */
export async function pgUpdate<T>(
  cfg: SupabaseConfig,
  table: string,
  query: string,
  patch: object,
): Promise<T[]> {
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: pgHeaders(cfg, { Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`pgUpdate ${table} ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T[];
}

/** Generic delete. */
export async function pgDelete(
  cfg: SupabaseConfig,
  table: string,
  query: string,
): Promise<void> {
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: pgHeaders(cfg),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`pgDelete ${table} ${res.status}: ${text.slice(0, 300)}`);
  }
}
