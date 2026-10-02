import type { StateCreator } from "zustand";
import type { Project } from "@studio/projects/types";
import { STUDIO_PROJECTS_LOADING_NAME } from "@studio/projects/playground-demo-constants";
import type { Store } from "./store-types";
import { cancelGeneration } from "./chat-slice";
import { emptyConversation } from "./conversation-utils";

/**
 * Projects slice — list + current id, backed by `/api/studio/projects*`.
 */
/** Referentially stable — required for Zustand selectors with `useSyncExternalStore`. */
const LOADING_PROJECT_PLACEHOLDER: Project = {
  id: "",
  name: STUDIO_PROJECTS_LOADING_NAME,
  updated: "",
};

export interface ProjectsSlice {
  projects: Project[];
  currentProjectId: string;
  setCurrentProject: (id: string) => void;
  setCurrentProjectName: (name: string) => void;
  addProject: (name?: string) => void;
  deleteProject: (id: string) => void;
}

export const createProjectsSlice: StateCreator<Store, [], [], ProjectsSlice> = (
  set,
  get,
) => ({
  projects: [],
  currentProjectId: "",

  setCurrentProject: (id) => {
    set((s) => {
      if (!s.projects.some((p) => p.id === id)) return {};
      cancelGeneration();

      const newProjectConvos = (s.conversations ?? [])
        .filter((c) => c.projectId === id)
        .sort((a, b) => b.updatedAt - a.updatedAt);

      if (newProjectConvos.length > 0) {
        return {
          currentProjectId: id,
          activeConversationId: newProjectConvos[0].id,
        };
      }

      const seed = emptyConversation(id);
      return {
        currentProjectId: id,
        conversations: [...(s.conversations ?? []), seed],
        activeConversationId: seed.id,
      };
    });
  },

  setCurrentProjectName: (name) => {
    const trimmed = name.trim();
    const finalName = trimmed.length > 0 ? trimmed : "Untitled Space";
    const id = get().currentProjectId;
    if (!id) return;

    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, name: finalName, updated: "just now" } : p,
      ),
    }));

    void (async () => {
      const r = await fetch(`/api/studio/projects/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: finalName }),
      });
      if (!r.ok) {
        const list = await fetch("/api/studio/projects", {
          credentials: "include",
        });
        if (list.ok) {
          const data = (await list.json()) as { projects: Project[] };
          set({ projects: data.projects });
        }
      }
    })();
  },

  addProject: (name) => {
    void (async () => {
      const titleBase =
        name?.trim() || `New Project ${get().projects.length + 1}`;
      const r = await fetch("/api/studio/projects", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: titleBase }),
      });
      if (!r.ok) return;
      const data = (await r.json()) as { project: Project };
      const p = data.project;
      const seed = emptyConversation(p.id);
      set({
        projects: [
          { ...p, blankScene: p.blankScene ?? true },
          ...get().projects.filter((x) => x.id !== p.id),
        ],
        currentProjectId: p.id,
        conversations: [seed],
        activeConversationId: seed.id,
      });
    })();
  },

  deleteProject: (id) => {
    void (async () => {
      const r = await fetch(`/api/studio/projects/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) return;
      set((s) => {
        if (s.projects.length <= 1) return s;
        const next = s.projects.filter((p) => p.id !== id);
        const deletedCurrent = s.currentProjectId === id;
        const newCurrent = deletedCurrent ? next[0]!.id : s.currentProjectId;
        if (!deletedCurrent) {
          return {
            projects: next,
            conversations: (s.conversations ?? []).filter(
              (c) => c.projectId !== id,
            ),
          };
        }
        const seed = emptyConversation(newCurrent);
        return {
          projects: next,
          currentProjectId: newCurrent,
          conversations: [seed],
          activeConversationId: seed.id,
        };
      });
    })();
  },
});

export function selectCurrentProject(s: ProjectsSlice): Project {
  if (!s.projects.length) {
    return LOADING_PROJECT_PLACEHOLDER;
  }
  return s.projects.find((p) => p.id === s.currentProjectId) ?? s.projects[0]!;
}
