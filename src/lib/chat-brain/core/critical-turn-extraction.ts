/**
 * Fast, same-turn extraction so explicit constraints influence the
 * current reply before any async pipeline (preference extractor,
 * intelligence context) catches up.
 *
 * Different from `preference-extractor` (which produces persistent
 * `Preference` records): this returns *transient* facts only used
 * for THIS turn's prompt. Budget mention, room dimensions stated,
 * dimensions in feet, exclusions ("no chrome"), style words, etc.
 *
 * Ported as-is from eva/core/critical-turn-extraction.ts. Patterns
 * are domain-relevant (rooms, dimensions, materials, durability)
 * and ship with the same heuristics eva uses.
 */

export type CriticalTurnFacts = {
  explicitBudget: string | null;
  roomTypeHint: string | null;
  widthFeet: number | null;
  lengthFeet: number | null;
  heightFeet: number | null;
  exclusions: string[];
  styleHints: string[];
  materialConstraints: string[];
  durabilityNotes: string[];
  timeConstraints: string[];
  contradictions: string[];
};

const EXCLUSION_PATTERNS: RegExp[] = [
  /\b(?:avoid|no|never|don't|do not|skip)\s+([^.,;]+)/gi,
  /\bwithout\s+([^.,;]+)/gi,
];

const BUDGET_PATTERN =
  /\b(?:under|below|max(?:imum)?|budget|around|about)\s*(?:\$|USD\s*|SGD\s*)?([\d,.]+)\s*(?:k|thousand)?\b/gi;

const ROOM_PATTERN =
  /\b((?:living\s*room)|bedroom|dining(?:\s*room)?|kitchen|office|bathroom|studio)\b/i;

const DIM_FT_SIMPLE =
  /(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|'|′)\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|'|′)?/i;

const DIM_M = /\b(\d+(?:\.\d+)?)\s*m\b[^0-9]{0,8}(\d+(?:\.\d+)?)\s*m\b/i;

function parseBudgetFromText(text: string): string | null {
  BUDGET_PATTERN.lastIndex = 0;
  const m = BUDGET_PATTERN.exec(text);
  if (!m) return null;
  const raw = m[0].trim();
  return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
}

function parseRoomType(text: string): string | null {
  const m = ROOM_PATTERN.exec(text.toLowerCase());
  if (!m?.[1]) return null;
  return m[1].replace(/\s+/g, " ").trim();
}

function parseDimensionsFeet(text: string): {
  width: number | null;
  length: number | null;
} {
  const g = DIM_FT_SIMPLE.exec(text);
  if (g?.[1] && g[2]) {
    return {
      width: Number.parseFloat(g[1]),
      length: Number.parseFloat(g[2]),
    };
  }
  const m2 = DIM_M.exec(text);
  if (m2?.[1] && m2[2]) {
    const w = Number.parseFloat(m2[1]) * 3.28084;
    const l = Number.parseFloat(m2[2]) * 3.28084;
    return { width: w, length: l };
  }
  return { width: null, length: null };
}

function collectExclusions(text: string): string[] {
  const out: string[] = [];
  for (const pattern of EXCLUSION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const chunk = match[1]?.trim();
      if (chunk && chunk.length > 2 && chunk.length < 120) {
        out.push(chunk);
      }
    }
  }
  return [...new Set(out)].slice(0, 12);
}

const STYLE_WORDS =
  /\b(japandi|scandi|minimal|industrial|mid[- ]century|boho|coastal|traditional|modern|rustic)\b/gi;

function collectStyleHints(text: string): string[] {
  const out: string[] = [];
  STYLE_WORDS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STYLE_WORDS.exec(text)) !== null) {
    out.push(match[1]!);
  }
  return [...new Set(out.map((s) => s.toLowerCase()))].slice(0, 8);
}

const MATERIAL_WORDS =
  /\b(oak|walnut|maple|marble|travertine|linen|boucle|velvet|brass|chrome|rattan|leather)\b/gi;

function collectMaterials(text: string): string[] {
  const out: string[] = [];
  MATERIAL_WORDS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MATERIAL_WORDS.exec(text)) !== null) {
    out.push(match[1]!.toLowerCase());
  }
  return [...new Set(out)].slice(0, 10);
}

const DURABILITY_PATTERN =
  /\b(pet|kid|child|durable|performance\s+fabric|scratch|stain)\b/gi;

function collectDurability(text: string): string[] {
  const out: string[] = [];
  DURABILITY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DURABILITY_PATTERN.exec(text)) !== null) {
    out.push(match[1]!);
  }
  return [...new Set(out.map((s) => s.toLowerCase()))].slice(0, 8);
}

const TIME_PATTERN =
  /\b(move[- ]?in|deadline|this\s+week|next\s+month|urgent|rush|asap)\b/gi;

function collectTime(text: string): string[] {
  const out: string[] = [];
  TIME_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TIME_PATTERN.exec(text)) !== null) {
    out.push(match[1]!);
  }
  return [...new Set(out.map((s) => s.toLowerCase()))].slice(0, 6);
}

/**
 * Heuristic same-turn facts from the latest user message.
 * Does not call external APIs — pure regex.
 */
export function extractCriticalTurnFacts(
  userMessage: string,
): CriticalTurnFacts {
  const exclusions = collectExclusions(userMessage);
  const dims = parseDimensionsFeet(userMessage);
  const styleHints = collectStyleHints(userMessage);
  const materialConstraints = collectMaterials(userMessage);
  const durabilityNotes = collectDurability(userMessage);
  const timeConstraints = collectTime(userMessage);

  const contradictions: string[] = [];
  if (
    exclusions.some((e) => /dark\s*wood/i.test(e)) &&
    materialConstraints.some((m) => /walnut|oak/i.test(m))
  ) {
    contradictions.push(
      "User mentioned avoiding dark wood but also named wood species — confirm intent.",
    );
  }

  return {
    explicitBudget: parseBudgetFromText(userMessage),
    roomTypeHint: parseRoomType(userMessage),
    widthFeet: dims.width,
    lengthFeet: dims.length,
    heightFeet: null,
    exclusions,
    styleHints,
    materialConstraints,
    durabilityNotes,
    timeConstraints,
    contradictions,
  };
}

export function criticalTurnFactsToPromptBlock(
  facts: CriticalTurnFacts,
): string {
  const lines: string[] = [];
  lines.push(
    "Same-turn user constraints (parsed from this message — honor over vague prior context):",
  );
  if (facts.explicitBudget) {
    lines.push(`- Budget: ${facts.explicitBudget}`);
  }
  if (facts.roomTypeHint) {
    lines.push(`- Room type: ${facts.roomTypeHint}`);
  }
  if (facts.widthFeet != null && facts.lengthFeet != null) {
    lines.push(
      `- Stated footprint (approx): ${facts.widthFeet.toFixed(1)} ft × ${facts.lengthFeet.toFixed(1)} ft`,
    );
  }
  if (facts.exclusions.length) {
    lines.push(`- Avoid / exclude: ${facts.exclusions.join("; ")}`);
  }
  if (facts.styleHints.length) {
    lines.push(`- Style keywords: ${facts.styleHints.join(", ")}`);
  }
  if (facts.materialConstraints.length) {
    lines.push(
      `- Materials mentioned: ${facts.materialConstraints.join(", ")}`,
    );
  }
  if (facts.durabilityNotes.length) {
    lines.push(`- Durability / household: ${facts.durabilityNotes.join(", ")}`);
  }
  if (facts.timeConstraints.length) {
    lines.push(`- Timing: ${facts.timeConstraints.join(", ")}`);
  }
  if (facts.contradictions.length) {
    lines.push(`- Possible conflicts: ${facts.contradictions.join(" ")}`);
  }
  // If nothing was extracted, return empty so callers can skip the layer.
  if (lines.length === 1) return "";
  return lines.join("\n");
}
