"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "@studio/store";
import {
  magneticSnapMoving,
  resolveStudioY,
  snapNeighborsFor,
} from "@studio/collision/magneticSnap";

/**
 * Translation gizmo (Phase C2-redux extension). When the user
 * presses pointerdown on the currently-selected item's mesh body,
 * enters a drag mode that translates the item across the floor
 * plane in XZ. Releases on pointerup.
 *
 * Why this is its own component rather than a handler in Apartment:
 *   - It needs to disable/re-enable OrbitControls during the drag.
 *   - It needs document-level pointermove/pointerup listeners so the
 *     drag doesn't break if the cursor leaves the canvas.
 *   - It needs to participate in raycasting against arbitrary
 *     item meshes (not just the apartment root).
 *
 * Drag math (the redux pattern):
 *   1. On pointerdown, raycast from cursor through camera to the
 *      apartment's mesh tree. Walk up parents to find userData.itemId.
 *      If the hit item ISN'T the currently-selected one, ignore
 *      (don't steal clicks meant for selection-switching).
 *   2. Project the cursor onto the floor plane (Y=0). Record the
 *      offset from the projected point to the item's current
 *      centroid (item.x, item.z) — this is the "grab offset," the
 *      vector from where the user grabbed to where the item's
 *      origin lives. Preserving it keeps the grabbed point under
 *      the cursor for the entire drag.
 *   3. Disable OrbitControls so the orbit drag doesn't fire
 *      simultaneously.
 *   4. On pointermove, project cursor to floor again. New item
 *      position = cursorFloorPos - grabOffset. Write
 *      setItemTransform(id, {x, z}) — the Apartment subscriber
 *      picks it up and writes wrapper.position. No matrix math.
 *   5. On pointerup, re-enable OrbitControls and exit drag.
 *
 * Locked items aren't draggable — same rule as /api/arrange's
 * exclusion. The rotation gizmo lets the user rotate locked items
 * (rotation in place isn't a "move"); translation explicitly is,
 * so we skip the drag-to-translate flow for them. Visual cue: the
 * cursor stays as default rather than switching to "move."
 *
 * Bounds check: we don't clamp to the apartment bounds during drag.
 * The user can drag past walls; the F4 Health rule will flag the
 * item-outside-bounds violation. This matches the rotation gizmo's
 * behavior (no collision-aware blocking) and keeps the drag feel
 * fluid — you're not fighting the gizmo when you push past a wall.
 *
 * Magnetic edge snap: when a dragged edge comes within ~5 cm of
 * another placed piece, the piece jumps flush (like a magnet).
 * Hold Alt while dragging to suppress the snap.
 */

export function TranslationGizmo() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls);
  const scene = useThree((s) => s.scene);

  // Pull the selected item's id + its locked flag (drag is blocked
  // when locked). We re-read on each effect tick rather than
  // subscribing once because the drag handlers need a live view of
  // the latest selection at pointerdown time.
  const selectedId = useStore((s) => s.selectedId);
  const cameraMode = useStore((s) => s.cameraMode);
  const tourActive = useStore((s) => s.tourActive);

  // Drag state — refs so the listeners read live values without
  // closures going stale.
  const dragging = useRef(false);
  const draggedItemId = useRef<string | null>(null);
  const grabOffsetX = useRef(0);
  const grabOffsetZ = useRef(0);

  // Floor plane reference for ray-plane intersection. Y=0 plane;
  // matches the apartment shell's floor after normalize.ts.
  const floorPlane = useRef(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  ).current;

  useEffect(() => {
    // Drag is only active in orbit mode + when the tour isn't
    // playing. Walk mode has its own click-to-walk semantics; the
    // tour camera is purely cinematic.
    if (cameraMode !== "orbit" || tourActive) return;

    const dom = gl.domElement;

    /** Project a screen-pixel coordinate onto the Y=0 floor plane.
     *  Returns null if the ray misses (camera looking up at sky). */
    const projectToFloor = (
      clientX: number,
      clientY: number,
    ): THREE.Vector3 | null => {
      const rect = dom.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((clientY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(x, y), camera);
      const hit = new THREE.Vector3();
      if (!ray.ray.intersectPlane(floorPlane, hit)) return null;
      return hit;
    };

    /** Raycast through the scene at a screen-pixel coord and walk
     *  up parents from the topmost intersected mesh to find an
     *  ancestor with userData.itemId. Returns the item id, or null
     *  if no item was hit. */
    const pickItemAt = (clientX: number, clientY: number): string | null => {
      const rect = dom.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((clientY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(x, y), camera);
      const hits = ray.intersectObjects(scene.children, true);
      for (const hit of hits) {
        let node: THREE.Object3D | null = hit.object;
        while (node) {
          const id = (node.userData as { itemId?: unknown })?.itemId;
          if (typeof id === "string") return id;
          node = node.parent;
        }
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      // Only left mouse button. Right-click is for context menus
      // / camera pan. Middle is reserved for OrbitControls pan.
      if (e.button !== 0) return;

      // Only proceed if there's a current selection. The rule:
      // click an item once to select (no drag), then press the
      // selected item again to drag. This makes selection-switching
      // unambiguous — pressing on item B just selects it, doesn't
      // start a drag of B.
      const sel = useStore.getState().selectedId;
      if (!sel) return;

      const hitId = pickItemAt(e.clientX, e.clientY);
      // Press must be on the currently-selected item to enter drag.
      if (hitId !== sel) return;

      // Don't drag locked items.
      const item = useStore.getState().furniture.find((f) => f.id === sel);
      if (!item || item.locked) return;

      // Compute grab offset = where the cursor lands on the floor
      // MINUS the item's current centroid. Holding this offset
      // constant during the drag keeps the cursor over the same
      // point on the item.
      const floorPt = projectToFloor(e.clientX, e.clientY);
      if (!floorPt) return;
      grabOffsetX.current = floorPt.x - item.x;
      grabOffsetZ.current = floorPt.z - item.z;

      dragging.current = true;
      draggedItemId.current = sel;

      // Disable OrbitControls so the camera doesn't orbit during
      // the drag. We restore on pointerup. The `controls` ref is
      // populated by makeDefault on OrbitControls in Scene.tsx.
      if (controls && "enabled" in controls) {
        (controls as { enabled: boolean }).enabled = false;
      }

      dom.style.cursor = "grabbing";

      // Capture pointer so we keep getting move events even when
      // the cursor leaves the canvas. (The backup document-level
      // listeners catch any remaining edge cases.)
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        // Older browsers / non-pointer events can throw — safe to ignore.
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current || !draggedItemId.current) return;
      const floorPt = projectToFloor(e.clientX, e.clientY);
      if (!floorPt) return;
      const id = draggedItemId.current;
      const state = useStore.getState();
      const item = state.furniture.find((f) => f.id === id);
      if (!item) return;
      const proposed = {
        x: floorPt.x - grabOffsetX.current,
        z: floorPt.z - grabOffsetZ.current,
        studioY: resolveStudioY(item),
      };
      // Hold Alt to disable magnet while dragging.
      const snapped = e.altKey
        ? { x: proposed.x, z: proposed.z }
        : magneticSnapMoving(
            item,
            proposed,
            snapNeighborsFor(state.furniture, id),
          );
      state.setItemTransform(id, {
        x: snapped.x,
        z: snapped.z,
        ...(typeof snapped.studioY === "number"
          ? { studioY: snapped.studioY }
          : null),
      });
    };

    const onPointerUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      draggedItemId.current = null;
      dom.style.cursor = "";
      if (controls && "enabled" in controls) {
        (controls as { enabled: boolean }).enabled = true;
      }
    };

    // Hover affordance: change cursor to "grab" when hovering the
    // currently-selected item (only in orbit mode, only when not
    // already dragging, only on unlocked items). Gives users a
    // signal that the item is draggable.
    const onPointerHover = (e: PointerEvent) => {
      if (dragging.current) return;
      const sel = useStore.getState().selectedId;
      if (!sel) {
        if (dom.style.cursor === "grab") dom.style.cursor = "";
        return;
      }
      const hitId = pickItemAt(e.clientX, e.clientY);
      if (hitId === sel) {
        const item = useStore.getState().furniture.find((f) => f.id === sel);
        if (item && !item.locked) {
          dom.style.cursor = "grab";
          return;
        }
      }
      if (dom.style.cursor === "grab") dom.style.cursor = "";
    };

    dom.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointermove", onPointerHover);
    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointermove", onPointerHover);
      // If the component unmounts mid-drag, restore controls so we
      // don't leave OrbitControls stuck in disabled state.
      if (controls && "enabled" in controls) {
        (controls as { enabled: boolean }).enabled = true;
      }
    };
  }, [camera, gl, controls, scene, cameraMode, tourActive, floorPlane]);

  // The component renders nothing — it's a behavior-only mount.
  return null;
}
