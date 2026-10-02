"use client";

import { useStore } from "@studio/store";

export type StudioShellKind = "blank" | "generated" | "apartment";

/**
 * Matches Scene.tsx / MiniScene3D apartment-shell branching (single source).
 *
 * Rules:
 *   - projects not bootstrapped yet → blank (never flash Demo GLB)
 *   - blankScene + draft/generated roomMeta → synthetic shell
 *   - blankScene without roomMeta → empty canvas
 *   - room-director + roomMeta → generated synthetic shell
 *   - room-director without roomMeta → blank empty canvas
 *   - viewer → apartamento.glb
 */
export function useStudioShellKind(): StudioShellKind {
  return useStore((s) => {
    if (!s.projects.length || !s.currentProjectId) return "blank";

    const blank = Boolean(
      s.projects.find((p) => p.id === s.currentProjectId)?.blankScene,
    );
    if (blank) {
      return s.roomMeta != null ? "generated" : "blank";
    }
    if (s.sceneSource === "room-director") {
      return s.roomMeta != null ? "generated" : "blank";
    }
    return "apartment";
  });
}
