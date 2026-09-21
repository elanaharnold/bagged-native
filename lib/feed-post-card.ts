import { BaggedColors } from '@/constants/bagged-theme';
import { primaryGroceryStoreForKey, retailStoresForRow } from '@/constants/grocery';
import { categoriesForRow, primaryCategoryForRow } from '@/lib/categories';
import type { FeedCardPost } from '@/components/bagged/feed-card';
import {
  normalizePhotoUrls,
  normalizePostMacros,
  productDescriptionKey,
  profileIsVerifiedAmbassador,
  rankKeyPair,
  type FeedPostRow,
} from '@/lib/data';
import { WANT_TO_TRY_RADAR_NOTE } from '@/lib/post-feed-visibility';

export function feedRowToCardPost(
  row: FeedPostRow,
  viewerId: string,
  wantSet: Set<string>,
  rankedSet: Set<string>
): FeedCardPost {
  const username = row.profile?.username ?? 'unknown';
  const stores = retailStoresForRow(row);
  const displayStore = stores[0] ?? '';
  const radarOnly = row.radar_only === true;
  const liked = row.likes.some((l) => String(l.user_id) === String(viewerId));
  const photoUrls = normalizePhotoUrls(row.photo_urls);
  const wantToTry = wantSet.has(
    rankKeyPair(row.item, primaryGroceryStoreForKey(row), row.product_brand)
  );
  const viewerHasRanked = rankedSet.has(
    rankKeyPair(row.item, primaryGroceryStoreForKey(row), row.product_brand)
  );

  const rawNote = String(row.note ?? '').trim();
  const note = rawNote === WANT_TO_TRY_RADAR_NOTE ? '' : rawNote;

  return {
    id: row.id,
    user: username,
    userVerified: profileIsVerifiedAmbassador(row.profile),
    avatar: (username || '?').charAt(0).toUpperCase(),
    avatarColor: row.profile?.avatar_color ?? BaggedColors.accent,
    item: row.item ?? '',
    brand: row.product_brand ?? '',
    store: displayStore,
    stores,
    category: primaryCategoryForRow(row),
    categories: categoriesForRow(row),
    subcategory: row.subcategory ?? null,
    rating: radarOnly ? null : (row.rating ?? null),
    note,
    photoUrls,
    likes: row.likes.length,
    comments: row.commentCount ?? 0,
    liked,
    wantToTry,
    radarOnly,
    createdAt: row.created_at,
    macros: normalizePostMacros(row.macros),
    dietTags: Array.isArray(row.diet_tags) ? row.diet_tags : null,
    descriptionKey:
      row.description_key != null && String(row.description_key).trim()
        ? String(row.description_key).trim().toLowerCase()
        : productDescriptionKey(row.item ?? '', row.product_brand),
    viewerHasRanked,
    replyHighlight: row.replyHighlight ?? null,
  };
}
