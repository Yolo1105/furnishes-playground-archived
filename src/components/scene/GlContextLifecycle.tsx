"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";

export type GlContextLifecycleProps = {
  /**
   * After context loss, if the GL is still lost after this delay (no
   * `webglcontextrestored`), remount the Canvas to acquire a fresh context.
   */
  remountIfLostAfterMs?: number;
  onRemountCanvas?: () => void;
};

/**
 * Browser GPU/driver resets can fire `webglcontextlost`. Without
 * `preventDefault`, restoration is blocked and R3F stays on a dead
 * GL — white viewport. On restore, force a frame so materials/textures
 * repopulate. Optional remount if the context never comes back.
 */
export function GlContextLifecycle({
  remountIfLostAfterMs = 900,
  onRemountCanvas,
}: GlContextLifecycleProps) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const lossTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = gl.domElement;
    const rawGl = gl.getContext() as WebGLRenderingContext | null;

    const clearLossTimer = () => {
      if (lossTimerRef.current) {
        clearTimeout(lossTimerRef.current);
        lossTimerRef.current = null;
      }
    };

    const onLost = (event: Event) => {
      event.preventDefault();
      if (!onRemountCanvas) return;
      clearLossTimer();
      lossTimerRef.current = setTimeout(() => {
        lossTimerRef.current = null;
        const stillLost = rawGl?.isContextLost?.() ?? true;
        if (stillLost) onRemountCanvas();
      }, remountIfLostAfterMs);
    };

    const onRestored = () => {
      clearLossTimer();
      invalidate();
    };

    el.addEventListener("webglcontextlost", onLost);
    el.addEventListener("webglcontextrestored", onRestored);
    return () => {
      clearLossTimer();
      el.removeEventListener("webglcontextlost", onLost);
      el.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [gl, invalidate, onRemountCanvas, remountIfLostAfterMs]);

  return null;
}
