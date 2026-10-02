/**
 * File-backed project + snapshot store for standalone (no Postgres).
 * Data lives under `data/local-projects.json` (gitignored).
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  PLAYGROUND_BLANK_PROJECT_TITLE,
  PLAYGROUND_DEMO_PROJECT_TITLE,
} from "./playground-demo-constants";

export type LocalProject = {
  id: string;
  name: string;
  updated: string;
  updatedAt: number;
  revision: number;
  snapshot: unknown | null;
  /** Empty 3D + empty 2D reference on first boot (no apartamento.glb). */
  blankScene?: boolean;
};

type StoreFile = {
  projects: LocalProject[];
};

function getStorePath(): string {
  return (
    process.env.FURNISHES_LOCAL_STORE_PATH ??
    path.join(process.cwd(), "data", "local-projects.json")
  );
}

function toClient(p: LocalProject) {
  return {
    id: p.id,
    name: p.name,
    updated: p.updated,
    ...(p.blankScene ? { blankScene: true as const } : {}),
  };
}

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await fs.readFile(getStorePath(), "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || !Array.isArray(parsed.projects)) {
      return { projects: [] };
    }
    return parsed;
  } catch {
    return { projects: [] };
  }
}

/** Write the store by staging a sibling temp file then renaming onto
 *  the destination. `rename` is atomic on POSIX, so a crash mid-write
 *  leaves the previous complete JSON in place instead of a truncated
 *  file. Tests can redirect the path with FURNISHES_LOCAL_STORE_PATH. */
async function writeStore(store: StoreFile): Promise<void> {
  const dest = getStorePath();
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

function touch(p: LocalProject): LocalProject {
  const now = Date.now();
  return {
    ...p,
    updatedAt: now,
    updated: new Date(now).toISOString(),
  };
}

export async function listProjects() {
  const store = await readStore();
  return store.projects
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toClient);
}

export async function createProject(name?: string, opts?: { blankScene?: boolean }) {
  const store = await readStore();
  const blankScene = opts?.blankScene !== false;
  const project = touch({
    id: randomUUID(),
    name: (name?.trim() || "Untitled Space").slice(0, 200),
    updated: "",
    updatedAt: 0,
    revision: 0,
    snapshot: null,
    ...(blankScene ? { blankScene: true } : {}),
  });
  store.projects.push(project);
  await writeStore(store);
  return toClient(project);
}

/**
 * Ensure the default blank starter exists (and optionally the demo
 * apartment showcase). Returns the blank starter for client focus.
 */
export async function ensureStarterProject() {
  const store = await readStore();
  let changed = false;

  let blank = store.projects.find(
    (p) =>
      p.blankScene === true || p.name === PLAYGROUND_BLANK_PROJECT_TITLE,
  );
  if (!blank) {
    blank = touch({
      id: randomUUID(),
      name: PLAYGROUND_BLANK_PROJECT_TITLE,
      updated: "",
      updatedAt: 0,
      revision: 0,
      snapshot: null,
      blankScene: true,
    });
    store.projects.push(blank);
    changed = true;
  } else if (!blank.blankScene) {
    const idx = store.projects.findIndex((p) => p.id === blank!.id);
    blank = { ...blank, blankScene: true };
    store.projects[idx] = blank;
    changed = true;
  }

  const hasDemo = store.projects.some(
    (p) => p.name === PLAYGROUND_DEMO_PROJECT_TITLE,
  );
  if (!hasDemo) {
    store.projects.push(
      touch({
        id: randomUUID(),
        name: PLAYGROUND_DEMO_PROJECT_TITLE,
        updated: "",
        updatedAt: 0,
        revision: 0,
        snapshot: null,
      }),
    );
    changed = true;
  }

  if (changed) await writeStore(store);
  return toClient(blank);
}

export async function renameProject(id: string, name: string) {
  const store = await readStore();
  const idx = store.projects.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const next = touch({
    ...store.projects[idx]!,
    name: name.trim().slice(0, 200) || store.projects[idx]!.name,
  });
  store.projects[idx] = next;
  await writeStore(store);
  return toClient(next);
}

export async function deleteProject(id: string) {
  const store = await readStore();
  const before = store.projects.length;
  store.projects = store.projects.filter((p) => p.id !== id);
  if (store.projects.length === before) return false;
  await writeStore(store);
  return true;
}

export async function getSnapshot(id: string) {
  const store = await readStore();
  const p = store.projects.find((x) => x.id === id);
  if (!p) return null;
  if (p.snapshot == null) {
    return { revision: null as number | null, snapshot: null as unknown };
  }
  return { revision: p.revision, snapshot: p.snapshot };
}

export async function putSnapshot(
  id: string,
  snapshot: unknown,
  expectedRevision: number | null | undefined,
): Promise<
  | { ok: true; revision: number }
  | { ok: false; status: number; currentRevision?: number; error: string }
> {
  const store = await readStore();
  const idx = store.projects.findIndex((p) => p.id === id);
  if (idx < 0) {
    return { ok: false, status: 404, error: "Not found" };
  }
  const current = store.projects[idx]!;
  const allowsInitial =
    expectedRevision === undefined ||
    expectedRevision === null ||
    expectedRevision === 0;
  if (!allowsInitial && expectedRevision !== current.revision) {
    return {
      ok: false,
      status: 409,
      currentRevision: current.revision,
      error: "Revision conflict",
    };
  }
  const nextRevision = current.revision + 1;
  store.projects[idx] = touch({
    ...current,
    revision: nextRevision,
    snapshot,
  });
  await writeStore(store);
  return { ok: true, revision: nextRevision };
}
