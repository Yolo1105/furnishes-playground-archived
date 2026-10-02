/**
 * Interior Design intent classifier.
 *
 * The user explicitly wanted Interior Design mode to BOTH chat AND
 * take action. The previous behavior routed every Interior Design
 * message through /api/chat (text-only) — even when the user said
 * "give me a sofa," they got a chatty advisory response instead of
 * an actual generated piece.
 *
 * v0.40.16 redesign: my first version (v0.40.15) was too restrictive.
 * It defaulted to "chat" and only generated when the user hit a
 * specific verb+noun pattern. Real users say things like "yes
 * generate everything" or "do the layout" or just "regenerate" —
 * none of which matched the v0.40.15 rules. The user reported the
 * AI "just keeps talking" instead of generating.
 *
 * The new approach inverts the default. In Interior Design mode the
 * user is HERE TO DESIGN — they want generation. Chat is the
 * exception, reserved for clear question phrasings:
 *
 *   • Starts with what / how / why / when / where / which / who
 *   • Starts with "should I" / "could you tell me" / "do you think"
 *   • Ends with a question mark AND has no generation verb
 *
 * Everything else is treated as a generation request, with a
 * sub-decision between room vs furniture based on what nouns
 * appear in the message:
 *
 *   • If a room noun is present → generate-room
 *   • If only furniture nouns are present → generate-furniture
 *   • If neither → generate-room (the studio is built around rooms;
 *     when the user is being vague in Interior Design mode they
 *     probably want a layout, not a single piece)
 *
 * The classifier is rule-based — no extra Claude call per turn —
 * and the rules above cover the common cases the user actually
 * sends. Edge cases drift toward generation, which is the whole
 * point of Interior Design mode.
 */

const ROOM_NOUNS = [
  "room",
  "layout",
  "space",
  "studio",
  "office",
  "bedroom",
  "living room",
  "dining room",
  "kitchen",
  "bathroom",
  "loft",
  "apartment",
  "den",
  "nursery",
  "guest room",
  "home office",
  "library",
  "scene",
  "interior",
];

const FURNITURE_NOUNS = [
  "sofa",
  "couch",
  "armchair",
  "chair",
  "stool",
  "ottoman",
  "bench",
  "bed",
  "headboard",
  "nightstand",
  "table",
  "coffee table",
  "dining table",
  "side table",
  "console",
  "desk",
  "bookshelf",
  "shelf",
  "bookcase",
  "dresser",
  "wardrobe",
  "cabinet",
  "credenza",
  "lamp",
  "floor lamp",
  "table lamp",
  "pendant",
  "sconce",
  "rug",
  "carpet",
  "mirror",
  "art",
  "painting",
  "vase",
  "plant",
  "planter",
  "tv",
  "media console",
  "buffet",
  "sideboard",
];

/** Phrases that explicitly mark a message as a question — when these
 *  appear AND there's no generation verb, route to chat. The list
 *  errs toward conservative: only obvious question starters. A
 *  message that ends with "?" but contains a generation verb still
 *  generates (e.g., "should I add a sofa?" → generate-furniture).
 */
const QUESTION_STARTERS = [
  "what",
  "how",
  "why",
  "when",
  "where",
  "which",
  "who",
  "is it",
  "are these",
  "are they",
  "are those",
  "do you think",
  "what do you think",
  "would you say",
  "could you tell me",
  "tell me about",
  "explain",
  "describe",
];

/** Verbs that strongly signal "take action now" — when any of these
 *  appear, generate regardless of question form. */
const GENERATION_VERBS = [
  "give me",
  "add",
  "place",
  "put",
  "create",
  "make",
  "design",
  "lay out",
  "build",
  "swap",
  "replace",
  "change",
  "show me",
  "i want",
  "i need",
  "generate",
  "regenerate",
  "produce",
  "render",
  "go ahead",
  "do it",
  "do this",
  "let's",
];

/** Short affirmative replies that mean "yes, do the thing you proposed."
 *  Match anywhere in the (trimmed, lowercased) message. */
const CONFIRMATION_PATTERNS = [
  /^yes\b/,
  /^yeah\b/,
  /^yep\b/,
  /^sure\b/,
  /^ok\b/,
  /^okay\b/,
  /^go\b/,
  /^do it\b/,
  /\bgo ahead\b/,
];

export type InteriorDesignIntent =
  | { kind: "generate-room"; reason: string }
  | { kind: "generate-furniture"; reason: string }
  | { kind: "chat"; reason: string };

/** Classify the user's Interior Design message into a dispatch bucket.
 *  Inputs: the raw user text. Output: a tagged intent object with a
 *  short `reason` for telemetry / debug. */
export function classifyInteriorDesignIntent(
  userText: string,
): InteriorDesignIntent {
  const text = userText.toLowerCase().trim();
  if (!text) return { kind: "chat", reason: "empty" };

  const hasGenerationVerb = GENERATION_VERBS.some((v) => text.includes(v));
  const hasConfirmation = CONFIRMATION_PATTERNS.some((re) => re.test(text));
  const hasRoomNoun = ROOM_NOUNS.some((n) =>
    new RegExp(`\\b${n.replace(/\s+/g, "\\s+")}\\b`).test(text),
  );
  const hasFurnitureNoun = FURNITURE_NOUNS.some((n) =>
    new RegExp(`\\b${n.replace(/\s+/g, "\\s+")}\\b`).test(text),
  );

  // Question detection: the message clearly asks something AND has
  // no generation verb (so "should I add a sofa" still generates).
  const startsWithQuestionStarter = QUESTION_STARTERS.some((q) => {
    // Word-boundary start to avoid false matches like "whatever" → "what"
    return new RegExp(`^${q}\\b`).test(text);
  });
  const endsWithQuestionMark = /\?\s*$/.test(text);
  const isClearQuestion =
    (startsWithQuestionStarter || endsWithQuestionMark) &&
    !hasGenerationVerb &&
    !hasConfirmation;

  if (isClearQuestion) {
    return { kind: "chat", reason: "question form, no generation verb" };
  }

  // From here on we're generating. Decide room vs furniture by noun.

  // Confirmation-only messages ("yes do it", "go ahead") inherit the
  // last action context. Without history visibility we can't know if
  // the assistant just proposed a furniture swap or a room layout —
  // default to generate-room because the user explicitly asked for
  // Interior Design mode to be able to GENERATE A ROOM (the major
  // failing case in their report). Single-piece swaps work fine in
  // Furniture mode.
  if (hasConfirmation && !hasFurnitureNoun && !hasRoomNoun) {
    return { kind: "generate-room", reason: "confirmation in design context" };
  }

  if (hasRoomNoun) {
    return { kind: "generate-room", reason: "room noun present" };
  }
  if (hasFurnitureNoun) {
    return { kind: "generate-furniture", reason: "furniture noun present" };
  }

  // No nouns, no question — vague generative request like "do the
  // wabi-sabi thing" or "make it Japanese". In Interior Design mode
  // these mean "design the room with this style," so generate-room.
  return { kind: "generate-room", reason: "Interior Design default → room" };
}
