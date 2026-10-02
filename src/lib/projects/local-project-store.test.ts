import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProject,
  getSnapshot,
  listProjects,
  putSnapshot,
} from "./local-project-store";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "furnishes-store-"));
  process.env.FURNISHES_LOCAL_STORE_PATH = path.join(
    tmpDir,
    "local-projects.json",
  );
});

afterEach(async () => {
  delete process.env.FURNISHES_LOCAL_STORE_PATH;
  await rm(tmpDir, { recursive: true, force: true });
});

describe("local-project-store", () => {
  it("writes complete JSON via a temp file then rename", async () => {
    const created = await createProject("Atomic loft");
    const dest = process.env.FURNISHES_LOCAL_STORE_PATH!;
    const raw = await readFile(dest, "utf8");
    const parsed = JSON.parse(raw) as {
      projects: Array<{ name: string }>;
    };

    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0]?.name).toBe("Atomic loft");
    expect(created.name).toBe("Atomic loft");

    const leftovers = (await readdir(tmpDir)).filter((name) =>
      name.endsWith(".tmp"),
    );
    expect(leftovers).toEqual([]);
  });

  it("replaces an existing store file without leaving a temp sibling", async () => {
    const created = await createProject("First");
    await putSnapshot(created.id, { hello: "world" }, 0);
    await putSnapshot(created.id, { hello: "again" }, 1);

    const dest = process.env.FURNISHES_LOCAL_STORE_PATH!;
    const parsed = JSON.parse(await readFile(dest, "utf8")) as {
      projects: Array<{ snapshot: unknown; revision: number }>;
    };

    expect(parsed.projects[0]?.snapshot).toEqual({ hello: "again" });
    expect(parsed.projects[0]?.revision).toBe(2);
    expect((await readdir(tmpDir)).filter((n) => n.endsWith(".tmp"))).toEqual(
      [],
    );

    const loaded = await getSnapshot(created.id);
    expect(loaded?.snapshot).toEqual({ hello: "again" });
    expect(loaded?.revision).toBe(2);
  });

  it("lists projects from the redirected store path", async () => {
    await createProject("A");
    await createProject("B");
    const names = (await listProjects()).map((p) => p.name).sort();
    expect(names).toEqual(["A", "B"]);
  });
});
