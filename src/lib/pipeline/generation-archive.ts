/**
 * generation-archive — server-side persistence of every generation
 * output (2D Flux images, 3D GLB meshes, style anchor PNGs).
 *
 * Why: during development the user wants to be able to see what the
 * pipeline produced on a given run — flick through the saved files,
 * review what Claude generated, look at piece-level outputs that
 * already cleared from the in-app history, etc. Without local
 * persistence those outputs only existed at fal.ai's CDN URLs which
 * expire after 24h.
 *
 * Layout:
 *   data/generations/
 *     run_<timestamp>_<rand>/
 *       prompt.txt              -- the original user prompt
 *       style.json              -- the StyleBible, if any
 *       style_anchor.png        -- the room-level reference (room runs only)
 *       piece_<id>.png          -- the Flux 2D for each piece
 *       piece_<id>.glb          -- the GLB for each piece
 *       layout.json             -- the AssembledScene at scene-emit time
 *
 * Each kind is best-effort. Failures are swallowed and logged with
 * `[archive]` prefix — they NEVER abort the generation, since this
 * is a tracking convenience, not a correctness requirement.
 *
 * Configuration:
 *   ENABLE_GENERATION_ARCHIVE=true   - master on/off switch (default: true in dev)
 *   GENERATION_ARCHIVE_DIR=...        - override the directory (default: ./data/generations)
 *
 * Disabled in production by default — `process.env.NODE_ENV === "production"`
 * sets the default flag to false to avoid filling up the deploy disk.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_DIR = "./data/generations";

function isEnabled(): boolean {
  const explicit = process.env.ENABLE_GENERATION_ARCHIVE;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  // Default: on in dev, off in production.
  return process.env.NODE_ENV !== "production";
}

function archiveRoot(): string {
  return process.env.GENERATION_ARCHIVE_DIR ?? DEFAULT_DIR;
}

/**
 * Open an archive run for one whole-room or asset generation. Returns
 * a handle the orchestrator can use to write outputs as they land.
 *
 * If archiving is disabled, returns a no-op handle. Callers don't
 * need to special-case the disabled path — every method on the
 * handle is safe to call when disabled.
 */
export interface ArchiveRun {
  enabled: boolean;
  dir: string;
  /** Save a small text file (prompt, label, etc.). */
  saveText: (filename: string, content: string) => Promise<void>;
  /** Save a JSON object pretty-printed. */
  saveJson: (filename: string, value: unknown) => Promise<void>;
  /** Download a URL and save its bytes. URL can be HTTPS or a data: URI. */
  saveFromUrl: (filename: string, url: string) => Promise<void>;
}

export async function openArchiveRun(opts: {
  prompt: string;
  /** "room" or "asset" — used as a filename prefix so the run dir is
   *  self-describing when listed. */
  kind: "room" | "asset";
}): Promise<ArchiveRun> {
  if (!isEnabled()) {
    return makeNoopRun();
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-04-27T14-30-15
  const rand = Math.random().toString(36).slice(2, 8);
  const dirName = `${opts.kind}_${ts}_${rand}`;
  const dir = path.resolve(archiveRoot(), dirName);

  try {
    await fs.mkdir(dir, { recursive: true });

    console.log(`[archive] opened ${dir}`);
  } catch (err) {
    console.warn(`[archive] failed to create dir ${dir}:`, err);
    return makeNoopRun();
  }

  const handle: ArchiveRun = {
    enabled: true,
    dir,
    saveText: async (filename, content) => {
      try {
        await fs.writeFile(path.resolve(dir, filename), content, "utf8");
      } catch (err) {
        console.warn(`[archive] saveText ${filename} failed:`, err);
      }
    },
    saveJson: async (filename, value) => {
      try {
        await fs.writeFile(
          path.resolve(dir, filename),
          JSON.stringify(value, null, 2),
          "utf8",
        );
      } catch (err) {
        console.warn(`[archive] saveJson ${filename} failed:`, err);
      }
    },
    saveFromUrl: async (filename, url) => {
      try {
        // Data URI: parse out the base64 body and write directly.
        if (url.startsWith("data:")) {
          const commaIdx = url.indexOf(",");
          if (commaIdx < 0) throw new Error("malformed data: URI");
          const meta = url.slice(0, commaIdx);
          const body = url.slice(commaIdx + 1);
          const isBase64 = meta.includes(";base64");
          const buf = isBase64
            ? Buffer.from(body, "base64")
            : Buffer.from(decodeURIComponent(body), "utf8");
          await fs.writeFile(path.resolve(dir, filename), buf);
          return;
        }
        // HTTPS: fetch and stream to disk.
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const arrayBuf = await res.arrayBuffer();
        await fs.writeFile(path.resolve(dir, filename), Buffer.from(arrayBuf));
      } catch (err) {
        console.warn(
          `[archive] saveFromUrl ${filename} (${url.slice(0, 60)}…) failed:`,
          err,
        );
      }
    },
  };

  // Save the prompt up front so even if the rest of the run fails,
  // the user can see what they asked for.
  await handle.saveText("prompt.txt", opts.prompt);

  return handle;
}

function makeNoopRun(): ArchiveRun {
  return {
    enabled: false,
    dir: "",
    saveText: async () => {},
    saveJson: async () => {},
    saveFromUrl: async () => {},
  };
}
