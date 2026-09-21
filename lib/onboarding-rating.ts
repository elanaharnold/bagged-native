import {
  normalizeVibe,
  rankingScopeForRow,
  sortRowsByRankPosition,
  type Category,
  type Vibe,
} from '@/lib/ranking';

export type OnboardingRankSnapshotRow = {
  id: string | number;
  item: string;
  brand: string;
  store: string;
  category: Category | string;
  subcategory?: string;
  vibe: Vibe;
  rating?: number;
  rank_position?: number | null;
  tiedAbove?: boolean;
};

export type OnboardingRatedItem = {
  id: string;
  item: string;
  brand: string;
  store: string;
  stores: string[];
  category: Category | string;
  subcategory: string;
  vibe: Vibe;
  rankPosition: number;
  rating: number;
  tiedAbove?: boolean;
  dietTags?: string[];
  note?: string;
  searchRow?: import('@/lib/data').SearchProductRow | null;
};

function vibeTier(v: Vibe): number {
  switch (normalizeVibe(v)) {
    case 'liked':
      return 2;
    case 'fine':
      return 1;
    default:
      return 0;
  }
}

/** Prior items in the same subcategory with the same vibe — candidates for head-to-head compare. */
export function findOnboardingComparePeers<
  T extends { subcategory?: string | null; category?: string | null; vibe: Vibe },
>(priorItems: T[], subcategoryScope: string, vibe: Vibe): T[] {
  const normalizedVibe = normalizeVibe(vibe);
  const scope = String(subcategoryScope ?? '').trim();
  return sortRowsByRankPosition(
    priorItems.filter(
      (p) => rankingScopeForRow(p) === scope && normalizeVibe(p.vibe) === normalizedVibe
    ) as Array<T & { rank_position?: number | null }>
  );
}

/**
 * Map a compare insert index (within same-vibe peers only) to an index in the full
 * category list passed to `scoreCategoryAfterInsert`.
 */
export function peerInsertIndexToCategoryInsertIndex(
  fullCategoryList: Array<{ id: string | number }>,
  peerList: Array<{ id: string | number }>,
  peerInsertIndex: number
): number {
  if (peerList.length === 0) return 0;
  if (peerInsertIndex <= 0) {
    const firstPeer = peerList[0];
    const idx = fullCategoryList.findIndex((r) => String(r.id) === String(firstPeer.id));
    return idx >= 0 ? idx : 0;
  }
  if (peerInsertIndex >= peerList.length) {
    const lastPeer = peerList[peerList.length - 1];
    const idx = fullCategoryList.findIndex((r) => String(r.id) === String(lastPeer.id));
    return idx >= 0 ? idx + 1 : fullCategoryList.length;
  }
  const peer = peerList[peerInsertIndex];
  const idx = fullCategoryList.findIndex((r) => String(r.id) === String(peer.id));
  return idx >= 0 ? idx : peerInsertIndex;
}

/**
 * When no head-to-head compare runs (different vibe in same category), slot by vibe
 * tier: liked above fine above meh.
 */
export function insertIndexForVibeSegment<T extends { vibe: Vibe }>(
  categoryList: T[],
  newVibe: Vibe
): number {
  const newTier = vibeTier(newVibe);
  for (let i = 0; i < categoryList.length; i++) {
    if (vibeTier(categoryList[i].vibe) < newTier) return i;
  }
  return categoryList.length;
}

export function ratedItemsToRankSnapshot(items: OnboardingRatedItem[]): OnboardingRankSnapshotRow[] {
  return items.map((item) => ({
    id: item.id,
    item: item.item,
    brand: item.brand,
    store: item.store,
    category: item.category,
    subcategory: item.subcategory,
    vibe: item.vibe,
    rating: item.rating,
    rank_position: item.rankPosition,
    tiedAbove: item.tiedAbove === true,
  }));
}

/** Apply rescored category rows back onto the in-memory onboarding list. */
export function applyCategoryScoresToRatedItems(
  items: OnboardingRatedItem[],
  subcategoryScope: string,
  scored: Array<{ id: string | number; rating: number; tiedAbove?: boolean }>
): OnboardingRatedItem[] {
  const scope = String(subcategoryScope ?? '').trim();
  const byId = new Map(
    scored.map((row, index) => [
      String(row.id),
      { rating: row.rating, rankPosition: index + 1, tiedAbove: row.tiedAbove === true },
    ])
  );
  return items.map((item) => {
    if (rankingScopeForRow(item) !== scope) return item;
    const next = byId.get(String(item.id));
    if (!next) return item;
    return {
      ...item,
      rating: next.rating,
      rankPosition: next.rankPosition,
      tiedAbove: next.tiedAbove,
    };
  });
}

/** Replace one subcategory bucket with scored rows, inserting `newItem` when its temp id appears. */
export function mergeScoredCategoryIntoRatedItems(
  items: OnboardingRatedItem[],
  subcategoryScope: string,
  scored: Array<{ id: string | number; rating: number; tiedAbove?: boolean }>,
  newItem: OnboardingRatedItem | null
): OnboardingRatedItem[] {
  const scope = String(subcategoryScope ?? '').trim();
  const other = items.filter((item) => rankingScopeForRow(item) !== scope);
  const merged: OnboardingRatedItem[] = [];
  scored.forEach((row, index) => {
    const existing = items.find((item) => String(item.id) === String(row.id));
    if (existing) {
      merged.push({
        ...existing,
        rating: row.rating,
        rankPosition: index + 1,
        tiedAbove: row.tiedAbove === true,
      });
      return;
    }
    if (newItem && String(row.id) === String(newItem.id)) {
      merged.push({
        ...newItem,
        rating: row.rating,
        rankPosition: index + 1,
        tiedAbove: row.tiedAbove === true,
      });
    }
  });
  return [...other, ...merged];
}

export function nextOnboardingItemId(items: OnboardingRatedItem[]): string {
  return `onboard-${items.length}`;
}
