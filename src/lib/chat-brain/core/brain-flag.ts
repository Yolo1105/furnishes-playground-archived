/**
 * Brain pipeline feature flag.
 *
 * Canonical reader for `ENABLE_BRAIN_PIPELINE`. Chat, suggestions, and
 * the boot/health diagnostics all go through this so they agree.
 *
 * Default is ON. The legacy JSON chat path is gone; opt out only if
 * you need to stop model calls without removing the API key.
 *
 * Off values (case-insensitive, whitespace-tolerant):
 *   0, false, no, off
 *
 * Everything else — including unset — is enabled.
 */

export function isBrainEnabled(): boolean {
  const v = process.env.ENABLE_BRAIN_PIPELINE;
  if (!v) return true;
  const normalized = v.trim().toLowerCase();
  if (normalized === "") return true;
  return !(
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}
