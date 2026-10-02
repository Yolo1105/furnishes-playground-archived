/**
 * Starred slice — cross-project favorites store. v0.40.31.
 *
 * Why a separate slice and not part of generations-slice:
 *   - generations-slice is project-scoped (it lives inside whichever
 *     project is currently active and resets on project switch).
 *   - Starred items must SURVIVE project switches — that's the entire
 *     point of starring something. So storage is at the studio level
 *     and the data is persisted to localStorage independently.
 *
 * What gets stored:
 *   - Only the minimum needed to re-create the item later: kind, label,
 *     glbUrl, imageUrl, dimensions, optional scene snapshot (for room/
 *     interior-design entries). No mesh blobs, no textures — those still
 *     live behind their fal.ai CDN URLs.
 *   - URLs from fal.ai have a finite TTL (~30 days); when a starred
 *     item's URL eventually 404s, the placeholder rendering takes over
 *     and the user gets the same "regenerate mesh" affordance as for
 *     fresh failures.
 *
 * UI surfaces:
 *   - Star buttons in PropertiesCard (single piece) and on
 *     GenerationsCard tiles.
 *   - StarredCard panel in the right rail showing the collection,
 *     each entry with a "+ Use here" button that places it via
 *     placeGeneratedAssetIntoScene.
 */

import type { StateCreator } from "zustand";
import {
  cacheStarredGLB,
  deleteStarredGLB,
  fetchAsDataUrl,
} from "@studio/persistence/starred-glb-bucket";

const LS_KEY = "furnishes-starred-v1";

/** A starred entry — provenance + minimum payload for re-import. */
export interface StarredItem {
  /** Unique id (timestamp-based + random suffix). */
  id: string;
  /** Discriminator. v0.40.32: now three kinds.
   *    - "asset": a single generated piece (carries glbUrl + dims).
   *    - "room":  a full generated scene (carries scene snapshot).
   *    - "catalog": a curated catalog item (carries catalogId only;
   *                 the apartamento.glb already contains the mesh). */
  kind: "asset" | "room" | "catalog";
  /** Short label for the panel tile (typically the piece description
   *  trimmed to ~60 chars or "<style> <dims>m room"). */
  label: string;
  /** GLB URL for asset entries. Optional — eventually fal.ai URLs
   *  expire and we'd rather show a placeholder than crash. */
  glbUrl?: string;
  /** v0.40.32: opaque IndexedDB key for a locally-cached copy of
   *  the GLB bytes. Set by addStarred when the GLB fetch + cache
   *  write succeed. The GLB resolver checks this bucket FIRST so
   *  starred items survive fal.ai URL expiry, separate-device use,
   *  and the LRU eviction of the regular generation cache. */
  starredGlbKey?: string;
  /** 2D image URL — used as the thumbnail in the StarredCard.
   *  v0.40.32: this is now ALWAYS a data URL (base64) for starred
   *  items, set at star-time so thumbnails survive URL expiry. */
  imageUrl?: string;
  /** Frozen scene snapshot for room entries. Same shape applyScene
   *  was called with, so re-import just re-runs applyScene. */
  scene?: unknown;
  /** Dimensions for asset entries — needed by placeGeneratedAssetIntoScene
   *  to position the mesh correctly without re-deriving. Optional
   *  because rooms don't carry per-piece dims here (their pieces
   *  carry their own dims inside `scene`). */
  dimensions?: { width: number; depth: number; height: number };
  /** v0.40.32: catalog item id for kind === "catalog". Maps to a
   *  CatalogItem in the curated library and re-adds via
   *  placeItems([catalogId]). */
  catalogId?: string;
  /** Where this entry was originally generated. Surfaced as a small
   *  caption in the StarredCard so the user remembers context. */
  sourceLabel?: string;
  /** When the user starred it (ms since epoch). Default sort field. */
  starredAt: number;
}

export interface StarredSlice {
  starred: StarredItem[];

  /** Add an item to the starred collection. No-op if an item with
   *  the same id already exists. */
  addStarred: (item: StarredItem) => void;

  /** Remove a starred item by id. */
  removeStarred: (id: string) => void;

  /** Quick lookup: is this id starred? Used by star toggles to
   *  reflect filled/empty state. */
  isStarred: (id: string) => boolean;
}

/** Read existing starred items from localStorage. Defensive: returns
 *  an empty array on SSR, on parse failure, or on schema mismatch. */
function loadStarred(): StarredItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Filter to entries that have at least the required fields.
    // Anything malformed is dropped silently — we'd rather lose a
    // bad entry than crash the studio on load.
    return parsed.filter(
      (e): e is StarredItem =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as { id?: unknown }).id === "string" &&
        typeof (e as { label?: unknown }).label === "string" &&
        typeof (e as { starredAt?: unknown }).starredAt === "number" &&
        ((e as { kind?: unknown }).kind === "asset" ||
          (e as { kind?: unknown }).kind === "room" ||
          (e as { kind?: unknown }).kind === "catalog"),
    );
  } catch {
    return [];
  }
}

function saveStarred(items: StarredItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch {
    // Storage quota or permissions issue — fail silently. The user
    // sees the in-memory star state; it just won't survive reload.
  }
}

export const createStarredSlice: StateCreator<StarredSlice> = (set, get) => ({
  starred: loadStarred(),

  // v0.40.32: addStarred is split into a synchronous "land the
  // entry immediately so the UI stars without a flicker" phase and
  // an asynchronous "fetch the GLB bytes + image data, write to the
  // dedicated IndexedDB bucket, and patch the entry with the cache
  // key + data-URL thumbnail" phase.
  //
  // Why split: starring should feel instant. We can't await the
  // network in the click handler. So:
  //
  //   1. Synchronously: append the entry with whatever we already
  //      have (label, kind, glbUrl, raw imageUrl, dimensions). This
  //      lights up the star icon and pushes a tile into StarredCard.
  //
  //   2. In the background: fetch the GLB bytes, store in the
  //      starred-glb-bucket IndexedDB bucket (separate from the
  //      generation cache so LRU eviction can't drop it), get back
  //      a stable key. Also fetch the imageUrl, base64-encode as a
  //      data URL (small; survives in localStorage). Patch the
  //      entry in place with starredGlbKey + the data-URL imageUrl.
  //
  // The result: starred items don't 404 when fal.ai's signed URLs
  // expire, because the resolver checks the bucket FIRST (see
  // glb-cache.ts).
  addStarred: (item) => {
    set((s) => {
      // Dedup by id — starring the same source twice is a no-op.
      if (s.starred.some((e) => e.id === item.id)) return s;
      const next = [...s.starred, item];
      saveStarred(next);
      return { starred: next };
    });

    // Background: cache GLB + image. Catalog kind has neither a
    // glbUrl nor a remote imageUrl (the apartamento.glb already
    // contains its mesh), so skip the fetches.
    if (item.kind === "catalog") return;

    void (async () => {
      // Run both fetches in parallel — typical Flux thumbnails are
      // 30-100KB and GLBs are 0.5-2MB. There's no benefit to
      // serializing them.
      const [glbKey, imageDataUrl] = await Promise.all([
        item.glbUrl
          ? cacheStarredGLB(item.id, item.glbUrl)
          : Promise.resolve(null),
        item.imageUrl ? fetchAsDataUrl(item.imageUrl) : Promise.resolve(null),
      ]);

      // Patch the entry only if it's still in the collection (the
      // user might have unstarred it before the fetch resolved).
      // Updating the same id is safe and stable.
      set((s) => {
        const idx = s.starred.findIndex((e) => e.id === item.id);
        if (idx < 0) return s;
        const cur = s.starred[idx];
        const patched: StarredItem = {
          ...cur,
          starredGlbKey: glbKey ?? cur.starredGlbKey,
          imageUrl: imageDataUrl ?? cur.imageUrl,
        };
        const next = [...s.starred];
        next[idx] = patched;
        saveStarred(next);
        return { starred: next };
      });
    })();
  },

  removeStarred: (id) =>
    set((s) => {
      // v0.40.32: also drop the bucket entry so the IndexedDB store
      // doesn't grow forever. Fire-and-forget — failures are
      // swallowed inside deleteStarredGLB.
      const target = s.starred.find((e) => e.id === id);
      if (target?.starredGlbKey) {
        void deleteStarredGLB(target.starredGlbKey);
      }
      const next = s.starred.filter((e) => e.id !== id);
      saveStarred(next);
      return { starred: next };
    }),

  isStarred: (id) => get().starred.some((e) => e.id === id),
});
