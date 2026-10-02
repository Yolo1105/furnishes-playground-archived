/**
 * Singapore HDB profile — Phase 1 of the Singapore market support.
 *
 * Source of truth: the 2025–2026 HDB reference document the user
 * provided. Captures the physical dimensions and design conventions
 * of HDB flats built after year 2000 (post-2000 builds — pre-2000
 * HDB flats are 20–30% larger, NOT covered here for v1).
 *
 * Scope of this file:
 *   - Three mainstream flat types: 3-room, 4-room, 5-room (these
 *     cover ~89.4% of HDB stock; all others combined = 10.6%).
 *   - For each flat type: per-room dimensions for the four design-
 *     relevant zones (master bedroom, common bedroom, living/dining,
 *     kitchen). Bathrooms and service yards are universal and
 *     captured at the flat level.
 *   - Universal HDB conventions that apply across all three types:
 *     enclosed kitchen, mandatory household shelter, ceiling height
 *     2.6–2.8m, all bedrooms have external windows, bedrooms are
 *     near-square (1.0:1 to 1.2:1 aspect ratio).
 *
 * Out of scope for v1:
 *   - 1-room rental, 2-room Flexi (singles/elderly only — different
 *     target audience from interior-design app users).
 *   - Executive Apartment, Executive Maisonette, 3Gen, Jumbo, DBSS
 *     (rare — combined < 10% of stock).
 *   - Pre-2000 HDB sizing (the doc says 20–30% larger; can add a
 *     sub-toggle later when a user asks for it).
 *   - Standard/Plus/Prime classification (policy not physical —
 *     doesn't change room dimensions, only resale rules).
 *
 * Coordinate convention: the studio uses metres throughout. Each
 * room's width/depth here become roomMeta.width_m / depth_m when
 * the orchestrator builds the AssembledScene.
 */

// ─── Types ─────────────────────────────────────────────────────────

/** The three mainstream flat types this profile supports. */
export type SgHdbFlatType = "3-room" | "4-room" | "5-room";

/** Which room of the HDB flat the user is currently designing.
 *  This is the architectural context Claude receives — it determines
 *  the room dimensions, what furniture fits, and what the room is
 *  for. The studio still designs ONE room at a time (the rest of
 *  the flat is mentioned only as adjacency context in the prompt).
 *
 *  v0.40.40: split `common_bedroom` into `common_bedroom_1` and
 *  `common_bedroom_2`. A 4-room or 5-room HDB has TWO common
 *  bedrooms with different orientations relative to the corridor.
 *  3-room HDBs have only one common bedroom (= bedroom_1 here).
 *  The legacy alias `common_bedroom` is accepted by the migrator
 *  in usePersistence (treated as `common_bedroom_1`). */
export type SgHdbRoom =
  | "master_bedroom"
  | "common_bedroom_1"
  | "common_bedroom_2"
  | "living_dining"
  | "kitchen";

/** A specific (flat type, room) combination — what gets sent to
 *  the orchestrator to fix the architecture. */
export interface SgHdbProfile {
  kind: "sg-hdb";
  flatType: SgHdbFlatType;
  room: SgHdbRoom;
}

/** v0.40.40: backward-compat normalizer for room values from
 *  saved profiles, API requests, and the legacy v0.40.38
 *  localStorage migration.
 *
 *  Accepts any string and returns either a valid SgHdbRoom or null
 *  for unrecognized values. The legacy "common_bedroom" value
 *  (used by v0.40.37 through v0.40.39) gets silently upgraded to
 *  "common_bedroom_1" — a 3-room HDB has only one common bedroom,
 *  and even on 4/5-room the original value semantically corresponds
 *  to the bedroom closer to the corridor (= _1). Users don't lose
 *  their saved selections on upgrade.
 *
 *  Used in three places:
 *    - profile-slice.ts legacy localStorage migration
 *    - usePersistence.ts deserializeProfile (per-project snapshot)
 *    - API route's Zod transform (server-side request validation)
 */
export function normalizeSgHdbRoom(raw: string): SgHdbRoom | null {
  // Legacy alias — v0.40.37 through v0.40.39 used this value.
  if (raw === "common_bedroom") return "common_bedroom_1";
  const valid: SgHdbRoom[] = [
    "master_bedroom",
    "common_bedroom_1",
    "common_bedroom_2",
    "living_dining",
    "kitchen",
  ];
  if (valid.includes(raw as SgHdbRoom)) {
    return raw as SgHdbRoom;
  }
  return null;
}

/** Validate a flat type string against the known enum. Returns the
 *  typed value or null. */
export function normalizeSgHdbFlatType(raw: string): SgHdbFlatType | null {
  const valid: SgHdbFlatType[] = ["3-room", "4-room", "5-room"];
  return valid.includes(raw as SgHdbFlatType) ? (raw as SgHdbFlatType) : null;
}

/** v0.40.41 — heuristic detector that scans a prompt for HDB intent
 *  and returns a suggested profile, or null when no Singapore-
 *  specific signal is present.
 *
 *  Design philosophy: REQUIRE a Singapore-specific anchor before
 *  suggesting anything. "design my master bedroom" alone must NOT
 *  trigger a suggestion — Western users design master bedrooms too.
 *  We need at least one of:
 *    - the literal word "HDB" or "BTO" or "Singapore"
 *    - an explicit HDB-style flat-type token like "3-room", "4-room",
 *      or "5-room" (these phrases are vanishingly rare in non-SG
 *      English; "studio apartment" or "two-bedroom" is the Western
 *      idiom for the same concept)
 *
 *  Once we have an anchor, we extract the most specific (flat type,
 *  room) pair we can and fall back to sensible defaults:
 *    - flat type defaults to 4-room (42% of HDB stock per the doc)
 *    - room defaults to master_bedroom (most-designed)
 *
 *  The matching is deliberately tolerant of natural phrasing:
 *  hyphens optional ("4-room" / "4 room" / "4room"), case-
 *  insensitive throughout, common synonyms accepted ("living room"
 *  → living_dining, "lounge" → living_dining).
 *
 *  Returns null when the prompt has no Singapore anchor OR has an
 *  anchor but is too generic to map to a specific (flat type, room)
 *  combination. The banner only shows when this returns non-null. */
export function detectHdbIntent(prompt: string): SgHdbProfile | null {
  if (!prompt || typeof prompt !== "string") return null;
  const lower = prompt.toLowerCase();

  // ── Anchor signals ─────────────────────────────────────────────
  // At least ONE of these must be present for any suggestion at
  // all. Without an anchor, the prompt could be about any country.
  const hasHdbKeyword =
    /\b(hdb|bto|build[-\s]?to[-\s]?order|singapore|singaporean)\b/.test(lower);
  // Match "3-room", "4-room", "5-room" — and the looser variants
  // "3 room", "3room". The trailing word-boundary ensures we don't
  // accidentally pick up "30-room" or "4-room-and-a-half".
  const flatTypeMatch = lower.match(/\b([345])[-\s]?room\b/);
  if (!hasHdbKeyword && !flatTypeMatch) return null;

  // ── Flat type extraction ───────────────────────────────────────
  // Explicit flat-type token wins. Without one, default to 4-room
  // (the most common HDB flat type — 42% of stock per the doc).
  let flatType: SgHdbFlatType = "4-room";
  if (flatTypeMatch) {
    const num = flatTypeMatch[1];
    if (num === "3") flatType = "3-room";
    else if (num === "4") flatType = "4-room";
    else if (num === "5") flatType = "5-room";
  }

  // ── Room extraction ────────────────────────────────────────────
  // Most specific match wins. Order matters: "common bedroom 2"
  // must be checked BEFORE "common bedroom" alone, otherwise the
  // generic check would match first and we'd lose the index.
  let room: SgHdbRoom = "master_bedroom";
  const isCommonBedroom2 =
    /\bcommon\s*(?:bed)?(?:room)?\s*(?:no\.?\s*)?2\b/.test(lower);
  const isCommonBedroom1 =
    /\bcommon\s*(?:bed)?(?:room)?\s*(?:no\.?\s*)?1\b/.test(lower);
  const isAnyCommonBedroom = /\bcommon\s*(?:bed)?(?:room|bed)\b/.test(lower);
  const isMaster = /\bmaster(?:\s*(?:bed)?(?:room)?)?\b/.test(lower);
  const isLiving =
    /\b(?:living\s*\/?\s*dining|living\s+(?:and|&)\s+dining|living[-\s]*room|dining[-\s]*room|lounge)\b/.test(
      lower,
    );
  const isKitchen = /\bkitchen\b/.test(lower);

  if (isCommonBedroom2 && flatType !== "3-room") {
    // 3-room flats only have one common bedroom — the "_2" hint
    // is meaningless for them, so we silently drop down to "_1"
    // (the suggestion still gives them an HDB profile, just not
    // the impossible variant).
    room = "common_bedroom_2";
  } else if (isCommonBedroom1 || isAnyCommonBedroom) {
    room = "common_bedroom_1";
  } else if (isMaster) {
    room = "master_bedroom";
  } else if (isLiving) {
    room = "living_dining";
  } else if (isKitchen) {
    room = "kitchen";
  }
  // If none matched: stick with default master_bedroom. This is
  // the right call because if a user says "I want a 4-room HDB"
  // (no specific room), they're most likely starting with the
  // master — and they can change the room in the popover with
  // one click.

  return { kind: "sg-hdb", flatType, room };
}

interface RoomDimensions {
  /** Width in metres (the longer floor-plan axis we treat as x). */
  width_m: number;
  /** Depth in metres (the shorter floor-plan axis we treat as z). */
  depth_m: number;
  /** Floor area in m². Slightly redundant with width × depth but the
   *  HDB doc reports areas as ranges (e.g., "9–10 m²") and the
   *  midpoint is the value designers actually quote — easier to
   *  surface this than recompute it. */
  area_sqm: number;
  /** Aspect ratio = width / depth. Bedrooms are near-square (1.0–
   *  1.2:1), living/dining is elongated (1.5–1.9:1), kitchen is
   *  square or near-square. Used by the validator to flag when
   *  Claude proposes a wrong-shape room. */
  aspect_ratio: number;
}

interface RoomData {
  master_bedroom: RoomDimensions & { architecture: RoomArchitecture };
  /** First common bedroom — closer to the central corridor (door
   *  on south wall, window on north). Always present in every flat
   *  type (3-room flats have exactly one common bedroom = this). */
  common_bedroom_1: RoomDimensions & { architecture: RoomArchitecture };
  /** Second common bedroom — typically on the opposite side of the
   *  corridor with a mirrored layout (door on north, window on
   *  south). 4-room and 5-room flats have this; 3-room flats do
   *  NOT (3-room has 2 bedrooms total: master + 1 common). */
  common_bedroom_2?: RoomDimensions & { architecture: RoomArchitecture };
  living_dining: RoomDimensions & { architecture: RoomArchitecture };
  kitchen: RoomDimensions & { architecture: RoomArchitecture };
}

/** Which wall an opening (door, window, ensuite door) sits on. The
 *  studio's coordinate frame puts +x = east, +y = north (room
 *  centered at origin); we describe walls in compass terms because
 *  that's how Claude reasons about them in the system prompt. */
type WallSide = "north" | "south" | "east" | "west";

/** The architectural openings of a room. Used both to inform Claude
 *  in the prompt (which wall has the door, which wall has the
 *  window) AND to seed the AssembledScene's openings array directly
 *  — so the validator's door-blocking check has real data to work
 *  with even if Claude doesn't emit openings explicitly.
 *
 *  HDB convention used here:
 *    - Bedroom: door on one wall, window on the OPPOSITE wall (the
 *      external face of the building). The wall pair varies — for
 *      a master bedroom whose long axis runs east-west, door is on
 *      the west wall (closest to the corridor), window on the east
 *      wall (the building's external face).
 *    - Master bedroom additionally has an ensuite door, conventionally
 *      on a short wall near a corner — not the same wall as the main
 *      door, not the same wall as the window.
 *    - Living/dining: entry door on the south wall (corridor side),
 *      large external window or balcony on the north wall.
 *    - Kitchen: door to living/dining on one wall, door to service
 *      yard on the opposite wall (HDB kitchens are typically through-
 *      kitchens with the service yard behind).
 *
 *  These are "default" positions — real HDB plans vary block-to-
 *  block, but the orientations here are the most common pattern in
 *  the doc's design-philosophy section. */
interface RoomArchitecture {
  /** Main entry door from corridor (or, for kitchen, from living/
   *  dining; for living/dining, from the flat's main entry). */
  door: { wall: WallSide; offset_from_corner_m: number; width_m: number };
  /** External window (mandatory in bedrooms; large in living/dining;
   *  optional in kitchen — many HDB kitchens have one to the service
   *  yard). null when there's no window in this room (rare). */
  window: {
    wall: WallSide;
    offset_from_corner_m: number;
    width_m: number;
  } | null;
  /** Master bedroom only: door to the ensuite bathroom. The bathroom
   *  itself is NOT inside the room — it's an alcove behind this wall.
   *  Claude should not place tall furniture (wardrobes) against this
   *  wall in the door's swing area. */
  ensuite_door?: {
    wall: WallSide;
    offset_from_corner_m: number;
    width_m: number;
  };
  /** Kitchen only: door to the service yard. Service yard is a small
   *  room (~2.5 m²) behind the kitchen, not part of the kitchen
   *  rectangle itself. */
  service_yard_door?: {
    wall: WallSide;
    offset_from_corner_m: number;
    width_m: number;
  };
}

interface FlatTypeData {
  /** Total floor area in m² (~10–12 m² of which goes to walls,
   *  corridors, entry — sum of room areas does NOT equal this). */
  total_area_sqm: number;
  /** Bounding rectangle of the whole flat — useful for context. */
  total_width_m: number;
  total_depth_m: number;
  rooms: RoomData;
  /** Furniture-fit guidance for the master bedroom — what bed size
   *  fits comfortably vs. tight vs. doesn't fit. Lifted from the
   *  doc's FURNITURE FIT RULES section. */
  furniture_fit: {
    master_bedroom_bed: string;
    common_bedroom_bed: string;
    living_sofa: string;
    dining_table: string;
  };
}

// ─── Per-flat-type data ───────────────────────────────────────────
//
// Numbers come from the HDB doc's "DIMENSIONS — NEW HDB ONLY" table.
// Where the doc gives a range (e.g., "9–10 m²"), we use the midpoint.
// Where the doc gives a single representative dimension (e.g., "3.5m
// × 3.0m"), we use that exact value.

/** Build the default architecture (door + window + ensuite + service
 *  yard door positions) for a given room type and dimensions. The
 *  positions follow standard post-2000 HDB convention:
 *
 *  Bedrooms (master + common):
 *    - Door on the SOUTH wall (corridor side), 0.6m from the
 *      east corner, 0.9m wide.
 *    - Window on the NORTH wall (the external/daylight side),
 *      centered along the wall, ~1.5m wide.
 *    - Master bedroom only: ensuite door on the EAST wall, 0.4m
 *      from the south corner, 0.7m wide. The ensuite bathroom is
 *      a 1.5×2.0m alcove BEHIND that wall — not part of the
 *      bedroom's rectangle.
 *
 *  Living/dining:
 *    - Main entry door on the SOUTH wall (corridor side), 0.8m
 *      from the east corner, 0.9m wide.
 *    - Large window or balcony opening on the NORTH wall,
 *      typically 1.8–2.0m wide, centered.
 *
 *  Kitchen:
 *    - Door from living/dining on the EAST wall (the side facing
 *      the rest of the flat), centered, 0.8m wide.
 *    - Service yard door on the WEST wall (the building's external
 *      side), centered, 0.7m wide. The service yard itself is a
 *      separate ~2.5 m² room behind that wall — not part of the
 *      kitchen rectangle.
 *    - Window: not in this room (the service yard has the window
 *      to the outside; the kitchen takes natural light through
 *      the service-yard door when it's open).
 *
 * These positions are defaults — real HDB plans vary block-to-block,
 * but this pattern matches the most common post-2000 layouts. Claude
 * sees these in the prompt so it knows where NOT to place tall
 * furniture; the validator's door-blocking check uses them too. */
function buildArchitecture(
  roomKind: SgHdbRoom,
  dims: RoomDimensions,
): RoomArchitecture {
  switch (roomKind) {
    case "master_bedroom":
      return {
        door: { wall: "south", offset_from_corner_m: 0.6, width_m: 0.9 },
        window: {
          wall: "north",
          offset_from_corner_m: Math.max(0.4, (dims.width_m - 1.5) / 2),
          width_m: 1.5,
        },
        ensuite_door: {
          wall: "east",
          offset_from_corner_m: 0.4,
          width_m: 0.7,
        },
      };
    case "common_bedroom_1":
      // First common bedroom — same orientation as master (door
      // south facing the corridor, window north facing the
      // building's external face). The "1" variant is the side of
      // the flat closest to the corridor.
      return {
        door: { wall: "south", offset_from_corner_m: 0.5, width_m: 0.9 },
        window: {
          wall: "north",
          offset_from_corner_m: Math.max(0.4, (dims.width_m - 1.2) / 2),
          width_m: 1.2,
        },
      };
    case "common_bedroom_2":
      // Second common bedroom — mirrored orientation. The corridor
      // typically wraps so the second common bedroom's entry door
      // is on a different wall. We pick NORTH-wall door, SOUTH-wall
      // window as the conventional mirror of common_bedroom_1.
      // Real HDB plans vary block-to-block but this is the most
      // common pattern in post-2000 layouts.
      return {
        door: { wall: "north", offset_from_corner_m: 0.5, width_m: 0.9 },
        window: {
          wall: "south",
          offset_from_corner_m: Math.max(0.4, (dims.width_m - 1.2) / 2),
          width_m: 1.2,
        },
      };
    case "living_dining":
      return {
        door: { wall: "south", offset_from_corner_m: 0.8, width_m: 0.9 },
        window: {
          wall: "north",
          offset_from_corner_m: (dims.width_m - 2.0) / 2,
          width_m: 2.0,
        },
      };
    case "kitchen":
      return {
        door: {
          wall: "east",
          offset_from_corner_m: (dims.depth_m - 0.8) / 2,
          width_m: 0.8,
        },
        window: null,
        service_yard_door: {
          wall: "west",
          offset_from_corner_m: (dims.depth_m - 0.7) / 2,
          width_m: 0.7,
        },
      };
  }
}

/** Helper: pair dimensions with architecture for a room cell. */
function makeRoom(
  roomKind: SgHdbRoom,
  dims: RoomDimensions,
): RoomDimensions & { architecture: RoomArchitecture } {
  return { ...dims, architecture: buildArchitecture(roomKind, dims) };
}

export const SG_HDB_DATA: Record<SgHdbFlatType, FlatTypeData> = {
  "3-room": {
    total_area_sqm: 62.5, // doc range 60–65, midpoint
    total_width_m: 10.0,
    total_depth_m: 6.5,
    rooms: {
      master_bedroom: makeRoom("master_bedroom", {
        width_m: 3.0,
        depth_m: 3.0,
        area_sqm: 9.5,
        aspect_ratio: 1.0,
      }),
      common_bedroom_1: makeRoom("common_bedroom_1", {
        width_m: 3.0,
        depth_m: 2.5,
        area_sqm: 7.5,
        aspect_ratio: 1.2,
      }),
      living_dining: makeRoom("living_dining", {
        width_m: 6.0,
        depth_m: 3.2,
        area_sqm: 19.0,
        aspect_ratio: 1.875,
      }),
      kitchen: makeRoom("kitchen", {
        width_m: 2.4,
        depth_m: 2.4,
        area_sqm: 5.76,
        aspect_ratio: 1.0,
      }),
    },
    furniture_fit: {
      master_bedroom_bed:
        "Queen bed (152×203cm) only — tight fit. King bed will NOT fit. Allow 50–60cm clearance on at least one side for getting in/out.",
      common_bedroom_bed:
        "Single bed (91×190cm) or Super Single (107×190cm) only. Queen will fit but leaves no space for any other furniture (no desk, no wardrobe).",
      living_sofa:
        "3-seater straight sofa (~2.0–2.2m long). L-shaped sofa does NOT fit comfortably.",
      dining_table:
        "4-seater dining table only (round 100cm or rectangular 120×75cm). 6-seater will block circulation.",
    },
  },

  "4-room": {
    total_area_sqm: 90.0,
    total_width_m: 12.0,
    total_depth_m: 7.5,
    rooms: {
      master_bedroom: makeRoom("master_bedroom", {
        width_m: 3.5,
        depth_m: 3.0,
        area_sqm: 12.0, // doc range 11–13, midpoint
        aspect_ratio: 1.167,
      }),
      common_bedroom_1: makeRoom("common_bedroom_1", {
        width_m: 3.0,
        depth_m: 2.7,
        area_sqm: 8.5, // doc range 8–9
        aspect_ratio: 1.111,
      }),
      common_bedroom_2: makeRoom("common_bedroom_2", {
        width_m: 3.0,
        depth_m: 2.7,
        area_sqm: 8.5, // identical dimensions to common_bedroom_1
        aspect_ratio: 1.111,
      }),
      living_dining: makeRoom("living_dining", {
        width_m: 6.5,
        depth_m: 4.0,
        area_sqm: 26.5, // doc range 25–28
        aspect_ratio: 1.625,
      }),
      kitchen: makeRoom("kitchen", {
        width_m: 3.0,
        depth_m: 2.4,
        area_sqm: 7.0, // doc range 6–8
        aspect_ratio: 1.25,
      }),
    },
    furniture_fit: {
      master_bedroom_bed:
        "Queen bed (152×203cm) comfortable. King bed (193×203cm) tight — fits but leaves <40cm on each side. Recommend Queen for typical household.",
      common_bedroom_bed:
        "Single (91×190cm) comfortable with desk + wardrobe. Super Single (107×190cm) fits with a slim desk. Queen leaves no space for desk.",
      living_sofa:
        "L-shaped sofa 2.6–2.8m on the long edge fits comfortably. 3-seater straight sofa (2.2–2.4m) is the conservative choice.",
      dining_table:
        "6-seater dining table (rectangular 150×85cm or round 120cm). 4-seater feels small in this living/dining size.",
    },
  },

  "5-room": {
    total_area_sqm: 115.0, // doc says "110+", we use 115 as representative
    total_width_m: 14.0,
    total_depth_m: 8.0,
    rooms: {
      master_bedroom: makeRoom("master_bedroom", {
        width_m: 4.0,
        depth_m: 3.5,
        area_sqm: 14.5, // doc range 13–16, midpoint
        aspect_ratio: 1.143,
      }),
      common_bedroom_1: makeRoom("common_bedroom_1", {
        width_m: 3.0,
        depth_m: 3.0,
        area_sqm: 9.5, // doc range 9–10
        aspect_ratio: 1.0,
      }),
      common_bedroom_2: makeRoom("common_bedroom_2", {
        width_m: 3.0,
        depth_m: 3.0,
        area_sqm: 9.5,
        aspect_ratio: 1.0,
      }),
      living_dining: makeRoom("living_dining", {
        width_m: 7.0,
        depth_m: 4.5,
        area_sqm: 32.5, // doc range 30–35
        aspect_ratio: 1.556,
      }),
      kitchen: makeRoom("kitchen", {
        width_m: 3.2,
        depth_m: 2.7,
        area_sqm: 8.0, // doc range 7–9
        aspect_ratio: 1.185,
      }),
    },
    furniture_fit: {
      master_bedroom_bed:
        "King bed (193×203cm) comfortable with bedside tables on both sides. Queen leaves room for a bench at the foot.",
      common_bedroom_bed:
        "Single, Super Single, or Queen all fit. Queen (152×203cm) with a small desk works for older children.",
      living_sofa:
        "L-shaped sofa 3.0m+ on the long edge. Sectional sofa with chaise also fits. Coffee table 110–130cm.",
      dining_table:
        "6 to 8-seater dining table. Rectangular 180×90cm or round 140cm. Allows traditional Chinese New Year reunion seating.",
    },
  },
};

// ─── Universal HDB conventions ────────────────────────────────────
//
// Apply to every HDB flat regardless of type. These go into the
// system prompt as design constraints Claude must respect.

export const HDB_UNIVERSAL_CONVENTIONS = {
  ceiling_height_m: 2.7,
  ceiling_height_range: "2.6–2.8 m",
  master_has_ensuite: true,
  kitchen_is_enclosed: true,
  service_yard_present: true,
  service_yard_area_sqm: 2.5,
  household_shelter_mandatory: true,
  household_shelter_area_sqm: 1.75,
  master_bathroom_dims: "1.5m × 2.0m",
  common_bathroom_dims: "1.7m × 2.4m",
  bathroom_has_shower_only: true, // no bathtub by default in new HDB
  all_bedrooms_have_external_windows: true,
  bedroom_aspect_ratio_min: 1.0,
  bedroom_aspect_ratio_max: 1.2,
  living_dining_aspect_ratio_min: 1.5,
  living_dining_aspect_ratio_max: 1.9,
} as const;

// ─── Public lookup helpers ────────────────────────────────────────

/** Get the dimensions for a specific (flat type, room) combination.
 *  Returns null if the combination is invalid (shouldn't happen at
 *  runtime — TypeScript catches it — but defensive). */
export function getRoomDimensions(
  flatType: SgHdbFlatType,
  room: SgHdbRoom,
): RoomDimensions | null {
  const data = SG_HDB_DATA[flatType];
  if (!data) return null;
  return data.rooms[room] ?? null;
}

/** Get the total flat area in m² for a flat type. Used by the
 *  picker UI to show "3-room (~62 m²)" subtitles before the user
 *  commits. Per the doc:
 *    - 3-room: 60-65 m² → midpoint 62.5
 *    - 4-room: ~90 m²
 *    - 5-room: 110+ m² → we use 115 as representative
 *  Returned rounded to nearest whole m² for clean display. */
export function getFlatTypeTotalArea(flatType: SgHdbFlatType): number {
  return Math.round(SG_HDB_DATA[flatType].total_area_sqm);
}

/** Human-friendly display name for a room — used in UI pickers. */
export function roomDisplayName(room: SgHdbRoom): string {
  switch (room) {
    case "master_bedroom":
      return "Master Bedroom";
    case "common_bedroom_1":
      return "Common Bedroom 1";
    case "common_bedroom_2":
      return "Common Bedroom 2";
    case "living_dining":
      return "Living / Dining";
    case "kitchen":
      return "Kitchen";
  }
}

/** Compact summary line for the chat dock: "Singapore HDB 4-room
 *  master bedroom (3.5 × 3.0 m, 12 m²)". Surfaces the key numbers
 *  so the user always knows what context Claude is operating in. */
export function summarizeProfile(profile: SgHdbProfile): string {
  const dims = getRoomDimensions(profile.flatType, profile.room);
  if (!dims) return `Singapore HDB ${profile.flatType}`;
  return `Singapore HDB ${profile.flatType} ${roomDisplayName(profile.room).toLowerCase()} (${dims.width_m.toFixed(1)} × ${dims.depth_m.toFixed(1)} m, ${dims.area_sqm.toFixed(0)} m²)`;
}

// ─── Prompt builder ───────────────────────────────────────────────
//
// Produces a markdown block to inject into the orchestrator's system
// prompt when this profile is active. Format mirrors the archetype
// guidance (Increment 2) for consistency: bold section header,
// concrete numbers, then a short list of constraints.
//
// Goals:
//   1. Tell Claude the EXACT room dimensions — width × depth,
//      ceiling height, area. Claude should not invent these.
//   2. Tell Claude WHERE the door, window, and other openings are
//      (which wall, what offset). Without this Claude makes up
//      architecture choices that should be pinned by the spec.
//   3. Tell Claude what's adjacent to this room (NOT inside it) —
//      master bedroom adjoins ensuite alcove; kitchen connects to
//      service yard; living/dining opens to the enclosed kitchen.
//   4. Constrain furniture choices to what physically fits. The
//      doc's furniture-fit rules are the single most useful prior
//      because they prevent Claude from emitting a king bed in a
//      3-room master.
//   5. Reinforce universal HDB conventions: enclosed kitchen,
//      external windows, ceiling height. The household shelter is
//      flat-level architecture (in the entry hallway, not inside any
//      designable room) — we don't mention it in per-room guidance
//      because that confused Claude in v1.

/** Format a single opening for display in the prompt. Translates
 *  "wall: south, offset 0.6, width 0.9" into "south wall, 0.6m
 *  from the west corner, 0.9m wide" — the form Claude reads. */
function formatOpening(opening: {
  wall: WallSide;
  offset_from_corner_m: number;
  width_m: number;
}): string {
  // For each wall, name the corner the offset is measured FROM.
  // Convention: walls run clockwise starting from NW. Offsets along
  // a wall always measured from the corner that comes first in
  // clockwise order — north wall from NW corner, east from NE,
  // south from SE, west from SW. This gives a consistent rule
  // Claude can apply.
  const fromCorner: Record<WallSide, string> = {
    north: "west",
    east: "north",
    south: "east",
    west: "south",
  };
  return `${opening.wall} wall, ${opening.offset_from_corner_m.toFixed(2)}m from the ${fromCorner[opening.wall]} corner, ${opening.width_m.toFixed(2)}m wide`;
}

export function formatSgHdbGuidance(profile: SgHdbProfile): string {
  const flat = SG_HDB_DATA[profile.flatType];
  const room = flat.rooms[profile.room];
  // Defensive: a (flat type, room) combo that doesn't exist in
  // SG_HDB_DATA (e.g., common_bedroom_2 in a 3-room flat which
  // only has one common bedroom) should never reach here through
  // the UI — but if it does (legacy snapshot, bad API call),
  // return an empty guidance block. The orchestrator's clamp will
  // also reject the lookup and the request degrades gracefully
  // back to no-profile behavior. Better than crashing.
  if (!room) return "";
  const arch = room.architecture;
  const fit = flat.furniture_fit;
  const conv = HDB_UNIVERSAL_CONVENTIONS;

  // Adjacency context — what's NEXT to the room being designed,
  // including spaces that share a wall but are NOT inside this
  // room's rectangle. The user is designing ONE room at a time;
  // adjacency tells Claude what's just past each wall. Opening
  // positions themselves are already listed in the "Architecture"
  // block above — adjacency stays high-level here to avoid repeat.
  const commonBedroomAdjacency = `The ${arch.door.wall} wall faces the central corridor (door leads out to it). The common bathroom (~${conv.common_bathroom_dims}, shower only) is reached through the corridor — NOT directly off this room. The ${arch.window?.wall ?? "external"} wall is the building's external face.`;
  const adjacency: Record<SgHdbRoom, string> = {
    master_bedroom: `The ${arch.ensuite_door?.wall ?? "east"} wall has the ensuite door — behind it is a separate ensuite bathroom alcove (~${conv.master_bathroom_dims}, shower only) NOT part of this room's rectangle. The ${arch.door.wall} wall faces the central corridor. The ${arch.window?.wall ?? "external"} wall is the building's external face.`,
    // Both common bedrooms share the same adjacency story — the
    // structural difference is just which wall the door is on (the
    // architecture block above tells Claude that).
    common_bedroom_1: commonBedroomAdjacency,
    common_bedroom_2: commonBedroomAdjacency,
    living_dining: `Open-plan combined space. The ${arch.door.wall} wall has the main flat entry door (from the building's corridor). The ${arch.window?.wall ?? "external"} wall has a large external window or balcony opening (the building's external face). The kitchen (separate enclosed room) is reached through a door on one of the side walls — NOT open-plan. The flat's mandatory household shelter (1.5×1.5m reinforced concrete) sits in the entry hallway near the main door, NOT in this room.`,
    kitchen: `ENCLOSED room with a door (HDB convention — supports Chinese cooking style with stronger smells). The ${arch.door.wall} wall connects to the living/dining via a door. The ${arch.service_yard_door?.wall} wall has a door to the service yard (~${conv.service_yard_area_sqm} m², for laundry/washing machine — NOT part of this kitchen's rectangle). No external window inside this room — natural light comes through the service-yard door.`,
  };

  // Compute the "free walls" — those without a door, window, or
  // ensuite/service-yard door. These are the walls a bed headboard
  // or wardrobe should go against. We list them so Claude knows
  // which walls are usable as anchors for tall furniture.
  const occupiedWalls = new Set<WallSide>();
  occupiedWalls.add(arch.door.wall);
  if (arch.window) occupiedWalls.add(arch.window.wall);
  if (arch.ensuite_door) occupiedWalls.add(arch.ensuite_door.wall);
  if (arch.service_yard_door) occupiedWalls.add(arch.service_yard_door.wall);
  const allWalls: WallSide[] = ["north", "south", "east", "west"];
  const freeWalls = allWalls.filter((w) => !occupiedWalls.has(w));
  const freeWallsText =
    freeWalls.length > 0
      ? freeWalls.join(" and ") + (freeWalls.length === 1 ? " wall" : " walls")
      : "no fully-free walls (all four have an opening)";

  // Per-room furniture guidance. Bedrooms call out which walls are
  // FREE (no door/window) — those are the ones a bed headboard or
  // wardrobe should anchor to. For master bedroom this also flags
  // the ensuite-door wall as off-limits for tall pieces.
  const roomFit = (() => {
    switch (profile.room) {
      case "master_bedroom":
        return [
          `Bed: ${fit.master_bedroom_bed}`,
          `Other furniture: typically two bedside tables (40–50cm cube each) and a wardrobe ~1.8m wide × 60cm deep.`,
          `Layout note: the headboard wall should be ${freeWallsText} (the only wall without a door, window, or ensuite door). Do NOT place tall pieces (wardrobe, bookshelf) against the ${arch.ensuite_door?.wall} wall (ensuite door swings into the room) or against the ${arch.window?.wall ?? "external"} wall (window).`,
        ].join("\n  ");
      case "common_bedroom_1":
      case "common_bedroom_2":
        return [
          `Bed: ${fit.common_bedroom_bed}`,
          `Other furniture: a small desk (100–120cm × 50cm), one wardrobe (1.5m × 55cm), maybe a bookshelf if there's wall space.`,
          `Layout note: the headboard wall should be ${freeWallsText} (the wall without a door or window). The desk typically sits under the window for daylight, or against the headboard wall if the bed is against the side wall.`,
        ].join("\n  ");
      case "living_dining":
        return [
          `Sofa: ${fit.living_sofa}`,
          `Dining table: ${fit.dining_table}`,
          `Other: TV credenza ~1.6–2.0m wide; coffee table; possibly a console near the entry.`,
          `Layout note: split the long rectangle into a "living" half (sofa + coffee table + TV) and a "dining" half (table + chairs). The TV credenza usually sits against ${freeWallsText} (the interior side, not the window wall), so the sofa faces toward the interior with its back to the ${arch.window?.wall ?? "external"} wall (window).`,
        ].join("\n  ");
      case "kitchen":
        return [
          `Layout style: galley or L-shape kitchen (single or two-wall counters along the long walls). Standard counter depth 60cm.`,
          `Built-in appliances: cooktop, sink, fridge, oven (built-in or freestanding).`,
          `Layout note: keep the floor between the door (${arch.door.wall} wall) and service-yard door (${arch.service_yard_door?.wall} wall) clear — this is the main circulation path. Counters typically run along the ${freeWallsText}. No island — kitchen is too narrow.`,
        ].join("\n  ");
    }
  })();

  // Architecture lines — list each opening explicitly so Claude
  // knows exactly which wall has what.
  const archLines: string[] = [];
  archLines.push(`- Door: ${formatOpening(arch.door)}`);
  if (arch.window) {
    archLines.push(`- Window: ${formatOpening(arch.window)}`);
  } else {
    archLines.push(`- Window: none in this room`);
  }
  if (arch.ensuite_door) {
    archLines.push(
      `- Ensuite door: ${formatOpening(arch.ensuite_door)} (leads to a bathroom alcove BEHIND this wall, not into the room)`,
    );
  }
  if (arch.service_yard_door) {
    archLines.push(
      `- Service-yard door: ${formatOpening(arch.service_yard_door)} (leads to the service yard BEHIND this wall, not into the kitchen)`,
    );
  }

  return [
    "",
    "SINGAPORE HDB PROFILE (active — use these EXACT dimensions and architecture, do not invent new ones):",
    "",
    `**Flat:** ${profile.flatType.toUpperCase()} HDB (post-2000 build, ${flat.total_area_sqm.toFixed(0)} m² total).`,
    `**Designing:** ${roomDisplayName(profile.room)}.`,
    "",
    "Room dimensions (FIXED — emit these into roomMeta as-is):",
    `- width_m: ${room.width_m.toFixed(2)} (along world x-axis)`,
    `- depth_m: ${room.depth_m.toFixed(2)} (along world y-axis)`,
    `- height_m: ${conv.ceiling_height_m.toFixed(2)} (ceiling)`,
    `- area: ${room.area_sqm.toFixed(1)} m², aspect ratio ${room.aspect_ratio.toFixed(2)}:1`,
    "",
    "Architecture (openings — emit these into roomMeta.openings):",
    ...archLines,
    "",
    `Adjacency context: ${adjacency[profile.room]}`,
    "",
    "Furniture choices (constrained by what physically fits):",
    `  ${roomFit}`,
    "",
    "Universal HDB conventions (must respect):",
    `- Ceiling height ${conv.ceiling_height_range} (lower than typical Western homes — taller pieces like 2.4m wardrobes are at the limit).`,
    "- All bedrooms have an external window — already specified above which wall it's on.",
    "- Kitchen is enclosed (has a door), NOT open-plan — this is an HDB convention even when the rest of the flat is open.",
    `- Bedrooms are near-square (aspect ratio ${conv.bedroom_aspect_ratio_min}:1 to ${conv.bedroom_aspect_ratio_max}:1) — never long-thin like Western apartments.`,
    `- Living/dining is elongated (aspect ratio ${conv.living_dining_aspect_ratio_min}:1 to ${conv.living_dining_aspect_ratio_max}:1).`,
    "",
    "If the user's free-text below conflicts with these constraints (e.g., asks for a king bed in a 3-room master where it doesn't fit), prioritize the HDB physical constraints — explain in the StyleBible mood string what compromise was made.",
    "",
  ].join("\n");
}

// ─── Architectural openings → AssembledScene format ───────────────
//
// Translate the profile's per-room architecture into the openings
// shape the orchestrator's clampToHdbProfile() can stamp directly
// into the AssembledScene's roomMeta.openings array. Without this,
// Claude has to translate "south wall, 0.6m from east corner" into
// "{ wall: 'south', x_offset: 0.6, width: 0.9, kind: 'door' }" by
// itself — works most of the time but drift is common.

export interface HdbRoomOpening {
  wall: WallSide;
  x_offset: number;
  width: number;
  kind: "door" | "window";
}

/** Build the openings list a profile's room should emit, in the
 *  schema's room-shell format (`{ wall, x_offset, width, kind }`).
 *  Used by the orchestrator's clampToHdbProfile to seed the room
 *  shell so the validator's door-blocking check has authoritative
 *  data to work against.
 *
 *  The ensuite door is included as a "door" — the bathroom alcove
 *  itself isn't rendered, but the door swing IS, so we want the
 *  validator to keep tall furniture clear of it.
 *
 *  The service-yard door is included similarly — kitchen pieces
 *  shouldn't block the service-yard transit. */
export function buildHdbRoomOpenings(profile: SgHdbProfile): HdbRoomOpening[] {
  const room = SG_HDB_DATA[profile.flatType].rooms[profile.room];
  // Same defensive guard as formatSgHdbGuidance — invalid (flat
  // type, room) combinations return an empty openings list. The
  // orchestrator's clamp falls through to no-profile behavior.
  if (!room) return [];
  const arch = room.architecture;
  const out: HdbRoomOpening[] = [];
  out.push({
    wall: arch.door.wall,
    x_offset: arch.door.offset_from_corner_m,
    width: arch.door.width_m,
    kind: "door",
  });
  if (arch.window) {
    out.push({
      wall: arch.window.wall,
      x_offset: arch.window.offset_from_corner_m,
      width: arch.window.width_m,
      kind: "window",
    });
  }
  if (arch.ensuite_door) {
    out.push({
      wall: arch.ensuite_door.wall,
      x_offset: arch.ensuite_door.offset_from_corner_m,
      width: arch.ensuite_door.width_m,
      kind: "door",
    });
  }
  if (arch.service_yard_door) {
    out.push({
      wall: arch.service_yard_door.wall,
      x_offset: arch.service_yard_door.offset_from_corner_m,
      width: arch.service_yard_door.width_m,
      kind: "door",
    });
  }
  return out;
}

// ─── Active-profile mismatch evaluator ─────────────────────────────
//
// v0.40.41 — the "active profile but prompt doesn't match" half of
// Fix 2. `detectHdbIntent` (above) handles the OTHER direction:
// no profile + HDB-intent prompt → suggest enabling. This evaluator
// handles: SG HDB active + prompt suggests something else → suggest
// switching room or disabling profile entirely.
//
// Two failure modes this catches:
//
//   1. **Wrong room.** Active profile is "4-room kitchen" but the
//      user typed "design my master bedroom." Without this banner,
//      the orchestrator clamps the room to a 3.0×2.4m kitchen and
//      Claude has to fit a bed in there. The output is wrong even
//      though the user's prompt was clear.
//
//   2. **Wrong context entirely.** Active profile is HDB but the
//      user typed "hotel lobby" / "warehouse" / "suburban house."
//      They probably want HDB off for this generation. Without this
//      banner, every piece comes back HDB-sized.
//
// Returns the most specific signal possible — a room mismatch beats
// a general non-HDB context mismatch (the user might be designing
// the kitchen of an HDB-themed restaurant, ambiguously). The banner
// shows the most likely-helpful action.

/** Result shape from `evaluateProfileMismatch`. The discriminant
 *  `kind` tells the banner what to render and what action button
 *  to show. `matched` is the substring from the user's prompt that
 *  triggered the signal — surfaced in the banner text so the user
 *  understands why it fired. */
export type ProfileMismatchSignal =
  | { kind: "switch-room"; suggestedRoom: SgHdbRoom; matched: string }
  | { kind: "disable-profile"; matched: string }
  | { kind: "none" };

const NON_HDB_CONTEXT_PHRASES: readonly string[] = [
  // Commercial spaces — strong signal HDB profile shouldn't apply
  "hotel lobby",
  "hotel room",
  "restaurant",
  "office space",
  "showroom",
  "warehouse",
  "retail store",
  "co-working",
  // Non-HDB residential
  "suburban house",
  "single-family home",
  "country house",
  "villa",
  "mansion",
  "townhouse",
  "brownstone",
  "loft apartment",
  "penthouse",
  // Foreign-market markers
  "American kitchen",
  "European apartment",
  "Japanese house",
  "London flat",
  "New York apartment",
];

const ROOM_KEYWORD_MAP: ReadonlyArray<{
  keywords: readonly string[];
  room: SgHdbRoom;
}> = [
  // Most-specific phrases first so "master bedroom" wins over a
  // bare "bedroom" keyword (which we don't include here — bedroom
  // alone is too ambiguous, could mean either common or master).
  { keywords: ["master bedroom", "master suite"], room: "master_bedroom" },
  { keywords: ["common bedroom 1"], room: "common_bedroom_1" },
  { keywords: ["common bedroom 2"], room: "common_bedroom_2" },
  // Generic "common bedroom" maps to _1 by default; if the active
  // room is _2 the evaluator suppresses the suggestion (see below).
  { keywords: ["common bedroom"], room: "common_bedroom_1" },
  {
    keywords: ["living room", "dining room", "living/dining", "great room"],
    room: "living_dining",
  },
  { keywords: ["kitchen"], room: "kitchen" },
];

function findFirstWordBoundedMatch(
  haystack: string,
  needles: readonly string[],
): string | null {
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    const nl = n.toLowerCase();
    const idx = lower.indexOf(nl);
    if (idx === -1) continue;
    const before = idx === 0 ? "" : lower[idx - 1];
    const after = idx + nl.length >= lower.length ? "" : lower[idx + nl.length];
    const isWordBoundary = (c: string) => c === "" || !/[a-z0-9]/.test(c);
    if (isWordBoundary(before) && isWordBoundary(after)) {
      return n;
    }
  }
  return null;
}

/** Evaluate whether the user's prompt is at odds with the active
 *  SG HDB profile. Returns a signal describing the mismatch, or
 *  "none" when the prompt and profile agree (or when the prompt
 *  is too short to evaluate meaningfully). */
export function evaluateProfileMismatch(
  prompt: string,
  profile: SgHdbProfile,
): ProfileMismatchSignal {
  const trimmed = (prompt ?? "").trim();
  // Same min-length gate as detectHdbIntent — short prompts tend to
  // be still-being-typed and trigger spurious matches.
  if (trimmed.length < 12) return { kind: "none" };

  // Check ROOM mismatch first — it's the more common failure mode
  // and the cheaper fix (one click vs. clearing the profile).
  for (const entry of ROOM_KEYWORD_MAP) {
    const m = findFirstWordBoundedMatch(trimmed, entry.keywords);
    if (!m) continue;
    if (entry.room === profile.room) {
      // The prompt confirms the active room — happy path, no
      // mismatch to flag.
      return { kind: "none" };
    }
    // Suppress the _1 ↔ _2 swap: a bare "common bedroom" matches
    // _1 in the keyword map, but if the active room is _2 the user
    // probably IS designing _2 and meant the generic phrasing.
    if (
      (entry.room === "common_bedroom_1" &&
        profile.room === "common_bedroom_2") ||
      (entry.room === "common_bedroom_2" && profile.room === "common_bedroom_1")
    ) {
      return { kind: "none" };
    }
    // Suppress suggestion for rooms not present in the active flat
    // type (e.g., common_bedroom_2 in a 3-room flat).
    if (profile.flatType === "3-room" && entry.room === "common_bedroom_2") {
      return { kind: "none" };
    }
    return {
      kind: "switch-room",
      suggestedRoom: entry.room,
      matched: m,
    };
  }

  // Then check non-HDB context — only flag when no room match was
  // found above (avoids double-flagging "kitchen of a restaurant").
  const nonHdbMatch = findFirstWordBoundedMatch(
    trimmed,
    NON_HDB_CONTEXT_PHRASES,
  );
  if (nonHdbMatch) {
    return { kind: "disable-profile", matched: nonHdbMatch };
  }

  return { kind: "none" };
}
