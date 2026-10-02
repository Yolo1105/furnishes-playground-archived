/**
 * Client fetch headers for prod (NextAuth session cookie).
 * Studio standalone used Supabase Bearer tokens — prod uses cookies.
 */
export function getAuthHeaders(): Record<string, string> {
  return {};
}
