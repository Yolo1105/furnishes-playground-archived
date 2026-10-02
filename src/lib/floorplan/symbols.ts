/**
 * Architectural symbol generators for the 2D floor plan. Ported
 * from the zip's `lib/floorplan/symbols.ts`. Pure math — given a
 * wall and an opening that lies on it, produces SVG path data for
 * the door arc, the two-line window mark, or the wall fragments
 * that should remain visible after openings cut through.
 *
 * All inputs and outputs are in viewer space (the coordinate
 * system after `normalizeScene` applies the apartment root's
 * world matrix). The transformation is done once at seed time
 * inside the furniture-slice; this module never touches GLB-raw
 * coords.
 */
import type { Wall, Opening } from "./types";

interface WallGeom {
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  len: number;
}

function wallGeom(w: Wall): WallGeom {
  const dx = w.x2 - w.x1;
  const dz = w.z2 - w.z1;
  const len = Math.hypot(dx, dz);
  const ux = len > 0 ? dx / len : 1;
  const uz = len > 0 ? dz / len : 0;
  return { ux, uz, nx: -uz, nz: ux, len };
}

interface OpeningParams {
  mx: number;
  mz: number;
  width: number;
}

function openingParams(opening: Opening): OpeningParams {
  return {
    mx: (opening.x1 + opening.x2) / 2,
    mz: (opening.z1 + opening.z2) / 2,
    width: Math.hypot(opening.x2 - opening.x1, opening.z2 - opening.z1),
  };
}

/**
 * SVG path for a door's swing arc + the door leaf. Closed → arc
 * → hinge → close.
 *
 * The wall argument supplies the wall direction we draw along; for
 * runtime-detected openings (which carry an empty `wallId`), we
 * derive that direction from the opening's own endpoints — they
 * were the gap-endpoints between two real walls, so the line
 * between them runs along the doorway.
 */
export function doorArcPath(wall: Wall | undefined, opening: Opening): string {
  let ux: number;
  let uz: number;
  let nx: number;
  let nz: number;

  if (wall) {
    const g = wallGeom(wall);
    ux = g.ux;
    uz = g.uz;
    nx = g.nx;
    nz = g.nz;
  } else {
    // Derive direction from the opening's own endpoints.
    const dx = opening.x2 - opening.x1;
    const dz = opening.z2 - opening.z1;
    const len = Math.hypot(dx, dz);
    if (len === 0) return "";
    ux = dx / len;
    uz = dz / len;
    nx = -uz;
    nz = ux;
  }

  const { mx, mz, width } = openingParams(opening);
  const hingeSide = opening.swing === "right" ? 1 : -1;
  const hx = mx + ux * width * 0.5 * hingeSide;
  const hz = mz + uz * width * 0.5 * hingeSide;
  const closedX = mx - ux * width * 0.5 * hingeSide;
  const closedZ = mz - uz * width * 0.5 * hingeSide;
  const openX = hx + nx * width;
  const openZ = hz + nz * width;
  const sweep = opening.swing === "right" ? 0 : 1;
  return `M ${closedX} ${closedZ} A ${width} ${width} 0 0 ${sweep} ${openX} ${openZ} L ${hx} ${hz} Z`;
}

export interface WindowLine {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/**
 * Two parallel lines flanking the wall at the window's position —
 * the standard architectural drawing convention for a window mark.
 */
export function windowLines(
  opening: Opening,
  wall: Wall | undefined,
): WindowLine[] {
  if (!wall) return [];
  const { ux, uz, nx, nz } = wallGeom(wall);
  const { mx, mz, width } = openingParams(opening);
  const halfW = width / 2;
  const offset = 0.06;
  const lines: WindowLine[] = [];
  for (const side of [-1, 1]) {
    lines.push({
      x1: mx - ux * halfW + nx * offset * side,
      z1: mz - uz * halfW + nz * offset * side,
      x2: mx + ux * halfW + nx * offset * side,
      z2: mz + uz * halfW + nz * offset * side,
    });
  }
  return lines;
}

/**
 * Break a wall into the segments NOT covered by any opening on it.
 * Drawing only the fragments produces the architectural look where
 * doors and windows literally cut the wall line.
 */
export function wallFragments(
  wall: Wall,
  openings: readonly Opening[],
): WindowLine[] {
  const { len, ux, uz } = wallGeom(wall);
  if (len === 0) return [];

  const related = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => {
      const params = openingParams(o);
      const rel =
        len > 0
          ? ((params.mx - wall.x1) * ux + (params.mz - wall.z1) * uz) / len
          : 0;
      const halfRel = params.width / 2 / len;
      return {
        start: Math.max(0, rel - halfRel),
        end: Math.min(1, rel + halfRel),
      };
    })
    .sort((a, b) => a.start - b.start);

  const frags: WindowLine[] = [];
  let cursor = 0;
  for (const r of related) {
    if (r.start > cursor) {
      frags.push({
        x1: wall.x1 + ux * len * cursor,
        z1: wall.z1 + uz * len * cursor,
        x2: wall.x1 + ux * len * r.start,
        z2: wall.z1 + uz * len * r.start,
      });
    }
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < 1) {
    frags.push({
      x1: wall.x1 + ux * len * cursor,
      z1: wall.z1 + uz * len * cursor,
      x2: wall.x2,
      z2: wall.z2,
    });
  }
  return frags;
}
