/**
 * fal.ai provider implementations.
 *
 * One file, all adapters. Each adapter wraps a specific fal.ai endpoint
 * and conforms to ImageGenerator or MeshGenerator from ./interface.
 *
 * License landscape (read before changing providers):
 *   - Hunyuan3D 3.1: Tencent Community License. EXCLUDES EU/UK/SK.
 *     1M MAU requires separate license from Tencent.
 *   - TRELLIS 2: MIT (drop-in replacement, no territory limits)
 *   - TripoSR: MIT (preview-tier, <1s, no PBR)
 *   - Step1X-3D: retired on fal.ai (registry name kept so env vars fail loudly)
 *   - Meshy v6: proprietary (cleanest topology, slowest, most expensive)
 *   - Flux Schnell: fal.ai's terms, standard commercial use. Kept over
 *     FLUX.2 because it is cheap and good enough for style-anchor shots.
 *
 * Env vars consumed:
 *   FAL_KEY or FAL_API_KEY — the fal.ai API key (required for real calls)
 *   MESH_PREVIEW_PROVIDER  — default "triposr"
 *   MESH_HERO_PROVIDER     — default "hunyuan3d" (set to "trellis" for EU compliance)
 *
 * If the key is missing, every adapter throws "FAL_API_KEY not configured"
 * — the orchestrator catches this and emits an `error` SSE event so the
 * chat surface shows a friendly "service offline" message instead of a
 * raw fetch failure.
 */

import "server-only";

import type {
  ImageGenerationConfig,
  ImageGenerationResult,
  ImageGenerator,
  MeshGenerationConfig,
  MeshGenerationResult,
  MeshGenerator,
} from "./interface";

// ----------------------------------------------------------------------
// fal.ai client setup
// ----------------------------------------------------------------------

// Accept either FAL_API_KEY or FAL_KEY (fal.ai's own setup docs use the
// short form; we accept both so users following the official docs don't
// silently fail).
const FAL_API_KEY = process.env.FAL_API_KEY || process.env.FAL_KEY;
const FAL_BASE_URL = "https://fal.run";

if (!FAL_API_KEY && process.env.NODE_ENV !== "test") {
  console.warn(
    "[providers/fal] FAL_API_KEY not set — generation calls will fail until configured.",
  );
}

/** Shape returned by fal.ai endpoints. Different endpoints fill in
 *  different subsets — we read whatever the specific call produces. */
type FalFile = { url: string; file_size?: number; content_type?: string };

type FalGenerationResponse = {
  images?: Array<{ url: string; width: number; height: number }>;
  /** Hunyuan 3.1 / Trellis 2 / Meshy v6 primary GLB. Rapid may put OBJ here. */
  model_glb?: FalFile;
  /** Hunyuan 3.1 also returns typed URLs; prefer glb over model_glb. */
  model_urls?: { glb?: FalFile };
  /** Older Hunyuan v2 / TripoSR shape. */
  model_mesh?: FalFile;
  mesh?: FalFile;
  pbr_model?: FalFile;
  seed?: number;
};

/** Pick a GLB URL across current and legacy fal output shapes.
 *  Prefer `model_urls.glb` because Hunyuan Rapid can put an OBJ in
 *  `model_glb`. */
function glbUrlFromFal(response: FalGenerationResponse): string | null {
  return (
    response.model_urls?.glb?.url ??
    response.model_glb?.url ??
    response.model_mesh?.url ??
    response.pbr_model?.url ??
    response.mesh?.url ??
    null
  );
}

/** Single-shot synchronous fal.ai call. fal.run is the synchronous
 *  endpoint — it blocks until the job completes (or times out at the
 *  fal.ai side). We use this for both image + mesh because the studio
 *  flow needs the result inline; the SSE streaming happens at our
 *  layer (orchestrator yields events between these calls), not at
 *  fal.ai's. */
async function callFalSync<T = FalGenerationResponse>(
  endpoint: string,
  payload: unknown,
): Promise<T> {
  if (!FAL_API_KEY) {
    throw new Error("FAL_API_KEY not configured");
  }

  const response = await fetch(`${FAL_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${FAL_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    // Truncate the upstream error so we don't blow out our error
    // payload when fal.ai returns a multi-KB stack trace. The
    // friendly-error mapper later strips the rest.
    throw new Error(
      `fal.ai ${endpoint} returned ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  return response.json() as Promise<T>;
}

/** Clamp a polygon budget into a range the R3F viewer can actually
 *  load. fal defaults (500k faces / vertices) are far too heavy for
 *  furniture in a live scene. */
function clampWebPolycount(
  requested: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof requested === "number" && requested > 0) {
    return Math.min(Math.max(requested, min), max);
  }
  return fallback;
}

// ======================================================================
// Text-to-image: Flux Schnell
// ======================================================================
// Still the live cheap endpoint. Do not swap to FLUX.2 here — style
// anchors do not need the extra quality or cost.

export class FluxSchnellGenerator implements ImageGenerator {
  readonly name = "fal-ai/flux/schnell";

  async generate(
    config: ImageGenerationConfig,
  ): Promise<ImageGenerationResult> {
    const payload = {
      prompt: config.prompt,
      image_size: imageSizeToFalFormat(
        config.image_size ?? 1024,
        config.aspect ?? "square",
      ),
      // 4 inference steps is Flux Schnell's design point — it's a
      // distilled model that converges fast. More steps don't improve
      // quality and cost more.
      num_inference_steps: 4,
      num_images: 1,
      seed: config.seed ?? Math.floor(Math.random() * 1_000_000),
      enable_safety_checker: true,
    };

    const start = Date.now();
    const response = await callFalSync("fal-ai/flux/schnell", payload);
    const duration = Date.now() - start;

    const img = response.images?.[0];
    if (!img) {
      throw new Error("Flux returned no images");
    }

    console.log(`[flux/schnell] generated in ${duration}ms`);
    return {
      url: img.url,
      width: img.width,
      height: img.height,
      seed: response.seed ?? 0,
    };
  }
}

/** Translate our typed aspect ratio to fal.ai's named-preset format.
 *  fal.ai doesn't accept arbitrary widths/heights for Flux — only
 *  these named sizes. Anything else falls back to square_hd. */
function imageSizeToFalFormat(
  _size: 512 | 1024 | 2048,
  aspect: ImageGenerationConfig["aspect"],
): string {
  if (aspect === "landscape_4_3") return "landscape_4_3";
  if (aspect === "landscape_16_9") return "landscape_16_9";
  if (aspect === "portrait_4_3") return "portrait_4_3";
  return "square_hd";
}

// ======================================================================
// Image-to-3D: Hunyuan3D 3.1
// ======================================================================
// Best quality at hero tier, but Tencent license excludes EU/UK/SK.
// For those regions, set MESH_HERO_PROVIDER=trellis.
//
// preview / balanced → Rapid (fast, no face_count)
// hero               → Pro   (face_count capped for R3F)

const HUNYUAN_RAPID = "fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d";
const HUNYUAN_PRO = "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d";

export class Hunyuan3DGenerator implements MeshGenerator {
  readonly name = "fal-ai/hunyuan-3d/v3.1";
  readonly license = "tencent" as const;
  readonly supports_pbr = true;

  async generate(config: MeshGenerationConfig): Promise<MeshGenerationResult> {
    const isHero = config.tier === "hero";
    const endpoint = isHero ? HUNYUAN_PRO : HUNYUAN_RAPID;

    const payload: Record<string, unknown> = {
      input_image_url: config.image_url,
      enable_pbr: true,
    };
    if (isHero) {
      payload.generate_type = "Normal";
      // Pro default is 500k faces — far too heavy for the live scene.
      // Honor max_faces when it is already in Pro's legal range.
      payload.face_count = clampWebPolycount(
        config.max_faces,
        80_000,
        40_000,
        150_000,
      );
    }

    const start = Date.now();
    const response = await callFalSync(endpoint, payload);
    const duration = Date.now() - start;

    const glbUrl = glbUrlFromFal(response);
    if (!glbUrl) {
      throw new Error("Hunyuan3D returned no mesh URL");
    }

    return {
      glb_url: glbUrl,
      provider: endpoint,
      duration_ms: duration,
      seed: response.seed,
    };
  }
}

// ======================================================================
// Image-to-3D: TRELLIS 2 (MIT license, drop-in for Hunyuan3D)
// ======================================================================
// Use this in EU/UK/SK deployments. Quality is comparable to Hunyuan3D
// for most furniture categories; slightly different topology.
//
// fal default decimation_target is 500k vertices — too heavy for web.
// Docs recommend 20k–50k for web/mobile.

export class TrellisGenerator implements MeshGenerator {
  readonly name = "fal-ai/trellis-2";
  readonly license = "mit" as const;
  readonly supports_pbr = true;

  async generate(config: MeshGenerationConfig): Promise<MeshGenerationResult> {
    const tuning = this.getTuningForTier(config.tier);

    const payload = {
      image_url: config.image_url,
      ss_sampling_steps: tuning.sampling_steps,
      shape_slat_sampling_steps: tuning.sampling_steps,
      tex_slat_sampling_steps: tuning.sampling_steps,
      texture_size: tuning.texture_size,
      remesh: true,
      decimation_target: clampWebPolycount(
        config.max_faces,
        tuning.decimation_target,
        20_000,
        150_000,
      ),
      seed: config.seed ?? Math.floor(Math.random() * 1_000_000),
    };

    const start = Date.now();
    const response = await callFalSync("fal-ai/trellis-2", payload);
    const duration = Date.now() - start;

    const glbUrl = glbUrlFromFal(response);
    if (!glbUrl) {
      throw new Error("TRELLIS returned no mesh URL");
    }

    return {
      glb_url: glbUrl,
      provider: this.name,
      duration_ms: duration,
      seed: response.seed,
    };
  }

  private getTuningForTier(tier: MeshGenerationConfig["tier"]): {
    sampling_steps: number;
    texture_size: "1024" | "2048";
    decimation_target: number;
  } {
    switch (tier) {
      case "preview":
        return {
          sampling_steps: 8,
          texture_size: "1024",
          decimation_target: 20_000,
        };
      case "balanced":
        return {
          sampling_steps: 12,
          texture_size: "1024",
          decimation_target: 40_000,
        };
      case "hero":
        return {
          sampling_steps: 16,
          texture_size: "2048",
          decimation_target: 80_000,
        };
    }
  }
}

// ======================================================================
// Image-to-3D: TripoSR (MIT, <1s preview)
// ======================================================================
// The "see something fast" path. Topology is rough, no PBR — but
// generation completes in under a second, perfect for the streaming
// placeholder-mesh pattern. Endpoint id is still fal-ai/triposr.

export class TripoSRGenerator implements MeshGenerator {
  readonly name = "fal-ai/triposr";
  readonly license = "mit" as const;
  readonly supports_pbr = false;

  async generate(config: MeshGenerationConfig): Promise<MeshGenerationResult> {
    const payload = {
      image_url: config.image_url,
      output_format: "glb",
      do_remove_background: true,
      foreground_ratio: 0.85,
      mc_resolution: 256,
    };

    const start = Date.now();
    const response = await callFalSync("fal-ai/triposr", payload);
    const duration = Date.now() - start;

    const glbUrl = glbUrlFromFal(response);
    if (!glbUrl) {
      throw new Error("TripoSR returned no mesh URL");
    }

    return {
      glb_url: glbUrl,
      provider: this.name,
      duration_ms: duration,
    };
  }
}

// ======================================================================
// Image-to-3D: Meshy v6 (proprietary, high-quality topology)
// ======================================================================
// Cleanest topology for retopo-aware downstream pipelines, but slowest
// and most expensive (often 5–10 min). /api/generate-asset's maxDuration
// is 180s — Meshy as hero will often time out. Prefer hunyuan3d/trellis
// unless topology cleanliness is the goal and you raise the route limit.

export class MeshyGenerator implements MeshGenerator {
  readonly name = "fal-ai/meshy/v6/image-to-3d";
  readonly license = "proprietary" as const;
  readonly supports_pbr = true;

  async generate(config: MeshGenerationConfig): Promise<MeshGenerationResult> {
    const payload: Record<string, unknown> = {
      image_url: config.image_url,
      topology: "triangle",
      target_polycount: clampWebPolycount(
        config.max_faces,
        15_000,
        1_000,
        50_000,
      ),
      should_texture: true,
      enable_pbr: true,
    };
    if (typeof config.seed === "number") payload.seed = config.seed;

    const start = Date.now();
    const response = await callFalSync(
      "fal-ai/meshy/v6/image-to-3d",
      payload,
    );
    const duration = Date.now() - start;

    const glbUrl = glbUrlFromFal(response);
    if (!glbUrl) {
      throw new Error("Meshy returned no mesh URL");
    }

    return {
      glb_url: glbUrl,
      provider: this.name,
      duration_ms: duration,
    };
  }
}

// ======================================================================
// Image-to-3D: Step1X-3D — retired
// ======================================================================
// fal-ai/step1x-3d 404s as of 2026. The registry name is kept so an
// existing MESH_*_PROVIDER=step1x3d fails with a clear message instead
// of silently falling back.

export class Step1X3DGenerator implements MeshGenerator {
  readonly name = "fal-ai/step1x-3d";
  readonly license = "apache" as const;
  readonly supports_pbr = false;

  async generate(_config: MeshGenerationConfig): Promise<MeshGenerationResult> {
    throw new Error(
      "fal-ai/step1x-3d was removed from fal.ai. Set MESH_PREVIEW_PROVIDER / MESH_HERO_PROVIDER to trellis or hunyuan3d.",
    );
  }
}

// ======================================================================
// Provider registry
// ======================================================================

export type MeshProviderName =
  | "hunyuan3d"
  | "trellis"
  | "triposr"
  | "step1x3d"
  | "meshy";

/** Construct a mesh generator instance from its registry name. The
 *  switch is exhaustive over MeshProviderName so adding a new provider
 *  here forces a compile-time update. */
export function getMeshGenerator(name: MeshProviderName): MeshGenerator {
  switch (name) {
    case "hunyuan3d":
      return new Hunyuan3DGenerator();
    case "trellis":
      return new TrellisGenerator();
    case "triposr":
      return new TripoSRGenerator();
    case "step1x3d":
      return new Step1X3DGenerator();
    case "meshy":
      return new MeshyGenerator();
  }
}

export function getImageGenerator(name: "flux-schnell"): ImageGenerator {
  switch (name) {
    case "flux-schnell":
      return new FluxSchnellGenerator();
  }
}
