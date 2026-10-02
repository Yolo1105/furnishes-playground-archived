import type {
  CardId,
  CardPosition,
} from "@studio/store/card-positions-slice";

export type CardRect = {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type PlaceResult = {
  x: number;
  y: number;
  /** True when no free slot fit — card will overlap and should be frontmost. */
  overlapped: boolean;
};

const MARGIN = 14;
const GAP = 8;
const FOOTER = 110;
const TOP_SAFE = 14;

/** Default footprint guesses used before the card has painted. */
export const CARD_PLACE_SIZE: Partial<
  Record<CardId, { width: number; height: number; prefer: "left" | "right" }>
> = {
  "tool-reference": { width: 420, height: 300, prefer: "right" },
  "tool-generations": { width: 280, height: 320, prefer: "right" },
  "tool-inventory": { width: 280, height: 220, prefer: "left" },
  "tool-catalog": { width: 600, height: 120, prefer: "left" },
  "tool-chat-history": { width: 280, height: 280, prefer: "left" },
  "tool-room-grid": { width: 268, height: 360, prefer: "left" },
  "tool-properties": { width: 240, height: 280, prefer: "right" },
};

const ANCHOR_CARD_IDS = new Set(["project", "tools"]);

function overlaps(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
  pad = GAP,
): boolean {
  return !(
    a.right + pad <= b.left ||
    a.left >= b.right + pad ||
    a.bottom + pad <= b.top ||
    a.top >= b.bottom + pad
  );
}

function bandsOverlapX(
  colX: number,
  colW: number,
  r: CardRect,
  pad = GAP,
): boolean {
  return !(colX + colW + pad <= r.left || colX >= r.right + pad);
}

/** Read current floating-card rects from the DOM (obstacles). */
export function readOccupiedCardRects(excludeId?: string): CardRect[] {
  if (typeof document === "undefined") return [];
  const nodes = document.querySelectorAll<HTMLElement>("[data-card-id]");
  const rects: CardRect[] = [];
  nodes.forEach((el) => {
    const id = el.dataset.cardId;
    if (!id || id === excludeId) return;
    if (id === "tool-starred") return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    rects.push({
      id,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
  });
  return rects;
}

/** Merge DOM obstacles with stored positions (for cards just placed
 *  this frame whose DOM may not have painted yet). */
export function mergeOccupiedWithStorePositions(
  excludeId: string,
  positions: Partial<Record<CardId, CardPosition>>,
): CardRect[] {
  const occupied = readOccupiedCardRects(excludeId);
  const seen = new Set(occupied.map((r) => r.id));

  for (const [id, pos] of Object.entries(positions) as [
    CardId,
    CardPosition | undefined,
  ][]) {
    if (!pos || id === excludeId || seen.has(id)) continue;
    const preset = CARD_PLACE_SIZE[id] ?? {
      width: 280,
      height: 260,
      prefer: "left" as const,
    };
    occupied.push({
      id,
      left: pos.x,
      top: pos.y,
      right: pos.x + preset.width,
      bottom: pos.y + preset.height,
      width: preset.width,
      height: preset.height,
    });
    seen.add(id);
  }
  return occupied;
}

function columnXs(
  cardW: number,
  prefer: "left" | "right",
  viewportW: number,
): number[] {
  const xs: number[] = [];
  if (prefer === "left") {
    let x = MARGIN;
    while (x + cardW <= viewportW - MARGIN) {
      xs.push(x);
      x += cardW + GAP;
    }
  } else {
    let x = viewportW - MARGIN - cardW;
    while (x >= MARGIN) {
      xs.push(x);
      x -= cardW + GAP;
    }
  }
  return xs;
}

function resolveYInColumn(
  colX: number,
  width: number,
  height: number,
  occupied: CardRect[],
  maxBottom: number,
): number | null {
  const inColumn = occupied
    .filter((r) => bandsOverlapX(colX, width, r))
    .sort((a, b) => a.top - b.top);

  let y = TOP_SAFE;

  for (const r of inColumn) {
    if (ANCHOR_CARD_IDS.has(r.id)) {
      y = Math.max(y, r.bottom + GAP);
    }
  }

  let guard = 0;
  while (guard++ < 32) {
    const candidate = {
      left: colX,
      top: y,
      right: colX + width,
      bottom: y + height,
    };
    let hit: CardRect | null = null;
    for (const r of inColumn) {
      if (ANCHOR_CARD_IDS.has(r.id)) continue;
      if (
        overlaps(candidate, {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        })
      ) {
        hit = r;
        break;
      }
    }
    if (!hit) {
      return candidate.bottom <= maxBottom ? y : null;
    }
    y = hit.bottom + GAP;
  }
  return null;
}

export function findCardSlot(
  _cardId: CardId,
  size: { width: number; height: number; prefer: "left" | "right" },
  occupied: CardRect[],
  viewport = {
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  },
): PlaceResult {
  const { width, height, prefer } = size;
  const maxBottom = viewport.height - FOOTER;

  for (const colX of columnXs(width, prefer, viewport.width)) {
    const y = resolveYInColumn(colX, width, height, occupied, maxBottom);
    if (y != null) {
      return { x: colX, y, overlapped: false };
    }
  }

  const fallbackX =
    prefer === "left"
      ? MARGIN
      : Math.max(MARGIN, viewport.width - MARGIN - width);
  return { x: fallbackX, y: TOP_SAFE + 62, overlapped: true };
}

export function placeFloatingCard(
  cardId: CardId,
  options?: {
    width?: number;
    height?: number;
    positions?: Partial<Record<CardId, CardPosition>>;
  },
): PlaceResult {
  const preset = CARD_PLACE_SIZE[cardId] ?? {
    width: 280,
    height: 260,
    prefer: "left" as const,
  };
  const size = {
    width: options?.width ?? preset.width,
    height: options?.height ?? preset.height,
    prefer: preset.prefer,
  };
  const occupied = mergeOccupiedWithStorePositions(
    cardId,
    options?.positions ?? {},
  );
  return findCardSlot(cardId, size, occupied);
}
