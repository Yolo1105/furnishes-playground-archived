/**
 * Runtime classifiers for furniture, ported 1:1 from the zip's
 * `lib/ingest/displayNames.ts` + `lib/ingest/extractItemPrefix.ts`.
 *
 * The zip computes shape, color, and label at *runtime* from the
 * catalog id rather than trusting the static fields on the catalog
 * JSON. Two reasons:
 *
 *   1. **Shape** is bound to 2D-plan rendering semantics. The zip's
 *      FloorPlan2D branches on three values — "circle" / "thin-rect"
 *      / everything-else — and `classifyShape` is the function that
 *      decides which a given item gets. Trusting the catalog's
 *      shape field (which has values like "lamp", "vase", "box",
 *      "decor") would mean every item falls through to the default
 *      rectangle, losing the visual variety the zip's plan has.
 *
 *   2. **Label** has curated overrides. The auto-generated label
 *      "Bathroom Flush" reads worse than "Toilet"; the override
 *      table fixes that for ~20 items.
 *
 *   3. **Color** is per-item, deterministic from id hash, so each
 *      catalog item gets a stable distinct color across reloads
 *      without any authored color data.
 */

/** Curated label overrides keyed by lowercase catalog id. Items
 *  not in this table fall through to the catalog's auto-generated
 *  label (which is just the prefix de-snake-cased: "kitchen_sink"
 *  → "Kitchen Sink"). */
const DISPLAY_NAMES: Record<string, string> = {
  "4_bathroom_flush": "Toilet",
  "4_bathroom_faucet": "Sink Faucet",
  "4_bathroom_box": "Bathroom Cabinet",
  "4_bathroom_trash_can": "Trash Can",
  "4_bathroom_shower": "Shower",
  "4_bathroom_mirror": "Bathroom Mirror",
  "4_bedroom_abajour": "Bedside Lamp",
  "4_kitchen_freezer": "Refrigerator",
  "4_kitchen_microwave": "Microwave",
  "4_kitchen_washmachine": "Washing Machine",
  "4_kitchen_handle": "Cabinet Handle",
  "4_kitchen_sink": "Kitchen Sink",
  "4_kitchen_oven": "Oven",
  "4_kitchen_cook": "Cooktop",
  "4_lamp_pedestal": "Floor Lamp",
  "4_living_room": "Living Room Accent",
  "4_coffee_machine": "Coffee Machine",
  "4_closet_mirror": "Closet Mirror",
  "4_dinner_chair": "Dining Chair",
  "4_dinner_table": "Dining Table",
  "5_vegetation_palm": "Indoor Plant",
  "6_picture": "Wall Picture",
  "7_books": "Books",
  "7_magazines": "Magazines",
  // Catalog has a typo here ("kithchen" not "kitchen"), so we map
  // the typo'd key to the same display label the zip would use.
  "4_kithchen_faucet": "Sink Faucet",
};

/**
 * Resolve a friendly display label for an item id.
 *
 * Lookup order:
 *   1. Exact id match in DISPLAY_NAMES.
 *   2. If `isMultiInstance` is true AND the id ends in `_NN`, strip
 *      the suffix and try the base prefix; success appends `#N+1`
 *      so the 22 books items become "Books #1" .. "Books #22".
 *   3. Fall back to `autoLabel`.
 *
 * Without `isMultiInstance`, single-instance items like
 * `4_kitchen_handle_06` (where the `_06` is a model number, not an
 * instance count) won't pick up an inappropriate `#7` suffix —
 * they fall through to their auto label "Kitchen Handle 06".
 */
export function getDisplayLabel(
  id: string,
  autoLabel: string,
  isMultiInstance = false,
): string {
  if (DISPLAY_NAMES[id]) return DISPLAY_NAMES[id];
  if (isMultiInstance) {
    const m = id.match(/^(.+?)_(\d+)$/);
    if (m && DISPLAY_NAMES[m[1]]) {
      const idx = parseInt(m[2], 10);
      return `${DISPLAY_NAMES[m[1]]} #${idx + 1}`;
    }
  }
  return autoLabel;
}

/** Floor-plan shape semantics. Three values are meaningful for the
 *  2D renderer:
 *    "circle"    — ellipse + center dot  (lamps, plants, vases, …)
 *    "thin-rect" — narrow rect rx=0.01   (mirrors, pictures, TVs, …)
 *    "rect"      — default rect rx=0.05 + direction-indicator polygon
 *
 *  "l-shape" is in the union for parity with the zip's typing but
 *  the zip's renderer doesn't treat it specially — it falls through
 *  to the default rect branch. We keep the value so future layouts
 *  (sofas drawn as proper L-shapes) have a place to land. */
export type FurnitureShape = "circle" | "thin-rect" | "l-shape" | "rect";

/**
 * Classify a furniture item's 2D-plan shape from its id (which
 * encodes the type via embedded keywords) and its dimensions.
 * Ported 1:1 from the zip's `extractItemPrefix.ts`.
 *
 * Decision tree, in order:
 *   1. Keyword set for circular things (lamp, plant, vase, …) → circle
 *   2. Keyword set for flat planar things (picture, mirror, …) → thin-rect
 *   3. Sofa / couch keywords → l-shape (renders as rect today)
 *   4. Aspect-ratio rule: very elongated AND very thin → thin-rect
 *   5. Tiny squarish items → circle
 *   6. Default → rect
 */
export function classifyShape(
  id: string,
  width: number,
  depth: number,
): FurnitureShape {
  const name = id.toLowerCase();

  if (
    name.includes("lamp") ||
    name.includes("abajour") ||
    name.includes("vegetation") ||
    name.includes("palm") ||
    name.includes("plant") ||
    name.includes("trash") ||
    name.includes("vase") ||
    name.includes("clock")
  ) {
    return "circle";
  }

  if (
    name.includes("picture") ||
    name.includes("mirror") ||
    name.includes("tv") ||
    name.includes("frame")
  ) {
    return "thin-rect";
  }

  if (name.includes("sofa") || name.includes("couch")) return "l-shape";

  // Aspect-ratio fallback: a 2.4m × 0.05m partition reads better as
  // a thin-rect even if its name doesn't match the keyword set.
  const aspect =
    Math.max(width, depth) / Math.max(Math.min(width, depth), 0.01);
  if (aspect > 4 && Math.min(width, depth) < 0.15) return "thin-rect";

  // Small + roughly square items are usually decor blobs better
  // shown as small circles than tiny squares.
  if (Math.abs(width - depth) < 0.1 && width < 0.4) return "circle";

  return "rect";
}

/**
 * Deterministic per-item color from a 15-entry palette. The same id
 * always hashes to the same color across loads — useful so the user
 * builds a mental association between a color and an item. Ported
 * 1:1 from the zip.
 */
const PALETTE = [
  "#6B8DD6",
  "#D6856B",
  "#6BD69F",
  "#D6C86B",
  "#8B6BD6",
  "#D66B8D",
  "#6BD6D0",
  "#A0D66B",
  "#D6A06B",
  "#6B9FD6",
  "#C46BD6",
  "#6BD672",
  "#D6D06B",
  "#6B6FD6",
  "#D66BC4",
];

export function itemColor(id: string): string {
  // djb2-style hash, same as the zip uses.
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
