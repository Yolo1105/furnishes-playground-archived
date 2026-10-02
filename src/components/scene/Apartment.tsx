"use client";

import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { normalizeScene } from "@studio/three/normalize";
import { useStore } from "@studio/store";
import { fetchCatalog } from "@studio/catalog/useCatalog";
import { extractWalls } from "@studio/floorplan/extract";

interface Props {
  url: string;
}

/**
 * Loads a GLB at the given URL, clones the scene graph (so we don't
 * mutate drei's cached original), normalizes it into viewer space,
 * and returns it as a `<primitive>` for R3F to render.
 *
 * Two side effects on top of rendering:
 *
 * 1. **Seeds the furniture-slice from the GLB.** Once the catalog
 *    JSON has loaded, walks each catalog entry's `nodeNames`, looks
 *    them up in this scene's mesh graph, and registers a PlacedItem
 *    per match. Result: the moment Apartment mounts, the Inventory
 *    tool can show every piece already in the apartment (~65 items)
 *    instead of an empty list.
 *
 * 2. **Subscribes to slice changes and drives mesh visibility.**
 *    For every PlacedItem, sets `mesh.visible = item.placed &&
 *    item.visible` on every ref. So the eye-toggle and trash
 *    actions in Inventory actually hide/show meshes in the
 *    apartment view; the Catalog's "Add" actions actually unhide
 *    them.
 *
 * Suspends while the GLB is downloading + parsed — wrap callers
 * in a `<Suspense>` boundary.
 */
export function Apartment({ url }: Props) {
  const { scene } = useGLTF(url);

  const root = useMemo(() => {
    // Clone so multiple instances (or HMR re-runs) don't double-apply
    // the normalization transform.
    const clone = scene.clone(true) as THREE.Object3D;
    normalizeScene(clone);
    return clone;
  }, [scene]);

  // ── Seed the furniture-slice once the GLB + catalog are both
  //    available. The slice's own `seeded` flag is the idempotency
  //    guard, so re-runs (HMR, remount) can't double-seed.
  const seedFromGlb = useStore((s) => s.seedFromGlb);
  const setWalls = useStore((s) => s.setWalls);
  const seeded = useStore((s) => s.seeded);

  useEffect(() => {
    if (seeded) return;
    let cancelled = false;
    fetchCatalog().then((index) => {
      if (cancelled) return;
      // Extract walls from the GLB structure mesh by slicing it at
      // chest height — same algorithm the zip uses, in world space.
      // We deliberately DON'T detect or render door openings: the
      // runtime gap-pair detector produces too many false positives
      // (any pair of non-collinear endpoints in the cross-section
      // can fall in the door-width range), so the arcs ended up
      // looking like noise. Plain walls + furniture is enough.
      const walls = extractWalls(root);
      const openings: never[] = [];

      // Compute the apartment's world-space (X, Z) center. Because
      // our normalize.ts no longer recenters X/Z (the zip explicitly
      // doesn't either, to keep walls + furniture coord-aligned in
      // the 2D plan), the apartment sits at whatever raw Blender
      // coords it was authored in. CameraController offsets its
      // presets by this center so the camera still looks at the
      // room rather than the world origin.
      root.updateMatrixWorld(true);
      const sceneBox = new THREE.Box3().setFromObject(root);
      const apartmentCenter: [number, number] = [
        (sceneBox.min.x + sceneBox.max.x) / 2,
        (sceneBox.min.z + sceneBox.max.z) / 2,
      ];

      // Two writes, one frame: walls-slice first so consumers that
      // subscribe to walls (FloorPlan2D, WalkControls) see the
      // payload as soon as furniture is seeded. Both fire inside
      // the same render-batch tick — no flicker.
      setWalls(walls, openings, root, apartmentCenter);
      seedFromGlb(index.items, root);
    });
    return () => {
      cancelled = true;
    };
  }, [root, seeded, seedFromGlb, setWalls]);

  // ── Drive each item's wrapper transform + mesh visibility from
  //    slice state. The C2-redux approach writes to per-item wrapping
  //    groups created by seedFromGlb, never to meshes' local transforms.
  //    This avoids the round-trip drift that broke the previous
  //    Phase C2 implementation.
  //
  //    Subscriber is imperative (not via useStore selector) so the
  //    React component doesn't re-render on every flip; only the
  //    Object3D properties change. The reference-equality guard
  //    (state.furniture === prev.furniture) keeps the work skipped
  //    on unrelated state changes (chat, ui flags, etc.).
  useEffect(() => {
    // Build a one-time index from itemId → wrapper Object3D. The
    // wrappers were created in seedFromGlb and added to the GLB
    // root with name `__item_wrapper_<id>` and userData.itemId.
    const wrappersById = new Map<string, THREE.Object3D>();
    root.traverse((node) => {
      const id = node.userData?.itemId;
      if (id && node.name?.startsWith("__item_wrapper_")) {
        wrappersById.set(id, node);
      }
    });

    const apply = () => {
      const items = useStore.getState().furniture;
      for (const item of items) {
        // Visibility — applied to each mesh (so eye-toggle hides
        // submeshes too).
        const wantVisible = item.placed && item.visible;
        for (const mesh of item.meshes) {
          if (mesh.visible !== wantVisible) mesh.visible = wantVisible;
        }
        if (!wantVisible) continue;

        // Transform — applied to the wrapper. Direct assignment;
        // no matrix math, no inversion, no decompose. Each call is
        // idempotent: writing the same value twice produces the
        // same wrapper position. There is no path for drift to
        // accumulate, because we never read the wrapper's current
        // transform — we always overwrite from `item.x`/`item.z`/
        // `item.rotation`, the canonical store values.
        const wrapper = wrappersById.get(item.id);
        if (!wrapper) continue;
        wrapper.position.x = item.x;
        wrapper.position.z = item.z;
        wrapper.rotation.y = (item.rotation * Math.PI) / 180;
      }
    };
    apply();

    const unsub = useStore.subscribe((state, prev) => {
      if (state.furniture === prev.furniture) return;
      apply();
    });
    return unsub;
  }, [root]);

  return (
    <primitive
      object={root}
      onClick={(e: any) => {
        // Click-to-select for furniture meshes. R3F propagates
        // pointer events through every intersected mesh in a
        // <primitive>. We walk up from the topmost intersected
        // mesh until we find a node tagged with userData.itemId
        // (set during seedFromGlb), then select that item.
        // stopPropagation prevents OrbitControls from interpreting
        // the click as the start of a drag-orbit.
        e.stopPropagation();
        let node: THREE.Object3D | null = e.object ?? null;
        while (node) {
          const id = (node.userData as any)?.itemId;
          if (typeof id === "string") {
            useStore.getState().selectFurniture(id);
            return;
          }
          node = node.parent;
        }
        // Click hit the apartment shell (walls/floor) — clear
        // selection so the Properties panel closes.
        useStore.getState().selectFurniture(null);
      }}
    />
  );
}

// Pre-warm drei's GLTF cache. Means the GLB starts downloading as soon
// as the module is imported, before <Apartment> mounts.
useGLTF.preload("/studio/apartamento.glb");
