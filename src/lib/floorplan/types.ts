/**
 * Architectural primitives used by the 2D floor plan.
 *
 * Wall + Opening records are produced at GLB-load time by
 * `lib/floorplan/extract.ts`, which slices the apartment's
 * structure mesh horizontally and detects door gaps between the
 * resulting wall endpoints. All coordinates land in **world
 * space** (matching the meshes' `Box3` reads), so the floor plan
 * can render walls and furniture together without any further
 * coordinate transforms.
 */
export interface Wall {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  thickness: number;
}

export type OpeningKind = "door" | "window";

export interface Opening {
  id: string;
  kind: OpeningKind;
  wallId: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  /** Door swing direction, only meaningful when `kind === "door"`. */
  swing?: "left" | "right";
}
