import type { FeedCardPost } from '@/components/bagged/feed-card';
import { retailStoresForRow } from '@/constants/grocery';
import { subcategoryLabelForRow } from '@/lib/categories';
import type { PostMacros, RankedPostRow } from '@/lib/data';
import { macroFieldIsSet, normalizePostMacros, normalizePhotoUrls, productDescriptionKey } from '@/lib/data';
import { isDisplayableBaggedScore } from '@/lib/ranking';

export type ShareableData = {
  item: string;
  brand?: string;
  descriptionKey?: string;
  store?: string;
  stores?: string[];
  category?: string;
  rating: number;
  note?: string;
  username: string;
  displayName?: string;
  avatarChar?: string;
  avatarColor?: string;
  photoUrl?: string | null;
  photoUrls?: string[];
  macros?: PostMacros | null;
  dietTags?: string[] | null;
  /** Filled when loaded — community-wide average for this product. */
  communityAvg?: number | null;
};

export function shareableHasPhoto(data: ShareableData): boolean {
  return Boolean(data.photoUrl) || (data.photoUrls?.length ?? 0) > 0;
}

export function shareableHasNutritionContent(data: ShareableData): boolean {
  const macros = normalizePostMacros(data.macros);
  const hasMacros =
    macros != null &&
    (macroFieldIsSet(macros.cal) ||
      macroFieldIsSet(macros.protein) ||
      macroFieldIsSet(macros.carbs) ||
      macroFieldIsSet(macros.fat));
  const tags = (data.dietTags ?? []).map((t) => String(t ?? '').trim()).filter(Boolean);
  return hasMacros || tags.length > 0;
}

/** @deprecated Use ShareableData */
export type ShareScoreCardData = ShareableData;

export function shareScoreCardFromFeedPost(
  post: FeedCardPost,
  viewerUsername: string
): ShareableData | null {
  if (post.user !== viewerUsername || post.radarOnly || !isDisplayableBaggedScore(post.rating)) {
    return null;
  }
  return {
    item: post.item,
    brand: post.brand || undefined,
    descriptionKey:
      post.descriptionKey ?? productDescriptionKey(post.item, post.brand),
    store: post.store || undefined,
    stores: post.stores,
    category:
      subcategoryLabelForRow({
        subcategory: post.subcategory,
        category: post.category,
        categories: post.categories,
      }) ||
      post.category ||
      undefined,
    rating: post.rating,
    note: post.note?.trim() || undefined,
    username: viewerUsername,
    displayName: post.user,
    avatarChar: post.avatar,
    avatarColor: post.avatarColor,
    photoUrl: post.photoUrls?.[0] ?? null,
    photoUrls: post.photoUrls?.length ? post.photoUrls.slice(0, 3) : undefined,
    macros: post.macros ?? null,
    dietTags: post.dietTags ?? null,
  };
}

export function shareScoreCardFromRankedRow(
  row: RankedPostRow & { rating: number },
  username: string
): ShareableData | null {
  if (!isDisplayableBaggedScore(row.rating)) return null;
  const stores = retailStoresForRow(row);
  return {
    item: row.item,
    brand: row.product_brand || undefined,
    descriptionKey:
      row.description_key?.trim() ||
      productDescriptionKey(row.item, row.product_brand),
    store: stores[0] || row.store || undefined,
    stores,
    category:
      subcategoryLabelForRow({
        subcategory: row.subcategory,
        category: row.category,
      }) ||
      row.category ||
      undefined,
    rating: row.rating,
    note: row.note?.trim() || undefined,
    username,
    photoUrl: normalizePhotoUrls(row.photo_urls)[0] ?? null,
    photoUrls: normalizePhotoUrls(row.photo_urls).slice(0, 3),
    macros: normalizePostMacros(row.macros),
    dietTags: Array.isArray(row.diet_tags) ? row.diet_tags : null,
  };
}
