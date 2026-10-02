// Project snapshot — the serializable shape of "the user's work" that
// gets written to IndexedDB on every meaningful change and rehydrated
// when a project is opened.
//
// Schema 3.1.0 (Turn 5+):
//   Added support for room-director-source projects (generated rooms).
//   Old viewer-source snapshots (schema-less, equivalent to "1.0.0")
//   are migrated forward by `migrateSnapshot` — they get
//   `sceneSource: "viewer"` and null roomMeta/walls/originalScene
//   defaults so existing user data continues to load cleanly.
//
// Two cases the snapshot must handle:
//
//   1. Viewer source (apartamento.glb-based projects, the existing
//      default): the GLB is the source of truth for geometry; we save
//      only the per-item transform overrides + visibility / placement
//      / locked state. On hydrate, the apartment GLB loads via
//      <Apartment>, seedFromGlb populates the furniture slice from
//      the catalog, then applySnapshot overlays our saved transforms.
//
//   2. Room-director source (AI-generated rooms, new in Turn 5): the
//      GLB doesn't exist server-side. We save the FULL furniture
//      array, plus roomMeta + walls + openings + styleBible, and the
//      `originalScene` snapshot baseline (for Reset-to-original).
//      On hydrate, applySnapshot writes the furniture array directly
//      and skips the seed-overlay logic (there's no seed to overlay).
//      The GLB cache (Turn 4) keeps the per-piece meshes available
//      across reloads so meshes don't re-fetch from fal.ai.
//
// What's IN a snapshot:
//   - Project metadata: id, name, createdAt, updatedAt, schemaVersion
//   - sceneSource — "viewer" | "room-director"
//   - For viewer: per-item transforms (just the deltas from seed)
//   - For room-director: full furniture array + roomMeta + walls +
//     openings + currentStyleBible + originalScene baseline
//   - Requirements (every field of the requirements-slice)
//   - Conversation (chat history)
//   - Generations (recent candidates + asset history)
//
// What's NOT in a snapshot:
//   - apartamento.glb walls (re-extracted on viewer load)
//   - Live mesh refs (rebound on load)
//   - UI flags / selection / tour state (transient)
//   - GLB blobs (kept separately in glb-cache)

import type { PlacedItem } from "@studio/store/furniture-slice";
import type { Conversation, ConversationTurn } from "@studio/store/types";
import type {
  ArrangeCandidate,
  AssetGeneration,
} from "@studio/store/generations-slice";
import type { BedAgainstWall } from "@studio/store/requirements-slice";
import type { Wall, Opening } from "@studio/floorplan/types";
import type { RoomMeta } from "@studio/director/adapter";
import type { StyleBible } from "@studio/director/schema";
import type { Preference } from "@studio/store/preferences-slice";

/** Current schema version. Bump when adding required fields; the
 *  migrator handles backfilling any older shape. */
export const CURRENT_SCHEMA_VERSION = "3.5.0" as const;

/** Per-item transform — the only piece of viewer-source state we save
 *  per piece (the apartment GLB is the source of geometry truth). */
export interface ItemSnapshot {
  id: string;
  x: number;
  z: number;
  rotation: number;
  placed: boolean;
  visible: boolean;
  locked: boolean;
}

/** A FULL piece definition for room-director projects. Everything the
 *  studio needs to recreate the piece without an apartment GLB to
 *  seed from. */
export interface FullItemSnapshot {
  id: string;
  label: string;
  category: string;
  shape: string;
  color: string;
  width: number;
  depth: number;
  height: number;
  x: number;
  z: number;
  rotation: number;
  locked: boolean;
  placed: boolean;
  visible: boolean;
  /** Generated-piece metadata (glbUrl, source, studioY, etc.).
   *  Carried verbatim. The hydrate path attaches this to the
   *  PlacedItem.meta field; FurnitureMeshes reads meta.glbUrl
   *  to mount the mesh through the GLB cache. */
  meta?: Record<string, unknown>;
}

export interface RequirementsSnapshot {
  presetName: string | null;
  mustInclude: Record<string, boolean>;
  optionalInclude: Record<string, boolean>;
  walkwayMinCm: number;
  doorClearance: boolean;
  windowAccess: boolean;
  bedAgainstWall: BedAgainstWall;
  flowVsStorage: number;
  opennessVsCozy: number;
}

/** Generated-room baseline frozen at generation time — what
 *  Reset-to-original restores. Only present for room-director
 *  projects that have completed a generation. */
export interface OriginalSceneSnapshot {
  sceneSource: "viewer" | "room-director";
  furniture: FullItemSnapshot[];
  roomMeta: RoomMeta | null;
  walls: Wall[];
  openings: Opening[];
  styleBible: StyleBible | null;
}

export interface ProjectSnapshot {
  /** Schema version this snapshot was written under. Old snapshots
   *  may be missing this field entirely; `migrateSnapshot` treats
   *  that as the legacy "1.0.0" shape and backfills defaults. */
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;

  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;

  /** Whether this project's geometry comes from /apartamento.glb
   *  ("viewer") or was generated by the AI pipeline ("room-director").
   *  Drives which hydrate branch runs. */
  sceneSource: "viewer" | "room-director";

  /** Viewer-source: per-item transform overrides on top of the seeded
   *  catalog items. ALWAYS present — even for room-director projects
   *  this stays as an empty array so the field is non-optional and
   *  TypeScript doesn't need branching everywhere. */
  items: ItemSnapshot[];

  /** Room-director-source: the full furniture array. Only populated
   *  for sceneSource === "room-director". Empty for viewer projects
   *  (which use `items` instead). */
  furnitureFull: FullItemSnapshot[];

  /** Room-director: room dimensions + bounds. null for viewer. */
  roomMeta: RoomMeta | null;

  /** Room-director: explicit walls (when the orchestrator emitted
   *  any). Empty for viewer (re-extracted from the GLB on load). */
  walls: Wall[];

  /** Room-director: openings (doors / windows / arches). Empty for
   *  viewer. */
  openings: Opening[];

  /** Room-director: the active StyleBible from the most recent
   *  generation. Used for follow-up single-piece generations. */
  styleBible: StyleBible | null;

  /** Room-director: frozen baseline for Reset-to-original. null
   *  until the first generation completes. */
  originalScene: OriginalSceneSnapshot | null;

  /** Optional reference image URL from the style anchor pass. */
  referenceImageUrl: string | null;

  requirements: RequirementsSnapshot;
  /** All conversations belonging to this project. Schema 3.2.0+ shape:
   *  multi-conversation support per project. Each entry contains its
   *  own turn list. Migration from 3.1.0 wraps the single
   *  `conversation` array into a single Conversation entry titled
   *  "Conversation 1". */
  conversations: Conversation[];
  /** ID of the conversation that was active when this snapshot was
   *  written. On hydrate, the slice restores this so the user
   *  returns to the same thread they left. May be null briefly during
   *  migration of a project that had no conversations yet. */
  activeConversationId: string | null;
  /** Schema 3.3.0+ — extracted user preferences with source attribution.
   *  See `preferences-slice.ts` for the full record shape. Default
   *  empty array on migrated snapshots. The brain reads this on
   *  every chat turn to ground the system prompt; see Turn 2c
   *  for the extractor that fills it. */
  preferences: Preference[];
  generations: {
    candidates: ArrangeCandidate[];
    appliedIndex: number | null;
    inspectIndex: number | null;
    history: Array<{
      id: string;
      generatedAt: number;
      candidates: ArrangeCandidate[];
      applied: boolean;
    }>;
    /** Asset generations from the chat's "Furniture" mode (Turn 3+).
     *  Each is a single piece tile in the Recent Generations bar. */
    assetGenerations: AssetGeneration[];
  };

  /** v0.40.39: per-project architectural profile. Pins the dimensions
   *  + architecture Claude clamps to when the user is in Room Layout
   *  or Interior Design mode. null when the user has no profile (the
   *  default — Claude invents dimensions from the prompt). Schema 3.5+
   *  field; older snapshots get null on migration.
   *
   *  Why per-project (not global): a user designing their HDB flat in
   *  one project shouldn't have that profile silently apply to a
   *  separate "Western suburban house" project they open later. The
   *  profile is project-level context, not a user preference. */
  profile: SerializedProfile | null;
}

/** Wire-format for the SG HDB profile. Mirrors the runtime SgHdbProfile
 *  shape but defined separately here so the persistence module
 *  doesn't import the profiles module (keeps the dep graph clean —
 *  persistence is a leaf concern). The applySnapshot writer validates
 *  this conforms to the runtime type before stamping it onto the
 *  store. */
export interface SerializedProfile {
  kind: "sg-hdb";
  flatType: string;
  room: string;
}

// ─── Builder ──────────────────────────────────────────────────────────

export interface BuildSnapshotInput {
  id: string;
  name: string;
  createdAt: number;
  furniture: readonly PlacedItem[];
  sceneSource: "viewer" | "room-director";
  roomMeta: RoomMeta | null;
  walls: readonly Wall[];
  openings: readonly Opening[];
  styleBible: StyleBible | null;
  originalScene: OriginalSceneSnapshot | null;
  referenceImageUrl: string | null;
  requirements: RequirementsSnapshot;
  /** All conversations for this project, plus active id. The builder
   *  filters to just the project's own conversations before writing. */
  conversations: readonly Conversation[];
  activeConversationId: string | null;
  /** All preferences for this project (Schema 3.3.0+). Same flat-
   *  array-then-filter pattern as conversations. */
  preferences: readonly Preference[];
  candidates: readonly ArrangeCandidate[];
  appliedIndex: number | null;
  inspectIndex: number | null;
  history: Array<{
    id: string;
    generatedAt: number;
    candidates: ArrangeCandidate[];
    applied: boolean;
  }>;
  assetGenerations: readonly AssetGeneration[];
  /** v0.40.39: the user's currently-selected SG HDB profile (or null
   *  when none). Threaded through the autosave path so the project
   *  snapshot carries it. */
  profile: SerializedProfile | null;
}

/** Build a snapshot from the current store state. The caller passes
 *  in the slice fields rather than this module reading the store
 *  directly — keeps the persistence layer testable + free of store
 *  coupling.
 *
 *  Branches on sceneSource for furniture serialization:
 *    - viewer: just the per-item transform deltas (small)
 *    - room-director: full piece definitions including meta.glbUrl
 *      so the GLB cache can resolve them on reload */
export function buildSnapshot(input: BuildSnapshotInput): ProjectSnapshot {
  const isRoomDirector = input.sceneSource === "room-director";

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    createdAt: input.createdAt,
    updatedAt: Date.now(),
    sceneSource: input.sceneSource,

    // Viewer path: light-weight transform deltas. Empty for room-
    // director (where the full furniture array carries the data).
    items: isRoomDirector
      ? []
      : input.furniture.map((f) => ({
          id: f.id,
          x: f.x,
          z: f.z,
          rotation: f.rotation,
          placed: f.placed,
          visible: f.visible,
          locked: f.locked,
        })),

    // Room-director path: full piece definitions. Only includes
    // pieces that came from a generation (meta.source ===
    // "room-director"). Pieces from a previous viewer state
    // wouldn't make sense to persist as full pieces.
    furnitureFull: isRoomDirector
      ? input.furniture
          .filter(
            (f) =>
              (f.meta as { source?: string } | undefined)?.source ===
              "room-director",
          )
          .map((f) => ({
            id: f.id,
            label: f.label,
            category: f.category,
            shape: f.shape,
            color: f.color,
            width: f.width,
            depth: f.depth,
            height: f.height,
            x: f.x,
            z: f.z,
            rotation: f.rotation,
            locked: f.locked,
            placed: f.placed,
            visible: f.visible,
            meta: f.meta,
          }))
      : [],

    roomMeta: isRoomDirector ? input.roomMeta : null,
    walls: isRoomDirector ? Array.from(input.walls) : [],
    openings: isRoomDirector ? Array.from(input.openings) : [],
    styleBible: isRoomDirector ? input.styleBible : null,
    originalScene: input.originalScene,
    referenceImageUrl: input.referenceImageUrl,

    requirements: input.requirements,
    // Persist only the conversations that belong to THIS project —
    // the slice holds all projects' conversations together for
    // simplicity, but the per-project snapshot scope filters them.
    // This keeps each snapshot small AND prevents cross-project
    // bleed when a user opens a project from a different device.
    conversations: input.conversations.filter((c) => c.projectId === input.id),
    activeConversationId: input.activeConversationId,
    preferences: input.preferences.filter((p) => p.projectId === input.id),
    generations: {
      candidates: input.candidates as ArrangeCandidate[],
      appliedIndex: input.appliedIndex,
      inspectIndex: input.inspectIndex,
      history: input.history,
      assetGenerations: Array.from(input.assetGenerations),
    },
    profile: input.profile,
  };
}

// ─── Migration ────────────────────────────────────────────────────────

/** Migrate a possibly-older snapshot to the current schema. Old
 *  snapshots from before Turn 5 didn't have a schemaVersion field;
 *  we treat their absence as the legacy "1.0.0" shape and backfill
 *  defaults that match the existing viewer-source behavior.
 *
 *  Forward-only migration is safe here because the studio only ever
 *  reads snapshots — never goes back to an older client. If we ever
 *  need backward compat (e.g. for export / share), we can write a
 *  reverse migrator at that point. */
export function migrateSnapshot(raw: unknown): ProjectSnapshot {
  if (!raw || typeof raw !== "object") {
    throw new Error("migrateSnapshot: input is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const version = obj.schemaVersion;
  const projectId = (obj.id as string) ?? `proj_${Date.now().toString(36)}`;

  // Helper: wrap a legacy single-array `conversation: ConversationTurn[]`
  // into a single Conversation entry. Preserves all turns, generates a
  // stable id, defaults the title to "Conversation 1". Used by the
  // 3.1.0 → 3.2.0 migration AND the legacy-shape migration.
  const wrapLegacyConversation = (
    turns: ConversationTurn[],
  ): { conversations: Conversation[]; activeConversationId: string | null } => {
    if (turns.length === 0) {
      // Empty — let the slice's seed handle it; persist no conversations.
      return { conversations: [], activeConversationId: null };
    }
    const id = `convo_${(obj.createdAt as number) ?? Date.now()}_legacy`;
    const earliest =
      turns.reduce(
        (min, t) => Math.min(min, typeof t.id === "number" ? t.id : Infinity),
        Infinity,
      ) || Date.now();
    const latest =
      turns.reduce(
        (max, t) => Math.max(max, typeof t.id === "number" ? t.id : 0),
        0,
      ) || Date.now();
    return {
      conversations: [
        {
          id,
          projectId,
          title: "Conversation 1",
          turns,
          createdAt: earliest === Infinity ? Date.now() : earliest,
          updatedAt: latest,
        },
      ],
      activeConversationId: id,
    };
  };

  // Already current — pass through after defensive defaulting on any
  // missing optional fields (in case the snapshot was written by a
  // mid-migration build that's missing some keys).
  if (version === CURRENT_SCHEMA_VERSION) {
    return {
      ...(obj as unknown as ProjectSnapshot),
      furnitureFull: (obj.furnitureFull as FullItemSnapshot[]) ?? [],
      roomMeta: (obj.roomMeta as RoomMeta | null) ?? null,
      walls: (obj.walls as Wall[]) ?? [],
      openings: (obj.openings as Opening[]) ?? [],
      styleBible: (obj.styleBible as StyleBible | null) ?? null,
      originalScene:
        (obj.originalScene as OriginalSceneSnapshot | null) ?? null,
      referenceImageUrl: (obj.referenceImageUrl as string | null) ?? null,
      conversations: (obj.conversations as Conversation[]) ?? [],
      activeConversationId: (obj.activeConversationId as string | null) ?? null,
      preferences: (obj.preferences as Preference[]) ?? [],
      generations: {
        ...(obj.generations as ProjectSnapshot["generations"]),
        assetGenerations:
          ((obj.generations as { assetGenerations?: AssetGeneration[] })
            ?.assetGenerations as AssetGeneration[]) ?? [],
      },
      profile: (obj.profile as SerializedProfile | null) ?? null,
    };
  }

  // 3.4.0 → 3.5.0: profile field added. Older snapshots default to
  // null (no profile). On first write after a user sets one, the
  // autosave path will populate it. The migration is one-line —
  // there's no per-turn or per-piece schema change beneath the
  // profile field, just a new top-level optional.
  if (version === "3.4.0") {
    return {
      ...(obj as unknown as ProjectSnapshot),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      profile: (obj.profile as SerializedProfile | null) ?? null,
    };
  }

  // 3.3.0 → 3.4.0: schema version bump only. The new
  // `attachmentGrounding` field on ConversationTurn is optional; old
  // turns simply leave it undefined ("we didn't record it") and the
  // brain pipeline starts populating it on new turns.
  //
  // Defensive default: 3.3.0 added `preferences: Preference[]` as a
  // required field, but a snapshot written by a mid-bump build might
  // be missing it. Falling back to `[]` is harmless — the brain just
  // sees a project with no extracted preferences yet.
  if (version === "3.3.0") {
    return {
      ...(obj as unknown as ProjectSnapshot),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      preferences: (obj.preferences as Preference[]) ?? [],
      generations: {
        ...(obj.generations as ProjectSnapshot["generations"]),
        assetGenerations:
          ((obj.generations as { assetGenerations?: AssetGeneration[] })
            ?.assetGenerations as AssetGeneration[]) ?? [],
      },
      profile: null,
    };
  }

  // 3.2.0 → 3.4.0: chain through 3.3.0 (preferences) plus 3.4.0
  // (no shape change). The brain's extractor (Turn 2c) populates
  // preferences on subsequent turns; older sessions just start with
  // no extracted preferences.
  if (version === "3.2.0") {
    return {
      ...(obj as unknown as ProjectSnapshot),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      preferences: [],
      generations: {
        ...(obj.generations as ProjectSnapshot["generations"]),
        assetGenerations:
          ((obj.generations as { assetGenerations?: AssetGeneration[] })
            ?.assetGenerations as AssetGeneration[]) ?? [],
      },
      profile: null,
    };
  }

  // 3.1.0 → 3.4.0: chain through 3.2.0 (multi-conversation), 3.3.0
  // (preferences), and 3.4.0 (no shape change). Done in one pass
  // since the data shape changes are all additive.
  if (version === "3.1.0") {
    const legacyTurns = (obj.conversation as ConversationTurn[]) ?? [];
    const wrapped = wrapLegacyConversation(legacyTurns);
    return {
      ...(obj as unknown as ProjectSnapshot),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      conversations: wrapped.conversations,
      activeConversationId: wrapped.activeConversationId,
      preferences: [],
      generations: {
        ...(obj.generations as ProjectSnapshot["generations"]),
        assetGenerations:
          ((obj.generations as { assetGenerations?: AssetGeneration[] })
            ?.assetGenerations as AssetGeneration[]) ?? [],
      },
      profile: null,
    };
  }

  // No schemaVersion → legacy shape (pre-Turn-5). Treat as viewer
  // source with empty room-director fields.
  const legacyGenerations = (obj.generations as
    | ProjectSnapshot["generations"]
    | undefined) ?? {
    candidates: [],
    appliedIndex: null,
    inspectIndex: null,
    history: [],
    assetGenerations: [],
  };
  const legacyTurns = (obj.conversation as ConversationTurn[]) ?? [];
  const wrapped = wrapLegacyConversation(legacyTurns);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: projectId,
    name: (obj.name as string) ?? "Untitled",
    createdAt: (obj.createdAt as number) ?? Date.now(),
    updatedAt: (obj.updatedAt as number) ?? Date.now(),
    sceneSource: "viewer",
    items: (obj.items as ItemSnapshot[]) ?? [],
    furnitureFull: [],
    roomMeta: null,
    walls: [],
    openings: [],
    styleBible: null,
    originalScene: null,
    referenceImageUrl: null,
    requirements:
      (obj.requirements as RequirementsSnapshot) ??
      ({
        presetName: null,
        mustInclude: {},
        optionalInclude: {},
        walkwayMinCm: 75,
        doorClearance: true,
        windowAccess: false,
        bedAgainstWall: "prefer",
        flowVsStorage: 0.5,
        opennessVsCozy: 0.5,
      } as RequirementsSnapshot),
    conversations: wrapped.conversations,
    activeConversationId: wrapped.activeConversationId,
    preferences: [],
    generations: {
      candidates: legacyGenerations.candidates ?? [],
      appliedIndex: legacyGenerations.appliedIndex ?? null,
      inspectIndex: legacyGenerations.inspectIndex ?? null,
      history: legacyGenerations.history ?? [],
      assetGenerations: legacyGenerations.assetGenerations ?? [],
    },
    profile: null,
  };
}
