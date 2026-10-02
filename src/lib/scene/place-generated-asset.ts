/**
 * place-generated-asset — drop a finished asset into the live scene
 * as a new PlacedItem.
 *
 * Was previously inlined inside RecentGenerationsBar; promoted to a
 * shared helper in v0.40.4 so chat-slice can also call it after a
 * generation lands (auto-placement). Without this auto-placement the
 * user had to click the tile in the Recent Generations bar manually,
 * which made the result feel disconnected from the generation flow.
 *
 * Position rules:
 *   - viewer-source: drop at the apartment's bounding-box midpoint
 *   - room-director: drop at world origin (the generated room is
 *     centered there by convention)
 *
 * The piece is auto-placed with `placed: true` + `visible: true` so
 * it appears immediately in the inventory panel and the 3D scene.
 *
 * NOTE: this helper does NOT call `selectFurniture` — auto-selection
 * was the source of the orange wireframe + selection circle that
 * appeared the moment a piece dropped, which the user found visually
 * noisy. They can click the piece if they want to manipulate it.
 */

import type { PieceRequest } from "@studio/director/schema";
import type { PlacedItem } from "@studio/store/furniture-slice";
import type { AssetGeneration } from "@studio/store/generations-slice";
import { useStore } from "@studio/store";

/** Drop the asset into the live scene as a new PlacedItem.
 *
 *  Returns the new piece's id so callers can frame the camera, fire
 *  analytics, or chain follow-up actions. */
export function placeGeneratedAssetIntoScene(
  asset: AssetGeneration,
  ctx: {
    apartmentCenter: [number, number] | null;
    sceneSource: "viewer" | "room-director";
  },
): string {
  // Pull the dimensions from the piece descriptor. If for any reason
  // the asset lacks a piece, fall back to a generic 1m cube so the
  // placement doesn't fail outright — the user can still drag it
  // and the GLB will scale to its bounding box.
  //
  // Director schema is z-UP (length=x, width=y, height=z).
  // Studio (Three.js) is y-UP (width=x, depth=z, height=y).
  // Mapping:
  //   studio.width = director.length  (longest horizontal axis)
  //   studio.depth = director.width   (other horizontal axis)
  //   studio.height = director.height (vertical, unchanged)
  const piece = asset.piece as PieceRequest | undefined;
  const dimsHint = piece?.dimensions_hint;
  const width = dimsHint?.length ?? 1.0;
  const depth = dimsHint?.width ?? 1.0;
  const height = dimsHint?.height ?? 1.0;

  // Drop at scene center. For viewer-source scenes that's the
  // apartment's bounding-box midpoint; for room-director it's
  // origin (the generated room is centered on origin by convention).
  let cx = 0;
  let cz = 0;
  if (ctx.sceneSource === "viewer" && ctx.apartmentCenter) {
    cx = ctx.apartmentCenter[0];
    cz = ctx.apartmentCenter[1];
  }

  // Clamp the piece's position so its bounding box stays INSIDE the
  // room. For room-director scenes, roomMeta gives us the inner-wall
  // bounds; we shrink them slightly by half the piece's footprint to
  // ensure the entire piece sits inside, plus a small clearance so
  // the piece doesn't kiss the wall.
  //
  // The user previously saw pieces extending visibly outside the
  // room walls (because the default x=0/z=0 drop didn't account for
  // the piece's own width/depth, and even small offsets could push
  // a 2.13m bed outside a 4m room). This clamp makes the default
  // placement always-inside.
  const roomMeta = (
    useStore.getState() as unknown as {
      roomMeta?: { minX: number; maxX: number; minZ: number; maxZ: number };
    }
  ).roomMeta;
  if (roomMeta) {
    const clearance = 0.1; // 10cm wall-clearance buffer
    const minCx = roomMeta.minX + width / 2 + clearance;
    const maxCx = roomMeta.maxX - width / 2 - clearance;
    const minCz = roomMeta.minZ + depth / 2 + clearance;
    const maxCz = roomMeta.maxZ - depth / 2 - clearance;
    // Only clamp if the room is actually large enough — if the piece
    // is bigger than the room (rare, but possible with weird user
    // input), leave it at room center and let the user adjust.
    if (minCx <= maxCx) cx = Math.max(minCx, Math.min(maxCx, cx));
    if (minCz <= maxCz) cz = Math.max(minCz, Math.min(maxCz, cz));
  }

  // Sit on the floor: studio Y for floor pieces is height/2.
  const studioY = height / 2;

  const newItem: PlacedItem = {
    id: asset.id,
    label: piece?.description ?? asset.label,
    category: "Generated",
    shape: "rect",
    color: "#D9826A", // soft accent — matches the app's terracotta
    width,
    depth,
    height,
    x: cx,
    z: cz,
    rotation: 0,
    locked: false,
    placed: true,
    visible: true,
    meshes: [],
    meta: {
      source: "room-director",
      glbUrl: asset.glbUrl,
      // v0.40.28: also persist the 2D image URL so the Reference
      // card can show "this is the 2D image that became the 3D
      // mesh" when the piece is selected.
      imageUrl: asset.imageUrl,
      // v0.40.32: when starred items are placed, forward the bucket
      // key so the resolver checks the dedicated starred bucket
      // FIRST. This is what guarantees starred meshes render even
      // after fal.ai URLs expire. Read off `asset` because the
      // StarredCard handler attaches it; for non-starred placements
      // (the default GenerationsCard path) it's undefined and the
      // resolver falls through to the regular cache.
      starredGlbKey: (asset as { starredGlbKey?: string }).starredGlbKey,
      isOnFloor: true,
      studioY,
    },
  };

  // Append (don't replace) — the asset joins whatever is already in
  // the scene. We write directly via useStore.setState to avoid
  // adding an `addFurniture` action just for this one call site.
  useStore.setState(
    (s) =>
      ({
        furniture: [
          ...((s as { furniture: PlacedItem[] }).furniture ?? []),
          newItem,
        ],
      }) as never,
  );

  return asset.id;
}

/**
 * Replace generation-source furniture in the scene with this asset.
 *
 * Used by the Generations tool card's "click a tile to show it on
 * screen" interaction. Semantics:
 *   - All currently-placed pieces with `meta.source === "room-director"`
 *     are removed (they're generation outputs from prior clicks).
 *   - Viewer-source pieces from the apartamento.glb scene are left
 *     untouched (they're not generation results, so replacing them
 *     would lose the user's editing of the demo apartment).
 *   - The clicked asset drops in as a fresh placement at scene center.
 *
 * If the same asset id is already in the scene, this is effectively
 * a no-op replace (clearing then re-adding the same id). Callers who
 * want different semantics ("don't re-add if already there") should
 * check the furniture array first.
 *
 * Returns the placed asset id (same as `asset.id`).
 */
export function replaceCurrentWithGeneratedAsset(
  asset: AssetGeneration,
  ctx: {
    apartmentCenter: [number, number] | null;
    sceneSource: "viewer" | "room-director";
  },
): string {
  // Step 1: remove every piece that came from the generation pipeline.
  // We identify them by `meta.source === "room-director"`, which is
  // the marker placeGeneratedAssetIntoScene() stamps on every newItem.
  // Viewer-source pieces (from apartamento.glb) lack this marker and
  // stay in place.
  useStore.setState((s) => {
    const all = (s as { furniture: PlacedItem[] }).furniture ?? [];
    const survivors = all.filter(
      (f) =>
        (f.meta as { source?: string } | undefined)?.source !== "room-director",
    );
    return { furniture: survivors } as never;
  });

  // Step 2: drop the new asset in. Reuses the same placement logic
  // so positioning, rotation, dimensions, and scale all match the
  // append path exactly — only the "what's there before" differs.
  return placeGeneratedAssetIntoScene(asset, ctx);
}
