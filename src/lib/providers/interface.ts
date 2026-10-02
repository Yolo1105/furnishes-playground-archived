/**
 * Provider interface — common shape for all generation endpoints.
 *
 * Three categories:
 *   1. Text-to-image (Flux variants)         — style anchor + per-piece 2D
 *   2. Image-to-3D, fast preview (TripoSR)   — <1s rough GLBs for iteration
 *   3. Image-to-3D, hero quality (Hunyuan3D 3.1, TRELLIS 2, Meshy v6)
 *
 * Each implementation conforms to either ImageGenerator or MeshGenerator.
 * The pipeline picks providers via env-var config (see ./index.ts), not
 * by hardcoding — switching providers is a single env-var change. This
 * matters for license-hedging Hunyuan3D → TRELLIS in EU/UK/SK
 * deployments where Hunyuan's Tencent Community License excludes those
 * territories.
 *
 * Marked "server-only" because all real adapters call fal.ai with a
 * server-side API key. Importing this from a client component would
 * leak the bundle and break at build time.
 */

import "server-only";

/** Result of a successful text-to-image generation. */
export type ImageGenerationResult = {
  /** Absolute URL to the generated image (typically a fal.ai CDN URL). */
  url: string;
  /** Pixel width of the generated image. */
  width: number;
  /** Pixel height of the generated image. */
  height: number;
  /** Seed used by the provider (echo back so we can reproduce). */
  seed: number;
};

/** Result of a successful image-to-3D mesh generation. */
export type MeshGenerationResult = {
  /** Absolute URL to the GLB file. fal.ai CDN URLs typically expire
   *  in 24-48 hours — cache the bytes (see lib/persistence/glb-cache)
   *  if you need durable persistence. */
  glb_url: string;
  /** Provider that generated this, for attribution / debugging /
   *  analytics. e.g. "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d". */
  provider: string;
  /** Generation duration in milliseconds. Surfaced in chat status
   *  bubbles for transparency ("Generated in 4.2s"). */
  duration_ms: number;
  /** Approximate face count when known. Used for R3F perf budgeting
   *  on the client (e.g. drop in a placeholder if a single piece
   *  exceeds 200k faces). */
  face_count?: number;
  /** Seed used by the provider, for reproducibility / retry-with-
   *  different-seed flows. */
  seed?: number;
};

/** Config passed to MeshGenerator.generate. */
export type MeshGenerationConfig = {
  /** Input image URL — usually a Flux Schnell output, but any
   *  publicly-fetchable image URL works. */
  image_url: string;
  /** Optional seed. 0 or undefined = random. */
  seed?: number;
  /** Quality tier. Providers interpret this differently:
   *    - preview: fastest, lowest detail (TripoSR ~1s)
   *    - balanced: middle (Hunyuan Rapid)
   *    - hero: highest detail (Hunyuan Pro, ~80k faces) */
  tier: "preview" | "balanced" | "hero";
  /** Optional polygon budget for the mesh. Some providers honor this;
   *  others ignore it. */
  max_faces?: number;
};

/** Config passed to ImageGenerator.generate. */
export type ImageGenerationConfig = {
  /** The image prompt, built from the StyleBible + piece description. */
  prompt: string;
  /** Optional negative prompt (Flux supports this). */
  negative_prompt?: string;
  /** Optional seed. */
  seed?: number;
  /** Output resolution. 1024 is the Flux default sweet spot. 2048 for
   *  hero anchors; 512 for fast iteration. */
  image_size?: 512 | 1024 | 2048;
  /** Aspect ratio. fal.ai's Flux endpoints accept named presets. */
  aspect?: "square" | "landscape_4_3" | "portrait_4_3" | "landscape_16_9";
};

export interface MeshGenerator {
  /** fal.ai endpoint identifier, e.g. "fal-ai/hunyuan-3d/v3.1". */
  readonly name: string;
  /** License of the underlying model. Drives the EU/UK gating logic
   *  in providers/index.ts. */
  readonly license: "mit" | "apache" | "tencent" | "proprietary" | "other";
  /** Whether the provider returns PBR (physically-based rendering)
   *  textures or just baked color. PBR-capable providers produce
   *  better-looking meshes on the studio's lighting setup. */
  readonly supports_pbr: boolean;

  generate(config: MeshGenerationConfig): Promise<MeshGenerationResult>;
}

export interface ImageGenerator {
  /** fal.ai endpoint identifier, e.g. "fal-ai/flux/schnell". */
  readonly name: string;
  generate(config: ImageGenerationConfig): Promise<ImageGenerationResult>;
}
