import { NextResponse } from "next/server";
import { isBrainEnabled } from "@/lib/chat-brain/core/brain-flag";
import { BRAIN_ANTHROPIC_MODEL } from "@/lib/chat-brain/core/anthropic-model";
import { getSuggestionRemaining } from "@/lib/chat-brain/suggestions/daily-cap";

/**
 * GET /api/health — diagnostic endpoint for setup verification.
 *
 * Reports whether each user-facing feature is configured correctly
 * without making any actual model calls. The user hits this from a
 * browser tab during initial setup to confirm three independent
 * concerns at once:
 *
 *   1. Chat brain pipeline — needs ANTHROPIC_API_KEY (on by default;
 *      opt out with ENABLE_BRAIN_PIPELINE=false)
 *   2. Text-to-3D generation — needs FAL_API_KEY (or FAL_KEY)
 *   3. Suggestions daily cap — informational; reports current budget
 *
 * Each feature reports independently so you know exactly which key
 * is missing if something doesn't work. The endpoint never returns
 * the actual API key values — only presence + a partial-redacted hint
 * (last 4 chars) so the user can confirm they pasted the right key
 * without exposing it.
 *
 * Cheap to call; no model invocation, no daily-cap consumption.
 */

function maskKey(raw: string): string | null {
  if (!raw || raw.length < 8) return null;
  // Show enough public prefix to recognize the provider, plus last 4
  // chars to confirm the right key was pasted. fal.ai keys don't have
  // a single canonical prefix shape — we show the first 8 chars
  // (which is fine to expose; an 8-char prefix isn't enough to brute
  // force anything).
  const prefixLen = raw.startsWith("sk-ant-api") ? 12 : 8;
  return `${raw.slice(0, prefixLen)}...${raw.slice(-4)}`;
}

export async function GET(): Promise<Response> {
  // ── Anthropic / chat brain ─────────────────────────────────────────
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
  const anthropicKeyPresent = anthropicKey.length > 0;
  const anthropicKeyHint = maskKey(anthropicKey);
  const brainEnabled = isBrainEnabled();
  const enableBrainRaw = process.env.ENABLE_BRAIN_PIPELINE ?? null;
  const chatReady = brainEnabled && anthropicKeyPresent;

  // ── fal.ai / text-to-3D ────────────────────────────────────────────
  // The provider adapter accepts EITHER FAL_API_KEY or FAL_KEY. We
  // check both and report whichever is set. If neither, the
  // generation endpoints return "FAL_KEY not configured".
  const falKey = process.env.FAL_API_KEY ?? process.env.FAL_KEY ?? "";
  const falKeyPresent = falKey.length > 0;
  const falKeyHint = maskKey(falKey);
  // Which env var name holds the value we found (for diagnostics).
  const falKeyVarName = process.env.FAL_API_KEY
    ? "FAL_API_KEY"
    : process.env.FAL_KEY
      ? "FAL_KEY"
      : null;

  // Mesh provider validation. The registry silently falls back to the
  // default when the env var is set to an unknown value (e.g. a typo).
  // We surface that fallback here so the user can see it without
  // hunting through dev logs.
  //
  // The valid set must stay in sync with src/lib/providers/index.ts's
  // VALID_PROVIDERS; we copy the list rather than import to keep this
  // diagnostic endpoint free of fal.ai client setup.
  const VALID_MESH_PROVIDERS = [
    "hunyuan3d",
    "trellis",
    "triposr",
    "step1x3d",
    "meshy",
  ] as const;
  const isValidProvider = (v: string | undefined): boolean =>
    !!v && (VALID_MESH_PROVIDERS as readonly string[]).includes(v);

  const meshPreviewRaw = process.env.MESH_PREVIEW_PROVIDER;
  const meshHeroRaw = process.env.MESH_HERO_PROVIDER;
  const meshPreview = isValidProvider(meshPreviewRaw)
    ? meshPreviewRaw!
    : "triposr";
  const meshHero = isValidProvider(meshHeroRaw)
    ? meshHeroRaw!
    : "hunyuan3d";
  // True when the env var was set BUT not recognized — a typo. False
  // when the env var was unset (defaulting is intentional, not a fallback).
  const meshPreviewUsedFallback =
    meshPreviewRaw !== undefined && !isValidProvider(meshPreviewRaw);
  const meshHeroUsedFallback =
    meshHeroRaw !== undefined && !isValidProvider(meshHeroRaw);

  const generationReady = falKeyPresent;

  // ── Suggestions cap ────────────────────────────────────────────────
  const suggestions = getSuggestionRemaining("global");
  const suggestionsCap =
    suggestions.cap === 0 ? null : suggestions.cap;
  const suggestionsRemaining =
    suggestions.remaining === Number.POSITIVE_INFINITY
      ? null
      : suggestions.remaining;

  // ── Hints ──────────────────────────────────────────────────────────
  const hints = buildSetupHints({
    chatReady,
    generationReady,
    brainEnabled,
    anthropicKeyPresent,
    falKeyPresent,
    meshPreviewUsedFallback,
    meshHeroUsedFallback,
    meshPreview,
    meshHero,
  });

  return NextResponse.json(
    {
      ok: true,

      // Per-feature readiness summary — easiest thing to eyeball.
      ready: {
        chat: chatReady,
        textTo3D: generationReady,
      },

      // Chat brain details
      brainEnabled,
      enableBrainRaw,
      anthropicKeyPresent,
      anthropicKeyHint,
      brainModel: BRAIN_ANTHROPIC_MODEL,

      // Text-to-3D details
      falKeyPresent,
      falKeyHint,
      falKeyVarName,
      meshPreviewProvider: meshPreview,
      meshHeroProvider: meshHero,
      meshPreviewUsedFallback,
      meshHeroUsedFallback,

      // Suggestions cap
      suggestionsDailyCap: suggestionsCap,
      suggestionsRemainingToday: suggestionsRemaining,

      // Pointers shown when something is misconfigured.
      hints: hints.length > 0 ? hints : undefined,
    },
    {
      // Don't cache — values can change between requests during setup.
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function buildSetupHints(args: {
  chatReady: boolean;
  generationReady: boolean;
  brainEnabled: boolean;
  anthropicKeyPresent: boolean;
  falKeyPresent: boolean;
  meshPreviewUsedFallback: boolean;
  meshHeroUsedFallback: boolean;
  meshPreview: string;
  meshHero: string;
}): string[] {
  const hints: string[] = [];

  // Chat-brain hints
  if (!args.anthropicKeyPresent) {
    hints.push(
      "Chat: ANTHROPIC_API_KEY is not set. Add it to .env.local at the project root, then restart the dev server.",
    );
  }
  if (!args.brainEnabled) {
    hints.push(
      "Chat: ENABLE_BRAIN_PIPELINE is set to an off value (0/false/no/off). Unset it or set it to true, then restart the dev server.",
    );
  }

  // Text-to-3D hints
  if (!args.falKeyPresent) {
    hints.push(
      "Text-to-3D: FAL_API_KEY (or FAL_KEY) is not set. Add it to .env.local to enable /api/generate-asset and /api/generate-room. Without it, those endpoints return 'FAL_KEY not configured'.",
    );
  }

  // Mesh-provider typo hints. The registry silently falls back, so
  // without these hints the user could happily use a typo'd value
  // forever and never know they're not getting the model they typed.
  const validProviders = "hunyuan3d, trellis, triposr, step1x3d, meshy";
  if (args.meshPreviewUsedFallback) {
    hints.push(
      `Text-to-3D: MESH_PREVIEW_PROVIDER value not recognized — using default 'triposr'. Valid values: ${validProviders}.`,
    );
  }
  if (args.meshHeroUsedFallback) {
    hints.push(
      `Text-to-3D: MESH_HERO_PROVIDER value not recognized — using default 'hunyuan3d'. Valid values: ${validProviders}.`,
    );
  }
  if (args.meshPreview === "step1x3d" || args.meshHero === "step1x3d") {
    hints.push(
      "Text-to-3D: step1x3d was removed from fal.ai. Set MESH_PREVIEW_PROVIDER / MESH_HERO_PROVIDER to trellis or hunyuan3d.",
    );
  }

  // Common
  if (
    !args.chatReady ||
    !args.generationReady ||
    args.meshPreviewUsedFallback ||
    args.meshHeroUsedFallback ||
    args.meshPreview === "step1x3d" ||
    args.meshHero === "step1x3d"
  ) {
    hints.push(
      "Next.js caches env vars at boot. Editing .env.local requires restarting `npm run dev`.",
    );
    hints.push(
      "See SETUP.md at the project root for a full walkthrough.",
    );
  }
  return hints;
}
