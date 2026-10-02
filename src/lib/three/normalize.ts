import * as THREE from "three";

/**
 * Normalize a freshly-loaded GLB scene into the canonical viewer
 * space. Ported 1:1 from the zip's `lib/ingest/sceneNormalizer.ts`.
 *
 * The work is intentionally minimal:
 *
 *   1. **Unit correction** — detect whether the GLB was authored
 *      in millimetres / centimetres / metres (by raw bounding-box
 *      magnitude) and apply the inverse scale so the scene ends
 *      up in metres. For meter-unit GLBs (which is most of them,
 *      including apartamento.glb), this is `scale = 1` — a no-op.
 *
 *   2. **Floor-snap Y** — translate the scene so its lowest point
 *      sits at `y = 0`. Lets cameras and lights be authored once
 *      against a fixed floor without caring whether the source
 *      file's origin was at the apartment center, ceiling, or
 *      somewhere arbitrary.
 *
 * Crucially, **X and Z are NOT touched.** The zip's earlier version
 * did re-scale-to-target-size and re-center on X/Z; that broke the
 * floor plan alignment because:
 *   - Static authored data (walls JSON, furniture maps) live in
 *     raw Blender coordinates.
 *   - Live mesh data (walls extracted via cross-section,
 *     furniture extracted via Box3) lives in `matrixWorld`-space.
 *   When the apartment root is centered/scaled, those two diverge —
 *   the static data stays in raw space while the live data jumps
 *   into normalized space. Walls and furniture render in different
 *   coord frames and the floor plan looks wrong.
 *
 *   By preserving raw X/Z, both static authored data and live
 *   mesh-derived data sit in the same coordinate frame. Walls and
 *   furniture in the 2D plan align without any further transform.
 *
 * The function mutates the passed object in place.
 */

export interface NormalizationResult {
  /** Multiplier applied to root.scale (1 for meter GLBs). */
  scale: number;
  /** Detected source unit. */
  detectedUnit: "mm" | "cm" | "m";
  /** Final world-space min after normalization. */
  min: THREE.Vector3;
  /** Final world-space max after normalization. */
  max: THREE.Vector3;
}

export function normalizeScene(root: THREE.Object3D): NormalizationResult {
  // Step 1 — measure the raw scene to detect units.
  root.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(root);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z);

  // > 500 → mm, > 50 → cm, else m.
  const detectedUnit: "mm" | "cm" | "m" =
    maxDim > 500 ? "mm" : maxDim > 50 ? "cm" : "m";
  const scale =
    detectedUnit === "mm" ? 0.001 : detectedUnit === "cm" ? 0.01 : 1;

  // Step 2 — apply the unit-correction scale.
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  // Step 3 — floor-snap Y. Re-measure after scaling so we get the
  // post-scale floor position.
  const scaledBox = new THREE.Box3().setFromObject(root);
  root.position.y -= scaledBox.min.y;
  root.updateMatrixWorld(true);

  // Final bounds for callers (camera tuning, debug logging).
  const finalBox = new THREE.Box3().setFromObject(root);
  return {
    scale,
    detectedUnit,
    min: finalBox.min.clone(),
    max: finalBox.max.clone(),
  };
}
