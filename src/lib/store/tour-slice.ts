import type { StateCreator } from "zustand";

/**
 * Tour slice. Owns all camera-mode state and tour-playback state
 * that previously lived in `ui-flags-slice`. Lifted out because
 * (a) it's a self-contained sub-feature with its own well-defined
 * surface area, and (b) the zip has a dedicated tour-slice — aligning
 * here makes the planned tour-pathfinding port (Stage C / Phase F)
 * drop in cleanly.
 *
 * Three sub-systems live here:
 *
 *   1. **Camera mode** — `cameraMode` is "orbit" (default
 *      OrbitControls) or "walk" (first-person WASD + mouse-look).
 *      Scene routes between OrbitControls / WalkControls / TourCamera
 *      based on this and `tourActive`. `walkTeleportTarget` is a
 *      pending (x, z) destination consumed by WalkControls on its
 *      next frame — set when a floor hotspot is clicked.
 *
 *   2. **Waypoint placement** — `waypointMode` toggles the cursor
 *      to crosshair on the 2D plan; in this mode background-clicks
 *      drop pins via `addWaypoint`. `customWaypoints` holds the
 *      ordered list. Each pin renders as a numbered orange disk
 *      with a dashed connecting polyline showing visit order.
 *
 *   3. **Tour playback** — `tourActive` runs the camera through
 *      `tourPath` at fixed speed. `tourProgress` (0..1) is the live
 *      fraction along the path, written by TourCamera at 10 Hz so
 *      the progress overlay can subscribe without thrashing the
 *      frame rate. `tourDurationSec` is total flythrough duration
 *      (default 24s — long enough to register each room, short
 *      enough to feel snappy).
 *
 * `startTour` enforces minimum-2-waypoints, forces walk mode (so
 * orbit listeners detach), and clears any pending teleport so the
 * tour starts cleanly at waypoint 0 rather than wherever the last
 * hotspot click left it. `stopTour` resets path + progress.
 */
export interface TourSlice {
  // ── Camera mode ────────────────────────────────────────────────
  cameraMode: "orbit" | "walk";
  setCameraMode: (m: "orbit" | "walk") => void;
  walkTeleportTarget: { x: number; z: number } | null;
  setWalkTeleportTarget: (p: { x: number; z: number } | null) => void;

  // ── Waypoints ──────────────────────────────────────────────────
  waypointMode: boolean;
  setWaypointMode: (v: boolean) => void;
  customWaypoints: { id: string; x: number; z: number }[];
  addWaypoint: (p: { x: number; z: number }) => void;
  removeWaypoint: (id: string) => void;
  clearWaypoints: () => void;

  // ── Tour playback ──────────────────────────────────────────────
  tourActive: boolean;
  tourPath: Array<{ x: number; z: number }>;
  tourProgress: number;
  tourDurationSec: number;
  startTour: (path: Array<{ x: number; z: number }>) => void;
  stopTour: () => void;
  setTourProgress: (t: number) => void;
}

export const createTourSlice: StateCreator<TourSlice> = (set) => ({
  // ── Camera mode ────────────────────────────────────────────────
  cameraMode: "orbit",
  setCameraMode: (m) =>
    set((s) =>
      // Clear pending teleport when leaving walk mode so re-entry
      // doesn't snap to a stale target.
      s.cameraMode === m
        ? { cameraMode: m }
        : { cameraMode: m, walkTeleportTarget: null },
    ),
  walkTeleportTarget: null,
  setWalkTeleportTarget: (p) => set({ walkTeleportTarget: p }),

  // ── Waypoints ──────────────────────────────────────────────────
  waypointMode: false,
  setWaypointMode: (v) => set({ waypointMode: v }),
  customWaypoints: [],
  addWaypoint: ({ x, z }) =>
    set((s) => ({
      customWaypoints: [
        ...s.customWaypoints,
        {
          id: `wp_${Date.now().toString(36)}_${s.customWaypoints.length}`,
          x,
          z,
        },
      ],
    })),
  removeWaypoint: (id) =>
    set((s) => ({
      customWaypoints: s.customWaypoints.filter((w) => w.id !== id),
    })),
  clearWaypoints: () => set({ customWaypoints: [] }),

  // ── Tour playback ──────────────────────────────────────────────
  tourActive: false,
  tourPath: [],
  tourProgress: 0,
  tourDurationSec: 24,
  startTour: (path) =>
    set((s) =>
      path.length >= 2
        ? {
            tourActive: true,
            tourPath: path,
            tourProgress: 0,
            cameraMode: "walk" as const,
            walkTeleportTarget: null,
          }
        : s,
    ),
  stopTour: () =>
    set({
      tourActive: false,
      tourProgress: 0,
      tourPath: [],
    }),
  setTourProgress: (t) => set({ tourProgress: Math.max(0, Math.min(1, t)) }),
});
