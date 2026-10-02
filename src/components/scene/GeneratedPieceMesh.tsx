"use client";

/**
 * GeneratedPieceMesh — renders the real GLB mesh for a generated piece
 * (one whose `meta.glbUrl` is set).
 *
 * Three layers of protection so a single broken GLB never breaks the
 * whole scene:
 *
 *   1. URL resolution (state) — getOrFetchGLB returns either a cached
 *      blob URL or the original URL. While the resolution is in flight
 *      we render a placeholder box. Resolution always resolves
 *      (never rejects); on any failure it falls back to the original
 *      URL.
 *
 *   2. Suspense boundary — useGLTF suspends while drei downloads + parses
 *      the GLB. We render the placeholder box while suspended.
 *
 *   3. ErrorBoundary — useGLTF throws if the GLB is malformed or the
 *      URL 404s after resolution succeeded. The boundary catches and
 *      keeps the placeholder visible. Logs the failure once but
 *      doesn't surface it to the user — they already see the box.
 *
 * Auto-scale: fal.ai's mesh providers don't return meshes at the exact
 * dimensions Claude specified (TripoSR especially is loose with scale).
 * We measure the loaded GLB's bounding box, center it at origin, then
 * scale per-axis so the bounding box matches our piece's
 * (width × height × depth). The visible result lines up with what
 * Claude's spatial reasoning expects, regardless of the provider's
 * native output scale.
 */

import { useGLTF } from "@react-three/drei";
import { Suspense, useMemo, useState, useEffect } from "react";
import * as THREE from "three";
import React from "react";
import { getOrFetchGLB } from "@studio/persistence/glb-cache";

interface GeneratedPieceMeshProps {
  glbUrl: string;
  /** v0.40.32: when set, indicates this URL belongs to a starred
   *  item that has its bytes cached in the dedicated starred-glb-
   *  bucket IndexedDB store. The resolver checks that bucket
   *  FIRST so starred meshes don't 404 when the source URL expires. */
  starredGlbKey?: string;
  width: number;
  depth: number;
  height: number;
  /** Fallback color used while loading and if loading fails. Matches
   *  the per-item `color` from PlacedItem so the placeholder box
   *  carries the right visual identity. */
  color: string;
}

/** Inner GLB consumer. Suspends while drei loads the file; assumes
 *  resolvedUrl is already either a cached blob URL or the original. */
function GLBInner({
  resolvedUrl,
  width,
  depth,
  height,
}: {
  resolvedUrl: string;
  width: number;
  depth: number;
  height: number;
}) {
  const { scene } = useGLTF(resolvedUrl);

  const cloned = useMemo(() => {
    // Clone deep so multiple instances of the same GLB url don't
    // share transforms (drei caches the parsed scene; reusing it
    // directly would mean both copies see the same matrix).
    const c = scene.clone(true);

    // ── Step 1: bake recentering INTO the geometry ────────────────
    //
    // The naive approach is `c.position.sub(center)`, which puts the
    // recenter offset on the GROUP's translate. Three.js renders
    // groups in TRS order (Translate × Rotate × Scale applied to
    // children), so the group's translate is NOT affected by
    // subsequent rotations/scales we apply to the same group. The
    // group's translate also doesn't get scaled.
    //
    // Concrete failure mode: if the GLB's children sit at offset
    // (1, 0.3, 0.75) (because the asset author didn't center the
    // model), `c.position = (-1, -0.3, -0.75)` correctly recenters
    // the visible bbox at origin. But `c.scale.set(0.5, 0.5, 0.5)`
    // afterward scales the children (they collapse toward origin
    // by 0.5×) WITHOUT scaling the group's translate. Final result:
    // children land at (0.5, 0.15, 0.375) - (1, 0.3, 0.75) =
    // (-0.5, -0.15, -0.375). The mesh is now off-center.
    //
    // This was the actual root cause of v0.40.18's floating /
    // weirdly-positioned pieces: pieces were being correctly
    // measured + recentered + scaled, but the pivot order meant
    // the visible result drifted off origin by a scale-dependent
    // amount. The bed in the v0.40.20 screenshot floated above the
    // floor for exactly this reason.
    //
    // The fix: walk the children and apply `geometry.translate(...)`
    // directly. This bakes the recenter into each mesh's geometry
    // so the group's transform starts pristine. Subsequent
    // scale + rotation operations pivot around origin correctly.
    let box = new THREE.Box3().setFromObject(c);
    const center0 = box.getCenter(new THREE.Vector3());
    c.traverse((obj) => {
      if (obj === c) return;
      if (obj instanceof THREE.Mesh && obj.geometry) {
        obj.geometry.translate(-center0.x, -center0.y, -center0.z);
      }
    });

    // ── Step 2: orient — minimal, light-touch ──────────────────────
    //
    // v0.40.22 strategy: trust the IMAGE PROMPT to deliver upright,
    // front-facing meshes. The prompt now says "front view, eye
    // level, upright orientation, sitting on its base" which makes
    // image-to-3D models output GLBs whose Y axis is reliably
    // vertical. With that upstream fix, the mesh code only needs to
    // do minimal cleanup:
    //
    //   (a) If the longest mesh axis is HORIZONTAL but lands on the
    //       wrong horizontal axis (X vs Z), rotate 90° around Y to
    //       swap them. This catches sofas/beds whose long axis came
    //       out E-W when the layout wanted N-S (or vice versa).
    //
    //   (b) Skip everything for nearly-cubic pieces (< 5% extent
    //       difference) — rotating those introduces spurious flips
    //       without improving the visual.
    //
    // I previously tried up-axis detection via vertex asymmetry +
    // heuristic flips. It worked for synthetic test shapes but
    // produced inconsistent results on real fal.ai meshes (whose
    // density distributions are noisy and don't match clean
    // furniture priors). Better to rely on the image-prompt
    // upstream and let users manually rotate the few pieces that
    // come out wrong (the floating rotation bubble makes that a
    // 1-click fix).
    const measure = (obj: THREE.Object3D): [number, number, number] => {
      const b = new THREE.Box3().setFromObject(obj);
      const s = b.getSize(new THREE.Vector3());
      return [s.x, s.y, s.z];
    };

    /** Bake a rotation matrix into the children's geometry AND
     *  positions, then reset their local matrices. This is the
     *  correct way to rotate a multi-mesh group around its group
     *  origin: each sub-mesh's `geometry.applyMatrix4(rot)` only
     *  rotates vertices around the SUB-mesh's local origin, but
     *  the sub-mesh sits at some non-zero `position` in the group's
     *  frame. We need to also rotate `position` by the same matrix.
     *
     *  Without this, sub-meshes spin in place around their own
     *  centers but the GROUP's spatial layout doesn't change —
     *  i.e., a 2-cushion stack stays stacked vertically even after
     *  a "90° around Z" call.
     *
     *  This was the same family of bug as the TRS-pivot translate
     *  issue from v0.40.21: applying transforms at the wrong level
     *  in the scene graph. */
    const bakeRotation = (m: THREE.Matrix4) => {
      c.traverse((node) => {
        if (node instanceof THREE.Mesh && node.geometry) {
          // Rotate the geometry (vertices around mesh-local origin).
          node.geometry.applyMatrix4(m);
          // Rotate the mesh's position (mesh's offset from group origin).
          node.position.applyMatrix4(m);
        }
      });
      c.updateMatrixWorld(true);
    };

    let dims = measure(c);

    // Step 2a: align longest mesh axis to longest requested axis,
    // ACROSS ALL 3 AXES (not just horizontal pair). v0.40.24 fix:
    //
    // The previous version only swapped between the two horizontal
    // axes (X ↔ Z). That handles the case where a sofa's long side
    // came back oriented N-S when the layout wanted E-W. But it
    // doesn't handle the more common failure: TripoSR returns a
    // piece whose longest extent is VERTICAL (Y) when the request
    // wanted a HORIZONTAL long piece (a loveseat 1.4m wide × 0.6m
    // tall, but the mesh comes back 0.6m wide × 1.4m tall — the
    // piece looks like 2 cushions stacked vertically).
    //
    // Without correction, the mesh ends up tall when the hit cube
    // is wide. The user reported exactly this: "by default it looks
    // like [tall vertical thing] but its collision box is [horizontal]."
    //
    // Fix: identify the mesh's longest axis (0=X, 1=Y, 2=Z) and the
    // request's longest axis. If they differ, rotate around the
    // axis that's NOT in either set. The result: longest mesh axis
    // ends up on the longest requested axis.
    //
    // After this primary alignment, do the horizontal-axis swap as
    // a SECONDARY check for cases where longest axes already match
    // but the secondary horizontal axis is wrong.

    const longestMeshAxis: 0 | 1 | 2 =
      dims[0] >= dims[1] && dims[0] >= dims[2] ? 0 : dims[1] >= dims[2] ? 1 : 2;
    const reqDims: [number, number, number] = [width, height, depth];
    const longestReqAxis: 0 | 1 | 2 =
      reqDims[0] >= reqDims[1] && reqDims[0] >= reqDims[2]
        ? 0
        : reqDims[1] >= reqDims[2]
          ? 1
          : 2;

    if (longestMeshAxis !== longestReqAxis) {
      // Rotate 90° around the third axis (the one that's neither
      // longestMeshAxis nor longestReqAxis). This swaps the longest
      // and second axes while leaving the third one alone.
      // {0,1} → 2 (Z); {0,2} → 1 (Y); {1,2} → 0 (X).
      const pair = new Set<number>([longestMeshAxis, longestReqAxis]);
      const rotAxis = !pair.has(0) ? 0 : !pair.has(1) ? 1 : 2;
      if (rotAxis === 0) {
        bakeRotation(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      } else if (rotAxis === 1) {
        bakeRotation(new THREE.Matrix4().makeRotationY(Math.PI / 2));
      } else {
        bakeRotation(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
      }
      dims = measure(c);
    }

    // Step 2b: secondary horizontal swap. After 2a, the LONGEST
    // axes match. If the request is L-shaped (length ≠ depth) and
    // the secondary horizontal extent doesn't match either, rotate
    // around Y to swap X and Z.
    const meshHorizMax = Math.max(dims[0], dims[2]);
    const meshHorizMin = Math.min(dims[0], dims[2]);
    const reqHorizMax = Math.max(width, depth);
    const reqHorizMin = Math.min(width, depth);
    const meshIsElongated =
      meshHorizMin > 0 && meshHorizMax / meshHorizMin > 1.05;
    const reqIsElongated = reqHorizMin > 0 && reqHorizMax / reqHorizMin > 1.05;
    if (meshIsElongated && reqIsElongated) {
      const meshLongHoriz = dims[0] >= dims[2] ? 0 : 2;
      const reqLongHoriz = width >= depth ? 0 : 2;
      if (meshLongHoriz !== reqLongHoriz) {
        bakeRotation(new THREE.Matrix4().makeRotationY(Math.PI / 2));
        dims = measure(c);
      }
    }

    // Step 2c: detect upside-down meshes and flip 180° around X.
    // v0.40.28 fix.
    //
    // TripoSR/Hunyuan3D output is non-canonical per their own docs
    // (the model "guesses" camera params). With the same prompt, two
    // generations of the same piece can come out one upright and one
    // upside-down. The image prompt and longest-axis matching above
    // pin orientation as much as possible from the image side, but
    // they don't catch the case where the mesh's longest axes are
    // already aligned with the request but Y is flipped.
    //
    // Heuristic: real furniture has VERTEX-DENSITY ASYMMETRY along
    // its vertical axis. The seat top, back panel, table top, base
    // plate — these are the LARGE FLAT SURFACES that carry most of
    // the mesh's vertices. Thin elements (legs, posts, lamp stems)
    // carry few vertices.
    //
    //   • Upright chair/sofa: dense vertices in upper bbox half
    //     (seat + back), sparse in lower half (4 thin leg posts).
    //   • Upside-down chair/sofa: dense vertices in lower bbox half
    //     (seat + back resting on floor), sparse in upper half
    //     (legs sticking up).
    //
    // We sample ~200 vertices, count how many fall above vs below
    // the bbox-Y center. If lower half has SUBSTANTIALLY more
    // vertices (1.5× threshold), the piece is upside-down — flip
    // 180° around X.
    //
    // The 1.5× threshold is conservative: legitimate variations
    // (like a tall lamp where the heavy base is at the bottom) might
    // cause false positives, but those tend to NOT trigger the 1.5×
    // cutoff because their vertex distribution is more balanced.
    // Borderline cases stay unflipped; the user can manually pitch
    // 180° (two pitch clicks) if needed.
    {
      const yValues: number[] = [];
      c.updateMatrixWorld(true);
      c.traverse((node) => {
        if (node instanceof THREE.Mesh && node.geometry) {
          const pos = node.geometry.attributes.position;
          if (!pos) return;
          const stride = Math.max(1, Math.floor(pos.count / 200));
          for (let i = 0; i < pos.count; i += stride) {
            const v = new THREE.Vector3()
              .fromBufferAttribute(pos, i)
              .applyMatrix4(node.matrixWorld);
            yValues.push(v.y);
          }
        }
      });
      if (yValues.length >= 20) {
        // Bbox center is at origin (Step 1 baked it). Count vertices
        // above vs below Y=0.
        let above = 0,
          below = 0;
        for (const y of yValues) {
          if (y > 0) above++;
          else if (y < 0) below++;
        }
        // Flip if lower half is significantly denser.
        if (above > 0 && below / above > 1.5) {
          // 180° flip around X — sub-mesh positions and geometry
          // both rotated via the v0.40.24 bakeRotation helper.
          bakeRotation(new THREE.Matrix4().makeRotationX(Math.PI));
          dims = measure(c);
        }
      }
    }

    // ── Step 3: ISOTROPIC scale based on the longest-axis ratio ────
    //
    // Geometry is centered at origin (Step 1 baked it in), so scaling
    // pivots correctly. We use UNIFORM scale (same factor on all 3
    // axes) so the mesh's natural proportions are preserved. The
    // piece's bounding box may end up not exactly matching the
    // requested width × height × depth, but it'll look like a real
    // piece of furniture rather than a melted/squashed approximation.
    box = new THREE.Box3().setFromObject(c);
    const size = box.getSize(new THREE.Vector3());
    const longestCurrent = Math.max(size.x, size.y, size.z);
    const longestRequested = Math.max(width, height, depth);
    const uniformScale =
      longestCurrent > 0 ? longestRequested / longestCurrent : 1;
    c.scale.set(uniformScale, uniformScale, uniformScale);

    // ── Diagnostic logging (kept from v0.40.21, updated for v0.40.22)
    //
    // The user has rightly pushed back on multiple mesh "fixes" that
    // didn't work. Logging the actual runtime behavior so we can see
    // whether our orientation detection produced the right axis,
    // whether the final bbox is at origin, etc.
    //
    // Logged once per mesh load (not per frame) — useMemo gates it.
    const finalBox = new THREE.Box3().setFromObject(c);
    const finalCenter = finalBox.getCenter(new THREE.Vector3());
    const finalSize = finalBox.getSize(new THREE.Vector3());

    console.info("[mesh-fit]", {
      requested: { width, height, depth },
      longestMeshAxis:
        longestMeshAxis === 0 ? "X" : longestMeshAxis === 1 ? "Y" : "Z",
      longestReqAxis:
        longestReqAxis === 0 ? "X" : longestReqAxis === 1 ? "Y" : "Z",
      uniformScale: Number(uniformScale.toFixed(3)),
      finalCenter: [
        Number(finalCenter.x.toFixed(3)),
        Number(finalCenter.y.toFixed(3)),
        Number(finalCenter.z.toFixed(3)),
      ],
      finalSize: [
        Number(finalSize.x.toFixed(3)),
        Number(finalSize.y.toFixed(3)),
        Number(finalSize.z.toFixed(3)),
      ],
      centerOffsetMagnitude: Number(
        Math.hypot(finalCenter.x, finalCenter.y, finalCenter.z).toFixed(4),
      ),
    });

    return c;
  }, [scene, width, height, depth]);

  return <primitive object={cloned} />;
}

/** Public component. Resolves GLB URL through the cache, then
 *  Suspense-wraps for the actual load. */
export function GeneratedPieceMesh({
  glbUrl,
  starredGlbKey,
  width,
  depth,
  height,
  color,
}: GeneratedPieceMeshProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // v0.40.32: pass the starred bucket key so the resolver checks
    // that bucket FIRST. When set, this is what guarantees the mesh
    // loads even after the original fal.ai URL has expired.
    getOrFetchGLB(glbUrl, starredGlbKey)
      .then((url) => {
        if (!cancelled) setResolvedUrl(url);
      })
      .catch(() => {
        // getOrFetchGLB shouldn't reject (it falls back internally),
        // but defensive: if it does, fall back to the raw URL so
        // useGLTF gets a chance to try its luck.
        if (!cancelled) setResolvedUrl(glbUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [glbUrl, starredGlbKey]);

  if (!resolvedUrl) {
    return (
      <FallbackBox width={width} depth={depth} height={height} color={color} />
    );
  }

  return (
    <ErrorBoundary
      fallback={
        <FallbackBox
          width={width}
          depth={depth}
          height={height}
          color={color}
        />
      }
    >
      <Suspense
        fallback={
          <FallbackBox
            width={width}
            depth={depth}
            height={height}
            color={color}
          />
        }
      >
        <GLBInner
          resolvedUrl={resolvedUrl}
          width={width}
          depth={depth}
          height={height}
        />
      </Suspense>
    </ErrorBoundary>
  );
}

/** Solid colored box at the piece's exact dimensions. Used for both
 *  the loading state and the error fallback so the visible footprint
 *  is identical either way. */
function FallbackBox({
  width,
  depth,
  height,
  color,
}: Omit<GeneratedPieceMeshProps, "glbUrl">) {
  return (
    <mesh>
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} />
    </mesh>
  );
}

/** Minimal error boundary specific to GLB load failures. We can't use
 *  a generic boundary because R3F's reconciler treats throws inside
 *  useGLTF as scene-level — without this, one bad GLB unmounts the
 *  whole apartment. */
interface ErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
}
class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  // `declare` so TS knows these come from React.Component without
  // emitting class-field initializers (which would shadow base class
  // setup). Equivalent to the standard React class-component pattern;
  // we use it explicitly here because our tsconfig doesn't have
  // `useDefineForClassFields` set the way @types/react expects.
  declare state: ErrorBoundaryState;
  declare props: ErrorBoundaryProps;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (typeof console !== "undefined") {
      console.warn(
        "[GeneratedPieceMesh] GLB load failed, using fallback box:",
        error.message,
      );
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
