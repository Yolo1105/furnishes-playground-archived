"use client";

import { useEffect, useRef } from "react";
import { useStore, type Store } from "@studio/store";
import {
  putProject,
  getProject,
  getLastActiveProjectId,
  setLastActiveProjectId,
  deleteProject as idbDeleteProject,
} from "./idb";
import {
  buildSnapshot,
  migrateSnapshot,
  type ProjectSnapshot,
  type SerializedProfile,
} from "./snapshot";
import type { PlacedItem } from "@studio/store/furniture-slice";
import { extractWalls } from "@studio/floorplan/extract";
import type { Opening, Wall } from "@studio/floorplan/types";
import { pullConversationsForProject } from "./conversation-sync";
import type { SgHdbProfile } from "@studio/profiles/sg-hdb";
import {
  normalizeSgHdbFlatType,
  normalizeSgHdbRoom,
} from "@studio/profiles/sg-hdb";
import {
  clearPlaygroundServerRevision,
  fetchPlaygroundSnapshotFromServer,
  getPlaygroundServerRevision,
  putPlaygroundSnapshotToServer,
  setPlaygroundServerRevision,
} from "./playground-server-snapshot-api";
import {
  isPlaygroundDemoApartmentProject,
  isPlaygroundPathname,
  PLAYGROUND_DEMO_PROJECT_TITLE,
} from "@studio/projects/playground-demo-constants";
import {
  isLegacyRoomDraft,
  roomMetaToCadDraft,
  upsertDraftPanelInFurniture,
} from "@studio/cad/draftRoom";

/** Viewer snapshots omit walls (re-derived from apartamento.glb).
 *  After `resetForNewProject` clears walls, `seeded` stays true so
 *  `Apartment` never re-runs `setWalls` — re-slice from the live GLB
 *  root so FloorPlan2D / Reference stay aligned with the 3D demo. */
function viewerWallsFromApartmentOrSlice(s: Store): {
  walls: Wall[];
  openings: Opening[];
} {
  const root = s.apartmentRoot;
  if (root) {
    root.updateMatrixWorld(true);
    return { walls: extractWalls(root), openings: [] };
  }
  return { walls: s.walls, openings: s.openings };
}

/** Validate a serialized profile from the snapshot before stamping it
 *  on the store. Defends against hand-edited or corrupted snapshots
 *  that might have invalid enums. Returns null when invalid — the
 *  store treats null as "no profile," same as a fresh project. */
function deserializeProfile(
  raw: SerializedProfile | null,
): SgHdbProfile | null {
  if (!raw) return null;
  if (raw.kind !== "sg-hdb") return null;
  const flatType = normalizeSgHdbFlatType(raw.flatType);
  const room = normalizeSgHdbRoom(raw.room);
  if (!flatType || !room) return null;
  // Defensive: 3-room flats don't have common_bedroom_2. If a
  // snapshot somehow stored that combo (manual edit, future bug),
  // fall back to common_bedroom_1 rather than letting the
  // orchestrator emit empty guidance later.
  const finalRoom =
    flatType === "3-room" && room === "common_bedroom_2"
      ? ("common_bedroom_1" as const)
      : room;
  return { kind: "sg-hdb", flatType, room: finalRoom };
}

/**
 * Autosave + hydrate orchestrator. Mounted once at the studio level
 * (Studio.tsx). Extended in Turn 5 for room-director projects:
 *
 *   - Hydrate gate is no longer just `seeded`. For room-director
 *     snapshots, `seeded` never flips because <Apartment> doesn't
 *     mount in that mode. We hydrate immediately after the IDB read
 *     completes when sceneSource === "room-director".
 *
 *   - Autosave subscribes to the new fields (sceneSource, roomMeta,
 *     walls, openings, originalScene, currentStyleBible,
 *     assetGenerations) so changes to any of those trigger a write.
 *
 *   - applySnapshot has two branches: viewer-source (overlay
 *     transforms onto seeded items, the existing path) and
 *     room-director-source (replace the furniture array directly +
 *     restore walls + openings + roomMeta + styleBible +
 *     originalScene).
 *
 *   - resetForNewProject also clears sceneSource → "viewer" so a
 *     brand-new project starts on the apartment GLB.
 *
 * GLB cache (Turn 4) handles the per-piece mesh persistence
 * separately. usePersistence only writes URL strings + metadata; the
 * actual binary blobs live in the GLB cache and don't bloat each
 * project snapshot.
 */

const DEBOUNCE_MS = 600;

/** v0.40.48: module-scoped flush hook so a project switch can force
 *  the still-pending debounced save for the OUTGOING project to run
 *  to completion BEFORE the new project's snapshot is applied.
 *
 *  The bug this fixes: a generation completes and updates `furniture`
 *  in the store, which fires the debounced save scheduler. If the
 *  user switches project within the 600ms debounce window, the
 *  project-switch effect re-runs `applySnapshot` against the new
 *  project's snapshot, overwriting `furniture` in memory. The
 *  pending timer then fires `save()`, reads `useStore.getState()` —
 *  which now contains the NEW project's data — and writes that to
 *  the NEW project. The OLD project's furniture is never persisted,
 *  so when the user switches back, their generation appears lost.
 *
 *  flushPendingSave runs the save synchronously (via Promise) BEFORE
 *  the effect proceeds. The save function reads `useStore.getState()`
 *  at call time, when state still reflects the OLD project, so the
 *  write goes to the correct project record. After flush, the timer
 *  is canceled so it doesn't fire a second time against the new
 *  project's state. */
let pendingFlush: (() => Promise<void>) | null = null;
export async function flushPendingPersistenceSave(): Promise<void> {
  if (pendingFlush) {
    const fn = pendingFlush;
    pendingFlush = null;
    await fn();
  }
}

export function usePersistence() {
  const hydrated = useRef(false);
  const currentProjectId = useStore((s) => s.currentProjectId);

  // ── Initial restore: read last-active project id from IDB and
  //    switch the slice to it before the hydrate effect runs.
  //
  //    Studio playground route intentionally skips this: ensure-starter
  //    + bootstrap default the blank canvas project so first paint is
  //    an empty 3D + empty 2D reference; users still switch freely
  //    during the session (including to Demo apartment). Last-active
  //    continues to update on save.
  //
  //    IMPORTANT: do not "pre-mount" the Demo GLB while waiting. Store
  //    defaults + useStudioShellKind stay on an empty shell until
  //    `currentProjectId` is set — otherwise Demo flashes then snaps
  //    to Blank Canvas when bootstrap finishes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (
          typeof window !== "undefined" &&
          isPlaygroundPathname(window.location.pathname)
        ) {
          return;
        }
        const lastId = await getLastActiveProjectId();
        if (cancelled || !lastId) return;
        const s = useStore.getState();
        if (
          s.projects.some((p) => p.id === lastId) &&
          s.currentProjectId !== lastId
        ) {
          s.setCurrentProject(lastId);
        }
      } catch {
        // Silent — IDB read failure isn't fatal.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Hydrate on initial mount AND on project switch ──────────────
  // Two-branch logic:
  //   1. Read the snapshot from IDB.
  //   2. If sceneSource === "room-director", hydrate immediately —
  //      no apartment GLB seed needed; the snapshot's
  //      `furnitureFull` IS the scene.
  //   3. If sceneSource === "viewer", wait for `seeded` to flip
  //      (apartment GLB load + seedFromGlb done) before applying
  //      transform overlays.
  //
  // We can't gate this whole effect on `seeded` like before — that
  // would block room-director hydrates indefinitely.
  useEffect(() => {
    if (!currentProjectId) {
      hydrated.current = false;
      return;
    }

    let cancelled = false;

    void (async () => {
      let localHydratedSnapshot: ProjectSnapshot | null = null;
      try {
        // v0.40.48: drain any in-flight debounced save for the
        // OUTGOING project before we read + apply the new one.
        // Without this, a 600ms-pending furniture write for project
        // A could fire AFTER applySnapshot replaces in-memory state
        // with project B's data, writing B's data to A's record.
        // (Or — worse — the schedule fires correctly to A's record
        // but only after applySnapshot has already replaced state,
        // so the write contains B's data; the sequencing here makes
        // the flush race-free.)
        await flushPendingPersistenceSave();
        if (cancelled) return;

        clearPlaygroundServerRevision(currentProjectId);

        const raw = await getProject<unknown>(currentProjectId);
        if (cancelled) return;

        // Determine whether this project is flagged as a blank-scene
        // project — checked early because the answer affects BOTH the
        // existing-snapshot branch (we ignore stale *viewer* snapshots
        // that were persisted before the project was flagged blank)
        // and the brand-new-project branch (we skip waitForSeed).
        //
        // Room-director snapshots on blank projects ARE applied — otherwise
        // Blank Canvas could never keep generated work across reloads.
        const projects = (
          useStore.getState() as unknown as {
            projects?: { id: string; name?: string; blankScene?: boolean }[];
          }
        ).projects;
        const currentProject = projects?.find((p) => p.id === currentProjectId);
        const isBlankScene = !!currentProject?.blankScene;
        const isDemoApartment = isPlaygroundDemoApartmentProject(currentProject);

        if (raw) {
          const snapshot = migrateSnapshot(raw);

          // Stale viewer snapshot on a blank project — discard.
          if (isBlankScene && snapshot.sceneSource === "viewer") {
            try {
              await idbDeleteProject(currentProjectId);
              console.info(
                `[persistence] cleared stale viewer snapshot for blank project ${currentProjectId}`,
              );
            } catch (err) {
              console.warn(
                `[persistence] failed to clear stale snapshot for ${currentProjectId}:`,
                err,
              );
            }
            resetForNewProject();
            hydrated.current = true;
          } else if (
            isBlankScene &&
            snapshot.sceneSource === "room-director"
          ) {
            // Blank CAD vs real generation. Polluted snapshots still
            // carried toilet/mirror + a single draft Panel — wipe those
            // and reseed the open-front cabinet.
            const furniture = snapshot.furnitureFull ?? [];
            const hasWalls = (snapshot.walls?.length ?? 0) > 0;
            const hasGeneratedGlb = furniture.some((f) => {
              const meta = (f as { meta?: { glbUrl?: string } }).meta;
              return typeof meta?.glbUrl === "string" && meta.glbUrl.length > 0;
            });
            const hasCarcass = furniture.some(
              (f) =>
                (f as { meta?: { source?: string }; id?: string }).meta
                  ?.source === "carcass-panel" ||
                Boolean((f as { id?: string }).id?.startsWith("carcass-")),
            );
            const legacyDraft = snapshot.roomMeta
              ? isLegacyRoomDraft(roomMetaToCadDraft(snapshot.roomMeta))
              : false;

            if (hasWalls || hasGeneratedGlb) {
              localHydratedSnapshot = snapshot;
              applySnapshot(snapshot);
              hydrated.current = true;
            } else if (hasCarcass && snapshot.roomMeta && !legacyDraft) {
              localHydratedSnapshot = snapshot;
              applySnapshot(snapshot);
              useStore
                .getState()
                .applyCadDraft(roomMetaToCadDraft(snapshot.roomMeta));
              hydrated.current = true;
            } else {
              try {
                await idbDeleteProject(currentProjectId);
                console.info(
                  `[persistence] reseed open-front box for blank ${currentProjectId}`,
                );
              } catch (err) {
                console.warn(
                  `[persistence] failed to clear blank snapshot for ${currentProjectId}:`,
                  err,
                );
              }
              resetForNewProject();
              hydrated.current = true;
            }
          } else if (
            !isDemoApartment &&
            !isBlankScene &&
            snapshot.sceneSource === "room-director" &&
            snapshot.roomMeta
          ) {
            // Non-demo project with a real generated room.
            localHydratedSnapshot = snapshot;
            applySnapshot(snapshot);
            hydrated.current = true;
          } else {
            // Viewer path — Demo apartment, or any non-blank without a
            // real room-director generation. Recovers Demo when a
            // corrupted room-director (null roomMeta) snapshot was saved.
            if (
              isDemoApartment &&
              snapshot.sceneSource === "room-director"
            ) {
              try {
                await idbDeleteProject(currentProjectId);
                console.info(
                  `[persistence] cleared corrupted room-director snapshot for ${PLAYGROUND_DEMO_PROJECT_TITLE}`,
                );
              } catch {
                // best-effort
              }
              localHydratedSnapshot = null;
            } else if (snapshot.sceneSource === "viewer") {
              localHydratedSnapshot = snapshot;
            } else {
              localHydratedSnapshot = null;
            }

            prepareViewerReseed();
            await waitForSeed();
            if (cancelled) return;
            if (localHydratedSnapshot?.sceneSource === "viewer") {
              applySnapshot(localHydratedSnapshot);
            }
            hydrated.current = true;
          }
        } else {
          // No IDB record yet — boot defaults (empty for blankScene).
          // For viewer projects, reset FIRST (sceneSource=viewer,
          // seeded=false) so Apartment mounts, THEN wait for seed so
          // Inventory + 2D walls exist before we mark hydrated.
          resetForNewProject();
          if (!isBlankScene) {
            await waitForSeed();
            if (cancelled) return;
          }
          hydrated.current = true;
        }

        // After the local hydrate (or reset), fire a server pull
        // to merge cross-device conversations + missing messages.
        // Best-effort — failures are silent and we keep the
        // local-only experience. This intentionally runs AFTER
        // applySnapshot so server rows merge on top of the local
        // view rather than racing it.
        //
        // Skip playground server snapshot merge for blank projects
        // that still have no local room-director content — otherwise
        // a stale viewer/demo snapshot on the server can fill the
        // empty canvas on first boot.
        //
        // Also skip merging corrupted room-director snaps onto Demo
        // apartment (that was wiping the GLB after a successful seed).
        if (!cancelled) {
          void pullConversationsForProject(currentProjectId);
          const skipServerSceneMerge =
            isDemoApartment ||
            (isBlankScene &&
              (localHydratedSnapshot == null ||
                localHydratedSnapshot.sceneSource !== "room-director"));
          if (!skipServerSceneMerge) {
            void mergeServerPlaygroundSnapshot(
              currentProjectId,
              localHydratedSnapshot,
            );
          } else if (isDemoApartment) {
            // Still refresh revision tracking without applying a bad snap.
            void fetchPlaygroundSnapshotFromServer(currentProjectId).then(
              (server) => {
                if (server.revision !== null) {
                  setPlaygroundServerRevision(currentProjectId, server.revision);
                }
              },
            );
          }
        }
      } catch (e) {
        console.warn("[persistence] hydrate failed", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  // ── Autosave (debounced, subscribes to all snapshot-relevant
  //    slices) ───────────────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const save = async () => {
      try {
        // Skip writes until the hydrate has run — otherwise we'd
        // overwrite the saved snapshot with the slice's freshly-
        // initialized empty defaults during the brief window
        // before applySnapshot fires.
        if (!hydrated.current) return;

        const s = useStore.getState();
        const project = s.projects.find((p) => p.id === s.currentProjectId);
        if (!project) return;

        const isDemo = isPlaygroundDemoApartmentProject(project);
        // Blank canvas with no generated room must not persist leaked
        // Demo walls / catalog furniture (that made Reference show the
        // demo 2D plan on an empty 3D shell).
        const blankEmpty =
          !!project.blankScene && !isDemo && s.roomMeta == null;

        const snapshot = buildSnapshot({
          id: project.id,
          name: project.name,
          createdAt:
            (project as { createdAt?: number }).createdAt ?? Date.now(),
          furniture: blankEmpty ? [] : s.furniture,
          // Demo apartment is always the GLB showcase — never persist a
          // corrupted room-director empty scene over it (that was why
          // switching back to Demo showed no 3D / no 2D).
          sceneSource: isDemo
            ? "viewer"
            : blankEmpty
              ? "room-director"
              : s.sceneSource,
          roomMeta: isDemo || blankEmpty ? null : s.roomMeta,
          walls: blankEmpty ? [] : s.walls,
          openings: blankEmpty ? [] : s.openings,
          styleBible: blankEmpty ? null : s.currentStyleBible,
          // Map the in-memory originalScene shape to the snapshot
          // shape. The slice's PlacedItem array maps cleanly to
          // FullItemSnapshot.
          originalScene:
            blankEmpty || !s.originalScene
              ? null
              : {
                  sceneSource: s.originalScene.sceneSource,
                  furniture: s.originalScene.furniture.map(plToFull),
                  roomMeta: s.originalScene.roomMeta,
                  walls: s.originalScene.walls,
                  openings: s.originalScene.openings,
                  styleBible: s.originalScene.styleBible,
                },
          referenceImageUrl: s.referenceImageUrl,
          requirements: {
            presetName: s.presetName,
            mustInclude: s.mustInclude,
            optionalInclude: s.optionalInclude,
            walkwayMinCm: s.walkwayMinCm,
            doorClearance: s.doorClearance,
            windowAccess: s.windowAccess,
            bedAgainstWall: s.bedAgainstWall,
            flowVsStorage: s.flowVsStorage,
            opennessVsCozy: s.opennessVsCozy,
          },
          conversations: s.conversations,
          activeConversationId: s.activeConversationId,
          preferences: s.preferences,
          candidates: s.candidates,
          appliedIndex: s.appliedIndex,
          inspectIndex: s.inspectIndex,
          history: s.history,
          assetGenerations: s.assetGenerations,
          // v0.40.39: persist the currently-active profile alongside
          // the rest of the project snapshot. Cross-slice read: the
          // store's typed `s` is just ChatSlice here, so cast through
          // unknown to access ProfileSlice's currentProfile (same
          // pattern used elsewhere in this file for cross-slice reads).
          profile: ((s as unknown as { currentProfile?: SgHdbProfile | null })
            .currentProfile ?? null) as SerializedProfile | null,
        });

        await putProject(snapshot);
        await setLastActiveProjectId(snapshot.id);

        const expectedRev = getPlaygroundServerRevision(snapshot.id);
        const remote = await putPlaygroundSnapshotToServer(
          snapshot.id,
          snapshot,
          expectedRev,
        );
        if (remote.ok) {
          setPlaygroundServerRevision(snapshot.id, remote.revision);
        } else if (
          remote.status === 409 &&
          typeof remote.currentRevision === "number"
        ) {
          setPlaygroundServerRevision(snapshot.id, remote.currentRevision);
        }
      } catch (e) {
        console.warn("[persistence] save failed", e);
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      // v0.40.48: register the save as the pending flush so a
      // project switch can drain it before applying the new
      // project's snapshot. We capture `save` itself (not a wrapper)
      // — when a flush runs, it reads useStore.getState() at the
      // moment of invocation, so an early flush on switch sees the
      // OLD project's data; a late timer-driven save sees the NEW
      // project's data and is harmless because we cancel the timer
      // inside flushPendingPersistenceSave.
      pendingFlush = async () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        await save();
      };
      timer = setTimeout(async () => {
        // When the timer fires naturally (no flush), clear
        // pendingFlush after running so subsequent flushes are no-ops
        // until the next schedule.
        pendingFlush = null;
        await save();
      }, DEBOUNCE_MS);
    };

    // Subscribe broadly. Each fires schedule() — debouncing means
    // a flurry of changes (rotation gizmo at 30Hz) collapses to one
    // write 600ms after the last change.
    const unsub = useStore.subscribe((state: Store, prev: Store) => {
      if (state.furniture !== prev.furniture) schedule();
      if (state.conversations !== prev.conversations) schedule();
      if (state.preferences !== prev.preferences) schedule();
      if (state.activeConversationId !== prev.activeConversationId) schedule();

      const reqEq =
        state.presetName === prev.presetName &&
        state.mustInclude === prev.mustInclude &&
        state.optionalInclude === prev.optionalInclude &&
        state.walkwayMinCm === prev.walkwayMinCm &&
        state.doorClearance === prev.doorClearance &&
        state.windowAccess === prev.windowAccess &&
        state.bedAgainstWall === prev.bedAgainstWall &&
        state.flowVsStorage === prev.flowVsStorage &&
        state.opennessVsCozy === prev.opennessVsCozy;
      if (!reqEq) schedule();

      if (state.candidates !== prev.candidates) schedule();
      if (state.appliedIndex !== prev.appliedIndex) schedule();
      if (state.history !== prev.history) schedule();
      if (state.assetGenerations !== prev.assetGenerations) schedule();

      const curProfile =
        (state as unknown as { currentProfile?: SgHdbProfile | null })
          .currentProfile ?? null;
      const prevProfile =
        (prev as unknown as { currentProfile?: SgHdbProfile | null })
          .currentProfile ?? null;
      if (curProfile !== prevProfile) schedule();

      if (state.currentProjectId !== prev.currentProjectId) schedule();
      if (state.sceneSource !== prev.sceneSource) schedule();
      if (state.roomMeta !== prev.roomMeta) schedule();
      if (state.walls !== prev.walls) schedule();
      if (state.openings !== prev.openings) schedule();
      if (state.currentStyleBible !== prev.currentStyleBible) schedule();
      if (state.originalScene !== prev.originalScene) schedule();

      if (state.projects !== prev.projects) {
        const prevIds = new Set<string>(prev.projects.map((p) => p.id));
        const nextIds = new Set<string>(state.projects.map((p) => p.id));
        prevIds.forEach((id) => {
          if (!nextIds.has(id)) {
            void idbDeleteProject(id).catch(() => {
              // best-effort
            });
          }
        });
        schedule();
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
    // We don't gate on `seeded` anymore — the autosave waits via
    // the `hydrated.current` guard inside save() instead. This lets
    // room-director projects autosave even though seedFromGlb never
    // fires for them.
  }, []);
}

/** Wait until the apartment has finished seeding. Used by the
 *  viewer-source hydrate path before overlaying transforms. Resolves
 *  immediately if `seeded` is already true. Times out so a missed
 *  Apartment mount can't hang project switches forever. */
function waitForSeed(timeoutMs = 12_000): Promise<void> {
  return new Promise((resolve) => {
    if (useStore.getState().seeded) {
      resolve();
      return;
    }
    const unsub = useStore.subscribe((s) => {
      if (s.seeded) {
        cleanup();
        resolve();
      }
    });
    const timer = setTimeout(() => {
      cleanup();
      console.warn(
        "[persistence] waitForSeed timed out — Apartment seed did not complete",
      );
      resolve();
    }, timeoutMs);
    function cleanup() {
      unsub();
      clearTimeout(timer);
    }
  });
}

/** Force viewer shell + clear seed so <Apartment> remounts and reseeds. */
function prepareViewerReseed() {
  useStore.setState({
    sceneSource: "viewer",
    roomMeta: null,
    seeded: false,
    furniture: [],
    walls: [],
    openings: [],
    apartmentRoot: null,
    apartmentCenter: null,
    selectedId: null,
    referencePreviewImageUrl: null,
    mainViewMode: "3d",
  } as never);
}

/** Convert a live PlacedItem to the FullItemSnapshot persistence
 *  shape. Identical fields except for `meshes` (which we drop —
 *  meshes are transient THREE refs that rebind on hydrate). */
function plToFull(f: PlacedItem) {
  return {
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
  };
}

/** Reverse of plToFull: build a PlacedItem from a FullItemSnapshot.
 *  meshes is empty array (live refs rebind via FurnitureMeshes /
 *  GeneratedPieceMesh on next render). */
function fullToPl(f: {
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
  meta?: Record<string, unknown>;
}): PlacedItem {
  return {
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
    meshes: [],
    meta: f.meta,
  };
}

/** Apply a saved snapshot to the live store. Branches on
 *  sceneSource — viewer overlays per-item transforms onto seeded
 *  catalog items; room-director writes the full furniture array
 *  directly. */
function applySnapshot(snapshot: ProjectSnapshot) {
  const s = useStore.getState();

  if (snapshot.sceneSource === "room-director") {
    // Direct write: replace furniture array, walls, openings,
    // roomMeta, styleBible, sceneSource, originalScene. The
    // GeneratedApartment + FurnitureMeshes components pick up
    // these on next render; the GLB cache resolves
    // meta.glbUrl asynchronously per piece.
    const restored: PlacedItem[] = snapshot.furnitureFull.map(fullToPl);
    const draftFromMeta = snapshot.roomMeta
      ? roomMetaToCadDraft(snapshot.roomMeta)
      : null;
    const hasCarcass = restored.some(
      (f) =>
        f.meta?.source === "carcass-panel" ||
        Boolean(f.id?.startsWith("carcass-")),
    );
    // Open-front box scenes already carry carcass panels — do not
    // inject a legacy single draft-panel on top.
    const furnitureWithRoom =
      draftFromMeta != null && !hasCarcass
        ? upsertDraftPanelInFurniture(restored, draftFromMeta)
        : restored;

    // originalScene needs its furniture array converted from
    // FullItemSnapshot to PlacedItem too.
    const originalSceneInMemory = snapshot.originalScene
      ? {
          sceneSource: snapshot.originalScene.sceneSource,
          furniture: snapshot.originalScene.furniture.map(fullToPl),
          roomMeta: snapshot.originalScene.roomMeta,
          walls: snapshot.originalScene.walls,
          openings: snapshot.originalScene.openings,
          styleBible: snapshot.originalScene.styleBible,
        }
      : null;

    // One atomic setState so subscribers don't see a half-applied
    // intermediate state (e.g. furniture is the new room but
    // sceneSource is still "viewer").
    useStore.setState({
      sceneSource: snapshot.sceneSource,
      roomMeta: snapshot.roomMeta,
      cadDraft: draftFromMeta,
      walls: snapshot.walls,
      openings: snapshot.openings,
      currentStyleBible: snapshot.styleBible,
      originalScene: originalSceneInMemory,
      referenceImageUrl: snapshot.referenceImageUrl,
      furniture: furnitureWithRoom,
    } as never);
  } else {
    // Viewer source: one atomic furniture write. Per-item
    // setItemTransform/toggle/remove used to fire dozens of Zustand
    // updates (each notifying subscribers), which could cascade into
    // React "Maximum update depth" during hydrate/merge. Mirror the
    // same end state in a single map.
    const seedById = new Map<string, (typeof s.furniture)[number]>(
      s.furniture.map((f) => [f.id, f]),
    );
    const itemById = new Map(snapshot.items.map((it) => [it.id, it]));
    const widerSel = s as unknown as { selectedId: string | null };
    let selectedId: string | null = widerSel.selectedId;

    const nextFurniture = s.furniture.map((f) => {
      const item = itemById.get(f.id);
      if (!item) return f;
      const seed = seedById.get(f.id);
      if (!seed) return f;

      let visible = item.visible;
      const locked = item.locked;
      let placed = item.placed;
      if (!seed.placed && item.placed) {
        placed = true;
        visible = true;
      }
      if (seed.placed && !item.placed) {
        placed = false;
        if (selectedId === f.id) selectedId = null;
      }

      return {
        ...f,
        x: item.x,
        z: item.z,
        rotation: item.rotation,
        visible,
        locked,
        placed,
      };
    });

    const shell =
      snapshot.walls.length > 0
        ? { walls: snapshot.walls, openings: snapshot.openings }
        : viewerWallsFromApartmentOrSlice(s);

    useStore.setState({
      furniture: nextFurniture,
      sceneSource: "viewer",
      roomMeta: null,
      walls: shell.walls,
      openings: shell.openings,
      currentStyleBible: snapshot.styleBible,
      originalScene: null,
      referenceImageUrl: snapshot.referenceImageUrl,
      selectedId,
    } as never);
  }

  // Requirements: replace whole slice atomically.
  s.hydrateRequirements(snapshot.requirements);

  // Conversations + active id. If the snapshot somehow has zero
  // conversations (legacy migration of an empty project), seed a
  // fresh empty one so the chat dock has something to render.
  let conversationsToRestore = snapshot.conversations;
  let activeIdToRestore = snapshot.activeConversationId;
  if (conversationsToRestore.length === 0) {
    const seed = {
      id: `convo_${Date.now().toString(36)}_seed`,
      projectId: snapshot.id,
      title: "Conversation 1",
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    conversationsToRestore = [seed];
    activeIdToRestore = seed.id;
  } else if (
    !activeIdToRestore ||
    !conversationsToRestore.some((c) => c.id === activeIdToRestore)
  ) {
    // Snapshot has conversations but the activeId is stale or
    // missing — pick the most-recently-updated one.
    activeIdToRestore = [...conversationsToRestore].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    )[0].id;
  }

  // Note: we MERGE this project's conversations with whatever's
  // already in the slice from other projects. The slice holds all
  // projects together; restoring this project shouldn't drop the
  // others.
  const existingFromOtherProjects = s.conversations.filter(
    (c) => c.projectId !== snapshot.id,
  );
  // Same merge for preferences (Schema 3.3.0+). Older snapshots
  // pre-3.3.0 will have `preferences` defaulted to [] by the
  // migrator, which means hydrating an old project drops no data
  // (because old projects had no preferences) AND doesn't clobber
  // preferences from other projects already in the slice.
  const existingPrefsFromOtherProjects = s.preferences.filter(
    (p) => p.projectId !== snapshot.id,
  );

  useStore.setState({
    conversations: [...existingFromOtherProjects, ...conversationsToRestore],
    activeConversationId: activeIdToRestore,
    preferences: [
      ...existingPrefsFromOtherProjects,
      ...(snapshot.preferences ?? []),
    ],
    candidates: snapshot.generations.candidates,
    appliedIndex: snapshot.generations.appliedIndex,
    inspectIndex: snapshot.generations.inspectIndex,
    history: snapshot.generations.history ?? [],
    assetGenerations: snapshot.generations.assetGenerations ?? [],
    // v0.40.39: project-scoped profile. Each project carries its
    // own currentProfile in its snapshot; switching projects
    // restores that project's profile (or null when none was set).
    // Validates the wire-format conforms to the runtime SgHdbProfile
    // before stamping it — defensive in case a hand-edited snapshot
    // contains a bad value.
    currentProfile: deserializeProfile(snapshot.profile ?? null),
    // v0.40.42: reset mainViewMode to 3D on every project switch.
    // Without this, if the user was in 2D when they switched
    // projects, the new project's 3D scene is hidden behind the 2D
    // floor plan — and worse, before the new project's walls /
    // furniture finish hydrating, the 2D plan briefly renders the
    // PREVIOUS project's geometry (because walls / furniture state
    // is shared). Resetting to 3D guarantees a clean visual switch
    // and the user can manually flip back to 2D after if they want.
    mainViewMode: "3d",
    // v0.40.48: also clear stale selection + reference-card preview
    // override. Without these, the prior project's selectedId may
    // refer to a piece that doesn't exist in the new project, and
    // the prior project's piece-image preview would leak into the
    // new project's Reference card on first paint. The user reported
    // this as "switch 2d/3d shows my demo one's 3d/2d" — the demo
    // override on the Reference card was sticking across projects.
    selectedId: null,
    referencePreviewImageUrl: null,
  } as never);
}

/**
 * After local hydrate, pull server playground snapshot when newer
 * (`updatedAt`), then refresh IndexedDB + revision for PUTs.
 */
async function mergeServerPlaygroundSnapshot(
  projectId: string,
  localSnapshot: ProjectSnapshot | null,
): Promise<void> {
  try {
    const server = await fetchPlaygroundSnapshotFromServer(projectId);
    if (server.revision === null) {
      return;
    }
    setPlaygroundServerRevision(projectId, server.revision);
    if (!server.snapshot) {
      return;
    }
    const srv = migrateSnapshot(server.snapshot);
    if (srv.id !== projectId) {
      console.warn(
        JSON.stringify({
          event: "playground_snapshot_project_mismatch",
          routeProjectId: projectId,
          snapshotProjectId: srv.id,
        }),
      );
      return;
    }
    if (!localSnapshot || srv.updatedAt > localSnapshot.updatedAt) {
      // Never demote Demo apartment (or any healthy viewer local) with an
      // empty room-director server snap.
      if (
        srv.sceneSource === "room-director" &&
        srv.roomMeta == null &&
        (!localSnapshot || localSnapshot.sceneSource === "viewer")
      ) {
        return;
      }
      applySnapshot(srv);
      await putProject(srv);
    }
  } catch (e) {
    console.warn("[persistence] server playground snapshot merge skipped", e);
  }
}

/** Reset transient state to defaults — used when switching to a
 *  brand-new project that has no IDB record yet. */
function resetForNewProject() {
  const s = useStore.getState();

  // Look up the current project to see whether it's flagged as
  // a blank-scene project. Blank-scene projects boot with an empty
  // 3D viewport (no apartamento.glb, no synthetic floor/walls) so
  // the user can exercise text-to-3D and chat against a clean
  // canvas. Generation outputs land here directly.
  const currentProjectId = (s as unknown as { currentProjectId?: string })
    .currentProjectId;
  const projects = (
    s as unknown as { projects?: { id: string; blankScene?: boolean }[] }
  ).projects;
  const isBlankScene = !!projects?.find((p) => p.id === currentProjectId)
    ?.blankScene;

  if (isBlankScene) {
    // Blank canvas: seed the default CAD square as a real 3D room
    // shell + Inventory "Panel" row (applyCadDraft).
    useStore.setState({
      sceneSource: "room-director",
      roomMeta: null,
      cadDraft: null,
      walls: [],
      openings: [],
      currentStyleBible: null,
      originalScene: null,
      referenceImageUrl: null,
      furniture: [],
      seeded: false,
      apartmentRoot: null,
      apartmentCenter: null,
      selectedId: null,
      referencePreviewImageUrl: null,
      mainViewMode: "3d",
    } as never);
    useStore.getState().applyCadDraft();
  } else {
    // Viewer-source path (apartamento.glb + seeded catalog).
    // Always re-seed from the GLB: do not reuse furniture/walls from
    // a prior blank or room-director project.
    useStore.setState({
      sceneSource: "viewer",
      roomMeta: null,
      cadDraft: null,
      walls: [],
      openings: [],
      currentStyleBible: null,
      originalScene: null,
      referenceImageUrl: null,
      furniture: [],
      seeded: false,
      apartmentRoot: null,
      apartmentCenter: null,
      mainViewMode: "3d",
      selectedId: null,
      referencePreviewImageUrl: null,
    } as never);
  }

  // Reset requirements + transient slices.
  s.resetRequirements();

  // For conversations: seed a fresh empty one for the new project,
  // dropping any conversations that belonged to it (there can't be
  // any if we're treating it as new, but be defensive). Other
  // projects' conversations stay in the slice.
  const projectId = (
    useStore.getState() as unknown as { currentProjectId?: string }
  ).currentProjectId;
  if (projectId) {
    const otherProjects = s.conversations.filter(
      (c) => c.projectId !== projectId,
    );
    const seed = {
      id: `convo_${Date.now().toString(36)}_seed`,
      projectId,
      title: "Conversation 1",
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    useStore.setState({
      conversations: [...otherProjects, seed],
      activeConversationId: seed.id,
      candidates: [],
      appliedIndex: null,
      inspectIndex: null,
      history: [],
      assetGenerations: [],
    } as never);
  } else {
    useStore.setState({
      candidates: [],
      appliedIndex: null,
      inspectIndex: null,
      history: [],
      assetGenerations: [],
    } as never);
  }
}
