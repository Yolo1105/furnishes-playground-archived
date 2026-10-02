/**
 * Demo response bank. Until the real `/api/chat` endpoint is wired up in
 * a later step, the chat returns canned interior-design copy chosen by
 * keyword. First-match-wins, walked top-to-bottom.
 *
 * The copy here is the JSX's signature voice (warm-neutral, specific,
 * concrete material/finish suggestions) and exists primarily so the UI
 * can be exercised end-to-end without a backend.
 */

interface ResponseRule {
  /** Lowercase substrings — any one of them matches the user's text. */
  keywords: string[];
  response: string;
}

const RULES: ResponseRule[] = [
  {
    keywords: ["bedroom", "bed"],
    response:
      "For a calming bedroom, I'd layer warm neutrals — oatmeal linen bedding, a muted terracotta throw, and a pale oak headboard. Add a low-pile cream rug that extends past the bed on three sides, and place a matte brass pendant slightly off-center above one nightstand for soft asymmetry. Close the palette with a single sage-green plant in a fluted ceramic pot.",
  },
  {
    keywords: ["kitchen"],
    response:
      "Think quiet luxury: shaker cabinets in a warm greige, unlacquered brass pulls, and honed quartzite counters with a soft vein. Open shelving in rift-sawn oak on one wall, limewash paint above the backsplash, and a cast-iron sink to anchor the working zone. Pendants should be ceramic — organic forms, not too sleek.",
  },
  {
    keywords: ["living room", "living", "sofa"],
    response:
      "Start with a deep-seated boucle sofa in bone white — keep the shape low and relaxed. Layer a vintage Moroccan rug with warm rust and ivory tones underneath. A sculptural travertine coffee table grounds the center. Two matching reading chairs in caramel leather opposite the sofa. Finish with a single oversized ceramic vase and a linen floor lamp with a warm bulb.",
  },
  {
    keywords: ["small", "tight", "compact"],
    response:
      "Maximize perceived space with a tight tonal palette — everything in the same family, two shades apart. Use wall-hung furniture to free the floor visually, a single oversized mirror leaning on one wall, and sheer linen curtains hung floor-to-ceiling (ignore the actual window height). Pick one statement piece; let everything else recede.",
  },
  {
    keywords: ["palette", "color"],
    response:
      "I'm thinking a warm earth palette: bone white base (walls + trim), warm taupe mid-tones (upholstery + curtains), burnt sienna accent (pillows + art), and a grounding deep walnut (wood pieces + frames). Add 5% of a soft sage green through plants to prevent it from feeling too dry. Avoid pure whites and cool grays — they'll clash with the warmth.",
  },
  {
    keywords: ["mood", "vibe", "feel"],
    response:
      "Let's aim for \"quiet sunday morning\" — slow, warm, lived-in. That means matte finishes over glossy, natural fibers over synthetics, and lighting that's always warm (2700K max). Mix old and new: one antique piece per room, the rest contemporary but understated. A faint smell of cedar and linen would complete it, if interiors had scent.",
  },
  {
    keywords: ["light", "lamp"],
    response:
      "Layer three levels: ambient (a central fixture on a dimmer, always), task (pendant or sconce over working surfaces), and accent (a single warm floor lamp in the reading zone). Use 2700K bulbs everywhere. Avoid anything cooler than 3000K — it'll kill the warmth of your finishes. Put everything on dimmers.",
  },
  {
    keywords: ["floor", "rug"],
    response:
      "For the rug, I'd go with a natural wool in a warm oatmeal, flat-weave so it disappears underfoot. Size it generously — the front legs of your seating should sit ON the rug, not float beside it. Under a dining area, the rug should extend 24 inches past the table on all sides so chairs stay on it when pulled out.",
  },
];

const DEFAULT_RESPONSE =
  "Here's my first read on your space: I'd lean into warmth through layered neutrals — cream, oatmeal, sand, walnut. Keep the palette tight (3-4 tones, tops). Bring in texture through nubby linens, oak grain, and matte ceramics. Add one unexpected element — a terracotta accent wall or a vintage brass pendant — so the space has a voice, not just a vibe. Want me to sketch a floorplan or refine any of this?";

/** First-match-wins keyword lookup. Empty/undefined input returns the default. */
export function getDemoResponse(userText: string): string {
  const t = (userText || "").toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((k) => t.includes(k))) return rule.response;
  }
  return DEFAULT_RESPONSE;
}
