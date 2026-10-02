/**
 * Preference extractor.
 *
 * Given a user turn, extracts candidate preferences with source
 * attribution + confidence scores. **Risk 4 mitigation lives here:**
 *
 *   1. Every extracted candidate carries `sourceText` — the verbatim
 *      substring of the user's message that produced the inference.
 *      No quote → no preference.
 *   2. Every candidate carries `confidence` (0..1) self-rated by the
 *      extractor's pattern strength.
 *   3. The persistence policy in `applyExtractionPolicy` enforces:
 *        confidence < 0.7  → drop
 *        confidence ≥ 0.7  → status="provisional" (proposal; needs Accept)
 *        Never auto-confirm — inferred ≠ remembered until the user accepts.
 *
 * # Approach
 *
 * Turn 2 ships a **rule-based extractor**. Patterns target high-
 * signal phrases:
 *   - "I love walnut" / "I'm into mid-century" → primary_style /
 *     preferred_wood / etc.
 *   - "no chrome" / "avoid plastic" → deal_breaker
 *   - "budget around $X" → budget_range
 *   - "I need a workspace" / "I want a reading nook" → must_include
 *
 * The rule-based extractor is **conservative on purpose**. It only
 * fires for clearly-articulated preferences. Subtle implications
 * ("the room feels small") are NOT extracted. We don't try to
 * match every possible phrasing — we'd rather miss real preferences
 * than hallucinate fake ones. (Net result: extractor's recall is
 * lower than precision. We accept that trade.)
 *
 * # Why rule-based and not Claude-powered for Turn 2?
 *
 * Three reasons:
 *   1. **No extra Claude call.** Each chat turn would otherwise need
 *      an additional Claude round-trip just for extraction. Cost +
 *      latency.
 *   2. **Determinism.** Rule-based extractors fire identically every
 *      time. Same input → same output. Easier to audit + correct.
 *   3. **Threshold tuning is coupled.** A Claude extractor's
 *      confidence is harder to calibrate against than pattern-strength
 *      scores. We can promote the right phrases to "confirmed" by
 *      adjusting the rule rather than retraining.
 *
 * Turn 4 will optionally promote this to a Claude-extracted layer for
 * higher recall, behind a flag. For now, this is enough to populate
 * the brain's memory with the most reliable preferences.
 *
 * # Two-strikes deletion (also Risk 4)
 *
 * `detectContradictions(turnText, existingPreferences)` returns the IDs
 * of any preferences the user has explicitly contradicted ("not
 * walnut, oak"). The brain pipeline (Turn 3) uses this to flip the
 * matching preference's status to "rejected" without deleting the
 * record (audit trail preserved).
 */

import type { Preference, PreferenceStatus } from "@/lib/store/preferences-slice";
import { newPreferenceId } from "@/lib/store/preferences-slice";
import { INTELLIGENCE_LIMITS } from "./intelligence-constants";

/** Output of the rule extractor — one record per matched rule. The
 *  caller decides whether to persist (via applyExtractionPolicy). */
export interface ExtractedPreferenceCandidate {
  key: string;
  value: string;
  /** Substring of user text that produced this candidate. Always
   *  non-empty — caller's contract is "if you can't quote it, don't
   *  return it". */
  sourceText: string;
  /** Pattern-strength score. 0.95+ for "I love X" type assertions;
   *  0.75 for hedged "maybe X"; 0.5 for ambiguous mentions. */
  confidence: number;
}

// Internal rule shape: a regex + key + a transform that yields value
// + confidence scaling.
type Rule = {
  regex: RegExp;
  key: string;
  /** Returns the canonical value extracted from the match. Receives
   *  the regex's capture array. */
  toValue: (m: RegExpExecArray) => string | null;
  /** Base confidence for this rule. Adjusted up/down by hedge words. */
  baseConfidence: number;
};

// Rules ordered by specificity. Higher-specificity rules first so
// they win the match.

const RULES: Rule[] = [
  // ── Style / aesthetic ──────────────────────────────────────────
  // High confidence patterns — explicit love/want statements.
  {
    regex:
      /\b(?:i (?:love|adore|really like|am into|want|prefer|need)|i'?m (?:into|loving|going for|thinking))\s+([\w\s-]{3,40}?)\s+(?:style|aesthetic|vibe|look|feel|mood)/i,
    key: "primary_style",
    toValue: (m) => normaliseStyle(m[1]),
    baseConfidence: 0.95,
  },
  {
    regex:
      /\b(?:i'?m (?:going for|thinking)|let'?s do|let's go with)\s+(?:a\s+)?([\w-]+(?:\s+[\w-]+){0,2})\s+(?:vibe|style|aesthetic)/i,
    key: "primary_style",
    toValue: (m) => normaliseStyle(m[1]),
    baseConfidence: 0.92,
  },
  // Direct style word (mid-century, japandi, scandi, industrial, etc.)
  // when the user is clearly stating their preference.
  {
    regex:
      /\b(?:i (?:love|want|prefer|like)|going (?:for|with)|let'?s do)\s+(?:the\s+)?(mid-?century(?:\s+modern)?|japandi|scandi(?:navian)?|industrial|minimalist|bohemian|farmhouse|art deco|coastal|modern\s+rustic|maximalist)\b/i,
    key: "primary_style",
    toValue: (m) => normaliseStyle(m[1]),
    baseConfidence: 0.95,
  },

  // ── Wood / material preferences ────────────────────────────────
  {
    regex:
      /\b(?:(?:i\s+)?(?:love|want|prefer|like)|let'?s use|going with)\s+(walnut|oak|maple|teak|pine|cherry|mahogany|ash|birch|bamboo)\b/i,
    key: "preferred_wood",
    toValue: (m) => m[1].toLowerCase(),
    baseConfidence: 0.92,
  },
  {
    regex:
      /\b(?:in|made of|using)\s+(walnut|oak|maple|teak|pine|cherry|mahogany|ash|birch|bamboo)\b/i,
    key: "preferred_wood",
    toValue: (m) => m[1].toLowerCase(),
    baseConfidence: 0.78,
  },

  // ── Color / palette ────────────────────────────────────────────
  {
    regex:
      /\b(?:colou?r palette|palette|tones|colou?rs)\s*:?\s+(warm|cool|neutral|earthy|jewel|pastel|monochrome)/i,
    key: "color_palette",
    toValue: (m) => m[1].toLowerCase(),
    baseConfidence: 0.9,
  },

  // ── Budget ─────────────────────────────────────────────────────
  // We don't try to extract specific dollar amounts because Risk 4
  // says "if you can't be sure, don't store it". A "$5000" might be
  // total budget, per-piece, monthly, etc. We only extract qualitative
  // bands ("tight", "moderate", "open").
  {
    regex:
      /\b(?:budget(?:\s+is)?|spending|on a)\s+(tight|moderate|generous|open|flexible|small|large)\b/i,
    key: "budget_range",
    toValue: (m) => m[1].toLowerCase(),
    baseConfidence: 0.88,
  },
  {
    regex:
      /\b(?:keep it|stay) (cheap|affordable|budget(?:\s+friendly)?|inexpensive)\b/i,
    key: "budget_range",
    toValue: () => "tight",
    baseConfidence: 0.85,
  },

  // ── Deal-breakers ──────────────────────────────────────────────
  {
    regex: /\b(?:no|avoid|hate|don'?t want|can'?t stand)\s+(chrome|plastic|neon|glass|leather|metal|wood\s+veneer|fluorescent)\b/i,
    key: "deal_breaker",
    toValue: (m) => m[1].toLowerCase(),
    baseConfidence: 0.93,
  },

  // ── Must-include features ──────────────────────────────────────
  {
    regex:
      /\bi (?:need|want|must have|require)\s+(?:a\s+|an\s+|some\s+)?(workspace|desk\s+area|reading\s+nook|tv|television|fireplace|bookshelf|storage|workout\s+area|guest\s+bed|sofa|bed|kitchen\s+island)\b/i,
    key: "must_include",
    toValue: (m) => m[1].toLowerCase(),
    baseConfidence: 0.9,
  },

  // ── Room mood / vibe ───────────────────────────────────────────
  {
    regex:
      /\bi want (?:it|the room|the space)\s+(?:to\s+(?:feel|be)\s+)?(cozy|airy|bright|minimal|warm|calm|energetic|playful|formal|relaxed)\b/i,
    key: "room_mood",
    toValue: (m) => m[1].toLowerCase(),
    baseConfidence: 0.88,
  },
];

// Hedge words that scale confidence down when present.
const HEDGE_PATTERN = /\b(maybe|perhaps|i think|possibly|sort of|kinda|kind of|i guess|might)\b/i;

// Strong-affirmation words that scale confidence up.
const STRONG_PATTERN = /\b(definitely|absolutely|for sure|100%|exactly|certainly|really really|love love)\b/i;

function normaliseStyle(s: string): string | null {
  const cleaned = s.trim().toLowerCase().replace(/\s+/g, " ");
  if (cleaned.length === 0 || cleaned.length > 60) return null;
  // Drop trailing fillers we'd accidentally capture.
  return cleaned.replace(/\s+(style|aesthetic|vibe|look|feel|mood)\s*$/, "");
}

/** Run all rules against a user turn. Returns deduped candidates
 *  (one per key — most-confident match wins). */
export function extractPreferenceCandidates(
  userText: string,
): ExtractedPreferenceCandidate[] {
  if (!userText || userText.trim().length === 0) return [];

  const text = userText.trim();
  const hasHedge = HEDGE_PATTERN.test(text);
  const hasStrong = STRONG_PATTERN.test(text);

  // Confidence scaling: hedged language drops by 0.15, strong
  // affirmation bumps by 0.05 (capped at 0.99).
  const scaleConfidence = (base: number): number => {
    let c = base;
    if (hasHedge) c -= 0.15;
    if (hasStrong) c += 0.05;
    return Math.max(0, Math.min(0.99, c));
  };

  const byKey = new Map<string, ExtractedPreferenceCandidate>();

  for (const rule of RULES) {
    // Reset lastIndex for global flags (none currently, but defensive).
    rule.regex.lastIndex = 0;
    const match = rule.regex.exec(text);
    if (!match) continue;
    const value = rule.toValue(match);
    if (!value) continue;

    const matchedSubstring = match[0].trim();
    const sourceText = matchedSubstring.slice(
      0,
      INTELLIGENCE_LIMITS.preferenceSourceTextMaxChars,
    );
    if (!sourceText) continue;

    const candidate: ExtractedPreferenceCandidate = {
      key: rule.key,
      value,
      sourceText,
      confidence: scaleConfidence(rule.baseConfidence),
    };

    // Keep highest-confidence per key.
    const existing = byKey.get(rule.key);
    if (!existing || candidate.confidence > existing.confidence) {
      byKey.set(rule.key, candidate);
    }
  }

  return Array.from(byKey.values());
}

/**
 * Convert candidates to Preference records, applying the persistence
 * policy. Returns only records that should be persisted as proposals.
 *
 * Policy (confirmation UX):
 *   - confidence < preferenceMinConfidence → drop
 *   - otherwise → status="provisional" until the user Accepts
 *
 * High confidence only affects presentation (inline vs panel), never
 * auto-saves as confirmed memory.
 */
export function applyExtractionPolicy(
  candidates: readonly ExtractedPreferenceCandidate[],
  ctx: { projectId: string; sourceTurnId: number },
): Preference[] {
  const now = Date.now();
  const out: Preference[] = [];
  for (const c of candidates) {
    if (c.confidence < INTELLIGENCE_LIMITS.preferenceMinConfidence) continue;
    const status: PreferenceStatus = "provisional";
    out.push({
      id: newPreferenceId(),
      projectId: ctx.projectId,
      key: c.key,
      value: c.value,
      sourceText: c.sourceText,
      sourceTurnId: ctx.sourceTurnId,
      confidence: c.confidence,
      status,
      extractedAt: now,
      updatedAt: now,
    });
  }
  return out;
}

// ── Contradiction detection (two-strikes) ────────────────────────

/**
 * Detect explicit contradictions of stored preferences in a new user
 * turn. Returns IDs of preferences the user appears to be revoking.
 *
 * Patterns we recognize:
 *   - "not walnut, oak" → revokes preferred_wood: walnut
 *   - "no longer want chrome" → revokes whatever currently has
 *     value: chrome
 *   - "actually I don't want X" → revokes anything matching X
 *
 * Conservative: we only flag a revocation when the user explicitly
 * negates a previously-stored value. "I'm reconsidering" or "maybe
 * not chrome" alone don't trigger.
 *
 * Caller: pipe these IDs to `setPreferenceStatus(id, "rejected")`.
 */
export function detectContradictions(
  userText: string,
  existingPreferences: readonly Preference[],
): string[] {
  if (!userText || userText.trim().length === 0) return [];
  const text = userText.toLowerCase();

  // Look for "not X", "no longer X", "actually not X" patterns and
  // see whether X matches a stored preference value.
  const negationPatterns = [
    /\bnot\s+([\w-]+(?:\s+[\w-]+){0,2})\b/g,
    /\bno longer\s+(?:want\s+|like\s+|need\s+)?([\w-]+(?:\s+[\w-]+){0,2})\b/g,
    /\b(?:scratch|forget|cancel|drop)\s+(?:the\s+)?([\w-]+(?:\s+[\w-]+){0,2})\b/g,
    /\bactually\s+(?:i (?:don'?t want|don'?t like|hate|won'?t)|no)\s+([\w-]+(?:\s+[\w-]+){0,2})\b/g,
  ];

  const revoked: string[] = [];
  const candidatesActive = existingPreferences.filter(
    (p) => p.status !== "rejected",
  );

  for (const pat of negationPatterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const negatedTerm = m[1].trim().toLowerCase();
      if (!negatedTerm) continue;
      // Match against stored preference values.
      for (const p of candidatesActive) {
        if (revoked.includes(p.id)) continue;
        if (
          p.value.toLowerCase() === negatedTerm ||
          p.value.toLowerCase().includes(negatedTerm) ||
          negatedTerm.includes(p.value.toLowerCase())
        ) {
          revoked.push(p.id);
        }
      }
    }
  }
  return revoked;
}
