/**
 * Chat preference UI contracts — five visible categories that map
 * extractor keys into the Eva panel blocks.
 */

export type ChatPreferenceCategory =
  | "room"
  | "budget"
  | "style"
  | "color"
  | "furniture";

export type PreferenceConfidenceLabel = "high" | "medium" | "low";

export const CHAT_PREFERENCE_CATEGORIES: {
  id: ChatPreferenceCategory;
  label: string;
  index: string;
}[] = [
  { id: "room", label: "Room Type", index: "01" },
  { id: "budget", label: "Budget Range", index: "02" },
  { id: "style", label: "Design Style", index: "03" },
  { id: "color", label: "Color Preferences", index: "04" },
  { id: "furniture", label: "Furniture Needs", index: "05" },
];

const KEY_TO_CATEGORY: Record<string, ChatPreferenceCategory> = {
  primary_style: "style",
  preferred_wood: "style",
  preferred_material: "style",
  budget_range: "budget",
  room_type: "room",
  color_preference: "color",
  preferred_color: "color",
  must_include: "furniture",
  deal_breaker: "furniture",
  furniture_need: "furniture",
};

const COLOR_VALUE_HINT =
  /\b(grey|gray|beige|cream|white|black|blue|green|terracotta|warm|cool|neutral|palette|tone)\b/i;

/** Map a free-form extractor key (+ optional value) into a panel category. */
export function preferenceKeyToCategory(
  key: string,
  value?: string,
): ChatPreferenceCategory {
  const mapped = KEY_TO_CATEGORY[key];
  if (mapped) {
    if (
      key === "deal_breaker" &&
      value &&
      COLOR_VALUE_HINT.test(value)
    ) {
      return "color";
    }
    return mapped;
  }
  if (/color|palette|tone|hue/i.test(key)) return "color";
  if (/budget|price|cost|spend/i.test(key)) return "budget";
  if (/room|office|bedroom|living|kitchen/i.test(key)) return "room";
  if (/furniture|storage|sofa|desk|chair|table/i.test(key)) return "furniture";
  if (/style|wood|material|aesthetic|vibe/i.test(key)) return "style";
  return "style";
}

export function categoryLabel(category: ChatPreferenceCategory): string {
  return (
    CHAT_PREFERENCE_CATEGORIES.find((c) => c.id === category)?.label ??
    category
  );
}

/** Convert numeric confidence to the UI labels from the design doc. */
export function confidenceToLabel(
  confidence: number,
): PreferenceConfidenceLabel {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.75) return "medium";
  return "low";
}

export function confidenceLabelText(
  label: PreferenceConfidenceLabel,
): string {
  switch (label) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
  }
}
