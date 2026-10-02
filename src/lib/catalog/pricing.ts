/**
 * Deterministic "fake" pricing for catalog + placed items. Same input
 * always returns the same price — based on a stable hash of the
 * item's identity plus a category-aware range derived from its
 * label.
 *
 * Ported 1:1 from the zip's `lib/catalog/pricing.ts`. The category
 * ranges are rough USD centers; the hash provides per-item jitter
 * so two "Coffee Tables" with different ids get different prices.
 *
 * Prices over $200 are rounded to the nearest $10 minus $1 for the
 * classic retail "$xx9" feel; smaller prices are rounded to the
 * nearest dollar.
 */

interface PriceableItem {
  id: string;
  label: string;
}

// Category-based price anchors (USD) — hashed input adds jitter.
const CATEGORY_RANGES: Array<[RegExp, number, number]> = [
  [/sofa|sectional|couch/i, 899, 2499],
  [/bed(?!side)|mattress/i, 649, 1899],
  [/wardrobe|closet|dresser/i, 549, 1499],
  [/dining.*table|kitchen.*island/i, 499, 1299],
  [/chair|stool|armchair/i, 149, 549],
  [/coffee.*table|side.*table|end.*table/i, 129, 449],
  [/rug|carpet/i, 199, 899],
  [/tv|television|monitor/i, 399, 1799],
  [/lamp|light|sconce/i, 59, 299],
  [/shower|toilet|bathtub|sink/i, 199, 899],
  [/mirror/i, 79, 299],
  [/shelf|bookcase|bookshelf/i, 149, 599],
  [/cup|glass|plate|bowl|teapot/i, 12, 59],
  [/knife|spoon|fork|utensil/i, 19, 79],
  [/plant|vegetation|pot/i, 29, 149],
  [/book|magazine/i, 12, 39],
  [/picture|painting|artwork|hqi/i, 79, 499],
  [/vase|statuette|decor/i, 39, 229],
  [/oven|microwave|freezer|cooktop/i, 449, 1499],
];
const DEFAULT_RANGE: [number, number] = [39, 249];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function getItemPrice(item: PriceableItem): number {
  const label = item.label || item.id || "";
  const match = CATEGORY_RANGES.find(([re]) => re.test(label));
  const [lo, hi] = match ? [match[1], match[2]] : DEFAULT_RANGE;
  const h = hashString(item.id + "|" + label);
  const t = (h % 10000) / 10000;
  const raw = lo + t * (hi - lo);
  return raw > 200 ? Math.round(raw / 10) * 10 - 1 : Math.round(raw);
}

export function formatPrice(price: number): string {
  return `$${price.toLocaleString("en-US")}`;
}
