import type { StateCreator } from "zustand";
import {
  DEFAULT_ASSISTANT_ID,
  normalizeAssistantId,
  type EvaPersonaId,
} from "@/lib/eva/assistants/catalog";

const STORAGE_KEY = "furnishes.eva.activePersonaId";

function readStoredPersonaId(): EvaPersonaId {
  if (typeof window === "undefined") return DEFAULT_ASSISTANT_ID;
  try {
    return normalizeAssistantId(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_ASSISTANT_ID;
  }
}

function writeStoredPersonaId(id: EvaPersonaId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // quota / private mode — keep in-memory selection
  }
}

export type PersonaSaveState = "idle" | "saving" | "failed";

export interface PersonaSlice {
  /** Global active Eva persona — persists across conversations/visits. */
  activePersonaId: EvaPersonaId;
  /** True once client has hydrated from localStorage. */
  personaHydrated: boolean;
  personaSaveState: PersonaSaveState;
  /** Transient toast copy after a successful switch. */
  personaToast: string | null;
  /** Eva context panel (preferences + identity) open. */
  evaPanelOpen: boolean;
  /** Compact persona picker dialog/sheet open. */
  personaPickerOpen: boolean;
  /** Preference source inspector target preference id. */
  preferenceSourceId: string | null;
  /** Preference currently being edited (proposal or confirmed). */
  preferenceEditingId: string | null;

  hydratePersona: () => void;
  setActivePersonaId: (id: EvaPersonaId) => Promise<boolean>;
  setEvaPanelOpen: (open: boolean) => void;
  setPersonaPickerOpen: (open: boolean) => void;
  setPreferenceSourceId: (id: string | null) => void;
  setPreferenceEditingId: (id: string | null) => void;
  clearPersonaToast: () => void;
}

export const createPersonaSlice: StateCreator<PersonaSlice> = (set, get) => ({
  activePersonaId: DEFAULT_ASSISTANT_ID,
  personaHydrated: false,
  personaSaveState: "idle",
  personaToast: null,
  evaPanelOpen: false,
  personaPickerOpen: false,
  preferenceSourceId: null,
  preferenceEditingId: null,

  hydratePersona: () => {
    if (get().personaHydrated) return;
    set({
      activePersonaId: readStoredPersonaId(),
      personaHydrated: true,
    });
  },

  setActivePersonaId: async (id) => {
    const next = normalizeAssistantId(id);
    const prev = get().activePersonaId;
    if (next === prev) {
      set({ personaPickerOpen: false });
      return true;
    }

    set({ personaSaveState: "saving" });
    try {
      writeStoredPersonaId(next);
      const { getAssistantById } = await import("@/lib/eva/assistants/catalog");
      const def = getAssistantById(next);
      set({
        activePersonaId: next,
        personaSaveState: "idle",
        personaPickerOpen: false,
        personaToast: `Now chatting with ${def.name}`,
      });
      // Auto-clear toast.
      window.setTimeout(() => {
        if (get().personaToast?.startsWith("Now chatting")) {
          set({ personaToast: null });
        }
      }, 2800);
      return true;
    } catch {
      set({
        activePersonaId: prev,
        personaSaveState: "failed",
        personaToast:
          "Couldn’t switch Eva. Your previous assistant is still active.",
      });
      window.setTimeout(() => {
        set({ personaSaveState: "idle", personaToast: null });
      }, 3200);
      return false;
    }
  },

  setEvaPanelOpen: (open) =>
    set({
      evaPanelOpen: open,
      ...(open ? {} : { personaPickerOpen: false }),
    }),
  setPersonaPickerOpen: (open) => set({ personaPickerOpen: open }),
  setPreferenceSourceId: (id) => set({ preferenceSourceId: id }),
  setPreferenceEditingId: (id) => set({ preferenceEditingId: id }),
  clearPersonaToast: () => set({ personaToast: null }),
});
