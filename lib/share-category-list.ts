import { rowMatchesTwoLevelCategoryFilter } from '@/lib/categories';
import { clampBaggedScore, sortRowsByRankPosition } from '@/lib/ranking';
import { formatProductDisplayName } from '@/lib/format';

export type CategoryListEntry = {
  rank: number;
  item: string;
  brand?: string;
  rating: number;
};

export type CategoryListShareableData = {
  category: string;
  username: string;
  displayName?: string;
  avatarChar?: string;
  avatarColor?: string;
  /** False for broad parent categories — list is score-sorted, not ranked #1–#10. */
  showRankNumbers?: boolean;
  entries: CategoryListEntry[];
};

type RankedRowLike = {
  item: string;
  product_brand?: string | null;
  brand?: string | null;
  rating: number;
  category?: string | null;
  subcategory?: string | null;
  rank_position?: number | null;
};

function mapShareEntries(rows: RankedRowLike[]): CategoryListEntry[] {
  return rows.map((row, idx) => ({
    rank: idx + 1,
    item: formatProductDisplayName(row.item) || 'Untitled item',
    brand: formatProductDisplayName(row.product_brand ?? row.brand) || undefined,
    rating: clampBaggedScore(row.rating),
  }));
}

export function twoLevelCategoryListShareableFromRows(
  categoryLabel: string,
  rows: RankedRowLike[],
  username: string,
  filter: {
    parentId?: string | null;
    subcategoryId?: string | null;
  },
  extras?: {
    displayName?: string;
    avatarChar?: string;
    avatarColor?: string;
  }
): CategoryListShareableData | null {
  const label = categoryLabel.trim();
  if (!label) return null;

  const matched = rows.filter((row) =>
    rowMatchesTwoLevelCategoryFilter(row, filter.parentId ?? null, filter.subcategoryId ?? null)
  );

  const sorted = filter.subcategoryId
    ? sortRowsByRankPosition(matched)
    : [...matched].sort((a, b) => b.rating - a.rating);

  const top = sorted.slice(0, 10);
  if (top.length === 0) return null;

  return {
    category: label,
    username,
    displayName: extras?.displayName,
    avatarChar: extras?.avatarChar,
    avatarColor: extras?.avatarColor,
    showRankNumbers: Boolean(filter.subcategoryId),
    entries: mapShareEntries(top),
  };
}

export function categoryListShareableFromRows(
  category: string,
  rows: RankedRowLike[],
  username: string,
  extras?: {
    displayName?: string;
    avatarChar?: string;
    avatarColor?: string;
  }
): CategoryListShareableData | null {
  const catKey = category.trim() || 'Snacks';
  const inCategory = rows
    .filter((r) => (r.category?.trim() || 'Snacks') === catKey)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 10);

  if (inCategory.length === 0) return null;

  return {
    category: catKey,
    username,
    displayName: extras?.displayName,
    avatarChar: extras?.avatarChar,
    avatarColor: extras?.avatarColor,
    showRankNumbers: false,
    entries: inCategory.map((row, idx) => ({
      rank: idx + 1,
      item: formatProductDisplayName(row.item) || 'Untitled item',
      brand: formatProductDisplayName(row.product_brand ?? row.brand) || undefined,
      rating: clampBaggedScore(row.rating),
    })),
  };
}