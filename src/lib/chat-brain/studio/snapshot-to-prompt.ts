/**
 * Studio snapshot → prompt block.
 *
 * Output is human-readable, NOT a JSON dump. Models consume natural-
 * language structure better than nested keys, and we want the prompt
 * to read like a designer's brief if anyone inspects it.
 *
 * Output shape (illustrative):
 *
 *     Studio context (current session):
 *     - Project: Living Room Refresh
 *     - Scene source: room-director (AI-generated)
 *     - Room: 5.0m × 4.0m × 2.7m
 *     - Walls: 4 sides, 1 door (south, 0.9m wide), 2 windows (north)
 *     - Style: Mid-century modern; warm-soft lighting; mood: lived-in
 *       but tidy. Materials: walnut wood, wool textile, brass metal.
 *       Palette: walls #F4EAE0, accent #2A7F62.
 *       Avoid: chrome, neon
 *     - Pieces (8 placed):
 *       · Walnut sofa (2.1m × 0.9m × 0.8m) at (1.2, -0.4) facing 0°
 *       · Brass floor lamp (0.4m × 0.4m × 1.6m) at (-1.8, -0.3) facing 0°
 *       · ...
 *     - Reference image: provided (used by the model for vision grounding)
 *     - Active mode: Interior Design
 *
 * Constraints enforced by the serializer:
 *   - Furniture cap at 20 items in the block. Beyond that we summarise
 *     ("...and 14 more"). Keeps the prompt under control on dense
 *     scenes.
 *   - Numbers rounded to 2 decimals max — prompts don't need 6 decimal
 *     precision and verbose numbers waste tokens.
 *   - Hidden pieces (`!visible`) are excluded entirely. Unplaced
 *     pieces are listed in a separate "available in catalog (not
 *     placed)" section with just label + dimensions, no position.
 *   - Empty fields are skipped, not output as "n/a". Cleaner prompt.
 *
 * The output is one continuous string. Caller wraps it in whatever
 * marker the prompt stack uses (typically `[STUDIO]\n...` or
 * similar) — this serializer doesn't pre-wrap so the prompt-stack
 * assembly stays the single owner of layer markers.
 *
 * NEW from eva: eva's serializer worked off a free-form text rail
 * (just style tags + budget notes). Ours has actual scene state, so
 * the output is much richer. The docstring is intentional — when
 * Turn 3's pipeline lands, we want the field-level decisions
 * documented at the source.
 */

import type { StudioSnapshotPayload } from "./studio-snapshot-schema";

const FURNITURE_LIST_CAP = 20;

function round2(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Avoid "1.20" — trim trailing zeros after rounding to 2 dp.
  const r = Math.round(n * 100) / 100;
  return r.toString();
}

function rotationLabel(rotationDeg: number): string {
  // Clamp to 0-360, then bucket into compass-style cardinal labels for
  // readability. Models can read "facing 90°" but "facing east"
  // anchors better in spatial reasoning.
  const norm = ((rotationDeg % 360) + 360) % 360;
  if (norm < 22.5 || norm >= 337.5) return "0° (front)";
  if (norm < 67.5) return "45°";
  if (norm < 112.5) return "90° (right)";
  if (norm < 157.5) return "135°";
  if (norm < 202.5) return "180° (back)";
  if (norm < 247.5) return "225°";
  if (norm < 292.5) return "270° (left)";
  return "315°";
}

export function studioSnapshotToPromptBlock(
  snapshot: StudioSnapshotPayload,
): string {
  const lines: string[] = [];
  lines.push("Studio context (current session):");

  // ── Project header ─────────────────────────────────────────────
  if (snapshot.projectTitle) {
    lines.push(`- Project: ${snapshot.projectTitle}`);
  } else if (snapshot.projectId) {
    lines.push(`- Project id: ${snapshot.projectId}`);
  }

  const sourceLabel =
    snapshot.sceneSource === "room-director"
      ? "room-director (AI-generated room)"
      : "viewer (apartment template)";
  lines.push(`- Scene source: ${sourceLabel}`);

  // ── Room dimensions ────────────────────────────────────────────
  if (snapshot.roomMeta) {
    const r = snapshot.roomMeta;
    lines.push(
      `- Room: ${round2(r.width)}m × ${round2(r.depth)}m × ${round2(r.height)}m (W × D × H)`,
    );
  }

  // ── Walls + openings ───────────────────────────────────────────
  if (snapshot.walls.length > 0 || snapshot.openings.length > 0) {
    const wallCount = snapshot.walls.length;
    const doorCount = snapshot.openings.filter((o) => o.kind === "door").length;
    const windowCount = snapshot.openings.filter(
      (o) => o.kind === "window",
    ).length;
    const parts: string[] = [];
    if (wallCount > 0) parts.push(`${wallCount} wall segments`);
    if (doorCount > 0) parts.push(`${doorCount} door${doorCount === 1 ? "" : "s"}`);
    if (windowCount > 0)
      parts.push(`${windowCount} window${windowCount === 1 ? "" : "s"}`);
    if (parts.length > 0) {
      lines.push(`- Architecture: ${parts.join(", ")}`);
    }
  }

  // ── Style bible ────────────────────────────────────────────────
  if (snapshot.styleBible) {
    const sb = snapshot.styleBible;
    const styleParts: string[] = [`Style: ${sb.name}`];
    if (sb.lighting) styleParts.push(`${sb.lighting} lighting`);
    if (sb.mood) styleParts.push(`mood: ${sb.mood}`);
    lines.push(`- ${styleParts.join("; ")}`);

    const materialParts: string[] = [];
    if (sb.dominantWood) materialParts.push(sb.dominantWood);
    if (sb.primaryTextile) materialParts.push(sb.primaryTextile);
    if (sb.metal) materialParts.push(sb.metal);
    if (materialParts.length > 0) {
      lines.push(`  Materials: ${materialParts.join(", ")}`);
    }

    const paletteParts: string[] = [];
    if (sb.paletteWalls) paletteParts.push(`walls ${sb.paletteWalls}`);
    if (sb.paletteAccent) paletteParts.push(`accent ${sb.paletteAccent}`);
    if (paletteParts.length > 0) {
      lines.push(`  Palette: ${paletteParts.join(", ")}`);
    }

    if (sb.forbidden && sb.forbidden.length > 0) {
      lines.push(`  Avoid: ${sb.forbidden.join(", ")}`);
    }
  }

  // ── Furniture: split placed/unplaced, then cap & summarize ─────
  // We exclude hidden pieces entirely — they're not "in the room"
  // from the user's perspective, so the brain shouldn't reference
  // them. Unplaced (placed:false) pieces are listed in a separate
  // section so the assistant can suggest placing them but doesn't
  // think they're sitting somewhere.
  const visible = snapshot.furniture.filter((f) => f.visible);
  const placed = visible.filter((f) => f.placed);
  const unplaced = visible.filter((f) => !f.placed);

  if (placed.length > 0) {
    lines.push(`- Placed pieces (${placed.length} total):`);
    const shown = placed.slice(0, FURNITURE_LIST_CAP);
    for (const f of shown) {
      const dims = `${round2(f.width)}m × ${round2(f.depth)}m × ${round2(f.height)}m`;
      const pos = `(${round2(f.x)}, ${round2(f.z)})`;
      const generated = f.metaSource === "room-director" ? " [generated]" : "";
      lines.push(
        `  · ${f.label} ${dims} at ${pos} facing ${rotationLabel(f.rotation)}${generated}`,
      );
    }
    if (placed.length > FURNITURE_LIST_CAP) {
      lines.push(`  · …and ${placed.length - FURNITURE_LIST_CAP} more`);
    }
  } else {
    lines.push("- No pieces placed yet (room is empty).");
  }

  if (unplaced.length > 0) {
    lines.push(
      `- Available in catalog (not placed): ${unplaced
        .slice(0, FURNITURE_LIST_CAP)
        .map((f) => f.label)
        .join(", ")}${unplaced.length > FURNITURE_LIST_CAP ? `, …and ${unplaced.length - FURNITURE_LIST_CAP} more` : ""}`,
    );
  }

  // ── Reference image + mode ─────────────────────────────────────
  if (snapshot.referenceImageUrl) {
    lines.push(
      "- Reference image: provided (the user attached an image to ground this turn — use it as visual context, do not invent pixels).",
    );
  }

  if (snapshot.mode) {
    lines.push(`- Active mode: ${snapshot.mode}`);
  }

  return lines.join("\n");
}
