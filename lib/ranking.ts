/**
 * Pairwise ranking → display scores. Rank position within a subcategory is primary;
 * vibe nudges and floors shape the final number. Pairwise conflicts soften (not
 * remove) vibe floors on higher-vibe items ranked below a lower-vibe peer.
 */

import { subcategoryForRow } from '../constants/categories';

export type Vibe = 'liked' | 'fine' | 'meh';

/** Default score when an item is the only row in its category — reflects vibe, not rank #1. */
export const SINGLETON_RATING_BY_VIBE: Record<Vibe, number> = {
  liked: 9.0,
  fine: 6.0,
  meh: 3.0,
};

/** Hard maximum score per vibe — applied last; rank cannot push past these. */
export const VIBE_CEILING: Record<Vibe, number> = {
  liked: 10.0,
  fine: 7.5,
  meh: 4.0,
};

/** When adjacent liked rows share the same small-list floor, boost the higher-ranked one. */
const LIKED_ADJACENT_FLOOR_BOOST = 0.3;

function singletonRatingForRow<T extends { vibe: Vibe }>(row: T): number {
  return clampBaggedScore(SINGLETON_RATING_BY_VIBE[normalizeVibe(row.vibe)]);
}

/** Soft vibe nudge applied before rank-order gap seating. */
export const VIBE_NUDGE: Record<Vibe, number> = { liked: 0.25, fine: 0, meh: -0.35 };

/** Rule 1 — standard vibe floors (n ≥ SMALL_LIST_SCORE_THRESHOLD). */
export const VIBE_FLOOR_STANDARD: Record<Vibe, number> = { liked: 6.0, fine: 3.0, meh: 0.5 };

/** Below this count per category, Rule 3 stricter floors replace Rule 1. */
export const SMALL_LIST_SCORE_THRESHOLD = 10;

/** Rule 3 — small-list vibe floors (n < SMALL_LIST_SCORE_THRESHOLD). */
export const VIBE_FLOOR_SMALL_LIST: Record<Vibe, number> = { liked: 7.0, fine: 4.0, meh: 0.5 };

/** Rule 2 — softer floors when a lower-vibe item is ranked above this row. */
export const VIBE_FLOOR_PAIRWISE_CONFLICT: Record<Vibe, number> = {
  liked: 6.0,
  fine: 2.0,
  meh: 0.5,
};

/** @deprecated Legacy band scoring — retained for reference only. */
export const MEH_RATING_CEILING = 4.7;
/** @deprecated Legacy band scoring — retained for reference only. */
export const LIKED_RATING_FLOOR = 8;
/** @deprecated Legacy band scoring — retained for reference only. */
export const FINE_RATING_FLOOR = 0;
/** @deprecated Legacy band scoring — retained for reference only. */
export const FINE_RATING_CEILING = 7.7;
/** Minimum gap between adjacent ranks after vibe adjustments (keeps order vs scores monotonic). */
export const RATING_RANK_GAP = 0.08;

/** Bagged scores live on 0–10; clamp legacy or bad DB values before display. */
export function clampBaggedScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return parseFloat(Math.max(0, Math.min(10, score)).toFixed(1));
}

/** True when a numeric score should render (includes 0.0). Null/undefined are not scores. */
export function isDisplayableBaggedScore(rating: unknown): rating is number {
  if (rating == null || rating === '') return false;
  const n = Number(rating);
  return Number.isFinite(n) && n >= 0 && n <= 10;
}

export const CATEGORIES = [
  'Snacks',
  'Dairy',
  'Dairy Alt',
  'Meat & Seafood',
  'Spices',
  'Condiments',
  'Produce',
  'Frozen',
  'Beverages',
  'Alcohol',
  'Protein/Supplements',
] as const;

export type Category = (typeof CATEGORIES)[number];

export function normalizeVibe(v: unknown): Vibe {
  if (v === 'liked' || v === 'fine' || v === 'meh') return v;
  return 'fine';
}

export type RankedRow<T = unknown> = T & {
  category: Category | string;
  vibe: Vibe;
  rating?: number;
  /**
   * When true, this row is in a tie group with the row immediately above it
   * in its category list. Tied rows always end up with the same rating; the
   * gap-propagation passes treat the group as one slot.
   */
  tiedAbove?: boolean;
};

/** A row is tied with its predecessor when `tiedAbove` is true and it isn't first. */
function isTiedWithPrev(list: { tiedAbove?: boolean; tied_above?: boolean | null }[], i: number): boolean {
  return i > 0 && Boolean(list[i]?.tiedAbove || list[i]?.tied_above);
}

function effectiveRanksForList<T extends { tiedAbove?: boolean; tied_above?: boolean | null }>(
  list: T[]
): number[] {
  const n = list.length;
  const effectiveRank = new Array<number>(n);
  let leaderIdx = 0;
  for (let i = 0; i < n; i++) {
    if (isTiedWithPrev(list, i)) effectiveRank[i] = leaderIdx;
    else {
      leaderIdx = i;
      effectiveRank[i] = i;
    }
  }
  return effectiveRank;
}

export function rankPositionSortValue(rank_position: number | null | undefined): number {
  if (rank_position == null) return 999;
  const n = Number(rank_position);
  return Number.isFinite(n) ? n : 999;
}

export function sortRowsByRankPosition<T extends { rank_position?: number | null }>(
  rows: T[]
): T[] {
  return [...rows].sort(
    (a, b) => rankPositionSortValue(a.rank_position) - rankPositionSortValue(b.rank_position)
  );
}

/** Upward gap pass — tied followers must not pull their leader's score up. */
function propagateScoresUpward(x: number[], tied: boolean[], n: number): void {
  for (let i = n - 2; i >= 0; i--) {
    if (tied[i + 1]) continue;
    x[i] = Math.max(x[i], x[i + 1] + RATING_RANK_GAP);
  }
}

function seatMonotonicScores(x: number[], tied: boolean[], n: number): void {
  const pinTies = () => {
    for (let i = 1; i < n; i++) {
      if (tied[i]) x[i] = x[i - 1];
    }
  };
  for (let rep = 0; rep < 2; rep++) {
    pinTies();
    propagateScoresUpward(x, tied, n);
    pinTies();
    for (let i = 1; i < n; i++) {
      if (tied[i]) x[i] = x[i - 1];
      else x[i] = Math.min(x[i], x[i - 1] - RATING_RANK_GAP);
    }
  }
  pinTies();
}

function vibeTier(vibe: Vibe): number {
  switch (normalizeVibe(vibe)) {
    case 'liked':
      return 2;
    case 'fine':
      return 1;
    default:
      return 0;
  }
}

/** Rule 2 — any lower-vibe item ranked above triggers a softer vibe floor. */
function hasPairwiseVibeConflict<T extends { vibe: Vibe }>(list: T[], index: number): boolean {
  const tier = vibeTier(list[index].vibe);
  for (let j = 0; j < index; j++) {
    if (vibeTier(list[j].vibe) < tier) return true;
  }
  return false;
}

function effectiveVibeFloorForRow<T extends { vibe: Vibe }>(
  list: T[],
  index: number,
  n: number
): number {
  const vibe = normalizeVibe(list[index].vibe);
  if (hasPairwiseVibeConflict(list, index)) {
    return VIBE_FLOOR_PAIRWISE_CONFLICT[vibe] ?? 0;
  }
  const table =
    n < SMALL_LIST_SCORE_THRESHOLD ? VIBE_FLOOR_SMALL_LIST : VIBE_FLOOR_STANDARD;
  return table[vibe] ?? 0;
}

function applyVibeFloors<T extends { vibe: Vibe }>(
  x: number[],
  list: T[],
  tied: boolean[],
  n: number
): void {
  for (let i = 0; i < n; i++) {
    const floor = effectiveVibeFloorForRow(list, i, n);
    if (floor > 0) x[i] = Math.max(x[i], floor);
  }
  seatMonotonicScores(x, tied, n);
  for (let i = 0; i < n; i++) {
    const floor = effectiveVibeFloorForRow(list, i, n);
    if (floor > 0 && x[i] < floor) {
      const capAbove = i > 0 ? x[i - 1] - RATING_RANK_GAP : 10;
      x[i] = Math.min(floor, capAbove);
    }
  }
  seatMonotonicScores(x, tied, n);
}

/** Boost higher-ranked liked peer when both adjacent liked rows sit on the same floor. */
function applyAdjacentLikedFloorBoost<T extends { vibe: Vibe }>(
  x: number[],
  list: T[],
  tied: boolean[],
  n: number
): void {
  for (let i = 0; i < n - 1; i++) {
    if (tied[i + 1]) continue;
    if (normalizeVibe(list[i].vibe) !== 'liked' || normalizeVibe(list[i + 1].vibe) !== 'liked') {
      continue;
    }
    const floor = effectiveVibeFloorForRow(list, i, n);
    const nextFloor = effectiveVibeFloorForRow(list, i + 1, n);
    if (floor <= 0 || floor !== nextFloor) continue;

    if (x[i] === x[i + 1] && x[i] === floor) {
      x[i] = clampBaggedScore(floor + LIKED_ADJACENT_FLOOR_BOOST);
      continue;
    }

    // Monotonicity can squeeze the lower liked row just under the shared floor — still boost.
    const higherOnFloor =
      x[i] >= floor - 0.05 && x[i] <= floor + RATING_RANK_GAP + 0.1;
    const lowerNearFloor =
      x[i + 1] <= floor + 0.05 && x[i + 1] >= floor - RATING_RANK_GAP - 0.01;
    if (higherOnFloor && lowerNearFloor) {
      x[i + 1] = floor;
      x[i] = clampBaggedScore(floor + LIKED_ADJACENT_FLOOR_BOOST);
    }
  }
}

/** Rank #1 (and any rows tied with it) receives the vibe ceiling for predictability. */
function applyRankOneVibeCeiling<T extends { vibe: Vibe }>(
  x: number[],
  list: T[],
  tied: boolean[]
): void {
  if (list.length === 0) return;
  const ceiling = VIBE_CEILING[normalizeVibe(list[0].vibe)];
  x[0] = ceiling;
  for (let i = 1; i < list.length; i++) {
    if (tied[i]) x[i] = x[0];
    else break;
  }
}

/** Final pass — cap every row by its vibe ceiling (cannot be exceeded). */
function applyVibeCeilings<T extends { vibe: Vibe }>(x: number[], list: T[]): void {
  for (let i = 0; i < list.length; i++) {
    const ceiling = VIBE_CEILING[normalizeVibe(list[i].vibe)];
    x[i] = Math.min(x[i], ceiling);
  }
}

/**
 * Linear baseline: best→10.0, worst→0.0 (singleton → vibe default).
 * Tied rows share their leader's effective rank slot.
 */
function computeScores<T extends { vibe: Vibe; tiedAbove?: boolean; tied_above?: boolean | null }>(
  list: T[]
): (T & { rating: number })[] {
  const n = list.length;
  if (n === 0) return [];
  if (n === 1) return [{ ...list[0], rating: singletonRatingForRow(list[0]) }];

  const effectiveRank = effectiveRanksForList(list);
  return list.map((item, i) => ({
    ...item,
    rating: parseFloat((10 - (effectiveRank[i] / (n - 1)) * 10).toFixed(1)),
  }));
}

/**
 * Dynamic scores from rank position + soft vibe nudge + vibe floors.
 * 1) Linear baseline (best→10, worst→0); tied rows share leader slot.
 * 2) Small vibe nudge (liked +0.25, fine 0, meh −0.35).
 * 3) Enforce rank monotonicity with min gap between non-tied neighbors.
 * 4) Per-row vibe floors (Rule 1 / Rule 3); Rule 2 softens floors on pairwise conflict.
 * 5) Adjacent liked rows sharing a floor → +0.3 for the higher-ranked one.
 * 6) Rank #1 (and top tie group) → vibe ceiling.
 * 7) Hard vibe ceilings on every row (final pass).
 */
function applyDynamicScores<T extends { vibe: Vibe; tiedAbove?: boolean; tied_above?: boolean | null }>(
  list: T[]
): (T & { rating: number })[] {
  const n = list.length;
  if (n === 0) return [];
  if (n === 1) return [{ ...list[0], rating: singletonRatingForRow(list[0]) }];

  const effectiveRank = effectiveRanksForList(list);
  const tied = list.map((_, i) => isTiedWithPrev(list, i));
  const x = list.map((row, i) => {
    const base = 10 - (effectiveRank[i] / (n - 1)) * 10;
    return base + (VIBE_NUDGE[normalizeVibe(row.vibe)] ?? 0);
  });

  seatMonotonicScores(x, tied, n);
  applyVibeFloors(x, list, tied, n);
  applyAdjacentLikedFloorBoost(x, list, tied, n);
  applyRankOneVibeCeiling(x, list, tied);
  applyVibeCeilings(x, list);

  return list.map((row, i) => ({
    ...row,
    rating: clampBaggedScore(x[i]),
  }));
}

/** @deprecated Use `applyDynamicScores` — alias kept for internal callers during transition. */
function applyVibeClampToScores<T extends { vibe: Vibe; tiedAbove?: boolean; tied_above?: boolean | null }>(
  list: T[]
): (T & { rating: number })[] {
  return applyDynamicScores(list);
}

export type TieAnchor = {
  leaderId: string | number;
  rating: number;
};

/** Maximal consecutive tie group containing `rowIdx` (leader first, `tiedAbove` followers after). */
function tieGroupIndicesForRow<T extends { tiedAbove?: boolean }>(
  scored: T[],
  rowIdx: number
): number[] {
  if (rowIdx < 0 || rowIdx >= scored.length) return [];
  let start = rowIdx;
  while (start > 0 && scored[start]?.tiedAbove) start -= 1;
  let end = rowIdx;
  while (end + 1 < scored.length && scored[end + 1]?.tiedAbove) end += 1;
  const indices: number[] = [];
  for (let i = start; i <= end; i++) indices.push(i);
  return indices;
}

/**
 * After rescoring a category with a new explicit tie, pin every row in the
 * tied group that contains the comparison peer to the anchor score.
 */
export function applyTieAnchorToScored<
  T extends { id: string | number; rating: number; tiedAbove?: boolean },
>(scored: T[], anchor: TieAnchor | null | undefined): T[] {
  if (!anchor || !Number.isFinite(anchor.rating)) return scored;
  const rowIdx = scored.findIndex((r) => String(r.id) === String(anchor.leaderId));
  if (rowIdx < 0) return scored;
  const anchorRating = parseFloat(Number(anchor.rating).toFixed(1));
  const group = new Set(tieGroupIndicesForRow(scored, rowIdx));
  return scored.map((r, i) => (group.has(i) ? { ...r, rating: anchorRating } : r));
}

/**
 * Resolve the peer score shown during compare for an explicit tie choice.
 * `categoryList` must already be sorted by `rank_position`.
 */
export function resolveTieAnchorFromCompare<
  T extends { id: string | number; rank_position?: number | null },
>(
  categoryList: T[],
  categoryScored: Array<{ id: string | number; rating: number }>,
  options: {
    insertIndex: number;
    tieWithPeerIndex?: number | null;
    tiedAboveOnInsert?: boolean;
    /** Score shown on the compare / preview UI for the peer (wins over lookup). */
    peerAnchorRating?: number | null;
  }
): TieAnchor | null {
  const tied =
    options.tieWithPeerIndex != null || options.tiedAboveOnInsert === true;
  if (!tied) return null;

  let peerIdx: number | null = null;
  if (options.tieWithPeerIndex != null) {
    peerIdx = options.tieWithPeerIndex;
  } else if (options.tiedAboveOnInsert && options.insertIndex > 0) {
    peerIdx = options.insertIndex - 1;
  }
  if (peerIdx == null || peerIdx < 0 || peerIdx >= categoryList.length) return null;

  const peer = categoryList[peerIdx];
  const fromUi = options.peerAnchorRating;
  const rating =
    typeof fromUi === 'number' && Number.isFinite(fromUi)
      ? fromUi
      : categoryScored.find((r) => String(r.id) === String(peer.id))?.rating;
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return null;
  return { leaderId: peer.id, rating };
}

function clampRatingForVibe(rating: number, vibe: Vibe): number {
  const nudge = VIBE_NUDGE[normalizeVibe(vibe)] ?? 0;
  return clampBaggedScore(Number(rating) + nudge);
}

/**
 * Score for a newly inserted row from neighbors in the pre-insert category list.
 * Pairwise compare only picks the slot — the number should match the comparison
 * cards, not a full-category rescore that can jump to the 7.7 fine ceiling.
 */
/** Score a category list after inserting a new row — same algorithm feed/profile use. */
export function scoreCategoryAfterInsert<
  T extends CategoryScoreRow & { id: string | number; category: string },
>(
  rankedSnapshot: T[],
  newItem: T,
  insertIndex: number,
  options: {
    markTiedAbove?: boolean;
    tieWithPeerIndex?: number;
    categoryList: T[];
    categoryScored: Array<{ id: string | number; rating: number }>;
    tiePeerAnchorScore?: number | null;
  }
): (T & { rating: number })[] {
  const inCategory = buildCategoryListAfterInsert(rankedSnapshot, newItem, insertIndex, {
    markTiedAbove: options.markTiedAbove,
    tieWithPeerIndex: options.tieWithPeerIndex,
  });
  let scored = computeScoresByCategory(inCategory, {
    preserveListOrder: true,
    explicitTiesOnly: true,
  });
  const tieAnchor = resolveTieAnchorFromCompare(options.categoryList, options.categoryScored, {
    insertIndex,
    tieWithPeerIndex: options.tieWithPeerIndex,
    tiedAboveOnInsert: options.markTiedAbove,
    peerAnchorRating: options.tiePeerAnchorScore,
  });
  if (tieAnchor) {
    scored = applyTieAnchorToScored(scored, tieAnchor);
  }
  return scored;
}

/**
 * @deprecated Placement-only override disagrees with feed/profile canonical scores.
 * Use `scoreCategoryAfterInsert` instead.
 */
export function ratingForInsertedPlacement(
  categoryScored: Array<{ rating: number }>,
  insertIndex: number,
  vibe: Vibe
): number {
  const n = categoryScored.length;
  if (n === 0) return clampRatingForVibe(10, vibe);

  const above =
    insertIndex > 0 ? Number(categoryScored[insertIndex - 1]?.rating) : null;
  const below =
    insertIndex < n ? Number(categoryScored[insertIndex]?.rating) : null;

  if (above == null && below != null && Number.isFinite(below)) {
    return clampRatingForVibe(Math.min(10, below + RATING_RANK_GAP), vibe);
  }
  if (above != null && Number.isFinite(above) && below == null) {
    return clampRatingForVibe(Math.max(0, above - RATING_RANK_GAP), vibe);
  }
  if (
    above != null &&
    below != null &&
    Number.isFinite(above) &&
    Number.isFinite(below)
  ) {
    if (Math.abs(above - below) < 0.02) {
      return clampRatingForVibe(above, vibe);
    }
    const hi = Math.max(above, below);
    const lo = Math.min(above, below);
    let target = (above + below) / 2;
    if (target >= hi) target = hi - RATING_RANK_GAP;
    if (target <= lo) target = lo + RATING_RANK_GAP;
    if (hi - lo < RATING_RANK_GAP * 2) {
      target = (hi + lo) / 2;
    }
    return clampRatingForVibe(target, vibe);
  }
  return clampRatingForVibe(10, vibe);
}

/** Apply tie anchor or neighbor-based placement score to the new row only. */
export function finalizeScoredCategoryWithPlacement<
  T extends { id: string | number; rating: number; tiedAbove?: boolean },
>(
  scored: T[],
  newItemId: string | number,
  options: {
    categoryScored: Array<{ rating: number }>;
    insertIndex: number;
    vibe: Vibe;
    tieAnchor: TieAnchor | null;
  }
): T[] {
  if (options.tieAnchor) {
    return applyTieAnchorToScored(scored, options.tieAnchor);
  }
  const placement = ratingForInsertedPlacement(
    options.categoryScored,
    options.insertIndex,
    options.vibe
  );
  return scored.map((row) =>
    String(row.id) === String(newItemId) ? { ...row, rating: placement } : row
  );
}

/**
 * Walk a category-sorted list of already-rated rows and mark consecutive
 * rows whose ratings collapse to the same one-decimal score as being part
 * of a tie group. Used at load time so previously persisted ties (i.e. two
 * peers with the same `rating`) survive subsequent rerank rounds.
 */
export function inferTiesByRating<T extends { rating?: number | null; category: string | Category }>(
  list: T[]
): (T & { tiedAbove?: boolean })[] {
  return list.map((row, i) => {
    if (i === 0) return { ...row };
    const prev = list[i - 1];
    if (prev.category !== row.category) return { ...row };
    const a = Number(prev.rating);
    const b = Number(row.rating);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return { ...row };
    // Compare at one decimal place — ratings are persisted rounded to 1 dp.
    const same = Math.round(a * 10) === Math.round(b * 10);
    return same ? { ...row, tiedAbove: true } : { ...row };
  });
}

/** Ranking scope — subcategory when set, otherwise legacy category → default subcategory. */
export function rankingScopeForRow(row: {
  subcategory?: string | null;
  category?: string | null;
  categories?: string[] | null;
}): string {
  return subcategoryForRow(row);
}

/** True when a ranked post was moved to a new subcategory and still needs pairwise re-ranking. */
export function postNeedsRecategorization(row: {
  needs_recategorization?: boolean | null;
}): boolean {
  return row.needs_recategorization === true;
}

/** Same numeric ratings as My List / Profile — derived from rank order + vibe, not stale DB values. */
export function canonicalRatingsFromRankedRows<
  T extends {
    category: string;
    subcategory?: string | null;
    vibe?: unknown;
    tiedAbove?: boolean;
    tied_above?: boolean | null;
    rank_position?: number | null;
    needs_recategorization?: boolean | null;
    rating?: number | null;
  },
>(rows: T[]): (T & { rating: number })[] {
  const pending = rows.filter(postNeedsRecategorization);
  const active = rows.filter((r) => !postNeedsRecategorization(r));
  const scoredActive = computeScoresByCategory(
    active.map((r) => ({ ...r, vibe: normalizeVibe(r.vibe) })),
    { explicitTiesOnly: true }
  );
  const scoredPending = pending.map((r) => ({
    ...r,
    vibe: normalizeVibe(r.vibe),
    rating: clampBaggedScore(Number(r.rating)),
  }));
  return [...scoredActive, ...scoredPending];
}

/** Group by subcategory (fallback: category), score each bucket independently, flatten back. */
export function computeScoresByCategory<
  T extends {
    category: string;
    subcategory?: string | null;
    categories?: string[] | null;
    vibe: Vibe;
    tiedAbove?: boolean;
    tied_above?: boolean | null;
    rank_position?: number | null;
  },
>(list: T[], options?: { preserveListOrder?: boolean; explicitTiesOnly?: boolean }): (T & {
  rating: number;
})[] {
  const preserveListOrder = options?.preserveListOrder === true;
  const explicitTiesOnly = options?.explicitTiesOnly === true;
  const buckets = new Map<string, T[]>();
  for (const item of list) {
    const key = rankingScopeForRow(item);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }
  const out: (T & { rating: number })[] = [];
  for (const items of buckets.values()) {
    const sorted = preserveListOrder
      ? items
      : [...items].sort(
          (a, b) =>
            rankPositionSortValue(a.rank_position) - rankPositionSortValue(b.rank_position)
        );
    const inferred = explicitTiesOnly
      ? null
      : inferTiesByRating(
          sorted.map((r) => ({ ...r, category: String(r.category ?? 'Snacks') }))
        );
    // During an active rank, only honor explicit tie flags — stale `rating` fields on
    // snapshot rows must not re-infer spurious ties (e.g. many "fine" rows at 7.7).
    const withTies = sorted.map((r, i) => ({
      ...r,
      tiedAbove: explicitTiesOnly
        ? r.tiedAbove === true || r.tied_above === true
        : r.tiedAbove === true ||
          r.tied_above === true ||
          Boolean(inferred?.[i]?.tiedAbove),
    }));
    const normalized = withTies.map((r) => ({ ...r, vibe: normalizeVibe(r.vibe) }));
    for (const scored of applyDynamicScores(normalized)) out.push(scored);
  }
  return out;
}

type CategoryScoreRow = {
  category: string;
  vibe: Vibe;
  tiedAbove?: boolean;
  tied_above?: boolean | null;
  rank_position?: number | null;
};

/**
 * Canonical scores for one category at rest — same path My List uses per category:
 * sort by `rank_position`, then per-category tie inference + vibe clamp.
 */
export function scoreCategoryAtRest<T extends CategoryScoreRow>(
  items: T[]
): (T & { rating: number })[] {
  const sorted = [...items].sort(
    (a, b) => rankPositionSortValue(a.rank_position) - rankPositionSortValue(b.rank_position)
  );
  return computeScoresByCategory(sorted, { preserveListOrder: true, explicitTiesOnly: true });
}

/**
 * Insert a freshly ranked item at `insertIndex` within its category, preserving
 * the rest of the list.
 *
 * When `markTiedAbove` is true the new item joins the tie group above it. If
 * the insertion splits a previously tied pair (the row that used to live at
 * `insertIndex` was tied with the row at `insertIndex - 1`), we break that old
 * tie unless the new item is itself chaining the tie through. This stops a
 * non-tied inserted item from accidentally inheriting a tie flag meant for
 * its old predecessor.
 */
function insertIntoCategoryList<
  T extends { category: string; tiedAbove?: boolean; rank_position?: number | null },
>(
  categoryItems: T[],
  newItem: T,
  insertIndexInCategory: number,
  options: { markTiedAbove?: boolean; tieWithPeerIndex?: number } = {}
): T[] {
  const tiePeer = options.tieWithPeerIndex;
  if (
    tiePeer != null &&
    tiePeer === 0 &&
    categoryItems.length === 1 &&
    insertIndexInCategory === 1
  ) {
    const leader = categoryItems[0];
    return [{ ...newItem, tiedAbove: false }, { ...leader, tiedAbove: true }];
  }

  const before = categoryItems.slice(0, insertIndexInCategory);
  const after = categoryItems.slice(insertIndexInCategory);

  const tieFromCompare =
    tiePeer != null && tiePeer + 1 === insertIndexInCategory && insertIndexInCategory > 0;
  const tieFromPreview = Boolean(options.markTiedAbove && insertIndexInCategory > 0);
  const inserted: T =
    tieFromCompare || tieFromPreview
      ? ({ ...newItem, tiedAbove: true } as T)
      : ({ ...newItem, tiedAbove: false } as T);

  const adjustedAfter: T[] = [...after];
  if (
    adjustedAfter.length > 0 &&
    adjustedAfter[0].tiedAbove &&
    !inserted.tiedAbove
  ) {
    adjustedAfter[0] = { ...adjustedAfter[0], tiedAbove: false };
  }

  return [...before, inserted, ...adjustedAfter];
}

/** Category-only list after insert — preserves compare slot order (no rank_position re-sort). */
export function buildCategoryListAfterInsert<
  T extends { category: string; tiedAbove?: boolean; rank_position?: number | null },
>(
  rankedList: T[],
  newItem: T,
  insertIndexInCategory: number,
  options: { markTiedAbove?: boolean; tieWithPeerIndex?: number } = {}
): T[] {
  const categoryItems = sortRowsByRankPosition(
  rankedList.filter((r) => rankingScopeForRow(r) === rankingScopeForRow(newItem))
  );
  return insertIntoCategoryList(categoryItems, newItem, insertIndexInCategory, options);
}

export function insertIntoCategoryRanked<
  T extends { category: string; tiedAbove?: boolean; rank_position?: number | null },
>(
  rankedList: T[],
  newItem: T,
  insertIndexInCategory: number,
  options: { markTiedAbove?: boolean; tieWithPeerIndex?: number } = {}
): T[] {
  const categoryItems = sortRowsByRankPosition(
  rankedList.filter((r) => rankingScopeForRow(r) === rankingScopeForRow(newItem))
  );
  const otherItems = rankedList.filter((r) => r.category !== newItem.category);
  return [
    ...otherItems,
    ...insertIntoCategoryList(categoryItems, newItem, insertIndexInCategory, options),
  ];
}

// ─── Binary-search comparison engine ──────────────────────────────────────────

export type CompareState = {
  lo: number;
  hi: number;
  mid: number;
  comparisons: number;
};

/** Initial state for a fresh insertion into a category list of length `n`. */
export function initialCompareState(n: number): CompareState {
  if (n === 0) return { lo: 0, hi: 0, mid: 0, comparisons: 0 };
  return { lo: 0, hi: n, mid: Math.floor(n / 2), comparisons: 0 };
}

export type CompareAdvance =
  | { kind: 'continue'; next: CompareState }
  | {
      kind: 'done';
      insertIndex: number;
      /** Index of the existing row the new item should be tied with (same rating). */
      tiedWith?: number;
    };

/** "I prefer the new item over the comparison item" — narrow toward the top. */
export function chooseBetter(state: CompareState, categoryLen: number): CompareAdvance {
  return advance(state, state.lo, state.mid, Math.floor((state.lo + state.mid) / 2), categoryLen);
}

/** "I prefer the comparison item" — narrow toward the bottom. */
export function chooseWorse(state: CompareState, categoryLen: number): CompareAdvance {
  return advance(
    state,
    state.mid + 1,
    state.hi,
    Math.floor((state.mid + 1 + state.hi) / 2),
    categoryLen
  );
}

/**
 * Couldn't decide — insert directly after the comparison item AND record that
 * the new item should be tied with the comparison item (so they share a score).
 */
export function chooseTie(state: CompareState, categoryLen: number): CompareAdvance {
  return {
    kind: 'done',
    insertIndex: Math.min(state.mid + 1, categoryLen),
    tiedWith: state.mid,
  };
}

function advance(
  prev: CompareState,
  newLo: number,
  newHi: number,
  newMid: number,
  categoryLen: number
): CompareAdvance {
  if (newLo >= newHi || newLo >= categoryLen) {
    return { kind: 'done', insertIndex: newLo };
  }
  return {
    kind: 'continue',
    next: { lo: newLo, hi: newHi, mid: newMid, comparisons: prev.comparisons + 1 },
  };
}

/** Estimate the number of comparisons remaining for the progress UI. */
export function estimateTotalComparisons(categoryLen: number): number {
  return Math.ceil(Math.log2(categoryLen + 1));
}

// ─── Category mapping (search-row category text → bagged category) ────────────

/**
 * Maps a free-form category label (USDA / FatSecret / our curated tag) into a Bagged category.
 *
 * Note: FatSecret typically returns `foodCategory: "Brand"` or `"Generic"` for branded
 * search hits, so this function is also fed the product description in onboarding/search
 * filters. We therefore have to handle brand-only strings like "Pepsi (Can)" too — that's
 * why the beverage branch lists soda/energy/sports/coffee-shop/water brand names.
 *
 * Order matters: frozen desserts and meat are checked BEFORE beverages so that
 * "Coffee Ice Cream" → Frozen (not Beverages), "Halibut Steak" → Meat & Seafood
 * (otherwise "tea" would substring-match "steak").
 */
export function mapCategory(tag: string | null | undefined = ''): Category {
  const c = String(tag ?? '').toLowerCase();

  if (
    /\b(ice cream|frozen yogurt|gelato|sorbet|sherbet)\b/.test(c) ||
    c.includes('frozen') ||
    c.includes('novelties') ||
    c.includes('novelty')
  ) {
    return 'Frozen';
  }
  if (
    /\b(chicken|beef|pork|lamb|veal|bison|venison|turkey|steak|bacon|sausage|salami|pepperoni|prosciutto|meatball|jerky|ribs|brisket|kielbasa|bratwurst|hamburger|shawarma|gyro|kebab|salmon|tuna|cod|halibut|tilapia|trout|mackerel|sardine|anchovy|swordfish|catfish|pollock|haddock|flounder|grouper|snapper|shrimp|prawn|lobster|crab|scallop|clam|oyster|mussel|squid|octopus|caviar)\b/i.test(
      c
    ) ||
    /(hot dog|ground beef|pork chop|fish stick|fish fillet|fish fillets|corn dog|seafood|shellfish|sushi|sashimi|ceviche|rotisserie|spatchcock)/i.test(
      c
    )
  ) {
    return 'Meat & Seafood';
  }
  if (
    c.includes('beverage') ||
    c.includes('juice') ||
    /\b(drink|drinks|soda|sodas|soft drink|cola|coke|pepsi|sprite|fanta|crush|fresca|mug|7-?up|sierra mist|mello yello|mountain dew|baja blast|dr\.?\s*pepper|root beer|cream soda|ginger ale|ginger beer|lemonade|limeade|iced tea|sweet tea|kombucha|smoothie|milkshake|milk shake|frappe|frappuccino|frappucino|latte|cappuccino|espresso|americano|mocha|macchiato|cold brew|hot cocoa|hot chocolate|chocolate milk|sparkling water|tonic water|seltzer water|mineral water|electrolyte|sports drink|energy drink|thirst quencher|gatorade|powerade|bodyarmor|liquid i\.?v\.?|liquid death|red bull|monster energy|rockstar energy|bang energy|celsius energy|prime hydration|aquafina|dasani|fiji water|evian|smartwater|essentia|voss|hint water|topo chico|la croix|spindrift|bubly|polar seltzer|waterloo|recess|olipop|poppi|reed's|snapple|arizona|gold peak|pure leaf|honest tea|kool-?aid|capri sun|tropicana|minute maid|naked juice|odwalla|v8|ocean spray|welch's|simply (orange|lemonade|apple))\b/i.test(
      c
    ) ||
    /\b(coffee|tea)\b/.test(c)
  ) {
    return 'Beverages';
  }
  if (
    /\b(supplement|supplements|protein powder|whey|casein|creatine|pre-?workout|post-?workout|bcaa|collagen|mass gainer|amino acid|protein bar|protein shake|meal replacement)\b/i.test(
      c
    ) ||
    (c.includes('protein') && /\b(powder|isolate|concentrate|blend)\b/i.test(c))
  ) {
    return 'Protein/Supplements';
  }
  if (
    c.includes('snack') ||
    c.includes('chip') ||
    c.includes('cracker') ||
    c.includes('cookie')
  ) {
    return 'Snacks';
  }
  if (c.includes('spice') || c.includes('seasoning') || c.includes('herb')) return 'Spices';
  if (
    c.includes('condiment') ||
    c.includes('sauce') ||
    c.includes('dressing') ||
    c.includes('spread') ||
    c.includes('jam') ||
    c.includes('broth') ||
    c.includes('stock')
  ) {
    return 'Condiments';
  }
  if (c.includes('produce') || c.includes('fruit') || c.includes('vegetable')) return 'Produce';
  if (c.includes('oat') || c.includes('plant') || c.includes('almond') || c.includes('soy milk')) {
    return 'Dairy Alt';
  }
  if (
    c.includes('wine') ||
    c.includes('beer') ||
    c.includes('spirit') ||
    c.includes('whiskey') ||
    c.includes('vodka') ||
    c.includes('rum') ||
    c.includes('gin') ||
    c.includes('tequila') ||
    c.includes('alcohol') ||
    c.includes('cider') ||
    c.includes('champagne') ||
    c.includes('seltzer') ||
    c.includes('lager') ||
    c.includes('ale')
  ) {
    return 'Alcohol';
  }
  if (
    c.includes('dairy') ||
    c.includes('milk') ||
    c.includes('cheese') ||
    c.includes('butter') ||
    c.includes('yogurt')
  ) {
    return 'Dairy';
  }
  return 'Snacks';
}
