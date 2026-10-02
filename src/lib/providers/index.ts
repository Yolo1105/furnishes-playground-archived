/**
 * Provider registry — env-var-driven default selection.
 *
 * The orchestrator's per-piece fan-out picks providers via these
 * functions, NOT by direct construction. This is the swap point for
 * license-hedging:
 *
 *   - Hunyuan3D 3.1 (Tencent license, EXCLUDES EU/UK/SK) is the
 *     hero-tier default for unrestricted regions.
 *   - For EU/UK/SK deployments, set MESH_HERO_PROVIDER=trellis (MIT,
 *     Trellis 2, drop-in replacement, comparable quality).
 *
 * TripoSR (MIT, <1s) is the preview-tier default everywhere — perfect
 * for the streaming placeholder-mesh pattern where speed matters more
 * than topology.
 *
 * Env vars consumed:
 *   MESH_PREVIEW_PROVIDER  — default "triposr"
 *   MESH_HERO_PROVIDER     — default "hunyuan3d"
 *
 * Both are validated against the MeshProviderName union; unknown values
 * are silently ignored and fall through to the default. (We could throw
 * on misconfiguration but that would prevent the app from booting; the
 * studio's policy is "log a warning, use the default, keep going.")
 */

import "server-only";

import {
  getMeshGenerator,
  type MeshProviderName,
} from "./fal";
import type { MeshGenerator } from "./interface";

const VALID_PROVIDERS: readonly MeshProviderName[] = [
  "hunyuan3d",
  "trellis",
  "triposr",
  "step1x3d",
  "meshy",
] as const;

function isValidProviderName(value: string): value is MeshProviderName {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

function resolveProviderFromEnv(
  envVar: string | undefined,
  fallback: MeshProviderName,
): MeshProviderName {
  if (!envVar) return fallback;
  if (isValidProviderName(envVar)) return envVar;

  console.warn(
    `[providers] Unknown provider "${envVar}", falling back to "${fallback}"`,
  );
  return fallback;
}

/** Preview-tier default (fast, iteration-friendly). MIT-licensed
 *  TripoSR is the unconditional default — works in all territories
 *  and completes in under a second. */
export function getDefaultPreviewProvider(): MeshGenerator {
  const name = resolveProviderFromEnv(
    process.env.MESH_PREVIEW_PROVIDER,
    "triposr",
  );
  return getMeshGenerator(name);
}

/** Hero-tier default (best quality). Defaults to Hunyuan3D — the
 *  highest-quality option in unrestricted regions. EU/UK/SK
 *  deployments MUST set MESH_HERO_PROVIDER=trellis to avoid the
 *  Tencent Community License territory restriction. */
export function getDefaultHeroProvider(): MeshGenerator {
  const name = resolveProviderFromEnv(
    process.env.MESH_HERO_PROVIDER,
    "hunyuan3d",
  );
  return getMeshGenerator(name);
}

// Re-export the explicit constructors so consumers can pin a specific
// provider when needed (e.g. tests, special-case generation flows).
export {
  getMeshGenerator,
  getImageGenerator,
  type MeshProviderName,
} from "./fal";
export type {
  MeshGenerator,
  ImageGenerator,
  MeshGenerationConfig,
  MeshGenerationResult,
  ImageGenerationConfig,
  ImageGenerationResult,
} from "./interface";
