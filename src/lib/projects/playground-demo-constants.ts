import type { Project } from "@studio/projects/types";
import {
  STUDIO_PLAYGROUND_PATH_PREFIX,
  isStudioPlaygroundPathname,
} from "@/lib/routes/studio-playground-path";

/**
 * Default first-boot project — empty 3D + empty 2D reference.
 * `POST /api/studio/projects/ensure-starter` finds or creates a row with
 * this exact title (and `blankScene: true`) so the client can
 * default-select it.
 */
export const PLAYGROUND_BLANK_PROJECT_TITLE = "Blank Canvas" as const;

/**
 * Optional showcase project with apartamento.glb. Still created so it
 * appears in the switcher, but it is no longer the default focus.
 */
export const PLAYGROUND_DEMO_PROJECT_TITLE = "Demo apartment" as const;

/** True when this project is the apartamento.glb showcase. */
export function isPlaygroundDemoApartmentProject(
  project: { name?: string; blankScene?: boolean } | null | undefined,
): boolean {
  if (!project) return false;
  if (project.blankScene) return false;
  return project.name === PLAYGROUND_DEMO_PROJECT_TITLE;
}

/** Re-export for studio modules that already import this file. */
export {
  STUDIO_PLAYGROUND_PATH_PREFIX as PLAYGROUND_PATH_PREFIX,
  isStudioPlaygroundPathname as isPlaygroundPathname,
};

/** Matches `LOADING_PROJECT_PLACEHOLDER.name` in projects-slice — one string. */
export const STUDIO_PROJECTS_LOADING_NAME = "Loading…" as const;

function projectRowKey(p: Project): string {
  if (p.id) return p.id;
  return `${p.name}:${p.updated}`;
}

function sortStarterFirstUpdatedDesc(list: Project[]): Project[] {
  return [...list].sort((a, b) => {
    const rank = (p: Project) => {
      if (p.blankScene || p.name === PLAYGROUND_BLANK_PROJECT_TITLE) return 0;
      if (p.name === PLAYGROUND_DEMO_PROJECT_TITLE) return 1;
      return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return new Date(b.updated).getTime() - new Date(a.updated).getTime();
  });
}

/** Dedupe and sort (blank starter first, then demo, then `updated` desc). */
export function studioProjectsSortedDemoFirst(projects: Project[]): Project[] {
  const map = new Map<string, Project>();
  for (const p of projects) {
    map.set(projectRowKey(p), p);
  }
  return sortStarterFirstUpdatedDesc(Array.from(map.values()));
}

/**
 * Merge GET list with the ensured starter row, dedupe by id (or name+updated
 * fallback), sort blank starter first then demo then `updated` descending.
 */
export function studioProjectListFromBootstrap(
  raw: Project[],
  ensured: Project,
): Project[] {
  const map = new Map<string, Project>();
  for (const p of raw) {
    map.set(projectRowKey(p), p);
  }
  map.set(projectRowKey(ensured), ensured);
  return sortStarterFirstUpdatedDesc(Array.from(map.values()));
}
