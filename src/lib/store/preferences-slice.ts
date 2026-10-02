import type { StateCreator } from "zustand";

/**
 * Preferences slice — the brain's memory of what the user has told it
 * about their taste, constraints, and goals.
 *
 * Schema 3.3.0 introduces this as a per-project array of structured
 * Preference records (NOT a flat string→string Map like eva uses).
 * Every record carries source attribution so we can audit + correct
 * extracted preferences without manual review of full conversation
 * transcripts.
 *
 * # Why structured records (Risk 4 mitigation)
 *
 * Eva extracts preferences as `Record<string, string>` — opaque, no
 * provenance. If a turn says "I want walnut" and the extractor stores
 * `{ "wood": "walnut" }`, we have no record of *which turn* said
 * that, *what the user actually wrote*, or *how confident* the
 * extractor was. The next turn the assistant says "since you
 * mentioned walnut" — but the user said "walnut maybe?" and now they
 * feel mis-quoted.
 *
 * Our records carry:
 *   - `value`: the canonical key/value pair the brain reads
 *   - `sourceText`: the exact substring of the user turn that
 *     produced this preference. Empty extraction → preference doesn't
 *     get stored. (Turn 2c enforces this.)
 *   - `sourceTurnId`: which turn produced it (per ConversationTurn.id)
 *   - `confidence`: the extractor's 0..1 self-rating
 *   - `status`: "provisional" (under threshold), "confirmed" (above
 *     threshold), or "rejected" (user contradicted, kept for audit)
 *   - `extractedAt` / `updatedAt` timestamps for ordering
 *
 * # Threshold-based persistence
 *
 * Turn 2c's extractor returns `confidence`. The persistence policy
 * (also in Turn 2c) is:
 *   - confidence < 0.7  → drop entirely
 *   - 0.7 <= conf < 0.9 → status = "provisional", persist
 *   - conf >= 0.9       → status = "confirmed", persist
 *
 * Provisional preferences appear in the prompt block but are
 * presented as "{key}: {value} (the user mentioned this; double-check
 * before relying)". Confirmed preferences appear without that hedge.
 *
 * # Two-strikes deletion (Risk 4)
 *
 * When a turn explicitly contradicts a stored preference ("not
 * walnut, oak"), the contradiction detector (Turn 2c) flips the
 * matching preference's `status` to "rejected" rather than deleting.
 * Audit trail preserved. The brain's prompt block excludes rejected
 * preferences. If the user reaffirms the original ("actually walnut
 * is fine"), the extractor adds a fresh provisional record — old
 * rejected one stays for history.
 *
 * # Cross-project scoping
 *
 * Each preference belongs to exactly one project (`projectId`).
 * Switching projects swaps which preferences are visible. The slice
 * stores ALL preferences across ALL projects in one flat array; the
 * `selectCurrentProjectPreferences` selector filters to the active
 * project. Same pattern as `conversations` from 0.34.0.
 */

export type PreferenceStatus = "provisional" | "confirmed" | "rejected";

export interface Preference {
  /** Stable ID for React keys + delete operations. Generated client-
   *  side: `pref_<base36-timestamp>_<rand>`. */
  id: string;
  /** Project the preference is scoped to. */
  projectId: string;

  /** Canonical key, lowercase snake_case. Examples:
   *    - "primary_style" → "japandi"
   *    - "preferred_wood" → "walnut"
   *    - "budget_range" → "moderate"
   *    - "must_include" → "workspace"
   *    - "deal_breaker" → "no chrome"
   *  Keys are free-form (extractor decides) so the brain can pick up
   *  whatever the user emphasised. We don't enforce a closed enum. */
  key: string;

  /** The value associated with the key. */
  value: string;

  /** Exact substring of the user turn that produced this preference.
   *  REQUIRED. Empty / missing source → preference rejected by the
   *  persistence policy. This is the primary anti-hallucination
   *  guardrail — without a verbatim quote the preference cannot
   *  enter the store. */
  sourceText: string;

  /** ConversationTurn.id (number) of the turn that produced this. */
  sourceTurnId: number;

  /** Extractor's self-rated confidence, 0.0 to 1.0. */
  confidence: number;

  /** Lifecycle status: provisional, confirmed, or rejected.
   *  Confirmed preferences appear in the prompt block as authoritative;
   *  provisional with a hedge; rejected excluded entirely. */
  status: PreferenceStatus;

  extractedAt: number;
  updatedAt: number;
}

export interface PreferencesState {
  /** All preferences across all projects. Selectors filter by
   *  projectId at read time. Cross-project queries (e.g. "what styles
   *  has this user liked across projects") are possible but not used
   *  in Turn 2; we kept the array flat in case future features need
   *  that visibility. */
  preferences: Preference[];
}

export interface PreferencesActions {
  /** Append a freshly-extracted preference. Caller has already run
   *  the threshold check + assigned the right status. */
  addPreference: (p: Preference) => void;

  /** Set status (e.g. promote provisional → confirmed when the user
   *  accepts a proposal, or flip → rejected on dismiss/contradiction). */
  setPreferenceStatus: (id: string, status: PreferenceStatus) => void;

  /** Update the stored value (edit-before-accept or edit confirmed). */
  updatePreferenceValue: (id: string, value: string) => void;

  /** Delete outright. Used by the user-review UI — NOT used
   *  by automated paths (those use status="rejected"). */
  deletePreference: (id: string) => void;

  /** Bulk-replace for hydrate. */
  setPreferences: (next: Preference[]) => void;

  /** Drop everything for a project (called when the project itself is
   *  deleted). */
  clearProjectPreferences: (projectId: string) => void;
}

export type PreferencesSlice = PreferencesState & PreferencesActions;

export const createPreferencesSlice: StateCreator<PreferencesSlice> = (
  set,
) => ({
  preferences: [],

  addPreference: (p) => set((s) => ({ preferences: [...s.preferences, p] })),

  setPreferenceStatus: (id, status) =>
    set((s) => ({
      preferences: s.preferences.map((p) =>
        p.id === id ? { ...p, status, updatedAt: Date.now() } : p,
      ),
    })),

  updatePreferenceValue: (id, value) =>
    set((s) => ({
      preferences: s.preferences.map((p) =>
        p.id === id
          ? { ...p, value: value.trim(), updatedAt: Date.now() }
          : p,
      ),
    })),

  deletePreference: (id) =>
    set((s) => ({ preferences: s.preferences.filter((p) => p.id !== id) })),

  setPreferences: (next) => set({ preferences: next }),

  clearProjectPreferences: (projectId) =>
    set((s) => ({
      preferences: s.preferences.filter((p) => p.projectId !== projectId),
    })),
});

/** Generate a fresh preference id. Mirrors `newConversationId` pattern. */
export function newPreferenceId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `pref_${ts}_${rand}`;
}

/** Selector: preferences for a specific project, filtered to non-rejected. */
export function selectProjectPreferences(
  s: PreferencesSlice,
  projectId: string,
): Preference[] {
  return s.preferences.filter(
    (p) => p.projectId === projectId && p.status !== "rejected",
  );
}

/** Selector: ALL preferences for a project including rejected ones
 *  (for audit / review UI). */
export function selectProjectPreferencesAll(
  s: PreferencesSlice,
  projectId: string,
): Preference[] {
  return s.preferences.filter((p) => p.projectId === projectId);
}

/** Pending proposals awaiting Accept / Dismiss. */
export function selectPendingPreferences(
  s: PreferencesSlice,
  projectId: string,
): Preference[] {
  return s.preferences.filter(
    (p) => p.projectId === projectId && p.status === "provisional",
  );
}

/** Confirmed (accepted) memory for the side panel. */
export function selectConfirmedPreferences(
  s: PreferencesSlice,
  projectId: string,
): Preference[] {
  return s.preferences.filter(
    (p) => p.projectId === projectId && p.status === "confirmed",
  );
}

/**
 * Eva `/api/chat` expects `preferences` as `Record<string, string>`.
 * Collapse structured Studio rows; duplicate keys keep the last value.
 */
export function preferencesToEvaRecord(
  list: Preference[],
): Record<string, string> | undefined {
  if (list.length === 0) return undefined;
  return Object.fromEntries(list.map((p) => [p.key, p.value] as const));
}
