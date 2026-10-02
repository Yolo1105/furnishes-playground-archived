// Minimal IndexedDB wrapper for project persistence. Phase G ships
// without auth — projects live entirely client-side in the user's
// browser. When auth lands later, this module gets a sibling that
// syncs to Supabase and the UI gains "import from cloud / push to
// cloud" actions; the IDB store stays as the local cache.
//
// Schema:
//   Database: "furnishes-studio"
//   Object store: "projects" — keyed by project.id, value is the
//     full ProjectSnapshot (everything we serialize per project).
//   Object store: "meta" — keyed by string, holds the last-active
//     project id so reopening the tab restores where the user was.

const DB_NAME = "furnishes-studio";
const DB_VERSION = 1;
const PROJECTS_STORE = "projects";
const META_STORE = "meta";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save a project snapshot under its id. Last-write-wins. */
export async function putProject<T extends { id: string }>(
  snapshot: T,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_STORE, "readwrite");
    tx.objectStore(PROJECTS_STORE).put(snapshot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load a single project by id, or null if absent. */
export async function getProject<T>(id: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_STORE, "readonly");
    const req = tx.objectStore(PROJECTS_STORE).get(id);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** List every saved project, most recent first by `updatedAt`. */
export async function listProjects<
  T extends { id: string; updatedAt: number },
>(): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_STORE, "readonly");
    const req = tx.objectStore(PROJECTS_STORE).getAll();
    req.onsuccess = () => {
      const list = (req.result as T[]) ?? [];
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Delete a project by id. */
export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_STORE, "readwrite");
    tx.objectStore(PROJECTS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get/set the last-active project id (so tab reopen restores). */
export async function getLastActiveProjectId(): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).get("lastActiveProjectId");
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}
export async function setLastActiveProjectId(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(id, "lastActiveProjectId");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
