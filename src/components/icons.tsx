/**
 * Shared inline-SVG icon set for the whole app. The JSX uses the same
 * style throughout: 24×24 viewBox, fill="none", stroke 1.8 (UI) or 2
 * (chevrons / send arrow), rounded caps and joins. Kept here in one
 * file rather than a runtime icon library so the visuals are exact
 * matches and there is no extra dependency.
 */

export interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const stroke18 = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const stroke20 = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const stroke25 = {
  fill: "none",
  strokeWidth: 2.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ImageIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m21 15-4-4a2 2 0 0 0-2.8 0L4 21" />
    </svg>
  );
}

export function LightbulbIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z" />
    </svg>
  );
}

export function ChevronDownIcon({
  size = 12,
  rotated = false,
  ...rest
}: IconProps & { rotated?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...stroke20}
      style={{
        transition: "transform 0.2s ease",
        transform: rotated ? "rotate(180deg)" : "rotate(0deg)",
        ...rest.style,
      }}
      className={rest.className}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function ChevronUpIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke20} {...rest}>
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

export function SendArrowIcon({ size = 15, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke20} {...rest}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export function MicIcon({ size = 15, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M19 11v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="9" y1="22" x2="15" y2="22" />
    </svg>
  );
}

interface CheckProps extends IconProps {
  color?: string;
}
export function CheckIcon({
  size = 16,
  color = "currentColor",
  ...rest
}: CheckProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      stroke={color}
      {...stroke25}
      className={rest.className}
      style={rest.style}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function CloseIcon({ size = 12, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke20} {...rest}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** Plus sign used by the "add more images" tile inside the input. */
export function PlusIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Cloud-upload icon used inside the upload modal's dropzone. */
export function UploadCloudIcon({ size = 28, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M16 16l-4-4-4 4" />
      <path d="M12 12v9" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      <path d="M16 16l-4-4-4 4" />
    </svg>
  );
}

/** Single-user/person icon — used in the workspace subtitle on the
 *  top project card. */
export function UserIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M4 21v-2a4 4 0 0 1 3-3.87" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/** Right-pointing arrow — used on the "See all projects" footer link
 *  in the project switcher dropdown. */
export function ArrowRightIcon({ size = 15, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke20} {...rest}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/** Four-direction move icon — used by the topbar translate-mode
 *  toggle. Visually communicates "drag in X/Z" by showing arrows
 *  pointing N/S/E/W from a center point. */
export function MoveIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );
}

/** Help / question-mark in a circle — used as the collapsed-state
 *  affordance for the keyboard-shortcut hints. */
export function HelpCircleIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Sparkle / four-point star — used by the proactive design
 *  suggestions button in the top bar. The four-point star is a
 *  visual shorthand for "AI / generated insight" without leaning on
 *  branded iconography. */
export function SparkleIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      {/* Main sparkle: a four-point star at the centre */}
      <path d="M12 3 L13.5 10.5 L21 12 L13.5 13.5 L12 21 L10.5 13.5 L3 12 L10.5 10.5 Z" />
      {/* Small accent sparkle in the upper-right */}
      <path d="M19 4 L19.5 6 L21.5 6.5 L19.5 7 L19 9 L18.5 7 L16.5 6.5 L18.5 6 Z" />
    </svg>
  );
}

/** Curved arrow pointing left — undo. */
export function UndoIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 3L3 13" />
    </svg>
  );
}

/** Curved arrow pointing right — redo. */
export function RedoIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3L21 13" />
    </svg>
  );
}

/** Counter-clockwise circular arrow — reset layout. */
export function RotateCcwIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

/** Compass — used as the Cardinal Lights toggle in TopBar.
 *  Visual: a circle with a north-pointing diamond and short tick
 *  marks at E/S/W. Reads as "directional reference" without being
 *  literal cardinal arrows. v0.40.47. */
export function CompassIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <circle cx="12" cy="12" r="9" />
      {/* North-pointing diamond (filled to differentiate from S/E/W ticks) */}
      <polygon
        points="12,4 14,12 12,14 10,12"
        fill="currentColor"
        stroke="none"
      />
      {/* East tick */}
      <line x1="20" y1="12" x2="17" y2="12" />
      {/* South tick */}
      <line x1="12" y1="20" x2="12" y2="17" />
      {/* West tick */}
      <line x1="4" y1="12" x2="7" y2="12" />
      {/* Center */}
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Crosshair / focus icon — "snap camera back to default view."
 *  Visually distinct from RotateCcwIcon (which used to share the
 *  circular-arrow language with Rotate3DIcon and was confusing in
 *  the toolbar lineup). The crosshair semantics — "center / focus
 *  on the target" — fit the camera-reset action better than a
 *  generic rotate. v0.40.42. */
export function HomeViewIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="3" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="21" />
      <line x1="3" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="21" y2="12" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

/** Two crossing arrows — shuffle / randomize layout. */
export function ShuffleIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}

/** Four-point sparkle — post-processing visual effects. */
export function SparklesIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17l-1.9-5.1L4.5 10l5.6-1.4L12 3z" />
      <path d="M19 16l.7 1.8L21.5 18l-1.8.7L19 20l-.7-1.3L16.5 18l1.8-.2L19 16z" />
      <path d="M5 16l.6 1.4L7 18l-1.4.6L5 20l-.6-1.4L3 18l1.4-.6L5 16z" />
    </svg>
  );
}

/** Map-pin / location dot — floor hotspots. */
export function MapPinIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/** Sun with rays — environment lighting. */
export function SunIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m4.93 19.07 1.41-1.41" />
      <path d="m17.66 6.34 1.41-1.41" />
    </svg>
  );
}

/** Clipboard with list lines — planner. */
export function ClipboardListIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h.01" />
      <path d="M13 12h4" />
      <path d="M9 16h.01" />
      <path d="M13 16h4" />
    </svg>
  );
}

/** Folded-map glyph — tour. */
export function MapIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

/** Equalizer-style sliders — header icon for the Tools card.
 *  Three horizontal tracks with a knob on each. Matches the JSX
 *  prototype's tools-header SVG. */
export function SlidersIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke20} {...rest}>
      <line x1="4" y1="6" x2="11" y2="6" />
      <line x1="17" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="7" y2="12" />
      <line x1="13" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="15" y2="18" />
      <line x1="19" y1="18" x2="20" y2="18" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}

/** 2×2 rounded-rectangle grid — Catalog tool tile icon. The four
 *  rectangles are slightly varied in size which reads as "catalog
 *  of items" rather than just a uniform grid. */
export function LayoutGridIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
    </svg>
  );
}

/** Heart with a pulse line — Health tool tile icon. */
export function HeartPulseIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
      <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </svg>
  );
}

/** Magnifying glass — search input affordance. */
export function SearchIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/** Plus inside a circle — primary "Add" affordance for the Catalog footer. */
export function PlusCircleIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

/** Eye outline — visibility toggle ON state. */
export function EyeIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Eye with a slash through it — visibility toggle OFF state. */
export function EyeOffIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/** Trash bin — delete affordance for inventory rows. */
export function TrashIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/** Inventory tool tile icon. v0.40.42 redo: the prior 3D-perspective
 *  cube read as busier than its tools-menu peers (which are all flat
 *  2D outlines — picture frame, grid, sparkle, speech bubble, star).
 *  This version is a simple stacked-rectangles silhouette that
 *  matches that visual register. */
export function BoxesIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <rect x="3" y="13" width="8" height="7" rx="1" />
      <rect x="13" y="13" width="8" height="7" rx="1" />
      <rect x="8" y="4" width="8" height="7" rx="1" />
    </svg>
  );
}

/** Footprints — first-person walk-mode top-bar toggle. Two
 *  staggered foot prints: a small heel oval + tucked toes. */
export function FootprintsIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M4 16v-2.38c0-1 .27-1.96.78-2.78L7 7.5" />
      <path d="M20 20v-2.38c0-1 .27-1.96.78-2.78L23 11.5" />
      <path d="M16 17h4" />
      <path d="M0 13h4" />
      <path d="M3 10c0-1.1.9-2 2-2s2 .9 2 2v3a2 2 0 0 1-4 0Z" />
      <path d="M19 14c0-1.1.9-2 2-2s2 .9 2 2v3a2 2 0 0 1-4 0Z" />
    </svg>
  );
}

/** Numbered pin — Reference card waypoint-mode toggle. A simple
 *  round-headed map pin. */
export function PinIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M12 21s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

/** Padlock — used by the Properties card lock toggle. Solid base
 *  rounded rectangle with a curved shackle on top. */
export function LockIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Open padlock — same as LockIcon but with the shackle popped open
 *  to the side, signalling the unlocked state. */
export function UnlockIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0" />
    </svg>
  );
}

/** Pencil/edit icon — used by the projects modal rename affordance.
 *  Diagonal pencil pointing bottom-left to top-right. */
export function EditIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}

/** Stop icon — square. Used by the chat dock's send-while-generating
 *  state to let the user cancel an in-flight generation. */
export function StopIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

/** Rewind icon — a left-facing chevron stacked on a vertical bar.
 *  Reads as "go back to the beginning" — used for the
 *  Reset-to-original button which restores a generated scene to
 *  its frozen baseline. */
export function RewindIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <polygon points="11 19 2 12 11 5 11 19" fill="currentColor" />
      <polygon points="22 19 13 12 22 5 22 19" fill="currentColor" />
    </svg>
  );
}

/** Rotate-3D — a curved arrow PLUS small axis ticks, used for the
 *  rotate-mode topbar toggle. Visually distinct from RotateCcw (the
 *  reset-camera glyph) so the two adjacent toolbar buttons no longer
 *  look identical. v0.40.42. */
export function Rotate3DIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      {/* Curved arrow loop */}
      <path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2" />
      <path d="m15.194 13.707 3.814 1.86-1.86 3.814" />
      <path d="M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4" />
    </svg>
  );
}

/** Cardinal rotate — 上下左右 step control (90° nudges). */
export function RotateCardinalIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <polyline points="12 3 9 7 15 7" />
      <polyline points="12 21 9 17 15 17" />
      <polyline points="3 12 7 9 7 15" />
      <polyline points="21 12 17 9 17 15" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

/** Speech bubble icon — used for the Chat History tool tab. A simple
 *  rounded rectangle with a small tail in the bottom-left. Reads as
 *  "conversations" without needing color or detail. */
export function MessageSquareIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Mouse pointer — CAD select tool. */
export function MousePointerIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M4 4l7 17 2.5-7.5L21 11 4 4z" />
    </svg>
  );
}

/** Open hand — CAD pan tool. */
export function HandIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M8 13V6a1.5 1.5 0 0 1 3 0v5" />
      <path d="M11 11V4a1.5 1.5 0 0 1 3 0v7" />
      <path d="M14 10.5V5a1.5 1.5 0 0 1 3 0v8" />
      <path d="M17 13.5V9a1.5 1.5 0 0 1 3 0v5c0 4-2.5 7-7 7h-1c-3.5 0-6-2-6-5.5V11a1.5 1.5 0 0 1 3 0v2" />
    </svg>
  );
}

/** Ruler — CAD measure tool. */
export function RulerIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M3 16.5L16.5 3l4.5 4.5L7.5 21 3 16.5z" />
      <path d="M13 6.5l1.5 1.5" />
      <path d="M10.5 9l1.5 1.5" />
      <path d="M8 11.5l1.5 1.5" />
    </svg>
  );
}

export function ZoomInIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
    </svg>
  );
}

export function ZoomOutIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M8 11h6" />
    </svg>
  );
}

/** Corner brackets — fit CAD view. */
export function MaximizeIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  );
}

/** Swap / switch assistant — two arrows exchanging. */
export function SwapIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke18} {...rest}>
      <path d="M16 3l4 4-4 4" />
      <path d="M20 7H10" />
      <path d="M8 21l-4-4 4-4" />
      <path d="M4 17h10" />
    </svg>
  );
}
