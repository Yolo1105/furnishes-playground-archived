import * as THREE from "three";

/**
 * Wall extraction ported from the zip's `viewer/Apartment.tsx`. Walks
 * every mesh whose name starts with `1_` or `3_` (apartment structure
 * + living-room walls), reads its triangle geometry in world space,
 * and slices each triangle by a horizontal plane at chest height
 * (`SLICE_Y = 1.2`). The intersection of each triangle with that
 * plane is a line segment — over the whole structure mesh, those
 * segments form the floor plan's wall outline.
 *
 * The crucial property: this is done in **world space** by reading
 * each vertex through `mesh.matrixWorld`. Whatever transforms the
 * Sketchfab/.fbx wrapper layers add, plus our `normalizeScene`
 * scale + translate, all get baked into the resulting wall
 * coordinates. So the output frame matches the frame any other
 * mesh-derived data uses (e.g. `Box3.expandByObject` over a
 * furniture mesh) — walls and furniture co-locate without further
 * coordinate gymnastics.
 *
 * After walls are extracted, `detectOpenings` scans pairs of wall
 * endpoints for gaps between 0.55 and 1.5 metres (typical door
 * width) — those gaps are recorded as `Opening` records of kind
 * `"door"` so the floor plan can draw a door arc through each.
 */

import type { Wall, Opening } from "./types";

/** Y elevation, in metres, at which we slice the structure mesh.
 *  1.2 m sits in the upper half of a typical wall — high enough
 *  to be above door thresholds and below window heads, so the
 *  cross-section captures door cuts cleanly without windows
 *  appearing as wall gaps. */
const SLICE_Y = 1.2;

/** Discard segments shorter than this. The structure mesh can have
 *  decorative micro-triangles (corner bevels, frame details) that
 *  shouldn't show up as walls. 5 cm is well below any real wall
 *  but above mesh noise. */
const MIN_SEGMENT_LENGTH = 0.05;

/** Doorway gap detection thresholds. */
const DOOR_MIN_GAP = 0.55;
const DOOR_MAX_GAP = 1.5;

/**
 * Extract wall segments from the apartment scene by intersecting
 * every structure-mesh triangle with the horizontal plane y = SLICE_Y.
 *
 * Iterates only meshes whose name starts with `1_` (`1_Structure`
 * etc.) or `3_` (`3_Living_Room`, `3_Closet`), matching the zip's
 * filter. Furniture meshes (`4_*`, `5_*`, `7_*`) are deliberately
 * skipped so the floor plan doesn't show a chair as a wall.
 */
export function extractWalls(root: THREE.Object3D): Wall[] {
  // Make sure all matrixWorlds are current — the apartment root may
  // have been normalized synchronously but its descendants' world
  // matrices won't reflect that until the next render unless we
  // force-update here.
  root.updateMatrixWorld(true);

  const segments: Wall[] = [];
  let nextId = 0;

  // Reusable scratch vectors so we don't allocate inside the
  // hot triangle loop.
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = mesh.name || "";
    if (!name.startsWith("1_") && !name.startsWith("3_")) return;

    const geo = mesh.geometry;
    if (!geo) return;
    const posAttr = geo.getAttribute("position");
    if (!posAttr) return;

    const index = geo.index;
    const triCount = index ? index.count / 3 : posAttr.count / 3;
    const worldMatrix = mesh.matrixWorld;

    for (let i = 0; i < triCount; i++) {
      let ia: number;
      let ib: number;
      let ic: number;
      if (index) {
        ia = index.getX(i * 3);
        ib = index.getX(i * 3 + 1);
        ic = index.getX(i * 3 + 2);
      } else {
        ia = i * 3;
        ib = i * 3 + 1;
        ic = i * 3 + 2;
      }

      vA.fromBufferAttribute(posAttr, ia).applyMatrix4(worldMatrix);
      vB.fromBufferAttribute(posAttr, ib).applyMatrix4(worldMatrix);
      vC.fromBufferAttribute(posAttr, ic).applyMatrix4(worldMatrix);

      // For each edge, find where (if anywhere) it crosses the
      // horizontal slice plane. An edge crosses if its two
      // endpoints sit on opposite sides of y = SLICE_Y.
      const pts: { x: number; z: number }[] = [];
      const edges: [THREE.Vector3, THREE.Vector3][] = [
        [vA, vB],
        [vB, vC],
        [vC, vA],
      ];
      for (const [p1, p2] of edges) {
        const d1 = p1.y - SLICE_Y;
        const d2 = p2.y - SLICE_Y;
        if (d1 > 0 !== d2 > 0) {
          // Lerp factor along the edge to the slice plane.
          const t = d1 / (d1 - d2);
          pts.push({
            x: p1.x + t * (p2.x - p1.x),
            z: p1.z + t * (p2.z - p1.z),
          });
        } else if (Math.abs(d1) < 0.001) {
          // Edge endpoint exactly on the plane — treat as a hit.
          pts.push({ x: p1.x, z: p1.z });
        }
      }

      // A triangle that crosses the plane gives us 2 intersection
      // points, which form a line segment. (One-point hits are
      // degenerate vertex-touches — discard.)
      if (pts.length >= 2) {
        const dx = pts[1].x - pts[0].x;
        const dz = pts[1].z - pts[0].z;
        if (Math.hypot(dx, dz) > MIN_SEGMENT_LENGTH) {
          segments.push({
            id: `cs_${nextId++}`,
            x1: pts[0].x,
            z1: pts[0].z,
            x2: pts[1].x,
            z2: pts[1].z,
            thickness: 0.15,
          });
        }
      }
    }
  });

  return segments;
}

/**
 * Detect door openings as gaps between non-collinear wall endpoints
 * sized like a typical doorway (0.55–1.5 m). For each candidate gap,
 * we check that no wall segment crosses it (otherwise it's not a
 * real opening). De-duplicates against earlier finds within 0.3 m.
 *
 * The returned `Opening` records have no `swing` direction set —
 * `doorArcPath` falls back to a default leaf orientation when swing
 * is undefined, which is fine for an apartment whose authored model
 * doesn't tell us which way each door swings.
 */
export function detectOpenings(walls: Wall[]): Opening[] {
  const endpoints: Array<{
    x: number;
    z: number;
    segIdx: number;
  }> = [];
  walls.forEach((seg, i) => {
    endpoints.push({ x: seg.x1, z: seg.z1, segIdx: i });
    endpoints.push({ x: seg.x2, z: seg.z2, segIdx: i });
  });

  const openings: Opening[] = [];
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const a = endpoints[i];
      const b = endpoints[j];
      // Don't pair endpoints of the same segment.
      if (a.segIdx === b.segIdx) continue;

      const gap = Math.hypot(a.x - b.x, a.z - b.z);
      if (gap < DOOR_MIN_GAP || gap > DOOR_MAX_GAP) continue;

      // The segment from a to b shouldn't be blocked by any
      // existing wall — that would make it a wall-on-wall meet,
      // not a doorway.
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const blocked = walls.some((w) => {
        // Distance from midpoint to wall line.
        const wlen = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
        if (wlen === 0) return false;
        const distToLine =
          Math.abs(
            (w.z2 - w.z1) * mx - (w.x2 - w.x1) * mz + w.x2 * w.z1 - w.z2 * w.x1,
          ) / wlen;
        // And the midpoint should fall within the wall's extent
        // (otherwise close-but-parallel walls don't count as blocks).
        const midDist = Math.hypot(
          mx - (w.x1 + w.x2) / 2,
          mz - (w.z1 + w.z2) / 2,
        );
        return distToLine < 0.15 && midDist < wlen / 2 + 0.1;
      });
      if (blocked) continue;

      // Skip near-duplicates (we'd otherwise double-detect each
      // gap from both endpoint pairings).
      const dup = openings.some(
        (o) => Math.hypot((o.x1 + o.x2) / 2 - mx, (o.z1 + o.z2) / 2 - mz) < 0.3,
      );
      if (dup) continue;

      // We don't have an authored wall id for this opening — the
      // FloorPlan2D doesn't actually need the wallId to draw the
      // arc (it derives geometry purely from the opening's two
      // endpoints), but the type requires the field. Empty string
      // makes it explicit that this opening was synthesized.
      openings.push({
        id: `door_${openings.length}`,
        kind: "door",
        wallId: "",
        x1: a.x,
        z1: a.z,
        x2: b.x,
        z2: b.z,
        height: 2.1,
      });
    }
  }
  return openings;
}
