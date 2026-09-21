import {
  isLegitimateTraderJoesBrand,
  isPlaceholderCatalogBrand,
  isUnknownUserBrand,
  mergeProductBrand,
  mergeStoresForBrand,
  isTraderJoesBrandName,
  primaryGroceryStoreForKey,
  retailStoresForRow,
  storesForBrandAndSelections,
  exploreRetailStoresForProduct,
  stripLegacyDefaultTraderJoesStores,
} from '../constants/grocery';
import {
  HIGH_PROTEIN_LOW_CAL_ID,
  normalizeProfileDietTags,
  qualifiesHighProteinLowCalFromMacroForm,
} from '../constants/diet-tags';
import { normalizeBirthday } from './birthday';
import type { WantToTrySource } from './want-to-try-source';
import {
  parseFatSecretMacrosFromFoodPayload,
  type FatSecretMacroNumbers,
} from './fatsecret-nutrition';
import { AVATAR_COLORS } from '../constants/avatar-colors';
import {
  categoriesForRow,
  normalizeCategoriesList,
  primaryCategoryForRow,
  resolveSubcategoryId,
  rowMatchesCategoryFilter,
} from './categories';
import {
  getSubcategory,
  legacyCategoryForSubcategory,
  subcategoryForRow,
} from '../constants/categories';
import { usernameFromSession } from './auth';
import { pokeFeedRefresh } from './feed-refresh-poke';
import { removeStorageObjectsForPostPhotoUrls } from './post-photo-storage';
import { isFeedVisiblePost, isRankedReviewPost } from './post-feed-visibility';
import { supabase } from './supabase';
import {
  canonicalRatingsFromRankedRows,
  postNeedsRecategorization,
  clampBaggedScore,
  computeScoresByCategory,
  mapCategory,
  normalizeVibe,
  rankPositionSortValue,
  rankingScopeForRow,
  type Category,
  type Vibe,
} from './ranking';

export type FeedProfile = {
  id: string;
  username: string | null;
  avatar_color: string | null;
  is_verified_ambassador?: boolean | null;
};

export function profileIsVerifiedAmbassador(
  profile: { is_verified_ambassador?: boolean | null } | null | undefined
): boolean {
  return Boolean(profile?.is_verified_ambassador);
}

const PROFILE_SNIPPET_SELECT = 'id, username, avatar_color, is_verified_ambassador';
const PROFILE_EMBED_SELECT = 'username, avatar_color, is_verified_ambassador';

export type FeedPostRow = {
  id: string | number;
  user_id: string;
  item: string | null;
  description_key?: string | null;
  product_brand?: string | null;
  store?: string | null;
  stores?: string[] | null;
  category?: string | null;
  categories?: string[] | null;
  subcategory?: string | null;
  rating?: number | null;
  note?: string | null;
  diet_tags?: string[] | null;
  macros?: Record<string, unknown> | null;
  vibe?: string | null;
  photo_urls?: string[] | null;
  radar_only?: boolean | null;
  created_at?: string | null;
  /** When set (e.g. after re-rank), used with `created_at` for feed ordering. */
  updated_at?: string | null;
  profile: FeedProfile | null;
  likes: { post_id: string | number; user_id: string }[];
  /** Populated by `getFeed` after the main hydrate pass — defaults to 0. */
  commentCount?: number;
  /** Latest comment from someone else on the viewer's post — feed preview. */
  replyHighlight?: { username: string; preview: string; verified?: boolean } | null;
};

const PROFILE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProfileUuid(id: unknown): id is string {
  return typeof id === 'string' && PROFILE_ID_RE.test(id);
}

/** Coerce `posts.photo_urls` from Supabase (array, JSON string, or missing) into URL strings. */
export function normalizePhotoUrls(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const vals = Object.values(raw as Record<string, unknown>);
    const fromObj = vals.filter(
      (u): u is string => typeof u === 'string' && u.trim().length > 0
    );
    if (fromObj.length > 0) return fromObj;
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed: unknown = JSON.parse(t);
      if (Array.isArray(parsed)) {
        return parsed.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
      }
      if (parsed && typeof parsed === 'object') {
        return Object.values(parsed as Record<string, unknown>).filter(
          (u): u is string => typeof u === 'string' && u.trim().length > 0
        );
      }
    } catch {
      if (/^https?:\/\//i.test(t) || t.startsWith('data:')) return [t];
    }
  }
  return [];
}

/** `post-photos` bucket objects are world-readable — do not attach JWT headers (breaks some clients). */
export function isPublicPostPhotoStorageUrl(url: string): boolean {
  return /\/storage\/v1\/object\/public\/post-photos\//i.test(String(url ?? '').trim());
}

/** Union of photo URLs from posts, newest posts first within each post's list. */
export function collectProductPhotoUrlsFromPosts(
  posts: Array<{ photo_urls?: unknown; created_at?: string | null; id?: string | number }>
): string[] {
  const sorted = [...posts].sort((a, b) => {
    const tb = new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    if (tb !== 0) return tb;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of sorted) {
    for (const u of normalizePhotoUrls(p.photo_urls)) {
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

function mergePhotoUrlsOnRow<T extends { photo_urls?: unknown }>(primary: T, secondary: T): T {
  const merged = [
    ...new Set([...normalizePhotoUrls(primary.photo_urls), ...normalizePhotoUrls(secondary.photo_urls)]),
  ];
  return { ...primary, photo_urls: merged };
}

/** Case-insensitive username equality (for follow / profile matching). */
export function usernamesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const x = String(a ?? '').trim().toLowerCase();
  const y = String(b ?? '').trim().toLowerCase();
  return Boolean(x && y && x === y);
}

/** Canonical handle stored on `follows_by_username` (profiles use lowercase). */
export function normalizeFollowTargetUsername(username: string | null | undefined): string {
  return String(username ?? '').trim().toLowerCase();
}

function dedupeFollowerIds(rows: { follower_id?: string | null }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const id = String(row.follower_id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function countDistinctFollowingTargets(
  rows: { following_username?: string | null }[],
  excludeUsername = ''
): number {
  const exclude = normalizeFollowTargetUsername(excludeUsername);
  const seen = new Set<string>();
  for (const row of rows) {
    const target = normalizeFollowTargetUsername(row.following_username);
    if (!target || (exclude && target === exclude)) continue;
    seen.add(target);
  }
  return seen.size;
}

async function profileUsernameForUserId(userId: string): Promise<string> {
  if (!isProfileUuid(userId)) return '';
  const { data } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle();
  return String((data as { username?: string | null } | null)?.username ?? '').trim();
}

type ProfileSnippetRow = {
  id: string;
  username: string;
  avatar_color: string | null;
  is_verified_ambassador?: boolean | null;
};

/** Resolve profiles for follow handles (lowercase match — handles may be stale until sync). */
async function fetchProfilesByLowercaseUsernames(
  handles: string[]
): Promise<Map<string, ProfileSnippetRow>> {
  const unique = [
    ...new Set(handles.map((h) => normalizeFollowTargetUsername(h)).filter(Boolean)),
  ];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SNIPPET_SELECT)
    .in('username', unique);
  if (error) {
    console.warn('fetchProfilesByLowercaseUsernames:', error.message);
    return new Map();
  }
  const map = new Map<string, ProfileSnippetRow>();
  for (const row of (data ?? []) as ProfileSnippetRow[]) {
    const key = normalizeFollowTargetUsername(row.username);
    if (key) map.set(key, row);
  }
  return map;
}

/** True when `viewerId` would be following their own account. */
export async function isSelfFollowTarget(
  viewerId: string,
  targetUsername: string
): Promise<boolean> {
  if (!viewerId || !targetUsername.trim()) return false;
  const own = await profileUsernameForUserId(viewerId);
  return usernamesMatch(own, targetUsername);
}

/** Profile ids for `userId` plus everyone they follow (by username, case-insensitive). */
async function followerProfileIdsForFeed(userId: string): Promise<string[]> {
  if (!userId || !isProfileUuid(userId)) return [];
  const ownUsername = await profileUsernameForUserId(userId);
  const { data: follows } = await supabase
    .from('follows_by_username')
    .select('following_username')
    .eq('follower_id', userId);

  const followingUsernames = [
    ...new Set(
      (follows ?? [])
        .map((f: { following_username: string | null }) => f.following_username)
        .map((u) => normalizeFollowTargetUsername(u))
        .filter((u): u is string => Boolean(u))
        .filter((u) => !usernamesMatch(u, ownUsername))
    ),
  ];
  if (followingUsernames.length === 0) return [userId];

  const profileByHandle = await fetchProfilesByLowercaseUsernames(followingUsernames);
  const ids = followingUsernames
    .map((handle) => profileByHandle.get(handle)?.id)
    .filter((id): id is string => isProfileUuid(id));
  return [...new Set([userId, ...ids])].filter((id) => isProfileUuid(id));
}

/** People the viewer follows, excluding the viewer — for Discover "following" rail. */
export async function getFollowingProfileIdsOnly(userId: string): Promise<string[]> {
  const merged = await followerProfileIdsForFeed(userId);
  return merged.filter((id) => id !== userId);
}

/**
 * PostgREST resource embeddings (`profile:user_id`, `likes`) return 400 if FK
 * names / hints don't match the live schema. Fetch plain rows and join in the
 * client instead — same approach as the web app.
 */
async function hydratePostsWithProfileAndLikes(
  rawPosts: Omit<FeedPostRow, 'profile' | 'likes'>[]
): Promise<FeedPostRow[]> {
  const posts = rawPosts ?? [];
  if (posts.length === 0) return [];

  const userIds = [...new Set(posts.map((p) => p.user_id).filter(Boolean))];
  const postIds = [...new Set(posts.map((p) => p.id).filter((id) => id != null))];

  const [{ data: profiles }, { data: likesRows }] = await Promise.all([
    userIds.length > 0
      ? supabase
          .from('profiles')
          .select(PROFILE_SNIPPET_SELECT)
          .in('id', userIds)
      : Promise.resolve({ data: [] as FeedProfile[] }),
    postIds.length > 0
      ? supabase.from('likes').select('post_id, user_id').in('post_id', postIds)
      : Promise.resolve({ data: [] as { post_id: string | number; user_id: string }[] }),
  ]);

  const profById = new Map<string, FeedProfile>(
    (profiles ?? []).map((p: FeedProfile) => [String(p.id), p])
  );
  const likesByPost = new Map<string, { post_id: string | number; user_id: string }[]>();
  for (const l of likesRows ?? []) {
    const pid = String(l.post_id);
    if (!likesByPost.has(pid)) likesByPost.set(pid, []);
    likesByPost.get(pid)!.push(l);
  }

  return posts.map((p) => {
    const uid = p.user_id != null ? String(p.user_id) : '';
    const pid = p.id != null ? String(p.id) : '';
    return {
      ...p,
      photo_urls: normalizePhotoUrls(p.photo_urls),
      profile: profById.get(uid) ?? null,
      likes: (pid && likesByPost.get(pid)) || [],
    } satisfies FeedPostRow;
  });
}

async function fetchPostsForUsersWithOrdering(
  userIds: string[],
  limit = 50
): Promise<Omit<FeedPostRow, 'profile' | 'likes'>[]> {
  const cleanIds = [...new Set(userIds.map(String).filter(isProfileUuid))];
  if (cleanIds.length === 0) return [];
  const base = () => supabase.from('posts').select('*').in('user_id', cleanIds);
  const attempts = [
    () => base().order('updated_at', { ascending: false }).limit(limit),
    () => base().order('created_at', { ascending: false }).limit(limit),
    () => base().order('id', { ascending: false }).limit(limit),
    () => base().limit(limit),
  ];
  let lastErr: unknown = null;
  for (const run of attempts) {
    const { data, error } = await run();
    if (!error) return (data ?? []) as Omit<FeedPostRow, 'profile' | 'likes'>[];
    lastErr = error;
  }
  console.warn(
    'fetchPostsForUsersWithOrdering: all order attempts failed',
    (lastErr as { message?: string })?.message ?? lastErr
  );
  return [];
}

function feedActivityTimestampMs(row: {
  created_at?: string | null;
  updated_at?: string | null;
}): number {
  const c = new Date(row.created_at ?? 0).getTime();
  const u = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  return Math.max(c, u);
}

function mergeDietTagsForDisplay(
  postTags: string[] | null | undefined,
  catalogTags: string[] | null | undefined
): string[] {
  const post = (postTags ?? []).map((t) => String(t ?? '').trim()).filter(Boolean);
  const catalog = (catalogTags ?? []).map((t) => String(t ?? '').trim()).filter(Boolean);
  return [...new Set([...post, ...catalog])];
}

/** All description keys that may point at the same product (legacy item-only, item::brand, alias). */
export function catalogLookupKeysForProductIdentity(args: {
  item: string;
  brand?: string | null;
  descriptionKey?: string | null;
}): string[] {
  const item = String(args.item ?? '').trim();
  const brand = String(args.brand ?? '').trim();
  const explicit = String(args.descriptionKey ?? '').trim().toLowerCase();
  const keys = new Set<string>();
  if (explicit) keys.add(explicit);
  const branded = productDescriptionKey(item, brand);
  if (branded) keys.add(branded);
  const legacy = normalizedDescriptionKeyFromItem(item);
  if (legacy) keys.add(legacy);
  return [...keys];
}

function findCuratedCatalogForPost(
  catalogByKey: Map<string, VerifiedCuratedNutrition>,
  post: {
    item?: string | null;
    description_key?: string | null;
    product_brand?: string | null;
  },
  resolvedKeys?: string[]
): VerifiedCuratedNutrition | null {
  const lookupKeys =
    resolvedKeys ??
    catalogLookupKeysForProductIdentity({
      item: String(post.item ?? ''),
      brand: post.product_brand,
      descriptionKey: post.description_key,
    });
  for (const k of lookupKeys) {
    const hit = catalogByKey.get(k);
    if (hit) return hit;
  }
  return null;
}

function postMacrosToRecord(macros: PostMacros): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (macroFieldIsSet(macros.cal)) out.cal = macros.cal;
  if (macroFieldIsSet(macros.protein)) out.protein = macros.protein;
  if (macroFieldIsSet(macros.carbs)) out.carbs = macros.carbs;
  if (macroFieldIsSet(macros.fat)) out.fat = macros.fat;
  if (macros.servingLabel) out.servingLabel = macros.servingLabel;
  return out;
}

function sharedCatalogMacrosEqual(a: PostMacros | null, b: PostMacros | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.cal === b.cal &&
    a.protein === b.protein &&
    a.carbs === b.carbs &&
    a.fat === b.fat &&
    (a.servingLabel ?? '') === (b.servingLabel ?? '')
  );
}

async function fetchCuratedCatalogByDescriptionKeys(
  keys: string[],
  aliasMap?: Map<string, string[]>
): Promise<Map<string, VerifiedCuratedNutrition>> {
  const clean = [...new Set(keys.map((k) => String(k ?? '').trim().toLowerCase()).filter(Boolean))];
  if (!clean.length) return new Map();

  const { data, error } = await supabase.from('curated_products').select('*').in('description_key', clean);
  if (error) {
    console.warn('fetchCuratedCatalogByDescriptionKeys:', error.message);
    return new Map();
  }

  const map = new Map<string, VerifiedCuratedNutrition>();
  for (const row of data ?? []) {
    const key = String((row as { description_key?: string | null }).description_key ?? '')
      .trim()
      .toLowerCase();
    if (!key) continue;
    map.set(key, shapeCuratedNutritionFromRow(row as Record<string, unknown>));
  }
  return indexCuratedCatalogWithAliasKeys(map, aliasMap);
}

/** Register each catalog row under legacy alias keys so post rows still resolve after renames. */
async function indexCuratedCatalogWithAliasKeys(
  map: Map<string, VerifiedCuratedNutrition>,
  aliasMap?: Map<string, string[]>
): Promise<Map<string, VerifiedCuratedNutrition>> {
  if (map.size === 0) return map;
  const indexed = new Map(map);
  for (const [canonicalKey, row] of map.entries()) {
    const aliases = aliasMap?.get(canonicalKey) ?? (await resolveAliasKeysForCanonical(canonicalKey));
    for (const aliasKey of aliases) {
      if (!indexed.has(aliasKey)) indexed.set(aliasKey, row);
    }
  }
  return indexed;
}

async function fetchCuratedProductRowsByIdentity(
  item: string,
  brand = '',
  descriptionKey = ''
): Promise<Record<string, unknown>[]> {
  const desc = String(item ?? '').trim();
  if (!desc) return [];
  const identityKeys = await collectIdentityKeysForMetadataSync(
    desc,
    descriptionKey || productDescriptionKey(desc, brand),
    brand
  );
  if (identityKeys.length === 0) return [];
  const { data, error } = await supabase
    .from('curated_products')
    .select('*')
    .in('description_key', identityKeys);
  if (error) {
    console.warn('fetchCuratedProductRowsByIdentity:', error.message);
    return [];
  }
  return (data ?? []) as Record<string, unknown>[];
}

function pickBestCuratedProfileRow(
  rows: Record<string, unknown>[],
  brand: string
): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  const candidates = rows.filter((row) => {
    const rowBrand = String(row.brand ?? '').trim();
    if (isUnknownUserBrand(brand) || !normalizedBrandKey(brand)) return true;
    return brandsMatchForProductIdentity(rowBrand, brand);
  });
  const pool = candidates.length > 0 ? candidates : rows;
  const ranked = [...pool].sort((a, b) => {
    const aVerified =
      String(a.nutrition_verification_state ?? a.nutritionVerification ?? '') === 'verified' ? 1 : 0;
    const bVerified =
      String(b.nutrition_verification_state ?? b.nutritionVerification ?? '') === 'verified' ? 1 : 0;
    if (bVerified !== aVerified) return bVerified - aVerified;
    const aBrand = String(a.brand ?? '').trim();
    const bBrand = String(b.brand ?? '').trim();
    const aSpecific = isUnknownUserBrand(aBrand) ? 0 : 1;
    const bSpecific = isUnknownUserBrand(bBrand) ? 0 : 1;
    return bSpecific - aSpecific;
  });
  return ranked[0] ?? null;
}

/** True when the post row has an explicit, valid `subcategory` id (not a legacy fallback). */
function postHasValidStoredSubcategory(row: { subcategory?: string | null }): boolean {
  const stored = String(row.subcategory ?? '').trim();
  return Boolean(stored && getSubcategory(stored));
}

/** Overlay shared catalog stores, diet tags, and macros onto post-like rows for display. */
async function enrichPostsWithSharedCatalogMetadata<
  T extends {
    item?: string | null;
    description_key?: string | null;
    product_brand?: string | null;
    store?: string | null;
    stores?: string[] | null;
    category?: string | null;
    categories?: string[] | null;
    subcategory?: string | null;
    diet_tags?: string[] | null;
    macros?: Record<string, unknown> | null;
  },
>(posts: T[]): Promise<T[]> {
  if (!posts.length) return posts;

  const keys = [
    ...new Set(
      posts.flatMap((p) =>
        catalogLookupKeysForProductIdentity({
          item: String(p.item ?? ''),
          brand: p.product_brand,
          descriptionKey: p.description_key,
        })
      )
    ),
  ];
  if (!keys.length) return posts;

  const canonicalByKey = await batchResolveCanonicalProductDescriptionKeys(keys);
  const canonicalKeys = keys.map((k) => canonicalByKey.get(k) ?? k);
  const uniqueAliasLookupKeys = [...new Set([...keys, ...canonicalKeys])];
  const aliasKeysByCanonical = await batchResolveAliasKeysForCanonicals(uniqueAliasLookupKeys);
  const allAliasKeys = uniqueAliasLookupKeys.flatMap((k) => aliasKeysByCanonical.get(k) ?? []);
  const catalogByKey = await fetchCuratedCatalogByDescriptionKeys(
    [...new Set([...keys, ...canonicalKeys, ...allAliasKeys])],
    aliasKeysByCanonical
  );

  const resolvedKeysByPost = new Map<string, string[]>();
  for (const post of posts) {
    const base = catalogLookupKeysForProductIdentity({
      item: String(post.item ?? ''),
      brand: post.product_brand,
      descriptionKey: post.description_key,
    });
    const expanded = new Set(base);
    for (const key of base) {
      const canonical = canonicalByKey.get(key) ?? key;
      if (canonical) expanded.add(canonical);
    }
    const postKey = String(post.description_key ?? post.item ?? '');
    resolvedKeysByPost.set(postKey, [...expanded]);
  }

  return posts.map((post) => {
    const curated = findCuratedCatalogForPost(
      catalogByKey,
      post,
      resolvedKeysByPost.get(String(post.description_key ?? post.item ?? ''))
    );
    if (!curated) return post;

    let next = post;
    const catalogBrand = String(curated.brand ?? '').trim();
    const postBrand = String(post.product_brand ?? '').trim();
    const displayBrand = mergeProductBrand(catalogBrand, postBrand);
    if (displayBrand && displayBrand !== postBrand) {
      next = { ...next, product_brand: displayBrand };
    }

    const catalogTags = (curated.diet_tags ?? [])
      .map((t) => String(t ?? '').trim())
      .filter(Boolean);
    const existingTags = Array.isArray(post.diet_tags)
      ? post.diet_tags.map((t) => String(t ?? '').trim()).filter(Boolean)
      : [];
    const displayTags =
      catalogTags.length > 0
        ? catalogTags
        : mergeDietTagsForDisplay(post.diet_tags, curated.diet_tags);
    if (
      displayTags.length !== existingTags.length ||
      !displayTags.every((t, i) => t === existingTags[i])
    ) {
      next = { ...next, diet_tags: displayTags };
    }

    const curatedStores = retailStoresForRow({
      stores: curated.stores,
      store: curated.stores[0] ?? '',
      product_brand: String(post.product_brand ?? '').trim() || curated.brand,
    });
    if (curatedStores.length > 0) {
      const primary = curatedStores[0] ?? '';
      if (
        String(post.store ?? '').trim() !== primary ||
        JSON.stringify(post.stores ?? []) !== JSON.stringify(curatedStores)
      ) {
        next = { ...next, store: primary, stores: curatedStores };
      }
    }

    const sharedMacros = resolveProductProfileMacros({ curated, posts: [post] });
    if (sharedMacros) {
      const existingMacros = normalizePostMacros(post.macros);
      if (!sharedCatalogMacrosEqual(existingMacros, sharedMacros)) {
        next = { ...next, macros: postMacrosToRecord(sharedMacros) };
      }
    }

    const catalogSub = String(curated.stored_subcategory ?? '').trim();
    if (
      !postHasValidStoredSubcategory(post) &&
      catalogSub &&
      getSubcategory(catalogSub)
    ) {
      const legacyCat = legacyCategoryForSubcategory(catalogSub);
      next = {
        ...next,
        subcategory: catalogSub,
        category: legacyCat,
        categories: [legacyCat],
      };
    }

    return next;
  });
}

/** Attach globally saved catalog diet tags when post rows are missing them. */
async function enrichFeedPostsWithCatalogDietTags(posts: FeedPostRow[]): Promise<FeedPostRow[]> {
  return enrichPostsWithSharedCatalogMetadata(posts);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** All ranked posts for a set of authors — used to derive canonical display scores. */
export async function fetchRankedPostsForUserIds(userIds: string[]): Promise<RankedPostRow[]> {
  const ids = [...new Set(userIds.map((id) => String(id).trim()).filter(isProfileUuid))];
  if (ids.length === 0) return [];
  const batches = await mapWithConcurrency(ids, 6, (id) => getUserRankings(id));
  return batches.flat();
}

async function buildCanonicalRatingMapsForAuthors(
  authorIds: string[]
): Promise<CanonicalRatingMaps> {
  const merged: CanonicalRatingMaps = { byPostId: new Map(), byUserProduct: new Map() };
  await mapWithConcurrency(authorIds, 6, async (uid) => {
    const ranked = await getUserRankings(uid);
    const tried = ranked.filter((r) => !isRadarOnlyDbRow(r));
    const scored = canonicalRatingsFromRankedRows(
      tried.map((p) => ({ ...p, vibe: normalizeVibe(p.vibe) }))
    );
    void persistCanonicalRatingDrift(uid, scored, tried);
    for (const row of scored) {
      if (row.id == null) continue;
      const rating = clampBaggedScore(Number(row.rating));
      merged.byPostId.set(String(row.id), rating);
      const authorId = String(row.user_id ?? uid).trim();
      if (authorId) merged.byUserProduct.set(canonicalUserProductKey(authorId, row), rating);
    }
  });
  return merged;
}

export type CanonicalRatingMaps = {
  byPostId: Map<string, number>;
  /** `${userId}::${description_key}` — stable when duplicate post rows exist for one product. */
  byUserProduct: Map<string, number>;
};

function canonicalUserProductKey(
  userId: string,
  row: { description_key?: string | null; item?: string | null }
): string {
  const uid = String(userId ?? '').trim();
  const dk = itemIdentityKeyFromRow(row as RawPostForProduct);
  return `${uid}::${dk}`;
}

/** Map canonical scores by post id and by user+product (matches My List algorithm). */
export function buildCanonicalRatingMapsFromRankedPosts(
  rankedPosts: RankedPostRow[]
): CanonicalRatingMaps {
  const byPostId = new Map<string, number>();
  const byUserProduct = new Map<string, number>();
  const byUser = new Map<string, RankedPostRow[]>();
  for (const row of rankedPosts) {
    const uid = String(row.user_id ?? '');
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push(row);
  }
  for (const rows of byUser.values()) {
    const scored = canonicalRatingsFromRankedRows(rows.filter((r) => !isRadarOnlyDbRow(r)));
    for (const row of scored) {
      if (row.id == null) continue;
      const rating = clampBaggedScore(Number(row.rating));
      const postId = String(row.id);
      byPostId.set(postId, rating);
      const uid = String(row.user_id ?? '').trim();
      if (uid) byUserProduct.set(canonicalUserProductKey(uid, row), rating);
    }
  }
  return { byPostId, byUserProduct };
}

/** @deprecated Use buildCanonicalRatingMapsFromRankedPosts */
export function buildCanonicalRatingMapFromRankedPosts(
  rankedPosts: RankedPostRow[]
): Map<string, number> {
  return buildCanonicalRatingMapsFromRankedPosts(rankedPosts).byPostId;
}

export function resolveCanonicalRatingForPost(
  row: {
    id?: string | number | null;
    user_id?: string | null;
    description_key?: string | null;
    item?: string | null;
    rating?: number | null;
    radar_only?: boolean | null;
  },
  maps: CanonicalRatingMaps
): number | null {
  if (isRadarOnlyDbRow(row)) return null;
  const byId = row.id != null ? maps.byPostId.get(String(row.id)) : undefined;
  if (byId != null && Number.isFinite(byId)) return clampBaggedScore(byId);
  const uid = String(row.user_id ?? '').trim();
  if (uid) {
    const byProduct = maps.byUserProduct.get(canonicalUserProductKey(uid, row));
    if (byProduct != null && Number.isFinite(byProduct)) return clampBaggedScore(byProduct);
  }
  const raw = Number(row.rating);
  return Number.isFinite(raw) ? clampBaggedScore(raw) : null;
}

function applyCanonicalRatingMapsToPosts<T extends FeedPostRow>(
  posts: T[],
  maps: CanonicalRatingMaps
): T[] {
  return posts.map((row) => {
    const canonical = resolveCanonicalRatingForPost(row, maps);
    if (canonical == null) return row;
    return { ...row, rating: canonical };
  });
}

/** Push computed ratings to `posts` when they drift — keeps DB aligned for other clients. */
export async function persistCanonicalRatingDrift(
  userId: string,
  scoredRows: Array<{ id?: string | number | null; rating: number }>,
  dbRows: RankedPostRow[]
): Promise<void> {
  if (!userId || !isProfileUuid(userId) || !scoredRows.length || !dbRows.length) return;
  const prev = new Map(dbRows.map((p) => [String(p.id), Number(p.rating)]));
  const ops: Promise<void>[] = [];
  for (const row of scoredRows) {
    if (row.id == null || !isProfileUuid(String(row.id))) continue;
    const before = prev.get(String(row.id));
    const next = Number(row.rating);
    if (before == null || !Number.isFinite(next)) continue;
    if (Math.abs(before - next) < 0.02) continue;
    ops.push(
      (async () => {
        const { error } = await supabase
          .from('posts')
          .update({ rating: next })
          .eq('id', row.id)
          .eq('user_id', userId);
        if (error) console.warn('persistCanonicalRatingDrift:', error.message);
      })()
    );
  }
  if (ops.length === 0) return;
  await Promise.all(ops);
}

async function applyCanonicalRatingsToFeedPosts(
  posts: FeedPostRow[],
  viewerUserId?: string
): Promise<FeedPostRow[]> {
  if (posts.length === 0) return posts;
  const authorIds = [...new Set(posts.map((p) => String(p.user_id)).filter(isProfileUuid))];
  const maps = await buildCanonicalRatingMapsForAuthors(authorIds);
  void viewerUserId;
  return applyCanonicalRatingMapsToPosts(posts, maps);
}

export async function getFeed(userId: string): Promise<FeedPostRow[]> {
  if (!userId) return [];
  try {
    const followingIds = await followerProfileIdsForFeed(userId);
    if (followingIds.length === 0) return [];
    const rows = await fetchPostsForUsersWithOrdering(followingIds, 120);
    const visible = (rows as RawPostForProduct[]).filter(isFeedVisiblePost);
    const deduped = dedupePostsByUserItemStore(visible);
    deduped.sort((a, b) => {
      const tb = feedActivityTimestampMs(b) - feedActivityTimestampMs(a);
      if (tb !== 0) return tb;
      const ida = Number(a.id) || 0;
      const idb = Number(b.id) || 0;
      return idb - ida;
    });
    const hydrated = await hydratePostsWithProfileAndLikes(deduped);
    const enriched = await enrichFeedPostsWithCatalogDietTags(hydrated);
    const commentCounts = await fetchCommentCountsForPosts(enriched.map((r) => String(r.id)));
    const withCounts = enriched.map((row) => ({
      ...row,
      commentCount: commentCounts.get(String(row.id)) ?? 0,
    }));
    const withHighlights = await attachReplyHighlightsForViewer(withCounts, userId);
    return applyCanonicalRatingsToFeedPosts(withHighlights, userId);
  } catch (e) {
    console.warn('getFeed failed:', (e as { message?: string })?.message ?? e);
    return [];
  }
}

function latestOthersCommentHighlight(
  comments: Array<{
    user_id: string;
    content: string | null;
    created_at: string;
    profile: {
      username: string | null;
      avatar_color: string | null;
      is_verified_ambassador?: boolean | null;
    } | null;
  }>,
  postAuthorUserId: string
): { username: string; preview: string; verified?: boolean } | null {
  const others = comments.filter((c) => String(c.user_id) !== String(postAuthorUserId));
  if (others.length === 0) return null;
  others.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const c = others[0];
  const preview = String(c.content ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  if (!preview) return null;
  const username = String(c.profile?.username ?? '').trim() || 'unknown';
  return { username, preview, verified: profileIsVerifiedAmbassador(c.profile) };
}

async function attachReplyHighlightsForViewer(
  posts: FeedPostRow[],
  viewerId: string
): Promise<FeedPostRow[]> {
  const myPostIds = posts
    .filter((p) => String(p.user_id) === String(viewerId))
    .map((p) => String(p.id))
    .filter(Boolean);
  if (myPostIds.length === 0) return posts;

  const { data: commentRows, error } = await supabase
    .from('comments')
    .select(`user_id, post_id, content, created_at, profile:user_id (${PROFILE_EMBED_SELECT})`)
    .in('post_id', myPostIds)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('attachReplyHighlightsForViewer:', error.message);
    return posts;
  }

  type Prof = {
    username: string | null;
    avatar_color: string | null;
    is_verified_ambassador?: boolean | null;
  };
  type RawRow = {
    user_id: string;
    post_id: string;
    content: string | null;
    created_at: string;
    profile: Prof | Prof[] | null;
  };
  const byPost = new Map<
    string,
    Array<{
      user_id: string;
      content: string | null;
      created_at: string;
      profile: { username: string | null; avatar_color: string | null } | null;
    }>
  >();
  for (const row of (commentRows ?? []) as unknown as RawRow[]) {
    const pid = String(row.post_id ?? '');
    if (!pid) continue;
    const p = row.profile;
    const prof = Array.isArray(p) ? p[0] : p;
    const normalized = {
      user_id: String(row.user_id),
      content: row.content,
      created_at: row.created_at,
      profile: prof ?? null,
    };
    if (!byPost.has(pid)) byPost.set(pid, []);
    byPost.get(pid)!.push(normalized);
  }

  return posts.map((p) => {
    if (String(p.user_id) !== String(viewerId)) return p;
    const highlight = latestOthersCommentHighlight(byPost.get(String(p.id)) ?? [], viewerId);
    return highlight ? { ...p, replyHighlight: highlight } : p;
  });
}

/** Hydrated feed post for the comments thread header (any post id). */
export async function fetchFeedPostById(postId: string | number): Promise<FeedPostRow | null> {
  const pid = String(postId ?? '').trim();
  if (!pid) return null;
  const { data, error } = await supabase.from('posts').select('*').eq('id', pid).maybeSingle();
  if (error) {
    console.warn('fetchFeedPostById:', error.message);
    return null;
  }
  if (!data) return null;
  const [hydrated] = await hydratePostsWithProfileAndLikes([
    data as Omit<FeedPostRow, 'profile' | 'likes'>,
  ]);
  const commentCounts = await fetchCommentCountsForPosts([pid]);
  const row = {
    ...hydrated,
    commentCount: commentCounts.get(pid) ?? 0,
  };
  const uid = String(row.user_id ?? '').trim();
  if (!isProfileUuid(uid) || isRadarOnlyDbRow(row)) return row;
  const allRanked = await fetchRankedPostsForUserIds([uid]);
  const maps = buildCanonicalRatingMapsFromRankedPosts(allRanked);
  const authorRows = allRanked.filter((r) => String(r.user_id) === uid);
  const authorScored = canonicalRatingsFromRankedRows(
    authorRows.filter((r) => !isRadarOnlyDbRow(r))
  );
  void persistCanonicalRatingDrift(uid, authorScored, authorRows);
  const canonical = resolveCanonicalRatingForPost(row, maps);
  if (canonical == null) return row;
  return { ...row, rating: canonical };
}

/**
 * Fetch counts in a single round-trip and bucket client-side. Avoids the SQL
 * `count(*) … group by` we'd need on the server side and keeps the function
 * pure-JS.
 */
async function fetchCommentCountsForPosts(postIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (postIds.length === 0) return counts;
  const { data, error } = await supabase.from('comments').select('post_id').in('post_id', postIds);
  if (error) {
    console.warn('fetchCommentCountsForPosts:', error.message);
    return counts;
  }
  for (const row of (data ?? []) as { post_id: string | null }[]) {
    if (!row.post_id) continue;
    counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
  }
  return counts;
}

// ─── Product detail (global community + curated) ─────────────────────────────

export function normalizedDescriptionKeyFromItem(description: string): string {
  return String(description ?? '').trim().toLowerCase();
}

export function normalizedBrandKey(brand: string | null | undefined): string {
  return String(brand ?? '').trim().toLowerCase();
}

/** Stable cross-table product identity — item name plus brand when known. */
export function productDescriptionKey(
  description: string,
  brand?: string | null
): string {
  const itemKey = normalizedDescriptionKeyFromItem(description);
  const brandKey = normalizedBrandKey(brand);
  if (!itemKey) return brandKey;
  if (!brandKey) return itemKey;
  return `${itemKey}::${brandKey}`;
}

export function brandsMatchForProductIdentity(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (isUnknownUserBrand(a) || isUnknownUserBrand(b)) return true;
  return normalizedBrandKey(a) === normalizedBrandKey(b);
}

/** Prefer explicit key; otherwise derive item + brand identity. */
export function resolveProductDescriptionKey(args: {
  item: string;
  brand?: string | null;
  descriptionKey?: string | null;
}): string {
  const explicit = String(args.descriptionKey ?? '').trim().toLowerCase();
  const derived = productDescriptionKey(args.item, args.brand);
  if (!explicit) return derived;
  if (normalizedBrandKey(args.brand) && !explicit.includes('::')) return derived;
  return explicit;
}

const canonicalDescriptionKeyCache = new Map<string, string>();
const aliasKeysByCanonicalCache = new Map<string, string[]>();

/** Batch-resolve canonical keys; populates `canonicalDescriptionKeyCache`. */
async function batchResolveCanonicalProductDescriptionKeys(
  keys: string[]
): Promise<Map<string, string>> {
  const clean = [...new Set(keys.map((k) => String(k ?? '').trim().toLowerCase()).filter(Boolean))];
  const result = new Map<string, string>();
  if (!clean.length) return result;

  for (const k of clean) {
    const cached = canonicalDescriptionKeyCache.get(k);
    if (cached) result.set(k, cached);
  }

  const uncached = clean.filter((k) => !result.has(k));
  if (uncached.length > 0) {
    const aliasToCanonical = new Map<string, string>();
    const { data, error } = await supabase
      .from('product_identity_aliases')
      .select('alias_key, canonical_key')
      .in('alias_key', uncached);
    if (error) {
      console.warn('batchResolveCanonicalProductDescriptionKeys:', error.message);
    } else {
      for (const row of data ?? []) {
        const aliasKey = String((row as { alias_key?: unknown }).alias_key ?? '')
          .trim()
          .toLowerCase();
        const canonical = String((row as { canonical_key?: unknown }).canonical_key ?? '')
          .trim()
          .toLowerCase();
        if (aliasKey && canonical) aliasToCanonical.set(aliasKey, canonical);
      }
    }

    for (const k of uncached) {
      const resolved = aliasToCanonical.get(k) ?? k;
      canonicalDescriptionKeyCache.set(k, resolved);
      if (resolved !== k) canonicalDescriptionKeyCache.set(resolved, resolved);
      result.set(k, resolved);
    }
  }

  return result;
}

/** Batch-resolve alias keys; populates `aliasKeysByCanonicalCache`. */
async function batchResolveAliasKeysForCanonicals(
  canonicalKeys: string[]
): Promise<Map<string, string[]>> {
  const clean = [...new Set(canonicalKeys.map((k) => String(k ?? '').trim().toLowerCase()).filter(Boolean))];
  const result = new Map<string, string[]>();
  if (!clean.length) return result;

  for (const k of clean) {
    const cached = aliasKeysByCanonicalCache.get(k);
    if (cached) result.set(k, cached);
  }

  const uncached = clean.filter((k) => !result.has(k));
  if (uncached.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const k of uncached) grouped.set(k, []);

    const { data, error } = await supabase
      .from('product_identity_aliases')
      .select('alias_key, canonical_key')
      .in('canonical_key', uncached);
    if (error) {
      console.warn('batchResolveAliasKeysForCanonicals:', error.message);
    } else {
      for (const row of data ?? []) {
        const aliasKey = String((row as { alias_key?: unknown }).alias_key ?? '')
          .trim()
          .toLowerCase();
        const canonicalKey = String((row as { canonical_key?: unknown }).canonical_key ?? '')
          .trim()
          .toLowerCase();
        if (!aliasKey || !canonicalKey) continue;
        const list = grouped.get(canonicalKey) ?? [];
        list.push(aliasKey);
        grouped.set(canonicalKey, list);
      }
    }

    for (const k of uncached) {
      const aliases = grouped.get(k) ?? [];
      aliasKeysByCanonicalCache.set(k, aliases);
      result.set(k, aliases);
    }
  }

  return result;
}

/** Follow `product_identity_aliases` (e.g. renamed TJ catalog titles). */
export async function resolveCanonicalProductDescriptionKey(
  descriptionKey: string
): Promise<string> {
  const key = String(descriptionKey ?? '').trim().toLowerCase();
  if (!key) return key;
  const cached = canonicalDescriptionKeyCache.get(key);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('product_identity_aliases')
    .select('canonical_key')
    .eq('alias_key', key)
    .maybeSingle();
  if (error) {
    console.warn('resolveCanonicalProductDescriptionKey:', error.message);
    canonicalDescriptionKeyCache.set(key, key);
    return key;
  }
  const canonical = String((data as { canonical_key?: unknown } | null)?.canonical_key ?? '')
    .trim()
    .toLowerCase();
  const resolved = canonical || key;
  canonicalDescriptionKeyCache.set(key, resolved);
  if (resolved !== key) canonicalDescriptionKeyCache.set(resolved, resolved);
  return resolved;
}

/** All legacy keys that were merged into this canonical identity. */
async function resolveAliasKeysForCanonical(canonicalKey: string): Promise<string[]> {
  const key = String(canonicalKey ?? '').trim().toLowerCase();
  if (!key) return [];
  const cached = aliasKeysByCanonicalCache.get(key);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('product_identity_aliases')
    .select('alias_key')
    .eq('canonical_key', key);
  if (error) {
    console.warn('resolveAliasKeysForCanonical:', error.message);
    aliasKeysByCanonicalCache.set(key, []);
    return [];
  }
  const aliases = (data ?? [])
    .map((row) => String((row as { alias_key?: unknown }).alias_key ?? '').trim().toLowerCase())
    .filter(Boolean);
  aliasKeysByCanonicalCache.set(key, aliases);
  return aliases;
}

/** Stable product identity for deduping want-to-try vs ranked posts. */
export function productIdentityKey(
  item: string,
  descriptionKey?: string | null,
  brand?: string | null
): string {
  return resolveProductDescriptionKey({ item, brand, descriptionKey });
}

/** Hide want-to-try rows that already have a ranked post for the same product. */
export function filterWantToTryExcludingRanked(
  wants: WantToTryItem[],
  ranked: RankedPostRow[]
): WantToTryItem[] {
  const rankedKeys = new Set(
    ranked.map((r) => productIdentityKey(r.item, r.description_key, r.product_brand))
  );
  return wants.filter(
    (w) => !rankedKeys.has(productIdentityKey(w.item, undefined, w.brand))
  );
}

type RawPostForProduct = Omit<FeedPostRow, 'profile' | 'likes' | 'commentCount'>;

function primaryStoreNormForProduct(row: {
  store?: string | null;
  stores?: string[] | null;
  product_brand?: string | null;
}): string {
  return primaryGroceryStoreForKey(row).toLowerCase();
}

function itemIdentityKeyFromRow(row: RawPostForProduct): string {
  const dk = String(row.description_key ?? '').trim().toLowerCase();
  if (dk) return dk;
  return String(row.item ?? '').trim().toLowerCase();
}

function dedupePostsByUserItemStore(rows: RawPostForProduct[]): RawPostForProduct[] {
  const byKey = new Map<string, RawPostForProduct>();
  const rowKey = (row: RawPostForProduct) => {
    const uid = String(row.user_id ?? '');
    const ik = itemIdentityKeyFromRow(row);
    const st = primaryStoreNormForProduct(row);
    return `${uid}::${ik}::${st}`;
  };
  const score = (row: RawPostForProduct) => {
    const radar = row.radar_only === true;
    const ranked = !radar || hasTriedScore(row.rating);
    const quality = ranked ? 2 : 0;
    const ts = new Date(row.created_at ?? 0).getTime();
    const photoN = normalizePhotoUrls(row.photo_urls).length;
    const idNum = Number(row.id) || 0;
    return [quality, ts, photoN, idNum] as const;
  };
  const better = (a: RawPostForProduct, b: RawPostForProduct) => {
    const sa = score(a);
    const sb = score(b);
    if (sa[0] !== sb[0]) return sa[0] > sb[0];
    if (sa[1] !== sb[1]) return sa[1] > sb[1];
    if (sa[2] !== sb[2]) return sa[2] > sb[2];
    return sa[3] > sb[3];
  };
  for (const row of rows) {
    if (!String(row.user_id ?? '').trim()) continue;
    const k = rowKey(row);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, row);
    } else if (better(row, prev)) {
      byKey.set(k, mergePhotoUrlsOnRow(row, prev));
    } else {
      byKey.set(k, mergePhotoUrlsOnRow(prev, row));
    }
  }
  return [...byKey.values()];
}

/**
 * Removes extra ranked rows for the same user + product identity + primary store
 * (keeps `keepPostId`). Call after a re-rank update so legacy duplicate inserts
 * disappear from the DB, not just the feed.
 */
export async function deleteOtherUserRankedPostsSameSlot(
  userId: string,
  keepPostId: string | number,
  identity: {
    descriptionKey: string;
    itemFallback: string;
    primaryStoreNorm: string;
  }
): Promise<void> {
  const uid = String(userId ?? '').trim();
  if (!uid || !isProfileUuid(uid)) return;
  const dk =
    String(identity.descriptionKey ?? '').trim().toLowerCase() ||
    normalizedDescriptionKeyFromItem(identity.itemFallback);
  if (!dk) return;

  const storeWant = String(identity.primaryStoreNorm ?? '').trim().toLowerCase();

  const { data, error } = await supabase
    .from('posts')
    .select('id, item, description_key, store, stores, radar_only, photo_urls')
    .eq('user_id', uid)
    .eq('description_key', dk);

  if (error) {
    console.warn('deleteOtherUserRankedPostsSameSlot:', error.message);
    return;
  }

  let mergedPhotos: string[] = [];
  const { data: keepRow } = await supabase
    .from('posts')
    .select('photo_urls')
    .eq('id', keepPostId)
    .eq('user_id', uid)
    .maybeSingle();
  mergedPhotos = normalizePhotoUrls((keepRow as { photo_urls?: unknown } | null)?.photo_urls);

  for (const row of data ?? []) {
    if (String(row.id) === String(keepPostId)) continue;
    if ((row as { radar_only?: boolean | null }).radar_only === true) continue;
    const st = primaryStoreNormForProduct(row as RawPostForProduct);
    if (storeWant !== st) continue;
    mergedPhotos = [
      ...new Set([
        ...mergedPhotos,
        ...normalizePhotoUrls((row as { photo_urls?: unknown }).photo_urls),
      ]),
    ];
    const { error: delErr } = await supabase.from('posts').delete().eq('id', row.id).eq('user_id', uid);
    if (delErr) console.warn('delete duplicate post:', delErr.message);
  }

  if (mergedPhotos.length > 0) {
    const { error: upErr } = await supabase
      .from('posts')
      .update({ photo_urls: mergedPhotos })
      .eq('id', keepPostId)
      .eq('user_id', uid);
    if (upErr) console.warn('deleteOtherUserRankedPostsSameSlot: merge photos:', upErr.message);
  }
}

async function fetchMergedRawPostsForItem(
  itemName: string,
  descriptionKey: string,
  brand = ''
): Promise<RawPostForProduct[]> {
  const name = String(itemName ?? '').trim();
  const key = resolveProductDescriptionKey({ item: name, brand, descriptionKey });
  if (!name && !key) return [];

  const canonicalKey = await resolveCanonicalProductDescriptionKey(key);
  const aliasKeys = await resolveAliasKeysForCanonical(canonicalKey || key);
  const keysToFetch = new Set<string>();
  if (key) keysToFetch.add(key);
  if (canonicalKey) keysToFetch.add(canonicalKey);
  for (const aliasKey of aliasKeys) keysToFetch.add(aliasKey);
  const legacyKey = normalizedDescriptionKeyFromItem(name);
  if (legacyKey && legacyKey !== key && legacyKey !== canonicalKey) keysToFetch.add(legacyKey);

  const batches = await Promise.all(
    [...keysToFetch].map((k) => supabase.from('posts').select('*').eq('description_key', k))
  );
  for (const res of batches) {
    if (res.error) throw res.error;
  }

  const merged: RawPostForProduct[] = [];
  const seenIds = new Set<string>();
  for (const res of batches) {
    for (const row of (res.data ?? []) as RawPostForProduct[]) {
      const id = String(row.id ?? '');
      if (id && seenIds.has(id)) continue;
      const rowKey = itemIdentityKeyFromRow(row);
      const matchesKey = keysToFetch.has(rowKey);
      if (
        !matchesKey &&
        !postMatchesProductIdentity(row, name, canonicalKey || key, brand)
      ) {
        continue;
      }
      if (normalizedBrandKey(brand) && !brandsMatchForProductIdentity(row.product_brand, brand)) {
        continue;
      }
      if (id) seenIds.add(id);
      merged.push(row);
    }
  }
  return dedupePostsByUserItemStore(merged);
}

function postMatchesProductIdentity(
  row: RawPostForProduct,
  itemName: string,
  wantKey: string,
  brand: string
): boolean {
  if (normalizedDescriptionKeyFromItem(row.item ?? '') !== normalizedDescriptionKeyFromItem(itemName)) {
    return false;
  }
  if (!brandsMatchForProductIdentity(row.product_brand, brand)) return false;
  const rowKey = itemIdentityKeyFromRow(row);
  if (rowKey === wantKey) return true;
  const legacyKey = normalizedDescriptionKeyFromItem(itemName);
  return rowKey === legacyKey;
}

function rowCountsTowardGlobalAverage(row: RawPostForProduct): boolean {
  if (row?.radar_only === true) {
    const r = Number(row?.rating);
    return Number.isFinite(r) && r > 0;
  }
  return true;
}

export async function getGlobalRankStatsForItem(
  itemName: string,
  descriptionKey = '',
  brand = ''
): Promise<{ avg: number | null; count: number }> {
  try {
    const rows = await fetchMergedRawPostsForItem(itemName, descriptionKey, brand);
    const ranked = rows.filter(rowCountsTowardGlobalAverage);
    if (ranked.length === 0) return { avg: null, count: 0 };
    const authorIds = [...new Set(ranked.map((r) => String(r.user_id)).filter(isProfileUuid))];
    const allAuthorRanked = await fetchRankedPostsForUserIds(authorIds);
    const maps = buildCanonicalRatingMapsFromRankedPosts(allAuthorRanked);
    const ratingsByUser = new Map<string, number>();
    for (const row of ranked) {
      const r = resolveCanonicalRatingForPost(row, maps);
      if (r == null) continue;
      ratingsByUser.set(String(row.user_id), r);
    }
    const ratings = [...ratingsByUser.values()];
    if (ratings.length === 0) return { avg: null, count: 0 };
    const avg = clampBaggedScore(ratings.reduce((sum, r) => sum + r, 0) / ratings.length);
    return { avg, count: ratings.length };
  } catch (e) {
    console.warn('getGlobalRankStatsForItem:', (e as { message?: string })?.message ?? e);
    return { avg: null, count: 0 };
  }
}

export type VerifiedCuratedNutrition = {
  brand: string;
  stores: string[];
  category: string;
  categories: string[];
  /** Explicit `curated_products.subcategory` — unset when the catalog row has no stored id. */
  stored_subcategory?: string | null;
  subcategory?: string | null;
  cal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  serving_label: string;
  diet_tags: string[];
  /** Staff-verified catalog — intentional macro zeros should display. */
  nutrition_verified?: boolean;
};

function curatedRowHasMeaningfulMacros(row: Record<string, unknown>): boolean {
  return ['cal', 'protein', 'carbs', 'fat'].some((key) => {
    const v = row[key];
    if (v == null || v === '') return false;
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  });
}

function shapeCuratedNutritionFromRow(row: Record<string, unknown>): VerifiedCuratedNutrition {
  const isVerified =
    String(row.nutrition_verification_state ?? row.nutritionVerification ?? '') === 'verified';
  const toNum = (key: 'cal' | 'protein' | 'carbs' | 'fat') =>
    isVerified ? macroNumFromDb(row[key]) : macroNumForDisplay(row[key], row);
  const brand = String(row.brand ?? row.brand_owner ?? row.brandOwner ?? '').trim();
  const storesRaw = row.stores;
  const storeSingle = row.store;
  const rawTokens: string[] = [];
  if (Array.isArray(storesRaw)) {
    rawTokens.push(
      ...(storesRaw as unknown[]).map((s) => String(s ?? '').trim()).filter(Boolean)
    );
  }
  if (storeSingle) {
    const s = String(storeSingle).trim();
    if (s) rawTokens.push(s);
  }
  const stores = mergeStoresForBrand(brand, rawTokens);

  const serving =
    typeof row.serving_label === 'string'
      ? row.serving_label.trim()
      : typeof row.servingLabel === 'string'
        ? (row.servingLabel as string).trim()
        : '';

  const storedSubcategory = String(row.subcategory ?? '').trim() || null;
  return {
    brand: String(row.brand ?? '').trim(),
    stores,
    category: primaryCategoryForRow(row as { category?: string | null; categories?: string[] | null }),
    categories: categoriesForRow(row as { category?: string | null; categories?: string[] | null }),
    stored_subcategory: storedSubcategory,
    /** Explicit catalog subcategory only — do not infer from legacy category here. */
    subcategory: storedSubcategory,
    cal: toNum('cal'),
    protein: toNum('protein'),
    carbs: toNum('carbs'),
    fat: toNum('fat'),
    serving_label: serving,
    diet_tags: Array.isArray(row.diet_tags) ? (row.diet_tags as string[]) : [],
    nutrition_verified: isVerified,
  };
}

/**
 * Verified curated nutrition for shared UI / rate autofill.
 * Returns null unless the row is verified **and** has at least one macro > 0
 * (so catalog-only curated shells do not pre-fill the nutrition step).
 */
export async function fetchVerifiedCuratedNutritionByDescription(
  description: string,
  brand = ''
): Promise<VerifiedCuratedNutrition | null> {
  const desc = String(description ?? '').trim();
  if (!desc) return null;

  const rows = await fetchCuratedProductRowsByIdentity(desc, brand);
  for (const row of pickVerifiedCuratedRows(rows)) {
    return shapeCuratedNutritionFromRow(row);
  }
  return null;
}

function pickVerifiedCuratedRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.filter((row) => {
    const vRaw = row.nutrition_verification_state ?? row.nutritionVerification;
    return String(vRaw) === 'verified';
  });
}

/**
 * Full curated catalog row for product profile (stores, diet tags, brand, macros).
 * Unlike {@link fetchProductNutritionForProfile}, always returns when a row exists.
 */
export async function fetchCuratedProductProfileRow(
  description: string,
  brand = ''
): Promise<VerifiedCuratedNutrition | null> {
  const desc = String(description ?? '').trim();
  if (!desc) return null;

  const rows = await fetchCuratedProductRowsByIdentity(desc, brand);
  const picked = pickBestCuratedProfileRow(rows, brand);
  if (!picked) return null;
  return shapeCuratedNutritionFromRow(picked);
}

/**
 * Product-profile nutrition from the shared catalog — verified rows or any
 * unverified row with community-uploaded macros.
 */
export async function fetchProductNutritionForProfile(
  description: string
): Promise<VerifiedCuratedNutrition | null> {
  const row = await fetchCuratedProductProfileRow(description);
  if (!row) return null;

  const descKey = normalizedDescriptionKeyFromItem(String(description ?? '').trim());
  const { data } = await supabase
    .from('curated_products')
    .select('nutrition_verification_state, cal, protein, carbs, fat')
    .eq('description_key', descKey)
    .maybeSingle();
  if (!data) return null;

  const raw = data as Record<string, unknown>;
  const isVerified =
    String(raw.nutrition_verification_state ?? raw.nutritionVerification) === 'verified';
  if (!isVerified && !curatedRowHasMeaningfulMacros(raw)) return null;

  return row;
}

/** All deduped community posts for one product identity (newest first). */
export async function fetchCommunityPostsForProduct(
  itemName: string,
  descriptionKey = '',
  brand = ''
): Promise<FeedPostRow[]> {
  try {
    const raw = await fetchMergedRawPostsForItem(itemName, descriptionKey, brand);
    const visible = raw.filter(isFeedVisiblePost);
    if (visible.length === 0) return [];
    visible.sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );
    const hydrated = await hydratePostsWithProfileAndLikes(visible);
    const commentCounts = await fetchCommentCountsForPosts(hydrated.map((r) => String(r.id)));
    const withCounts = hydrated.map((row) => ({
      ...row,
      commentCount: commentCounts.get(String(row.id)) ?? 0,
    }));
    const enriched = await enrichPostsWithSharedCatalogMetadata(withCounts);
    return applyCanonicalRatingsToFeedPosts(enriched);
  } catch (e) {
    console.warn('fetchCommunityPostsForProduct:', (e as { message?: string })?.message ?? e);
    return [];
  }
}

// ─── Notifications (activity on your account) ─────────────────────────────────

export type ActivityNotification = {
  id: string;
  kind: 'like' | 'comment' | 'comment_reply' | 'follow';
  createdAt: string;
  actorUsername: string;
  actorAvatar: string | null;
  actorVerifiedAmbassador?: boolean;
  postId?: string;
  postItemPreview?: string;
  bodyPreview?: string;
  /** Comment row id — scroll/highlight in the comments thread. */
  commentId?: string;
};

function pickActorMap(
  rows: {
    id: string;
    username: string | null;
    avatar_color: string | null;
    is_verified_ambassador?: boolean | null;
  }[]
) {
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Aggregates likes on your posts, comments on your posts, and new followers.
 * Sorted newest-first. Best-effort if `likes.created_at` or `follows` timestamps are unavailable.
 */
export async function fetchActivityNotifications(
  userId: string,
  username: string
): Promise<ActivityNotification[]> {
  if (!userId || !isProfileUuid(userId) || !username.trim()) return [];

  const uname = username.trim();
  const { data: myPosts } = await supabase.from('posts').select('id, item').eq('user_id', userId);
  const postMeta = new Map(
    (myPosts ?? []).map((p: { id: unknown; item: unknown }) => [String(p.id), String(p.item ?? '')])
  );
  const postIds = [...postMeta.keys()];

  const notices: ActivityNotification[] = [];

  // — Likes on my posts
  if (postIds.length > 0) {
    const { data: likeRows, error: likeErr } = await supabase
      .from('likes')
      .select('user_id, post_id, created_at')
      .in('post_id', postIds);
    if (!likeErr && likeRows?.length) {
      const likers = likeRows.filter((l: { user_id: string }) => String(l.user_id) !== userId);
      const actorIds = [...new Set(likers.map((l: { user_id: string }) => String(l.user_id)))];
      const { data: actors } =
        actorIds.length > 0
          ? await supabase
              .from('profiles')
              .select(PROFILE_SNIPPET_SELECT)
              .in('id', actorIds)
          : { data: [] };
      const actorById = pickActorMap(
        (actors ?? []) as {
          id: string;
          username: string | null;
          avatar_color: string | null;
          is_verified_ambassador?: boolean | null;
        }[]
      );
      for (const l of likers as { user_id: string; post_id: string; created_at?: string | null }[]) {
        const aid = String(l.user_id);
        const pid = String(l.post_id);
        const a = actorById.get(aid);
        const ts = l.created_at ? String(l.created_at) : new Date(0).toISOString();
        notices.push({
          id: `like-${aid}-${pid}-${ts}`,
          kind: 'like',
          createdAt: ts,
          actorUsername: a?.username ?? 'someone',
          actorAvatar: a?.avatar_color ?? null,
          actorVerifiedAmbassador: profileIsVerifiedAmbassador(a),
          postId: pid,
          postItemPreview: postMeta.get(pid),
        });
      }
    }
  }

  // — Top-level comments on my posts (replies surface separately below)
  if (postIds.length > 0) {
    const { data: commentRows, error: cErr } = await supabase
      .from('comments')
      .select('id, user_id, post_id, content, created_at')
      .in('post_id', postIds)
      .is('parent_comment_id', null)
      .order('created_at', { ascending: false })
      .limit(120);
    if (!cErr && commentRows?.length) {
      const others = commentRows.filter((c: { user_id: string }) => String(c.user_id) !== userId);
      const actorIds = [...new Set(others.map((c: { user_id: string }) => String(c.user_id)))];
      const { data: actors } =
        actorIds.length > 0
          ? await supabase
              .from('profiles')
              .select(PROFILE_SNIPPET_SELECT)
              .in('id', actorIds)
          : { data: [] };
      const actorById = pickActorMap(
        (actors ?? []) as {
          id: string;
          username: string | null;
          avatar_color: string | null;
          is_verified_ambassador?: boolean | null;
        }[]
      );
      for (const c of others as {
        id: string;
        user_id: string;
        post_id: string;
        content: string | null;
        created_at?: string | null;
      }[]) {
        const aid = String(c.user_id);
        const pid = String(c.post_id);
        const a = actorById.get(aid);
        const ts = c.created_at ? String(c.created_at) : new Date(0).toISOString();
        const snippet = String(c.content ?? '').trim().slice(0, 120);
        notices.push({
          id: `comment-${c.id}`,
          kind: 'comment',
          createdAt: ts,
          actorUsername: a?.username ?? 'someone',
          actorAvatar: a?.avatar_color ?? null,
          actorVerifiedAmbassador: profileIsVerifiedAmbassador(a),
          postId: pid,
          postItemPreview: postMeta.get(pid),
          bodyPreview: snippet || undefined,
          commentId: String(c.id),
        });
      }
    }
  }

  // — Replies to comments I wrote (any post)
  const { data: myCommentIdRows } = await supabase
    .from('comments')
    .select('id')
    .eq('user_id', userId);
  const myCommentIds = (myCommentIdRows ?? [])
    .map((c: { id: string }) => String(c.id))
    .filter(Boolean);
  if (myCommentIds.length > 0) {
    const { data: replyRows, error: rErr } = await supabase
      .from('comments')
      .select('id, user_id, post_id, content, created_at')
      .in('parent_comment_id', myCommentIds)
      .neq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(120);
    if (!rErr && replyRows?.length) {
      const replyPostIds = [
        ...new Set(
          (replyRows as { post_id: string }[]).map((r) => String(r.post_id)).filter(Boolean)
        ),
      ];
      const { data: replyPosts } =
        replyPostIds.length > 0
          ? await supabase.from('posts').select('id, item').in('id', replyPostIds)
          : { data: [] };
      const replyPostMeta = new Map(
        (replyPosts ?? []).map((p: { id: unknown; item: unknown }) => [
          String(p.id),
          String(p.item ?? ''),
        ])
      );
      const actorIds = [
        ...new Set(
          (replyRows as { user_id: string }[])
            .map((r) => String(r.user_id))
            .filter((id) => id !== userId)
        ),
      ];
      const { data: actors } =
        actorIds.length > 0
          ? await supabase
              .from('profiles')
              .select(PROFILE_SNIPPET_SELECT)
              .in('id', actorIds)
          : { data: [] };
      const actorById = pickActorMap(
        (actors ?? []) as { id: string; username: string | null; avatar_color: string | null }[]
      );
      for (const r of replyRows as {
        id: string;
        user_id: string;
        post_id: string;
        content: string | null;
        created_at?: string | null;
      }[]) {
        const aid = String(r.user_id);
        const pid = String(r.post_id);
        const a = actorById.get(aid);
        const ts = r.created_at ? String(r.created_at) : new Date(0).toISOString();
        const snippet = String(r.content ?? '').trim().slice(0, 120);
        notices.push({
          id: `comment-reply-${r.id}`,
          kind: 'comment_reply',
          createdAt: ts,
          actorUsername: a?.username ?? 'someone',
          actorAvatar: a?.avatar_color ?? null,
          actorVerifiedAmbassador: profileIsVerifiedAmbassador(a),
          postId: pid,
          postItemPreview: replyPostMeta.get(pid) ?? postMeta.get(pid),
          bodyPreview: snippet || undefined,
          commentId: String(r.id),
        });
      }
    }
  }

  // — New followers (follows_by_username.following_username matches my handle)
  const followTarget = normalizeFollowTargetUsername(uname);
  const tryFollowsWithTs = await supabase
    .from('follows_by_username')
    .select('follower_id, created_at')
    .ilike('following_username', followTarget);
  let followRows: { follower_id: string; created_at?: string | null }[] = [];
  if (!tryFollowsWithTs.error && tryFollowsWithTs.data) {
    followRows = tryFollowsWithTs.data as { follower_id: string; created_at?: string | null }[];
  } else {
    const try2 = await supabase
      .from('follows_by_username')
      .select('follower_id')
      .ilike('following_username', followTarget);
    if (!try2.error && try2.data) {
      followRows = (try2.data as { follower_id: string }[]).map((f) => ({
        ...f,
        created_at: null,
      }));
    }
  }
  if (followRows.length > 0) {
    const seenFollowers = new Set<string>();
    const fids = dedupeFollowerIds(followRows as { follower_id: string }[]);
    const { data: actors } =
      fids.length > 0
        ? await supabase.from('profiles').select('id, username, avatar_color').in('id', fids)
        : { data: [] };
    const actorById = pickActorMap((actors ?? []) as { id: string; username: string | null; avatar_color: string | null }[]);
    for (const f of followRows as { follower_id: string; created_at?: string | null }[]) {
      const aid = String(f.follower_id);
      if (!aid || aid === userId || seenFollowers.has(aid)) continue;
      seenFollowers.add(aid);
      const a = actorById.get(aid);
      const ts = f.created_at ? String(f.created_at) : '1970-01-01T00:00:00.001Z';
      notices.push({
        id: `follow-${aid}`,
        kind: 'follow',
        createdAt: ts,
        actorUsername: a?.username ?? 'someone',
        actorAvatar: a?.avatar_color ?? null,
        actorVerifiedAmbassador: profileIsVerifiedAmbassador(a),
      });
    }
  }

  notices.sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
  return notices;
}

/** Toggle the viewer's like row for a post; returns the new liked state. */
export async function toggleLike(
  userId: string,
  postId: string | number
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('likes')
    .select('user_id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);
    if (error) throw error;
    return false;
  }

  const { error } = await supabase
    .from('likes')
    .insert({ post_id: postId, user_id: userId });
  if (error) throw error;
  return true;
}

export type PostLikerRow = {
  userId: string;
  username: string;
  avatarColor: string | null;
  likedAt: string | null;
  isVerifiedAmbassador: boolean;
};

/** Profiles for everyone who liked a post — newest likes first when `created_at` exists. */
export async function fetchPostLikers(postId: string | number): Promise<PostLikerRow[]> {
  const pid = String(postId ?? '').trim();
  if (!pid) return [];

  const attempts = [
    () =>
      supabase
        .from('likes')
        .select('user_id, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: false }),
    () => supabase.from('likes').select('user_id').eq('post_id', postId),
  ];

  let likeRows: Array<{ user_id: string; created_at?: string | null }> = [];
  for (const run of attempts) {
    const { data, error } = await run();
    if (!error) {
      likeRows = (data ?? []) as Array<{ user_id: string; created_at?: string | null }>;
      break;
    }
    if (!/created_at|schema cache/i.test(String(error.message ?? ''))) {
      console.warn('fetchPostLikers:', error.message);
      return [];
    }
  }
  if (likeRows.length === 0) return [];

  const userIds = [...new Set(likeRows.map((l) => String(l.user_id ?? '').trim()).filter(Boolean))];
  const { data: profiles, error: profileErr } = await supabase
    .from('profiles')
    .select(PROFILE_SNIPPET_SELECT)
    .in('id', userIds);
  if (profileErr) {
    console.warn('fetchPostLikers profiles:', profileErr.message);
  }

  const profileById = new Map<
    string,
    {
      username: string | null;
      avatar_color: string | null;
      is_verified_ambassador?: boolean | null;
    }
  >();
  for (const row of profiles ?? []) {
    const id = String((row as { id?: string }).id ?? '').trim();
    if (!id) continue;
    profileById.set(id, {
      username: (row as { username?: string | null }).username ?? null,
      avatar_color: (row as { avatar_color?: string | null }).avatar_color ?? null,
      is_verified_ambassador: (row as { is_verified_ambassador?: boolean | null })
        .is_verified_ambassador,
    });
  }

  return likeRows.map((like) => {
    const userId = String(like.user_id ?? '').trim();
    const profile = profileById.get(userId);
    return {
      userId,
      username: String(profile?.username ?? '').trim() || 'unknown',
      avatarColor: profile?.avatar_color ?? null,
      likedAt: like.created_at != null ? String(like.created_at) : null,
      isVerifiedAmbassador: profileIsVerifiedAmbassador(profile),
    };
  });
}

// ─── Want to Try ──────────────────────────────────────────────────────────────

export type WantToTryRow = {
  id?: string;
  user_id: string;
  item: string;
  store: string | null;
  emoji?: string | null;
  category?: string | null;
  radar_post_id?: string | null;
  product_brand?: string | null;
  note?: string | null;
  added_at?: string | null;
};

export type WantToTryItem = {
  id: string;
  item: string;
  store: string;
  stores: string[];
  emoji: string;
  category: string;
  brand: string;
  radarPostId: string | null;
  note: string;
};

/** Stable composite key — item, store, and brand when set. */
export function rankKeyPair(
  itemName: string | null | undefined,
  store: string | null | undefined,
  brand?: string | null | undefined
): string {
  const n = (itemName ?? '').trim().toLowerCase();
  const s = (store ?? '').trim().toLowerCase();
  const b = normalizedBrandKey(brand);
  if (b) return `${n}::${s}::${b}`;
  return `${n}::${s}`;
}

/** Same identity the profile ranked list uses (`dedupePostsByRankKey`). */
export function rankedCountIdentityKey(row: {
  item?: string | null;
  store?: string | null;
  stores?: string[] | null;
  product_brand?: string | null;
}): string {
  return rankKeyPair(row.item, primaryGroceryStoreForKey(row), row.product_brand);
}

const RANKED_COUNT_PAGE_SIZE = 1000;

function accumulateRankedCountsFromPostRows(
  rows: Array<{
    user_id?: string | null;
    item?: string | null;
    store?: string | null;
    stores?: string[] | null;
    product_brand?: string | null;
    radar_only?: boolean | null;
    rating?: number | null;
  }>,
  counts: Map<string, number>,
  seenByUser: Map<string, Set<string>>
): void {
  for (const row of rows) {
    if (isRadarOnlyDbRow(row)) continue;
    const uid = String(row.user_id ?? '');
    if (!uid) continue;
    const key = rankedCountIdentityKey(row);
    let seen = seenByUser.get(uid);
    if (!seen) {
      seen = new Set();
      seenByUser.set(uid, seen);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }
}

export type RankedDuplicateEntry = {
  id?: string | number | null;
  item: string;
  store?: string | null;
  brand?: string | null;
};

export const RANKED_DUPLICATE_MSG =
  'You already ranked this item. Open My List to edit your ranking.';

/** True when the viewer already has a ranked post for this product identity (item + brand). */
export function rankedProductIdentityDuplicate(
  rankedList: RankedDuplicateEntry[],
  item: string,
  brand?: string | null,
  excludeItemId?: string | number | null
): boolean {
  const target = productDescriptionKey(item, brand);
  return rankedList.some((r) => {
    if (excludeItemId != null && String(r.id) === String(excludeItemId)) return false;
    return productDescriptionKey(r.item ?? '', r.brand) === target;
  });
}

/** Search hit the viewer has already ranked (item + brand identity). */
export function searchRowIsAlreadyRanked(
  row: { description: string; brandName?: string | null; brandOwner?: string | null },
  rankedList: RankedDuplicateEntry[],
  excludeItemId?: string | number | null
): boolean {
  return rankedProductIdentityDuplicate(
    rankedList,
    row.description,
    searchRowBrand(row),
    excludeItemId
  );
}

/** True when the viewer already ranked this item at the given store (and brand when set). */
export function rankedHasDuplicate(
  rankedList: RankedDuplicateEntry[],
  itemName: string,
  store: string,
  brand?: string | null,
  excludeItemId?: string | number | null
): boolean {
  const key = rankKeyPair(itemName, store, brand);
  return rankedList.some(
    (r) =>
      (excludeItemId == null || String(r.id) !== String(excludeItemId)) &&
      rankKeyPair(r.item, r.store, r.brand) === key
  );
}

export function hasAnySelectedStoreRankDuplicate(
  rankedList: RankedDuplicateEntry[],
  itemName: string,
  brand: string | null | undefined,
  selectedStores: string[],
  excludeItemId?: string | number | null
): boolean {
  if (!String(itemName ?? '').trim()) return false;
  const locked = storesForBrandAndSelections(brand ?? '', selectedStores);
  const storesToCheck = locked.length > 0 ? locked : [''];
  return storesToCheck.some((s) =>
    rankedHasDuplicate(rankedList, itemName, s, brand, excludeItemId)
  );
}

/** Product identity or per-store duplicate — use before creating a new ranked post. */
export function wouldDuplicateRankedPost(
  rankedList: RankedDuplicateEntry[],
  item: string,
  brand: string | null | undefined,
  selectedStores: string[],
  excludeItemId?: string | number | null
): boolean {
  if (rankedProductIdentityDuplicate(rankedList, item, brand, excludeItemId)) return true;
  return hasAnySelectedStoreRankDuplicate(
    rankedList,
    item,
    brand,
    selectedStores,
    excludeItemId
  );
}

/** Primary store used for want-to-try keys — respects TJ-brand lock and row stores. */
export function wantToTryStorePrimary(row: {
  store?: string | null;
  stores?: string[] | null;
  brand?: string | null;
}): string {
  return primaryGroceryStoreForKey({
    store: row.store,
    stores: row.stores,
    product_brand: row.brand,
  });
}

/** True when a want-to-try row refers to the same product identity as the page/post. */
export function wantToTryMatchesProduct(
  row: Pick<WantToTryItem, 'item' | 'store' | 'stores' | 'brand'>,
  product: { item: string; store?: string | null; stores?: string[] | null; brand?: string | null }
): boolean {
  if (
    normalizedDescriptionKeyFromItem(row.item) !== normalizedDescriptionKeyFromItem(product.item)
  ) {
    return false;
  }
  if (!brandsMatchForProductIdentity(row.brand, product.brand)) return false;
  const productKey = rankKeyPair(product.item, wantToTryStorePrimary(product), product.brand);
  const rowKey = rankKeyPair(
    row.item,
    wantToTryStorePrimary({
      store: row.store,
      stores: row.stores,
      brand: row.brand,
    }),
    row.brand
  );
  return productKey === rowKey;
}

export function mapWantToTryFromDb(row: WantToTryRow): WantToTryItem {
  const store = row.store ?? '';
  const stores = store ? [store] : [];
  return {
    id: `wt-${rankKeyPair(row.item, store)}`,
    item: row.item,
    store,
    stores,
    emoji: row.emoji ?? '',
    category: row.category ?? 'Snacks',
    radarPostId: row.radar_post_id ?? null,
    brand: row.product_brand ?? '',
    note: String(row.note ?? '').trim(),
  };
}

export async function getWantToTry(userId: string): Promise<WantToTryItem[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('want_to_try')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => mapWantToTryFromDb(r as WantToTryRow));
}

const WANT_TO_TRY_UPSERT_OPTIONAL_COLUMNS = new Set(['radar_post_id', 'product_brand', 'source', 'note']);

/**
 * PostgREST returns these errors when an optional column is missing in the
 * live schema cache. Web does the same retry-on-strip dance so the feature
 * stays alive on older deployments.
 */
function parseMissingTableColumn(
  message: string | null | undefined,
  details: unknown,
  tableName: string
): string | null {
  const detailsStr = typeof details === 'string' ? details : JSON.stringify(details ?? '');
  const haystack = [String(message ?? ''), detailsStr].join('\n');
  const t = String(tableName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`column "([^"]+)" of relation "${t}" does not exist`, 'i'),
    new RegExp(`column ${t}\\.([^\\s]+) does not exist`, 'i'),
    new RegExp(`Could not find the '([^']+)' column of '${t}' in the schema cache`, 'i'),
    new RegExp(`Could not find the '([^']+)' column of '${t}'`, 'i'),
    new RegExp(`'([^']+)'\\s+column of '${t}'`, 'i'),
  ];
  for (const re of patterns) {
    const m = haystack.match(re);
    if (m) return m[1];
  }
  return null;
}

export type AddToWantToTryArgs = {
  item: string;
  store: string;
  emoji?: string;
  category?: string;
  radarPostId?: string | null;
  productBrand?: string | null;
  source?: WantToTrySource;
  note?: string;
};

export async function addToWantToTry(userId: string, args: AddToWantToTryArgs): Promise<void> {
  const base: Record<string, unknown> = {
    user_id: userId,
    item: args.item,
    store: args.store,
    emoji: args.emoji ?? '',
    category: args.category ?? 'Snacks',
  };
  if (args.radarPostId != null) base.radar_post_id = args.radarPostId;
  if (args.productBrand != null && args.productBrand !== '') base.product_brand = args.productBrand;
  if (args.source) base.source = args.source;
  const trimmedNote = String(args.note ?? '').trim();
  if (trimmedNote) base.note = trimmedNote;

  let payload = { ...base };
  for (let i = 0; i < 6; i += 1) {
    const { error } = await supabase.from('want_to_try').upsert(payload);
    if (!error) return;
    const missing = parseMissingTableColumn(error.message, error.details, 'want_to_try');
    if (missing && WANT_TO_TRY_UPSERT_OPTIONAL_COLUMNS.has(missing) && missing in payload) {
      delete payload[missing];
      continue;
    }
    throw error;
  }
  throw Object.assign(new Error('want_to_try upsert: optional column fallback exhausted'), {
    code: 'upsert_exhausted',
  });
}

/** Whether the user has a want-to-try row for this product identity. */
export async function userHasWantToTryForProduct(
  userId: string,
  item: string,
  productBrand?: string | null
): Promise<boolean> {
  const itemTrim = String(item ?? '').trim();
  if (!userId || !itemTrim) return false;
  const targetKey = productIdentityKey(itemTrim, undefined, productBrand);
  const { data, error } = await supabase
    .from('want_to_try')
    .select('item, product_brand')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).some(
    (row) =>
      productIdentityKey(
        String(row.item ?? ''),
        undefined,
        String(row.product_brand ?? '')
      ) === targetKey
  );
}

export async function removeFromWantToTry(
  userId: string,
  item: string,
  store: string
): Promise<void> {
  const { error } = await supabase
    .from('want_to_try')
    .delete()
    .eq('user_id', userId)
    .eq('item', item)
    .eq('store', store);
  if (error) throw error;
}

/** Update a personal note on a want-to-try row (matched by item + store). */
export async function updateWantToTryNote(
  userId: string,
  item: string,
  store: string,
  note: string
): Promise<void> {
  const trimmed = String(note ?? '').trim();
  let payload: Record<string, unknown> = { note: trimmed };
  for (let i = 0; i < 6; i += 1) {
    const { data, error } = await supabase
      .from('want_to_try')
      .update(payload)
      .eq('user_id', userId)
      .eq('item', item)
      .eq('store', store ?? '')
      .select('radar_post_id')
      .maybeSingle();
    if (!error) {
      const radarPostId = String((data as { radar_post_id?: unknown } | null)?.radar_post_id ?? '').trim();
      if (radarPostId) {
        await updatePostNote(userId, radarPostId, trimmed);
      }
      return;
    }
    const missing = parseMissingTableColumn(error.message, error.details, 'want_to_try');
    if (missing && WANT_TO_TRY_UPSERT_OPTIONAL_COLUMNS.has(missing) && missing in payload) {
      delete payload[missing];
      continue;
    }
    throw error;
  }
  throw new Error('Could not save note.');
}

// ─── Posts (ranked items) ─────────────────────────────────────────────────────

export type CreatePostArgs = {
  userId: string;
  item: string;
  descriptionKey?: string;
  store: string;
  stores?: string[];
  productBrand?: string;
  category: string;
  categories?: string[];
  subcategory?: string;
  emoji?: string;
  note?: string;
  rating: number;
  rankPosition?: number;
  dietTags?: string[];
  macros?: Record<string, unknown> | null;
  vibe?: Vibe;
  photoUrls?: string[];
  radarOnly?: boolean;
  convertedFromWantToTry?: boolean;
  tiedAbove?: boolean;
};

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj) as [keyof T, unknown][]) {
    if (v !== undefined) (out[k] as unknown) = v;
  }
  return out;
}

function parseMissingPostsColumn(
  message: string | null | undefined,
  details: unknown
): string | null {
  const detailsStr = typeof details === 'string' ? details : JSON.stringify(details ?? '');
  const haystack = [String(message ?? ''), detailsStr].join('\n');
  const patterns = [
    /column "([^"]+)" of relation "posts" does not exist/i,
    /Could not find the '([^']+)' column of 'posts' in the schema cache/i,
    /Could not find the '([^']+)' column of 'posts'/i,
    /'([^']+)'\s+column of 'posts'/i,
  ];
  for (const re of patterns) {
    const m = haystack.match(re);
    if (m) return m[1];
  }
  return null;
}

const POSTS_DROPPABLE_COLUMNS = new Set([
  'description_key',
  'stores',
  'product_brand',
  'vibe',
  'photo_urls',
  'diet_tags',
  'macros',
  'rank_position',
  'emoji',
  'radar_only',
  'categories',
  'converted_from_want_to_try',
]);

const CURATED_DROPPABLE_COLUMNS = new Set(['categories']);

/** Retry updates when optional columns are missing from the live schema cache (pre-migration). */
async function supabaseUpdateWithColumnFallback(
  table: 'posts' | 'curated_products',
  payload: Record<string, unknown>,
  eqColumn: string,
  eqValue: unknown
): Promise<{ error: { message?: string; details?: unknown; code?: string } | null }> {
  const droppable =
    table === 'posts'
      ? POSTS_DROPPABLE_COLUMNS
      : new Set([...CURATED_DROPPABLE_COLUMNS, ...POSTS_DROPPABLE_COLUMNS]);
  let current = { ...payload };
  for (let i = 0; i < 6; i++) {
    const { error } = await supabase.from(table).update(current).eq(eqColumn, eqValue);
    if (!error) return { error: null };
    const missing = parseMissingTableColumn(error.message, error.details, table);
    if (missing && droppable.has(missing) && missing in current) {
      delete current[missing];
      continue;
    }
    return { error };
  }
  return { error: { message: `${table} update fallback exhausted` } };
}

async function supabaseInsertWithColumnFallback(
  table: 'curated_products',
  payload: Record<string, unknown>
): Promise<{ error: { message?: string; details?: unknown; code?: string } | null }> {
  let current = { ...payload };
  for (let i = 0; i < 6; i++) {
    const { error } = await supabase.from(table).insert(current);
    if (!error) return { error: null };
    const missing = parseMissingTableColumn(error.message, error.details, table);
    if (missing && CURATED_DROPPABLE_COLUMNS.has(missing) && missing in current) {
      delete current[missing];
      continue;
    }
    return { error };
  }
  return { error: { message: `${table} insert fallback exhausted` } };
}

export async function setPostPhotoUrlsForUserPost(
  userId: string,
  postId: string | number,
  urls: string[]
): Promise<void> {
  const ts = new Date().toISOString();
  let payload: Record<string, unknown> = { photo_urls: urls, updated_at: ts };
  let res = await supabase.from('posts').update(payload).eq('id', postId).eq('user_id', userId);
  if (res.error && /updated_at|schema cache/i.test(String(res.error.message ?? ''))) {
    payload = { photo_urls: urls };
    res = await supabase.from('posts').update(payload).eq('id', postId).eq('user_id', userId);
  }
  if (res.error) throw res.error;
  await bumpPostFeedRecency(userId, postId);
}

export async function getPostPhotoUrlsForUserPost(
  userId: string,
  postId: string | number
): Promise<string[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('photo_urls')
    .eq('id', postId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('getPostPhotoUrlsForUserPost:', error.message);
    return [];
  }
  return normalizePhotoUrls((data as { photo_urls?: unknown } | null)?.photo_urls);
}

/** Appends new URLs to any existing `photo_urls` on the post (does not replace). */
export async function appendPostPhotoUrlsForUserPost(
  userId: string,
  postId: string | number,
  newUrls: string[]
): Promise<string[]> {
  const existing = await getPostPhotoUrlsForUserPost(userId, postId);
  const merged = [...new Set([...existing, ...newUrls.filter(Boolean)])];
  if (merged.length === 0) return merged;
  await setPostPhotoUrlsForUserPost(userId, postId, merged);
  return merged;
}

const ADMIN_PRODUCT_PHOTO_STUB_RANK = 99_999;

/**
 * Finds or creates a post the user owns so they can attach product photos
 * (admin new-release seeding, or anyone with an existing review).
 */
export async function ensureUserPostForProductPhotos(
  userId: string,
  args: {
    item: string;
    brand?: string;
    descriptionKey?: string;
    category?: string;
    stores?: string[];
    dietTags?: string[];
    maxPhotos?: number;
  }
): Promise<{ postId: string | number } | { error: string }> {
  if (!userId || !isProfileUuid(userId)) return { error: 'Sign in to add photos.' };
  const item = String(args.item ?? '').trim();
  if (!item) return { error: 'Missing product name.' };

  const brand = String(args.brand ?? '').trim();
  const descKey = resolveProductDescriptionKey({
    item,
    brand,
    descriptionKey: args.descriptionKey,
  });
  const maxPhotos = args.maxPhotos ?? 4;

  const { data: rows, error } = await supabase
    .from('posts')
    .select('id, photo_urls, radar_only, rating, product_brand, created_at')
    .eq('user_id', userId)
    .eq('description_key', descKey)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.warn('ensureUserPostForProductPhotos lookup:', error.message);
    return { error: error.message || 'Could not load your posts for this product.' };
  }

  const brandLower = brand.toLowerCase();
  const matches = (rows ?? []).filter((row) => {
    if (!brand) return true;
    const rowBrand = String((row as { product_brand?: unknown }).product_brand ?? '')
      .trim()
      .toLowerCase();
    return !rowBrand || rowBrand === brandLower;
  });

  const photoCount = (row: { photo_urls?: unknown }) => normalizePhotoUrls(row.photo_urls).length;

  const sorted = [...matches].sort((a, b) => {
    const aFull = photoCount(a) >= maxPhotos ? 1 : 0;
    const bFull = photoCount(b) >= maxPhotos ? 1 : 0;
    if (aFull !== bFull) return aFull - bFull;
    const aRanked = !isRadarOnlyDbRow(a) ? 1 : 0;
    const bRanked = !isRadarOnlyDbRow(b) ? 1 : 0;
    if (aRanked !== bRanked) return bRanked - aRanked;
    return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
  });

  const withRoom = sorted.find((row) => photoCount(row) < maxPhotos);
  if (withRoom?.id != null) {
    return { postId: withRoom.id as string | number };
  }

  if (sorted.length > 0) {
    return {
      error: `Your post for this product already has the maximum of ${maxPhotos} photos.`,
    };
  }

  const storeList = storesForBrandAndSelections(
    brand,
    (args.stores ?? []).map((s) => String(s ?? '').trim()).filter(Boolean)
  );
  const primaryStore = storeList[0] ?? '';

  try {
    const created = await createPost({
      userId,
      item,
      descriptionKey: descKey,
      store: primaryStore,
      stores: storeList,
      productBrand: brand,
      category: String(args.category ?? '').trim() || 'Snacks',
      note: '',
      rating: 0,
      rankPosition: ADMIN_PRODUCT_PHOTO_STUB_RANK,
      dietTags: Array.isArray(args.dietTags) ? args.dietTags.filter(Boolean) : [],
      radarOnly: true,
    });
    if (created.id == null) {
      return { error: 'Could not create a photo slot for this product.' };
    }
    return { postId: created.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create a photo slot.';
    console.warn('ensureUserPostForProductPhotos create:', message);
    return { error: message };
  }
}

/**
 * Mirrors the web `createPost` — same column-fallback retries (5 attempts) for
 * environments where some optional columns aren't in the live schema cache.
 * Also handles the `23505` rank-collision case the web app guards against.
 */
export async function createPost(args: CreatePostArgs): Promise<{ id: string | number | null }> {
  const itemText = String(args.item ?? '').trim();
  if (!itemText) {
    const err = new Error('Post item name is required') as Error & { code?: string };
    err.code = 'empty_item';
    throw err;
  }
  const brand = String(args.productBrand ?? '').trim();

  if (!args.radarOnly) {
    const existing = await getUserRankings(args.userId);
    const rankedEntries: RankedDuplicateEntry[] = existing
      .filter((r) => !isRadarOnlyDbRow(r))
      .map((r) => ({
        id: r.id,
        item: r.item,
        store: r.store,
        brand: r.product_brand,
      }));
    if (wouldDuplicateRankedPost(rankedEntries, itemText, brand, args.stores ?? [args.store ?? ''])) {
      throw new Error(RANKED_DUPLICATE_MSG);
    }
  }
  const rawStores = [
    ...(args.stores ?? []).map((s) => String(s ?? '').trim()).filter(Boolean),
    String(args.store ?? '').trim(),
  ].filter(Boolean);
  const stores = storesForBrandAndSelections(brand, rawStores);
  const primaryStore = stores[0] ?? '';
  const safeRating = Number.isFinite(args.rating) ? args.rating : 10;
  const rp = parseInt(String(args.rankPosition ?? 1), 10);
  const safeRank = Number.isFinite(rp) && rp > 0 ? rp : 1;
  const categories = normalizeCategoriesList(args.categories, args.category);
  const primaryCategory = categories[0] ?? 'Snacks';

  const basePayload = omitUndefined<Record<string, unknown>>({
    user_id: args.userId,
    item: itemText,
    description_key: productDescriptionKey(itemText, brand),
    store: primaryStore,
    stores: stores.length > 0 ? stores : primaryStore ? [primaryStore] : [],
    product_brand: args.productBrand ?? '',
    category: primaryCategory,
    categories,
    subcategory: args.subcategory ? String(args.subcategory).trim() : undefined,
    emoji: args.emoji ?? '',
    note: args.note ?? '',
    rating: safeRating,
    rank_position: safeRank,
    diet_tags: Array.isArray(args.dietTags) ? args.dietTags.filter(Boolean) : [],
    macros: args.macros ?? null,
    vibe: args.vibe === 'liked' || args.vibe === 'fine' || args.vibe === 'meh' ? args.vibe : 'fine',
    photo_urls: Array.isArray(args.photoUrls) ? args.photoUrls.filter(Boolean) : [],
    radar_only: args.radarOnly ? true : undefined,
    converted_from_want_to_try: args.convertedFromWantToTry ? true : undefined,
  });

  const insertWithFallback = async (
    payload: Record<string, unknown>
  ): Promise<
    | { ok: true; id: string | number | null }
    | { ok: false; error: { code?: string; message?: string; details?: unknown } }
  > => {
    let current = { ...payload };
    for (let i = 0; i < 5; i += 1) {
      const { data, error } = await supabase.from('posts').insert(current).select('id, photo_urls, created_at');
      if (!error) {
        const row = Array.isArray(data) ? data[0] : data;
        const id =
          row && (row as { id?: string | number }).id != null
            ? (row as { id: string | number }).id
            : null;
        return { ok: true, id };
      }
      const missing = parseMissingPostsColumn(error.message, error.details);
      if (missing && POSTS_DROPPABLE_COLUMNS.has(missing) && missing in current) {
        delete current[missing];
        continue;
      }
      return { ok: false, error };
    }
    return { ok: false, error: { message: 'posts insert fallback exhausted' } };
  };

  let result = await insertWithFallback(basePayload);
  if (!result.ok && String(result.error.code ?? '') === '23505') {
    // Rank-position uniqueness conflict — push to a sentinel; caller can normalize later.
    result = await insertWithFallback({ ...basePayload, rank_position: 2_000_000_000 });
  }
  if (!result.ok) throw result.error;
  if (result.id != null) {
    if (args.tiedAbove !== undefined) {
      await writePostTiedAboveBestEffort(args.userId, result.id, args.tiedAbove);
    }
    return { id: result.id };
  }

  // Insert succeeded but `select('id')` returned nothing (e.g. RLS). Resolve the row
  // without relying on `item` alone — multiple posts can share the same display name.
  const descriptionKeyNorm = String(basePayload.description_key ?? '').trim().toLowerCase();
  const attempts: Array<() => unknown> = [];
  if (primaryStore) {
    attempts.push(() =>
      supabase
        .from('posts')
        .select('id')
        .eq('user_id', args.userId)
        .eq('description_key', descriptionKeyNorm)
        .eq('store', primaryStore)
        .order('created_at', { ascending: false })
        .limit(1)
    );
  }
  attempts.push(
    () =>
      supabase
        .from('posts')
        .select('id')
        .eq('user_id', args.userId)
        .eq('description_key', descriptionKeyNorm)
        .order('created_at', { ascending: false })
        .limit(1),
    () =>
      supabase
        .from('posts')
        .select('id')
        .eq('user_id', args.userId)
        .eq('item', itemText)
        .order('created_at', { ascending: false })
        .limit(1),
    () =>
      supabase
        .from('posts')
        .select('id')
        .eq('user_id', args.userId)
        .eq('item', itemText)
        .order('id', { ascending: false })
        .limit(1),
    () =>
      supabase.from('posts').select('id').eq('user_id', args.userId).eq('item', itemText).limit(1)
  );
  for (const run of attempts) {
    const { data, error } = (await run()) as { data: unknown; error: { message?: string } | null };
    if (error) continue;
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.id != null) {
      if (args.tiedAbove !== undefined) {
        await writePostTiedAboveBestEffort(args.userId, row.id as string | number, args.tiedAbove);
      }
      return { id: row.id as string | number };
    }
  }
  return { id: null };
}

export async function updateRankedPost(
  userId: string,
  postId: string | number,
  args: {
    item: string;
    descriptionKey?: string;
    store: string;
    stores?: string[];
    productBrand?: string;
    category: string;
    subcategory?: string;
    emoji?: string;
    note?: string;
    rating: number;
    rankPosition: number;
    dietTags?: string[];
    macros?: Record<string, unknown> | null;
    vibe?: Vibe;
    radarOnly?: boolean;
    convertedFromWantToTry?: boolean;
    tiedAbove?: boolean;
  }
): Promise<void> {
  const itemText = String(args.item ?? '').trim();
  if (!itemText) {
    const err = new Error('Post item name is required') as Error & { code?: string };
    err.code = 'empty_item';
    throw err;
  }
  const brand = String(args.productBrand ?? '').trim();
  const rawStores = [
    ...(args.stores ?? []).map((s) => String(s ?? '').trim()).filter(Boolean),
    String(args.store ?? '').trim(),
  ].filter(Boolean);
  const stores = storesForBrandAndSelections(brand, rawStores);
  const primaryStore = stores[0] ?? '';
  const safeRating = Number.isFinite(args.rating) ? args.rating : 10;
  const rp = parseInt(String(args.rankPosition ?? 1), 10);
  const safeRank = Number.isFinite(rp) && rp > 0 ? rp : 1;

  const payload = omitUndefined<Record<string, unknown>>({
    item: itemText,
    description_key: productDescriptionKey(itemText, brand),
    store: primaryStore,
    stores: stores.length > 0 ? stores : primaryStore ? [primaryStore] : [],
    product_brand: args.productBrand ?? '',
    category: String(args.category ?? '').trim() || 'Snacks',
    subcategory: args.subcategory ? String(args.subcategory).trim() : undefined,
    emoji: args.emoji ?? '',
    note: args.note ?? '',
    rating: safeRating,
    rank_position: safeRank,
    diet_tags: Array.isArray(args.dietTags) ? args.dietTags.filter(Boolean) : [],
    macros: args.macros ?? null,
    vibe: args.vibe === 'liked' || args.vibe === 'fine' || args.vibe === 'meh' ? args.vibe : 'fine',
    radar_only: args.radarOnly ? true : false,
    needs_recategorization: false,
    converted_from_want_to_try: args.convertedFromWantToTry ? true : undefined,
    updated_at: new Date().toISOString(),
  });

  let res = await supabase.from('posts').update(payload).eq('id', postId).eq('user_id', userId);
  if (res.error) {
    const msg = String(res.error.message ?? '');
    if (/updated_at|schema cache/i.test(msg)) {
      const { updated_at: _u, ...withoutTs } = payload;
      res = await supabase.from('posts').update(withoutTs).eq('id', postId).eq('user_id', userId);
    }
  }
  if (res.error) throw res.error;
  if (args.tiedAbove !== undefined) {
    await writePostTiedAboveBestEffort(userId, postId, args.tiedAbove);
  }
  await bumpPostFeedRecency(userId, postId);
}

/**
 * Re-touch `updated_at` after a re-rank so this post sorts above peers updated in the same
 * transaction (Supabase/Postgres often bumps `updated_at` on every row update via trigger).
 */
export async function bumpPostFeedRecency(userId: string, postId: string | number): Promise<void> {
  const ts = new Date().toISOString();
  let res = await supabase.from('posts').update({ updated_at: ts }).eq('id', postId).eq('user_id', userId);
  if (res.error) {
    const msg = String(res.error.message ?? '');
    if (/updated_at|schema cache/i.test(msg)) {
      // Pre-migration-085 fallback: feed sorts by created_at when updated_at is absent.
      const fallback = await supabase
        .from('posts')
        .update({ created_at: ts })
        .eq('id', postId)
        .eq('user_id', userId);
      if (fallback.error) {
        console.warn('bumpPostFeedRecency fallback:', fallback.error.message);
      }
      return;
    }
    throw res.error;
  }
}

/** Update review note on an owned post — same `posts.note` column + feed recency bump as the rate flow. */
export async function updatePostNote(
  userId: string,
  postId: string | number,
  note: string
): Promise<void> {
  const trimmed = String(note ?? '').trim();
  const payload = { note: trimmed, updated_at: new Date().toISOString() };
  let res = await supabase.from('posts').update(payload).eq('id', postId).eq('user_id', userId);
  if (res.error) {
    const msg = String(res.error.message ?? '');
    if (/updated_at|schema cache/i.test(msg)) {
      const { updated_at: _u, ...withoutTs } = payload;
      res = await supabase.from('posts').update(withoutTs).eq('id', postId).eq('user_id', userId);
    }
  }
  if (res.error) throw res.error;
  await bumpPostFeedRecency(userId, postId);
}

let postsTiedAboveColumnAvailable = true;

/** Best-effort `tied_above` write — never throws (column may be missing pre-migration). */
async function writePostTiedAboveBestEffort(
  userId: string,
  postId: string | number,
  tiedAbove: boolean
): Promise<void> {
  if (!postsTiedAboveColumnAvailable) return;
  const { error } = await supabase
    .from('posts')
    .update({ tied_above: tiedAbove })
    .eq('id', postId)
    .eq('user_id', userId);
  if (error) {
    const msg = String(error.message ?? '');
    if (/tied_above|schema cache/i.test(msg)) {
      postsTiedAboveColumnAvailable = false;
    }
    console.warn('writePostTiedAboveBestEffort:', error.message);
  }
}

/** After reranking, push new `rating` / `rank_position` to other posts in the same category (excluding `skipPostId`). */
export type PeerRankSync = {
  id: string | number;
  rating: number;
  rankPosition: number;
  tiedAbove?: boolean;
};

export async function syncPeerPostRanks(
  userId: string,
  peers: PeerRankSync[],
  skipPostId?: string | number | null
): Promise<void> {
  const skip = skipPostId != null ? String(skipPostId) : null;
  for (const p of peers) {
    if (skip != null && String(p.id) === skip) continue;
    const { error } = await supabase
      .from('posts')
      .update({ rating: p.rating, rank_position: p.rankPosition })
      .eq('id', p.id)
      .eq('user_id', userId);
    if (error) throw error;
    if (p.tiedAbove !== undefined) {
      await writePostTiedAboveBestEffort(userId, p.id, p.tiedAbove);
    }
  }
}

export type RankedPostRow = {
  id: string | number;
  user_id: string;
  item: string;
  description_key?: string | null;
  store: string | null;
  stores: string[] | null;
  product_brand: string | null;
  category: string;
  subcategory?: string | null;
  needs_recategorization?: boolean | null;
  rating: number | null;
  note: string | null;
  vibe: string | null;
  diet_tags: string[] | null;
  macros: Record<string, unknown> | null;
  photo_urls: string[] | null;
  radar_only: boolean | null;
  rank_position: number | null;
  tied_above?: boolean | null;
  created_at: string | null;
  updated_at?: string | null;
};

async function fetchAllPostsForUser(userId: string): Promise<RankedPostRow[]> {
  const orderAttempts: Array<{ column: string; ascending: boolean } | null> = [
    { column: 'rank_position', ascending: true },
    { column: 'created_at', ascending: false },
    null,
  ];
  for (const order of orderAttempts) {
    const rows: RankedPostRow[] = [];
    let from = 0;
    let failed = false;
    for (;;) {
      let query = supabase.from('posts').select('*').eq('user_id', userId);
      if (order) query = query.order(order.column, { ascending: order.ascending });
      const { data, error } = await query.range(from, from + RANKED_COUNT_PAGE_SIZE - 1);
      if (error) {
        failed = true;
        break;
      }
      const batch = (data ?? []) as RankedPostRow[];
      rows.push(...batch);
      if (batch.length < RANKED_COUNT_PAGE_SIZE) break;
      from += RANKED_COUNT_PAGE_SIZE;
    }
    if (!failed) return rows;
  }
  return [];
}

/**
 * Loads a user's ranked posts. Falls back through ordering attempts the same
 * way the web app does, then dedupes posts that collide on (item, store, brand)
 * so we don't show the same product twice.
 */
export async function getUserRankings(userId: string): Promise<RankedPostRow[]> {
  if (!userId) return [];
  const rows = await fetchAllPostsForUser(userId);
  if (rows.length === 0) return [];
  const deduped = dedupePostsByRankKey(rows).map((r) => ({
    ...r,
    photo_urls: normalizePhotoUrls(r.photo_urls),
  }));
  return enrichPostsWithSharedCatalogMetadata(deduped);
}

/** Curated catalog subcategory for pre-selecting in the rate flow. */
export async function fetchCuratedSubcategoryForProduct(
  descriptionKey: string,
  item?: string,
  brand?: string
): Promise<string | null> {
  const row = await fetchCuratedProductProfileRow(item ?? '', brand ?? '').catch(() => null);
  const fromRow = String((row as { subcategory?: string | null } | null)?.subcategory ?? '').trim();
  if (fromRow) return fromRow;
  const key = String(descriptionKey ?? '').trim();
  if (!key) return null;
  const { data, error } = await supabase
    .from('curated_products')
    .select('subcategory')
    .eq('description_key', key)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('fetchCuratedSubcategoryForProduct:', error.message);
    return null;
  }
  const sub = String(data?.subcategory ?? '').trim();
  return sub || null;
}

/** Persist catalog subcategory onto ranked posts when posts still carry a migration default. */
export async function syncPostsSubcategoryFromCuratedCatalog(args: {
  descriptionKey?: string;
  item: string;
  brand?: string;
  curatedSubcategory: string;
}): Promise<void> {
  const catalogSub = String(args.curatedSubcategory ?? '').trim();
  if (!catalogSub || !getSubcategory(catalogSub)) return;

  const descKey = resolveProductDescriptionKey({
    item: String(args.item ?? '').trim(),
    brand: String(args.brand ?? '').trim(),
    descriptionKey: args.descriptionKey,
  });
  if (!descKey) return;

  const legacyCat = legacyCategoryForSubcategory(catalogSub);
  const categories = [legacyCat];

  const { data, error } = await supabase
    .from('posts')
    .select('id, subcategory, category')
    .eq('description_key', descKey)
    .eq('radar_only', false);
  if (error) {
    console.warn('syncPostsSubcategoryFromCuratedCatalog:', error.message);
    return;
  }

  const stale = (data ?? []).filter(
    (row) => !postHasValidStoredSubcategory(row) && subcategoryForRow(row) !== catalogSub
  );
  if (!stale.length) return;

  await Promise.all(
    stale.map(async (row) => {
      const { error: updateErr } = await supabaseUpdateWithColumnFallback(
        'posts',
        {
          subcategory: catalogSub,
          category: legacyCat,
          categories,
        },
        'id',
        row.id
      );
      if (updateErr) {
        console.warn('syncPostsSubcategoryFromCuratedCatalog post update:', updateErr.message);
      }
    })
  );
}

function sortRankedRowsForRescore(rows: RankedPostRow[]): RankedPostRow[] {
  return [...rows].sort((a, b) => {
    const ca = rankingScopeForRow(a);
    const cb = rankingScopeForRow(b);
    if (ca !== cb) return ca.localeCompare(cb);
    const ra = rankPositionSortValue(a.rank_position);
    const rb = rankPositionSortValue(b.rank_position);
    if (ra !== rb) return ra - rb;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
}

/** Recompute ratings + rank_position for every ranked scope for one user. */
async function rescoreUserRankings(userId: string): Promise<void> {
  const uid = String(userId ?? '').trim();
  if (!uid || !isProfileUuid(uid)) return;

  const remaining = (await getUserRankings(uid)).filter(
    (r) => !isRadarOnlyDbRow(r) && !postNeedsRecategorization(r)
  );
  if (remaining.length === 0) return;

  const rescored = computeScoresByCategory(
    sortRankedRowsForRescore(remaining).map((r) => ({
      ...r,
      vibe: normalizeVibe(r.vibe),
    }))
  );

  const byCat = new Map<string, typeof rescored>();
  for (const r of rescored) {
    const cat = rankingScopeForRow(r);
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(r);
  }
  for (const inCat of byCat.values()) {
    const peers = inCat.map((r, i) => {
      const row = r as typeof r & { tiedAbove?: boolean };
      return {
        id: r.id,
        rating: r.rating,
        rankPosition: i + 1,
        tiedAbove: row.tied_above === true || row.tiedAbove === true,
      };
    });
    await syncPeerPostRanks(uid, peers);
  }
}

async function fetchRankedAuthorIdsForMetadataSync(
  identityKeys: string[],
  item: string
): Promise<string[]> {
  const userIds = new Set<string>();
  const addFromRows = (rows: Array<Record<string, unknown>> | null | undefined) => {
    for (const row of rows ?? []) {
      const uid = String(row.user_id ?? '').trim();
      if (!uid || !isProfileUuid(uid)) continue;
      if (!isRankedReviewPost(row as { radar_only?: boolean | null; rating?: number | null })) {
        continue;
      }
      userIds.add(uid);
    }
  };

  const keys = [
    ...new Set(
      identityKeys.map((k) => String(k ?? '').trim().toLowerCase()).filter(Boolean)
    ),
  ];
  if (keys.length > 0) {
    const { data, error } = await supabase
      .from('posts')
      .select('user_id, radar_only, rating, rank_position')
      .in('description_key', keys);
    if (error) {
      console.warn('fetchRankedAuthorIdsForMetadataSync keys:', error.message);
    } else {
      addFromRows(data as Array<Record<string, unknown>>);
    }
  }

  const itemNorm = String(item ?? '').trim();
  if (itemNorm) {
    const { data, error } = await supabase
      .from('posts')
      .select('user_id, radar_only, rating, rank_position')
      .ilike('item', itemNorm);
    if (error) {
      console.warn('fetchRankedAuthorIdsForMetadataSync item:', error.message);
    } else {
      addFromRows(data as Array<Record<string, unknown>>);
    }
  }

  return [...userIds];
}

/**
 * Deletes the viewer's ranked post (and any duplicate rows for the same item),
 * removes attached photos from storage, and rescores remaining rankings.
 */
export async function deleteUserRankedPost(
  userId: string,
  postId: string | number
): Promise<void> {
  const uid = String(userId ?? '').trim();
  if (!uid || !isProfileUuid(uid)) throw new Error('Invalid user');

  const { data: row, error: fetchErr } = await supabase
    .from('posts')
    .select('id, item, photo_urls, radar_only')
    .eq('id', postId)
    .eq('user_id', uid)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw new Error('Post not found');
  if ((row as { radar_only?: boolean }).radar_only === true) {
    throw new Error('Remove want-to-try items from My List instead.');
  }

  const item = String((row as { item?: string }).item ?? '').trim();
  if (!item) throw new Error('Invalid post');

  const photoUrls = normalizePhotoUrls((row as { photo_urls?: unknown }).photo_urls);
  await removeStorageObjectsForPostPhotoUrls(photoUrls);

  const { error: delErr } = await supabase.from('posts').delete().eq('user_id', uid).eq('item', item);
  if (delErr) throw delErr;

  await rescoreUserRankings(uid);
}

function dedupePostsByRankKey(rows: RankedPostRow[]): RankedPostRow[] {
  const best = new Map<string, RankedPostRow>();
  const activityMs = (r: RankedPostRow) =>
    Math.max(
      r.updated_at ? new Date(r.updated_at).getTime() : 0,
      new Date(r.created_at ?? 0).getTime()
    );
  const betterRankDup = (next: RankedPostRow, prev: RankedPostRow) => {
    const nextRanked = !isRadarOnlyDbRow(next);
    const prevRanked = !isRadarOnlyDbRow(prev);
    if (nextRanked !== prevRanked) return nextRanked;
    const np = normalizePhotoUrls(next.photo_urls).length;
    const pp = normalizePhotoUrls(prev.photo_urls).length;
    if (np !== pp) return np > pp;
    const na = activityMs(next);
    const pa = activityMs(prev);
    if (na !== pa) return na > pa;
    return (Number(next.id) || 0) > (Number(prev.id) || 0);
  };
  for (const row of rows) {
    const key = rankedCountIdentityKey(row);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, row);
      continue;
    }
    if (betterRankDup(row, prev)) best.set(key, row);
  }
  return Array.from(best.values());
}

/** True when a stored rating means the user actually tried and scored the item. */
export function hasTriedScore(rating: unknown): boolean {
  const n = Number(rating);
  return Number.isFinite(n) && n > 0;
}

/** True for want-to-try radar rows without a real score yet (mirrors web `clientRadarOnlyFromDbRow`). */
export function isRadarOnlyDbRow(row: { radar_only?: boolean | null; rating?: number | null }): boolean {
  return row.radar_only === true && !hasTriedScore(row.rating);
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export type CommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  parent_comment_id: string | null;
  created_at: string;
  profile: {
    username: string | null;
    avatar_color: string | null;
    is_verified_ambassador?: boolean | null;
  } | null;
};

export type ThreadedCommentNode = { node: CommentRow; depth: number };

/** Flatten comments in tree order (parent then nested replies) with depth for threaded UI. */
export function threadedCommentRows(rows: CommentRow[]): ThreadedCommentNode[] {
  const list = rows ?? [];
  const byParent = new Map<string, CommentRow[]>();
  for (const c of list) {
    const pid = c.parent_comment_id;
    const key = pid == null || pid === '' ? '__root__' : String(pid);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  const cmp = (a: CommentRow, b: CommentRow) =>
    new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
  for (const arr of byParent.values()) arr.sort(cmp);
  const out: ThreadedCommentNode[] = [];
  function walk(parentKey: string, depth: number) {
    const kids = byParent.get(parentKey) || [];
    for (const c of kids) {
      out.push({ node: c, depth });
      walk(String(c.id), depth + 1);
    }
  }
  walk('__root__', 0);
  return out;
}

function collectCommentSubtreeIds(rows: CommentRow[], rootId: string): string[] {
  const byParent = new Map<string, string[]>();
  const knownIds = new Set(rows.map((r) => String(r.id)));
  for (const row of rows) {
    const parentId = row.parent_comment_id ? String(row.parent_comment_id) : null;
    if (!parentId) continue;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)!.push(String(row.id));
  }
  const out: string[] = [];
  const walk = (id: string) => {
    if (!knownIds.has(id)) return;
    out.push(id);
    for (const childId of byParent.get(id) ?? []) walk(childId);
  };
  walk(String(rootId));
  return out;
}

export function canDeleteComment(args: {
  viewerUserId: string | null | undefined;
  commentAuthorUserId: string;
  postAuthorUserId: string | null | undefined;
}): boolean {
  const viewer = String(args.viewerUserId ?? '').trim();
  if (!viewer) return false;
  if (viewer === String(args.commentAuthorUserId ?? '').trim()) return true;
  return viewer === String(args.postAuthorUserId ?? '').trim();
}

export async function deleteComment(args: {
  userId: string;
  commentId: string;
  postId: string | number;
}): Promise<{ deletedIds: string[] }> {
  const uid = String(args.userId ?? '').trim();
  if (!uid) throw new Error('Sign in to delete comments.');

  const rows = await fetchCommentsForPost(args.postId);
  const target = rows.find((row) => String(row.id) === String(args.commentId));
  if (!target) throw new Error('Comment not found.');

  const { data: postRow, error: postErr } = await supabase
    .from('posts')
    .select('user_id')
    .eq('id', String(args.postId))
    .maybeSingle();
  if (postErr) throw postErr;

  const postAuthorUserId = String(postRow?.user_id ?? '').trim();
  if (
    !canDeleteComment({
      viewerUserId: uid,
      commentAuthorUserId: String(target.user_id),
      postAuthorUserId,
    })
  ) {
    throw new Error('You can only delete your own comments or comments on your posts.');
  }

  const deletedIds = collectCommentSubtreeIds(rows, args.commentId);
  const { error } = await supabase.from('comments').delete().eq('id', String(args.commentId));
  if (error) throw error;

  return { deletedIds };
}

export async function fetchCommentsForPost(postId: string | number): Promise<CommentRow[]> {
  const { data, error } = await supabase
    .from('comments')
    .select(`*, profile:user_id (${PROFILE_EMBED_SELECT})`)
    .eq('post_id', String(postId))
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommentRow[];
}

export async function postComment(args: {
  userId: string;
  postId: string | number;
  content: string;
  parentCommentId?: string | null;
}): Promise<CommentRow> {
  const payload: Record<string, unknown> = {
    post_id: String(args.postId),
    user_id: args.userId,
    content: args.content,
  };
  if (args.parentCommentId) payload.parent_comment_id = args.parentCommentId;
  const { data, error } = await supabase
    .from('comments')
    .insert(payload)
    .select(`*, profile:user_id (${PROFILE_EMBED_SELECT})`)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error('Comment was created but could not be retrieved.');
  }
  const row = data as CommentRow;
  return row;
}

// ─── Profiles + follows ───────────────────────────────────────────────────────

export type ProfileRow = {
  id: string;
  username: string;
  bio: string | null;
  avatar_color: string | null;
  diet_tags: string[];
  zip_code: string | null;
  birthday: string | null;
  is_verified_ambassador: boolean;
};

const PROFILE_SELECT_COLUMNS =
  'id, username, bio, avatar_color, diet_tags, zip_code, birthday, is_verified_ambassador';

const PROFILE_DROPPABLE_SELECT_COLUMNS = new Set([
  'birthday',
  'zip_code',
  'diet_tags',
  'is_verified_ambassador',
]);

function profileSelectColumnList(): string[] {
  return PROFILE_SELECT_COLUMNS.split(', ').map((c) => c.trim()).filter(Boolean);
}

type ProfileSelectError = { message?: string; details?: unknown; code?: string } | null;

async function runProfileSelectWithColumnFallback<T>(
  run: (columns: string) => PromiseLike<{ data: T; error: ProfileSelectError }>
): Promise<T> {
  let columns = profileSelectColumnList();
  for (let i = 0; i < 6; i += 1) {
    const { data, error } = await run(columns.join(', '));
    if (!error) return data;
    const missing = parseMissingTableColumn(error.message, error.details, 'profiles');
    if (missing && PROFILE_DROPPABLE_SELECT_COLUMNS.has(missing)) {
      columns = columns.filter((c) => c !== missing);
      if (columns.length === 0) throw error;
      continue;
    }
    throw error;
  }
  throw Object.assign(new Error('profiles select: optional column fallback exhausted'), {
    code: 'select_exhausted',
  });
}

function shapeProfileRow(row: {
  id: string;
  username: string;
  bio: string | null;
  avatar_color: string | null;
  diet_tags?: unknown;
  zip_code?: string | null;
  birthday?: string | null;
  is_verified_ambassador?: boolean | null;
}): ProfileRow {
  const zip = String(row.zip_code ?? '').trim();
  return {
    id: row.id,
    username: row.username,
    bio: row.bio,
    avatar_color: row.avatar_color,
    diet_tags: normalizeProfileDietTags(row.diet_tags),
    zip_code: zip || null,
    birthday: normalizeBirthday(row.birthday),
    is_verified_ambassador: profileIsVerifiedAmbassador(row),
  };
}

function shapeFindPeopleProfileRow(row: {
  id: string;
  username: string;
  bio: string | null;
  avatar_color: string | null;
  diet_tags?: unknown;
  is_verified_ambassador?: boolean | null;
}): FindPeopleProfileRow {
  return {
    id: row.id,
    username: row.username,
    bio: row.bio,
    avatarColor: row.avatar_color,
    dietTags: normalizeProfileDietTags(row.diet_tags),
    isVerifiedAmbassador: profileIsVerifiedAmbassador(row),
  };
}

function dietTagOverlapCount(viewerTags: string[], profileTags: string[]): number {
  if (viewerTags.length === 0 || profileTags.length === 0) return 0;
  const viewerSet = new Set(viewerTags);
  return profileTags.filter((t) => viewerSet.has(t)).length;
}

function sortSuggestedFriendProfiles(
  rows: FindPeopleProfileRow[],
  options?: { viewerDietTags?: string[]; rankedCounts?: Map<string, number> }
): FindPeopleProfileRow[] {
  const viewerTags = options?.viewerDietTags ?? [];
  const counts = options?.rankedCounts ?? new Map<string, number>();
  return [...rows].sort((a, b) => {
    const aVerified = a.isVerifiedAmbassador ? 1 : 0;
    const bVerified = b.isVerifiedAmbassador ? 1 : 0;
    if (bVerified !== aVerified) return bVerified - aVerified;
    if (viewerTags.length > 0) {
      const aOverlap = dietTagOverlapCount(viewerTags, a.dietTags);
      const bOverlap = dietTagOverlapCount(viewerTags, b.dietTags);
      const aMatches = aOverlap > 0 ? 1 : 0;
      const bMatches = bOverlap > 0 ? 1 : 0;
      if (bMatches !== aMatches) return bMatches - aMatches;
      if (bOverlap !== aOverlap) return bOverlap - aOverlap;
    }
    const aCount = counts.get(a.id) ?? a.rankedCount ?? 0;
    const bCount = counts.get(b.id) ?? b.rankedCount ?? 0;
    if (bCount !== aCount) return bCount - aCount;
    return String(a.username ?? '').localeCompare(String(b.username ?? ''));
  });
}

export async function fetchProfileByUsername(username: string): Promise<ProfileRow | null> {
  const data = await runProfileSelectWithColumnFallback((columns) =>
    supabase.from('profiles').select(columns).eq('username', username).maybeSingle()
  );
  return data ? shapeProfileRow(data as unknown as ProfileRow & { diet_tags?: unknown }) : null;
}

export async function fetchProfileById(userId: string): Promise<ProfileRow | null> {
  const data = await runProfileSelectWithColumnFallback((columns) =>
    supabase.from('profiles').select(columns).eq('id', userId).maybeSingle()
  );
  return data ? shapeProfileRow(data as unknown as ProfileRow & { diet_tags?: unknown }) : null;
}

function defaultAvatarColorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash + userId.charCodeAt(i)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash] ?? AVATAR_COLORS[0];
}

function usernameFromAuthUser(user: { user_metadata?: unknown; email?: string | null }): string {
  const meta = user.user_metadata;
  const fromMeta =
    meta && typeof meta === 'object' && 'username' in meta
      ? String((meta as { username?: unknown }).username ?? '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_.]/g, '')
      : '';
  if (fromMeta.length >= 3) return fromMeta;
  const emailLocal = String(user.email ?? '')
    .split('@')[0]
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '');
  return emailLocal.length >= 3 ? emailLocal : '';
}

/**
 * Ensure the signed-in user has a `profiles` row. Some native sign-ups only
 * store the handle in auth metadata; the web app tolerates that, but Friends
 * and Profile need a real row (or at least a resolvable username).
 */
export async function ensureProfileForUser(userId: string): Promise<ProfileRow | null> {
  if (!userId || !isProfileUuid(userId)) return null;

  const existing = await fetchProfileById(userId);
  if (existing?.username?.trim()) return existing;

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user || user.id !== userId) return existing;

  const handle = existing?.username?.trim() || usernameFromAuthUser(user);
  if (!handle || handle.length < 3) return existing;

  const avatarColor = existing?.avatar_color ?? defaultAvatarColorForUser(userId);

  if (existing) {
    const { error } = await supabase
      .from('profiles')
      .update({ username: handle, avatar_color: avatarColor })
      .eq('id', userId);
    if (error) {
      console.warn('ensureProfileForUser update:', error.message);
      return { ...existing, username: handle, avatar_color: avatarColor };
    }
    return { ...existing, username: handle, avatar_color: avatarColor };
  }

  let data: Record<string, unknown> | null = null;
  let insertError: ProfileSelectError = null;
  try {
    data = await runProfileSelectWithColumnFallback((columns) =>
      supabase
        .from('profiles')
        .insert({ id: userId, username: handle, avatar_color: avatarColor, bio: null })
        .select(columns)
        .maybeSingle()
    );
  } catch (err) {
    insertError = err as ProfileSelectError;
  }

  if (insertError) {
    if (insertError.code === '23505') {
      const raced = await fetchProfileById(userId);
      if (raced?.username?.trim()) return raced;
    }
    console.warn('ensureProfileForUser insert:', insertError.message);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const fallback = usernameFromSession(session);
    if (!fallback) return null;
    return {
      id: userId,
      username: fallback,
      bio: null,
      avatar_color: avatarColor,
      diet_tags: [],
      zip_code: null,
      birthday: null,
      is_verified_ambassador: false,
    };
  }

  const row = data ? shapeProfileRow(data as ProfileRow & { diet_tags?: unknown }) : null;
  if (row?.username?.trim()) return row;
  return fetchProfileById(userId);
}

export async function fetchFollowerFollowingCounts(args: {
  username: string;
  userId: string;
}): Promise<{ followers: number; following: number }> {
  const ownUsername = await profileUsernameForUserId(args.userId);
  const target = normalizeFollowTargetUsername(args.username);
  const [followersRes, followingRes] = await Promise.all([
    target
      ? supabase
          .from('follows_by_username')
          .select('follower_id')
          .ilike('following_username', target)
      : Promise.resolve({ data: [] as { follower_id: string }[], error: null }),
    supabase
      .from('follows_by_username')
      .select('following_username')
      .eq('follower_id', args.userId),
  ]);
  const followingRows = (followingRes.data ?? []) as { following_username?: string | null }[];
  return {
    followers: dedupeFollowerIds((followersRes.data ?? []) as { follower_id: string }[]).length,
    following: countDistinctFollowingTargets(followingRows, ownUsername),
  };
}

/**
 * Whether `viewerId` follows `username`. Mirrors the web's `follows_by_username`
 * lookup.
 */
export async function viewerFollowsUsername(viewerId: string, username: string): Promise<boolean> {
  if (!viewerId || !username) return false;
  const target = normalizeFollowTargetUsername(username);
  if (!target) return false;
  const { data, error } = await supabase
    .from('follows_by_username')
    .select('follower_id')
    .eq('follower_id', viewerId)
    .ilike('following_username', target)
    .maybeSingle();
  if (error) {
    console.warn('viewerFollowsUsername:', error.message);
    return false;
  }
  return Boolean(data);
}

export async function followUsername(viewerId: string, username: string): Promise<void> {
  if (!viewerId || !username.trim()) return;
  const target = normalizeFollowTargetUsername(username);
  if (!target) return;
  if (await isSelfFollowTarget(viewerId, target)) return;
  const { error } = await supabase
    .from('follows_by_username')
    .insert({ follower_id: viewerId, following_username: target });
  if (error && error.code !== '23505') throw error;
}

export async function unfollowUsername(viewerId: string, username: string): Promise<void> {
  const target = normalizeFollowTargetUsername(username);
  if (!target) return;
  const { error } = await supabase
    .from('follows_by_username')
    .delete()
    .eq('follower_id', viewerId)
    .ilike('following_username', target);
  if (error) throw error;
}

/** Same handle as web `App.jsx` — unfollow is blocked in UI for this account. */
export const MANDATORY_FOLLOW_USERNAME = 'elanah';

/** Single in-app admin (matches `MANDATORY_FOLLOW_USERNAME`). Compared case-insensitively. */
export const ADMIN_USERNAME = 'elanah';

export function isAdminUsername(name: string | null | undefined): boolean {
  return String(name ?? '').trim().toLowerCase() === ADMIN_USERNAME;
}

/** Admin-only: toggle verified ambassador badge on another user's profile. */
export async function setVerifiedAmbassador(
  targetUserId: string,
  enabled: boolean
): Promise<void> {
  if (!isProfileUuid(targetUserId)) {
    throw new Error('Invalid user id');
  }
  const { data, error } = await supabase.rpc('set_verified_ambassador', {
    p_target_user_id: targetUserId,
    p_enabled: enabled,
  });
  if (error) throw error;
  const result = data as { ok?: boolean; reason?: string } | null;
  if (!result?.ok) {
    throw new Error(result?.reason === 'forbidden' ? 'Admin only' : 'Could not update verified status');
  }
}

export function isMandatoryFollowTarget(name: string | null | undefined): boolean {
  return String(name ?? '').trim().toLowerCase() === MANDATORY_FOLLOW_USERNAME;
}

/** Insert follow row to mandatory account if missing (no-op for that account itself). */
export async function ensureMandatoryFollowRow(followerUserId: string): Promise<void> {
  if (!followerUserId || !isProfileUuid(followerUserId)) return;
  const { data: prof } = await supabase.from('profiles').select('username').eq('id', followerUserId).maybeSingle();
  if (String(prof?.username ?? '').toLowerCase() === MANDATORY_FOLLOW_USERNAME) return;
  const { error } = await supabase.from('follows_by_username').insert({
    follower_id: followerUserId,
    following_username: MANDATORY_FOLLOW_USERNAME,
  });
  if (error && error.code !== '23505' && !String(error.message ?? '').toLowerCase().includes('duplicate')) {
    console.warn('ensureMandatoryFollowRow:', error.message);
  }
}

/**
 * Deduped “items ranked” counts per profile id — same identity and radar
 * filter as the profile ranked list / leaderboard.
 */
export async function fetchRankedCountsByUserIds(userIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set((userIds || []).filter(isProfileUuid))];
  if (ids.length === 0) return new Map();

  const counts = new Map(ids.map((id) => [id, 0]));
  const seenByUser = new Map(ids.map((id) => [id, new Set<string>()]));
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('posts')
      .select('user_id, item, store, stores, product_brand, radar_only, rating')
      .in('user_id', ids)
      .order('id', { ascending: true })
      .range(from, from + RANKED_COUNT_PAGE_SIZE - 1);
    if (error) {
      console.warn('fetchRankedCountsByUserIds:', error.message);
      return counts;
    }
    const batch = (data ?? []) as Array<{
      user_id: string;
      item: string | null;
      store?: string | null;
      stores?: string[] | null;
      product_brand?: string | null;
      radar_only?: boolean | null;
      rating?: number | null;
    }>;
    accumulateRankedCountsFromPostRows(batch, counts, seenByUser);
    if (batch.length < RANKED_COUNT_PAGE_SIZE) break;
    from += RANKED_COUNT_PAGE_SIZE;
  }
  return counts;
}

export type FriendsTabFollowingEntry = {
  id: string;
  username: string;
  avatarColor: string | null;
  rankedCount: number;
  isMandatory: boolean;
  isVerifiedAmbassador: boolean;
};

/**
 * Following list for the Friends tab — includes mandatory follow row + ranked counts
 * (same composition as web `loadFriends`).
 */
export async function loadFriendsTabFollowing(viewerId: string): Promise<FriendsTabFollowingEntry[]> {
  await ensureMandatoryFollowRow(viewerId);
  const ownUsername = await profileUsernameForUserId(viewerId);
  const { data: follows } = await supabase
    .from('follows_by_username')
    .select('following_username')
    .eq('follower_id', viewerId);
  const orderSeen = new Set<string>();
  const usernames: string[] = [];
  for (const f of follows ?? []) {
    const u = String((f as { following_username?: string }).following_username ?? '').trim();
    if (!u || orderSeen.has(u.toLowerCase()) || usernamesMatch(u, ownUsername)) continue;
    orderSeen.add(u.toLowerCase());
    usernames.push(u);
  }
  const hasMandatory = usernames.some((u) => u.toLowerCase() === MANDATORY_FOLLOW_USERNAME);
  const usernamesForProfiles = hasMandatory ? usernames : [...usernames, MANDATORY_FOLLOW_USERNAME];
  if (usernamesForProfiles.length === 0) return [];

  const profileByHandle = await fetchProfilesByLowercaseUsernames(usernamesForProfiles);

  const rowForHandle = (handle: string): FriendsTabFollowingEntry => {
    const prof = profileByHandle.get(normalizeFollowTargetUsername(handle));
    if (prof) {
      return {
        id: prof.id,
        username: prof.username,
        avatarColor: prof.avatar_color,
        rankedCount: 0,
        isMandatory: isMandatoryFollowTarget(prof.username),
        isVerifiedAmbassador: profileIsVerifiedAmbassador(prof),
      };
    }
    return {
      id: handle,
      username: handle,
      avatarColor: null,
      rankedCount: 0,
      isMandatory: isMandatoryFollowTarget(handle),
      isVerifiedAmbassador: false,
    };
  };

  let rows: FriendsTabFollowingEntry[] = usernames.map(rowForHandle);

  if (!rows.some((r) => String(r.username).toLowerCase() === MANDATORY_FOLLOW_USERNAME)) {
    rows.unshift({
      id: MANDATORY_FOLLOW_USERNAME,
      username: MANDATORY_FOLLOW_USERNAME,
      avatarColor: null,
      rankedCount: 0,
      isMandatory: true,
      isVerifiedAmbassador: true,
    });
  }

  let countsByUserId = new Map<string, number>();
  try {
    countsByUserId = await fetchRankedCountsByUserIds(rows.map((r) => r.id));
  } catch (e) {
    console.warn('loadFriendsTabFollowing counts:', (e as Error)?.message ?? e);
  }

  return rows
    .filter((r) => r.id !== viewerId && !usernamesMatch(r.username, ownUsername))
    .map((r) => ({
      ...r,
      rankedCount: isProfileUuid(r.id) ? countsByUserId.get(r.id) ?? 0 : 0,
    }));
}

export type FindPeopleProfileRow = {
  id: string;
  username: string;
  bio: string | null;
  avatarColor: string | null;
  dietTags: string[];
  rankedCount?: number;
  isVerifiedAmbassador: boolean;
};

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Username prefix search for @mention autocomplete (min 1 char). */
export async function searchProfilesByUsernamePrefix(
  rawPrefix: string,
  excludeUserId: string,
  limit = 8
): Promise<FindPeopleProfileRow[]> {
  const q = String(rawPrefix ?? '')
    .trim()
    .replace(/^@/, '')
    .replace(/"/g, '');
  if (!q) return [];
  const pat = `${escapeIlikePattern(q)}%`;
  const quoted = `"${pat.replace(/"/g, '\\"')}"`;
  let data: unknown[] | null = null;
  try {
    data = await runProfileSelectWithColumnFallback((columns) =>
      supabase
        .from('profiles')
        .select(columns)
        .ilike('username', quoted)
        .neq('id', excludeUserId)
        .order('username', { ascending: true })
        .limit(limit)
    );
  } catch (error) {
    console.warn(
      'searchProfilesByUsernamePrefix:',
      error instanceof Error ? error.message : error
    );
    return [];
  }
  return (data ?? [])
    .map((r) =>
      shapeFindPeopleProfileRow(
        r as {
          id: string;
          username: string;
          bio: string | null;
          avatar_color: string | null;
          diet_tags?: unknown;
        }
      )
    )
    .filter((r) => r.id !== excludeUserId && Boolean(String(r.username ?? '').trim()));
}

/**
 * Other profiles on the app for suggested-follow rails.
 * Diet-tag overlap with the viewer first (when they have restrictions set), then ranked count.
 */
export async function fetchSuggestedFriendProfiles(
  excludeUserId: string,
  limit = 40
): Promise<FindPeopleProfileRow[]> {
  if (!excludeUserId || !isProfileUuid(excludeUserId)) return [];
  const viewerProfile = await fetchProfileById(excludeUserId);
  const viewerDietTags = viewerProfile?.diet_tags ?? [];
  const poolSize = Math.max(limit * 4, 80);
  let data: unknown[] | null = null;
  try {
    data = await runProfileSelectWithColumnFallback((columns) =>
      supabase
        .from('profiles')
        .select(columns)
        .neq('id', excludeUserId)
        .order('username', { ascending: true })
        .limit(poolSize)
    );
  } catch (error) {
    console.warn('fetchSuggestedFriendProfiles:', error instanceof Error ? error.message : error);
    return [];
  }
  const shaped = (data ?? [])
    .map((r) =>
      shapeFindPeopleProfileRow(
        r as {
          id: string;
          username: string;
          bio: string | null;
          avatar_color: string | null;
          diet_tags?: unknown;
        }
      )
    )
    .filter((r) => Boolean(String(r.username ?? '').trim()));
  const counts = await fetchRankedCountsByUserIds(shaped.map((r) => r.id));
  return sortSuggestedFriendProfiles(shaped, { viewerDietTags, rankedCounts: counts })
    .slice(0, limit)
    .map((r) => ({ ...r, rankedCount: counts.get(r.id) ?? 0 }));
}

/** Profile search for Find People (username or bio), excludes self. Min 2 chars. */
export async function searchProfilesForFindPeople(
  rawQuery: string,
  excludeUserId: string,
  excludeUsername?: string
): Promise<FindPeopleProfileRow[]> {
  const q = rawQuery.trim().replace(/"/g, '').replace(/\n/g, ' ');
  if (q.length < 2) return [];
  const pat = `%${escapeIlikePattern(q)}%`;
  const quoted = `"${pat.replace(/"/g, '\\"')}"`;
  const ex = String(excludeUsername ?? '').trim();
  let data: unknown[] | null = null;
  try {
    data = await runProfileSelectWithColumnFallback((columns) => {
      let qb = supabase
        .from('profiles')
        .select(columns)
        .or(`username.ilike.${quoted},bio.ilike.${quoted}`)
        .limit(30);
      if (ex.length > 0) qb = qb.neq('username', ex);
      return qb;
    });
  } catch (error) {
    console.warn('searchProfilesForFindPeople:', error instanceof Error ? error.message : error);
    return [];
  }
  return (data ?? [])
    .map((r) =>
      shapeFindPeopleProfileRow(
        r as {
          id: string;
          username: string;
          bio: string | null;
          avatar_color: string | null;
          diet_tags?: unknown;
        }
      )
    )
    .filter((r) => r.id !== excludeUserId && !usernamesMatch(r.username, ex));
}

export type ConnectionRow = {
  username: string;
  avatarColor: string | null;
  isVerifiedAmbassador: boolean;
};

/**
 * Users who follow `username` (profile handle). Mirrors web ProfilePage followers query.
 */
export async function fetchFollowersForProfileUsername(username: string): Promise<ConnectionRow[]> {
  const handle = normalizeFollowTargetUsername(username);
  if (!handle) return [];
  const { data, error } = await supabase
    .from('follows_by_username')
    .select(`follower_id, profile:follower_id (${PROFILE_EMBED_SELECT})`)
    .ilike('following_username', handle);
  if (error) {
    console.warn('fetchFollowersForProfileUsername:', error.message);
    return [];
  }
  type Prof = {
    username: string | null;
    avatar_color: string | null;
    is_verified_ambassador?: boolean | null;
  };
  type RawRow = { follower_id?: string | null; profile: Prof | Prof[] | null };
  const raw = ((data ?? []) as unknown as RawRow[]) ?? [];
  const seenFollowers = new Set<string>();
  return raw
    .flatMap((row) => {
      const followerId = String(row.follower_id ?? '').trim();
      if (!followerId || seenFollowers.has(followerId)) return [];
      seenFollowers.add(followerId);
      const p = row.profile;
      const prof = Array.isArray(p) ? p[0] : p;
      const uname = String(prof?.username ?? '').trim();
      if (!uname) return [];
      return [
        {
          username: uname,
          avatarColor: prof?.avatar_color ?? null,
          isVerifiedAmbassador: profileIsVerifiedAmbassador(prof),
        },
      ];
    });
}

/**
 * Usernames that profile `userId` follows. Mirrors web ProfilePage following query.
 */
export async function fetchFollowingForProfileUserId(userId: string): Promise<ConnectionRow[]> {
  if (!userId || !isProfileUuid(userId)) return [];
  const { data: follows, error: fErr } = await supabase
    .from('follows_by_username')
    .select('following_username')
    .eq('follower_id', userId);
  if (fErr) {
    console.warn('fetchFollowingForProfileUserId:', fErr.message);
    return [];
  }
  const ownUsername = await profileUsernameForUserId(userId);
  const names = [
    ...new Set(
      (follows ?? [])
        .map((f: { following_username: string }) => normalizeFollowTargetUsername(f.following_username))
        .filter((n) => n.length > 0)
        .filter((n) => !usernamesMatch(n, ownUsername))
    ),
  ] as string[];
  if (names.length === 0) return [];
  const { data: profs, error: pErr } = await supabase
    .from('profiles')
    .select(`username, avatar_color, is_verified_ambassador`)
    .in('username', names);
  if (pErr) {
    console.warn('fetchFollowingForProfileUserId profiles:', pErr.message);
    return names.map((n) => ({
      username: n,
      avatarColor: null,
      isVerifiedAmbassador: isMandatoryFollowTarget(n),
    }));
  }
  const byName = new Map(
    (profs ?? []).map(
      (p: {
        username: string;
        avatar_color: string | null;
        is_verified_ambassador?: boolean | null;
      }) => [p.username, p]
    )
  );
  return names.map((n) => {
    const prof = byName.get(n);
    return {
      username: n,
      avatarColor: prof?.avatar_color ?? null,
      isVerifiedAmbassador: profileIsVerifiedAmbassador(prof),
    };
  });
}

// ─── Search API (Vercel) ──────────────────────────────────────────────────────

const SEARCH_API_URL = 'https://bagged.vercel.app/api/search';
const FATSECRET_FOOD_API_URL = 'https://bagged.vercel.app/api/fatsecret-food';

const EMPTY_RATE_MACRO_FORM: RateMacroFormState = {
  cal: '',
  protein: '',
  carbs: '',
  fat: '',
  servingLabel: '',
};

export type SearchProductRow = {
  description: string;
  /** Stable key from curated_products / posts when available */
  descriptionKey?: string | null;
  brandName: string;
  brandOwner: string;
  foodCategory: string;
  /** All Bagged categories when sourced from curated_products */
  foodCategories?: string[];
  fatSecretId?: string | null;
  cal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  /** FatSecret / USDA serving line from `/api/search` when present */
  servingLabel?: string | null;
  /** Staff-maintained catalog row — ranked with a small boost like the web */
  isCurated?: boolean;
  isLocal?: boolean;
  /** How many users have rated this curated product (excludes want-to-try). */
  ratedCount?: number;
  /** FatSecret merge order from /api/search (preserves provider ordering) */
  __providerOrder?: number;
};

/** "Brand" preference order — matches the web `searchRowBrand`. */
export function searchRowBrand(row: { brandName?: string | null; brandOwner?: string | null }): string {
  const nm = String(row.brandName ?? '').trim();
  const ow = String(row.brandOwner ?? '').trim();
  return nm || ow;
}

// ─── Curated + merged search (matches web `fetchCuratedProductsForSearch` + `/api/search`) ─

const SEARCH_MERGE_MAX = 10;

function normalizedSearchPhrase(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTraderJoesTokens(value: string): string {
  return normalizedSearchPhrase(value)
    .replace(/\btrader'?s?\b/g, ' ')
    .replace(/\bjoe'?s?\b/g, ' ')
    .replace(/\btj'?s?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function curatedSearchPhrases(query: string): string[] {
  const q = normalizedSearchPhrase(query);
  const stripped = stripTraderJoesTokens(q);
  const phrases = [q];
  if (stripped && stripped !== q) phrases.push(stripped);
  return [...new Set(phrases.filter((p) => p.length >= 2))];
}

function sanitizeCuratedTextField(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === 'none' || lower === 'n/a') return '';
  return s;
}

type CuratedProductRow = Record<string, unknown>;

function curatedRowToSearchProductRow(row: CuratedProductRow): SearchProductRow {
  const isVerified =
    String(row.nutrition_verification_state ?? row.nutritionVerification ?? '') === 'verified';
  const num = (key: 'cal' | 'protein' | 'carbs' | 'fat') =>
    isVerified ? macroNumFromDb(row[key]) : macroNumForDisplay(row[key], row);
  const cal = num('cal');
  const protein = num('protein');
  const carbs = num('carbs');
  const fat = num('fat');
  const brand = sanitizeCuratedTextField(row.brand);
  const categoryRow = {
    category: (row.category as string | null) ?? null,
    categories: (row.categories as string[] | null) ?? null,
  };
  const foodCategories = categoriesForRow(categoryRow);
  const category = primaryCategoryForRow(categoryRow);
  const rawDesc = String(row.description ?? '').trim();
  const description =
    sanitizeCuratedTextField(row.description) ||
    (rawDesc && !/^(null|undefined)$/i.test(rawDesc) ? rawDesc : '');
  const dkRaw = row.description_key != null ? String(row.description_key).trim() : '';
  const descriptionKey = dkRaw || normalizedDescriptionKeyFromItem(description);
  const ratedRaw = row.rated_count;
  const ratedCount =
    typeof ratedRaw === 'number' && Number.isFinite(ratedRaw)
      ? Math.max(0, Math.floor(ratedRaw))
      : typeof ratedRaw === 'string' && ratedRaw.trim() !== '' && Number.isFinite(Number(ratedRaw))
        ? Math.max(0, Math.floor(Number(ratedRaw)))
        : undefined;

  return {
    description,
    descriptionKey,
    brandName: brand,
    brandOwner: brand,
    foodCategory: category,
    foodCategories,
    isCurated: true,
    fatSecretId: null,
    cal,
    protein,
    carbs,
    fat,
    ...(ratedCount != null ? { ratedCount } : {}),
  };
}

/** Official curated products table — same ILIKE strategy as the web app. */
export async function fetchCuratedProductsForSearch(query: string): Promise<SearchProductRow[]> {
  const phrases = curatedSearchPhrases(query);
  if (phrases.length === 0) return [];

  const rowsByKey = new Map<string, CuratedProductRow>();

  for (const phrase of phrases) {
    const cleaned = phrase.replace(/[().,]/g, ' ').trim();
    const safe = escapeIlikePattern(cleaned);
    const orFilter = `description.ilike.%${safe}%,brand.ilike.%${safe}%`;
    const { data, error } = await supabase.from('curated_products').select('*').or(orFilter).limit(25);
    if (error) {
      console.warn('fetchCuratedProductsForSearch:', error.message);
      continue;
    }
    for (const row of data ?? []) {
      const r = row as CuratedProductRow;
      const keyRaw = r.description_key != null ? String(r.description_key).trim() : '';
      const key = keyRaw || normalizedDescriptionKeyFromItem(String(r.description ?? ''));
      if (!key || rowsByKey.has(key)) continue;
      rowsByKey.set(key, r);
    }
  }

  return [...rowsByKey.values()].map(curatedRowToSearchProductRow);
}

/** Dedupe by normalized description key — first row wins (curated merged before API). */
export function dedupeSearchProductsByDescription(products: SearchProductRow[]): SearchProductRow[] {
  const seen = new Set<string>();
  return products.filter((p) => {
    const k = normalizedDescriptionKeyFromItem(p.description);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function queryTokens(value: string): string[] {
  return normalizedSearchPhrase(value).split(/\s+/).filter(Boolean);
}

function searchRowRelevanceScore(
  query: string,
  row: SearchProductRow,
  options: { omitSourceBias?: boolean } = {}
): number {
  const q = normalizedSearchPhrase(query);
  if (!q) return 0;
  const description = normalizedSearchPhrase(row.description);
  const brand = normalizedSearchPhrase(searchRowBrand(row));
  const full = `${brand} ${description}`.trim();
  const tokens = queryTokens(stripTraderJoesTokens(q)).filter((t) => t.length >= 2);

  let score = 0;
  if (description === q) score += 500;
  if (description.startsWith(q)) score += 260;
  if (full.startsWith(q)) score += 220;
  if (description.includes(q)) score += 180;
  if (full.includes(q)) score += 120;
  const strippedQ = stripTraderJoesTokens(q);
  if (description.includes(strippedQ) && strippedQ.length >= 3) score += 140;
  if (!options.omitSourceBias) {
    if (row.isCurated) score += 24;
    if (row.isLocal) score += 8;
  }

  let matched = 0;
  for (const token of tokens) {
    if (description.includes(token)) {
      score += description.startsWith(token) ? 30 : 16;
      matched += 1;
      continue;
    }
    if (brand.includes(token)) {
      score += 12;
      matched += 1;
    }
  }
  if (tokens.length > 0 && matched === tokens.length) score += 110;

  return score;
}

function rankSearchRowsForQuery(
  query: string,
  rows: SearchProductRow[],
  options: { omitSourceBias?: boolean } = {}
): SearchProductRow[] {
  return [...rows].sort((a, b) => {
    const oa = a.__providerOrder;
    const ob = b.__providerOrder;
    const aFs = typeof oa === 'number';
    const bFs = typeof ob === 'number';
    if (aFs && bFs) return oa - ob;
    const sa = searchRowRelevanceScore(query, a, options);
    const sb = searchRowRelevanceScore(query, b, options);
    if (aFs !== bFs) {
      if (sb !== sa) return sb - sa;
      return String(a.description ?? '').length - String(b.description ?? '').length;
    }
    if (sb !== sa) return sb - sa;
    return String(a.description ?? '').length - String(b.description ?? '').length;
  });
}

function parseSearchApiPayload(payload: unknown): SearchProductRow[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: unknown[] }).results
      : [];
  return rows
    .map((p) => {
      const r = p as Partial<SearchProductRow & { __providerOrder?: number }>;
      const slRaw = r.servingLabel;
      const servingLabel =
        typeof slRaw === 'string' && slRaw.trim() ? slRaw.trim() : null;
      return {
        description: String(r.description ?? '').trim(),
        descriptionKey: r.descriptionKey != null ? String(r.descriptionKey).trim() : undefined,
        brandName: String(r.brandName ?? '').trim(),
        brandOwner: String(r.brandOwner ?? '').trim(),
        foodCategory: String(r.foodCategory ?? '').trim(),
        fatSecretId: r.fatSecretId ?? null,
        cal: macroNumFromSearchApi(r.cal),
        protein: macroNumFromSearchApi(r.protein),
        carbs: macroNumFromSearchApi(r.carbs),
        fat: macroNumFromSearchApi(r.fat),
        servingLabel,
        isCurated: r.isCurated === true,
        isLocal: r.isLocal === true,
        __providerOrder: typeof r.__providerOrder === 'number' ? r.__providerOrder : undefined,
      };
    })
    .filter((row) => row.description.length > 0);
}

/** Raw `/api/search` rows (FatSecret, USDA, Kroger per server config). */
export async function fetchSearchApiProductsOnly(
  query: string,
  options?: { sources?: string }
): Promise<SearchProductRow[]> {
  const q = String(query ?? '').trim();
  const body: Record<string, unknown> = { query: q };
  if (options?.sources != null && String(options.sources).trim() !== '') {
    body.sources = options.sources.trim();
  }
  const res = await fetch(SEARCH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    console.warn('search API HTTP error:', res.status, bodyText.slice(0, 400));
    return [];
  }
  const payload: unknown = await res.json();
  return parseSearchApiPayload(payload);
}

function searchProductRowHasMacros(row: SearchProductRow): boolean {
  return macrosHaveAnyValue({
    cal: row.cal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
  });
}

/**
 * Best `/api/search` macro match for autofill — prefers a FatSecret row when one matches the query.
 */
export async function fetchRateMacroHintFromSearchApi(
  productLabel: string
): Promise<RateMacroFormState | null> {
  const q = String(productLabel ?? '').trim();
  if (q.length < 2) return null;

  try {
    const rows = await fetchSearchApiProductsOnly(q);
    const ranked = rankSearchRowsForQuery(q, rows);
    const fs = ranked.find((r) => r.fatSecretId && searchProductRowHasMacros(r));
    const pick = fs ?? ranked.find(searchProductRowHasMacros);
    if (!pick) return null;
    return rateMacroFormFromNumbers({
      cal: pick.cal,
      protein: pick.protein,
      carbs: pick.carbs,
      fat: pick.fat,
      servingLabel: pick.servingLabel,
    });
  } catch (e) {
    console.warn('fetchRateMacroHintFromSearchApi:', e);
    return null;
  }
}

/**
 * Curated Supabase rows + Vercel `/api/search` (FatSecret / USDA / Kroger per server config),
 * deduped and ranked like the web app.
 */
export async function searchProducts(query: string): Promise<SearchProductRow[]> {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];

  try {
    const [curatedProducts, apiProducts] = await Promise.all([
      fetchCuratedProductsForSearch(q),
      fetchSearchApiProductsOnly(q).catch((err) => {
        console.warn('search API failed:', err);
        return [];
      }),
    ]);
    const merged = dedupeSearchProductsByDescription([...curatedProducts, ...apiProducts]);
    return rankSearchRowsForQuery(q, merged).slice(0, SEARCH_MERGE_MAX);
  } catch (err) {
    console.warn('searchProducts failed:', err);
    return [];
  }
}

/**
 * Onboarding rated pick — scored with the same dynamic ranking pipeline as the rate flow.
 */
export type OnboardingRatedPick = {
  item: string;
  brand: string;
  store: string;
  stores: string[];
  category: string;
  subcategory?: string;
  vibe: Vibe;
  rating: number;
  rankPosition: number;
  tiedAbove?: boolean;
  dietTags?: string[];
  /** Optional review blurb — omitted or empty when the user skips it. */
  note?: string;
  /** Search hit at pick time — used to resolve FatSecret / API macros on post create. */
  searchRow?: SearchProductRow | null;
};

/** @deprecated Use `OnboardingRatedPick` — legacy starter shape without scoring fields. */
export type StarterOnboardingPick = Omit<
  OnboardingRatedPick,
  'vibe' | 'rating' | 'rankPosition' | 'tiedAbove'
>;

/**
 * Inserts ranked onboarding posts with dynamic scores, skipping keys the user already has.
 */
export async function insertOnboardingRatedPosts(
  userId: string,
  picks: OnboardingRatedPick[]
): Promise<void> {
  if (!userId || !isProfileUuid(userId) || picks.length === 0) return;

  const { data: existingPosts = [] } = await supabase
    .from('posts')
    .select('item, store, stores, product_brand')
    .eq('user_id', userId);

  const existingKeys = new Set(
    (existingPosts ?? []).map((p) =>
      productDescriptionKey(
        String((p as { item?: string | null }).item ?? ''),
        String((p as { product_brand?: string | null }).product_brand ?? '')
      )
    )
  );

  const rowsToCreate = picks.filter((r) => {
    const key = productDescriptionKey(r.item, r.brand);
    return Boolean(key && !existingKeys.has(key));
  });

  const createdBySubcategory = new Map<
    string,
    Array<{ id: string | number; pick: OnboardingRatedPick }>
  >();

  for (const row of rowsToCreate) {
    const stores = storesForBrandAndSelections(row.brand, row.stores ?? []);
    const store = stores[0] ?? '';
    const descKey = productDescriptionKey(row.item, row.brand);
    const storedCategory = String(row.category ?? 'Snacks').trim() || 'Snacks';
    const storedSubcategory = String(row.subcategory ?? '').trim() || undefined;

    const macroForm = await resolveMacrosForRateProduct({
      item: row.item,
      brand: row.brand,
      searchRow: row.searchRow ?? null,
    });
    const macrosPayload = rateMacroFormToPostMacrosPayload(macroForm);
    let dietTags = Array.isArray(row.dietTags) ? row.dietTags.filter(Boolean) : [];
    if (
      qualifiesHighProteinLowCalFromMacroForm(macroForm) &&
      !dietTags.includes(HIGH_PROTEIN_LOW_CAL_ID)
    ) {
      dietTags = [...dietTags, HIGH_PROTEIN_LOW_CAL_ID];
    }

    const { id: postId } = await createPost({
      userId,
      item: row.item,
      descriptionKey: descKey,
      store,
      stores,
      productBrand: row.brand,
      category: storedCategory,
      subcategory: storedSubcategory,
      emoji: '',
      note: String(row.note ?? '').trim(),
      rating: row.rating,
      rankPosition: row.rankPosition,
      dietTags,
      macros: macrosPayload,
      vibe: normalizeVibe(row.vibe),
      tiedAbove: row.tiedAbove === true,
    });

    if (postId == null) continue;

    const scopeKey = storedSubcategory ?? subcategoryForRow({ subcategory: null, category: storedCategory });
    if (!createdBySubcategory.has(scopeKey)) createdBySubcategory.set(scopeKey, []);
    createdBySubcategory.get(scopeKey)!.push({ id: postId, pick: row });

    try {
      await propagateProductMetadataFromRanking({
        userId,
        item: row.item,
        descriptionKey: descKey,
        productBrand: row.brand,
        category: storedCategory,
        subcategory: storedSubcategory,
        store,
        stores,
        dietTags,
        macros: macrosPayload,
        sourcePostId: postId,
      });
    } catch (propErr) {
      console.warn('insertOnboardingRatedPosts propagate:', propErr);
    }
  }

  for (const peers of createdBySubcategory.values()) {
    const sorted = [...peers].sort(
      (a, b) => (Number(a.pick.rankPosition) || 999) - (Number(b.pick.rankPosition) || 999)
    );
    await syncPeerPostRanks(
      userId,
      sorted.map((entry, index) => ({
        id: entry.id,
        rating: entry.pick.rating,
        rankPosition: index + 1,
        tiedAbove: entry.pick.tiedAbove === true,
      }))
    );
  }
}

/** @deprecated Use `insertOnboardingRatedPosts`. */
export async function insertOnboardingStarterPosts(
  userId: string,
  picks: StarterOnboardingPick[]
): Promise<void> {
  return insertOnboardingRatedPosts(
    userId,
    picks.map((row, index) => ({
      ...row,
      vibe: 'liked',
      rating: 10,
      rankPosition: index + 1,
      tiedAbove: false,
    }))
  );
}

// ─── Macros (post.macros JSON) ────────────────────────────────────────────────

export type PostMacros = {
  cal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  servingLabel?: string | null;
};

/** True when a macro field has a meaningful value (not blank and not zero). */
export function macroNumericHasDisplayValue(v: unknown): boolean {
  if (v === '' || v == null) return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/** True when a macro was explicitly set — `0` counts, `null`/blank does not. */
export function macroFieldIsSet(v: unknown): boolean {
  if (v === '' || v == null) return false;
  const n = Number(v);
  return Number.isFinite(n);
}

function macroNumFromDb(v: unknown): number | null {
  if (!macroFieldIsSet(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const MACRO_NUMERIC_KEYS = ['cal', 'protein', 'carbs', 'fat'] as const;

/** User-entered macros with every explicitly-set numeric field at 0 (e.g. water). */
function macrosIsIntentionalAllZero(row: Record<string, unknown>): boolean {
  const setFields = MACRO_NUMERIC_KEYS.filter((k) => macroFieldIsSet(row[k]));
  if (setFields.length === 0) return false;
  return setFields.every((k) => Math.round(Number(row[k])) === 0);
}

/** When any macro is > 0, keep explicit 0s on other fields (e.g. 0g carbs on ground beef). */
function macroPreserveExplicitZeros(
  row: Record<string, unknown>,
  opts?: NormalizeMacrosOptions
): boolean {
  if (opts?.includeZeroValues) return true;
  if (opts?.allowIntentionalAllZeros && macrosIsIntentionalAllZero(row)) return true;
  return MACRO_NUMERIC_KEYS.some((k) => macroNumericHasDisplayValue(row[k]));
}

function macroNumForDisplay(
  v: unknown,
  row: Record<string, unknown>,
  opts?: NormalizeMacrosOptions
): number | null {
  if (!macroFieldIsSet(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (macroPreserveExplicitZeros(row, opts)) return n;
  return macroNumericHasDisplayValue(v) ? n : null;
}

function macroNumFromSearchApi(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Form / pill display — keep decimals, strip float noise and trailing zeros. */
export function formatMacroNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(parseFloat(n.toFixed(2)));
}

export type NormalizeMacrosOptions = {
  /** Verified curated rows: show intentional zeros; unverified stubs keep hiding default 0s. */
  includeZeroValues?: boolean;
  /** Saved post macros with explicit zeros — display pills; catalog stubs stay hidden. */
  allowIntentionalAllZeros?: boolean;
};

/** True when a rate-form macro text field was entered, including `"0"`. */
export function rateMacroFormFieldHasValue(v: string | null | undefined): boolean {
  return String(v ?? '').trim().length > 0;
}

/** Route/query params for prefilling the rate flow nutrition step from macro form state. */
export function rateMacroFormToPrefillParams(form: RateMacroFormState): Record<string, string> {
  const out: Record<string, string> = {};
  if (rateMacroFormFieldHasValue(form.cal)) out.prefilledMacroCal = form.cal.trim();
  if (rateMacroFormFieldHasValue(form.protein)) out.prefilledMacroProtein = form.protein.trim();
  if (rateMacroFormFieldHasValue(form.carbs)) out.prefilledMacroCarbs = form.carbs.trim();
  if (rateMacroFormFieldHasValue(form.fat)) out.prefilledMacroFat = form.fat.trim();
  if (rateMacroFormFieldHasValue(form.servingLabel)) {
    out.prefilledMacroServing = form.servingLabel.trim();
  }
  return out;
}

/** Parse a rate-form macro field to a number, preserving explicit `0` and decimals. */
export function rateMacroFormFieldToOptionalNumber(
  v: string | null | undefined
): number | undefined {
  if (!rateMacroFormFieldHasValue(v)) return undefined;
  const n = Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/** Normalize `posts.macros` for feed/profile (includes intentional all-zero entries). */
export function normalizePostMacros(m: unknown): PostMacros | null {
  return normalizeMacros(m, { allowIntentionalAllZeros: true });
}

export function macrosHaveAnyValue(
  m: unknown,
  opts?: NormalizeMacrosOptions
): m is PostMacros {
  if (!m || typeof m !== 'object') return false;
  const r = m as Record<string, unknown>;
  const keys: (keyof PostMacros)[] = ['cal', 'protein', 'carbs', 'fat'];
  const hasNum = opts?.includeZeroValues
    ? (k: keyof PostMacros) => macroFieldIsSet(r[k])
    : (k: keyof PostMacros) => macroNumericHasDisplayValue(r[k]);
  if (keys.some(hasNum)) return true;
  if (opts?.allowIntentionalAllZeros && macrosIsIntentionalAllZero(r)) return true;
  const sl = r.servingLabel;
  return typeof sl === 'string' && sl.trim().length > 0;
}

/** Coerce a macros payload to numbers (or null) for display. */
export function normalizeMacros(m: unknown, opts?: NormalizeMacrosOptions): PostMacros | null {
  if (!macrosHaveAnyValue(m, opts)) return null;
  const r = m as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    opts?.includeZeroValues ? macroNumFromDb(v) : macroNumForDisplay(v, r, opts);
  const out: PostMacros = {
    cal: num(r.cal),
    protein: num(r.protein),
    carbs: num(r.carbs),
    fat: num(r.fat),
    servingLabel:
      typeof r.servingLabel === 'string' && r.servingLabel.trim() ? r.servingLabel.trim() : null,
  };
  const hasNum = opts?.includeZeroValues
    ? (k: keyof PostMacros) => macroFieldIsSet(out[k])
    : (k: keyof PostMacros) => macroNumericHasDisplayValue(out[k]);
  const intentionalAllZero =
    opts?.allowIntentionalAllZeros && macrosIsIntentionalAllZero(r);
  if (
    !MACRO_NUMERIC_KEYS.some((k) => hasNum(k)) &&
    !out.servingLabel &&
    !intentionalAllZero
  ) {
    return null;
  }
  return out;
}

/** Discover / catalog rows — verified staff data may include intentional zeros. */
export function normalizeDiscoverExploreMacros(row: {
  cal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  servingLabel?: string | null;
  nutritionVerification?: 'verified' | 'unverified';
}): PostMacros | null {
  const isVerified = row.nutritionVerification === 'verified';
  return normalizeMacros(
    {
      cal: row.cal,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      servingLabel: row.servingLabel,
    },
    {
      includeZeroValues: isVerified,
      allowIntentionalAllZeros:
        !isVerified &&
        curatedHasCommunityMacroSignal({
          cal: row.cal,
          protein: row.protein,
          carbs: row.carbs,
          fat: row.fat,
          serving_label: row.servingLabel,
        }),
    }
  );
}

/** First community post with usable macros (posts should be newest-first). */
export function bestMacrosFromPosts(posts: Array<{ macros?: unknown }>): PostMacros | null {
  for (const p of posts) {
    const m = normalizePostMacros(p.macros);
    if (m) return m;
  }
  return null;
}

/** Unverified catalog row with a serving label — treat explicit all-zero macros as real (e.g. water). */
function curatedHasCommunityMacroSignal(curated: {
  cal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  serving_label?: string | null;
}): boolean {
  if (String(curated.serving_label ?? '').trim()) return true;
  return MACRO_NUMERIC_KEYS.some((k) =>
    macroNumericHasDisplayValue((curated as Record<string, unknown>)[k])
  );
}

/** Shared product-profile macros: staff-verified catalog, then community posts, then catalog fallbacks. */
export function resolveProductProfileMacros(args: {
  curated: VerifiedCuratedNutrition | null;
  posts: Array<{ macros?: unknown }>;
}): PostMacros | null {
  if (args.curated?.nutrition_verified === true) {
    const fromVerified = normalizeMacros(
      {
        cal: args.curated.cal,
        protein: args.curated.protein,
        carbs: args.curated.carbs,
        fat: args.curated.fat,
        servingLabel: args.curated.serving_label,
      },
      { includeZeroValues: true }
    );
    if (fromVerified) return fromVerified;
  }

  const fromPosts = bestMacrosFromPosts(args.posts);
  if (fromPosts) return fromPosts;

  if (args.curated) {
    return normalizeMacros(
      {
        cal: args.curated.cal,
        protein: args.curated.protein,
        carbs: args.curated.carbs,
        fat: args.curated.fat,
        servingLabel: args.curated.serving_label,
      },
      {
        allowIntentionalAllZeros: curatedHasCommunityMacroSignal(args.curated),
      }
    );
  }
  return null;
}

/** Rate-screen nutrition step — string fields bound to `TextInput`s */
export type RateMacroFormState = {
  cal: string;
  protein: string;
  carbs: string;
  fat: string;
  servingLabel: string;
};

export function rateMacroFormFromNumbers(
  args: {
    cal?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
    servingLabel?: string | null;
  },
  opts?: NormalizeMacrosOptions
): RateMacroFormState {
  const row: Record<string, unknown> = {
    cal: args.cal,
    protein: args.protein,
    carbs: args.carbs,
    fat: args.fat,
  };
  const preserve = macroPreserveExplicitZeros(row, opts);
  const str = (n: number | null | undefined) => {
    if (n == null || !macroFieldIsSet(n)) return '';
    if (preserve) return formatMacroNumber(Number(n));
    return macroNumericHasDisplayValue(n) ? formatMacroNumber(Number(n)) : '';
  };
  return {
    cal: str(args.cal),
    protein: str(args.protein),
    carbs: str(args.carbs),
    fat: str(args.fat),
    servingLabel: String(args.servingLabel ?? '').trim(),
  };
}

export function rateMacroFormHasAny(f: RateMacroFormState): boolean {
  return (
    rateMacroFormFieldHasValue(f.cal) ||
    rateMacroFormFieldHasValue(f.protein) ||
    rateMacroFormFieldHasValue(f.carbs) ||
    rateMacroFormFieldHasValue(f.fat) ||
    rateMacroFormFieldHasValue(f.servingLabel)
  );
}

function fatSecretMacroNumbersToForm(args: FatSecretMacroNumbers): RateMacroFormState {
  return rateMacroFormFromNumbers(args);
}

/** Prefer `primary`; backfill blank fields from `fallback` (e.g. food.get over search row). */
function mergeRateMacroForms(
  primary: RateMacroFormState,
  fallback: RateMacroFormState
): RateMacroFormState {
  const pick = (key: keyof RateMacroFormState) => {
    const p = String(primary[key] ?? '').trim();
    if (rateMacroFormFieldHasValue(p)) return p;
    return String(fallback[key] ?? '').trim();
  };
  return {
    cal: pick('cal'),
    protein: pick('protein'),
    carbs: pick('carbs'),
    fat: pick('fat'),
    servingLabel: pick('servingLabel'),
  };
}

/**
 * Fetch full nutrition for a FatSecret food id (`food.get` via server proxy).
 */
export async function fetchFatSecretFoodMacros(
  foodId: string
): Promise<RateMacroFormState | null> {
  const id = String(foodId ?? '').trim();
  if (!id) return null;

  try {
    const res = await fetch(FATSECRET_FOOD_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foodId: id }),
    });
    if (!res.ok) {
      console.warn('[FatSecret] food.get HTTP error', res.status);
      return null;
    }

    const payload = (await res.json().catch(() => null)) as {
      raw?: unknown;
      macros?: Partial<FatSecretMacroNumbers> & { servingLabel?: string | null };
    } | null;

    const raw = payload?.raw ?? null;
    if (__DEV__) {
      console.log('[FatSecret] raw food.get response', JSON.stringify(raw, null, 2));
    }

    const parsed = raw ? parseFatSecretMacrosFromFoodPayload(raw) : null;
    if (parsed) {
      if (__DEV__) console.log('[FatSecret] parsed serving macros', parsed);
      const form = fatSecretMacroNumbersToForm(parsed);
      if (rateMacroFormHasAny(form)) return form;
    }

    const m = payload?.macros;
    if (m && typeof m === 'object') {
      const fallback = rateMacroFormFromNumbers({
        cal: m.cal ?? null,
        protein: m.protein ?? null,
        carbs: m.carbs ?? null,
        fat: m.fat ?? null,
        servingLabel: m.servingLabel ?? null,
      });
      if (rateMacroFormHasAny(fallback)) {
        if (__DEV__) console.log('[FatSecret] parsed serving macros (server fallback)', fallback);
        return fallback;
      }
    }

    return null;
  } catch (err) {
    console.warn('[FatSecret] fetchFatSecretFoodMacros failed:', err);
    return null;
  }
}

function normalizedFatSecretSearchPhrase(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FATSECRET_TOKEN_STOP_WORDS = new Set([
  'and',
  'or',
  'the',
  'a',
  'an',
  'with',
  'of',
  'by',
  'for',
  'in',
  'on',
  'to',
]);

function fatSecretSignificantTokens(phrase: string): string[] {
  return normalizedFatSecretSearchPhrase(phrase)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !FATSECRET_TOKEN_STOP_WORDS.has(w));
}

/** 0–1 overlap between brand token sets; supports partial matches like "kettle" ↔ "kettle brand". */
function fatSecretBrandOverlapScore(productBrand: string, hitBrand: string): number {
  const a = fatSecretSignificantTokens(productBrand);
  const b = fatSecretSignificantTokens(hitBrand);
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((w) => setB.has(w));
  if (shared.length > 0) {
    return shared.length / Math.max(a.length, b.length);
  }
  const aStr = a.join(' ');
  const bStr = b.join(' ');
  if (aStr.includes(bStr) || bStr.includes(aStr)) return 0.85;
  return 0;
}

/** Word-order–invariant match: every significant query token appears in description + brand. */
function fatSecretWordOrderInvariantMatch(
  query: string,
  hit: SearchProductRow,
  productBrand: string
): boolean {
  const itemQ =
    itemOnlyFromBrandedFatSecretQuery(query, productBrand) ||
    normalizedFatSecretSearchPhrase(query);
  const desc = normalizedFatSecretSearchPhrase(hit.description);
  const hitBrand = normalizedFatSecretSearchPhrase(searchRowBrand(hit));
  const brand = normalizedFatSecretSearchPhrase(productBrand);

  if (brand && hitBrand && !fatSecretBrandsAlign(productBrand, hitBrand)) return false;

  const queryTokens = fatSecretSignificantTokens(itemQ);
  if (queryTokens.length < 2) return false;

  const corpus = new Set([
    ...fatSecretSignificantTokens(desc),
    ...fatSecretSignificantTokens(hitBrand),
  ]);
  const matched = queryTokens.filter((t) => corpus.has(t));
  if (matched.length !== queryTokens.length) return false;

  const brandScore = fatSecretBrandOverlapScore(productBrand, hitBrand);
  if (brand && hitBrand && brandScore < 0.5) return false;

  return true;
}

function fatSecretTokenOverlapRatio(query: string, hit: SearchProductRow, productBrand: string): number {
  const itemQ =
    itemOnlyFromBrandedFatSecretQuery(query, productBrand) ||
    normalizedFatSecretSearchPhrase(query);
  const queryTokens = fatSecretSignificantTokens(itemQ);
  if (queryTokens.length === 0) return 0;
  const corpus = new Set([
    ...fatSecretSignificantTokens(normalizedFatSecretSearchPhrase(hit.description)),
    ...fatSecretSignificantTokens(normalizedFatSecretSearchPhrase(searchRowBrand(hit))),
  ]);
  const matched = queryTokens.filter((t) => corpus.has(t));
  return matched.length / queryTokens.length;
}

/** Search phrase for FatSecret — brand + product name when both are known. */
export function buildFatSecretSearchQuery(item: string, brand = ''): string {
  const name = String(item ?? '').trim();
  const b = String(brand ?? '').trim();
  if (b && name) return `${b} ${name}`;
  return name || b;
}

function fatSecretMatchScore(
  query: string,
  hit: SearchProductRow,
  productBrand = ''
): number {
  const q = normalizedFatSecretSearchPhrase(query);
  const itemQ = itemOnlyFromBrandedFatSecretQuery(query, productBrand) || q;
  const desc = normalizedFatSecretSearchPhrase(hit.description);
  const hitBrandStr = searchRowBrand(hit);
  const brand = normalizedFatSecretSearchPhrase(hitBrandStr);
  let score = 0;
  if (desc === q || desc === itemQ) score += 500;
  if (desc.startsWith(q)) score += 220;
  if (desc.startsWith(itemQ) && itemQ.length >= 6) score += 200;
  if (q.length >= 6 && desc.includes(q)) score += 140;
  if (itemQ.length >= 6 && desc.includes(itemQ)) score += 130;
  const brandOverlap = fatSecretBrandOverlapScore(productBrand || hitBrandStr, hitBrandStr);
  if (brand && q.includes(brand)) score += 90;
  if (brand && desc.includes(brand)) score += 50;
  if (brandOverlap >= 0.85) score += 110;
  else if (brandOverlap >= 0.5) score += 70;
  const tokenOverlap = fatSecretTokenOverlapRatio(query, hit, productBrand);
  if (tokenOverlap >= 1) score += 180;
  else if (tokenOverlap >= 0.85) score += 120;
  else if (tokenOverlap >= 0.7) score += 60;
  if (hit.fatSecretId && searchProductRowHasMacros(hit)) score += 40;
  return score;
}

function fatSecretBrandsAlign(productBrand: string, hitBrand: string): boolean {
  const a = normalizedFatSecretSearchPhrase(productBrand);
  const b = normalizedFatSecretSearchPhrase(hitBrand);
  if (!a || !b) return true;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  return fatSecretBrandOverlapScore(productBrand, hitBrand) >= 0.5;
}

function itemOnlyFromBrandedFatSecretQuery(query: string, productBrand: string): string {
  const q = normalizedFatSecretSearchPhrase(query);
  const b = normalizedFatSecretSearchPhrase(productBrand);
  if (!b || !q) return q;
  if (q.startsWith(`${b} `)) return q.slice(b.length).trim();
  if (q.endsWith(` ${b}`)) return q.slice(0, -(b.length + 1)).trim();
  return q;
}

/** e.g. "85% lean / 15% fat" and "85/15" → "85/15" */
export function extractLeanFatRatio(text: string): string | null {
  const t = normalizedFatSecretSearchPhrase(text);
  let m = t.match(/(\d+)\s*%?\s*lean\s*\/\s*(\d+)\s*%?\s*fat/);
  if (m) return `${m[1]}/${m[2]}`;
  m = t.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) return `${m[1]}/${m[2]}`;
  m = t.match(/(\d+)\s*%?\s*lean/);
  if (m) {
    const lean = Number(m[1]);
    if (Number.isFinite(lean) && lean > 0 && lean < 100) {
      return `${lean}/${100 - lean}`;
    }
  }
  return null;
}

/** High-confidence FatSecret match — tolerates &/and, word order, and partial brand overlap. */
export function isHighConfidenceFatSecretMatch(
  query: string,
  hit: SearchProductRow,
  productBrand = ''
): boolean {
  const q = normalizedFatSecretSearchPhrase(query);
  const itemQ = itemOnlyFromBrandedFatSecretQuery(query, productBrand) || q;
  const desc = normalizedFatSecretSearchPhrase(hit.description);
  const hitBrand = normalizedFatSecretSearchPhrase(searchRowBrand(hit));
  const brand = normalizedFatSecretSearchPhrase(productBrand);
  if (!q || !desc || !hit.fatSecretId) return false;

  if (isLegitimateTraderJoesBrand(productBrand, { assumePlaceholder: false })) {
    if (!isTraderJoesBrandName(hitBrand)) return false;
    return (
      desc === q ||
      desc === itemQ ||
      (desc.includes(itemQ) && itemQ.length >= 8) ||
      (itemQ.includes(desc) && desc.length >= 8)
    );
  }

  if (brand && hitBrand && !fatSecretBrandsAlign(productBrand, hitBrand)) return false;

  if (desc === q || desc === itemQ) return true;
  if (fatSecretWordOrderInvariantMatch(query, hit, productBrand)) return true;

  if (desc.startsWith(q) && q.length >= 6) return true;
  if (desc.startsWith(itemQ) && itemQ.length >= 6) return true;
  if (fatSecretBrandsAlign(productBrand, hitBrand)) {
    if (itemQ.length >= 6 && desc.includes(itemQ)) return true;
    if (desc.length >= 8 && itemQ.includes(desc)) return true;
  }

  return fatSecretMatchScore(query, hit, productBrand) >= 380;
}

/** Relaxed match for onboarding macro backfill (lean ratio + product family + brand). */
export function isOnboardingMacroBackfillMatch(
  query: string,
  hit: SearchProductRow,
  productBrand = ''
): boolean {
  if (isHighConfidenceFatSecretMatch(query, hit, productBrand)) return true;
  if (!hit.fatSecretId) return false;

  const itemQ = itemOnlyFromBrandedFatSecretQuery(query, productBrand) || normalizedFatSecretSearchPhrase(query);
  const desc = normalizedFatSecretSearchPhrase(hit.description);
  const hitBrand = normalizedFatSecretSearchPhrase(searchRowBrand(hit));
  const brand = normalizedFatSecretSearchPhrase(productBrand);
  if (brand && hitBrand && !fatSecretBrandsAlign(productBrand, hitBrand)) return false;

  const ratioQ = extractLeanFatRatio(itemQ);
  const ratioH = extractLeanFatRatio(desc);
  if (!ratioQ || !ratioH || ratioQ !== ratioH) return false;

  if (/\bground beef\b/.test(itemQ) && /\bground beef\b/.test(desc)) return true;

  const coreTokens = (s: string) =>
    s
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4);
  const qTokens = new Set(coreTokens(itemQ));
  const shared = coreTokens(desc).filter((w) => qTokens.has(w));
  return shared.length >= 2;
}

/**
 * Best-effort FatSecret (and verified curated) macros for the rate flow.
 * Pass `searchRow` when the user picked a search hit; otherwise searches FatSecret by name.
 */
export async function resolveMacrosForRateProduct(args: {
  item: string;
  brand?: string;
  searchRow?: SearchProductRow | null;
}): Promise<RateMacroFormState> {
  const item = String(args.item ?? '').trim();
  const brand = String(args.brand ?? '').trim();
  if (!item) return { ...EMPTY_RATE_MACRO_FORM };

  if (args.searchRow) {
    const fromPick = await resolveMacrosForSearchProductRow(args.searchRow);
    if (rateMacroFormHasAny(fromPick)) {
      if (__DEV__) {
        console.log('[FatSecret] rate macros from picked search row', {
          product: item,
          match: args.searchRow.description,
          fatSecretId: args.searchRow.fatSecretId ?? null,
        });
      }
      return fromPick;
    }
  }

  const curatedVerified = await fetchVerifiedCuratedNutritionByDescription(item).catch(() => null);
  const profileRow = await fetchCuratedProductProfileRow(item, brand).catch(() => null);
  const curated = curatedVerified ?? (profileRow?.nutrition_verified ? profileRow : null);
  if (curated) {
    const fromCurated = rateMacroFormFromNumbers(
      {
        cal: curated.cal,
        protein: curated.protein,
        carbs: curated.carbs,
        fat: curated.fat,
        servingLabel: curated.serving_label,
      },
      { includeZeroValues: true }
    );
    if (rateMacroFormHasAny(fromCurated)) {
      if (__DEV__) {
        console.log('[FatSecret] rate macros from verified curated catalog', { product: item, brand });
      }
      return fromCurated;
    }
  }

  const query = buildFatSecretSearchQuery(item, brand);
  if (query.length < 2) {
    if (__DEV__) console.log('[FatSecret] rate macros skipped — query too short', { item, brand });
    return { ...EMPTY_RATE_MACRO_FORM };
  }

  try {
    const hits = await fetchSearchApiProductsOnly(query, { sources: 'fatsecret' });
    const candidates = hits.filter((h) => String(h.fatSecretId ?? '').trim());
    if (candidates.length === 0) {
      if (__DEV__) console.log('[FatSecret] rate macros skipped — no FatSecret hits', { query });
      return { ...EMPTY_RATE_MACRO_FORM };
    }
    const ranked = [...candidates].sort(
      (a, b) => fatSecretMatchScore(query, b, brand) - fatSecretMatchScore(query, a, brand)
    );
    const best = ranked.find((h) => isHighConfidenceFatSecretMatch(query, h, brand));
    if (!best) {
      if (__DEV__) {
        console.log('[FatSecret] rate macros skipped — no high-confidence match', { query });
      }
      return { ...EMPTY_RATE_MACRO_FORM };
    }
    const resolved = await resolveMacrosForSearchProductRow(best);
    if (rateMacroFormHasAny(resolved)) {
      if (__DEV__) {
        console.log('[FatSecret] rate macros from FatSecret search', {
          query,
          match: best.description,
          brand: searchRowBrand(best),
          fatSecretId: best.fatSecretId,
        });
      }
      return resolved;
    }
    if (__DEV__) {
      console.log('[FatSecret] rate macros skipped — hit had no usable macros', {
        query,
        match: best.description,
      });
    }
  } catch (err) {
    console.warn('[FatSecret] rate macros search failed:', err);
  }

  return { ...EMPTY_RATE_MACRO_FORM };
}

/**
 * Batch-safe macro resolution (strict FatSecret match). Used for onboarding backfill —
 * avoids attaching the wrong FatSecret product when only a loose search match exists.
 */
export async function resolveMacrosForOnboardingBackfill(args: {
  item: string;
  brand?: string;
}): Promise<RateMacroFormState> {
  const item = String(args.item ?? '').trim();
  const brand = String(args.brand ?? '').trim();
  if (!item) return { ...EMPTY_RATE_MACRO_FORM };

  const curatedVerified = await fetchVerifiedCuratedNutritionByDescription(item).catch(() => null);
  const profileRow = await fetchCuratedProductProfileRow(item, brand).catch(() => null);
  const curated = curatedVerified ?? (profileRow?.nutrition_verified ? profileRow : null);
  if (curated) {
    const fromCurated = rateMacroFormFromNumbers(
      {
        cal: curated.cal,
        protein: curated.protein,
        carbs: curated.carbs,
        fat: curated.fat,
        servingLabel: curated.serving_label,
      },
      { includeZeroValues: true }
    );
    if (rateMacroFormHasAny(fromCurated)) return fromCurated;
  }

  if (profileRow) {
    const fromUnverified = rateMacroFormFromNumbers({
      cal: profileRow.cal,
      protein: profileRow.protein,
      carbs: profileRow.carbs,
      fat: profileRow.fat,
      servingLabel: profileRow.serving_label,
    });
    if (rateMacroFormHasAny(fromUnverified)) return fromUnverified;
  }

  const query = buildFatSecretSearchQuery(item, brand);
  if (query.length < 2) return { ...EMPTY_RATE_MACRO_FORM };

  try {
    const hits = await fetchSearchApiProductsOnly(query, { sources: 'fatsecret' });
    const candidates = hits.filter((h) => String(h.fatSecretId ?? '').trim());
    if (candidates.length === 0) return { ...EMPTY_RATE_MACRO_FORM };

    const ranked = [...candidates].sort(
      (a, b) => fatSecretMatchScore(query, b, brand) - fatSecretMatchScore(query, a, brand)
    );
    const best = ranked.find((h) => isOnboardingMacroBackfillMatch(query, h, brand));
    if (!best) return { ...EMPTY_RATE_MACRO_FORM };

    const resolved = await resolveMacrosForSearchProductRow(best);
    if (rateMacroFormHasAny(resolved)) return resolved;
  } catch (err) {
    console.warn('[backfill] FatSecret resolve failed:', err);
  }

  return { ...EMPTY_RATE_MACRO_FORM };
}

/** Starter rankings: rank #1, top score, liked vibe (onboarding inserts). */
export function isLikelyOnboardingStarterPost(row: {
  rank_position?: number | null;
  rating?: number | null;
  vibe?: string | null;
  radar_only?: boolean | null;
}): boolean {
  if (row.radar_only) return false;
  const rp = Number(row.rank_position);
  const rating = Number(row.rating);
  if (!Number.isFinite(rp) || rp !== 1) return false;
  if (!Number.isFinite(rating) || rating < 9.5) return false;
  return normalizeVibe(String(row.vibe ?? '')) === 'liked';
}

export function postMacrosMissing(macros: unknown): boolean {
  return postMacrosEmpty(normalizePostMacros(macros));
}

export type BackfillPostsMissingMacrosResult = {
  ok: boolean;
  scanned: number;
  updated: number;
  skipped: number;
  reason?: string;
};

/**
 * Repair posts that were saved without `macros` (e.g. legacy onboarding). Updates each
 * post, merges into curated catalog, and syncs sibling posts for the same product key.
 */
export async function backfillPostsMissingMacros(
  options: {
    userId?: string;
    /** When true (default), only rank-1 / rating≥9.5 / liked posts (onboarding shape). */
    onlyLikelyOnboarding?: boolean;
    limit?: number;
    delayMs?: number;
  } = {}
): Promise<BackfillPostsMissingMacrosResult> {
  const onlyLikelyOnboarding = options.onlyLikelyOnboarding !== false;
  const limit = Math.max(1, options.limit ?? 500);
  const delayMs = Math.max(0, options.delayMs ?? 300);

  let q = supabase
    .from('posts')
    .select(
      'id, user_id, item, product_brand, description_key, store, stores, category, macros, diet_tags, rating, rank_position, vibe, radar_only'
    )
    .order('created_at', { ascending: true });

  if (options.userId) {
    q = q.eq('user_id', options.userId);
  }

  const { data: rows, error } = await q.limit(Math.min(limit * 4, 4000));
  if (error) {
    return { ok: false, scanned: 0, updated: 0, skipped: 0, reason: error.message };
  }

  let candidates = (rows ?? []).filter(
    (p) => !p.radar_only && postMacrosMissing(p.macros) && String(p.item ?? '').trim()
  );
  if (onlyLikelyOnboarding) {
    candidates = candidates.filter((p) => isLikelyOnboardingStarterPost(p));
  }
  candidates = candidates.slice(0, limit);

  let updated = 0;
  let skipped = 0;

  for (const post of candidates) {
    const item = String(post.item ?? '').trim();
    const brand = String(post.product_brand ?? '').trim();
    const macroForm = await resolveMacrosForOnboardingBackfill({ item, brand });
    const macrosPayload = rateMacroFormToPostMacrosPayload(macroForm);
    if (!macrosPayload) {
      skipped += 1;
      continue;
    }

    let dietTags = Array.isArray(post.diet_tags)
      ? post.diet_tags.map((t) => String(t ?? '').trim()).filter(Boolean)
      : [];
    if (
      qualifiesHighProteinLowCalFromMacroForm(macroForm) &&
      !dietTags.includes(HIGH_PROTEIN_LOW_CAL_ID)
    ) {
      dietTags = [...dietTags, HIGH_PROTEIN_LOW_CAL_ID];
    }

    const stores = retailStoresForRow({
      store: post.store,
      stores: post.stores,
      product_brand: brand,
    });
    const store = stores[0] ?? String(post.store ?? '').trim();
    const descKey = resolveProductDescriptionKey({
      item,
      brand,
      descriptionKey: post.description_key,
    });

    const { error: upErr } = await supabase
      .from('posts')
      .update({ macros: macrosPayload, diet_tags: dietTags })
      .eq('id', post.id);
    if (upErr) {
      console.warn('backfillPostsMissingMacros post update:', upErr.message);
      skipped += 1;
      continue;
    }

    try {
      await propagateProductMetadataFromRanking({
        userId: String(post.user_id ?? ''),
        item,
        descriptionKey: descKey,
        productBrand: brand,
        category: String(post.category ?? '').trim() || 'Snacks',
        store,
        stores,
        dietTags,
        macros: macrosPayload,
        sourcePostId: post.id,
      });
    } catch (propErr) {
      console.warn('backfillPostsMissingMacros propagate:', propErr);
    }

    updated += 1;
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (updated > 0) pokeFeedRefresh();

  return {
    ok: true,
    scanned: rows?.length ?? 0,
    updated,
    skipped,
  };
}

/** True when dock `proposed_macros` has no entered nutrition (null, empty, or all-zero without serving). */
export function dockProposedMacrosEmpty(macros: unknown): boolean {
  if (!macros || typeof macros !== 'object') return true;
  const r = macros as Record<string, unknown>;
  const keys = ['cal', 'protein', 'carbs', 'fat'] as const;
  const hasPositive = keys.some((k) => {
    const n = Number(r[k]);
    return Number.isFinite(n) && n > 0;
  });
  if (hasPositive) return false;
  const sl = r.servingLabel ?? r.serving_label;
  return !String(sl ?? '').trim();
}

/** Coerce rate-form macros to `posts.macros` JSON (null when empty). */
export function rateMacroFormToPostMacrosPayload(
  macros: RateMacroFormState | null | undefined
): Record<string, unknown> | null {
  if (!macros) return null;
  const num = (v: string): number | null => {
    const t = String(v ?? '').trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };
  const cal = num(macros.cal);
  const protein = num(macros.protein);
  const carbs = num(macros.carbs);
  const fat = num(macros.fat);
  const sl = String(macros.servingLabel ?? '').trim();
  if (cal == null && protein == null && carbs == null && fat == null && !sl) return null;
  const out: Record<string, unknown> = {};
  if (cal != null) out.cal = cal;
  if (protein != null) out.protein = protein;
  if (carbs != null) out.carbs = carbs;
  if (fat != null) out.fat = fat;
  if (sl) out.servingLabel = sl;
  return out;
}

/** Convert rate-form macros to loading-dock `proposed_macros` JSON (null when nothing entered). */
export function rateMacroFormToDockJson(
  macros: RateMacroFormState | PostMacros | null | undefined
): Record<string, unknown> | null {
  return rateMacroFormToPostMacrosPayload(macros as RateMacroFormState | null | undefined);
}

/** Macros for a search hit — search row first, then FatSecret `food.get` when `fatSecretId` is set. */
export async function resolveMacrosForSearchProductRow(
  row: SearchProductRow
): Promise<RateMacroFormState> {
  const fromRow = rateMacroFormFromNumbers({
    cal: row.cal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    servingLabel: row.servingLabel,
  });

  const fsId = String(row.fatSecretId ?? '').trim();
  if (!fsId) {
    return rateMacroFormHasAny(fromRow) ? fromRow : EMPTY_RATE_MACRO_FORM;
  }

  const fromFood = await fetchFatSecretFoodMacros(fsId);
  if (fromFood && rateMacroFormHasAny(fromFood)) {
    return mergeRateMacroForms(fromFood, fromRow);
  }
  return rateMacroFormHasAny(fromRow) ? fromRow : EMPTY_RATE_MACRO_FORM;
}

function macroIntField(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export type InsertCuratedProductStubResult =
  | { ok: true; duplicate?: boolean }
  | { ok: false; reason: 'no_user' | 'empty' | 'empty_brand'; error?: { message?: string } };

/**
 * Persist a manually entered product into `curated_products` (unverified stub) for shared search.
 */
export async function insertCuratedProductStub(
  userId: string,
  args: {
    description: string;
    brandOwner: string;
    foodCategory: string;
    subcategory?: string;
    cal?: string | number;
    protein?: string | number;
    carbs?: string | number;
    fat?: string | number;
    stores?: string[];
    servingLabel?: string;
    dietTags?: string[];
  }
): Promise<InsertCuratedProductStubResult> {
  if (!userId || !isProfileUuid(userId)) return { ok: false, reason: 'no_user' };
  const trimmed = String(args.description ?? '').trim();
  const brand = String(args.brandOwner ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (!brand) return { ok: false, reason: 'empty_brand' };

  const descKey = productDescriptionKey(trimmed, brand);
  const rowStores = storesForBrandAndSelections(brand, args.stores ?? []);
  const primaryStore = rowStores[0] ?? '';
  // `store` / `stores` on curated rows are retailers only — never the product brand.
  const serving = String(args.servingLabel ?? '').trim();
  const tags = Array.isArray(args.dietTags) ? args.dietTags.filter(Boolean) : [];
  const subcategory = String(args.subcategory ?? '').trim() || undefined;
  const category = String(args.foodCategory ?? '').trim() || 'Snacks';
  const categories = normalizeCategoriesList(null, category);

  const { data: dup, error: dupErr } = await supabase
    .from('curated_products')
    .select('id')
    .eq('description_key', descKey)
    .maybeSingle();
  if (dupErr) {
    console.warn('Curated duplicate check:', dupErr.message);
  } else if (dup) {
    await mergeCuratedProductMetadataFromRanking({
      descKey,
      item: trimmed,
      brand,
      category,
      categories,
      subcategory,
      stores: rowStores,
      primaryStore,
      dietTags: tags,
      macros: {
        cal: macroIntField(args.cal),
        protein: macroIntField(args.protein),
        carbs: macroIntField(args.carbs),
        fat: macroIntField(args.fat),
        servingLabel: serving,
      },
    });
    return { ok: true, duplicate: true };
  }

  const { error } = await supabase.from('curated_products').insert({
    description: trimmed,
    description_key: descKey,
    brand,
    store: primaryStore,
    stores: rowStores,
    category,
    categories,
    ...(subcategory ? { subcategory } : {}),
    cal: macroIntField(args.cal),
    protein: macroIntField(args.protein),
    carbs: macroIntField(args.carbs),
    fat: macroIntField(args.fat),
    diet_tags: tags,
    serving_label: serving,
    nutrition_verification_state: 'unverified',
    nutrition_verification_count: 0,
  });
  if (error) {
    const code = String(error.code ?? '');
    const msg = error.message || '';
    if (code === '23505' || msg.toLowerCase().includes('duplicate')) {
      return { ok: true, duplicate: true };
    }
    console.error('curated_products stub insert:', error);
    return { ok: false, reason: 'empty', error: { message: msg } };
  }
  return { ok: true };
}

function mergeUniqueStrings(...groups: (string[] | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const raw of group ?? []) {
      const trimmed = String(raw ?? '').trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

function postMacrosEmpty(macros: PostMacros | null): boolean {
  if (!macros) return true;
  return !macrosHaveAnyValue(macros, { includeZeroValues: true });
}

type MergeCuratedMetadataArgs = {
  descKey: string;
  item: string;
  brand: string;
  category: string;
  categories: string[];
  subcategory?: string;
  stores: string[];
  primaryStore: string;
  dietTags: string[];
  macros?: Record<string, unknown> | null;
};

/** Merge community ranking metadata into an unverified curated row (Discover / search). */
async function mergeCuratedProductMetadataFromRanking(
  args: MergeCuratedMetadataArgs
): Promise<void> {
  const { data: existing, error: existingErr } = await supabase
    .from('curated_products')
    .select(
      'id, brand, category, store, stores, diet_tags, cal, protein, carbs, fat, serving_label, nutrition_verification_state'
    )
    .eq('description_key', args.descKey)
    .maybeSingle();
  if (existingErr) {
    console.warn('mergeCuratedProductMetadataFromRanking lookup:', existingErr.message);
  }

  if (existing?.id) {
    if ((existing as { nutrition_verification_state?: string }).nutrition_verification_state === 'verified') {
      return;
    }
    const brandForMerge = mergeProductBrand(
      args.brand,
      String((existing as { brand?: unknown }).brand ?? '').trim()
    );
    const replacedStores = storesForBrandAndSelections(brandForMerge, args.stores);
    const updatePayload: Record<string, unknown> = {
      description: args.item,
      brand: brandForMerge,
      category: String((existing as { category?: unknown }).category ?? '').trim() || args.category,
      categories: args.categories,
      stores: replacedStores,
      store: replacedStores[0] ?? '',
      diet_tags: args.dietTags,
      ...(args.subcategory ? { subcategory: args.subcategory } : {}),
    };
    const m = args.macros;
    if (m && typeof m === 'object') {
      const pick = (key: 'cal' | 'protein' | 'carbs' | 'fat') => {
        const existingVal = Number((existing as Record<string, unknown>)[key]);
        const incoming = Number(m[key]);
        if (Number.isFinite(existingVal) && existingVal > 0) return existingVal;
        return Number.isFinite(incoming) ? Math.round(incoming) : 0;
      };
      updatePayload.cal = pick('cal');
      updatePayload.protein = pick('protein');
      updatePayload.carbs = pick('carbs');
      updatePayload.fat = pick('fat');
      const existingServing = String((existing as { serving_label?: unknown }).serving_label ?? '').trim();
      const incomingServing = String(m.servingLabel ?? '').trim();
      updatePayload.serving_label = existingServing || incomingServing;
    }
    const { error } = await supabase
      .from('curated_products')
      .update(updatePayload)
      .eq('id', existing.id);
    if (error) console.warn('mergeCuratedProductMetadataFromRanking update:', error.message);
    return;
  }

  const m = args.macros;
  const serving =
    m && typeof m === 'object' ? String((m as { servingLabel?: unknown }).servingLabel ?? '').trim() : '';
  const { error: insertErr } = await supabase.from('curated_products').insert({
    description: args.item,
    description_key: args.descKey,
    brand: args.brand || '',
    store: args.primaryStore,
    stores: args.stores,
    category: args.category,
    categories: args.categories,
    ...(args.subcategory ? { subcategory: args.subcategory } : {}),
    cal: macroIntField(m && typeof m === 'object' ? (m as { cal?: unknown }).cal : undefined),
    protein: macroIntField(m && typeof m === 'object' ? (m as { protein?: unknown }).protein : undefined),
    carbs: macroIntField(m && typeof m === 'object' ? (m as { carbs?: unknown }).carbs : undefined),
    fat: macroIntField(m && typeof m === 'object' ? (m as { fat?: unknown }).fat : undefined),
    diet_tags: args.dietTags,
    serving_label: serving,
    nutrition_verification_state: 'unverified',
    nutrition_verification_count: 0,
  });
  if (insertErr && !String(insertErr.code ?? '').includes('23505')) {
    console.warn('mergeCuratedProductMetadataFromRanking insert:', insertErr.message);
  }
}

type SyncPostsMetadataArgs = {
  descKey: string;
  item: string;
  brand: string;
  category: string;
  categories: string[];
  subcategory?: string;
  stores: string[];
  primaryStore: string;
  dietTags: string[];
  macros?: Record<string, unknown> | null;
  sourceUserId?: string;
  sourcePostId?: string | number | null;
  photoUrls?: string[];
};

/** Every post row for this product identity (canonical + legacy description keys, brand-aware). */
async function collectIdentityKeysForMetadataSync(
  item: string,
  descKey: string,
  brand = ''
): Promise<string[]> {
  const name = String(item ?? '').trim();
  const resolvedKey = resolveProductDescriptionKey({
    item: name,
    brand,
    descriptionKey: descKey,
  });
  const explicit = String(descKey ?? '').trim().toLowerCase();
  const keys = new Set<string>();
  if (explicit) keys.add(explicit);
  if (resolvedKey) keys.add(resolvedKey);
  const canonicalKey = await resolveCanonicalProductDescriptionKey(resolvedKey || explicit);
  if (canonicalKey) keys.add(canonicalKey);
  const aliasKeys = await resolveAliasKeysForCanonical(canonicalKey || resolvedKey || explicit);
  for (const aliasKey of aliasKeys) keys.add(aliasKey);
  const legacyKey = normalizedDescriptionKeyFromItem(name);
  if (legacyKey) keys.add(legacyKey);
  return [...keys];
}

async function fetchPostsForProductMetadataSync(
  descKey: string,
  item: string,
  brand = ''
): Promise<Array<Record<string, unknown>>> {
  const rows = await fetchMergedRawPostsForItem(item, descKey, brand);
  return rows as Array<Record<string, unknown>>;
}

async function applyCommunityProductMetadataToPostsRpc(args: {
  identityKeys: string[];
  item: string;
  newDescriptionKey: string;
  newItem?: string;
  newBrand?: string;
  category: string;
  categories: string[];
  subcategory?: string;
  primaryStore: string;
  stores: string[];
  dietTags: string[];
  macros?: Record<string, unknown> | null;
  adminEdit?: boolean;
}): Promise<{ ok: boolean; updatedPostCount: number; message?: string }> {
  const subcategory = String(args.subcategory ?? '').trim() || null;
  const { data, error } = await supabase.rpc('apply_community_product_metadata_to_posts', {
    p_identity_keys: args.identityKeys,
    p_item: args.item,
    p_new_description_key: args.newDescriptionKey,
    p_new_item: args.newItem ?? null,
    p_new_brand: args.newBrand ?? null,
    p_category: args.category,
    p_categories: args.categories,
    p_subcategory: subcategory,
    p_store: args.primaryStore,
    p_stores: args.stores,
    p_diet_tags: args.dietTags,
    p_macros: args.macros ?? null,
    p_admin_edit: args.adminEdit === true,
  });
  if (error) {
    return { ok: false, updatedPostCount: 0, message: error.message };
  }
  const payload = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    updated_posts?: number;
  };
  if (payload.ok === false) {
    return {
      ok: false,
      updatedPostCount: 0,
      message: payload.reason === 'forbidden' ? 'Admin only.' : 'Could not update posts.',
    };
  }
  return { ok: true, updatedPostCount: Number(payload.updated_posts ?? 0) };
}

/** Push store / diet / brand / category (and empty macros) onto ranked posts for this product. */
async function syncPostsProductMetadataFromRanking(args: SyncPostsMetadataArgs): Promise<void> {
  const rows = await fetchPostsForProductMetadataSync(args.descKey, args.item);
  const rowsToUpdate = rows.filter((row) => {
    if (isRankedReviewPost(row as { radar_only?: boolean | null; rating?: number | null })) {
      return true;
    }
    if (args.sourcePostId != null && String(row.id) === String(args.sourcePostId)) {
      return true;
    }
    return false;
  });
  if (rowsToUpdate.length === 0) return;

  const photoUrls = (args.photoUrls ?? []).filter(Boolean);
  const updates = rowsToUpdate.map(async (row) => {
    const rowBrand = mergeProductBrand(args.brand, String(row.product_brand ?? '').trim());
    const replacedStores = storesForBrandAndSelections(
      rowBrand,
      args.stores.length > 0 ? args.stores : args.primaryStore ? [args.primaryStore] : []
    );
    const replacedPrimary = replacedStores[0] ?? '';
    const payload: Record<string, unknown> = {
      description_key: args.descKey,
      product_brand: rowBrand || args.brand,
      category: String(row.category ?? '').trim() || args.category,
      categories: args.categories,
      store: replacedPrimary,
      stores: replacedStores.length > 0 ? replacedStores : [],
      diet_tags: args.dietTags,
      ...(args.subcategory ? { subcategory: args.subcategory } : {}),
    };
    if (args.macros && !postMacrosEmpty(normalizePostMacros(args.macros))) {
      payload.macros = args.macros;
    }
    if (
      args.sourceUserId &&
      String(row.user_id ?? '') === String(args.sourceUserId) &&
      photoUrls.length > 0
    ) {
      payload.photo_urls = [
        ...new Set([...normalizePhotoUrls(row.photo_urls), ...photoUrls]),
      ];
    }
    const { error } = await supabaseUpdateWithColumnFallback(
      'posts',
      payload,
      'id',
      row.id
    );
    if (error) console.warn('syncPostsProductMetadataFromRanking:', error.message);
  });
  await Promise.all(updates);
}

export type PropagateProductMetadataArgs = {
  userId: string;
  item: string;
  descriptionKey?: string;
  productBrand?: string;
  category?: string;
  categories?: string[];
  subcategory?: string;
  store?: string;
  stores?: string[];
  dietTags?: string[];
  macros?: Record<string, unknown> | null;
  sourcePostId?: string | number | null;
  photoUrls?: string[];
};

/**
 * After a rank/save, merge store + diet (+ empty macros) into curated catalog and
 * every feed post for the same product identity. Keeps Discover and past feed cards
 * in sync when someone adds retailer or diet info during ranking.
 */
export async function propagateProductMetadataFromRanking(
  args: PropagateProductMetadataArgs
): Promise<void> {
  const item = String(args.item ?? '').trim();
  if (!item) return;
  const brand = String(args.productBrand ?? '').trim();
  const descKey = resolveProductDescriptionKey({
    item,
    brand,
    descriptionKey: args.descriptionKey,
  });
  const category = String(args.category ?? '').trim() || 'Snacks';
  const categories = normalizeCategoriesList(args.categories, category);
  const primaryCategory = categories[0] ?? category;
  const subcategory = String(args.subcategory ?? '').trim() || undefined;
  const rawStores = [
    ...(args.stores ?? []).map((s) => String(s ?? '').trim()).filter(Boolean),
    String(args.store ?? '').trim(),
  ].filter(Boolean);
  const normalizedStores = storesForBrandAndSelections(brand, rawStores);
  const primaryStore = normalizedStores[0] ?? '';
  const dietTags = Array.isArray(args.dietTags) ? args.dietTags.filter(Boolean) : [];

  const curatedTargets = await fetchCuratedRowsForMetadataSync(descKey, item, brand);
  if (curatedTargets.length > 0) {
    for (const existing of curatedTargets) {
      const isVerified =
        String(existing.nutrition_verification_state ?? '') === 'verified';
      const existingBrand = String(existing.brand ?? '').trim();
      const updatePayload: Record<string, unknown> = {
        description: item,
        store: primaryStore,
        stores: normalizedStores,
        diet_tags: dietTags,
        category: primaryCategory,
        categories,
        ...(subcategory ? { subcategory } : {}),
      };
      if (!isVerified) {
        updatePayload.brand = mergeProductBrand(brand, existingBrand);
      }
      const { error } = await supabase
        .from('curated_products')
        .update(updatePayload)
        .eq('id', existing.id);
      if (error) {
        console.warn('propagateProductMetadataFromRanking curated:', error.message);
      }
    }
  } else {
    await mergeCuratedProductMetadataFromRanking({
      descKey,
      item,
      brand,
      category: primaryCategory,
      categories,
      subcategory,
      stores: normalizedStores,
      primaryStore,
      dietTags,
      macros: args.macros ?? null,
    });
  }

  const verified = await fetchVerifiedCuratedNutritionByDescription(item).catch(() => null);
  if (verified) {
    try {
      await supabase.rpc('sync_posts_nutrition_from_shared_catalog', { p_key: descKey });
    } catch {
      /* RPC may be unavailable to client roles */
    }
  }

  await syncPostsProductMetadataFromRanking({
    descKey,
    item,
    brand,
    category: primaryCategory,
    categories,
    subcategory,
    stores: normalizedStores,
    primaryStore,
    dietTags,
    macros: args.macros ?? null,
    sourceUserId: args.userId,
    photoUrls: args.photoUrls,
  });

  await enqueueNutritionLoadingDockFromRanking(args.userId, {
    description: item,
    brandOwner: brand,
    foodCategory: primaryCategory,
    macros: args.macros as RateMacroFormState | PostMacros | null,
    dietTags,
    postId: args.sourcePostId != null ? String(args.sourcePostId) : null,
  }).catch((err) => console.warn('propagateProductMetadataFromRanking dock:', err));

  pokeFeedRefresh(args.sourcePostId != null ? args.sourcePostId : undefined);
}

export type SetProductMetadataGloballyArgs = {
  item: string;
  descriptionKey?: string;
  productBrand?: string;
  /** Admin: rename the product title everywhere. */
  newItem?: string;
  /** Admin: replace brand everywhere (use empty string to clear). */
  newBrand?: string;
  category?: string;
  categories?: string[];
  subcategory?: string;
  stores: string[];
  dietTags: string[];
  /** When set, replaces nutrition on unverified catalog rows and all matching posts. */
  macros?: RateMacroFormState;
  /** Admin (@elanah): may edit title/brand on verified catalog rows. */
  adminEdit?: boolean;
};

export type SetProductMetadataGloballyResult =
  | { ok: true; updatedPostCount: number }
  | { ok: false; message: string };

/**
 * Replace store + diet metadata for a product across every matching feed post and
 * the shared curated catalog row (insert stub when missing).
 */
export async function setProductMetadataGlobally(
  args: SetProductMetadataGloballyArgs
): Promise<SetProductMetadataGloballyResult> {
  const lookupItem = String(args.item ?? '').trim();
  if (!lookupItem) return { ok: false, message: 'Missing product name.' };

  const lookupBrand = String(args.productBrand ?? '').trim();
  const explicitDescKey = String(args.descriptionKey ?? '').trim().toLowerCase();
  const oldDescKey =
    explicitDescKey ||
    resolveProductDescriptionKey({
      item: lookupItem,
      brand: lookupBrand,
      descriptionKey: null,
    });

  const effectiveItem = String(args.newItem ?? lookupItem).trim() || lookupItem;
  const effectiveBrand =
    args.newBrand !== undefined ? String(args.newBrand).trim() : lookupBrand;
  const newDescKey = productDescriptionKey(effectiveItem, effectiveBrand);
  const categories = normalizeCategoriesList(args.categories, args.category);
  const primaryCategory = categories[0] ?? 'Snacks';
  const subcategoryRaw = String(args.subcategory ?? '').trim();
  const subcategory = subcategoryRaw || undefined;
  const categoryFromSub = subcategory ? legacyCategoryForSubcategory(subcategory) : primaryCategory;
  const effectiveCategories = subcategory ? [categoryFromSub] : categories;
  const effectivePrimaryCategory = subcategory ? categoryFromSub : primaryCategory;
  const dietTags = [
    ...new Set((args.dietTags ?? []).map((t) => String(t ?? '').trim()).filter(Boolean)),
  ];
  const normalizedStores = storesForBrandAndSelections(
    effectiveBrand,
    (args.stores ?? []).map((s) => String(s ?? '').trim()).filter(Boolean)
  );
  const primaryStore = normalizedStores[0] ?? '';

  const macrosPayload =
    args.macros !== undefined ? rateMacroFormToPostMacrosPayload(args.macros) : undefined;

  const catalogIdentityPayload: Record<string, unknown> = {
    description: effectiveItem,
    store: primaryStore,
    stores: normalizedStores,
    diet_tags: dietTags,
    category: effectivePrimaryCategory,
    categories: effectiveCategories,
    ...(subcategory ? { subcategory } : {}),
  };

  if (macrosPayload !== undefined) {
    catalogIdentityPayload.cal = macroIntField(macrosPayload?.cal);
    catalogIdentityPayload.protein = macroIntField(macrosPayload?.protein);
    catalogIdentityPayload.carbs = macroIntField(macrosPayload?.carbs);
    catalogIdentityPayload.fat = macroIntField(macrosPayload?.fat);
    catalogIdentityPayload.serving_label = String(macrosPayload?.servingLabel ?? '').trim();
  }

  const curatedTargets = await fetchCuratedRowsForMetadataSync(oldDescKey, lookupItem, lookupBrand);

  let catalogSaved = false;

  if (curatedTargets.length > 0) {
    for (const existing of curatedTargets) {
      const isVerified =
        String(existing.nutrition_verification_state ?? '') === 'verified';
      const existingBrand = String(existing.brand ?? '').trim();
      const updatePayload: Record<string, unknown> = {
        ...catalogIdentityPayload,
      };
      if (isVerified && macrosPayload !== undefined) {
        delete updatePayload.cal;
        delete updatePayload.protein;
        delete updatePayload.carbs;
        delete updatePayload.fat;
        delete updatePayload.serving_label;
      }
      if (args.adminEdit || !isVerified) {
        updatePayload.brand = mergeProductBrand(effectiveBrand, existingBrand);
        if (args.adminEdit && newDescKey !== oldDescKey) {
          updatePayload.description_key = newDescKey;
        }
      }
      const { error: updateErr } = await supabaseUpdateWithColumnFallback(
        'curated_products',
        updatePayload,
        'id',
        existing.id
      );
      if (updateErr) {
        console.warn('setProductMetadataGlobally curated update:', updateErr.message);
      } else {
        catalogSaved = true;
      }
    }
  } else {
    const { error: insertErr } = await supabaseInsertWithColumnFallback('curated_products', {
      ...catalogIdentityPayload,
      description_key: newDescKey,
      brand: mergeProductBrand(effectiveBrand, '') || '',
      cal: macroIntField(macrosPayload?.cal),
      protein: macroIntField(macrosPayload?.protein),
      carbs: macroIntField(macrosPayload?.carbs),
      fat: macroIntField(macrosPayload?.fat),
      serving_label: String(macrosPayload?.servingLabel ?? '').trim(),
      nutrition_verification_state: 'unverified',
      nutrition_verification_count: 0,
    });
    if (!insertErr) {
      catalogSaved = true;
    } else if (String(insertErr.code ?? '').includes('23505')) {
      const { error: raceUpdateErr } = await supabaseUpdateWithColumnFallback(
        'curated_products',
        {
          ...catalogIdentityPayload,
          brand: mergeProductBrand(effectiveBrand, '') || '',
        },
        'description_key',
        newDescKey
      );
      if (!raceUpdateErr) catalogSaved = true;
      else console.warn('setProductMetadataGlobally curated race update:', raceUpdateErr.message);
    } else {
      console.warn('setProductMetadataGlobally curated insert:', insertErr.message);
    }
  }

  if (args.adminEdit && oldDescKey !== newDescKey) {
    const { error: aliasErr } = await supabase.rpc('merge_product_identity_alias', {
      p_alias_key: oldDescKey,
      p_canonical_key: newDescKey,
      p_canonical_name: effectiveItem,
    });
    if (aliasErr) {
      console.warn('setProductMetadataGlobally alias:', aliasErr.message);
    }
  }

  const rows = await fetchPostsForProductMetadataSync(oldDescKey, lookupItem, lookupBrand);
  const rankedRows = rows.filter((row) =>
    isRankedReviewPost(row as { radar_only?: boolean | null; rating?: number | null })
  );
  const identityKeys = await collectIdentityKeysForMetadataSync(
    lookupItem,
    oldDescKey,
    lookupBrand
  );
  const updatedAtByPostId = new Map<string, string>();
  for (const row of rankedRows) {
    const id = String(row.id ?? '');
    const prevUpdatedAt =
      row.updated_at != null && String(row.updated_at).trim()
        ? String(row.updated_at)
        : '';
    if (id && prevUpdatedAt) updatedAtByPostId.set(id, prevUpdatedAt);
  }

  const shouldSetBrand = args.adminEdit === true || args.newBrand !== undefined;
  const rpcRes = await applyCommunityProductMetadataToPostsRpc({
    identityKeys,
    item: effectiveItem,
    newDescriptionKey: newDescKey,
    ...(args.adminEdit && args.newItem?.trim() ? { newItem: effectiveItem } : {}),
    ...(shouldSetBrand ? { newBrand: effectiveBrand } : {}),
    category: effectivePrimaryCategory,
    categories: effectiveCategories,
    subcategory,
    primaryStore,
    stores: normalizedStores.length > 0 ? normalizedStores : primaryStore ? [primaryStore] : [],
    dietTags,
    macros: macrosPayload ?? null,
    adminEdit: args.adminEdit,
  });

  let updatedPostCount = rpcRes.updatedPostCount;
  let postSaveError: string | null = rpcRes.ok ? null : rpcRes.message ?? null;

  if (!rpcRes.ok) {
    console.warn('setProductMetadataGlobally posts rpc:', rpcRes.message);
    updatedPostCount = 0;
    await Promise.all(
      rankedRows.map(async (row) => {
        const rowBrand = args.adminEdit
          ? effectiveBrand
          : mergeProductBrand(effectiveBrand, String(row.product_brand ?? '').trim());
        const replacedStores = storesForBrandAndSelections(
          rowBrand,
          normalizedStores.length > 0 ? normalizedStores : primaryStore ? [primaryStore] : []
        );
        const replacedPrimary = replacedStores[0] ?? '';
        const prevUpdatedAt = updatedAtByPostId.get(String(row.id ?? '')) ?? null;
        const prevSub = resolveSubcategoryId({
          subcategory: row.subcategory as string | null | undefined,
          category: row.category as string | null | undefined,
        });
        const subcategoryChangedForRow = Boolean(subcategory && prevSub !== subcategory);
        const payload: Record<string, unknown> = {
          description_key: newDescKey,
          product_brand: rowBrand,
          category: effectivePrimaryCategory,
          categories: effectiveCategories,
          store: replacedPrimary,
          stores: replacedStores.length > 0 ? replacedStores : [],
          diet_tags: dietTags,
          ...(subcategory
            ? {
                subcategory,
                needs_recategorization: subcategoryChangedForRow,
              }
            : {}),
        };
        if (args.adminEdit) {
          payload.item = effectiveItem;
        }
        if (macrosPayload !== undefined) {
          payload.macros = macrosPayload;
        }
        const { error } = await supabaseUpdateWithColumnFallback(
          'posts',
          payload,
          'id',
          row.id
        );
        if (error) {
          postSaveError = error.message ?? 'Could not update post.';
          console.warn('setProductMetadataGlobally post update:', error.message);
          return;
        }
        if (prevUpdatedAt) {
          const { error: tsErr } = await supabase
            .from('posts')
            .update({ updated_at: prevUpdatedAt })
            .eq('id', row.id);
          if (tsErr && !/updated_at|schema cache/i.test(String(tsErr.message ?? ''))) {
            console.warn('setProductMetadataGlobally preserve updated_at:', tsErr.message);
          }
        }
        updatedPostCount += 1;
      })
    );
  } else if (updatedAtByPostId.size > 0) {
    await Promise.all(
      [...updatedAtByPostId.entries()].map(async ([postId, prevUpdatedAt]) => {
        const { error: tsErr } = await supabase
          .from('posts')
          .update({ updated_at: prevUpdatedAt })
          .eq('id', postId);
        if (tsErr && !/updated_at|schema cache/i.test(String(tsErr.message ?? ''))) {
          console.warn('setProductMetadataGlobally preserve updated_at:', tsErr.message);
        }
      })
    );
  }

  const subcategoryChanged = Boolean(
    subcategory &&
      rankedRows.some(
        (row) =>
          resolveSubcategoryId({
            subcategory: row.subcategory as string | null | undefined,
            category: row.category as string | null | undefined,
          }) !== subcategory
      )
  );

  if (!rpcRes.ok && subcategory && rankedRows.length > 0) {
    await Promise.all(
      rankedRows.map(async (row) => {
        const prevSub = resolveSubcategoryId({
          subcategory: row.subcategory as string | null | undefined,
          category: row.category as string | null | undefined,
        });
        if (prevSub === subcategory) return;
        const { error } = await supabaseUpdateWithColumnFallback(
          'posts',
          {
            subcategory,
            category: effectivePrimaryCategory,
            categories: effectiveCategories,
            needs_recategorization: true,
          },
          'id',
          row.id
        );
        if (error) {
          console.warn('setProductMetadataGlobally subcategory sync:', error.message);
        }
      })
    );
  } else if (rpcRes.ok && subcategory && subcategoryChanged && rankedRows.length > 0) {
    await Promise.all(
      rankedRows.map(async (row) => {
        const prevSub = resolveSubcategoryId({
          subcategory: row.subcategory as string | null | undefined,
          category: row.category as string | null | undefined,
        });
        if (prevSub === subcategory) return;
        const { error } = await supabaseUpdateWithColumnFallback(
          'posts',
          { needs_recategorization: true },
          'id',
          row.id
        );
        if (error) {
          console.warn('setProductMetadataGlobally rerank flag:', error.message);
        }
      })
    );
  }

  if (subcategoryChanged) {
    const authorIds = await fetchRankedAuthorIdsForMetadataSync(identityKeys, effectiveItem);
    await Promise.all(
      authorIds.map((uid) =>
        rescoreUserRankings(uid).catch((err) =>
          console.warn('setProductMetadataGlobally rescore:', err)
        )
      )
    );
  }

  if (!catalogSaved && updatedPostCount === 0) {
    return {
      ok: false,
      message:
        postSaveError ??
        'Could not save to the shared catalog. Try again in a moment.',
    };
  }

  pokeFeedRefresh();

  return { ok: true, updatedPostCount };
}

export type CuratedProductTags = {
  stores: string[];
  dietTags: string[];
};

/**
 * Read just the editable-tag fields off a curated product (by description key)
 * so the admin "Add new release" modal can pre-select chips for whatever the
 * catalog already has on file. Returns null when no row matches.
 */
export async function fetchCuratedProductTagsByDescription(
  description: string
): Promise<CuratedProductTags | null> {
  const descKey = normalizedDescriptionKeyFromItem(String(description ?? ''));
  if (!descKey) return null;
  const { data, error } = await supabase
    .from('curated_products')
    .select('store, stores, diet_tags, brand')
    .eq('description_key', descKey)
    .maybeSingle();
  if (error) {
    console.warn('fetchCuratedProductTagsByDescription:', error.message);
    return null;
  }
  if (!data) return null;
  const brand = String((data as { brand?: unknown }).brand ?? '').trim();
  const storesRaw = Array.isArray((data as { stores?: unknown }).stores)
    ? ((data as { stores: unknown[] }).stores
        .map((s) => String(s ?? '').trim())
        .filter(Boolean) as string[])
    : [];
  const primary = String((data as { store?: unknown }).store ?? '').trim();
  const stores = mergeStoresForBrand(brand, storesRaw, primary ? [primary] : []);
  const dietTags = Array.isArray((data as { diet_tags?: unknown }).diet_tags)
    ? ((data as { diet_tags: unknown[] }).diet_tags
        .map((t) => String(t ?? '').trim())
        .filter(Boolean) as string[])
    : [];
  return { stores, dietTags };
}

export type MarkNewReleaseResult =
  | { ok: true; action: 'inserted' | 'updated' }
  | { ok: false; reason: 'no_user' | 'empty' | 'empty_brand' | 'forbidden' | 'db'; message?: string };

/**
 * Admin-only: flip a curated product to a "new release" (drives the Discover rail).
 *
 * Behaviour mirrors `insertCuratedProductStub` for the missing-row case (auto-creates
 * the curated row), but always sets `is_new_release: true` and stamps `released_at: now`.
 * For existing rows it only flips those two flags so we don't clobber verified macros.
 *
 * Permissions are gated server-side via RLS (the client check in `isAdminUsername` is for
 * UI affordance only — RLS will refuse writes from non-admins regardless).
 */
export async function markCuratedProductAsNewRelease(
  userId: string,
  args: {
    description: string;
    brandOwner: string;
    foodCategory?: string;
    cal?: string | number | null;
    protein?: string | number | null;
    carbs?: string | number | null;
    fat?: string | number | null;
    stores?: string[];
    servingLabel?: string | null;
    dietTags?: string[];
  }
): Promise<MarkNewReleaseResult> {
  if (!userId || !isProfileUuid(userId)) return { ok: false, reason: 'no_user' };
  const description = String(args.description ?? '').trim();
  const brand = String(args.brandOwner ?? '').trim();
  if (!description) return { ok: false, reason: 'empty' };
  if (!brand) return { ok: false, reason: 'empty_brand' };

  const descKey = normalizedDescriptionKeyFromItem(description);
  const nowIso = new Date().toISOString();

  const { data: existing, error: existingErr } = await supabase
    .from('curated_products')
    .select('id, store, stores, diet_tags')
    .eq('description_key', descKey)
    .maybeSingle();
  if (existingErr) {
    console.warn('markCuratedProductAsNewRelease lookup:', existingErr.message);
  }

  if (existing?.id) {
    // Merge admin-supplied stores / diet tags into the existing row (additive —
    // never blow away what the catalog already has). Always re-sanitize stores
    // so legacy default `Trader Joe's` tokens drop off non-TJ brands.
    const updatePayload: Record<string, unknown> = {
      is_new_release: true,
      released_at: nowIso,
    };
    const existingStoresRaw = Array.isArray((existing as { stores?: unknown }).stores)
      ? ((existing as { stores: unknown[] }).stores
          .map((s) => String(s ?? '').trim())
          .filter(Boolean) as string[])
      : [];
    const existingPrimary = String((existing as { store?: unknown }).store ?? '').trim();
    const incomingStores = Array.isArray(args.stores)
      ? args.stores.map((s) => String(s ?? '').trim()).filter(Boolean)
      : [];
    const mergedRaw = [
      ...existingStoresRaw,
      ...(existingPrimary ? [existingPrimary] : []),
      ...incomingStores,
    ];
    const mergedStores = storesForBrandAndSelections(brand, mergedRaw);
    updatePayload.stores = mergedStores;
    updatePayload.store = mergedStores[0] ?? existingPrimary;
    const incomingTags = Array.isArray(args.dietTags)
      ? args.dietTags.map((t) => String(t ?? '').trim()).filter(Boolean)
      : [];
    if (incomingTags.length > 0) {
      const existingTagsRaw = Array.isArray((existing as { diet_tags?: unknown }).diet_tags)
        ? ((existing as { diet_tags: unknown[] }).diet_tags
            .map((t) => String(t ?? '').trim())
            .filter(Boolean) as string[])
        : [];
      updatePayload.diet_tags = [...new Set([...existingTagsRaw, ...incomingTags])];
    }
    const { error: updateErr } = await supabase
      .from('curated_products')
      .update(updatePayload)
      .eq('id', existing.id);
    if (updateErr) {
      const msg = updateErr.message || '';
      const code = String(updateErr.code ?? '');
      console.warn('markCuratedProductAsNewRelease update:', msg);
      if (code === '42501' || /permission|rls|policy/i.test(msg)) {
        return { ok: false, reason: 'forbidden', message: msg };
      }
      return { ok: false, reason: 'db', message: msg };
    }
    return { ok: true, action: 'updated' };
  }

  const rowStores = storesForBrandAndSelections(brand, args.stores ?? []);
  const primaryStore = rowStores[0] ?? '';
  const serving = String(args.servingLabel ?? '').trim();
  const tags = Array.isArray(args.dietTags) ? args.dietTags.filter(Boolean) : [];

  const { error: insertErr } = await supabase.from('curated_products').insert({
    description,
    description_key: descKey,
    brand,
    store: primaryStore,
    stores: rowStores,
    category: String(args.foodCategory ?? '').trim() || 'Snacks',
    cal: macroIntField(args.cal ?? undefined),
    protein: macroIntField(args.protein ?? undefined),
    carbs: macroIntField(args.carbs ?? undefined),
    fat: macroIntField(args.fat ?? undefined),
    diet_tags: tags,
    serving_label: serving,
    nutrition_verification_state: 'unverified',
    nutrition_verification_count: 0,
    is_new_release: true,
    released_at: nowIso,
  });
  if (insertErr) {
    const code = String(insertErr.code ?? '');
    const msg = insertErr.message || '';
    console.warn('markCuratedProductAsNewRelease insert:', msg);
    if (code === '23505' || /duplicate/i.test(msg)) {
      // Race: another writer landed first. Flip the flag on the existing row.
      const { data: now } = await supabase
        .from('curated_products')
        .select('id')
        .eq('description_key', descKey)
        .maybeSingle();
      if (now?.id) {
        const { error: raceUpdErr } = await supabase
          .from('curated_products')
          .update({ is_new_release: true, released_at: nowIso })
          .eq('id', now.id);
        if (!raceUpdErr) return { ok: true, action: 'updated' };
      }
    }
    if (code === '42501' || /permission|rls|policy/i.test(msg)) {
      return { ok: false, reason: 'forbidden', message: msg };
    }
    return { ok: false, reason: 'db', message: msg };
  }
  return { ok: true, action: 'inserted' };
}

export type UpdateCuratedNewReleaseResult = MarkNewReleaseResult;

/** Admin-only: update an existing curated new-release row (fix typos, macros, stores, etc.). */
export async function updateCuratedNewRelease(
  userId: string,
  args: {
    /** Current `description_key` before edits — used to find the row. */
    descriptionKey: string;
    description: string;
    brandOwner: string;
    foodCategory?: string;
    cal?: string | number | null;
    protein?: string | number | null;
    carbs?: string | number | null;
    fat?: string | number | null;
    stores?: string[];
    servingLabel?: string | null;
    dietTags?: string[];
  }
): Promise<UpdateCuratedNewReleaseResult> {
  if (!userId || !isProfileUuid(userId)) return { ok: false, reason: 'no_user' };
  const priorKey = String(args.descriptionKey ?? '').trim().toLowerCase();
  const description = String(args.description ?? '').trim();
  const brand = String(args.brandOwner ?? '').trim();
  if (!priorKey) return { ok: false, reason: 'empty' };
  if (!description) return { ok: false, reason: 'empty' };
  if (!brand) return { ok: false, reason: 'empty_brand' };

  const nextKey = normalizedDescriptionKeyFromItem(description);
  const rowStores = storesForBrandAndSelections(brand, args.stores ?? []);
  const primaryStore = rowStores[0] ?? '';
  const serving = String(args.servingLabel ?? '').trim();
  const tags = Array.isArray(args.dietTags) ? args.dietTags.filter(Boolean) : [];

  const updatePayload: Record<string, unknown> = {
    description,
    description_key: nextKey,
    brand,
    category: String(args.foodCategory ?? '').trim() || 'Snacks',
    cal: macroIntField(args.cal ?? undefined),
    protein: macroIntField(args.protein ?? undefined),
    carbs: macroIntField(args.carbs ?? undefined),
    fat: macroIntField(args.fat ?? undefined),
    store: primaryStore,
    stores: rowStores,
    serving_label: serving,
    diet_tags: tags,
    is_new_release: true,
  };

  const { error: updateErr } = await supabase
    .from('curated_products')
    .update(updatePayload)
    .eq('description_key', priorKey);
  if (updateErr) {
    const msg = updateErr.message || '';
    const code = String(updateErr.code ?? '');
    console.warn('updateCuratedNewRelease:', msg);
    if (code === '42501' || /permission|rls|policy/i.test(msg)) {
      return { ok: false, reason: 'forbidden', message: msg };
    }
    return { ok: false, reason: 'db', message: msg };
  }

  if (priorKey !== nextKey) {
    const { error: aliasErr } = await supabase.rpc('merge_product_identity_alias', {
      p_alias_key: priorKey,
      p_canonical_key: nextKey,
      p_canonical_name: description,
    });
    if (aliasErr) {
      console.warn('updateCuratedNewRelease alias:', aliasErr.message);
    }
  }

  const flagRes = await setCuratedNewReleaseFlag({
    descriptionKey: nextKey,
    isNewRelease: true,
  });
  if (!flagRes.ok) {
    return {
      ok: false,
      reason: 'db',
      message: flagRes.message || 'Updated product, but could not refresh New Release flag.',
    };
  }

  return { ok: true, action: 'updated' };
}

export type SetCuratedNewReleaseFlagResult =
  | { ok: true }
  | { ok: false; reason: 'empty_key' | 'db'; message?: string };

/** Toggle one curated row's `is_new_release` flag (admin-only via RLS). */
export async function setCuratedNewReleaseFlag(args: {
  descriptionKey: string;
  isNewRelease: boolean;
  releasedAt?: string | null;
}): Promise<SetCuratedNewReleaseFlagResult> {
  const key = String(args.descriptionKey ?? '').trim().toLowerCase();
  if (!key) return { ok: false, reason: 'empty_key' };
  const patch: Record<string, unknown> = { is_new_release: !!args.isNewRelease };
  if (args.isNewRelease) {
    patch.released_at = args.releasedAt || new Date().toISOString();
  }
  const { error } = await supabase.from('curated_products').update(patch).eq('description_key', key);
  if (error) {
    return { ok: false, reason: 'db', message: error.message };
  }
  return { ok: true };
}

export type EnqueueNutritionDockResult =
  | { ok: true; queued?: boolean; skipped?: boolean }
  | { ok: false; reason: 'no_user' | 'empty'; error?: { message?: string }; message?: string };

/** Enqueue `nutrition_loading_dock` for staff review after manual or ranked nutrition intake. */
export async function enqueueNutritionLoadingDockFromRanking(
  userId: string,
  args: {
    description: string;
    brandOwner?: string;
    foodCategory?: string;
    macros?: RateMacroFormState | PostMacros | null;
    dietTags?: string[];
    postId?: string | null;
    itemDisplay?: string | null;
    forceQueue?: boolean;
  }
): Promise<EnqueueNutritionDockResult> {
  if (!userId || !isProfileUuid(userId)) return { ok: false, reason: 'no_user' };
  const desc = String(args.description ?? '').trim();
  const brand = String(args.brandOwner ?? '').trim();
  const descKey = productDescriptionKey(desc, brand);
  if (!desc) return { ok: false, reason: 'empty' };

  const mergedCatalog = await fetchVerifiedCuratedNutritionByDescription(desc);
  if (mergedCatalog) return { ok: true, skipped: true };

  let macrosJson = rateMacroFormToDockJson(args.macros);
  if (!macrosJson) {
    const form = await resolveMacrosForRateProduct({ item: desc, brand });
    macrosJson = rateMacroFormToDockJson(form);
    if (macrosJson && __DEV__) {
      console.log('[FatSecret] dock enqueue prefilled from FatSecret', { descKey, item: desc, brand });
    }
  }

  const hasMacros = macrosJson != null;
  const tags = Array.isArray(args.dietTags) ? args.dietTags.filter(Boolean) : [];
  if (!args.forceQueue && !hasMacros && tags.length === 0) return { ok: true, skipped: true };

  const displayRaw =
    args.itemDisplay != null && String(args.itemDisplay).trim()
      ? String(args.itemDisplay).trim()
      : desc;

  const brandRaw = brand || null;

  const { error } = await supabase.rpc('enqueue_nutrition_loading_dock', {
    p_description_key: descKey,
    p_item_display: displayRaw,
    p_post_id: args.postId ?? null,
    p_macros: macrosJson,
    p_diet_tags: tags,
    p_submitted_by: userId,
    p_barcode: null,
    p_barcode_format: null,
    p_proposed_brand: brandRaw,
  });
  if (error) {
    console.error('enqueue_nutrition_loading_dock:', error);
    return { ok: false, reason: 'empty', error: { message: error.message }, message: error.message };
  }

  return { ok: true, queued: true };
}

/** Fill only blank fields in `base` from `fill` (e.g. curated first, then FatSecret/API). */
export function mergeRateMacroFormFillEmpty(
  base: RateMacroFormState,
  fill: RateMacroFormState
): RateMacroFormState {
  const pick = (key: keyof RateMacroFormState) => {
    const b = String(base[key] ?? '').trim();
    if (rateMacroFormFieldHasValue(b)) return b;
    return String(fill[key] ?? '').trim();
  };
  return {
    cal: pick('cal'),
    protein: pick('protein'),
    carbs: pick('carbs'),
    fat: pick('fat'),
    servingLabel: pick('servingLabel'),
  };
}

// ─── Discover ─────────────────────────────────────────────────────────────────

export type DiscoverNewReleaseRow = {
  description: string;
  brandOwner: string;
  brandName: string;
  foodCategory: string;
  store: string;
  stores: string[];
  descriptionKey: string;
  releasedAt: string | null;
  cal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  servingLabel?: string | null;
  dietTags: string[];
  /** Community average score — null when unrated. */
  avgRating: number | null;
};

export type DiscoverTrendingRow = {
  key: string;
  item: string;
  brand: string;
  store: string;
  stores: string[];
  category: string;
  emoji: string;
  dietTags: string[];
  macros: PostMacros | null;
  /** Unique users who ranked this product in the lookback window. */
  rankerCount: number;
  /** Unique users who added this product to Want to Try in the lookback window. */
  wantCount: number;
  /** rankerCount + wantCount — primary sort key for Discover trending. */
  activityCount: number;
  avgRating: number | null;
};

export type DiscoverWantToTryRow = {
  key: string;
  item: string;
  brand: string;
  store: string;
  stores: string[];
  category: string;
  emoji: string;
  rankerCount: number;
};

const DEFAULT_DISCOVER_LOOKBACK_DAYS = 7;

/** New-release rail: only show items whose release (or list) date is within this many days. */
export const DISCOVER_NEW_RELEASE_RETENTION_DAYS = DEFAULT_DISCOVER_LOOKBACK_DAYS;

function curatedNewReleaseWithinRetentionWindow(row: Record<string, unknown>): boolean {
  const released = row.released_at;
  const created = row.created_at;
  const raw =
    (released != null && String(released).trim() !== '' ? String(released) : '') ||
    (created != null && String(created).trim() !== '' ? String(created) : '');
  if (!raw) return false;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return false;
  const ageMs = Date.now() - t;
  const maxMs = DISCOVER_NEW_RELEASE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return ageMs >= 0 && ageMs <= maxMs;
}

function discoverNormalizeStore(store: string): string {
  const s = String(store ?? '').trim();
  if (!s || s.toLowerCase() === 'all stores') return '';
  return s;
}

function discoverItemKey(row: {
  item?: string | null;
  description_key?: string | null;
  product_brand?: string | null;
  brand?: string | null;
}): string {
  const fromKey = String(row.description_key ?? '').trim().toLowerCase();
  if (fromKey) return fromKey;
  return productDescriptionKey(
    String(row.item ?? ''),
    row.product_brand ?? row.brand
  );
}

function discoverRowMatchesDietTag(dietTags: string[] | null | undefined, dietFilter: string): boolean {
  const want = String(dietFilter ?? '').trim();
  if (!want) return true;
  return Array.isArray(dietTags) && dietTags.includes(want);
}

function curatedRowBrandLabel(row: Record<string, unknown>): string {
  return (
    String(row.brand ?? '').trim() ||
    String(row.brand_owner ?? row.brandOwner ?? '').trim() ||
    String(row.brand_name ?? row.brandName ?? '').trim()
  );
}

/** Drop legacy item-only catalog rows when a branded profile exists for the same name. */
function dedupeCuratedRecordsForDiscover(records: Record<string, unknown>[]): Record<string, unknown>[] {
  const brandedByItem = new Set<string>();
  for (const r of records) {
    const itemKey = normalizedDescriptionKeyFromItem(String(r.description ?? ''));
    const dk = String(r.description_key ?? '').trim().toLowerCase();
    if (!itemKey || !dk.includes('::')) continue;
    const brand = curatedRowBrandLabel(r);
    if (brand && !isPlaceholderCatalogBrand(brand, { description: String(r.description ?? '') })) {
      brandedByItem.add(itemKey);
    }
  }
  return records.filter((r) => {
    const dk = String(r.description_key ?? '').trim().toLowerCase();
    if (dk.includes('::')) return true;
    const itemKey = normalizedDescriptionKeyFromItem(String(r.description ?? ''));
    if (!brandedByItem.has(itemKey)) return true;
    const brand = curatedRowBrandLabel(r);
    return (
      !!brand && !isPlaceholderCatalogBrand(brand, { description: String(r.description ?? '') })
    );
  });
}

async function fetchCuratedRowsForMetadataSync(
  descKey: string,
  item: string,
  brand: string
): Promise<
  Array<{
    id: unknown;
    brand?: unknown;
    category?: unknown;
    nutrition_verification_state?: unknown;
    description_key?: unknown;
  }>
> {
  const legacyKey = normalizedDescriptionKeyFromItem(item);
  const keys = new Set<string>([descKey]);
  if (legacyKey && legacyKey !== descKey) keys.add(legacyKey);

  const { data, error } = await supabase
    .from('curated_products')
    .select('id, brand, category, nutrition_verification_state, description_key')
    .in('description_key', [...keys]);
  if (error) {
    console.warn('fetchCuratedRowsForMetadataSync:', error.message);
    return [];
  }
  return (data ?? []).filter((row) => {
    const rowBrand = String((row as { brand?: unknown }).brand ?? '').trim();
    if (!normalizedBrandKey(brand) || isUnknownUserBrand(brand)) return true;
    if (
      !rowBrand ||
      isPlaceholderCatalogBrand(rowBrand, { description: item }) ||
      isUnknownUserBrand(rowBrand)
    ) {
      return true;
    }
    return brandsMatchForProductIdentity(rowBrand, brand);
  });
}

/** Community post stores override stale catalog defaults for Discover filters. */
type DiscoverRankStats = { avg: number; rankerCount: number };

/** Batch community rank stats for Discover rows (canonical ratings). */
async function fetchDiscoverRankStatsByDescriptionKeys(
  keys: string[]
): Promise<Map<string, DiscoverRankStats>> {
  const clean = [...new Set(keys.map((k) => String(k ?? '').trim().toLowerCase()).filter(Boolean))];
  if (clean.length === 0) return new Map();

  const { data, error } = await supabase
    .from('posts')
    .select('id, user_id, description_key, rating, radar_only')
    .in('description_key', clean)
    .limit(5000);
  if (error) {
    console.warn('fetchDiscoverRankStatsByDescriptionKeys:', error.message);
    return new Map();
  }

  const posts = ((data ?? []) as RawPostForProduct[]).filter(rowCountsTowardGlobalAverage);
  if (posts.length === 0) return new Map();

  const authorIds = [...new Set(posts.map((r) => String(r.user_id)).filter(isProfileUuid))];
  const allAuthorRanked = await fetchRankedPostsForUserIds(authorIds);
  const maps = buildCanonicalRatingMapsFromRankedPosts(allAuthorRanked);

  type Bucket = { ratingsByUser: Map<string, number> };
  const byKey = new Map<string, Bucket>();
  for (const row of posts) {
    const dk = String(row.description_key ?? '').trim().toLowerCase();
    if (!dk) continue;
    const r = resolveCanonicalRatingForPost(row, maps);
    if (r == null) continue;
    let bucket = byKey.get(dk);
    if (!bucket) {
      bucket = { ratingsByUser: new Map() };
      byKey.set(dk, bucket);
    }
    bucket.ratingsByUser.set(String(row.user_id), r);
  }

  const out = new Map<string, DiscoverRankStats>();
  for (const [k, bucket] of byKey) {
    const ratings = [...bucket.ratingsByUser.values()];
    const rankerCount = ratings.length;
    if (rankerCount > 0) {
      const avg = clampBaggedScore(ratings.reduce((sum, r) => sum + r, 0) / rankerCount);
      out.set(k, { avg, rankerCount });
    }
  }
  return out;
}

function discoverRankStatsForRow(
  row: { descriptionKey: string; description: string },
  statsMap: Map<string, DiscoverRankStats>
): { avgRating: number | null; rankerCount: number } {
  const key = row.descriptionKey.trim().toLowerCase();
  const legacy = normalizedDescriptionKeyFromItem(row.description);
  const stats = statsMap.get(key) ?? statsMap.get(legacy);
  if (!stats) return { avgRating: null, rankerCount: 0 };
  return { avgRating: stats.avg, rankerCount: stats.rankerCount };
}

/** Most rankers first, then highest community score, then A–Z. */
export function sortDiscoverExploreRowsByRank<T extends {
  description: string;
  avgRating: number | null;
  rankerCount: number;
}>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (b.rankerCount !== a.rankerCount) return b.rankerCount - a.rankerCount;
    const avgA = a.avgRating ?? -1;
    const avgB = b.avgRating ?? -1;
    if (avgB !== avgA) return avgB - avgA;
    return a.description.localeCompare(b.description);
  });
}

async function attachDiscoverAvgRatings<
  T extends { descriptionKey: string; description: string },
>(rows: T[]): Promise<(T & { avgRating: number | null; rankerCount: number })[]> {
  if (rows.length === 0) return [];
  const keys = rows.flatMap((r) => [
    r.descriptionKey.trim().toLowerCase(),
    normalizedDescriptionKeyFromItem(r.description),
  ]);
  const statsMap = await fetchDiscoverRankStatsByDescriptionKeys(keys);
  return rows.map((r) => ({
    ...r,
    ...discoverRankStatsForRow(r, statsMap),
  }));
}

async function fetchPostRetailStoresByDescriptionKeys(
  keys: string[]
): Promise<Map<string, string[]>> {
  const clean = [...new Set(keys.map((k) => String(k ?? '').trim().toLowerCase()).filter(Boolean))];
  if (clean.length === 0) return new Map();

  const { data, error } = await supabase
    .from('posts')
    .select('description_key, store, stores, product_brand')
    .in('description_key', clean)
    .limit(5000);
  if (error) {
    console.warn('fetchPostRetailStoresByDescriptionKeys:', error.message);
    return new Map();
  }

  const byKey = new Map<string, Set<string>>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const dk = String(row.description_key ?? '').trim().toLowerCase();
    if (!dk) continue;
    const brand = String(row.product_brand ?? '').trim();
    const stores = exploreRetailStoresForProduct(
      {
        store: (row.store as string | null) ?? null,
        stores: (row.stores as string[] | null) ?? null,
        product_brand: brand,
      },
      brand
    );
    if (stores.length === 0) continue;
    let set = byKey.get(dk);
    if (!set) {
      set = new Set<string>();
      byKey.set(dk, set);
    }
    for (const s of stores) set.add(s);
  }

  const out = new Map<string, string[]>();
  for (const [k, set] of byKey) out.set(k, [...set]);
  return out;
}

function applyPostStoreOverlayToExploreRow(
  row: DiscoverExploreRow,
  overlay: Map<string, string[]>
): DiscoverExploreRow {
  const key = row.descriptionKey.trim().toLowerCase();
  const legacyKey = normalizedDescriptionKeyFromItem(row.description);
  const fromPosts = overlay.get(key) ?? overlay.get(legacyKey);
  if (!fromPosts?.length) return row;
  const brand = row.brandOwner || row.brandName;
  const sanitized = stripLegacyDefaultTraderJoesStores(
    storesForBrandAndSelections(brand, fromPosts),
    brand,
    { description: row.description }
  );
  if (!sanitized.length) return row;
  return { ...row, store: sanitized[0] ?? '', stores: sanitized };
}

/** Store filter for Discover — uses sanitized retailers, not raw DB `stores` arrays. */
function discoverExploreRowMatchesStore(
  row: DiscoverExploreRow,
  storeFilter: string
): boolean {
  if (!storeFilter) return true;
  if (!row.stores.length) return false;
  const want = storeFilter.toLowerCase();
  return row.stores.some((s) => s.trim().toLowerCase() === want);
}

function discoverCuratedRecordMatchesStore(
  row: Record<string, unknown>,
  storeFilter: string
): boolean {
  if (!storeFilter) return true;
  const description = String(row.description ?? '').trim();
  const vRaw = row.nutrition_verification_state ?? row.nutritionVerification;
  const isVerified = vRaw === 'verified';
  const brand =
    String(row.brand ?? '').trim() ||
    String(row.brand_owner ?? row.brandOwner ?? '').trim() ||
    String(row.brand_name ?? row.brandName ?? '').trim();
  const stores = exploreRetailStoresForProduct(
    {
      store: (row.store as string | null) ?? null,
      stores: (row.stores as string[] | null) ?? null,
      product_brand: brand,
      description: isVerified ? undefined : description,
    },
    brand
  );
  if (!stores.length) return false;
  const want = storeFilter.toLowerCase();
  return stores.some((s) => s.trim().toLowerCase() === want);
}

export type DiscoverExploreRow = {
  description: string;
  descriptionKey: string;
  brandOwner: string;
  brandName: string;
  foodCategory: string;
  foodCategories?: string[];
  store: string;
  stores: string[];
  cal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  servingLabel: string | null;
  dietTags: string[];
  nutritionVerification: 'verified' | 'unverified';
  /** Community average score — null when unrated. */
  avgRating: number | null;
  /** Distinct users who have ranked this product. */
  rankerCount: number;
};

function mapCuratedRecordToExploreRow(row: Record<string, unknown>): DiscoverExploreRow {
  const description = String(row.description ?? '').trim();
  const brand =
    String(row.brand ?? row.brand_owner ?? row.brandOwner ?? '').trim() ||
    String(row.brand_name ?? row.brandName ?? '').trim();
  const vRaw = row.nutrition_verification_state ?? row.nutritionVerification;
  const nutritionVerification = vRaw === 'verified' ? 'verified' : 'unverified';
  const isVerified = nutritionVerification === 'verified';
  const displayBrand =
    !isVerified && isPlaceholderCatalogBrand(brand, { description }) ? '' : brand;
  const stores = exploreRetailStoresForProduct(
    {
      store: (row.store as string | null) ?? null,
      stores: (row.stores as string[] | null) ?? null,
      product_brand: brand,
      description: isVerified ? undefined : description,
    },
    brand
  );
  const rowCategories = categoriesForRow({
    category: (row.category as string | null) ?? null,
    categories: (row.categories as string[] | null) ?? null,
  });
  return {
    description,
    descriptionKey: productDescriptionKey(description, displayBrand || brand),
    brandOwner: displayBrand,
    brandName: displayBrand,
    foodCategory: primaryCategoryForRow({
      category: (row.category as string | null) ?? null,
      categories: (row.categories as string[] | null) ?? null,
    }),
    foodCategories: rowCategories,
    store: stores[0] ?? '',
    stores,
    cal: macroNumFromDb(row.cal),
    protein: macroNumFromDb(row.protein),
    carbs: macroNumFromDb(row.carbs),
    fat: macroNumFromDb(row.fat),
    servingLabel:
      typeof row.serving_label === 'string'
        ? row.serving_label.trim() || null
        : typeof row.servingLabel === 'string'
          ? (row.servingLabel as string).trim() || null
          : null,
    dietTags: Array.isArray(row.diet_tags) ? (row.diet_tags as string[]) : [],
    nutritionVerification,
    avgRating: null,
    rankerCount: 0,
  };
}

/**
 * Discover search — merges curated_products + FatSecret/USDA `/api/search` rows.
 *
 * Curated rows are matched by description/brand `ilike` (with store/diet/category
 * filters applied server-side). API rows are then merged in, mapped to the same
 * shape, deduped against the curated set by `description_key`, and filtered:
 *  - category: API rows are kept only if `mapCategory(foodCategory + description)`
 *    matches the active filter (FatSecret returns `"Brand"` etc. — meaningless on
 *    its own, so we use the same heuristic the rate flow uses).
 *  - diet: API rows have no diet tags, so they're dropped when a diet filter is set.
 *  - store: API rows have no store unless the user saved one on a curated row;
 *    they're dropped when a store filter is set unless explicit store data matches.
 *
 * Falls through to curated-only when no query is supplied.
 */
export async function fetchDiscoverExploreSearch(args: {
  query: string;
  store?: string;
  dietTag?: string;
  category?: string;
  limit?: number;
}): Promise<DiscoverExploreRow[]> {
  const q = String(args.query ?? '').trim();
  const limit = args.limit ?? 100;
  if (q.length < 2) {
    return fetchDiscoverExploreCurated({
      store: args.store,
      dietTag: args.dietTag,
      category: args.category,
      query: '',
      limit,
    });
  }

  const storeFilter = discoverNormalizeStore(args.store ?? '');
  const dietFilter = String(args.dietTag ?? '').trim();
  const categoryFilter = String(args.category ?? '').trim();

  const [curated, apiRows] = await Promise.all([
    fetchDiscoverExploreCurated({
      store: args.store,
      dietTag: args.dietTag,
      category: args.category,
      query: q,
      limit: limit,
    }),
    fetchSearchApiProductsOnly(q).catch((err) => {
      console.warn('discover api search failed:', err);
      return [] as SearchProductRow[];
    }),
  ]);

  const curatedKeys = new Set(curated.map((c) => c.descriptionKey));
  const apiMapped: DiscoverExploreRow[] = [];
  const apiSeen = new Set<string>();
  for (const r of apiRows) {
    const desc = String(r.description ?? '').trim();
    if (!desc) continue;
    const descKey =
      String(r.descriptionKey ?? '').trim().toLowerCase() ||
      productDescriptionKey(desc, searchRowBrand(r));
    if (!descKey || curatedKeys.has(descKey) || apiSeen.has(descKey)) continue;

    const brand = searchRowBrand(r);
    const inferredCategory = mapCategory(`${r.foodCategory ?? ''} ${desc}`);
    if (categoryFilter && !rowMatchesCategoryFilter({ category: inferredCategory }, categoryFilter)) {
      continue;
    }
    if (dietFilter) continue;

    const inferredStores = brand ? storesForBrandAndSelections(brand, []) : [];
    if (storeFilter) {
      const want = storeFilter.toLowerCase();
      if (!inferredStores.some((s) => s.trim().toLowerCase() === want)) continue;
    }

    apiSeen.add(descKey);
    apiMapped.push({
      description: desc,
      descriptionKey: descKey,
      brandOwner: brand,
      brandName: brand,
      foodCategory: inferredCategory,
      store: inferredStores[0] ?? '',
      stores: inferredStores,
      cal: typeof r.cal === 'number' ? r.cal : null,
      protein: typeof r.protein === 'number' ? r.protein : null,
      carbs: typeof r.carbs === 'number' ? r.carbs : null,
      fat: typeof r.fat === 'number' ? r.fat : null,
      servingLabel: typeof r.servingLabel === 'string' ? r.servingLabel : null,
      dietTags: [],
      nutritionVerification: 'unverified',
      avgRating: null,
      rankerCount: 0,
    });
  }

  const merged = [...curated, ...apiMapped];
  const hasNarrowFilter = Boolean(storeFilter || dietFilter || categoryFilter);

  // Stable, query-aware sort: curated boost + startsWith > includes > brand match.
  const qn = q.toLowerCase();
  const scored = merged.map((row, idx) => {
    const desc = row.description.toLowerCase();
    const brand = (row.brandOwner || row.brandName || '').toLowerCase();
    let score = 0;
    if (desc === qn) score += 500;
    if (desc.startsWith(qn)) score += 260;
    if (desc.includes(qn)) score += 160;
    if (brand.startsWith(qn)) score += 90;
    if (brand.includes(qn)) score += 60;
    if (curatedKeys.has(row.descriptionKey)) score += 30; // prefer curated
    return { row, idx, score };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.row.description.length !== b.row.description.length) {
      return a.row.description.length - b.row.description.length;
    }
    return a.idx - b.idx;
  });
  const ranked = scored.map((s) => s.row);
  const storeFiltered = storeFilter
    ? ranked.filter((row) => discoverExploreRowMatchesStore(row, storeFilter))
    : ranked;
  const withStats = await attachDiscoverAvgRatings(storeFiltered);
  if (hasNarrowFilter) {
    return sortDiscoverExploreRowsByRank(withStats).slice(0, limit);
  }
  return withStats.slice(0, limit);
}

/**
 * Curated catalog for the Explore panel (store / diet / category / query) — same rules as the web app.
 */
export async function fetchDiscoverExploreCurated(args: {
  store?: string;
  dietTag?: string;
  /** Exact `curated_products.category` match when set */
  category?: string;
  query?: string;
  limit?: number;
} = {}): Promise<DiscoverExploreRow[]> {
  const limit = args.limit ?? 30;
  const storeFilter = discoverNormalizeStore(args.store ?? '');
  const dietFilter = String(args.dietTag ?? '').trim();
  const categoryFilter = String(args.category ?? '').trim();
  const q = String(args.query ?? '').trim();

  /**
   * Do not filter curated rows with `.contains('stores', …)` — many legacy rows
   * have a bogus default `Trader Joe's` in `stores` even when the brand is not
   * TJ. Filter after `retailStoresForRow` sanitization instead.
   */
  const fetchCap = storeFilter
    ? Math.min(Math.max(limit * 8, 240), 1000)
    : Math.min(Math.max(limit * 2, 120), 1000);
  let req = supabase.from('curated_products').select('*').limit(fetchCap);
  if (dietFilter) req = req.contains('diet_tags', [dietFilter]);
  if (q.length >= 2) {
    const cleaned = q.replace(/[().,]/g, ' ').trim();
    const safe = escapeIlikePattern(cleaned);
    req = req.or(`description.ilike.%${safe}%,brand.ilike.%${safe}%`);
  }

  const { data, error } = await req;
  if (error) {
    console.warn('fetchDiscoverExploreCurated:', error.message);
    return [];
  }

  const deduped = dedupeCuratedRecordsForDiscover(
    (data ?? []) as Record<string, unknown>[]
  );
  const overlayKeys = deduped.map((r) => {
    const dk = String(r.description_key ?? '').trim().toLowerCase();
    if (dk) return dk;
    return productDescriptionKey(String(r.description ?? ''), curatedRowBrandLabel(r));
  });
  const postStoreOverlay = await fetchPostRetailStoresByDescriptionKeys(overlayKeys);

  let mapped = deduped.map((r) => {
    const row = mapCuratedRecordToExploreRow(r);
    return applyPostStoreOverlayToExploreRow(row, postStoreOverlay);
  });
  if (storeFilter) {
    mapped = mapped.filter((row) => discoverExploreRowMatchesStore(row, storeFilter));
  }
  if (categoryFilter) {
    mapped = mapped.filter((row) =>
      rowMatchesCategoryFilter(
        { category: row.foodCategory, categories: row.foodCategories },
        categoryFilter
      )
    );
  }
  const withStats = await attachDiscoverAvgRatings(mapped);
  const hasNarrowFilter = Boolean(storeFilter || dietFilter || categoryFilter || q.length >= 2);
  if (hasNarrowFilter) {
    return sortDiscoverExploreRowsByRank(withStats).slice(0, limit);
  }
  return withStats.slice(0, limit);
}

async function fetchDiscoverWantToTryRowsSince(since: string): Promise<Array<Record<string, unknown>>> {
  const want = await supabase
    .from('want_to_try')
    .select('user_id, item, store, stores, category, emoji, product_brand, added_at')
    .gte('added_at', since)
    .order('added_at', { ascending: false })
    .limit(2000);
  if (!want.error && (want.data ?? []).length > 0) {
    return (want.data ?? []) as Array<Record<string, unknown>>;
  }
  if (want.error) {
    console.warn('fetchDiscoverTrendingThisWeek want_to_try:', want.error.message);
  }
  const radar = await supabase
    .from('posts')
    .select('user_id, item, store, stores, category, emoji, product_brand, created_at')
    .eq('radar_only', true)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (radar.error) {
    console.warn('fetchDiscoverTrendingThisWeek radar fallback:', radar.error.message);
    return [];
  }
  return ((radar.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    added_at: r.created_at,
  }));
}

/** Trending products ranked by rankings + Want to Try adds in the last 7 days. */
export async function fetchDiscoverTrendingThisWeek(args: {
  limit?: number;
} = {}): Promise<DiscoverTrendingRow[]> {
  const limit = args.limit ?? 12;
  const since = new Date(
    Date.now() - DEFAULT_DISCOVER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const [rankRes, wantRows] = await Promise.all([
    supabase
      .from('posts')
      .select(
        'id, user_id, item, description_key, store, stores, category, product_brand, rating, radar_only, created_at, emoji, macros, diet_tags'
      )
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(2000),
    fetchDiscoverWantToTryRowsSince(since),
  ]);

  if (rankRes.error) {
    console.warn('fetchDiscoverTrendingThisWeek:', rankRes.error.message);
    return [];
  }

  type Bucket = {
    key: string;
    item: string;
    store: string;
    stores: string[];
    category: string;
    productBrand: string;
    emoji: string;
    dietTags: string[];
    macros: PostMacros | null;
    rankerIds: Set<string>;
    wantIds: Set<string>;
    sumRating: number;
    countRating: number;
  };

  const byKey = new Map<string, Bucket>();

  const ensureBucket = (
    key: string,
    seed: {
      item: string;
      store: string;
      stores: string[];
      category: string;
      productBrand: string;
      emoji: string;
      dietTags: string[];
      macros: PostMacros | null;
    }
  ): Bucket => {
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        item: seed.item,
        store: seed.store,
        stores: [...seed.stores],
        category: seed.category,
        productBrand: seed.productBrand,
        emoji: seed.emoji,
        dietTags: [...seed.dietTags],
        macros: seed.macros,
        rankerIds: new Set(),
        wantIds: new Set(),
        sumRating: 0,
        countRating: 0,
      };
      byKey.set(key, g);
    } else {
      if (!g.store && seed.store) g.store = seed.store;
      if (!g.macros && seed.macros) g.macros = seed.macros;
      if (g.dietTags.length === 0 && seed.dietTags.length > 0) g.dietTags = [...seed.dietTags];
      for (const s of seed.stores) {
        if (s && !g.stores.includes(s)) g.stores.push(s);
      }
    }
    return g;
  };

  for (const row of (rankRes.data ?? []) as Array<Record<string, unknown>>) {
    if (row.radar_only === true) continue;
    const r = Number(row.rating);
    if (!Number.isFinite(r) || r <= 0) continue;
    const stores = retailStoresForRow({
      store: (row.store as string | null) ?? null,
      stores: (row.stores as string[] | null) ?? null,
      product_brand: (row.product_brand as string | null) ?? null,
    });
    const key = discoverItemKey({
      item: (row.item as string | null) ?? null,
      description_key: (row.description_key as string | null) ?? null,
      product_brand: (row.product_brand as string | null) ?? null,
    });
    if (!key) continue;

    const g = ensureBucket(key, {
      item: String(row.item ?? ''),
      store: stores[0] ?? '',
      stores,
      category: String(row.category ?? '') || 'Snacks',
      productBrand: String(row.product_brand ?? ''),
      emoji: String(row.emoji ?? ''),
      dietTags: Array.isArray(row.diet_tags) ? [...(row.diet_tags as string[])] : [],
      macros: normalizePostMacros(row.macros) ?? null,
    });
    g.rankerIds.add(String(row.user_id));
    g.sumRating += r;
    g.countRating += 1;
  }

  for (const row of wantRows) {
    const stores = retailStoresForRow({
      store: (row.store as string | null) ?? null,
      stores: (row.stores as string[] | null) ?? null,
      product_brand: (row.product_brand as string | null) ?? null,
    });
    const key = discoverItemKey({
      item: (row.item as string | null) ?? null,
      description_key: null,
      product_brand: (row.product_brand as string | null) ?? null,
    });
    if (!key) continue;

    const g = ensureBucket(key, {
      item: String(row.item ?? ''),
      store: stores[0] ?? '',
      stores,
      category: String(row.category ?? '') || 'Snacks',
      productBrand: String(row.product_brand ?? ''),
      emoji: String(row.emoji ?? ''),
      dietTags: [],
      macros: null,
    });
    g.wantIds.add(String(row.user_id));
  }

  const mapped = Array.from(byKey.values())
    .map((g) => {
      const rankerCount = g.rankerIds.size;
      const wantCount = g.wantIds.size;
      return {
        key: g.key,
        item: g.item,
        brand: g.productBrand,
        store: g.store,
        stores: g.stores,
        category: g.category,
        emoji: g.emoji,
        dietTags: g.dietTags,
        macros: g.macros,
        rankerCount,
        wantCount,
        activityCount: rankerCount + wantCount,
        avgRating: g.countRating > 0 ? g.sumRating / g.countRating : 0,
      };
    })
    .sort((a, b) => {
      if (b.activityCount !== a.activityCount) return b.activityCount - a.activityCount;
      if (b.rankerCount !== a.rankerCount) return b.rankerCount - a.rankerCount;
      if (b.avgRating !== a.avgRating) return b.avgRating - a.avgRating;
      return 0;
    })
    .slice(0, limit);

  return attachDiscoverAvgRatings(
    mapped.map((row) => ({
      ...row,
      descriptionKey: row.key,
      description: row.item,
    }))
  ).then((rows) =>
    rows.map(({ descriptionKey: _dk, description: _d, ...row }) => row)
  );
}

/** Items from `want_to_try`, aggregated by item identity. Falls back to radar posts when the table isn't readable. */
export async function fetchDiscoverTopWantToTry(args: {
  limit?: number;
  store?: string;
} = {}): Promise<DiscoverWantToTryRow[]> {
  const limit = args.limit ?? 12;
  const storeFilter = discoverNormalizeStore(args.store ?? '');
  let rows: Array<Record<string, unknown>> = [];
  const want = await supabase
    .from('want_to_try')
    .select('user_id, item, store, category, emoji, product_brand, added_at')
    .order('added_at', { ascending: false })
    .limit(2000);
  if (want.error) {
    console.warn('fetchDiscoverTopWantToTry: falling back to radar posts:', want.error.message);
  }
  rows = ((want.data as Array<Record<string, unknown>>) ?? []);
  if (want.error || rows.length === 0) {
    const radar = await supabase
      .from('posts')
      .select('user_id, item, store, stores, category, emoji, product_brand, created_at')
      .eq('radar_only', true)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (radar.error) {
      console.warn('fetchDiscoverTopWantToTry radar fallback failed:', radar.error.message);
      return [];
    }
    rows = ((radar.data as Array<Record<string, unknown>>) ?? []).map((r) => ({
      ...r,
      added_at: r.created_at,
    }));
  }

  type Bucket = {
    key: string;
    item: string;
    store: string;
    stores: string[];
    category: string;
    emoji: string;
    brand: string;
    userIds: Set<string>;
  };
  const byKey = new Map<string, Bucket>();
  for (const row of rows) {
    const stores = retailStoresForRow({
      store: (row.store as string | null) ?? null,
      stores: (row.stores as string[] | null) ?? null,
      product_brand: (row.product_brand as string | null) ?? null,
    });
    if (storeFilter) {
      const want = storeFilter.toLowerCase();
      if (!stores.some((s) => s.trim().toLowerCase() === want)) continue;
    }
    const key = String(row.item ?? '').trim().toLowerCase();
    if (!key) continue;

    const displayStore = stores[0] ?? '';

    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        item: String(row.item ?? ''),
        store: displayStore,
        stores: [...stores],
        category: String(row.category ?? '') || 'Snacks',
        emoji: String(row.emoji ?? ''),
        brand: String(row.product_brand ?? ''),
        userIds: new Set(),
      };
      byKey.set(key, g);
    } else if (!g.store && displayStore) {
      g.store = displayStore;
    }
    g.userIds.add(String(row.user_id));
    for (const s of stores) {
      if (s && !g.stores.includes(s)) g.stores.push(s);
    }
  }

  return Array.from(byKey.values())
    .map((g) => ({
      key: g.key,
      item: g.item,
      brand: g.brand,
      store: g.store,
      stores: g.stores,
      category: g.category,
      emoji: g.emoji,
      rankerCount: g.userIds.size,
    }))
    .sort((a, b) => b.rankerCount - a.rankerCount)
    .slice(0, limit);
}

/** New releases from the curated_products table (admin-curated). Fails soft when the column or table isn't available. */
export async function fetchDiscoverNewReleases(args: {
  limit?: number;
  store?: string;
  dietTag?: string;
  category?: string;
} = {}): Promise<DiscoverNewReleaseRow[]> {
  const limit = args.limit ?? 12;
  const storeFilter = discoverNormalizeStore(args.store ?? '');
  const dietFilter = String(args.dietTag ?? '').trim();
  const categoryFilter = String(args.category ?? '').trim();
  const overfetch = Math.max(limit * 3, 24);
  let req = supabase
    .from('curated_products')
    .select('*')
    .eq('is_new_release', true);
  if (categoryFilter) req = req.eq('category', categoryFilter);
  const { data, error } = await req
    .order('released_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(overfetch);
  if (error) {
    console.warn('fetchDiscoverNewReleases: failing soft:', error.message);
    return [];
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const filtered = rows.filter((row) => {
    if (storeFilter) {
      const brand =
        String(row.brand ?? '').trim() ||
        String(row.brand_owner ?? row.brandOwner ?? '').trim() ||
        String(row.brand_name ?? row.brandName ?? '').trim();
      const vRaw = row.nutrition_verification_state ?? row.nutritionVerification;
      const isVerified = vRaw === 'verified';
      const description = String(row.description ?? '').trim();
      const list = exploreRetailStoresForProduct(
        {
          store: (row.store as string | null) ?? null,
          stores: (row.stores as string[] | null) ?? null,
          product_brand: brand,
          description: isVerified ? undefined : description,
        },
        brand
      );
      if (!list.length) return false;
      if (!list.some((s) => s.trim().toLowerCase() === storeFilter.toLowerCase())) return false;
    }
    if (!discoverRowMatchesDietTag(row.diet_tags as string[] | null, dietFilter)) return false;
    if (!curatedNewReleaseWithinRetentionWindow(row)) return false;
    return true;
  });
  const mapped = filtered.slice(0, limit).map((row) => {
    const description = String(row.description ?? '');
    const brand =
      String(row.brand ?? '').trim() ||
      String(row.brand_owner ?? row.brandOwner ?? '').trim() ||
      String(row.brand_name ?? row.brandName ?? '').trim();
    const vRaw = row.nutrition_verification_state ?? row.nutritionVerification;
    const isVerified = vRaw === 'verified';
    const stores = exploreRetailStoresForProduct(
      {
        store: (row.store as string | null) ?? null,
        stores: (row.stores as string[] | null) ?? null,
        product_brand: brand,
        description: isVerified ? undefined : description,
      },
      brand
    );
    return {
      description,
      brandOwner: brand,
      brandName: brand,
      foodCategory: String(row.category ?? row.food_category ?? row.foodCategory ?? 'Snacks'),
      store: stores[0] ?? '',
      stores,
      descriptionKey:
        String(row.description_key ?? '').trim().toLowerCase() ||
        description.trim().toLowerCase(),
      releasedAt: (row.released_at as string | null) ?? null,
      cal: typeof row.cal === 'number' ? (row.cal as number) : null,
      protein: typeof row.protein === 'number' ? (row.protein as number) : null,
      carbs: typeof row.carbs === 'number' ? (row.carbs as number) : null,
      fat: typeof row.fat === 'number' ? (row.fat as number) : null,
      servingLabel: (row.serving_label as string | null) ?? null,
      dietTags: Array.isArray(row.diet_tags) ? (row.diet_tags as string[]) : [],
      avgRating: null,
    };
  });
  return attachDiscoverAvgRatings(mapped);
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

/** Lowercase usernames for profiles flagged as verified ambassadors. */
export async function fetchVerifiedAmbassadorUsernames(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('is_verified_ambassador', true);
  if (error) {
    console.warn('fetchVerifiedAmbassadorUsernames:', error.message);
    return new Set();
  }
  return new Set(
    (data ?? [])
      .map((row) =>
        String((row as { username?: string | null }).username ?? '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
}

export type LeaderboardRow = {
  userId: string;
  username: string;
  avatarColor: string | null;
  rankedCount: number;
  rank: number;
  isVerifiedAmbassador: boolean;
};

/**
 * Leaderboard counts must match the profile “Ranked” stat: distinct
 * (item, primary store, brand) rows, excluding want-to-try radar posts.
 */
function assignLeaderboardRanks<T extends { rankedCount: number }>(
  sorted: T[]
): (T & { rank: number })[] {
  let rank = 1;
  return sorted.map((entry, idx) => {
    if (idx > 0 && entry.rankedCount < sorted[idx - 1].rankedCount) {
      rank = idx + 1;
    }
    return { ...entry, rank };
  });
}

async function fetchRankedCountsAllUsers(): Promise<Map<string, number>> {
  const countsByUserId = new Map<string, number>();
  const seenByUser = new Map<string, Set<string>>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('posts')
      .select('user_id, item, store, stores, product_brand, radar_only, rating')
      .order('id', { ascending: true })
      .range(from, from + RANKED_COUNT_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<{
      user_id?: string | null;
      item?: string | null;
      store?: string | null;
      stores?: string[] | null;
      product_brand?: string | null;
      radar_only?: boolean | null;
      rating?: number | null;
    }>;
    accumulateRankedCountsFromPostRows(batch, countsByUserId, seenByUser);
    if (batch.length < RANKED_COUNT_PAGE_SIZE) break;
    from += RANKED_COUNT_PAGE_SIZE;
  }
  return countsByUserId;
}

export async function fetchLeaderboardByRankedCount(limit?: number): Promise<LeaderboardRow[]> {
  const countsByUserId = await fetchRankedCountsAllUsers();

  const userIds = Array.from(countsByUserId.keys());
  if (userIds.length === 0) return [];

  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select(PROFILE_SNIPPET_SELECT)
    .in('id', userIds);
  if (profErr) throw profErr;
  const profileById = new Map(
    (profiles ?? []).map(
      (p: {
        id: string;
        username: string | null;
        avatar_color: string | null;
        is_verified_ambassador?: boolean | null;
      }) => [p.id, p]
    )
  );

  const sorted = userIds
    .map((id) => {
      const prof = profileById.get(id);
      return {
        userId: id,
        username: prof?.username ?? 'unknown',
        avatarColor: prof?.avatar_color ?? null,
        rankedCount: countsByUserId.get(id) ?? 0,
        isVerifiedAmbassador: profileIsVerifiedAmbassador(prof),
      };
    })
    .sort((a, b) => {
      if (b.rankedCount !== a.rankedCount) return b.rankedCount - a.rankedCount;
      return a.username.localeCompare(b.username);
    });

  const list: LeaderboardRow[] = assignLeaderboardRanks(sorted);

  if (typeof limit === 'number' && Number.isFinite(limit)) {
    return list.slice(0, Math.max(1, limit));
  }
  return list;
}

export function leaderboardRankForUsername(
  rows: LeaderboardRow[],
  username: string | null | undefined
): number | null {
  const target = String(username ?? '').trim();
  if (!target) return null;
  const row = rows.find((r) => usernamesMatch(r.username, target));
  return row?.rank ?? null;
}

// ─── Profile mutations (used by Settings) ─────────────────────────────────────

export async function updateOwnProfile(args: {
  userId: string;
  username?: string;
  bio?: string;
  avatarColor?: string;
  dietTags?: string[];
  /** Omit to leave unchanged; pass null to clear after migration is applied. */
  zipCode?: string | null;
  /** Omit to leave unchanged; pass null to clear after migration is applied. */
  birthday?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (args.username !== undefined) patch.username = args.username;
  if (args.bio !== undefined) patch.bio = args.bio;
  if (args.avatarColor !== undefined) patch.avatar_color = args.avatarColor;
  if (args.dietTags !== undefined) patch.diet_tags = normalizeProfileDietTags(args.dietTags);
  if (args.zipCode !== undefined) {
    const zip = String(args.zipCode ?? '').trim();
    patch.zip_code = zip || null;
  }
  if (args.birthday !== undefined) patch.birthday = normalizeBirthday(args.birthday);
  if (Object.keys(patch).length === 0) return;

  const droppable = PROFILE_DROPPABLE_SELECT_COLUMNS;
  let current = { ...patch };
  for (let i = 0; i < 6; i += 1) {
    const { error } = await supabase.from('profiles').update(current).eq('id', args.userId);
    if (!error) return;
    const missing = parseMissingTableColumn(error.message, error.details, 'profiles');
    if (missing && droppable.has(missing) && missing in current) {
      delete current[missing];
      if (Object.keys(current).length === 0) return;
      continue;
    }
    throw error;
  }
  throw Object.assign(new Error('profiles update: optional column fallback exhausted'), {
    code: 'update_exhausted',
  });
}

export async function isUsernameAvailable(args: {
  candidate: string;
  excludeUserId?: string;
}): Promise<boolean> {
  const handle = args.candidate.trim().toLowerCase();
  if (!handle) return false;
  const query = supabase.from('profiles').select('id').eq('username', handle).limit(1);
  const { data, error } = await query;
  if (error) {
    console.warn('isUsernameAvailable:', error.message);
    return false;
  }
  const rows = (data as { id: string }[] | null) ?? [];
  if (rows.length === 0) return true;
  return args.excludeUserId ? rows[0].id === args.excludeUserId : false;
}

export { curatedRowToSearchProductRow };
