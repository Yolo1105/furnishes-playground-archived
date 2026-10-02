import type { Mode, ModeConfig } from "@studio/store/types";

/**
 * The chat modes shown in the bottom-right dropdown. Each mode has
 * its own set of three guided-context fields that appear when the user
 * toggles "Guided context" on. Ask mode is read-only Q&A (Turn 4) —
 * it has no guided-context fields because it isn't producing
 * design output, just answering questions.
 *
 * Field copy is preserved verbatim from the JSX — these placeholders
 * are intentional examples that hint at the kind of answer expected,
 * not generic prompts.
 */
export const MODE_CONFIG: Record<Mode, ModeConfig> = {
  Ask: {
    desc: "Read-only Q&A",
    keywords: [],
  },
  "Interior Design": {
    desc: "Thoughtful spatial design",
    keywords: [
      {
        key: "style",
        label: "Style",
        placeholder: "modern, minimalist, boho…",
      },
      { key: "room", label: "Room", placeholder: "living room, bedroom…" },
      { key: "vibe", label: "Vibe", placeholder: "cozy, bright, moody…" },
    ],
  },
  Furniture: {
    desc: "Pieces and arrangements",
    keywords: [
      { key: "piece", label: "Piece", placeholder: "sofa, dining table…" },
      {
        key: "style",
        label: "Style",
        placeholder: "mid-century, Scandinavian…",
      },
      {
        key: "constraint",
        label: "Constraint",
        placeholder: "small space, budget…",
      },
    ],
  },
  "Room Layout": {
    desc: "Flow, proportions, scale",
    keywords: [
      { key: "room", label: "Room", placeholder: "living room, studio…" },
      { key: "size", label: "Size", placeholder: "15×20 ft, small, open…" },
      { key: "priority", label: "Priority", placeholder: "WFH, entertaining…" },
    ],
  },
};

/** Iterable array of all mode names — for rendering the picker. */
export const MODES: Mode[] = Object.keys(MODE_CONFIG) as Mode[];
