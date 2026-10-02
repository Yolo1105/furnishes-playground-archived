/**
 * The thinking states cycled through during the simulated processing
 * delay between Send and the system response. Each state is a label
 * and an inline SVG icon (12px, stroke 1.8). The newest line in the
 * rolling log gets the accent color and a pulse animation; older
 * lines fade.
 *
 * v0.40.43 voice rewrite: replaced the prior lifestyle-y strings
 * ("Reading your space", "Picking a palette", "Tuning the mood")
 * with designer-notebook language a real interior architect would
 * actually write while working. Same length so the rolling stack
 * doesn't jump width on each tick. Each is a 2-or-3-syllable verb
 * + noun phrase, present participle. Eight states instead of ten —
 * consolidated overlapping pairs ("Studying proportions" /
 * "Balancing scale" → "Refining proportions"; "Looking at materials"
 * / "Considering texture" → "Selecting materials").
 *
 * v0.40.43 polish: "Studying materials" → "Selecting materials".
 * The original wording duplicated the "Studying" prefix shared with
 * "Studying the room", so two of eight cycle entries started with
 * the same verb — the rolling stack felt repetitive. "Selecting" is
 * what a designer actually does (pulling samples, choosing finishes),
 * is the right grammatical aspect for the cycle, and gives every
 * state a unique opening verb.
 *
 * Inline SVGs (rather than an icon library) match the JSX exactly
 * and avoid a runtime dependency for a one-off animation.
 */
import type { ReactNode } from "react";

interface ThinkingState {
  text: string;
  icon: ReactNode;
}

const SVG_PROPS = {
  width: 12,
  height: 12,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const THINKING_STATES: ThinkingState[] = [
  {
    text: "Reading the brief",
    icon: (
      <svg {...SVG_PROPS}>
        <path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4z" />
        <path d="M8 8h8" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
      </svg>
    ),
  },
  {
    text: "Sketching options",
    icon: (
      <svg {...SVG_PROPS}>
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
  },
  {
    text: "Studying the room",
    icon: (
      <svg {...SVG_PROPS}>
        <rect x="3" y="3" width="18" height="18" rx="1" />
        <path d="M3 12h18" />
        <path d="M12 3v18" />
      </svg>
    ),
  },
  {
    text: "Placing anchor pieces",
    icon: (
      <svg {...SVG_PROPS}>
        <path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3" />
        <path d="M2 11v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-4 0z" />
        <line x1="6" y1="18" x2="6" y2="20" />
        <line x1="18" y1="18" x2="18" y2="20" />
      </svg>
    ),
  },
  {
    text: "Checking clearances",
    icon: (
      <svg {...SVG_PROPS}>
        <path d="M3 6h18" />
        <path d="M3 18h18" />
        <path d="M5 6v12" />
        <path d="M19 6v12" />
        <path d="M9 12h6" />
        <polyline points="11 10 9 12 11 14" />
        <polyline points="13 10 15 12 13 14" />
      </svg>
    ),
  },
  {
    text: "Aligning sight lines",
    icon: (
      <svg {...SVG_PROPS}>
        <path d="M2 12h20" />
        <circle cx="6" cy="12" r="2" />
        <circle cx="18" cy="12" r="2" />
        <path d="M12 4v4" />
        <path d="M12 16v4" />
      </svg>
    ),
  },
  {
    text: "Refining proportions",
    icon: (
      <svg {...SVG_PROPS}>
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    ),
  },
  {
    text: "Selecting materials",
    icon: (
      <svg {...SVG_PROPS}>
        <path d="M12 2 2 7l10 5 10-5-10-5z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </svg>
    ),
  },
];
