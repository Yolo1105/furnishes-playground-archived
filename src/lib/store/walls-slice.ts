import type { StateCreator } from "zustand";
import type * as THREE from "three";
import type { Wall, Opening } from "@studio/floorplan/types";

/**
 * Walls slice. Owns the apartment's spatial structure data
 * extracted from the GLB at seed time:
 *
 *   • `walls`           — line segments of the apartment shell
 *                         (extracted via cross-section at chest
 *                         height). Used by FloorPlan2D for the
 *                         outline render and by WalkControls /
 *                         the planned collision module for
 *                         spatial reasoning.
 *   • `openings`        — door gaps detected as non-collinear
 *                         endpoint pairs in the cross-section.
 *                         Currently empty (the runtime detector
 *                         produced too many false positives) but
 *                         the slot is reserved for when openings
 *                         get a proper extraction pass.
 *   • `apartmentRoot`   — reference to the cloned + normalized
 *                         GLB root Object3D. Used by FloorPlan2D
 *                         to derive footprints from world-space
 *                         bounding boxes, and by SelectionIndicator
 *                         to resolve the selected mesh.
 *   • `apartmentCenter` — X/Z midpoint of the apartment bounding
 *                         box in world coords. Used by camera
 *                         presets (offset to look at the
 *                         apartment) and by walk-mode entry to
 *                         spawn the user inside the room.
 *
 * Why this is its own slice (and not inside furniture-slice):
 *   1. Conceptual separation — walls are the apartment shell;
 *      furniture is what the user puts inside. Different lifecycles
 *      (walls fixed at seed, furniture mutable) and different
 *      consumers (collision module reads walls; inventory reads
 *      furniture).
 *   2. The zip's source-of-truth structure splits these too. Aligning
 *      now makes future ports drop in cleanly.
 *
 * Setters are minimal: walls are written once at seed time via
 * `setWalls`, never mutated afterwards. There's no per-wall edit
 * action — apartment editing isn't a current product feature.
 */
export interface WallsSlice {
  walls: Wall[];
  openings: Opening[];
  apartmentRoot: THREE.Object3D | null;
  apartmentCenter: [number, number] | null;

  /** Bulk-set the walls payload. Called from seedFromGlb in
   *  furniture-slice once the GLB has been parsed and walls
   *  extracted. Idempotent in practice — seedFromGlb itself
   *  guards on the `seeded` flag so this only runs once. */
  setWalls: (
    walls: Wall[],
    openings: Opening[],
    root: THREE.Object3D,
    center: [number, number],
  ) => void;
}

export const createWallsSlice: StateCreator<WallsSlice> = (set) => ({
  walls: [],
  openings: [],
  apartmentRoot: null,
  apartmentCenter: null,

  setWalls: (walls, openings, root, center) =>
    set({
      walls,
      openings,
      apartmentRoot: root,
      apartmentCenter: center,
    }),
});
