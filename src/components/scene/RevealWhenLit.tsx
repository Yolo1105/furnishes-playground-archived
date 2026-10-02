"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * Hide the WebGL canvas until drei <Environment> has bound
 * `scene.environment` and one extra frame has run (PMREM compile).
 *
 * meshStandardMaterial (the cabinet / panel surfaces) looks almost
 * black without an env map. Showing those meshes during the ~1s HDRI
 * fetch is the "dark then normal" flash on first load.
 */
export function RevealWhenLit() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const framesWithEnv = useRef(0);
  const revealed = useRef(false);

  useLayoutEffect(() => {
    const el = gl.domElement;
    el.style.opacity = "0";
    el.style.transition = "opacity 140ms ease-out";
    framesWithEnv.current = 0;
    revealed.current = false;
  }, [gl]);

  useFrame(() => {
    if (revealed.current) return;
    if (!scene.environment) {
      framesWithEnv.current = 0;
      return;
    }
    framesWithEnv.current += 1;
    if (framesWithEnv.current < 2) return;
    revealed.current = true;
    gl.domElement.style.opacity = "1";
  });

  return null;
}
