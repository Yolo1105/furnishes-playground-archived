/**
 * Design-rule library.
 *
 * Hand-written rules covering the highest-leverage interior-design
 * domain knowledge. Each rule has:
 *
 *   - `id`: stable slug for selector logic + diagnostics
 *   - `title`: short human-readable name
 *   - `body`: the prompt-block lines the model reads
 *   - `appliesWhen`: a selector function deciding whether this rule
 *     is relevant to the current scene + user message
 *
 * # Why hand-written and not ported from eva
 *
 * Eva's design-rules subsystem has ~50 rules across many sub-modules
 * (clearance, sight-lines, lighting, traffic-flow), with selectors
 * that depend on geometric helpers we don't have (raycast for
 * sight-lines, polygon intersection for traffic-flow). Porting it
 * wholesale would mean weeks of work on helpers before the rules
 * could fire correctly.
 *
 * We hand-wrote 6 high-leverage rules instead. Each uses simple
 * keyword + scene-state selectors — no raycast, no polygon math.
 * The trade-off: lower recall (some rules that should fire might
 * not), but high precision (when a rule fires, it really applies).
 *
 * # Rule selection philosophy
 *
 * The selector is intentionally conservative. Better to include 0
 * rules and let the model use its training-data knowledge than to
 * include 4 rules that don't apply and confuse it. The selector
 * returns rules in priority order; the formatter caps at 4 to
 * keep prompt budget bounded.
 *
 * # Adding rules later
 *
 * Each rule is a self-contained object. Adding a rule = appending
 * to the `DESIGN_RULES` array. The selector + formatter pick it up
 * automatically. If a rule needs more sophisticated selection than
 * keywords + scene flags, extend the `RuleSelectorContext` shape
 * with whatever helpers we add (e.g., a future raycast helper).
 */

import type { StudioSnapshotPayload } from "../studio/studio-snapshot-schema";

export type RuleSelectorContext = {
  /** The studio snapshot, when available. Many rules need to inspect
   *  the scene to decide if they apply — e.g. "TV viewing distance"
   *  only applies if there's a TV in the scene. */
  snapshot: StudioSnapshotPayload | null;
  /** The user's current message (lowercased for keyword matching). */
  userMessageLower: string;
};

export type DesignRule = {
  id: string;
  title: string;
  /** The prompt-block text the model reads. Multi-line is fine; a
   *  blank line separates rules in the assembled prompt. */
  body: string;
  /** Returns true when this rule is relevant to the current turn.
   *  Selectors should be SPECIFIC — false positives crowd out useful
   *  rules. */
  appliesWhen(ctx: RuleSelectorContext): boolean;
};

// ─── Helpers used by selectors ───────────────────────────────────────

function sceneHasTV(snapshot: StudioSnapshotPayload | null): boolean {
  if (!snapshot) return false;
  return snapshot.furniture.some((f) => {
    const label = f.label.toLowerCase();
    const cat = f.category.toLowerCase();
    return /\b(tv|television|screen|monitor|media)\b/.test(label) ||
      /\b(tv|television|media)\b/.test(cat);
  });
}

function sceneHasBed(snapshot: StudioSnapshotPayload | null): boolean {
  if (!snapshot) return false;
  return snapshot.furniture.some((f) => {
    const label = f.label.toLowerCase();
    const cat = f.category.toLowerCase();
    return /\b(bed|mattress|frame)\b/.test(label) ||
      /\bbed/.test(cat);
  });
}

function sceneHasDoor(snapshot: StudioSnapshotPayload | null): boolean {
  if (!snapshot) return false;
  return snapshot.openings.some((o) => o.kind === "door");
}

function sceneHasWindow(snapshot: StudioSnapshotPayload | null): boolean {
  if (!snapshot) return false;
  return snapshot.openings.some((o) => o.kind === "window");
}

function sceneHasMultipleSeating(
  snapshot: StudioSnapshotPayload | null,
): boolean {
  if (!snapshot) return false;
  const seating = snapshot.furniture.filter((f) => {
    const label = f.label.toLowerCase();
    const cat = f.category.toLowerCase();
    return /\b(sofa|couch|chair|armchair|seat|bench|stool)\b/.test(label) ||
      /\b(seating|sofa|chair)\b/.test(cat);
  });
  return seating.length >= 2;
}

function messageMentions(
  msg: string,
  patterns: readonly RegExp[],
): boolean {
  return patterns.some((p) => p.test(msg));
}

// ─── The rules ───────────────────────────────────────────────────────

export const DESIGN_RULES: readonly DesignRule[] = [
  {
    id: "walkway_clearance",
    title: "Walkway clearance",
    body: [
      "Walkway clearance: leave at least 75-90cm between major pieces of",
      "furniture for primary walkways (e.g. between sofa and coffee table,",
      "or between bed and wardrobe). 60-75cm is acceptable for secondary",
      "paths. Anything below 60cm feels cramped to walk through.",
    ].join("\n"),
    appliesWhen: (ctx) => {
      // Apply when scene has multiple pieces (so walkways exist to
      // worry about) AND the message touches on movement/layout.
      // Without scene context the principle is too generic to add
      // value over training-data knowledge.
      const hasMulti = ctx.snapshot
        ? ctx.snapshot.furniture.filter((f) => f.placed && f.visible).length >= 3
        : false;
      if (!hasMulti) return false;
      const messageRelevant = messageMentions(ctx.userMessageLower, [
        /\b(walkway|circulation|flow|cramped|tight|navigate|squeeze|path)\b/,
        /\b(too close|too crowded|move (the|a|some))\b/,
        /\b(layout|arrangement|positioning|placement)\b/,
      ]);
      return messageRelevant;
    },
  },
  {
    id: "door_swing",
    title: "Door swing clearance",
    body: [
      "Door swing zones: a standard interior door needs roughly 90cm of",
      "clear arc on its hinge side. Don't place furniture in the swing",
      "zone — it blocks the door from opening fully. Pivot doors and",
      "barn doors have different requirements (pivot: clear above and",
      "below; barn: clear track length).",
    ].join("\n"),
    appliesWhen: (ctx) => {
      if (!sceneHasDoor(ctx.snapshot)) return false;
      const messageRelevant = messageMentions(ctx.userMessageLower, [
        /\b(door|entry|entrance|threshold|swing)\b/,
        /\b(near the door|by the door|next to (the )?door)\b/,
        /\b(layout|arrangement|placement)\b/,
      ]);
      // Apply when door is mentioned, OR when it's a layout question
      // and there ARE doors (any layout discussion benefits from door
      // awareness).
      return messageRelevant;
    },
  },
  {
    id: "tv_viewing_distance",
    title: "TV viewing distance",
    body: [
      "TV viewing distance: optimal viewing distance is 2-3x the screen's",
      "diagonal. A 55-inch screen wants 2.5-4m of seating distance; a",
      "65-inch wants 3.5-5m. Closer than 2x feels overwhelming, farther",
      "than 3x makes detail hard to see. The seating's primary axis",
      "should face the screen square-on (within ~30°).",
    ].join("\n"),
    appliesWhen: (ctx) => {
      if (!sceneHasTV(ctx.snapshot)) return false;
      // TV viewing rule is broadly applicable when there's a TV.
      // Always include it if a TV is present and the user is asking
      // about layout, seating, or viewing.
      const messageRelevant = messageMentions(ctx.userMessageLower, [
        /\b(tv|television|screen|watch|viewing|seating|sofa|couch)\b/,
        /\b(layout|arrange|place|move|positioning)\b/,
      ]);
      return messageRelevant;
    },
  },
  {
    id: "bed_against_wall",
    title: "Bed-against-wall preference",
    body: [
      "Bed placement: most people prefer the bed's head against a solid",
      "wall (gives a sense of enclosure and a clear front-of-bed view).",
      "Floating beds (centered in the room) work in large rooms with",
      "specific layout intent. Avoid placing the bed directly under a",
      "window (cold drafts in winter, awkward sightlines, harder to",
      "make).",
    ].join("\n"),
    appliesWhen: (ctx) => {
      if (!sceneHasBed(ctx.snapshot)) return false;
      const messageRelevant = messageMentions(ctx.userMessageLower, [
        /\b(bed|sleeping|bedroom|headboard)\b/,
        /\b(layout|arrange|place|move)\b/,
      ]);
      return messageRelevant;
    },
  },
  {
    id: "window_sightlines",
    title: "Window sightlines",
    body: [
      "Window sightlines: avoid blocking windows with tall furniture",
      "(bookshelves, wardrobes) — windows are the room's primary light",
      "source and views. Lower furniture (sofas, chairs, tables) under",
      "or beside windows is fine. When the room has a strong view (sea,",
      "garden, skyline), orient main seating to face or at least share",
      "the view.",
    ].join("\n"),
    appliesWhen: (ctx) => {
      if (!sceneHasWindow(ctx.snapshot)) return false;
      const messageRelevant = messageMentions(ctx.userMessageLower, [
        /\b(window|natural light|view|outside|outdoor)\b/,
        /\b(blocking|in front of)\b/,
        /\b(layout|arrange|place|move|where)\b/,
      ]);
      return messageRelevant;
    },
  },
  {
    id: "conversation_grouping",
    title: "Conversational seating grouping",
    body: [
      "Conversational seating: when the room has multiple seats meant",
      "for talking (e.g. sofa + chair pair, or sofa + loveseat), group",
      "them within ~2.5m of each other and angle the seats roughly",
      "toward each other (not parallel — that feels formal). A coffee",
      "table or shared focal point in the middle anchors the grouping.",
    ].join("\n"),
    appliesWhen: (ctx) => {
      if (!sceneHasMultipleSeating(ctx.snapshot)) return false;
      const messageRelevant = messageMentions(ctx.userMessageLower, [
        /\b(seating|sofa|chair|couch|conversation|guest)\b/,
        /\b(group|cluster|together|facing|toward)\b/,
        /\b(layout|arrange|place)\b/,
      ]);
      return messageRelevant;
    },
  },
];
