/**
 * Furnishes Studio feature gate (middleware + API).
 * Edge-safe: only reads `process.env`, no Prisma or Node-only APIs.
 *
 * - `STUDIO_ENABLED=0` / `false` / `no` → off
 * - Unset or other truthy strings → on (backward compatible for dev/CI)
 */
export function isStudioEnabled(): boolean {
  const raw = process.env.STUDIO_ENABLED?.trim().toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return true;
}

/** JSON 503 when Studio is turned off. */
export function studioDisabledJsonResponse(): Response {
  return Response.json(
    { error: "Studio is disabled", code: "STUDIO_DISABLED" },
    { status: 503 },
  );
}
