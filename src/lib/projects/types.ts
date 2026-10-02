/**
 * The Project type. Minimal fields needed by the top card and switcher.
 * Mirrors the JSX prototype's data shape: id + name + a hardcoded
 * relative-time string for the "switch project" dropdown.
 *
 * Future fields (phase, scene state, furniture, history) will land in
 * later steps as the product surfaces them.
 */
export interface Project {
  /** Stable identifier — used as the React key and the store's
   *  `currentProjectId` value. Lowercase kebab-case by convention. */
  id: string;
  /** Display name shown on the top card and inside the dropdown.
   *  Editable via the inline rename affordance on the card. */
  name: string;
  /** Pre-formatted relative-time string ("2h ago", "Yesterday",
   *  "3 days ago") shown next to each project in the switcher
   *  dropdown. Hardcoded for the demo; future steps will derive
   *  this from a real `lastEditedAt` timestamp. */
  updated: string;
  /** When true, this project boots with a completely empty scene —
   *  no apartamento.glb, no synthetic floor/walls, no seeded
   *  furniture. Used for the default test project so the user can
   *  exercise text-to-3D + chat against a blank canvas. The hydrate
   *  path checks this and sets `sceneSource: "room-director"` with
   *  `roomMeta: null` instead of the usual viewer-source default. */
  blankScene?: boolean;
}
