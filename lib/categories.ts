/** Bagged product categories — same set used in rate flow and filters. */
import { getParentCategory, getSubcategory, subcategoryForRow } from '../constants/categories';

export const BAGGED_CATEGORIES = [
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

export type BaggedCategory = (typeof BAGGED_CATEGORIES)[number];

/** Legacy labels folded into a current Bagged category. */
const LEGACY_CATEGORY_ALIASES: Record<string, BaggedCategory> = {
  'Powders and supplements': 'Protein/Supplements',
};

export function canonicalBaggedCategory(value: string): string {
  const trimmed = String(value ?? '').trim();
  return LEGACY_CATEGORY_ALIASES[trimmed] ?? trimmed;
}

const CATEGORY_SET = new Set<string>(BAGGED_CATEGORIES);

export function isBaggedCategory(value: string): value is BaggedCategory {
  return CATEGORY_SET.has(value);
}

/** Normalize, dedupe, and keep only known category labels (falls back to Snacks). */
export function normalizeCategoriesList(
  raw: string[] | null | undefined,
  primaryFallback?: string | null
): BaggedCategory[] {
  const fromArray = (raw ?? [])
    .map((c) => canonicalBaggedCategory(String(c ?? '').trim()))
    .filter((c) => isBaggedCategory(c));
  const primary = canonicalBaggedCategory(String(primaryFallback ?? '').trim());
  const merged = [...new Set([...fromArray, ...(isBaggedCategory(primary) ? [primary] : [])])];
  if (merged.length > 0) return merged;
  return ['Snacks'];
}

/** All categories for a row — prefers `categories[]`, falls back to legacy `category`. */
export function categoriesForRow(row: {
  category?: string | null;
  categories?: string[] | null;
}): BaggedCategory[] {
  const fromArray = normalizeCategoriesList(row.categories, null);
  if ((row.categories ?? []).length > 0 || fromArray.length > 1 || fromArray[0] !== 'Snacks') {
    return fromArray;
  }
  return normalizeCategoriesList(null, row.category);
}

/** Primary category for ranking and single-label display. */
export function primaryCategoryForRow(row: {
  category?: string | null;
  categories?: string[] | null;
}): BaggedCategory {
  const primary = canonicalBaggedCategory(String(row.category ?? '').trim());
  if (isBaggedCategory(primary)) return primary;
  return categoriesForRow(row)[0] ?? 'Snacks';
}

/** True when the row has an explicit, valid `subcategory` id (not a legacy fallback). */
export function hasValidStoredSubcategory(row: { subcategory?: string | null }): boolean {
  const stored = String(row.subcategory ?? '').trim();
  return Boolean(stored && getSubcategory(stored));
}

/**
 * Resolve subcategory id for display and filters. Pass sources in priority order;
 * explicit stored ids win over legacy `category` → subcategory mapping.
 */
export function resolveSubcategoryId(
  ...sources: Array<{ subcategory?: string | null; category?: string | null } | null | undefined>
): string {
  for (const src of sources) {
    if (!src) continue;
    const stored = String(src.subcategory ?? '').trim();
    if (stored && getSubcategory(stored)) return stored;
  }
  for (const src of sources) {
    if (!src) continue;
    return subcategoryForRow(src);
  }
  return subcategoryForRow({});
}

/** Human-readable subcategory for feed / product chrome. Falls back to legacy category labels. */
export function subcategoryLabelForRow(row: {
  subcategory?: string | null;
  category?: string | null;
  categories?: string[] | null;
}): string {
  const sub = getSubcategory(resolveSubcategoryId(row));
  if (sub?.label) return sub.label;
  const legacy = categoriesLabel(row);
  return legacy || 'Uncategorized';
}

export function categoriesLabel(row: {
  category?: string | null;
  categories?: string[] | null;
}): string {
  return categoriesForRow(row).join(' · ');
}

export function rowMatchesCategoryFilter(
  row: { category?: string | null; categories?: string[] | null },
  selected: string | null | undefined
): boolean {
  const want = String(selected ?? '').trim();
  if (!want || want === 'All') return true;
  return categoriesForRow(row).includes(want as BaggedCategory);
}

export function rowMatchesTwoLevelCategoryFilter(
  row: {
    category?: string | null;
    categories?: string[] | null;
    subcategory?: string | null;
  },
  parentId: string | null | undefined,
  subcategoryId: string | null | undefined
): boolean {
  const rowSub = resolveSubcategoryId(row);
  const wantSub = String(subcategoryId ?? '').trim();
  if (wantSub) return rowSub === wantSub;
  const wantParent = String(parentId ?? '').trim();
  if (!wantParent) return true;
  return getParentCategory(rowSub)?.id === wantParent;
}
