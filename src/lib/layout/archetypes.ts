/**
 * Layout archetypes — Increment 2 of the layout-quality work.
 *
 * Ports `configs/layout_archetypes.yaml` from the Furniture-
 * Arrangement-Generator repo as TypeScript data, plus a room-type
 * detector and a prompt formatter. Used by the orchestrator to
 * inject canonical placement patterns into the system prompt
 * before Claude generates the layout — gives Claude concrete
 * priors instead of cold-starting from "place 5-8 pieces."
 *
 * The archetypes themselves are well-known interior design
 * conventions (centered_bed, focal_point, conversation_area, etc.).
 * Each is a small list of (piece_type, position_constraint, target,
 * distance_range, priority) rules. Claude reads these as guidance,
 * not hard requirements — it picks an archetype that matches the
 * user's intent and uses the rules to place the relevant pieces.
 *
 * Detection: we run a small set of keyword rules against the
 * user's prompt to pick a room type. Conservative — when in doubt,
 * we return null and the orchestrator skips the archetype
 * injection (Claude falls back to the existing prompt). False
 * positives are worse than false negatives here: telling Claude
 * "this is a bedroom, prefer the centered_bed archetype" when the
 * user asked for a living room would produce a worse layout than
 * the no-archetype baseline.
 */

export type RoomType =
  | "bedroom"
  | "living_room"
  | "home_office"
  | "studio"
  | "dining_room";

export interface ArchetypeRule {
  /** Furniture category this rule applies to (matches the
   *  category Claude emits in PlacedPiece.category, after
   *  normalization to lowercase + underscores). */
  furniture_type: string;
  /** Spatial constraint vocabulary, lifted from the YAML file
   *  verbatim. The values are concrete enough that Claude can
   *  reason about them without further explanation:
   *    - centered_on_wall: piece centered along a wall
   *    - flanking: pieces on either side of a target
   *    - opposite: piece on the opposite wall from the target
   *    - corner: piece in a room corner
   *    - facing: piece's front face oriented toward target
   *    - in_front: piece sits in front of (and faces away from) target
   *    - behind: piece sits behind target
   *    - surrounding: pieces arranged around target on all sides
   */
  position_constraint:
    | "centered_on_wall"
    | "flanking"
    | "opposite"
    | "corner"
    | "facing"
    | "in_front"
    | "behind"
    | "surrounding";
  /** Optional target — either another furniture type ("bed",
   *  "tv_stand") or a wall reference ("longest_wall", "window"). */
  target?: string;
  /** Optional distance range in metres. For "flanking" this is
   *  how far from the target's edge each flanking piece sits;
   *  for "facing" it's the gap between the two pieces. */
  distance_range?: [number, number];
  /** Rule importance, 0-1. Higher = Claude should prioritize
   *  satisfying this rule when multiple rules conflict. */
  priority: number;
}

export interface LayoutArchetype {
  name: string;
  description: string;
  /** Archetype-level priority — when multiple archetypes match
   *  the room type, the highest priority is the default
   *  recommendation. We surface all matching archetypes to
   *  Claude so it can pick whichever fits the user's specific
   *  prompt best, but we mention the highest-priority one as
   *  the default. */
  priority: number;
  rules: ArchetypeRule[];
}

// ─── Archetype catalog ─────────────────────────────────────────────
// Direct port of configs/layout_archetypes.yaml. Same structure,
// same numbers. Adjustments: a few rules add a piece type that
// repo 2 didn't but the studio commonly generates (e.g., side
// tables in conversation_area), kept consistent with the YAML's
// original style.

export const ARCHETYPES: Record<RoomType, LayoutArchetype[]> = {
  bedroom: [
    {
      name: "centered_bed",
      description: "Bed centered on the longest wall, nightstands flanking",
      priority: 1.0,
      rules: [
        {
          furniture_type: "bed",
          position_constraint: "centered_on_wall",
          target: "longest_wall",
          priority: 1.0,
        },
        {
          furniture_type: "nightstand",
          position_constraint: "flanking",
          target: "bed",
          distance_range: [0.0, 0.2],
          priority: 0.8,
        },
        {
          furniture_type: "dresser",
          position_constraint: "opposite",
          target: "bed",
          priority: 0.6,
        },
        {
          furniture_type: "wardrobe",
          position_constraint: "corner",
          priority: 0.5,
        },
      ],
    },
    {
      name: "corner_bed",
      description: "Bed in a corner for more open floor space (compact rooms)",
      priority: 0.7,
      rules: [
        {
          furniture_type: "bed",
          position_constraint: "corner",
          priority: 1.0,
        },
      ],
    },
  ],
  living_room: [
    {
      name: "focal_point",
      description: "Sofa facing a focal point (TV/fireplace) with coffee table",
      priority: 1.0,
      rules: [
        {
          furniture_type: "sofa",
          position_constraint: "facing",
          target: "tv_stand",
          distance_range: [2.0, 3.0],
          priority: 1.0,
        },
        {
          furniture_type: "coffee_table",
          position_constraint: "in_front",
          target: "sofa",
          distance_range: [0.4, 0.8],
          priority: 0.9,
        },
        {
          furniture_type: "chair",
          position_constraint: "flanking",
          target: "sofa",
          priority: 0.6,
        },
      ],
    },
    {
      name: "conversation_area",
      description:
        "Multiple seating arranged for conversation rather than viewing",
      priority: 0.8,
      rules: [
        {
          furniture_type: "sofa",
          position_constraint: "centered_on_wall",
          target: "longest_wall",
          priority: 0.9,
        },
        {
          furniture_type: "chair",
          position_constraint: "facing",
          target: "sofa",
          distance_range: [1.5, 2.5],
          priority: 0.8,
        },
        {
          furniture_type: "coffee_table",
          position_constraint: "in_front",
          target: "sofa",
          distance_range: [0.4, 0.8],
          priority: 0.7,
        },
      ],
    },
  ],
  home_office: [
    {
      name: "window_desk",
      description: "Desk facing or perpendicular to a window for natural light",
      priority: 1.0,
      rules: [
        {
          furniture_type: "desk",
          position_constraint: "facing",
          target: "window",
          priority: 1.0,
        },
        {
          furniture_type: "chair",
          position_constraint: "in_front",
          target: "desk",
          distance_range: [0.4, 0.6],
          priority: 0.9,
        },
        {
          furniture_type: "bookshelf",
          position_constraint: "behind",
          target: "desk",
          priority: 0.6,
        },
      ],
    },
    {
      name: "wall_desk",
      description: "Desk against the longest wall with storage behind",
      priority: 0.7,
      rules: [
        {
          furniture_type: "desk",
          position_constraint: "centered_on_wall",
          target: "longest_wall",
          priority: 1.0,
        },
        {
          furniture_type: "bookshelf",
          position_constraint: "behind",
          target: "desk",
          priority: 0.7,
        },
      ],
    },
  ],
  studio: [
    {
      name: "zone_separation",
      description:
        "Separate sleeping (bed in corner) and living (sofa) zones with the bed and sofa on opposite walls",
      priority: 1.0,
      rules: [
        {
          furniture_type: "bed",
          position_constraint: "corner",
          priority: 0.9,
        },
        {
          furniture_type: "sofa",
          position_constraint: "opposite",
          target: "bed",
          priority: 0.8,
        },
      ],
    },
  ],
  dining_room: [
    {
      name: "centered_table",
      description: "Dining table centered with chairs surrounding it",
      priority: 1.0,
      rules: [
        {
          furniture_type: "dining_table",
          position_constraint: "centered_on_wall",
          target: "longest_wall",
          priority: 1.0,
        },
        {
          furniture_type: "chair",
          position_constraint: "surrounding",
          target: "dining_table",
          distance_range: [0.6, 0.8],
          priority: 0.9,
        },
      ],
    },
  ],
};

// ─── Detector ──────────────────────────────────────────────────────
// Run keyword rules against the user's prompt. Order matters:
// "studio" is checked before "bedroom" because "studio apartment"
// would otherwise be mis-detected as just "bedroom" if we hit "bed"
// keywords first. "home office" is checked before "office" for the
// same reason.

const DETECTOR_RULES: { type: RoomType; keywords: RegExp[] }[] = [
  // Most specific patterns first.
  {
    type: "studio",
    keywords: [
      /\bstudio\s+apartment\b/i,
      /\bstudio\s+(flat|loft)\b/i,
      /\bstudio\s+room\b/i,
      /\bbachelor\s+(pad|apartment)\b/i,
    ],
  },
  {
    type: "home_office",
    keywords: [
      /\bhome\s+office\b/i,
      /\bworkspace\b/i,
      /\bworking?\s+room\b/i,
      /\bstudy\b/i,
      /\bden\b/i,
    ],
  },
  {
    type: "dining_room",
    keywords: [
      /\bdining\s+room\b/i,
      /\bdining\s+area\b/i,
      /\beat[\s-]?in\b/i,
      /\bbreakfast\s+(nook|room)\b/i,
    ],
  },
  {
    type: "living_room",
    keywords: [
      /\bliving\s+room\b/i,
      /\bsitting\s+room\b/i,
      /\bfamily\s+room\b/i,
      /\blounge\b/i,
      /\bdrawing\s+room\b/i,
      /\bgreat\s+room\b/i,
    ],
  },
  {
    type: "bedroom",
    keywords: [
      /\bbedroom\b/i,
      /\bmaster\s+bedroom\b/i,
      /\bguest\s+room\b/i,
      /\bnursery\b/i,
      /\bkid'?s?\s+room\b/i,
      /\bchild'?s?\s+room\b/i,
    ],
  },
];

export function detectRoomType(prompt: string): RoomType | null {
  for (const rule of DETECTOR_RULES) {
    for (const re of rule.keywords) {
      if (re.test(prompt)) return rule.type;
    }
  }
  return null;
}

// ─── Prompt formatter ──────────────────────────────────────────────
// Produces a markdown-formatted block to inject into the user
// message. Lists all archetypes for the detected type, marks the
// highest-priority one as the default, and explains the position
// vocabulary so Claude knows exactly what each constraint means.

export function formatArchetypeGuidance(roomType: RoomType): string {
  const archetypes = ARCHETYPES[roomType];
  if (!archetypes || archetypes.length === 0) return "";

  // Sort by priority descending so the default appears first.
  const sorted = [...archetypes].sort((a, b) => b.priority - a.priority);
  const defaultArch = sorted[0];

  const lines: string[] = [];
  lines.push(
    `LAYOUT GUIDANCE — detected room type: **${roomType.replace("_", " ")}**.`,
    "",
    "Use one of these canonical archetypes as a starting point. Pick whichever best matches the user's prompt:",
    "",
  );

  for (const arch of sorted) {
    const isDefault = arch === defaultArch;
    lines.push(
      `**${arch.name}**${isDefault ? " (default — use unless the prompt suggests otherwise)" : ""}: ${arch.description}`,
    );
    for (const rule of arch.rules) {
      const targetPart = rule.target ? ` (target: ${rule.target})` : "";
      const distancePart = rule.distance_range
        ? ` at ${rule.distance_range[0]}–${rule.distance_range[1]}m`
        : "";
      lines.push(
        `  - ${rule.furniture_type} ${rule.position_constraint.replace(/_/g, " ")}${targetPart}${distancePart}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "Position-constraint vocabulary:",
    "  - centered_on_wall: piece centered along the named wall, back against it",
    "  - flanking: two pieces on either side of the target, symmetric",
    "  - opposite: piece on the wall opposite the target",
    "  - corner: piece tucked into a room corner",
    "  - facing: piece's front face oriented toward the target",
    "  - in_front: piece sits in front of and parallel to the target (e.g., coffee table in front of sofa)",
    "  - behind: piece directly behind the target",
    "  - surrounding: pieces arranged on all sides of the target (e.g., dining chairs around table)",
    "",
    "These archetypes are guidance, not hard requirements. If the user's prompt explicitly conflicts (e.g., 'I want the bed in the corner'), follow the user. Otherwise, prefer the default archetype.",
  );

  return lines.join("\n");
}
