"use client";

import type { ProjectedRect } from "./cadOrtho";

const FILL = "rgba(255, 209, 173, 0.35)";
const STROKE = "#c45a2c";
const DIM = "#5a7a9a";
const INK = "rgba(26, 26, 26, 0.55)";

/** Min screen px before a center label is considered "fits inside". */
const MIN_LABEL_W_PX = 72;
const MIN_LABEL_H_PX = 18;

function formatMm(v: number): string {
  const r = Math.round(v);
  if (Math.abs(r) >= 1000) {
    return `${Number((r / 1000).toFixed(2))} m`;
  }
  return `${r} mm`;
}

/**
 * Dimensioned orthographic subject — filled elevation/plan rect.
 * Full mode: grips + center size + width/height dimension chains.
 * Compact (Reference): shape + center size label (no grips/chains).
 *
 * When the projected rect is too thin/short for a horizontal W×H
 * stamp, the center label moves outside (or is omitted when dim
 * chains already carry both sizes).
 */
export function CadOrthoSubject({
  projected,
  pxPerMm,
  compact = false,
  dimmed = false,
}: {
  projected: ProjectedRect;
  pxPerMm: number;
  compact?: boolean;
  /** Non-selected pieces in a multi-piece ortho view. */
  dimmed?: boolean;
}) {
  const { u0, u1, v0, v1, widthMm, heightMm } = projected;
  const x = Math.min(u0, u1);
  const w = Math.abs(u1 - u0);
  const yTop = Math.max(v0, v1);
  const yBot = Math.min(v0, v1);
  const h = Math.abs(v1 - v0);
  const cx = (u0 + u1) / 2;
  const cy = (v0 + v1) / 2;
  const s = 1 / Math.max(pxPerMm, 0.001);
  const dimOff = 22 * s;
  const tick = 5 * s;
  /** Screen-pixel sizes → world mm so labels stay readable under
   *  preserveAspectRatio="none" (raw fontSize=11 was ~2px tall). */
  const fontMain = (compact ? 11 : 13) * s;
  const fontDim = 12 * s;
  const grip = 7 * s;

  const screenW = w * pxPerMm;
  const screenH = h * pxPerMm;
  const tooThin = screenW < MIN_LABEL_W_PX;
  const tooShort = screenH < MIN_LABEL_H_PX;
  const sizeLabel = `${formatMm(widthMm)} × ${formatMm(heightMm)}`;

  // Full CAD already has width + height dim chains — skip the
  // overlapping center stamp when it can't fit inside the board.
  const showCenterInside = !dimmed && !tooThin && !tooShort;
  // Compact has no dim chains — park the label beside a thin board.
  const showCenterBeside = compact && !dimmed && (tooThin || tooShort);
  const besideLeft = tooThin && !tooShort;
  const besideBelow = tooShort && !tooThin;
  const labelX = besideLeft ? x - 10 * s : cx;
  const labelY = besideBelow ? -yBot + 14 * s : -cy;
  const labelAnchor = besideLeft ? "end" : "middle";
  const labelBaseline = besideBelow ? "hanging" : "middle";

  const fill = dimmed ? "rgba(255, 209, 173, 0.18)" : FILL;
  const stroke = dimmed ? "rgba(196, 90, 44, 0.45)" : STROKE;
  const strokeW = dimmed ? 1.1 : 1.6;

  return (
    <g style={{ fontFamily: "var(--font-app), system-ui, sans-serif" }}>
      <rect
        x={x}
        y={-yTop}
        width={w}
        height={h}
        fill={fill}
        stroke={stroke}
        strokeWidth={compact ? strokeW : dimmed ? 1.2 : 1.5}
        vectorEffect="non-scaling-stroke"
      />

      {showCenterInside && (
        <text
          x={cx}
          y={-cy}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={INK}
          fontSize={fontMain}
          fontWeight={600}
        >
          {sizeLabel}
        </text>
      )}

      {showCenterBeside && (
        <text
          x={labelX}
          y={labelY}
          textAnchor={labelAnchor}
          dominantBaseline={labelBaseline}
          fill={INK}
          fontSize={fontMain}
          fontWeight={600}
        >
          {sizeLabel}
        </text>
      )}

      {!compact && (
        <>
          {(
            [
              { x: cx - grip / 2, y: -yTop - grip / 2 },
              { x: cx - grip / 2, y: -yBot - grip / 2 },
              { x: x - grip / 2, y: -cy - grip / 2 },
              { x: x + w - grip / 2, y: -cy - grip / 2 },
            ] as const
          ).map((g, i) => (
            <rect
              key={i}
              x={g.x}
              y={g.y}
              width={grip}
              height={grip}
              fill="none"
              stroke={STROKE}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
              rx={1 * s}
            />
          ))}

          <line
            x1={x}
            y1={-yBot + dimOff}
            x2={x + w}
            y2={-yBot + dimOff}
            stroke={DIM}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x}
            y1={-yBot + dimOff - tick}
            x2={x}
            y2={-yBot + dimOff + tick}
            stroke={DIM}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x + w}
            y1={-yBot + dimOff - tick}
            x2={x + w}
            y2={-yBot + dimOff + tick}
            stroke={DIM}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={cx}
            y={-yBot + dimOff + 14 * s}
            textAnchor="middle"
            fill={DIM}
            fontSize={fontDim}
            fontWeight={600}
          >
            {formatMm(widthMm)}
          </text>

          <line
            x1={x + w + dimOff}
            y1={-yBot}
            x2={x + w + dimOff}
            y2={-yTop}
            stroke={DIM}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x + w + dimOff - tick}
            y1={-yBot}
            x2={x + w + dimOff + tick}
            y2={-yBot}
            stroke={DIM}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x + w + dimOff - tick}
            y1={-yTop}
            x2={x + w + dimOff + tick}
            y2={-yTop}
            stroke={DIM}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={x + w + dimOff + 12 * s}
            y={-cy}
            dominantBaseline="middle"
            fill={DIM}
            fontSize={fontDim}
            fontWeight={600}
          >
            {formatMm(heightMm)}
          </text>
        </>
      )}
    </g>
  );
}
