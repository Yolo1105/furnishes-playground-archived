"use client";

/**
 * RoomDirectorCadPlan — CAD-style 2D floor plan for room-director scenes.
 *
 * Replaces the old "schematic top-down with squares" rendering for
 * generated rooms (sceneSource === "room-director") with a proper
 * architectural drawing: poché walls (double-line + diagonal hatching),
 * door swing arcs, window break lines, dimension chains, north arrow,
 * scale bar, and lightweight furniture symbols at ~25% the wall cut
 * weight per the National CAD Standard.
 *
 * Preconfigured viewer scenes (the existing apartamento.glb default)
 * still go through the original FloorPlan2D rendering — those rooms
 * have organic wall shapes derived from a complex GLB and don't
 * project cleanly onto the rectangular CAD assumptions here.
 *
 * Inputs:
 *   - roomMeta:    { width, depth, minX, maxX, minZ, maxZ } — required.
 *                  The outer rectangle. wallThickness is assumed because
 *                  it isn't part of the schema; 0.2m is the apartmentos-
 *                  industry default for interior partitions.
 *   - openings:    Opening[] — each with x1/z1/x2/z2 endpoints projected
 *                  onto a wall, plus kind (door|window|arch) and optional
 *                  swing direction.
 *   - footprints:  pre-projected piece footprints {id, label, x, z,
 *                  width, depth, color, shape} — the same shape
 *                  FloorPlan2D builds for the existing rendering, so
 *                  the data prep code is shared.
 *   - selectedId:  for the orange highlight ring.
 *   - onSelect:    click-to-select wired to the same selectFurniture.
 *   - compact:     shrinks margins + hides chrome (north arrow, scale
 *                  bar, dimension chains) when rendered inside the
 *                  small Reference card.
 *
 * Coordinate frame: the scene's world frame (metres). Origin is room
 * center for room-director scenes (the orchestrator emits roomMeta
 * with minX = -width/2 etc by convention). +X = east, +Z = south
 * (z-down on the page).
 */

import type { Opening } from "@studio/director/schema";
import type { RoomMeta } from "@studio/director/adapter";

interface Footprint {
  id: string;
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  shape: string;
  color: string;
}

interface Props {
  roomMeta: RoomMeta;
  openings: Opening[];
  footprints: Footprint[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  compact?: boolean;
}

// Stroke-weight hierarchy from the NCS. All other weights derive as
// fractions of cut weight so the relationships hold regardless of
// SVG zoom. cut weight is in METRES (we render in world space).
const CUT_WEIGHT_M = 0.05; // 5 cm equivalent at 1:50 = ~0.5mm on a printed plan
const SW = {
  cut: CUT_WEIGHT_M,
  cutThin: CUT_WEIGHT_M * 0.55,
  opening: CUT_WEIGHT_M * 0.4,
  furniture: CUT_WEIGHT_M * 0.32,
  dim: CUT_WEIGHT_M * 0.22,
  hatch: CUT_WEIGHT_M * 0.2,
};

// Industry default for interior partitions — doesn't come from the
// schema. Could be parametrised later if the orchestrator starts
// emitting wall thickness explicitly.
const WALL_THICKNESS = 0.2;

const INK = "#1A1A1A";
// Slightly warm off-white that matches the studio's overall cream
// palette (vs pure white which clashes with the surrounding UI).
const PAPER = "#FAFAF7";
const ACCENT = "#FF5A1F";

export function RoomDirectorCadPlan({
  roomMeta,
  openings,
  footprints,
  selectedId,
  onSelect,
  compact = false,
}: Props) {
  // Inner room rectangle (interior face to interior face).
  const innerL = roomMeta.minX;
  const innerR = roomMeta.maxX;
  const innerT = roomMeta.minZ;
  const innerB = roomMeta.maxZ;
  // Outer envelope (exterior face).
  const t = WALL_THICKNESS;
  const outerL = innerL - t;
  const outerR = innerR + t;
  const outerT = innerT - t;
  const outerB = innerB + t;

  // Margin around the drawing for dimension chains, scale bar, north
  // arrow. In world-metres. Compact mode collapses the chrome margins
  // so the small reference card doesn't waste space on unreadable
  // labels.
  const margin = compact
    ? { top: 0.15, right: 0.15, bottom: 0.15, left: 0.15 }
    : { top: 0.85, right: 1.2, bottom: 1.0, left: 0.55 };

  const vbX = outerL - margin.left;
  const vbZ = outerT - margin.top;
  const vbW = outerR - outerL + margin.left + margin.right;
  const vbH = outerB - outerT + margin.top + margin.bottom;

  // Hatch pattern is in PIXEL space — the user-space size depends on
  // SVG-to-screen scale, so we use objectBoundingBox-independent
  // userSpaceOnUse with a small fixed metre interval. At our cut
  // weight, 0.08m hatch spacing reads cleanly without moiré at
  // typical viewport sizes.
  const hatchId = "rdcp-hatch";

  // Project each opening onto its containing wall: figure out which
  // side of the room (north / south / east / west) it sits on and
  // its 1D offset + width along that wall. The opening schema gives
  // both endpoints in world coords; one of those coordinates is
  // pinned to a wall line.
  type Side = "north" | "south" | "east" | "west";
  function whichWall(op: Opening): Side {
    const eps = 0.05;
    if (Math.abs(op.z1 - innerT) < eps && Math.abs(op.z2 - innerT) < eps)
      return "north";
    if (Math.abs(op.z1 - innerB) < eps && Math.abs(op.z2 - innerB) < eps)
      return "south";
    if (Math.abs(op.x1 - innerL) < eps && Math.abs(op.x2 - innerL) < eps)
      return "west";
    return "east";
  }

  // Build the wall poché path. We render the cavity (between outer
  // and inner rectangle) using even-odd fill, then erase opening
  // gaps with paper-coloured rects, then re-stamp jamb lines and
  // door arcs / window break-lines on top.
  const pochePath =
    `M ${outerL} ${outerT} H ${outerR} V ${outerB} H ${outerL} Z ` +
    `M ${innerL} ${innerT} V ${innerB} H ${innerR} V ${innerT} Z`;

  // Collect opening rendering data first (single pass) so we can
  // both erase gaps and emit glyphs without repeating the geometry
  // logic.
  type GapRect = { x: number; y: number; w: number; h: number };
  const gaps: GapRect[] = [];
  const glyphs: React.ReactElement[] = [];

  openings.forEach((op, i) => {
    const side = whichWall(op);
    if (side === "north" || side === "south") {
      const x0 = Math.min(op.x1, op.x2);
      const x1 = Math.max(op.x1, op.x2);
      const yT = side === "north" ? outerT : innerB;
      const yB = side === "north" ? innerT : outerB;
      gaps.push({
        x: x0,
        y: yT - 0.001,
        w: x1 - x0,
        h: yB - yT + 0.002,
      });
      // Re-stamp jamb cut lines on the OPENING SIDES so the wall
      // reads as bounded rather than infinitely open.
      glyphs.push(
        <line
          key={`jl-${i}`}
          x1={x0}
          y1={yT}
          x2={x0}
          y2={yB}
          stroke={INK}
          strokeWidth={SW.cutThin}
        />,
        <line
          key={`jr-${i}`}
          x1={x1}
          y1={yT}
          x2={x1}
          y2={yB}
          stroke={INK}
          strokeWidth={SW.cutThin}
        />,
      );

      if (op.kind === "door") {
        // Door: leaf swings INTO the room (negative-z for south wall,
        // positive-z for north wall). Hinge side comes from `swing`
        // — "left" means the hinge is at the west jamb (x0).
        const hingeAtX0 = op.swing !== "right";
        const hingeX = hingeAtX0 ? x0 : x1;
        const arcEndX = hingeAtX0 ? x1 : x0;
        const leafLen = x1 - x0;
        const baseY = side === "south" ? innerB : innerT;
        const endY = side === "south" ? baseY - leafLen : baseY + leafLen;
        // The leaf line.
        glyphs.push(
          <line
            key={`leaf-${i}`}
            x1={hingeX}
            y1={baseY}
            x2={hingeX}
            y2={endY}
            stroke={INK}
            strokeWidth={SW.opening}
          />,
        );
        // The swing arc.
        const sweep =
          (side === "south" && hingeAtX0) || (side === "north" && !hingeAtX0)
            ? 1
            : 0;
        glyphs.push(
          <path
            key={`arc-${i}`}
            d={`M ${hingeX} ${endY} A ${leafLen} ${leafLen} 0 0 ${sweep} ${arcEndX} ${baseY}`}
            fill="none"
            stroke={INK}
            strokeWidth={SW.dim * 1.4}
          />,
        );
      } else {
        // Window break-line: 3 parallel lines spanning the wall
        // thickness. Two heavy at the wall faces, one thinner at
        // the wall midline (the glass).
        const yMid = (yT + yB) / 2;
        glyphs.push(
          <line
            key={`wt-${i}`}
            x1={x0}
            y1={yT}
            x2={x1}
            y2={yT}
            stroke={INK}
            strokeWidth={SW.opening}
          />,
          <line
            key={`wb-${i}`}
            x1={x0}
            y1={yB}
            x2={x1}
            y2={yB}
            stroke={INK}
            strokeWidth={SW.opening}
          />,
          <line
            key={`wm-${i}`}
            x1={x0}
            y1={yMid}
            x2={x1}
            y2={yMid}
            stroke={INK}
            strokeWidth={SW.dim}
          />,
        );
      }
    } else {
      // East / west wall — vertical opening.
      const z0 = Math.min(op.z1, op.z2);
      const z1 = Math.max(op.z1, op.z2);
      const xL = side === "west" ? outerL : innerR;
      const xR = side === "west" ? innerL : outerR;
      gaps.push({
        x: xL - 0.001,
        y: z0,
        w: xR - xL + 0.002,
        h: z1 - z0,
      });
      glyphs.push(
        <line
          key={`jl-${i}`}
          x1={xL}
          y1={z0}
          x2={xR}
          y2={z0}
          stroke={INK}
          strokeWidth={SW.cutThin}
        />,
        <line
          key={`jr-${i}`}
          x1={xL}
          y1={z1}
          x2={xR}
          y2={z1}
          stroke={INK}
          strokeWidth={SW.cutThin}
        />,
      );

      if (op.kind === "door") {
        // Door on a vertical wall — leaf perpendicular into the
        // room (positive-x for west wall, negative-x for east wall).
        const hingeAtZ0 = op.swing !== "right";
        const hingeZ = hingeAtZ0 ? z0 : z1;
        const arcEndZ = hingeAtZ0 ? z1 : z0;
        const leafLen = z1 - z0;
        const baseX = side === "west" ? innerL : innerR;
        const endX = side === "west" ? baseX + leafLen : baseX - leafLen;
        glyphs.push(
          <line
            key={`leaf-${i}`}
            x1={baseX}
            y1={hingeZ}
            x2={endX}
            y2={hingeZ}
            stroke={INK}
            strokeWidth={SW.opening}
          />,
        );
        const sweep =
          (side === "west" && hingeAtZ0) || (side === "east" && !hingeAtZ0)
            ? 0
            : 1;
        glyphs.push(
          <path
            key={`arc-${i}`}
            d={`M ${endX} ${hingeZ} A ${leafLen} ${leafLen} 0 0 ${sweep} ${baseX} ${arcEndZ}`}
            fill="none"
            stroke={INK}
            strokeWidth={SW.dim * 1.4}
          />,
        );
      } else {
        const xMid = (xL + xR) / 2;
        glyphs.push(
          <line
            key={`wl-${i}`}
            x1={xL}
            y1={z0}
            x2={xL}
            y2={z1}
            stroke={INK}
            strokeWidth={SW.opening}
          />,
          <line
            key={`wr-${i}`}
            x1={xR}
            y1={z0}
            x2={xR}
            y2={z1}
            stroke={INK}
            strokeWidth={SW.opening}
          />,
          <line
            key={`wm-${i}`}
            x1={xMid}
            y1={z0}
            x2={xMid}
            y2={z1}
            stroke={INK}
            strokeWidth={SW.dim}
          />,
        );
      }
    }
  });

  // Furniture symbols. Each piece is drawn at its world position
  // with stroke-weight ~25-35% of cut weight per architectural
  // convention. Symbol class is inferred from item shape + label
  // keywords; falls back to a plain rounded rectangle.
  const pieceGlyphs = footprints.map((p) => {
    const label = p.label.toLowerCase();
    const isSelected = p.id === selectedId;
    const ringStroke = isSelected ? ACCENT : INK;
    const baseStroke = isSelected ? ACCENT : INK;
    const baseWidth = isSelected ? SW.furniture * 1.6 : SW.furniture;

    // Common rotated-frame transform: piece is centered at (x, z),
    // its width runs along world-x, depth along world-z. Real
    // pieces have a rotation but this v1 axis-aligns them — the
    // existing FloorPlan2D does the same for room-director scenes.
    const x0 = p.x - p.width / 2;
    const z0 = p.z - p.depth / 2;
    const cx = p.x;
    const cz = p.z;

    // Symbol picker.
    let inner: React.ReactElement | null = null;
    if (label.includes("sofa") || label.includes("sectional")) {
      // Cushion divisions along the longer axis.
      const along = p.depth > p.width ? "z" : "x";
      const inset = SW.furniture * 1.6;
      const cushions = 3;
      inner =
        along === "z" ? (
          <>
            {Array.from({ length: cushions }).map((_, i) => {
              const cd = (p.depth - 2 * inset) / cushions;
              return (
                <rect
                  key={i}
                  x={x0 + inset}
                  y={z0 + inset + i * cd}
                  width={p.width - 2 * inset}
                  height={cd - inset * 0.4}
                  fill="none"
                  stroke={baseStroke}
                  strokeWidth={baseWidth * 0.7}
                  rx={0.04}
                />
              );
            })}
          </>
        ) : (
          <>
            {Array.from({ length: cushions }).map((_, i) => {
              const cw = (p.width - 2 * inset) / cushions;
              return (
                <rect
                  key={i}
                  x={x0 + inset + i * cw}
                  y={z0 + inset}
                  width={cw - inset * 0.4}
                  height={p.depth - 2 * inset}
                  fill="none"
                  stroke={baseStroke}
                  strokeWidth={baseWidth * 0.7}
                  rx={0.04}
                />
              );
            })}
          </>
        );
    } else if (
      p.shape === "circle" ||
      label.includes("round") ||
      (label.includes("table") &&
        !label.includes("dining") &&
        !label.includes("desk") &&
        Math.abs(p.width - p.depth) < 0.15)
    ) {
      // Circular / oval table: replace the base rect with an ellipse.
      return (
        <g
          key={p.id}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(p.id);
          }}
          style={{ cursor: "pointer" }}
        >
          <ellipse
            cx={cx}
            cy={cz}
            rx={p.width / 2}
            ry={p.depth / 2}
            fill="none"
            stroke={ringStroke}
            strokeWidth={baseWidth}
          />
          {/* v0.40.50: label for the round table too. */}
          {Math.min(p.width, p.depth) > 0.55 && (
            <>
              <rect
                x={cx - Math.min(p.width * 0.42, 0.9)}
                y={cz - 0.13}
                width={Math.min(p.width * 0.84, 1.8)}
                height={0.26}
                fill={PAPER}
                opacity={0.78}
                rx={0.04}
                pointerEvents="none"
              />
              <text
                x={cx}
                y={cz + 0.05}
                textAnchor="middle"
                fontSize={Math.min(p.width * 0.14, 0.18)}
                fontWeight={500}
                fill={INK}
                opacity={0.85}
                pointerEvents="none"
                style={{
                  fontFamily: "var(--font-app), system-ui, sans-serif",
                  userSelect: "none",
                }}
              >
                {p.label.length > 14 ? p.label.slice(0, 13) + "…" : p.label}
              </text>
            </>
          )}
          {isSelected && (
            <ellipse
              cx={cx}
              cy={cz}
              rx={p.width / 2 + 0.06}
              ry={p.depth / 2 + 0.06}
              fill="none"
              stroke={ACCENT}
              strokeWidth={SW.furniture * 0.8}
              opacity={0.6}
            />
          )}
          {isSelected && (
            <g pointerEvents="none">
              <rect
                x={cx - 0.55}
                y={cz + p.depth / 2 + 0.08}
                width={1.1}
                height={0.26}
                fill={PAPER}
                stroke={ACCENT}
                strokeWidth={0.012}
                rx={0.05}
                opacity={0.95}
              />
              <text
                x={cx}
                y={cz + p.depth / 2 + 0.26}
                textAnchor="middle"
                fontSize={0.16}
                fontWeight={600}
                fill={ACCENT}
                style={{
                  fontFamily: "var(--font-app), system-ui, sans-serif",
                  userSelect: "none",
                }}
              >
                {p.width.toFixed(2)} × {p.depth.toFixed(2)} m
              </text>
            </g>
          )}
        </g>
      );
    } else if (
      label.includes("credenza") ||
      label.includes("console") ||
      label.includes("dresser")
    ) {
      // Drawer divisions.
      const drawers = 4;
      inner = (
        <>
          {Array.from({ length: drawers - 1 }).map((_, i) => (
            <line
              key={i}
              x1={x0 + ((i + 1) * p.width) / drawers}
              y1={z0}
              x2={x0 + ((i + 1) * p.width) / drawers}
              y2={z0 + p.depth}
              stroke={baseStroke}
              strokeWidth={baseWidth * 0.7}
            />
          ))}
        </>
      );
    } else if (
      label.includes("dining") ||
      (label.includes("table") && p.width >= 1.2)
    ) {
      // Dining table with 4 chairs flanking it (small rounded rects).
      const chairW = 0.4;
      const chairD = 0.4;
      const inset = 0.08;
      inner = (
        <>
          <rect
            x={x0 + p.width * 0.2}
            y={z0 - chairD - inset}
            width={chairW}
            height={chairD}
            rx={0.04}
            fill="none"
            stroke={baseStroke}
            strokeWidth={baseWidth * 0.7}
          />
          <rect
            x={x0 + p.width * 0.6}
            y={z0 - chairD - inset}
            width={chairW}
            height={chairD}
            rx={0.04}
            fill="none"
            stroke={baseStroke}
            strokeWidth={baseWidth * 0.7}
          />
          <rect
            x={x0 + p.width * 0.2}
            y={z0 + p.depth + inset}
            width={chairW}
            height={chairD}
            rx={0.04}
            fill="none"
            stroke={baseStroke}
            strokeWidth={baseWidth * 0.7}
          />
          <rect
            x={x0 + p.width * 0.6}
            y={z0 + p.depth + inset}
            width={chairW}
            height={chairD}
            rx={0.04}
            fill="none"
            stroke={baseStroke}
            strokeWidth={baseWidth * 0.7}
          />
        </>
      );
    } else if (label.includes("chair") || label.includes("armchair")) {
      // Inner seat hint.
      const inset = 0.08;
      inner = (
        <rect
          x={x0 + inset}
          y={z0 + inset}
          width={p.width - 2 * inset}
          height={p.depth - 3 * inset}
          rx={0.04}
          fill="none"
          stroke={baseStroke}
          strokeWidth={baseWidth * 0.7}
        />
      );
    } else if (label.includes("bed")) {
      // Pillow row + duvet division line near the head.
      const pillowH = 0.2;
      inner = (
        <>
          <rect
            x={x0 + 0.1}
            y={z0 + 0.05}
            width={(p.width - 0.2) / 2 - 0.05}
            height={pillowH}
            rx={0.03}
            fill="none"
            stroke={baseStroke}
            strokeWidth={baseWidth * 0.7}
          />
          <rect
            x={x0 + 0.1 + (p.width - 0.2) / 2 + 0.05}
            y={z0 + 0.05}
            width={(p.width - 0.2) / 2 - 0.05}
            height={pillowH}
            rx={0.03}
            fill="none"
            stroke={baseStroke}
            strokeWidth={baseWidth * 0.7}
          />
          <line
            x1={x0 + 0.05}
            y1={z0 + pillowH + 0.1}
            x2={x0 + p.width - 0.05}
            y2={z0 + pillowH + 0.1}
            stroke={baseStroke}
            strokeWidth={baseWidth * 0.5}
          />
        </>
      );
    }

    return (
      <g
        key={p.id}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(p.id);
        }}
        style={{ cursor: "pointer" }}
      >
        <rect
          x={x0}
          y={z0}
          width={p.width}
          height={p.depth}
          fill="none"
          stroke={ringStroke}
          strokeWidth={baseWidth}
          rx={0.06}
        />
        {inner}
        {/* v0.40.50: piece label rendered inside the footprint when
            the piece is wide enough, otherwise above. Without this,
            the user sees architectural symbols but no names — has
            to guess what's a sofa vs. coffee table vs. media unit.
            The label is the short user-facing name (e.g. "Sofa",
            "Coffee table") capped at 14 chars so it fits even on
            narrow nightstands. Rendered with a paper-colored
            background pill so it stays readable against the dense
            cushion / frame strokes inside the footprint. Only
            renders for pieces with at least 0.55m on the shorter
            edge — anything smaller is too dense for text. */}
        {Math.min(p.width, p.depth) > 0.55 && (
          <>
            <rect
              x={cx - Math.min(p.width * 0.42, 0.9)}
              y={cz - 0.13}
              width={Math.min(p.width * 0.84, 1.8)}
              height={0.26}
              fill={PAPER}
              opacity={0.78}
              rx={0.04}
              pointerEvents="none"
            />
            <text
              x={cx}
              y={cz + 0.05}
              textAnchor="middle"
              fontSize={Math.min(p.width * 0.14, 0.18)}
              fontWeight={500}
              fill={INK}
              opacity={0.85}
              pointerEvents="none"
              style={{
                fontFamily: "var(--font-app), system-ui, sans-serif",
                userSelect: "none",
              }}
            >
              {p.label.length > 14 ? p.label.slice(0, 13) + "…" : p.label}
            </text>
          </>
        )}
        {isSelected && (
          <rect
            x={x0 - 0.06}
            y={z0 - 0.06}
            width={p.width + 0.12}
            height={p.depth + 0.12}
            fill="none"
            stroke={ACCENT}
            strokeWidth={SW.furniture * 0.7}
            rx={0.08}
            opacity={0.6}
          />
        )}
        {/* v0.40.50: dimension callout for the selected piece —
            "1.80 × 0.85 m" rendered just below the footprint with
            an accent color. Only one piece is selected at a time so
            the label can't accumulate; auto-clears when user selects
            another or clicks empty floor. */}
        {isSelected && (
          <g pointerEvents="none">
            <rect
              x={cx - 0.55}
              y={z0 + p.depth + 0.08}
              width={1.1}
              height={0.26}
              fill={PAPER}
              stroke={ACCENT}
              strokeWidth={0.012}
              rx={0.05}
              opacity={0.95}
            />
            <text
              x={cx}
              y={z0 + p.depth + 0.26}
              textAnchor="middle"
              fontSize={0.16}
              fontWeight={600}
              fill={ACCENT}
              style={{
                fontFamily: "var(--font-app), system-ui, sans-serif",
                userSelect: "none",
              }}
            >
              {p.width.toFixed(2)} × {p.depth.toFixed(2)} m
            </text>
          </g>
        )}
      </g>
    );
  });

  // Dimension chains (skipped in compact mode — labels become
  // unreadable below ~250px of widget width). Two chains per axis:
  // overall + opening segments.
  const dimChains: React.ReactElement[] = [];
  if (!compact) {
    const overallY = outerT - margin.top * 0.4;
    const segmentY = outerT - margin.top * 0.15;
    const overallX = outerR + margin.right * 0.55;
    const segmentX = outerR + margin.right * 0.2;

    // Tick + line + cleared label box.
    const dimLine = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      label: string,
      horizontal: boolean,
      key: string,
    ) => {
      const tk = 0.08;
      const elements: React.ReactElement[] = [
        <line
          key={`l-${key}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={INK}
          strokeWidth={SW.dim}
        />,
      ];
      if (horizontal) {
        elements.push(
          <line
            key={`t1-${key}`}
            x1={x1}
            y1={y1 - tk}
            x2={x1}
            y2={y1 + tk}
            stroke={INK}
            strokeWidth={SW.dim}
          />,
          <line
            key={`t2-${key}`}
            x1={x2}
            y1={y2 - tk}
            x2={x2}
            y2={y2 + tk}
            stroke={INK}
            strokeWidth={SW.dim}
          />,
          <rect
            key={`b-${key}`}
            x={(x1 + x2) / 2 - 0.28}
            y={y1 - 0.13}
            width={0.56}
            height={0.18}
            fill={PAPER}
          />,
          <text
            key={`x-${key}`}
            x={(x1 + x2) / 2}
            y={y1 + 0.01}
            textAnchor="middle"
            fontSize={0.16}
            fill={INK}
            fontFamily="var(--font-app), system-ui, sans-serif"
          >
            {label}
          </text>,
        );
      } else {
        elements.push(
          <line
            key={`t1-${key}`}
            x1={x1 - tk}
            y1={y1}
            x2={x1 + tk}
            y2={y1}
            stroke={INK}
            strokeWidth={SW.dim}
          />,
          <line
            key={`t2-${key}`}
            x1={x2 - tk}
            y1={y2}
            x2={x2 + tk}
            y2={y2}
            stroke={INK}
            strokeWidth={SW.dim}
          />,
          <rect
            key={`b-${key}`}
            x={x1 - 0.3}
            y={(y1 + y2) / 2 - 0.1}
            width={0.6}
            height={0.18}
            fill={PAPER}
          />,
          <text
            key={`x-${key}`}
            x={x1}
            y={(y1 + y2) / 2 + 0.05}
            textAnchor="middle"
            fontSize={0.16}
            fill={INK}
            fontFamily="var(--font-app), system-ui, sans-serif"
          >
            {label}
          </text>,
        );
      }
      return <g key={key}>{elements}</g>;
    };

    // Overall horizontal: outer width.
    dimChains.push(
      dimLine(
        outerL,
        overallY,
        outerR,
        overallY,
        roomMeta.width.toFixed(2),
        true,
        "ovX",
      ),
    );
    // Segments: walk north-wall openings.
    const northOps = openings
      .filter(
        (op) =>
          Math.abs(op.z1 - innerT) < 0.05 && Math.abs(op.z2 - innerT) < 0.05,
      )
      .sort((a, b) => Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2));
    const xSegPts: number[] = [outerL];
    northOps.forEach((op) => {
      xSegPts.push(Math.min(op.x1, op.x2), Math.max(op.x1, op.x2));
    });
    xSegPts.push(outerR);
    for (let i = 0; i < xSegPts.length - 1; i++) {
      const len = xSegPts[i + 1] - xSegPts[i];
      if (len < 0.1) continue;
      dimChains.push(
        dimLine(
          xSegPts[i],
          segmentY,
          xSegPts[i + 1],
          segmentY,
          len.toFixed(2),
          true,
          `xseg-${i}`,
        ),
      );
    }

    // Overall vertical.
    dimChains.push(
      dimLine(
        overallX,
        outerT,
        overallX,
        outerB,
        roomMeta.depth.toFixed(2),
        false,
        "ovZ",
      ),
    );
    const eastOps = openings
      .filter(
        (op) =>
          Math.abs(op.x1 - innerR) < 0.05 && Math.abs(op.x2 - innerR) < 0.05,
      )
      .sort((a, b) => Math.min(a.z1, a.z2) - Math.min(b.z1, b.z2));
    const zSegPts: number[] = [outerT];
    eastOps.forEach((op) => {
      zSegPts.push(Math.min(op.z1, op.z2), Math.max(op.z1, op.z2));
    });
    zSegPts.push(outerB);
    for (let i = 0; i < zSegPts.length - 1; i++) {
      const len = zSegPts[i + 1] - zSegPts[i];
      if (len < 0.1) continue;
      dimChains.push(
        dimLine(
          segmentX,
          zSegPts[i],
          segmentX,
          zSegPts[i + 1],
          len.toFixed(2),
          false,
          `zseg-${i}`,
        ),
      );
    }
  }

  return (
    <svg
      viewBox={`${vbX} ${vbZ} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onSelect(null);
      }}
      style={{ background: PAPER }}
    >
      <defs>
        <pattern
          id={hatchId}
          width={0.08}
          height={0.08}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={0.08}
            stroke={INK}
            strokeWidth={SW.hatch}
          />
        </pattern>
      </defs>

      {/* Wall poché — outer minus inner, hatched. */}
      <path
        d={pochePath}
        fill={`url(#${hatchId})`}
        fillRule="evenodd"
        stroke="none"
      />

      {/* Erase opening gaps (paper-coloured rects subtract from the
          wall fill). */}
      {gaps.map((g, i) => (
        <rect
          key={`gap-${i}`}
          x={g.x}
          y={g.y}
          width={g.w}
          height={g.h}
          fill={PAPER}
        />
      ))}

      {/* Heavy cut-line outlines: outer envelope + inner room. These
          are what gives architectural plans their authority — the
          eye reads the bold edge as "this is structure." */}
      <rect
        x={outerL}
        y={outerT}
        width={outerR - outerL}
        height={outerB - outerT}
        fill="none"
        stroke={INK}
        strokeWidth={SW.cut}
      />
      <rect
        x={innerL}
        y={innerT}
        width={innerR - innerL}
        height={innerB - innerT}
        fill="none"
        stroke={INK}
        strokeWidth={SW.cut}
      />

      {/* Door arcs, window break-lines, re-stamped jambs. */}
      {glyphs}

      {/* Furniture (lighter weight). Click handlers wire to the
          studio's selection — same selectFurniture(id) the existing
          FloorPlan2D uses. */}
      {pieceGlyphs}

      {/* Room label centered on the floor. */}
      {!compact && (
        <>
          <text
            x={(innerL + innerR) / 2}
            y={innerB - 0.4}
            textAnchor="middle"
            fontSize={0.22}
            fontWeight={500}
            fill={INK}
            letterSpacing={0.04}
            fontFamily="var(--font-app), system-ui, sans-serif"
          >
            LIVING ROOM
          </text>
          <text
            x={(innerL + innerR) / 2}
            y={innerB - 0.12}
            textAnchor="middle"
            fontSize={0.16}
            fill={INK}
            opacity={0.7}
            fontFamily="var(--font-app), system-ui, sans-serif"
          >
            {(roomMeta.width * roomMeta.depth).toFixed(1)} m²
          </text>
        </>
      )}
      {/* v0.40.50: compact-mode room area pill at the bottom of the
          floor. The full mode has a generous LIVING ROOM + area
          stamp; the Reference card miniature lacked any orientation
          aid showing total area. A small floating pill at the
          bottom-center reads as "this is the room footprint" without
          competing with furniture labels. */}
      {compact && (
        <g pointerEvents="none">
          <rect
            x={(innerL + innerR) / 2 - 0.7}
            y={innerB - 0.32}
            width={1.4}
            height={0.36}
            fill={PAPER}
            stroke={INK}
            strokeWidth={0.012}
            rx={0.06}
            opacity={0.85}
          />
          <text
            x={(innerL + innerR) / 2}
            y={innerB - 0.1}
            textAnchor="middle"
            fontSize={0.18}
            fontWeight={500}
            fill={INK}
            opacity={0.85}
            fontFamily="var(--font-app), system-ui, sans-serif"
          >
            {roomMeta.width.toFixed(1)} × {roomMeta.depth.toFixed(1)} m ·{" "}
            {(roomMeta.width * roomMeta.depth).toFixed(1)} m²
          </text>
        </g>
      )}

      {/* Dimension chains. */}
      {dimChains}

      {/* North arrow + scale bar — full mode only. */}
      {!compact && (
        <>
          <g
            transform={`translate(${outerR + margin.right * 0.55} ${outerT + 0.1})`}
          >
            <circle
              cx={0}
              cy={0}
              r={0.22}
              fill={PAPER}
              stroke={INK}
              strokeWidth={SW.dim}
            />
            <path
              d="M 0 -0.16 L 0.06 0.12 L 0 0.07 L -0.06 0.12 Z"
              fill={INK}
              stroke={INK}
              strokeWidth={SW.dim}
              strokeLinejoin="round"
            />
            <text
              x={0}
              y={-0.28}
              textAnchor="middle"
              fontSize={0.16}
              fontWeight={500}
              fill={INK}
              fontFamily="var(--font-app), system-ui, sans-serif"
            >
              N
            </text>
          </g>

          <g transform={`translate(${outerL} ${outerB + margin.bottom * 0.5})`}>
            {Array.from({ length: 3 }).map((_, i) => (
              <rect
                key={i}
                x={i * 1}
                y={0}
                width={1}
                height={0.06}
                fill={i % 2 === 0 ? INK : PAPER}
                stroke={INK}
                strokeWidth={SW.dim}
              />
            ))}
            {Array.from({ length: 4 }).map((_, i) => (
              <text
                key={`n-${i}`}
                x={i}
                y={0.28}
                textAnchor="middle"
                fontSize={0.14}
                fill={INK}
                fontFamily="var(--font-app), system-ui, sans-serif"
              >
                {i}
              </text>
            ))}
            <text
              x={3.2}
              y={0.1}
              fontSize={0.14}
              fill={INK}
              fontFamily="var(--font-app), system-ui, sans-serif"
            >
              m
            </text>
          </g>
        </>
      )}
    </svg>
  );
}
