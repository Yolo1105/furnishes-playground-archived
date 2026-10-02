/**
 * starred-glb-bucket — IndexedDB-backed storage for starred-item GLB
 * bytes. Separate from the generation cache (glb-cache.ts) so:
 *
 *   - LRU eviction in the generation cache can't drop starred items.
 *     The user explicitly marked these as wanting to keep around;
 *     deleting them silently would be wrong.
 *
 *   - fal.ai URL expiry (~30 days for asset/glb URLs) doesn't 404
 *     starred items. The bytes are local; we don't go back to the
 *     network at render time.
 *
 *   - Cross-device / cross-browser use is honest about its limits:
 *     IndexedDB is per-origin, per-browser-profile. Starred items
 *     don't cross machines today. (A future server-side bucket could
 *     fix that, but localStorage + IndexedDB is the right MVP.)
 *
 * Layout:
 *   DB:    furnishes-studio-starred-glbs
 *   Store: glbs (key = starredGlbKey)
 *   Value: { key, blob, savedAt, bytes }
 *
 * Public API:
 *   - cacheStarredGLB(starredId, sourceUrl) → starredGlbKey | null
 *     Fetches the source URL, stores the bytes, returns the key.
 *     null on any failure (network, parse, quota). Caller persists
 *     the returned key on the StarredItem.starredGlbKey field.
 *
 *   - getStarredGLB(key) → blob URL | null
 *     Looks up the cached blob and returns a fresh blob URL the
 *     useGLTF hook can load. null if the key isn't in the bucket.
 *
 *   - deleteStarredGLB(key) → void
 *     Drops the cached bytes (called from removeStarred).
 *
 * Why blob URLs not data URLs:
 *   useGLTF accepts a string URL. Blob URLs are zero-copy refs to
 *   the in-memory blob — no re-encoding. The browser GCs them on
 *   tab close; we don't revoke explicitly because the surfaces that
 *   need the URL want long-lived references.
 */

const DB_NAME = "furnishes-studio-starred-glbs";
const DB_VERSION = 1;
const STORE = "glbs";

interface StarredGlbEntry {
  key: string;
  blob: Blob;
  savedAt: number;
  bytes: number;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Generate a stable key for a starred item's GLB. We include the
 *  starred id and a content-hint suffix; the suffix doesn't need to
 *  be cryptographic — any unique-enough disambiguator is fine. */
function makeKey(starredId: string): string {
  return `starred_${starredId}_${Date.now().toString(36)}`;
}

/** Fetch + store. Returns the cache key, or null on any failure. */
export async function cacheStarredGLB(
  starredId: string,
  sourceUrl: string,
): Promise<string | null> {
  if (!sourceUrl) return null;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;

    const db = await openDb();
    if (!db) return null;

    const key = makeKey(starredId);
    const entry: StarredGlbEntry = {
      key,
      blob,
      savedAt: Date.now(),
      bytes: blob.size,
    };

    return await new Promise<string | null>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const putReq = store.put(entry);
      putReq.onsuccess = () => resolve(key);
      putReq.onerror = () => resolve(null);
      tx.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Retrieve as a blob URL. Returns null on miss or any read failure. */
export async function getStarredGLB(key: string): Promise<string | null> {
  if (!key) return null;
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise<string | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const entry = getReq.result as StarredGlbEntry | undefined;
        if (!entry || !entry.blob) {
          resolve(null);
          return;
        }
        try {
          const blobUrl = URL.createObjectURL(entry.blob);
          resolve(blobUrl);
        } catch {
          resolve(null);
        }
      };
      getReq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Delete a cached entry (called from removeStarred). */
export async function deleteStarredGLB(key: string): Promise<void> {
  if (!key) return;
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const delReq = store.delete(key);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => resolve();
    });
  } catch {
    // Swallow — failure to delete is not user-facing.
  }
}

/** Convert a remote image URL into a base64 data URL. Used to
 *  persist thumbnails on the StarredItem itself (small enough to
 *  fit in localStorage; typical Flux thumbnails are 30-100KB). */
export async function fetchAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        resolve(typeof result === "string" ? result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
