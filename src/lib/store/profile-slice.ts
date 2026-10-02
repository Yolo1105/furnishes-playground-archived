import type { StateCreator } from "zustand";
import {
  normalizeSgHdbFlatType,
  normalizeSgHdbRoom,
  type SgHdbFlatType,
  type SgHdbRoom,
  type SgHdbProfile,
} from "@studio/profiles/sg-hdb";

/**
 * Profile slice — the user's optional generation context.
 *
 * v0.40.37 introduced this for Singapore HDB support. A "profile"
 * pins the architectural context Claude generates against — when the
 * user has selected "Singapore HDB 4-room master bedroom," every
 * subsequent room/interior generation uses those EXACT dimensions
 * and conventions instead of inventing them.
 *
 * v0.40.39 storage rework: profile is now PROJECT-SCOPED, not
 * globally sticky. Each project carries its own profile in its IDB
 * snapshot. The persistence layer (usePersistence.ts → applySnapshot)
 * hydrates `currentProfile` from the active project; the autosave
 * subscription persists changes back. This module no longer touches
 * localStorage directly.
 *
 * Why per-project (not global): a user designing their HDB flat in
 * one project shouldn't have that profile silently apply to a
 * separate "Western suburban house" project they open later. The
 * profile is project-level context, not a user preference.
 *
 * One-time migration: v0.40.38 stored the active profile in a global
 * localStorage key (`furnishes:active-profile@v1`). On first slice
 * creation we check that key — if a profile is there, we use it as
 * the initial value AND delete the key so we never read it again.
 * The autosave will pick up the seeded value on its next tick and
 * write it into the active project's snapshot, completing the
 * migration. After that, the key is gone and behavior is fully
 * project-scoped.
 *
 * Read pattern:
 *   const profile = useStore(s => s.currentProfile)
 *   if (profile?.kind === "sg-hdb") { ... use profile.flatType, profile.room ... }
 *
 * Write pattern:
 *   useStore.getState().setProfile({ kind: "sg-hdb", flatType: "4-room", room: "master_bedroom" })
 *   useStore.getState().setProfile(null)  // clear
 */

export type Profile = SgHdbProfile; // currently only one shape; union to extend later

export interface ProfileSlice {
  /** The active profile, or null when generation should run with no
   *  profile context (Claude invents room dimensions from the prompt
   *  as before). v0.40.39: hydrated from the active project's IDB
   *  snapshot by usePersistence. Initial state is null (or the
   *  one-time-migrated v0.40.38 legacy value). */
  currentProfile: Profile | null;
  /** Set or clear the active profile. Updates state only — the
   *  autosave subscription in usePersistence picks up the change
   *  and writes it to the active project's IDB snapshot. */
  setProfile: (profile: Profile | null) => void;
  /** Convenience: switch the flat type of an active SG HDB profile
   *  without losing the room selection. No-op if no profile or if
   *  the active profile isn't sg-hdb. */
  setSgHdbFlatType: (flatType: SgHdbFlatType) => void;
  /** Convenience: switch the room of an active SG HDB profile
   *  without losing the flat type. No-op if no profile or if the
   *  active profile isn't sg-hdb. */
  setSgHdbRoom: (room: SgHdbRoom) => void;

  /** Whether the profile-picker popover is open. Owned here in the
   *  slice (instead of inside ProfilePill's local useState) so other
   *  components — most importantly the ProfileDisclosure banner's
   *  "Change" button — can request the popover open WITHOUT going
   *  through a DOM custom event. */
  isPickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;

  /**  v0.40.41 — disclosure-banner dismissal flag. Set to true when the
   *   user clicks "×" on the disclosure banner. Banner stays hidden
   *   for the rest of this session.
   *
   *   Auto-resets to false whenever setProfile, setSgHdbFlatType, or
   *   setSgHdbRoom is called — any explicit profile change brings the
   *   banner back so the user always sees the new context at least
   *   once. (Without the auto-reset, the user could dismiss the banner,
   *   silently change to a different profile, and not see the new
   *   context confirmation.) */
  profileDisclosureDismissed: boolean;
  dismissProfileDisclosure: () => void;

  /** v0.40.41 — heuristic-suggestion-banner dismissal flag. Set to
   *  true by `dismissProfileSuggestion()` when the user clicks
   *  "Dismiss" on the suggestion banner that appears when their
   *  typed message contains HDB intent.
   *
   *  Session-scoped (not persisted to the snapshot). On reload the
   *  flag resets to false — if the user typed something like "HDB
   *  master bedroom" again, the banner reappears. This is the right
   *  trade-off because:
   *    - the banner is non-intrusive (small, with an explicit
   *      Dismiss button), so re-showing on reload is cheap;
   *    - users who really don't want the suggestion can also just
   *      pick "No profile" in the picker, which makes the suggestion
   *      irrelevant going forward (banner only shows when profile
   *      is null AND user typed HDB intent);
   *    - persisting per-project would require yet another snapshot
   *      schema bump, which isn't worth it for a session-scoped
   *      preference.
   *
   *  Reset to false automatically when `setProfile` is called — once
   *  the user explicitly chooses any profile (or clears one), the
   *  prior dismissal state is moot. */
  profileSuggestionDismissed: boolean;
  /** Mark the suggestion banner as dismissed for the rest of this
   *  session. Idempotent. */
  dismissProfileSuggestion: () => void;
}

const LEGACY_STORAGE_KEY = "furnishes:active-profile@v1";

/** v0.40.39 one-time migration: read the v0.40.38 global localStorage
 *  key and return its value if valid. Always deletes the key after
 *  reading — even when the value is invalid — so we never read it
 *  again on subsequent slice creations.
 *
 *  This runs ONCE per browser per device — the first time a v0.40.39+
 *  build initializes its store. After that the key is gone and this
 *  always returns null, which is the correct project-scoped default. */
function migrateLegacyProfileFromLocalStorage(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    // Always delete the key — even if parse fails. If it's corrupt
    // we don't want it lingering to fail again next time.
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage might be read-only (private mode, locked profile);
      // best-effort delete, proceed with the value either way.
    }
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { kind?: unknown }).kind !== "sg-hdb"
    ) {
      return null;
    }
    const p = parsed as { kind: string; flatType?: unknown; room?: unknown };
    const flatType =
      typeof p.flatType === "string"
        ? normalizeSgHdbFlatType(p.flatType)
        : null;
    const room = typeof p.room === "string" ? normalizeSgHdbRoom(p.room) : null;
    if (!flatType || !room) return null;
    // 3-room flats have only one common bedroom — if the legacy
    // value somehow stored common_bedroom_2 with 3-room (shouldn't
    // be possible since v0.40.38 only had common_bedroom, but
    // defensive), fall back to common_bedroom_1.
    const finalRoom =
      flatType === "3-room" && room === "common_bedroom_2"
        ? "common_bedroom_1"
        : room;
    return {
      kind: "sg-hdb",
      flatType,
      room: finalRoom,
    };
  } catch {
    return null;
  }
}

export const createProfileSlice: StateCreator<ProfileSlice> = (set, get) => ({
  // v0.40.39: initial value is whatever the legacy migration found
  // (null on fresh installs and on subsequent loads after migration
  // already ran). The persistence layer's hydrate path will OVERRIDE
  // this with the active project's saved profile shortly after the
  // store mounts — so this initial value only matters for the brief
  // window between store creation and project hydrate, OR when a
  // user is migrating from v0.40.38.
  currentProfile: migrateLegacyProfileFromLocalStorage(),
  isPickerOpen: false,
  // v0.40.41: starts false — the suggestion banner is allowed to
  // appear when the user types HDB intent. Reset to false whenever
  // setProfile is called (any explicit user choice supersedes the
  // session-scoped dismissal).
  profileSuggestionDismissed: false,
  // v0.40.41: starts false — the disclosure banner shows when a
  // profile is active. Reset to false on every profile mutation so
  // the user always sees the new context confirmation.
  profileDisclosureDismissed: false,

  setProfile: (profile) => {
    set({
      currentProfile: profile,
      profileSuggestionDismissed: false,
      profileDisclosureDismissed: false,
    });
  },

  setPickerOpen: (open) => set({ isPickerOpen: open }),

  dismissProfileSuggestion: () => set({ profileSuggestionDismissed: true }),

  dismissProfileDisclosure: () => set({ profileDisclosureDismissed: true }),

  setSgHdbFlatType: (flatType) => {
    const cur = get().currentProfile;
    if (!cur || cur.kind !== "sg-hdb") return;
    // 3-room flats have only ONE common bedroom. If the user is
    // currently set to common_bedroom_2 and switches to 3-room,
    // fall back to common_bedroom_1 so the resulting profile is
    // valid. Without this the profile would point to a (flat type,
    // room) combo that doesn't exist in SG_HDB_DATA — the prompt
    // builder would emit empty guidance and the orchestrator's
    // clamp would no-op.
    let nextRoom = cur.room;
    if (flatType === "3-room" && cur.room === "common_bedroom_2") {
      nextRoom = "common_bedroom_1";
    }
    set({
      currentProfile: { ...cur, flatType, room: nextRoom },
      // Mutation also resets the disclosure-dismiss so the user sees
      // confirmation of the new (flat type, room) combination.
      profileDisclosureDismissed: false,
    });
  },

  setSgHdbRoom: (room) => {
    const cur = get().currentProfile;
    if (!cur || cur.kind !== "sg-hdb") return;
    set({
      currentProfile: { ...cur, room },
      profileDisclosureDismissed: false,
    });
  },
});
