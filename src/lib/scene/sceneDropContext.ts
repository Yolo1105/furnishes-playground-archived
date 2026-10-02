import * as THREE from "three";

/**
 * Module-level drop context for catalog → 3D floor placement.
 * Scene registers the live camera + canvas element; MainViewport
 * reads them on HTML5 drop to raycast client coords onto y=0.
 */

let camera: THREE.Camera | null = null;
let canvas: HTMLElement | null = null;

export function registerSceneDropTarget(
  nextCamera: THREE.Camera | null,
  nextCanvas: HTMLElement | null,
): void {
  camera = nextCamera;
  canvas = nextCanvas;
}

export function screenToFloorXZ(
  clientX: number,
  clientY: number,
): { x: number; z: number } | null {
  if (!camera || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;

  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  if (!Number.isFinite(hit.x) || !Number.isFinite(hit.z)) return null;
  return { x: hit.x, z: hit.z };
}
