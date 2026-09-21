import { storesForBrandAndSelections } from '@/constants/grocery';
import {
  WANT_TO_TRY_RADAR_RANK_POSITION,
} from '@/lib/post-feed-visibility';
import {
  addToWantToTry,
  createPost,
  getUserRankings,
  isRadarOnlyDbRow,
  productDescriptionKey,
  productIdentityKey,
  rankedProductIdentityDuplicate,
  resolveProductDescriptionKey,
  removeFromWantToTry,
} from '@/lib/data';
import { normalizeWantToTrySource, type WantToTrySource } from '@/lib/want-to-try-source';
import { supabase } from '@/lib/supabase';

const RADAR_RANK_POSITION = WANT_TO_TRY_RADAR_RANK_POSITION;

export type PostWantToTryArgs = {
  userId: string;
  item: string;
  brand?: string;
  descriptionKey?: string;
  /** User-selected retailers; omit or pass [] when unsure — no default store is inserted. */
  stores?: string[];
  category?: string;
  subcategory?: string;
  dietTags?: string[];
  emoji?: string;
  source?: WantToTrySource;
  /** Optional feed caption — same as a ranked post note. */
  note?: string;
};

function normalizeStoreList(brand: string, selectedStores: string[]): string[] {
  const cleaned = [...new Set(selectedStores.map((s) => String(s ?? '').trim()).filter(Boolean))];
  return storesForBrandAndSelections(brand, cleaned);
}

export function postIdString(id: unknown): string | null {
  if (id == null) return null;
  const s = String(id).trim();
  return s.length > 0 ? s : null;
}

async function assertNotAlreadyRanked(
  userId: string,
  item: string,
  brand?: string
): Promise<void> {
  const rankings = await getUserRankings(userId);
  const rankedEntries = rankings
    .filter((r) => !isRadarOnlyDbRow(r))
    .map((r) => ({
      id: r.id,
      item: r.item,
      store: r.store,
      brand: r.product_brand,
    }));
  if (rankedProductIdentityDuplicate(rankedEntries, item, brand)) {
    throw new Error('You already ranked this item.');
  }
}

async function lookupRadarPostIdFromWantList(
  userId: string,
  item: string,
  store: string
): Promise<string | null> {
  const itemTrim = String(item ?? '').trim();
  if (!itemTrim) return null;
  const { data, error } = await supabase
    .from('want_to_try')
    .select('store, radar_post_id')
    .eq('user_id', userId)
    .eq('item', itemTrim);
  if (error || !data?.length) return null;

  const storeNorm = String(store ?? '').trim().toLowerCase();
  const exact = data.find(
    (r) => String(r.store ?? '').trim().toLowerCase() === storeNorm && r.radar_post_id
  );
  if (exact?.radar_post_id) return postIdString(exact.radar_post_id);

  const withId = data.find((r) => r.radar_post_id);
  return withId?.radar_post_id ? postIdString(withId.radar_post_id) : null;
}

async function resolveRadarPostId(
  userId: string,
  item: string,
  store: string,
  radarPostId?: string | null,
  fallbackRadarPostId?: string | number | null
): Promise<string | null> {
  return (
    postIdString(radarPostId) ??
    postIdString(fallbackRadarPostId) ??
    (await lookupRadarPostIdFromWantList(userId, item, store))
  );
}

/** Deletes the viewer's radar-only feed post for a want-to-try removal. */
async function deleteRadarFeedPost(
  userId: string,
  item: string,
  radarPostId: string | null
): Promise<void> {
  const itemTrim = String(item ?? '').trim();
  if (radarPostId) {
    const { error } = await supabase.from('posts').delete().eq('user_id', userId).eq('id', radarPostId);
    if (error) throw error;
    return;
  }
  if (!itemTrim) return;
  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('user_id', userId)
    .eq('item', itemTrim)
    .eq('radar_only', true);
  if (error) throw error;
}

/** Creates a radar feed post and links it on `want_to_try`. */
export async function postWantToTryWithFeed(
  args: PostWantToTryArgs
): Promise<{ radarPostId: string }> {
  const item = String(args.item ?? '').trim();
  if (!item) throw new Error('Item name is required.');

  const brand = String(args.brand ?? '').trim();
  const storeList = normalizeStoreList(brand, args.stores ?? []);
  const primary = storeList[0] ?? '';

  await assertNotAlreadyRanked(args.userId, item, brand);

  const caption = String(args.note ?? '').trim();

  let radarPostId: string | null = null;
  try {
    const created = await createPost({
      userId: args.userId,
      item,
      descriptionKey: productDescriptionKey(item, brand),
      store: primary,
      stores: storeList,
      productBrand: brand,
      category: args.category ?? 'Snacks',
      ...(args.subcategory ? { subcategory: args.subcategory } : {}),
      emoji: args.emoji ?? '',
      note: caption,
      rating: 0,
      rankPosition: RADAR_RANK_POSITION,
      dietTags: args.dietTags ?? [],
      radarOnly: true,
    });
    radarPostId = postIdString(created.id);
    if (!radarPostId) {
      throw new Error('Could not create feed post.');
    }
    await addToWantToTry(args.userId, {
      item,
      store: primary,
      emoji: args.emoji ?? '',
      category: args.category ?? 'Snacks',
      radarPostId,
      productBrand: brand || undefined,
      source: normalizeWantToTrySource(args.source),
      note: caption,
    });
    return { radarPostId };
  } catch (err) {
    if (radarPostId) {
      try {
        await supabase.from('posts').delete().eq('user_id', args.userId).eq('id', radarPostId);
      } catch {
        /* best-effort rollback */
      }
    }
    throw err;
  }
}

export type RemoveWantToTryWithFeedOptions = {
  /** When removing from the feed card for a radar post, pass `post.id`. */
  fallbackRadarPostId?: string | number | null;
};

export async function removeWantToTryWithFeed(
  userId: string,
  item: string,
  store: string,
  radarPostId?: string | null,
  options?: RemoveWantToTryWithFeedOptions
): Promise<void> {
  const resolvedPostId = await resolveRadarPostId(
    userId,
    item,
    store,
    radarPostId,
    options?.fallbackRadarPostId
  );
  await deleteRadarFeedPost(userId, item, resolvedPostId);
  await removeFromWantToTry(userId, item, store);
  // The want-to-try entry may have been saved with a different store (often
  // empty when the user didn't pick one). Try removing with empty store too
  // so stale entries don't linger.
  if (store) {
    await removeFromWantToTry(userId, item, '').catch(() => {});
  }
}

export type RemoveWantToTryAfterRankingArgs = {
  item: string;
  descriptionKey?: string | null;
  productBrand?: string | null;
  radarPostIdHint?: string | number | null;
  /** Radar post converted to a ranking in-place — do not delete this post row. */
  keepRadarPostId?: string | number | null;
};

/**
 * After ranking, tear down every want-to-try row (and radar feed post) for this
 * product — matched by identity, not exact store string.
 */
export async function removeWantToTryAfterRanking(
  userId: string,
  args: RemoveWantToTryAfterRankingArgs
): Promise<void> {
  const itemTrim = String(args.item ?? '').trim();
  if (!itemTrim) return;

  const targetKey = productIdentityKey(itemTrim, args.descriptionKey, args.productBrand);

  const { data: wantRows, error } = await supabase
    .from('want_to_try')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;

  const matching = (wantRows ?? []).filter(
    (row) =>
      productIdentityKey(
        String(row.item ?? ''),
        undefined,
        String(row.product_brand ?? '')
      ) === targetKey
  );

  const keepId = postIdString(args.keepRadarPostId);
  const radarPostIds = new Set<string>();
  const hintId = postIdString(args.radarPostIdHint);
  if (hintId && hintId !== keepId) radarPostIds.add(hintId);
  for (const row of matching) {
    const id = postIdString(row.radar_post_id);
    if (id && id !== keepId) radarPostIds.add(id);
  }

  for (const id of radarPostIds) {
    await deleteRadarFeedPost(userId, itemTrim, id);
  }
  await deleteRadarFeedPost(userId, itemTrim, null);

  for (const row of matching) {
    await removeFromWantToTry(userId, row.item, row.store ?? '');
  }
}
