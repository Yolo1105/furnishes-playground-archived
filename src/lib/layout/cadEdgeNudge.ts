import type { CardId, CardPosition } from "@studio/store/card-positions-slice";

/**
 * When the main viewport flips to CAD (rulers on the top + left
 * edges, status along the bottom), floating cards that sit flush
 * against a screen edge nudge a little inward so the rulers peek
 * through. Cards already clear of the edges stay put.
 *
 * Stacked neighbors (Reference above Generations, Tools above
 * Inventory) used to collide when one got an extra axis nudge
 * (e.g. top-right moves down+left while mid-right only moves left).
 * After the edge nudge we run a short separation pass so gaps are
 * preserved; those secondary moves are stored in the same backup so
 * revert on flip-back still works.
 *
 * On flip back to 3D, only cards that still sit at the auto-nudged
 * spot revert — if the user dragged one in the meantime, that
 * position is kept.
 */

/** How close to a viewport edge counts as "covering the ruler". */
export const CAD_EDGE_NEAR_PX = 40;
/** Inward shift — just enough to reveal the ~26px CAD rulers. */
export const CAD_EDGE_NUDGE_PX = 28;
/** Minimum gap between cards after nudge + separation. */
const CARD_GAP_PX = 8;
const SEPARATE_ITERS = 16;

const KNOWN_CARD_IDS = new Set<CardId>([
  "project",
  "tools",
  "tool-reference",
  "tool-catalog",
  "tool-inventory",
  "tool-generations",
  "tool-chat-history",
  "tool-starred",
  "tool-properties",
  "tool-room-grid",
]);

export type CadEdgeNudgeEntry = {
  /** Store position before nudge; `null` = was CSS-default. */
  before: CardPosition | null;
  /** Position we wrote for the nudge. */
  after: CardPosition;
};

export type CadEdgeNudgeBackup = Partial<Record<CardId, CadEdgeNudgeEntry>>;

type LiveCard = {
  id: CardId;
  /** Store position before any auto-move (`null` = CSS default). */
  before: CardPosition | null;
  /** Screen position used as the nudge origin. */
  from: CardPosition;
  w: number;
  h: number;
  /** Edge-nudge intent (before collision resolve). */
  dx: number;
  dy: number;
  x: number;
  y: number;
  /** True if this card received a non-zero edge nudge. */
  edged: boolean;
};

function isCardId(id: string): id is CardId {
  return KNOWN_CARD_IDS.has(id as CardId);
}

function nearlySame(a: CardPosition, b: CardPosition, eps = 3): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

function clampPos(
  x: number,
  y: number,
  width: number,
  height: number,
  vw: number,
  vh: number,
): CardPosition {
  const maxX = Math.max(0, vw - width);
  const maxY = Math.max(0, vh - height);
  return {
    x: Math.max(0, Math.min(maxX, x)),
    y: Math.max(0, Math.min(maxY, y)),
  };
}

function overlapPad(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
  pad: number,
): { ox: number; oy: number } | null {
  const left = Math.max(a.left, b.left) - pad;
  const right = Math.min(a.right, b.right) + pad;
  const top = Math.max(a.top, b.top) - pad;
  const bottom = Math.min(a.bottom, b.bottom) + pad;
  const ox = right - left;
  const oy = bottom - top;
  if (ox <= 0 || oy <= 0) return null;
  return { ox, oy };
}

/**
 * Push overlapping cards apart. Prefer moving the card whose edge
 * nudge pointed toward the other (the "aggressor"), so a top-right
 * card that stepped down into a mid-right neighbor pushes that
 * neighbor further down instead of undoing the top-ruler clearance.
 */
function separateStackedCards(
  cards: LiveCard[],
  vw: number,
  vh: number,
): void {
  for (let iter = 0; iter < SEPARATE_ITERS; iter++) {
    let moved = false;

    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const A = cards[i]!;
        const B = cards[j]!;
        // Only resolve collisions involving at least one edge-nudged
        // card — don't reshuffle cards that were already fine in 3D.
        if (!A.edged && !B.edged) continue;

        const ar = {
          left: A.x,
          top: A.y,
          right: A.x + A.w,
          bottom: A.y + A.h,
        };
        const br = {
          left: B.x,
          top: B.y,
          right: B.x + B.w,
          bottom: B.y + B.h,
        };
        const hit = overlapPad(ar, br, CARD_GAP_PX);
        if (!hit) continue;

        const aCx = A.x + A.w / 2;
        const aCy = A.y + A.h / 2;
        const bCx = B.x + B.w / 2;
        const bCy = B.y + B.h / 2;
        const toBx = bCx - aCx;
        const toBy = bCy - aCy;
        // How much each card's edge nudge aimed at the other.
        const aToward = A.dx * toBx + A.dy * toBy;
        const bToward = B.dx * -toBx + B.dy * -toBy;

        if (hit.oy <= hit.ox) {
          // Separate vertically.
          const aAbove = aCy <= bCy;
          if (aToward > bToward + 1) {
            // A closed the gap → push B away from A.
            B.y += aAbove ? hit.oy : -hit.oy;
          } else if (bToward > aToward + 1) {
            A.y += aAbove ? -hit.oy : hit.oy;
          } else if (aAbove) {
            A.y -= hit.oy / 2;
            B.y += hit.oy / 2;
          } else {
            B.y -= hit.oy / 2;
            A.y += hit.oy / 2;
          }
        } else {
          // Separate horizontally.
          const aLeft = aCx <= bCx;
          if (aToward > bToward + 1) {
            B.x += aLeft ? hit.ox : -hit.ox;
          } else if (bToward > aToward + 1) {
            A.x += aLeft ? -hit.ox : hit.ox;
          } else if (aLeft) {
            A.x -= hit.ox / 2;
            B.x += hit.ox / 2;
          } else {
            B.x -= hit.ox / 2;
            A.x += hit.ox / 2;
          }
        }

        const aClamped = clampPos(A.x, A.y, A.w, A.h, vw, vh);
        A.x = aClamped.x;
        A.y = aClamped.y;
        const bClamped = clampPos(B.x, B.y, B.w, B.h, vw, vh);
        B.x = bClamped.x;
        B.y = bClamped.y;
        moved = true;
      }
    }

    if (!moved) break;
  }
}

/**
 * Compute per-card inward deltas from live DOM rects, then separate
 * any collisions the nudge would create.
 */
export function computeCadEdgeNudges(
  positions: Partial<Record<CardId, CardPosition>>,
): {
  nextPositions: Partial<Record<CardId, CardPosition>>;
  backup: CadEdgeNudgeBackup;
} {
  const nextPositions: Partial<Record<CardId, CardPosition>> = { ...positions };
  const backup: CadEdgeNudgeBackup = {};

  if (typeof document === "undefined" || typeof window === "undefined") {
    return { nextPositions, backup };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const nodes = document.querySelectorAll<HTMLElement>("[data-card-id]");
  const cards: LiveCard[] = [];

  nodes.forEach((el) => {
    const rawId = el.dataset.cardId;
    if (!rawId || !isCardId(rawId)) return;

    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;

    let dx = 0;
    let dy = 0;
    const nearLeft = rect.left < CAD_EDGE_NEAR_PX;
    const nearRight = rect.right > vw - CAD_EDGE_NEAR_PX;
    const nearTop = rect.top < CAD_EDGE_NEAR_PX;
    const nearBottom = rect.bottom > vh - CAD_EDGE_NEAR_PX;

    if (nearLeft) dx += CAD_EDGE_NUDGE_PX;
    if (nearRight) dx -= CAD_EDGE_NUDGE_PX;
    if (nearTop) dy += CAD_EDGE_NUDGE_PX;
    if (nearBottom) dy -= CAD_EDGE_NUDGE_PX;

    // Other right-rail tabs only slide left (avoids stacking chaos).
    if (nearRight && rawId !== "tool-reference") dy = 0;
    // Reference is top-right: always clear both left ruler and top CAD
    // chrome (even when its top sits just below the near-top threshold).
    if (rawId === "tool-reference" && nearRight) {
      dy = Math.max(dy, CAD_EDGE_NUDGE_PX);
    }

    const before = positions[rawId] ?? null;
    const from = {
      x: before?.x ?? rect.left,
      y: before?.y ?? rect.top,
    };
    const edged = dx !== 0 || dy !== 0;
    const placed = edged
      ? clampPos(from.x + dx, from.y + dy, rect.width, rect.height, vw, vh)
      : { x: from.x, y: from.y };

    cards.push({
      id: rawId,
      before,
      from,
      w: rect.width,
      h: rect.height,
      dx,
      dy,
      x: placed.x,
      y: placed.y,
      edged,
    });
  });

  if (cards.length === 0) return { nextPositions, backup };

  // Include non-edged cards in separation so a nudged neighbor can
  // push them slightly instead of overlapping them.
  separateStackedCards(cards, vw, vh);

  for (const card of cards) {
    const after = clampPos(card.x, card.y, card.w, card.h, vw, vh);
    if (nearlySame(card.from, after)) continue;

    backup[card.id] = { before: card.before, after };
    nextPositions[card.id] = after;
  }

  return { nextPositions, backup };
}

/**
 * Apply (or extend) CAD edge nudges for the current 2D session.
 *
 * First call in a CAD session: nudge every edge-hugging card and
 * start a backup.
 * Later calls (e.g. a Tools tab opened while already in grid mode):
 * only nudge cards that aren't already tracked — so newly opened
 * tabs land at the CAD inset, not their 3D flush-edge spot.
 *
 * Cards already in the backup that the user dragged stay put.
 * Cards that reopened at their pre-nudge position get re-nudged.
 */
export function mergeCadEdgeNudgeSession(
  positions: Partial<Record<CardId, CardPosition>>,
  existingBackup: CadEdgeNudgeBackup | null,
): {
  nextPositions: Partial<Record<CardId, CardPosition>>;
  backup: CadEdgeNudgeBackup;
  changed: boolean;
} {
  const { nextPositions: computed, backup: fresh } =
    computeCadEdgeNudges(positions);

  // First CAD-session pass — even if nothing moved, mark the session
  // so later opens can extend incrementally.
  if (existingBackup == null) {
    return {
      nextPositions: computed,
      backup: fresh,
      changed: true,
    };
  }

  const mergedBackup: CadEdgeNudgeBackup = { ...existingBackup };
  const mergedPos: Partial<Record<CardId, CardPosition>> = { ...positions };
  let changed = false;

  for (const [id, entry] of Object.entries(fresh) as [
    CardId,
    CadEdgeNudgeEntry,
  ][]) {
    const prior = existingBackup[id];
    if (prior) {
      const cur = positions[id];
      // Still sitting at the previous auto-nudge — leave alone.
      if (cur && nearlySame(cur, prior.after)) continue;
      // Back at the pre-nudge / freshly placed edge spot — re-apply.
      const atBefore =
        (prior.before != null && cur != null && nearlySame(cur, prior.before)) ||
        (entry.before != null && cur != null && nearlySame(cur, entry.before));
      if (atBefore || cur == null) {
        mergedBackup[id] = entry;
        mergedPos[id] = entry.after;
        changed = true;
      }
      // Else user-dragged — keep current, keep prior backup entry so
      // revert won't yank a custom position on flip-back.
      continue;
    }

    mergedBackup[id] = entry;
    mergedPos[id] = entry.after;
    changed = true;
  }

  return { nextPositions: mergedPos, backup: mergedBackup, changed };
}

/**
 * Restore pre-nudge positions only where the card still sits at the
 * auto-nudged spot (user hasn't dragged it since).
 */
export function resolveCadEdgeNudgeRevert(
  positions: Partial<Record<CardId, CardPosition>>,
  backup: CadEdgeNudgeBackup | null | undefined,
): Partial<Record<CardId, CardPosition>> {
  if (!backup || Object.keys(backup).length === 0) return positions;

  const next: Partial<Record<CardId, CardPosition>> = { ...positions };

  for (const [id, entry] of Object.entries(backup) as [
    CardId,
    CadEdgeNudgeEntry,
  ][]) {
    if (!entry) continue;
    const current = next[id];
    // Still at the nudged spot (or never got a store write) → revert.
    const stillNudged =
      current == null ? true : nearlySame(current, entry.after);

    if (!stillNudged) {
      // User moved it — keep current, drop backup entry only.
      continue;
    }

    if (entry.before == null) {
      delete next[id];
    } else {
      next[id] = entry.before;
    }
  }

  return next;
}
