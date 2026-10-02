/**
 * GLB blob cache — stores fetched mesh binaries in IndexedDB keyed by
 * the GLB URL.
 *
 * Why this exists:
 *   - fal.ai returns signed GLB URLs that typically expire in 24-48
 *     hours. After that, opening a saved generated project would 404
 *     every mesh. Caching the bytes locally means stale URLs don't
 *     break the project.
 *   - Each piece mesh is 100KB-2MB. Reloading a project with 8 pieces
 *     re-fetching every mesh from fal.ai's CDN takes 10-20 seconds.
 *     Cache makes reloads instant.
 *   - The cache is LRU-bounded at 100MB so we don't grow unbounded
 *     across long sessions / many projects.
 *
 * Cache strategy:
 *   - Key: full GLB URL (signed URLs are long but stable per-session)
 *   - Value: { blob, cachedAt, expiresAt, bytes, lastAccess }
 *   - TTL: 30 days from cache time (generated meshes don't change)
 *   - Eviction: LRU when total cache size exceeds 100MB. Triggered
 *     opportunistically on cache writes (5% chance per write so we
 *     don't run eviction on every put).
 *
 * Public API:
 *   - getOrFetchGLB(url): string promise — the convenience function.
 *     Returns a blob URL on cache hit, fetches+caches on miss, falls
 *     back to the original URL on any failure (no exceptions thrown).
 *   - getCachedGLB(url): blob URL or null
 *   - cacheGLB(url, blob): void
 *   - clearGLBCache(): void — for a future "Clear cache" settings
 *     button
 *   - getGLBCacheSize(): number — current bytes used
 *
 * Why blob URLs not data URLs:
 *   useGLTF accepts a string URL. Blob URLs are zero-copy references
 *   to in-memory blobs; they can be passed straight to useGLTF without
 *   re-encoding. They live until URL.revokeObjectURL() is called or
 *   the document unloads — we don't revoke explicitly because the
 *   cache wants long-lived references; browsers GC them on tab close.
 */

const DB_NAME = "furnishes-studio-glb-cache";
const DB_VERSION = 1;
const STORE = "glbs";
const MAX_CACHE_BYTES = 100 * 1024 * 1024; // 100 MB
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type CacheEntry = {
  url: string;
  blob: Blob;
  cachedAt: number;
  expiresAt: number;
  bytes: number;
  lastAccess: number;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "url" });
        store.createIndex("lastAccess", "lastAccess");
        store.createIndex("expiresAt", "expiresAt");
      }
    };
  });
}

async function idbGet(url: string): Promise<CacheEntry | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => resolve((req.result as CacheEntry) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbPut(entry: CacheEntry): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort — caching failures shouldn't break anything.
  }
}

async function idbUpdateAccessTime(url: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const entry = await new Promise<CacheEntry | null>((r) => {
      const req = store.get(url);
      req.onsuccess = () => r((req.result as CacheEntry) ?? null);
      req.onerror = () => r(null);
    });
    if (entry) {
      entry.lastAccess = Date.now();
      store.put(entry);
    }
  } catch {
    // best-effort
  }
}

/** Return a cached GLB as a blob URL, or null on miss / expiry. Updates
 *  the entry's lastAccess time on hit (for LRU eviction). */
export async function getCachedGLB(url: string): Promise<string | null> {
  const entry = await idbGet(url);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    // Expired entry — leave it for evictIfOversize to clean up
    // eventually, but don't use it.
    return null;
  }
  void idbUpdateAccessTime(url);
  return URL.createObjectURL(entry.blob);
}

/** Cache a fetched GLB. No-op on failure. */
export async function cacheGLB(url: string, blob: Blob): Promise<void> {
  const now = Date.now();
  const entry: CacheEntry = {
    url,
    blob,
    cachedAt: now,
    expiresAt: now + TTL_MS,
    bytes: blob.size,
    lastAccess: now,
  };
  await idbPut(entry);
  // Run eviction occasionally — once per ~20 writes. Cheap heuristic;
  // avoids running eviction on every single put.
  if (Math.random() < 0.05) {
    void evictIfOversize();
  }
}

/** LRU eviction when total cache exceeds MAX_CACHE_BYTES. Targets 80%
 *  of max so we don't immediately re-trigger on the next put. */
async function evictIfOversize(): Promise<void> {
  try {
    const db = await openDB();
    const entries: CacheEntry[] = await new Promise((r) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => r((req.result as CacheEntry[]) ?? []);
      req.onerror = () => r([]);
    });
    const total = entries.reduce((sum, e) => sum + e.bytes, 0);
    if (total <= MAX_CACHE_BYTES) return;

    entries.sort((a, b) => a.lastAccess - b.lastAccess);
    let remaining = total;
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const e of entries) {
      // Stop once under 80% of max so we don't oscillate.
      if (remaining <= MAX_CACHE_BYTES * 0.8) break;
      store.delete(e.url);
      remaining -= e.bytes;
    }
  } catch {
    // best-effort
  }
}

/** Convenience: cache hit → return blob URL; cache miss → fetch +
 *  cache + return blob URL; any failure → return original URL.
 *
 *  This is the function GeneratedPieceMesh calls. By design, it never
 *  throws — failures fall through to the original URL and useGLTF
 *  gets to try its luck against the fal.ai CDN.
 *
 *  v0.40.32: optional `starredKey` parameter. When the caller knows
 *  this URL belongs to a starred item that has been cached into the
 *  dedicated starred-glb-bucket (separate IndexedDB DB, no LRU
 *  eviction), we check that bucket FIRST. This is what prevents
 *  starred items from 404-ing when fal.ai's signed URLs eventually
 *  expire — we have the bytes locally and never need to re-hit the
 *  network. Falls through to the regular generation cache if the
 *  bucket lookup misses (e.g., the cache write hadn't completed
 *  yet at star-time, or the user cleared IndexedDB). */
export async function getOrFetchGLB(
  url: string,
  starredKey?: string,
): Promise<string> {
  // 1. Starred bucket — survives URL expiry, not LRU-evicted.
  if (starredKey) {
    // Lazy import to avoid a circular dep with starred-glb-bucket
    // (which is in the same persistence directory but conceptually
    // owned by the starred slice).
    const { getStarredGLB } = await import("./starred-glb-bucket");
    const starredBlob = await getStarredGLB(starredKey);
    if (starredBlob) return starredBlob;
  }

  // 2. Generation cache — fast for repeated loads of fresh URLs.
  const cached = await getCachedGLB(url);
  if (cached) return cached;

  // 3. Network — fetch and cache.
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const blob = await res.blob();
    await cacheGLB(url, blob);
    return URL.createObjectURL(blob);
  } catch {
    return url;
  }
}

/** Clear the entire cache. Surface this from a future settings panel. */
export async function clearGLBCache(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best-effort
  }
}

/** Total bytes currently held by the cache. */
export async function getGLBCacheSize(): Promise<number> {
  try {
    const db = await openDB();
    const entries: CacheEntry[] = await new Promise((r) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => r((req.result as CacheEntry[]) ?? []);
      req.onerror = () => r([]);
    });
    return entries.reduce((sum, e) => sum + e.bytes, 0);
  } catch {
    return 0;
  }
}
