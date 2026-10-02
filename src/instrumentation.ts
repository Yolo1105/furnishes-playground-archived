/**
 * Next.js instrumentation hook.
 *
 * Runs ONCE at server boot (and once more on each dev-server restart).
 * Prints the brain pipeline + text-to-3D pipeline configuration to the
 * console so the user can confirm setup at a glance, before they even
 * open the browser.
 *
 * This file is auto-discovered by Next.js 16 when present at src/ or
 * the project root. No experimental flag required.
 *
 * Documented at: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  // Only run in the Node.js runtime (not in Edge or in the browser).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Lazy-import so this file stays minimal at the top level.
  const { isBrainEnabled } = await import(
    "@/lib/chat-brain/core/brain-flag"
  );
  const { BRAIN_ANTHROPIC_MODEL } = await import(
    "@/lib/chat-brain/core/anthropic-model"
  );

  // ── Anthropic / brain pipeline ──────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const apiKeyPresent = apiKey.length > 0;
  const brainOn = isBrainEnabled();

  // ── fal.ai / text-to-3D ─────────────────────────────────────────
  const falKey = process.env.FAL_API_KEY ?? process.env.FAL_KEY ?? "";
  const falKeyPresent = falKey.length > 0;
  const previewProvider =
    process.env.MESH_PREVIEW_PROVIDER ?? "triposr";
  const heroProvider = process.env.MESH_HERO_PROVIDER ?? "hunyuan3d";

  // ANSI colors (work in most terminals; harmless in the rest)
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  const red = "\x1b[31m";
  const cyan = "\x1b[36m";

  console.log("");
  console.log(`${cyan}┌─ Furnishes Studio — backend status ──────${reset}`);

  // ── Chat brain section ─────────────────────────────────────────
  if (brainOn && apiKeyPresent) {
    console.log(
      `${cyan}│${reset} ${green}● chat brain ACTIVE${reset}`,
    );
    console.log(
      `${cyan}│${reset}   ${dim}model:${reset} ${BRAIN_ANTHROPIC_MODEL}`,
    );
    const hint = `${apiKey.slice(0, 12)}...${apiKey.slice(-4)}`;
    console.log(`${cyan}│${reset}   ${dim}key:${reset} ${hint}`);
    const cap = process.env.BRAIN_SUGGESTIONS_DAILY_CAP ?? "50";
    console.log(
      `${cyan}│${reset}   ${dim}suggestions cap:${reset} ${cap}/day`,
    );
  } else if (brainOn && !apiKeyPresent) {
    console.log(
      `${cyan}│${reset} ${red}● chat brain enabled but ANTHROPIC_API_KEY missing${reset}`,
    );
    console.log(
      `${cyan}│${reset}   ${yellow}→ chat returns 503 until key is set${reset}`,
    );
  } else if (!brainOn && apiKeyPresent) {
    console.log(
      `${cyan}│${reset} ${yellow}● chat brain DISABLED (ENABLE_BRAIN_PIPELINE=false)${reset}`,
    );
    console.log(
      `${cyan}│${reset}   ${dim}unset the flag or set it to true to re-enable${reset}`,
    );
  } else {
    console.log(
      `${cyan}│${reset} ${yellow}● chat brain not configured${reset}`,
    );
    console.log(
      `${cyan}│${reset}   ${dim}cp .env.example .env.local; add keys${reset}`,
    );
  }

  // ── Text-to-3D section ─────────────────────────────────────────
  if (falKeyPresent) {
    console.log(
      `${cyan}│${reset} ${green}● text-to-3D ACTIVE${reset}`,
    );
    const falHint = `...${falKey.slice(-4)}`;
    console.log(
      `${cyan}│${reset}   ${dim}fal.ai key:${reset} ${falHint}`,
    );
    console.log(
      `${cyan}│${reset}   ${dim}preview:${reset} ${previewProvider}` +
        ` ${dim}|${reset} ${dim}hero:${reset} ${heroProvider}`,
    );
    if (!apiKeyPresent) {
      // The text-to-3D pipeline calls Claude to derive piece specs from
      // the prompt — without Anthropic, /api/generate-asset returns 503
      // even though fal.ai is reachable.
      console.log(
        `${cyan}│${reset}   ${yellow}⚠ ANTHROPIC_API_KEY needed for chat-driven generation${reset}`,
      );
    }
  } else {
    console.log(
      `${cyan}│${reset} ${yellow}● text-to-3D not configured${reset}`,
    );
    console.log(
      `${cyan}│${reset}   ${dim}set FAL_API_KEY in .env.local for generate-asset / generate-room${reset}`,
    );
  }

  console.log(
    `${cyan}│${reset} ${dim}health check:${reset} GET /api/health`,
  );
  console.log(`${cyan}└────────────────────────────────────────────${reset}`);
  console.log("");
}
