/**
 * Generation orchestrator — async generator that emits StreamEvents.
 *
 * Pure-Node, no Python backend. Claude is the spatial reasoning engine
 * and the pipeline assembles per-piece meshes from its plan:
 *
 *   1. Call Claude with the user prompt → SceneGraph JSON
 *      (room dimensions, pieces, style bible)
 *   2. Validate with Zod → AssembledScene
 *   3. Emit: intent → style → layout events (so the client gets to
 *      see the room skeleton before any meshes are ready)
 *   4. In parallel, fire Flux for the room-level style anchor (cheap,
 *      ~5s, makes downstream piece prompts visually coherent)
 *   5. For each piece, with bounded concurrency: Flux 2D product shot
 *      → image-to-3D mesh provider → emit `piece_ready` event
 *   6. Wait on the style anchor → emit final `scene` event
 *
 * Failures cascade through `kind: "error"` events. Per-piece failures
 * emit a `progress` event with stage "piece_failed" so the rest of the
 * room still generates — a single dead piece doesn't kill the whole
 * room. The final scene contains the failed piece without a glb_url
 * which renders as a colored placeholder box (Turn 4).
 *
 * Server-only: Claude + fal.ai both require server-side API keys.
 */

import "server-only";

import {
  AssembledSceneZ,
  type AssembledScene,
  type PlacedPiece,
  type StreamEvent,
} from "@studio/director/schema";
import { generatePiece2D, generateStyleAnchor } from "./style-anchor";
import { openArchiveRun } from "./generation-archive";
import {
  getDefaultPreviewProvider,
  getDefaultHeroProvider,
} from "@studio/providers";
import {
  validateLayout,
  formatCritiqueForClaude,
  type ValidationResult,
} from "@studio/layout/validator";
import {
  detectRoomType,
  formatArchetypeGuidance,
} from "@studio/layout/archetypes";
import {
  formatSgHdbGuidance,
  getRoomDimensions,
  buildHdbRoomOpenings,
  type SgHdbProfile,
} from "@studio/profiles/sg-hdb";
import { BRAIN_ANTHROPIC_MODEL } from "@/lib/chat-brain/core/anthropic-model";

// ─── Claude HTTP client (no SDK dependency) ────────────────────────────

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/** Anthropic message content can be a plain string OR an array of
 *  multimodal blocks (text + image). We accept both shapes so simple
 *  text-only callers don't need to wrap their content. */
type ClaudeContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source:
        | { type: "base64"; media_type: string; data: string }
        | { type: "url"; url: string };
    };

type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
};

/** Convert a data URL (data:image/jpeg;base64,XXX) into the
 *  base64-source shape Anthropic's vision API expects. Returns null
 *  for non-data URLs (caller should use type:"url" source instead). */
function dataUrlToImageSource(
  url: string,
): { type: "base64"; media_type: string; data: string } | null {
  const m = url.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m) return null;
  return { type: "base64", media_type: m[1], data: m[2] };
}

/** Build a single user-message content array with optional image
 *  block(s) attached before the text. Returns a plain string when
 *  there are no images, so we don't pay the multimodal-message tax
 *  for text-only calls. */
function buildClaudeUserContent(
  text: string,
  imageUrl?: string,
): string | ClaudeContentBlock[] {
  if (!imageUrl) return text;
  const blocks: ClaudeContentBlock[] = [];
  const base64 = dataUrlToImageSource(imageUrl);
  if (base64) {
    blocks.push({ type: "image", source: base64 });
  } else if (/^https?:\/\//i.test(imageUrl)) {
    blocks.push({ type: "image", source: { type: "url", url: imageUrl } });
  }
  blocks.push({ type: "text", text });
  // If we couldn't recognize the image URL at all, fall back to
  // text-only — the model just won't have visual context.
  return blocks.length === 1 ? text : blocks;
}

/** Single-shot Claude messages call. Returns the concatenated text
 *  content from all text blocks Claude emitted. Throws on missing
 *  API key (caught upstream and emitted as an SSE `error` event). */
async function callClaudeForJson(
  system: string,
  messages: ClaudeMessage[],
  maxTokens = 4096,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: BRAIN_ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Claude API returned ${response.status}: ${text.slice(0, 400)}`,
    );
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  // Claude can emit multiple text blocks for long outputs; concatenate
  // them so JSON.parse sees the full document.
  const combined = data.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");

  return combined.trim();
}

// ─── SceneGraph generation via Claude ──────────────────────────────────

/**
 * The system prompt is the contract between us and Claude. It must:
 *   1. Pin the coordinate system explicitly (z-UP — Claude's training
 *      data has both conventions; without pinning we get inconsistent
 *      output)
 *   2. Show a complete example of the JSON shape (Claude is much
 *      better at hitting exact schemas when shown an exemplar)
 *   3. Bound piece count (6-10) so generation doesn't balloon to 30
 *      pieces × $0.01 each. v0.40.47 raised the floor from 4 → 6 so
 *      a default room reads as "actually furnished" rather than
 *      "minimal sketch" — most user feedback was that 4-piece rooms
 *      felt empty (a bed + nightstand + lamp + rug isn't a bedroom,
 *      it's a hotel room).
 *   4. Force rotations to 0/90/180/270 (matches our snap logic + how
 *      furniture actually sits)
 *   5. Disallow markdown fences in output (Claude often wraps JSON in
 *      ```json — we strip these defensively but better to ask first)
 */
function buildSystemPrompt(): string {
  return `You are an interior design layout engine. Given a user prompt describing a room, produce a complete AssembledScene as JSON.

COORDINATE SYSTEM (CRITICAL):
- Room Director convention: z-axis is UP, x is east-west, y is north-south
- Room origin is the center of the floor; x ranges from -width_m/2 to +width_m/2, y from -depth_m/2 to +depth_m/2
- Piece positions are the CENTER of each piece's bounding box
- is_on_floor=true means piece sits with its bottom at z=0 (use z = height/2 for the center)
- Rotations are in degrees around the vertical (z) axis — prefer 0/90/180/270

SCENE CONSTRAINTS:
- Produce 6-9 pieces. Aim for a fully-furnished room, not a minimal sketch.
  Examples:
    Bedroom — bed, two nightstands, dresser, reading chair, rug, floor lamp.
    Living — sofa, coffee table, two side chairs, media unit, rug, floor lamp.
    Dining — dining table, 4-6 chairs, sideboard or buffet, rug, pendant or
      floor lamp.
- All pieces must fit inside the room bounds with at least 10cm clearance from walls
- Pieces must not overlap each other
- Include realistic dimensions in meters (e.g., sofa 2.0m × 0.9m × 0.8m)
- Each piece needs a unique id (e.g., "sofa_01", "rug_01")

ROTATION RULES (avoid the "random orientation" trap):
- Beds: long axis perpendicular to the wall the headboard touches; rotation chosen
  so the headboard FACES THE WALL (i.e., the foot of the bed faces room interior).
  A bed against the +z wall (north) is rotated 0°; against +x wall is 90°; etc.
- Nightstands: must flank the bed with the SAME rotation as the bed.
- Sofas: back against a wall whenever possible; rotation chosen so the seat faces
  into the room. A sofa with its back on the -z wall (south) has rotation 180°.
- Armchairs / lounge chairs: face the room's primary seating focus (usually the
  coffee table or the sofa); avoid pointing at a wall.
- Desks: back against a wall, work surface facing the room. The user sits between
  the desk and the room.
- Dining tables: rotation 0° (long axis = x). Chairs around it face the table.
- Bookshelves / wardrobes / dressers: back flush against a wall, opening facing
  the room.
- Rugs: rotation 0 unless they're explicitly oriented (e.g., a runner aligned with
  a hallway).
- Coffee tables: rotation 0 — usually neutral, oriented to align with the sofa.
- Lamps + decorative objects: rotation 0 unless directional (e.g., spotlights).
- General: rotations should be 0, 90, 180, or 270. Only emit other values if the
  user explicitly asked for a diagonal placement.

STYLE BIBLE:
- Include a palette (walls hex color, accent hex color, optional floor_tint)
- Include materials (dominant_wood, primary_textile, optional metal)
- Include lighting: "warm-soft" | "cool-bright" | "dramatic" | "neutral"
- Include a mood string and a forbidden array of anti-styles

ROOM SHELL:
- If the user specifies dimensions in the prompt (e.g., "12x15 ft bedroom",
  "4.5m by 5m living room", "small 3x4 study"), HONOR THEM. Convert feet
  to meters (1 ft = 0.3048 m). If no dimensions are given, pick reasonable
  sizes for the room type.
- Default height_m is 2.7m unless the prompt suggests otherwise.
- Shape defaults to "rectangle". If the user says "L-shaped", "U-shaped",
  "open plan", or describes an irregular footprint, you MUST also emit a
  custom \`walls\` array (see below). Otherwise leave \`walls: []\` and the
  client synthesizes a 4-wall rectangle from width × depth.
- For L/U-shape rooms: each wall segment is { id, x1, z1, x2, z2, thickness }.
  Coordinates are meters in y-UP world space, room centered on origin
  (so a 4m wide room has walls at x = ±2). Thickness is typically 0.15.
  An L-shape, for example, has 6 wall segments instead of 4.
- Include openings (door, window) on specific walls if the prompt suggests them.

SATISFIED_RELATIONS (declare what each piece's placement achieves):
Each piece's "satisfied_relations" array should list the spatial relationships the placement satisfies, using a small vocabulary. The validator checks these geometrically — false claims dock the layout score, so claim only what's true.
- "near:<piece_id>"      → centers within 1.0m of <piece_id>
- "faces:<piece_id>"     → this piece's facing direction (local +y, rotated by z_angle) points at <piece_id> within ±30°
- "flanking:<piece_id>"  → sits alongside <piece_id> with overlapping depth-range, gap ≤ 0.3m
- "against:wall"         → nearest face within 0.15m of any room wall
- "centered:wall"        → centered along its closest wall (within 0.5m of wall midpoint)
Example: a coffee table 0.6m in front of a sofa would claim ["near:sofa_01"]; a sofa with its back on a wall would claim ["against:wall"]; nightstands beside a bed would each claim ["flanking:bed_01", "near:bed_01"]; a chair facing a desk would claim ["faces:desk_01", "near:desk_01"]. Aim for 1-3 relations per piece — the relationships that actually define the arrangement.

OUTPUT FORMAT:
Return ONLY valid JSON matching this shape — no markdown, no prose, no fences.

{
  "style": {
    "name": "mid-century modern",
    "palette": { "walls": "#F5EDDC", "floor_tint": "#8B5A3C", "accent": "#D9826A" },
    "materials": { "dominant_wood": "walnut", "primary_textile": "wool", "metal": "brushed brass" },
    "lighting": "warm-soft",
    "mood": "cozy, inviting, timeless",
    "forbidden": ["ornate", "gothic", "industrial"]
  },
  "room": {
    "width_m": 4.5,
    "depth_m": 5.0,
    "height_m": 2.7,
    "shape": "rectangle",
    "openings": [{ "wall": "north", "x_offset": 0.8, "width": 0.9, "kind": "door" }]
  },
  "pieces": [
    {
      "id": "sofa_01",
      "category": "sofa",
      "description": "3-seat tufted wool sofa in warm taupe",
      "dimensions": { "length": 2.0, "width": 0.9, "height": 0.8 },
      "position": { "x": 0, "y": -1.8, "z": 0.4 },
      "rotation": { "z_angle": 0 },
      "is_on_floor": true,
      "satisfied_relations": ["against:wall", "centered:wall"]
    },
    {
      "id": "coffee_table_01",
      "category": "coffee_table",
      "description": "low walnut oval coffee table",
      "dimensions": { "length": 1.0, "width": 0.6, "height": 0.42 },
      "position": { "x": 0, "y": -0.7, "z": 0.21 },
      "rotation": { "z_angle": 0 },
      "is_on_floor": true,
      "satisfied_relations": ["near:sofa_01"]
    }
  ],
  "walls": [],
  "openings": [],
  "layout_score": null,
  "score_breakdown": null
}

EXAMPLE OF AN L-SHAPED ROOM (5m × 5m main, 3m × 2m alcove on the +X +Z corner):
The walls array would have 6 segments tracing the outer perimeter:
[
  { "id": "w1", "x1": -2.5, "z1": -2.5, "x2":  2.5, "z2": -2.5, "thickness": 0.15 },
  { "id": "w2", "x1":  2.5, "z1": -2.5, "x2":  2.5, "z2":  0.5, "thickness": 0.15 },
  { "id": "w3", "x1":  2.5, "z1":  0.5, "x2":  4.0, "z2":  0.5, "thickness": 0.15 },
  { "id": "w4", "x1":  4.0, "z1":  0.5, "x2":  4.0, "z2":  2.5, "thickness": 0.15 },
  { "id": "w5", "x1":  4.0, "z1":  2.5, "x2": -2.5, "z2":  2.5, "thickness": 0.15 },
  { "id": "w6", "x1": -2.5, "z1":  2.5, "x2": -2.5, "z2": -2.5, "thickness": 0.15 }
]
For rectangular rooms, leave walls: [].`;
}

/** Strip any markdown fences Claude might have wrapped around the JSON.
 *  Defensive — the system prompt asks for raw JSON, but Claude
 *  sometimes adds ```json...``` anyway. */
function stripFences(s: string): string {
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/m;
  const match = s.match(fence);
  return match ? match[1].trim() : s.trim();
}

/** Lower-level: takes a pre-built messages array (so retry can append
 *  a new user turn with the validator's critique). Returns a parsed
 *  + schema-validated AssembledScene. The system prompt is fixed.
 *
 *  v0.40.50: added a one-shot retry on JSON parse + schema validation
 *  failures. Claude occasionally emits trailing prose after the JSON
 *  block, an unmatched brace, or a numeric field as a string —
 *  benign mistakes a quick retry usually fixes. Without retry, the
 *  user just saw "The AI returned an unexpected response shape" and
 *  had to paste their prompt again. The retry adds a follow-up
 *  message instructing Claude to reply with JSON only, no prose,
 *  no fences. Costs one extra Anthropic call on the failure path
 *  only; success path is unchanged. */
async function runSceneGraphMessages(
  messages: ClaudeMessage[],
): Promise<AssembledScene> {
  const system = buildSystemPrompt();

  const tryOnce = async (
    msgs: ClaudeMessage[],
  ): Promise<
    | { ok: true; scene: AssembledScene }
    | { ok: false; reason: string; raw: string }
  > => {
    const raw = await callClaudeForJson(system, msgs);
    const clean = stripFences(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return { ok: false, reason: "invalid_json", raw: clean };
    }
    const result = AssembledSceneZ.safeParse(parsed);
    if (!result.success) {
      return {
        ok: false,
        reason: `schema: ${result.error.message.slice(0, 400)}`,
        raw: clean,
      };
    }
    return { ok: true, scene: result.data };
  };

  const first = await tryOnce(messages);
  if (first.ok) return first.scene;

  // Retry once with an explicit reminder. Append the previous raw
  // output as an assistant turn + a fresh user turn requesting a
  // clean retry — Anthropic's chat format handles this naturally.
  const retryMessages: ClaudeMessage[] = [
    ...messages,
    {
      role: "assistant",
      content: first.raw.slice(0, 3000),
    },
    {
      role: "user",
      content:
        "That response failed to parse. Please reply again with the SceneGraph as a single valid JSON object — no markdown fences, no prose before or after, no comments inside the JSON. Match the schema exactly.",
    },
  ];
  const second = await tryOnce(retryMessages);
  if (second.ok) return second.scene;

  // Both attempts failed — throw the more informative error so the
  // friendly mapper can pick it up.
  if (second.reason === "invalid_json") {
    throw new Error(
      `Claude returned invalid JSON: ${second.raw.slice(0, 200)}…`,
    );
  }
  throw new Error(
    `Claude's SceneGraph failed schema validation: ${second.reason.replace(/^schema: /, "").slice(0, 400)}`,
  );
}

/** Validate-and-retry wrapper. Calls Claude, runs the layout
 *  validator, and if there are HARD violations (overlap, blocked
 *  door, piece outside room) it sends the critique back as a
 *  follow-up turn for ONE revision. Soft-only layouts are accepted
 *  as-is — Claude rarely improves them on retry. Always returns
 *  the FINAL accepted scene (which may still have soft violations
 *  if the retry itself failed validation; at that point we give
 *  up gracefully and let the user see what Claude produced). */
async function buildAndValidateScene(
  initialPrompt: string,
  referenceImageUrl: string | undefined,
  profile: SgHdbProfile | undefined,
  emitProgress: (detail: string) => void,
): Promise<{
  scene: AssembledScene;
  finalValidation: ValidationResult;
  retried: boolean;
  detectedRoomType: ReturnType<typeof detectRoomType>;
}> {
  // v0.40.37: Singapore HDB profile injection. When the profile is
  // active we prepend a guidance block telling Claude the EXACT room
  // dimensions (drawn from the post-2000 HDB spec for the user's
  // chosen flat type + room) plus furniture-fit rules and HDB
  // conventions (enclosed kitchen, near-square bedrooms, mandatory
  // household shelter). When the profile is absent we fall back to
  // the existing archetype-only path. Profile takes precedence over
  // archetype detection — if the user has selected "4-room HDB
  // master bedroom" we trust that over a keyword-based archetype
  // guess; the archetype block adds nothing on top of explicit
  // dimensions and could conflict with the HDB-specific furniture
  // constraints.
  const sgHdbGuidance = profile ? formatSgHdbGuidance(profile) : "";

  // v0.40.35: archetype injection. If the user's prompt clearly
  // implies a room type (bedroom / living room / home office /
  // studio / dining room), prepend the canonical archetypes for
  // that type to the user message. Gives Claude a strong
  // structural prior — "for a bedroom, prefer centered_bed: bed
  // centered on longest wall, nightstands flanking, dresser
  // opposite, wardrobe in corner" — so first-pass layouts more
  // often nail the canonical pattern. When detection is ambiguous
  // (the prompt doesn't name a room type, e.g. "design a cozy
  // space for reading"), we skip the injection and let Claude
  // free-style. False positives here would actively hurt — telling
  // Claude "this is a dining room" when it's a kitchen would
  // produce a worse layout than no archetype at all.
  // When the SG HDB profile is active we skip archetype detection
  // entirely — the profile already pins the room type implicitly
  // (master_bedroom / common_bedroom / living_dining / kitchen)
  // and supplies more specific dimensions than any archetype can.
  const detectedRoomType = profile ? null : detectRoomType(initialPrompt);
  const archetypeGuidance = detectedRoomType
    ? formatArchetypeGuidance(detectedRoomType)
    : "";

  const basePrompt = referenceImageUrl
    ? `The user attached a reference image showing the look they want. Use this image as the primary source of truth for the StyleBible — match its palette, materials, lighting, and overall mood. Combine that with their text below for the room's pieces and dimensions.\n\n${initialPrompt}`
    : initialPrompt;

  // Compose order: SG HDB guidance (most specific) → archetype
  // guidance (general) → user free-text. Each block is separated by
  // a horizontal rule so Claude reads them as distinct sections.
  // SG HDB block goes first because it pins the architecture; the
  // archetype block (if any) is style-and-relationship guidance that
  // applies within those fixed walls.
  const guidanceBlocks = [sgHdbGuidance, archetypeGuidance].filter(
    (s) => s.length > 0,
  );
  const userText =
    guidanceBlocks.length > 0
      ? `${guidanceBlocks.join("\n\n---\n\n")}\n\n---\n\n${basePrompt}`
      : basePrompt;

  const conversation: ClaudeMessage[] = [
    {
      role: "user",
      content: buildClaudeUserContent(userText, referenceImageUrl),
    },
  ];

  // First pass.
  const firstSceneRaw = await runSceneGraphMessages(conversation);
  // v0.40.37: when the SG HDB profile is active we OVERRIDE the
  // returned roomMeta dimensions with the profile's exact spec.
  // Claude is instructed in the system prompt to emit these
  // verbatim, but as a defensive belt-and-suspenders we override on
  // our side so a small numerical drift (Claude rounding 3.5 → 3.6)
  // doesn't propagate to the studio. Piece positions are NOT
  // touched — they're already in the profile's coordinate frame
  // (room centered at origin) so they translate as-is.
  const firstScene = profile
    ? clampToHdbProfile(firstSceneRaw, profile)
    : firstSceneRaw;
  const firstValidation = validateLayout(firstScene);

  // Accept if the score clears the bar OR if the only violations
  // are soft AND there are no hard ones — soft-only is acceptable
  // because Claude often produces layouts where, say, the sofa is
  // 0.05m short of preferring-wall but still looks fine. The retry
  // round is reserved for actual problems (overlaps, blocked doors,
  // pieces poking through walls).
  // Accept if either:
  //  • there are zero hard violations (soft-only is fine — Claude
  //    sometimes places a sofa 5cm short of preferring-wall and a
  //    retry round wouldn't materially improve it), OR
  //  • the score is above threshold AND no hard violations.
  // Earlier versions used `score >= threshold OR !hasHardIssues`,
  // but that admitted layouts where a single hard violation (e.g.
  // overlap, blocked door) was masked by perfect scores in the
  // other dimensions — a 0.702 weighted score can still hide a
  // serious overlap. Retry semantics: if there's a hard issue, we
  // always send a critique back for one revision round.
  const hasHardIssues = firstValidation.hardViolations.length > 0;
  if (!hasHardIssues) {
    return {
      scene: stampValidationOnScene(firstScene, firstValidation),
      finalValidation: firstValidation,
      retried: false,
      detectedRoomType,
    };
  }

  // Critique + retry. We append Claude's prior response as an
  // assistant turn so it has full context for what to revise, then
  // attach our critique as the next user turn.
  emitProgress(
    `Reviewing layout (score ${firstValidation.score.toFixed(2)}) — asking Claude for one revision…`,
  );
  conversation.push({
    role: "assistant",
    content: JSON.stringify(firstScene, null, 2),
  });
  conversation.push({
    role: "user",
    content: formatCritiqueForClaude(firstValidation),
  });

  let secondScene: AssembledScene;
  try {
    const secondRaw = await runSceneGraphMessages(conversation);
    // Same HDB override as the first pass — keeps the dimensions
    // identical between attempts even if Claude drifts on the retry.
    secondScene = profile ? clampToHdbProfile(secondRaw, profile) : secondRaw;
  } catch (err) {
    // If the retry itself fails (Claude returns malformed JSON, API
    // hiccup, etc.), accept the first attempt. Better a 0.5-scored
    // scene the user can see than a hard error.

    console.warn(
      "[orchestrator] layout retry failed — keeping first attempt:",
      err,
    );
    return {
      scene: stampValidationOnScene(firstScene, firstValidation),
      finalValidation: firstValidation,
      retried: true,
      detectedRoomType,
    };
  }
  const secondValidation = validateLayout(secondScene);

  // Pick whichever pass scored better — usually the retry, but if
  // Claude made things worse (rare but happens), keep the first
  // attempt. The user shouldn't pay for our intervention.
  if (secondValidation.score >= firstValidation.score) {
    return {
      scene: stampValidationOnScene(secondScene, secondValidation),
      finalValidation: secondValidation,
      retried: true,
      detectedRoomType,
    };
  }
  return {
    scene: stampValidationOnScene(firstScene, firstValidation),
    finalValidation: firstValidation,
    retried: true,
    detectedRoomType,
  };
}

/** Embed the validation result in the AssembledScene's existing
 *  `layout_score` + `score_breakdown` fields. The schema already
 *  reserves these (they were null placeholders before this commit). */
function stampValidationOnScene(
  scene: AssembledScene,
  validation: ValidationResult,
): AssembledScene {
  return {
    ...scene,
    layout_score: validation.score,
    score_breakdown: validation.breakdown,
  };
}

/** Force the scene's roomMeta dimensions to match the HDB profile's
 *  spec exactly. Defensive override: the system prompt already
 *  instructs Claude to emit these, but small drift (e.g. Claude
 *  emitting 3.6 instead of 3.5 because it rounded) would propagate
 *  to the studio's renderer and the user would see a slightly-wrong
 *  room. We clamp to the spec so the architecture is exact.
 *
 *  Piece positions and dimensions are NOT touched. Pieces are
 *  already in the room's coordinate frame (origin = room center)
 *  so they remain valid relative to the corrected room rectangle.
 *  The validator runs AFTER this clamp and will catch any pieces
 *  that, post-clamp, now poke outside the room. */
function clampToHdbProfile(
  scene: AssembledScene,
  profile: SgHdbProfile,
): AssembledScene {
  const dims = getRoomDimensions(profile.flatType, profile.room);
  if (!dims) return scene;
  // Authoritative openings list from the profile — door + window
  // (+ ensuite door for master bedroom + service-yard door for
  // kitchen). Replaces whatever Claude returned for room.openings,
  // so the validator's door-blocking check has known-correct data
  // even when Claude's first pass omits or mis-locates an opening.
  const profileOpenings = buildHdbRoomOpenings(profile);
  return {
    ...scene,
    room: {
      ...scene.room,
      width_m: dims.width_m,
      depth_m: dims.depth_m,
      height_m: 2.7,
      shape: "rectangle" as const,
      openings: profileOpenings,
    },
  };
}

// ─── Orchestration ─────────────────────────────────────────────────────

export interface OrchestratorOptions {
  prompt: string;
  /** "preview" = fast TripoSR meshes (~1s each); "hero" = Hunyuan3D /
   *  TRELLIS (~30-90s each, much higher quality). */
  quality?: "preview" | "hero";
  /** Skip the Flux style anchor image. Saves ~5s + ~$0.005 — useful
   *  when iterating on a prompt and you don't need the reference. */
  skipStyleAnchor?: boolean;
  /** Max parallel mesh generations. Defaults to 3 — fal.ai's typical
   *  per-key concurrency limit. Going higher just gets you 429'd. */
  maxConcurrency?: number;
  /** Abort signal threaded from the API route's request signal so
   *  client-side cancellation propagates all the way to fal.ai. */
  signal?: AbortSignal;
  /** Optional user-supplied reference image (data URL or HTTPS).
   *  When present:
   *    - Skips the Flux-generated style anchor pass; the user's
   *      image becomes the scene's reference_image_url directly.
   *    - Feeds the image to Claude as a vision input so the
   *      derived StyleBible reflects the photo's actual look
   *      (palette, materials, mood) — far more accurate than text-
   *      only prompting. */
  /** When true, skip the per-piece mesh generation loop entirely.
   *  The pipeline still runs intent → style → layout, and emits the
   *  layout event so the client can render placeholder boxes, but
   *  no Flux 2D + image-to-3D calls are made. Used by Room Layout
   *  mode where the deliverable is the floor plan, not the meshes —
   *  the user gets a fast (~5–15s) result instead of waiting 60+
   *  seconds for hero meshes. The final `scene` event still fires;
   *  pieces just have no `glb_url` and the client renders them as
   *  placeholder boxes via GeneratedPieceMesh's existing fallback. */
  skipPieceMeshes?: boolean;
  referenceImageUrl?: string;
  /** v0.40.37: Singapore HDB profile. When present, the orchestrator
   *  pre-fills the room dimensions from the profile (Claude doesn't
   *  invent them) and injects HDB-specific guidance into the prompt
   *  — enclosed kitchen, near-square bedrooms, ceiling 2.7m, mandatory
   *  household shelter, furniture-fit rules ("queen bed comfortable
   *  in 4-room master, king tight"). When absent, generation behaves
   *  exactly as before — no Singapore-specific assumptions. The
   *  profile composes with everything else: archetypes still apply,
   *  validator still runs, room-type detection still works. */
  profile?: SgHdbProfile;
}

/** Run the orchestrator as an async generator of StreamEvents.
 *
 *  Each yielded event is what the API route emits as an SSE
 *  `data: <json>` line. The client's useDesignStream hook (Turn 3)
 *  consumes these via parseSSE and routes each into the store.
 *
 *  Critical: the function never throws. Every error path yields an
 *  `error` event and returns. This is what makes the SSE stream safe
 *  — the API route is just `for await (const e of run()) emit(e)`,
 *  and a thrown exception there would close the stream abruptly. */
export async function* runOrchestrator(
  opts: OrchestratorOptions,
): AsyncGenerator<StreamEvent, void, unknown> {
  const concurrency = opts.maxConcurrency ?? 3;
  const userRefImage = opts.referenceImageUrl;
  const skipAnchor = opts.skipStyleAnchor ?? Boolean(userRefImage);

  // Open a local archive run for this generation. Each output (style
  // anchor, per-piece 2D, per-piece GLB, final scene JSON) is written
  // to disk under data/generations/<run-id>/ so the user can review
  // what the pipeline produced. Best-effort — failures are logged
  // but never abort the actual generation.
  const archive = await openArchiveRun({
    prompt: opts.prompt,
    kind: "room",
  });

  try {
    // ── Stage 1: Claude builds the SceneGraph ────────────────────────
    yield {
      kind: "progress",
      stage: "intent",
      detail: userRefImage
        ? "Asking Claude to plan from your reference image…"
        : "Asking Claude to plan…",
    };
    yield { kind: "intent", intent: { prompt: opts.prompt } };

    // Pass the reference image into the Claude call so Claude's
    // vision model sees it and the derived StyleBible reflects it.
    // v0.40.34: validation + one-retry wrapper. We score the layout
    // against clearance / door-blocking / wall-fit / usage-zone
    // rules right after Claude returns, and if there are hard issues
    // (overlap, pieces through walls, blocked doors) we send a
    // critique back as a follow-up turn for ONE revision pass. The
    // accepted scene's layout_score + score_breakdown are stamped
    // onto the AssembledScene so downstream consumers (analytics,
    // future UI surfacing) can read it.
    const validated = await buildAndValidateScene(
      opts.prompt,
      userRefImage,
      opts.profile,
      (detail) => {
        // Surface the retry decision to the user as a progress
        // event. The chat UI's thinking log shows this.

        console.info("[orchestrator] " + detail);
      },
    );
    const scene = validated.scene;
    if (opts.signal?.aborted) return;
    // Persist the validation result alongside the layout snapshot
    // so it lives in the run archive for inspection. v0.40.35 adds
    // detectedRoomType so we can tell post-hoc whether the archetype
    // injection fired and which type the detector landed on.
    void archive.saveJson("validation.json", {
      score: validated.finalValidation.score,
      breakdown: validated.finalValidation.breakdown,
      hardViolations: validated.finalValidation.hardViolations,
      softViolations: validated.finalValidation.softViolations,
      retried: validated.retried,
      detectedRoomType: validated.detectedRoomType,
      profile: opts.profile ?? null,
    });
    // Stamp the detected room type into the scene's existing
    // layout_archetype field if Claude didn't already populate it.
    // This is mostly for analytics — the field was always optional
    // and nothing in the UI consumes it yet.
    if (validated.detectedRoomType && !scene.layout_archetype) {
      scene.layout_archetype = validated.detectedRoomType;
    }

    // Save the StyleBible + room shape immediately — even if mesh gen
    // fails downstream, we still have a record of what Claude returned.
    void archive.saveJson("style.json", scene.style);
    void archive.saveJson("layout.json", {
      room: scene.room,
      pieces: scene.pieces,
      walls: scene.walls,
      openings: scene.openings,
    });

    // If the user supplied a reference, save it too — they may not
    // remember which image they uploaded for which run.
    if (userRefImage) {
      void archive.saveFromUrl("user_reference.bin", userRefImage);
    }

    yield { kind: "style", style: scene.style };
    yield {
      kind: "layout",
      room: scene.room,
      pieces: scene.pieces,
    };

    // ── Stage 2: Style anchor (fire-and-forget, non-blocking) ────────
    // Two paths:
    //   - User attached a reference image → use it directly. No Flux
    //     call. The downstream `scene` event carries this URL as
    //     `reference_image_url` so the chat UI can show it as a
    //     thumbnail and follow-up generations can cite it.
    //   - Otherwise → fire Flux to generate an anchor (existing path),
    //     unless skipStyleAnchor was explicitly set.
    let styleAnchorUrl: string | undefined = userRefImage;
    const anchorPromise: Promise<string | undefined> =
      userRefImage || skipAnchor
        ? Promise.resolve(userRefImage)
        : generateStyleAnchor(scene.style)
            .then((r) => {
              styleAnchorUrl = r.url;
              // Archive the anchor as soon as it's available.
              void archive.saveFromUrl("style_anchor.png", r.url);
              return r.url;
            })
            .catch((err) => {
              console.warn("[orchestrator] style anchor failed:", err);
              return undefined;
            });

    // ── Stage 3: Per-piece mesh fan-out ──────────────────────────────
    // Skipped entirely in Room Layout mode (skipPieceMeshes=true) —
    // the deliverable is the layout, not the meshes. Pieces ship to
    // the client without `glb_url` and render as placeholder boxes
    // via GeneratedPieceMesh's existing fallback path.
    const placedWithGlb: PlacedPiece[] = [...scene.pieces];
    // v0.40.31: collect IDs of pieces whose mesh generation failed,
    // so the final scene can surface them and the client can offer
    // per-piece retry. The placeholder-box rendering path stays as
    // a graceful degradation, but now the user knows WHICH pieces
    // failed and can re-trigger just those.
    const failedPieceIds: string[] = [];

    if (!opts.skipPieceMeshes) {
      // Picking the right provider matters here — calling preview with
      // tier="hero" wastes compute on a preview-class model. The hero
      // provider (Hunyuan3D / TRELLIS) is what hero-tier costs pay for.
      const meshProvider =
        opts.quality === "hero"
          ? getDefaultHeroProvider()
          : getDefaultPreviewProvider();

      const pieces = scene.pieces;

      // Process in batches of `concurrency`. Promise.allSettled so one
      // bad piece doesn't kill the others. We yield piece_ready events
      // as they fulfill (per batch), so the user sees pieces appear
      // progressively in the viewer.
      for (let i = 0; i < pieces.length; i += concurrency) {
        if (opts.signal?.aborted) return;
        const batch = pieces.slice(i, i + concurrency);

        const results = await Promise.allSettled(
          batch.map(async (placed) => {
            // generatePiece2D + buildPiecePrompt only need .description,
            // so passing PlacedPiece directly is fine — it satisfies
            // the structural PromptablePiece type.
            const img = await generatePiece2D(placed, scene.style);
            // Archive the 2D image immediately. Saving inside the
            // batch promise keeps it concurrent with the mesh call.
            // Sanitize the piece id for filename use.
            const safeId = placed.id.replace(/[^a-z0-9_-]/gi, "_");
            void archive.saveFromUrl(`piece_${safeId}.png`, img.url);

            const mesh = await meshProvider.generate({
              image_url: img.url,
              tier: opts.quality === "hero" ? "hero" : "preview",
            });
            // Archive the GLB as soon as it lands.
            void archive.saveFromUrl(`piece_${safeId}.glb`, mesh.glb_url);
            return { id: placed.id, glb_url: mesh.glb_url, image_url: img.url };
          }),
        );

        for (let resIdx = 0; resIdx < results.length; resIdx++) {
          const result = results[resIdx];
          if (result.status === "fulfilled") {
            const { id, glb_url, image_url } = result.value;
            const idx = placedWithGlb.findIndex((p) => p.id === id);
            if (idx >= 0) {
              // v0.40.30: also persist the per-piece 2D image_url so
              // the Reference card and Interior Design tile-expansion
              // UI can show it later. Adds a single string per piece —
              // negligible payload cost.
              placedWithGlb[idx] = {
                ...placedWithGlb[idx],
                glb_url,
                image_url,
              };
            }
            yield {
              kind: "piece_ready",
              piece_id: id,
              glb_url,
            };
          } else {
            // Per-piece failure — keep going. The final scene will
            // contain this piece without a glb_url, which the client
            // renders as a colored placeholder box.
            // v0.40.31: also record the failed piece id so the final
            // scene can list it. The client uses this list to (a)
            // show "5 rendered, 3 failed" in the completion message
            // and (b) offer per-piece retry on the placeholder box.
            const failedId = batch[resIdx]?.id;
            if (failedId) failedPieceIds.push(failedId);
            yield {
              kind: "progress",
              stage: "piece_failed",
              detail: `Piece failed: ${String(result.reason).slice(0, 120)}`,
            };
          }
        }
      }
    } // end if (!opts.skipPieceMeshes)

    // ── Stage 4: Wait on the style anchor, emit final scene ─────────
    await anchorPromise;
    const finalScene: AssembledScene = {
      ...scene,
      pieces: placedWithGlb,
      reference_image_url: styleAnchorUrl,
      // v0.40.31: surface failed-piece IDs to the client.
      failed_piece_ids: failedPieceIds,
    };

    // Final archive write — the assembled scene with every glb_url
    // embedded. This is the canonical record of what the run produced.
    void archive.saveJson("scene.json", finalScene);

    yield { kind: "scene", scene: finalScene };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Still write the error so the user knows which run failed.
    void archive.saveText(
      "error.txt",
      `${msg}\n\nstack:\n${err instanceof Error ? err.stack : "(no stack)"}`,
    );
    yield { kind: "error", message: msg };
  }
}
