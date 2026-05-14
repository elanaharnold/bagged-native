import { supabase } from './supabase';
import type { Vibe } from './ranking';

export type FeedProfile = {
  id: string;
  username: string | null;
  avatar_color: string | null;
};

export type FeedPostRow = {
  id: string | number;
  user_id: string;
  item: string | null;
  description_key?: string | null;
  product_brand?: string | null;
  store?: string | null;
  stores?: string[] | null;
  category?: string | null;
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

/** Profile ids for `userId` plus everyone they follow (by username, case-insensitive). */
async function followerProfileIdsForFeed(userId: string): Promise<string[]> {
  if (!userId || !isProfileUuid(userId)) return [];
  const { data: follows } = await supabase
    .from('follows_by_username')
    .select('following_username')
    .eq('follower_id', userId);

  const followingUsernames = [
    ...new Set(
      (follows ?? [])
        .map((f: { following_username: string | null }) => f.following_username)
        .filter((u): u is string => Boolean(u))
    ),
  ];
  if (followingUsernames.length === 0) return [userId];

  const ids: string[] = [];
  for (const un of followingUsernames) {
    const raw = String(un).trim();
    const lower = raw.toLowerCase();
    let row: { id: string } | null = null;
    const q1 = await supabase
      .from('profiles')
      .select('id')
      .eq('username', lower)
      .maybeSingle();
    if (q1.data?.id) {
      row = q1.data as { id: string };
    } else {
      const q2 = await supabase
        .from('profiles')
        .select('id')
        .eq('username', raw)
        .maybeSingle();
      if (q2.data?.id) row = q2.data as { id: string };
    }
    if (row?.id) ids.push(row.id);
  }
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
          .select('id, username, avatar_color')
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

export async function getFeed(userId: string): Promise<FeedPostRow[]> {
  if (!userId) return [];
  try {
    const followingIds = await followerProfileIdsForFeed(userId);
    if (followingIds.length === 0) return [];
    const rows = await fetchPostsForUsersWithOrdering(followingIds, 120);
    const deduped = dedupePostsByUserItemStore(rows as RawPostForProduct[]);
    deduped.sort((a, b) => {
      const tb = feedActivityTimestampMs(b) - feedActivityTimestampMs(a);
      if (tb !== 0) return tb;
      const ida = Number(a.id) || 0;
      const idb = Number(b.id) || 0;
      return idb - ida;
    });
    const hydrated = await hydratePostsWithProfileAndLikes(deduped);
    const commentCounts = await fetchCommentCountsForPosts(hydrated.map((r) => String(r.id)));
    return hydrated.map((row) => ({
      ...row,
      commentCount: commentCounts.get(String(row.id)) ?? 0,
    }));
  } catch (e) {
    console.warn('getFeed failed:', (e as { message?: string })?.message ?? e);
    return [];
  }
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

type RawPostForProduct = Omit<FeedPostRow, 'profile' | 'likes' | 'commentCount'>;

function primaryStoreNormForProduct(row: { store?: string | null; stores?: string[] | null }): string {
  const arr = Array.isArray(row.stores) && row.stores.length ? row.stores.filter(Boolean) : [];
  const s = arr[0] ?? row.store ?? '';
  return String(s).trim().toLowerCase();
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
    const rating = Number(row.rating);
    const hasTried = Number.isFinite(rating) && rating > 0;
    const radar = row.radar_only === true;
    const quality = hasTried ? 2 : radar ? 0 : 1;
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
    if (!prev || better(row, prev)) byKey.set(k, row);
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
    .select('id, item, description_key, store, stores, radar_only')
    .eq('user_id', uid)
    .eq('description_key', dk);

  if (error) {
    console.warn('deleteOtherUserRankedPostsSameSlot:', error.message);
    return;
  }

  for (const row of data ?? []) {
    if (String(row.id) === String(keepPostId)) continue;
    if ((row as { radar_only?: boolean | null }).radar_only === true) continue;
    const st = primaryStoreNormForProduct(row as RawPostForProduct);
    if (storeWant !== st) continue;
    const { error: delErr } = await supabase.from('posts').delete().eq('id', row.id).eq('user_id', uid);
    if (delErr) console.warn('delete duplicate post:', delErr.message);
  }
}

async function fetchMergedRawPostsForItem(
  itemName: string,
  descriptionKey: string
): Promise<RawPostForProduct[]> {
  const name = String(itemName ?? '').trim();
  const key =
    String(descriptionKey || '').trim().toLowerCase() || normalizedDescriptionKeyFromItem(name);
  if (!name && !key) return [];

  const [byKeyRes, byNameRes, byNameContainsRes] = await Promise.all([
    key
      ? supabase.from('posts').select('*').eq('description_key', key)
      : Promise.resolve({ data: [] as RawPostForProduct[], error: null as null }),
    name
      ? supabase.from('posts').select('*').eq('item', name)
      : Promise.resolve({ data: [] as RawPostForProduct[], error: null as null }),
    name.length >= 4
      ? supabase.from('posts').select('*').ilike('item', `%${name}%`)
      : Promise.resolve({ data: [] as RawPostForProduct[], error: null as null }),
  ]);
  if (byKeyRes.error) throw byKeyRes.error;
  if (byNameRes.error) throw byNameRes.error;
  if (byNameContainsRes.error) throw byNameContainsRes.error;
  const merged = [
    ...((byKeyRes.data ?? []) as RawPostForProduct[]),
    ...((byNameRes.data ?? []) as RawPostForProduct[]),
    ...((byNameContainsRes.data ?? []) as RawPostForProduct[]),
  ];
  return dedupePostsByUserItemStore(merged);
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
  descriptionKey = ''
): Promise<{ avg: number | null; count: number }> {
  try {
    const rows = await fetchMergedRawPostsForItem(itemName, descriptionKey);
    const ranked = rows.filter(rowCountsTowardGlobalAverage);
    if (ranked.length === 0) return { avg: null, count: 0 };
    let sum = 0;
    for (const row of ranked) {
      const r = Number(row.rating);
      if (Number.isFinite(r)) sum += r;
    }
    return { avg: sum / ranked.length, count: ranked.length };
  } catch (e) {
    console.warn('getGlobalRankStatsForItem:', (e as { message?: string })?.message ?? e);
    return { avg: null, count: 0 };
  }
}

export type VerifiedCuratedNutrition = {
  brand: string;
  stores: string[];
  category: string;
  cal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  serving_label: string;
  diet_tags: string[];
};

/**
 * Verified curated nutrition for shared UI / rate autofill.
 * Returns null unless the row is verified **and** has at least one macro > 0
 * (so catalog-only curated shells do not pre-fill the nutrition step).
 */
export async function fetchVerifiedCuratedNutritionByDescription(
  description: string
): Promise<VerifiedCuratedNutrition | null> {
  const desc = String(description ?? '').trim();
  const descKey = normalizedDescriptionKeyFromItem(desc);
  if (!desc) return null;

  const { data, error } = await supabase
    .from('curated_products')
    .select('*')
    .eq('description_key', descKey)
    .maybeSingle();

  if (error) {
    console.warn('fetchVerifiedCuratedNutritionByDescription:', error.message);
    return null;
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const vRaw = row.nutrition_verification_state ?? row.nutritionVerification;
  if (String(vRaw) !== 'verified') return null;

  /** Verified shell rows (catalog intake with no macros yet) must not drive autofill. */
  const hasMeaningfulMacro =
    ['cal', 'protein', 'carbs', 'fat'].some((key) => {
      const v = row[key];
      if (v == null || v === '') return false;
      const n = Number(v);
      return Number.isFinite(n) && n > 0;
    });
  if (!hasMeaningfulMacro) return null;

  const storesRaw = row.stores;
  const storeSingle = row.store;
  let stores: string[] = [];
  if (Array.isArray(storesRaw)) {
    stores = (storesRaw as unknown[]).map((s) => String(s ?? '').trim()).filter(Boolean);
  }
  if (stores.length === 0 && storeSingle) {
    const s = String(storeSingle).trim();
    if (s) stores = [s];
  }

  const serving =
    typeof row.serving_label === 'string'
      ? row.serving_label.trim()
      : typeof row.servingLabel === 'string'
        ? (row.servingLabel as string).trim()
        : '';

  return {
    brand: String(row.brand ?? '').trim(),
    stores,
    category: String(row.category ?? 'Snacks').trim() || 'Snacks',
    cal: row.cal != null ? Number(row.cal) : null,
    protein: row.protein != null ? Number(row.protein) : null,
    carbs: row.carbs != null ? Number(row.carbs) : null,
    fat: row.fat != null ? Number(row.fat) : null,
    serving_label: serving,
    diet_tags: Array.isArray(row.diet_tags) ? (row.diet_tags as string[]) : [],
  };
}

/** All deduped community posts for one product identity (newest first). */
export async function fetchCommunityPostsForProduct(
  itemName: string,
  descriptionKey = ''
): Promise<FeedPostRow[]> {
  try {
    const raw = await fetchMergedRawPostsForItem(itemName, descriptionKey);
    if (raw.length === 0) return [];
    raw.sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );
    const hydrated = await hydratePostsWithProfileAndLikes(raw);
    const commentCounts = await fetchCommentCountsForPosts(hydrated.map((r) => String(r.id)));
    return hydrated.map((row) => ({
      ...row,
      commentCount: commentCounts.get(String(row.id)) ?? 0,
    }));
  } catch (e) {
    console.warn('fetchCommunityPostsForProduct:', (e as { message?: string })?.message ?? e);
    return [];
  }
}

// ─── Discover: following activity ─────────────────────────────────────────────

export type FollowingActivityRow = {
  postId: string;
  userId: string;
  username: string;
  avatarColor: string | null;
  item: string;
  brand: string;
  store: string;
  category: string;
  rating: number;
  createdAt: string;
  macros: PostMacros | null;
};

/** Recent ranked posts from people you follow (excludes your own posts). */
export async function fetchFollowingRecentActivity(
  viewerId: string,
  limit = 14
): Promise<FollowingActivityRow[]> {
  const following = await getFollowingProfileIdsOnly(viewerId);
  if (following.length === 0) return [];

  const since = new Date();
  since.setDate(since.getDate() - 14);
  const sinceIso = since.toISOString();

  const runOrdered = async () => {
    const q = supabase
      .from('posts')
      .select('*')
      .in('user_id', following)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(80);
    const { data, error } = await q;
    if (!error && data) return data as FeedPostRow[];
    const q2 = await supabase
      .from('posts')
      .select('*')
      .in('user_id', following)
      .order('created_at', { ascending: false })
      .limit(80);
    return (q2.data ?? []) as FeedPostRow[];
  };

  const rows = await runOrdered();
  const tried = rows.filter((r) => {
    if (r.radar_only === true) return false;
    const rt = Number(r.rating);
    return Number.isFinite(rt) && rt > 0;
  });

  const uids = [...new Set(tried.map((p) => String(p.user_id)))];
  const { data: profs } =
    uids.length > 0
      ? await supabase.from('profiles').select('id, username, avatar_color').in('id', uids)
      : { data: [] as FeedProfile[] };
  const byId = new Map<string, FeedProfile>(
    (profs ?? []).map((p: FeedProfile) => [String(p.id), p])
  );

  const out: FollowingActivityRow[] = [];
  const seenPost = new Set<string>();
  for (const p of tried) {
    const id = String(p.id);
    if (seenPost.has(id)) continue;
    seenPost.add(id);
    const uid = String(p.user_id);
    const prof = byId.get(uid);
    out.push({
      postId: id,
      userId: uid,
      username: prof?.username ?? 'unknown',
      avatarColor: prof?.avatar_color ?? null,
      item: String(p.item ?? ''),
      brand: String(p.product_brand ?? ''),
      store: String(p.store ?? ''),
      category: String(p.category ?? 'Snacks'),
      rating: Number(p.rating) || 0,
      createdAt: String(p.created_at ?? ''),
      macros: normalizeMacros(p.macros),
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Notifications (activity on your account) ─────────────────────────────────

export type ActivityNotification = {
  id: string;
  kind: 'like' | 'comment' | 'follow';
  createdAt: string;
  actorUsername: string;
  actorAvatar: string | null;
  postId?: string;
  postItemPreview?: string;
  bodyPreview?: string;
};

function pickActorMap(rows: { id: string; username: string | null; avatar_color: string | null }[]) {
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
              .select('id, username, avatar_color')
              .in('id', actorIds)
          : { data: [] };
      const actorById = pickActorMap((actors ?? []) as { id: string; username: string | null; avatar_color: string | null }[]);
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
          postId: pid,
          postItemPreview: postMeta.get(pid),
        });
      }
    }
  }

  // — Comments on my posts
  if (postIds.length > 0) {
    const { data: commentRows, error: cErr } = await supabase
      .from('comments')
      .select('id, user_id, post_id, content, created_at')
      .in('post_id', postIds)
      .order('created_at', { ascending: false })
      .limit(120);
    if (!cErr && commentRows?.length) {
      const others = commentRows.filter((c: { user_id: string }) => String(c.user_id) !== userId);
      const actorIds = [...new Set(others.map((c: { user_id: string }) => String(c.user_id)))];
      const { data: actors } =
        actorIds.length > 0
          ? await supabase
              .from('profiles')
              .select('id, username, avatar_color')
              .in('id', actorIds)
          : { data: [] };
      const actorById = pickActorMap((actors ?? []) as { id: string; username: string | null; avatar_color: string | null }[]);
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
          postId: pid,
          postItemPreview: postMeta.get(pid),
          bodyPreview: snippet || undefined,
        });
      }
    }
  }

  // — New followers (follows_by_username.following_username matches my handle)
  const tryFollowsWithTs = await supabase
    .from('follows_by_username')
    .select('follower_id, created_at')
    .eq('following_username', uname);
  let followRows: { follower_id: string; created_at?: string | null }[] = [];
  if (!tryFollowsWithTs.error && tryFollowsWithTs.data) {
    followRows = tryFollowsWithTs.data as { follower_id: string; created_at?: string | null }[];
  } else {
    const try2 = await supabase
      .from('follows_by_username')
      .select('follower_id')
      .eq('following_username', uname);
    if (!try2.error && try2.data) {
      followRows = (try2.data as { follower_id: string }[]).map((f) => ({
        ...f,
        created_at: null,
      }));
    }
  }
  if (followRows.length > 0) {
    const fids = [...new Set((followRows as { follower_id: string }[]).map((f) => String(f.follower_id)))];
    const { data: actors } =
      fids.length > 0
        ? await supabase.from('profiles').select('id, username, avatar_color').in('id', fids)
        : { data: [] };
    const actorById = pickActorMap((actors ?? []) as { id: string; username: string | null; avatar_color: string | null }[]);
    for (const f of followRows as { follower_id: string; created_at?: string | null }[]) {
      if (String(f.follower_id) === userId) continue;
      const aid = String(f.follower_id);
      const a = actorById.get(aid);
      const ts = f.created_at ? String(f.created_at) : '1970-01-01T00:00:00.001Z';
      notices.push({
        id: `follow-${aid}-${ts}`,
        kind: 'follow',
        createdAt: ts,
        actorUsername: a?.username ?? 'someone',
        actorAvatar: a?.avatar_color ?? null,
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
};

/** Stable composite key — mirrors the web `rankKeyPair`. */
export function rankKeyPair(itemName: string | null | undefined, store: string | null | undefined): string {
  const n = (itemName ?? '').trim().toLowerCase();
  const s = (store ?? '').trim().toLowerCase();
  return `${n}::${s}`;
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

const WANT_TO_TRY_UPSERT_OPTIONAL_COLUMNS = new Set(['radar_post_id', 'product_brand']);

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

// ─── Posts (ranked items) ─────────────────────────────────────────────────────

export type CreatePostArgs = {
  userId: string;
  item: string;
  descriptionKey?: string;
  store: string;
  stores?: string[];
  productBrand?: string;
  category: string;
  emoji?: string;
  note?: string;
  rating: number;
  rankPosition?: number;
  dietTags?: string[];
  macros?: Record<string, unknown> | null;
  vibe?: Vibe;
  photoUrls?: string[];
  radarOnly?: boolean;
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
]);

/** Supabase Storage public bucket; URLs are stored on `posts.photo_urls` (same as web). */
export const POST_PHOTOS_BUCKET = 'post-photos';

export type LocalPostPhotoAsset = {
  uri: string;
  mimeType?: string | null;
  /** From `expo-image-picker` with `base64: true` — avoids `fetch(ph://…)` failing on iOS. */
  base64?: string | null;
};

function fileExtFromMime(mime: string | undefined): string {
  const m = String(mime ?? '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  return 'jpg';
}

/**
 * Upload images from device local URIs (e.g. expo-image-picker) — returns public URLs in order.
 */
export async function uploadPostPhotoLocalAssets(
  userId: string,
  postId: string | number,
  assets: LocalPostPhotoAsset[]
): Promise<string[]> {
  const out: string[] = [];
  const uid = String(userId ?? '').trim();
  const pid = String(postId ?? '').trim();
  if (!uid || !pid || !assets.length) return out;

  let idx = 0;
  for (const asset of assets) {
    const uri = String(asset.uri ?? '').trim();
    if (!uri) continue;
    const ext = fileExtFromMime(asset.mimeType ?? undefined);
    const path = `${uid}/${pid}/${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 9)}.${ext}`;

    let contentType =
      (asset.mimeType && String(asset.mimeType).trim()) ||
      (ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg');

    let blob: Blob;
    const b64 = asset.base64 != null ? String(asset.base64).trim() : '';
    if (b64.length > 0) {
      const dataUrl = `data:${contentType};base64,${b64}`;
      const r64 = await fetch(dataUrl);
      if (!r64.ok) {
        throw new Error('Could not decode the selected image. Try another photo.');
      }
      blob = await r64.blob();
    } else {
      const response = await fetch(uri);
      if (!response.ok) {
        throw new Error(
          'Could not read the selected image from your library. Try picking the photo again, or take a new picture with the camera.'
        );
      }
      blob = await response.blob();
      const bt = blob.type && String(blob.type).trim();
      if (bt && bt.startsWith('image/')) contentType = bt;
    }
    if (!blob || blob.size < 32) {
      throw new Error('That image file looks empty. Try a different photo.');
    }
    if (!contentType.startsWith('image/')) {
      contentType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    }

    const { error } = await supabase.storage.from(POST_PHOTOS_BUCKET).upload(path, blob, {
      cacheControl: '3600',
      upsert: false,
      contentType,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(POST_PHOTOS_BUCKET).getPublicUrl(path);
    if (data?.publicUrl) out.push(data.publicUrl);
    idx += 1;
  }
  return out;
}

export async function setPostPhotoUrlsForUserPost(
  userId: string,
  postId: string | number,
  urls: string[]
): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .update({ photo_urls: urls })
    .eq('id', postId)
    .eq('user_id', userId);
  if (error) throw error;
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
  const stores = Array.from(new Set((args.stores ?? []).map((s) => String(s ?? '').trim()).filter(Boolean)));
  const explicitStore = String(args.store ?? '').trim();
  const primaryStore = stores[0] ?? explicitStore;
  const safeRating = Number.isFinite(args.rating) ? args.rating : 10;
  const rp = parseInt(String(args.rankPosition ?? 1), 10);
  const safeRank = Number.isFinite(rp) && rp > 0 ? rp : 1;

  const basePayload = omitUndefined<Record<string, unknown>>({
    user_id: args.userId,
    item: itemText,
    description_key:
      String(args.descriptionKey ?? '').trim().toLowerCase() || itemText.toLowerCase(),
    store: primaryStore,
    stores: stores.length > 0 ? stores : primaryStore ? [primaryStore] : [],
    product_brand: args.productBrand ?? '',
    category: String(args.category ?? '').trim() || 'Snacks',
    emoji: args.emoji ?? '',
    note: args.note ?? '',
    rating: safeRating,
    rank_position: safeRank,
    diet_tags: Array.isArray(args.dietTags) ? args.dietTags.filter(Boolean) : [],
    macros: args.macros ?? null,
    vibe: args.vibe === 'liked' || args.vibe === 'fine' || args.vibe === 'meh' ? args.vibe : 'fine',
    photo_urls: Array.isArray(args.photoUrls) ? args.photoUrls.filter(Boolean) : [],
    radar_only: args.radarOnly ? true : undefined,
  });

  const insertWithFallback = async (
    payload: Record<string, unknown>
  ): Promise<
    | { ok: true; id: string | number | null }
    | { ok: false; error: { code?: string; message?: string; details?: unknown } }
  > => {
    let current = { ...payload };
    for (let i = 0; i < 5; i += 1) {
      const { data, error } = await supabase.from('posts').insert(current).select('id');
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
  if (result.id != null) return { id: result.id };

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
    if (row?.id != null) return { id: row.id as string | number };
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
    emoji?: string;
    note?: string;
    rating: number;
    rankPosition: number;
    dietTags?: string[];
    macros?: Record<string, unknown> | null;
    vibe?: Vibe;
    radarOnly?: boolean;
  }
): Promise<void> {
  const itemText = String(args.item ?? '').trim();
  if (!itemText) {
    const err = new Error('Post item name is required') as Error & { code?: string };
    err.code = 'empty_item';
    throw err;
  }
  const stores = Array.from(new Set((args.stores ?? []).map((s) => String(s ?? '').trim()).filter(Boolean)));
  const explicitStore = String(args.store ?? '').trim();
  const primaryStore = stores[0] ?? explicitStore;
  const safeRating = Number.isFinite(args.rating) ? args.rating : 10;
  const rp = parseInt(String(args.rankPosition ?? 1), 10);
  const safeRank = Number.isFinite(rp) && rp > 0 ? rp : 1;

  const payload = omitUndefined<Record<string, unknown>>({
    item: itemText,
    description_key:
      String(args.descriptionKey ?? '').trim().toLowerCase() || itemText.toLowerCase(),
    store: primaryStore,
    stores: stores.length > 0 ? stores : primaryStore ? [primaryStore] : [],
    product_brand: args.productBrand ?? '',
    category: String(args.category ?? '').trim() || 'Snacks',
    emoji: args.emoji ?? '',
    note: args.note ?? '',
    rating: safeRating,
    rank_position: safeRank,
    diet_tags: Array.isArray(args.dietTags) ? args.dietTags.filter(Boolean) : [],
    macros: args.macros ?? null,
    vibe: args.vibe === 'liked' || args.vibe === 'fine' || args.vibe === 'meh' ? args.vibe : 'fine',
    radar_only: args.radarOnly ? true : false,
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
    if (/updated_at|schema cache/i.test(msg)) return;
    throw res.error;
  }
}

/** After reranking, push new `rating` / `rank_position` to other posts in the same category (excluding `skipPostId`). */
export async function syncPeerPostRanks(
  userId: string,
  peers: { id: string | number; rating: number; rankPosition: number }[],
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
  rating: number | null;
  note: string | null;
  vibe: string | null;
  diet_tags: string[] | null;
  macros: Record<string, unknown> | null;
  photo_urls: string[] | null;
  radar_only: boolean | null;
  rank_position: number | null;
  created_at: string | null;
  updated_at?: string | null;
};

/**
 * Loads a user's ranked posts. Falls back through ordering attempts the same
 * way the web app does, then dedupes posts that collide on (item, store) so
 * we don't show the same product twice.
 */
export async function getUserRankings(userId: string): Promise<RankedPostRow[]> {
  if (!userId) return [];
  const attempts = [
    () =>
      supabase.from('posts').select('*').eq('user_id', userId).order('rank_position', { ascending: true }),
    () =>
      supabase.from('posts').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    () => supabase.from('posts').select('*').eq('user_id', userId),
  ];
  for (const run of attempts) {
    const { data, error } = await run();
    if (!error) {
      return dedupePostsByRankKey((data ?? []) as RankedPostRow[]).map((r) => ({
        ...r,
        photo_urls: normalizePhotoUrls(r.photo_urls),
      }));
    }
  }
  return [];
}

function dedupePostsByRankKey(rows: RankedPostRow[]): RankedPostRow[] {
  const best = new Map<string, RankedPostRow>();
  const activityMs = (r: RankedPostRow) =>
    Math.max(
      r.updated_at ? new Date(r.updated_at).getTime() : 0,
      new Date(r.created_at ?? 0).getTime()
    );
  const betterRankDup = (next: RankedPostRow, prev: RankedPostRow) => {
    const np = normalizePhotoUrls(next.photo_urls).length;
    const pp = normalizePhotoUrls(prev.photo_urls).length;
    if (np !== pp) return np > pp;
    const na = activityMs(next);
    const pa = activityMs(prev);
    if (na !== pa) return na > pa;
    return (Number(next.id) || 0) > (Number(prev.id) || 0);
  };
  for (const row of rows) {
    const stores = Array.isArray(row.stores) && row.stores.length > 0 ? row.stores : row.store ? [row.store] : [];
    const primary = stores[0] ?? '';
    const key = rankKeyPair(row.item, primary);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, row);
      continue;
    }
    if (betterRankDup(row, prev)) best.set(key, row);
  }
  return Array.from(best.values());
}

/** True for radar / want-to-try DB rows that have no real score yet. */
export function isRadarOnlyDbRow(row: { radar_only?: boolean | null; rating?: number | null }): boolean {
  if (row.radar_only === true) return true;
  const r = Number(row.rating);
  return !Number.isFinite(r) || r <= 0;
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export type CommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  parent_comment_id: string | null;
  created_at: string;
  profile: { username: string | null; avatar_color: string | null } | null;
};

export async function fetchCommentsForPost(postId: string | number): Promise<CommentRow[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*, profile:user_id (username, avatar_color)')
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
    .select('*, profile:user_id (username, avatar_color)')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error('Comment was created but could not be retrieved.');
  }
  return data as CommentRow;
}

// ─── Profiles + follows ───────────────────────────────────────────────────────

export type ProfileRow = {
  id: string;
  username: string;
  bio: string | null;
  avatar_color: string | null;
};

export async function fetchProfileByUsername(username: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, bio, avatar_color')
    .eq('username', username)
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

export async function fetchProfileById(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, bio, avatar_color')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

export async function fetchFollowerFollowingCounts(args: {
  username: string;
  userId: string;
}): Promise<{ followers: number; following: number }> {
  const [followersRes, followingRes] = await Promise.all([
    supabase
      .from('follows_by_username')
      .select('*', { count: 'exact', head: true })
      .eq('following_username', args.username),
    supabase
      .from('follows_by_username')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', args.userId),
  ]);
  return {
    followers: followersRes.count ?? 0,
    following: followingRes.count ?? 0,
  };
}

/**
 * Whether `viewerId` follows `username`. Mirrors the web's `follows_by_username`
 * lookup.
 */
export async function viewerFollowsUsername(viewerId: string, username: string): Promise<boolean> {
  if (!viewerId || !username) return false;
  const { data, error } = await supabase
    .from('follows_by_username')
    .select('follower_id')
    .eq('follower_id', viewerId)
    .eq('following_username', username)
    .maybeSingle();
  if (error) {
    console.warn('viewerFollowsUsername:', error.message);
    return false;
  }
  return Boolean(data);
}

export async function followUsername(viewerId: string, username: string): Promise<void> {
  const { error } = await supabase
    .from('follows_by_username')
    .insert({ follower_id: viewerId, following_username: username });
  if (error && error.code !== '23505') throw error;
}

export async function unfollowUsername(viewerId: string, username: string): Promise<void> {
  const { error } = await supabase
    .from('follows_by_username')
    .delete()
    .eq('follower_id', viewerId)
    .eq('following_username', username);
  if (error) throw error;
}

export type ConnectionRow = { username: string; avatarColor: string | null };

/**
 * Users who follow `username` (profile handle). Mirrors web ProfilePage followers query.
 */
export async function fetchFollowersForProfileUsername(username: string): Promise<ConnectionRow[]> {
  const handle = String(username ?? '').trim();
  if (!handle) return [];
  const { data, error } = await supabase
    .from('follows_by_username')
    .select('follower_id, profile:follower_id (username, avatar_color)')
    .eq('following_username', handle);
  if (error) {
    console.warn('fetchFollowersForProfileUsername:', error.message);
    return [];
  }
  type Prof = { username: string | null; avatar_color: string | null };
  type RawRow = { profile: Prof | Prof[] | null };
  const raw = ((data ?? []) as unknown as RawRow[]) ?? [];
  return raw
    .map((row) => {
      const p = row.profile;
      const prof = Array.isArray(p) ? p[0] : p;
      return {
        username: String(prof?.username ?? '').trim(),
        avatarColor: prof?.avatar_color ?? null,
      };
    })
    .filter((r) => r.username.length > 0);
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
  const names = [...new Set((follows ?? []).map((f: { following_username: string }) => f.following_username).filter(Boolean))] as string[];
  if (names.length === 0) return [];
  const { data: profs, error: pErr } = await supabase
    .from('profiles')
    .select('username, avatar_color')
    .in('username', names);
  if (pErr) {
    console.warn('fetchFollowingForProfileUserId profiles:', pErr.message);
    return names.map((n) => ({ username: n, avatarColor: null }));
  }
  const byName = Object.fromEntries(
    (profs ?? []).map((p: { username: string; avatar_color: string | null }) => [p.username, p.avatar_color])
  );
  return names.map((n) => ({ username: n, avatarColor: (byName[n] as string | null | undefined) ?? null }));
}

// ─── Search API (Vercel) ──────────────────────────────────────────────────────

const SEARCH_API_URL = 'https://bagged.vercel.app/api/search';

export type SearchProductRow = {
  description: string;
  /** Stable key from curated_products / posts when available */
  descriptionKey?: string | null;
  brandName: string;
  brandOwner: string;
  foodCategory: string;
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

function macroIntSearch(v: unknown, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
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
  const cal = macroIntSearch(row.cal);
  const protein = macroIntSearch(row.protein);
  const carbs = macroIntSearch(row.carbs);
  const fat = macroIntSearch(row.fat);
  const brand = sanitizeCuratedTextField(row.brand);
  const category = sanitizeCuratedTextField(row.category) || 'Snacks';
  const rawDesc = String(row.description ?? '').trim();
  const description =
    sanitizeCuratedTextField(row.description) ||
    (rawDesc && !/^(null|undefined)$/i.test(rawDesc) ? rawDesc : '');
  const dkRaw = row.description_key != null ? String(row.description_key).trim() : '';
  const descriptionKey = dkRaw || normalizedDescriptionKeyFromItem(description);

  return {
    description,
    descriptionKey,
    brandName: brand,
    brandOwner: brand,
    foodCategory: category,
    isCurated: true,
    fatSecretId: null,
    cal,
    protein,
    carbs,
    fat,
  };
}

/** Official curated products table — same ILIKE strategy as the web app. */
export async function fetchCuratedProductsForSearch(query: string): Promise<SearchProductRow[]> {
  const phrases = curatedSearchPhrases(query);
  if (phrases.length === 0) return [];

  const rowsByKey = new Map<string, CuratedProductRow>();

  for (const phrase of phrases) {
    const safe = phrase.replace(/,/g, ' ');
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
        cal: typeof r.cal === 'number' ? r.cal : null,
        protein: typeof r.protein === 'number' ? r.protein : null,
        carbs: typeof r.carbs === 'number' ? r.carbs : null,
        fat: typeof r.fat === 'number' ? r.fat : null,
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
  return [row.cal, row.protein, row.carbs, row.fat].some(
    (v) => typeof v === 'number' && Number.isFinite(v)
  );
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

// ─── Macros (post.macros JSON) ────────────────────────────────────────────────

export type PostMacros = {
  cal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  servingLabel?: string | null;
};

export function macrosHaveAnyValue(m: unknown): m is PostMacros {
  if (!m || typeof m !== 'object') return false;
  const keys: (keyof PostMacros)[] = ['cal', 'protein', 'carbs', 'fat'];
  return keys.some((k) => {
    const raw = (m as Record<string, unknown>)[k];
    if (raw === '' || raw == null) return false;
    return Number.isFinite(Number(raw));
  });
}

/** Coerce a macros payload to numbers (or null) for display. */
export function normalizeMacros(m: unknown): PostMacros | null {
  if (!macrosHaveAnyValue(m)) return null;
  const num = (v: unknown): number | null => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const r = m as Record<string, unknown>;
  return {
    cal: num(r.cal),
    protein: num(r.protein),
    carbs: num(r.carbs),
    fat: num(r.fat),
    servingLabel:
      typeof r.servingLabel === 'string' && r.servingLabel.trim() ? r.servingLabel.trim() : null,
  };
}

/** Rate-screen nutrition step — string fields bound to `TextInput`s */
export type RateMacroFormState = {
  cal: string;
  protein: string;
  carbs: string;
  fat: string;
  servingLabel: string;
};

export function rateMacroFormFromNumbers(args: {
  cal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  servingLabel?: string | null;
}): RateMacroFormState {
  const str = (n: number | null | undefined) =>
    n != null && Number.isFinite(Number(n)) ? String(Math.round(Number(n))) : '';
  return {
    cal: str(args.cal),
    protein: str(args.protein),
    carbs: str(args.carbs),
    fat: str(args.fat),
    servingLabel: String(args.servingLabel ?? '').trim(),
  };
}

export function rateMacroFormHasAny(f: RateMacroFormState): boolean {
  return !!(f.cal || f.protein || f.carbs || f.fat || f.servingLabel);
}

/** Fill only blank fields in `base` from `fill` (e.g. curated first, then FatSecret/API). */
export function mergeRateMacroFormFillEmpty(
  base: RateMacroFormState,
  fill: RateMacroFormState
): RateMacroFormState {
  return {
    cal: base.cal || fill.cal,
    protein: base.protein || fill.protein,
    carbs: base.carbs || fill.carbs,
    fat: base.fat || fill.fat,
    servingLabel: base.servingLabel || fill.servingLabel,
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
  rankerCount: number;
  avgRating: number;
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

function normalizeStoreList(
  stores: string[] | null | undefined,
  fallback: string | null | undefined
): string[] {
  const list = Array.isArray(stores) ? stores.filter(Boolean) : [];
  if (list.length > 0) return list;
  return fallback ? [fallback] : [];
}

function discoverItemKey(row: { item?: string | null; description_key?: string | null }): string {
  const fromKey = String(row.description_key ?? '').trim().toLowerCase();
  if (fromKey) return fromKey;
  return String(row.item ?? '').trim().toLowerCase();
}

function discoverRowMatchesDietTag(dietTags: string[] | null | undefined, dietFilter: string): boolean {
  const want = String(dietFilter ?? '').trim();
  if (!want) return true;
  return Array.isArray(dietTags) && dietTags.includes(want);
}

export type DiscoverExploreRow = {
  description: string;
  descriptionKey: string;
  brandOwner: string;
  brandName: string;
  foodCategory: string;
  store: string;
  stores: string[];
  cal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  servingLabel: string | null;
  dietTags: string[];
  nutritionVerification: 'verified' | 'unverified';
};

function mapCuratedRecordToExploreRow(row: Record<string, unknown>): DiscoverExploreRow {
  const description = String(row.description ?? '').trim();
  const stores = normalizeStoreList(
    (row.stores as string[] | null) ?? null,
    (row.store as string | null) ?? null
  );
  const brand =
    String(row.brand ?? row.brand_owner ?? row.brandOwner ?? '').trim() ||
    String(row.brand_name ?? row.brandName ?? '').trim();
  const vRaw = row.nutrition_verification_state ?? row.nutritionVerification;
  const nutritionVerification = vRaw === 'verified' ? 'verified' : 'unverified';
  return {
    description,
    descriptionKey:
      String(row.description_key ?? '').trim().toLowerCase() || normalizedDescriptionKeyFromItem(description),
    brandOwner: brand,
    brandName: brand,
    foodCategory: String(row.category ?? row.food_category ?? row.foodCategory ?? 'Snacks').trim() || 'Snacks',
    store: stores[0] ?? '',
    stores,
    cal: typeof row.cal === 'number' ? (row.cal as number) : null,
    protein: typeof row.protein === 'number' ? (row.protein as number) : null,
    carbs: typeof row.carbs === 'number' ? (row.carbs as number) : null,
    fat: typeof row.fat === 'number' ? (row.fat as number) : null,
    servingLabel:
      typeof row.serving_label === 'string'
        ? row.serving_label.trim() || null
        : typeof row.servingLabel === 'string'
          ? (row.servingLabel as string).trim() || null
          : null,
    dietTags: Array.isArray(row.diet_tags) ? (row.diet_tags as string[]) : [],
    nutritionVerification,
  };
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

  /** Request enough rows before `.slice(0, limit)` so store/diet/category filters still fill the cap */
  const fetchCap = Math.min(Math.max(limit * 2, 120), 1000);
  let req = supabase.from('curated_products').select('*').limit(fetchCap);
  if (dietFilter) req = req.contains('diet_tags', [dietFilter]);
  if (storeFilter) req = req.contains('stores', [storeFilter]);
  if (categoryFilter) req = req.eq('category', categoryFilter);
  if (q.length >= 2) {
    const safe = q.replace(/,/g, ' ');
    req = req.or(`description.ilike.%${safe}%,brand.ilike.%${safe}%`);
  }

  const { data, error } = await req;
  if (error) {
    console.warn('fetchDiscoverExploreCurated:', error.message);
    return [];
  }
  return (data ?? []).slice(0, limit).map((r) => mapCuratedRecordToExploreRow(r as Record<string, unknown>));
}

export async function fetchDiscoverTrendingThisWeek(args: {
  limit?: number;
  store?: string;
  dietTag?: string;
} = {}): Promise<DiscoverTrendingRow[]> {
  const limit = args.limit ?? 12;
  const storeFilter = discoverNormalizeStore(args.store ?? '');
  const dietFilter = String(args.dietTag ?? '').trim();
  const since = new Date(
    Date.now() - DEFAULT_DISCOVER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from('posts')
    .select(
      'id, user_id, item, description_key, store, stores, category, product_brand, rating, radar_only, created_at, emoji, macros, diet_tags'
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) {
    console.warn('fetchDiscoverTrendingThisWeek:', error.message);
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
    userIds: Set<string>;
    sumRating: number;
    countRating: number;
  };

  const byKey = new Map<string, Bucket>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (row.radar_only === true) continue;
    const r = Number(row.rating);
    if (!Number.isFinite(r) || r <= 0) continue;
    const stores = normalizeStoreList(
      row.stores as string[] | null,
      (row.store as string | null) ?? null
    );
    if (storeFilter) {
      const want = storeFilter.toLowerCase();
      if (!stores.some((s) => s.trim().toLowerCase() === want)) continue;
    }
    if (!discoverRowMatchesDietTag(row.diet_tags as string[] | null, dietFilter)) continue;
    const key = discoverItemKey({
      item: (row.item as string | null) ?? null,
      description_key: (row.description_key as string | null) ?? null,
    });
    if (!key) continue;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        item: String(row.item ?? ''),
        store: String(row.store ?? '') || stores[0] || '',
        stores: [...stores],
        category: String(row.category ?? '') || 'Snacks',
        productBrand: String(row.product_brand ?? ''),
        emoji: String(row.emoji ?? ''),
        dietTags: Array.isArray(row.diet_tags) ? [...(row.diet_tags as string[])] : [],
        macros: normalizeMacros(row.macros) ?? null,
        userIds: new Set(),
        sumRating: 0,
        countRating: 0,
      };
      byKey.set(key, g);
    }
    g.userIds.add(String(row.user_id));
    g.sumRating += r;
    g.countRating += 1;
    for (const s of stores) {
      if (s && !g.stores.includes(s)) g.stores.push(s);
    }
  }

  return Array.from(byKey.values())
    .map((g) => ({
      key: g.key,
      item: g.item,
      brand: g.productBrand,
      store: g.store,
      stores: g.stores,
      category: g.category,
      emoji: g.emoji,
      dietTags: g.dietTags,
      macros: g.macros,
      rankerCount: g.userIds.size,
      avgRating: g.countRating > 0 ? g.sumRating / g.countRating : 0,
    }))
    .sort((a, b) => {
      if (b.rankerCount !== a.rankerCount) return b.rankerCount - a.rankerCount;
      if (b.avgRating !== a.avgRating) return b.avgRating - a.avgRating;
      return 0;
    })
    .slice(0, limit);
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
    const stores = normalizeStoreList(
      (row.stores as string[] | null) ?? null,
      (row.store as string | null) ?? null
    );
    if (storeFilter) {
      const want = storeFilter.toLowerCase();
      if (!stores.some((s) => s.trim().toLowerCase() === want)) continue;
    }
    const key = String(row.item ?? '').trim().toLowerCase();
    if (!key) continue;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        item: String(row.item ?? ''),
        store: String(row.store ?? '') || stores[0] || '',
        stores: [...stores],
        category: String(row.category ?? '') || 'Snacks',
        emoji: String(row.emoji ?? ''),
        brand: String(row.product_brand ?? ''),
        userIds: new Set(),
      };
      byKey.set(key, g);
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
} = {}): Promise<DiscoverNewReleaseRow[]> {
  const limit = args.limit ?? 12;
  const storeFilter = discoverNormalizeStore(args.store ?? '');
  const dietFilter = String(args.dietTag ?? '').trim();
  const overfetch = Math.max(limit * 3, 24);
  const { data, error } = await supabase
    .from('curated_products')
    .select('*')
    .eq('is_new_release', true)
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
      const list = normalizeStoreList(
        (row.stores as string[] | null) ?? null,
        (row.store as string | null) ?? null
      );
      if (!list.some((s) => s.trim().toLowerCase() === storeFilter.toLowerCase())) return false;
    }
    if (!discoverRowMatchesDietTag(row.diet_tags as string[] | null, dietFilter)) return false;
    if (!curatedNewReleaseWithinRetentionWindow(row)) return false;
    return true;
  });
  return filtered.slice(0, limit).map((row) => {
    const description = String(row.description ?? '');
    const stores = normalizeStoreList(
      (row.stores as string[] | null) ?? null,
      (row.store as string | null) ?? null
    );
    const brand =
      String(row.brand ?? '').trim() ||
      String(row.brand_owner ?? row.brandOwner ?? '').trim() ||
      String(row.brand_name ?? row.brandName ?? '').trim();
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
    };
  });
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export type LeaderboardRow = {
  userId: string;
  username: string;
  avatarColor: string | null;
  rankedCount: number;
  rank: number;
};

/**
 * Mirror of the web `fetchLeaderboardByRankedCount`. Counts distinct
 * (item, primary store) pairs per user (excludes radar-only with no rating).
 */
export async function fetchLeaderboardByRankedCount(limit?: number): Promise<LeaderboardRow[]> {
  const { data: postRows, error: postErr } = await supabase
    .from('posts')
    .select('user_id, item, store, stores, product_brand, radar_only, rating');
  if (postErr) throw postErr;

  const countsByUserId = new Map<string, number>();
  const seenByUser = new Map<string, Set<string>>();
  for (const row of (postRows ?? []) as Array<Record<string, unknown>>) {
    const uid = row.user_id as string | null;
    if (!uid) continue;
    if (row.radar_only === true) {
      const r = Number(row.rating);
      if (!Number.isFinite(r) || r <= 0) continue;
    }
    const stores = normalizeStoreList(
      (row.stores as string[] | null) ?? null,
      (row.store as string | null) ?? null
    );
    const primary = stores[0] ?? '';
    const key = `${String(row.item ?? '').trim().toLowerCase()}::${primary.trim().toLowerCase()}`;
    if (!key) continue;
    let seen = seenByUser.get(uid);
    if (!seen) {
      seen = new Set();
      seenByUser.set(uid, seen);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    countsByUserId.set(uid, (countsByUserId.get(uid) ?? 0) + 1);
  }

  const userIds = Array.from(countsByUserId.keys());
  if (userIds.length === 0) return [];

  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, username, avatar_color')
    .in('id', userIds);
  if (profErr) throw profErr;
  const profileById = new Map(
    (profiles ?? []).map((p: { id: string; username: string | null; avatar_color: string | null }) => [p.id, p])
  );

  const list: LeaderboardRow[] = userIds
    .map((id) => ({
      userId: id,
      username: profileById.get(id)?.username ?? 'unknown',
      avatarColor: profileById.get(id)?.avatar_color ?? null,
      rankedCount: countsByUserId.get(id) ?? 0,
      rank: 0,
    }))
    .sort((a, b) => {
      if (b.rankedCount !== a.rankedCount) return b.rankedCount - a.rankedCount;
      return a.username.localeCompare(b.username);
    })
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  if (typeof limit === 'number' && Number.isFinite(limit)) {
    return list.slice(0, Math.max(1, limit));
  }
  return list;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationRow = {
  id: string;
  kind: 'like' | 'comment' | 'comment_reply' | 'follow';
  createdAt: string | null;
  actorUsername: string;
  actorAvatarColor: string | null;
  text: string;
  preview?: string | null;
  postId?: string | null;
};

/**
 * Builds a unified notification feed for the current user from likes,
 * comments, comment replies, and new followers — sorted newest first. Mirrors
 * the web's `loadNotifications` queries (minus the "overlap" extra path,
 * which fires off enough requests to deserve its own toggle on mobile).
 */
export async function fetchNotificationsForUser(args: {
  userId: string;
  username: string;
}): Promise<NotificationRow[]> {
  const me = args.userId;
  const username = args.username;
  if (!me) return [];

  // 1) My posts (used to label like/comment notifications).
  const { data: myPosts } = await supabase
    .from('posts')
    .select('id, item, created_at')
    .eq('user_id', me);
  const myPostsList = ((myPosts as { id: string | number; item: string }[] | null) ?? []);
  const myPostIds = myPostsList.map((p) => p.id);
  const myPostsById = new Map(myPostsList.map((p) => [String(p.id), p]));

  const [likesRes, commentsRes, myCommentsIdsRes] = await Promise.all([
    myPostIds.length > 0
      ? supabase
          .from('likes')
          .select('post_id, user_id, created_at, profile:user_id (username, avatar_color)')
          .in('post_id', myPostIds)
          .neq('user_id', me)
      : Promise.resolve({ data: [], error: null }),
    myPostIds.length > 0
      ? supabase
          .from('comments')
          .select('id, post_id, user_id, created_at, content, profile:user_id (username, avatar_color)')
          .in('post_id', myPostIds)
          .is('parent_comment_id', null)
          .neq('user_id', me)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('comments').select('id').eq('user_id', me),
  ]);

  // 2) Replies to my comments.
  const myCommentIds = ((myCommentsIdsRes.data as { id: string }[] | null) ?? [])
    .map((c) => c.id)
    .filter(Boolean);
  let replyData: Array<Record<string, unknown>> = [];
  if (myCommentIds.length > 0) {
    const { data } = await supabase
      .from('comments')
      .select('id, post_id, user_id, created_at, content, parent_comment_id, profile:user_id (username, avatar_color)')
      .in('parent_comment_id', myCommentIds)
      .neq('user_id', me);
    replyData = ((data as Array<Record<string, unknown>>) ?? []);
  }

  // 3) New followers.
  let followsData: Array<Record<string, unknown>> = [];
  if (username) {
    const { data } = await supabase
      .from('follows_by_username')
      .select('follower_id, created_at, profile:follower_id (username, avatar_color)')
      .eq('following_username', username)
      .neq('follower_id', me)
      .order('created_at', { ascending: false })
      .limit(100);
    followsData = ((data as Array<Record<string, unknown>>) ?? []);
  }

  type ProfilePartial = { username?: string | null; avatar_color?: string | null } | null;

  const likeNotifications: NotificationRow[] = (
    (likesRes.data as Array<Record<string, unknown>> | null) ?? []
  ).flatMap((l) => {
    const post = myPostsById.get(String(l.post_id));
    if (!post) return [];
    const profile = (l.profile as ProfilePartial) ?? null;
    const actor = profile?.username ?? 'someone';
    return [
      {
        id: `like-${String(l.post_id)}-${String(l.user_id)}-${String(l.created_at ?? '')}`,
        kind: 'like' as const,
        createdAt: (l.created_at as string | null) ?? null,
        actorUsername: actor,
        actorAvatarColor: profile?.avatar_color ?? null,
        text: `liked your ranking of ${post.item}`,
        postId: String(l.post_id),
      },
    ];
  });

  const commentNotifications: NotificationRow[] = (
    (commentsRes.data as Array<Record<string, unknown>> | null) ?? []
  ).flatMap((c) => {
    const post = myPostsById.get(String(c.post_id));
    if (!post) return [];
    const profile = (c.profile as ProfilePartial) ?? null;
    const actor = profile?.username ?? 'someone';
    const preview = String(c.content ?? '').trim().replace(/\s+/g, ' ').slice(0, 280);
    return [
      {
        id: `comment-${String(c.id)}`,
        kind: 'comment' as const,
        createdAt: (c.created_at as string | null) ?? null,
        actorUsername: actor,
        actorAvatarColor: profile?.avatar_color ?? null,
        text: `commented on your ${post.item} ranking`,
        preview,
        postId: String(c.post_id),
      },
    ];
  });

  const replyNotifications: NotificationRow[] = replyData.flatMap((c) => {
    const profile = (c.profile as ProfilePartial) ?? null;
    const actor = profile?.username ?? 'someone';
    const preview = String(c.content ?? '').trim().replace(/\s+/g, ' ').slice(0, 280);
    return [
      {
        id: `comment-reply-${String(c.id)}`,
        kind: 'comment_reply' as const,
        createdAt: (c.created_at as string | null) ?? null,
        actorUsername: actor,
        actorAvatarColor: profile?.avatar_color ?? null,
        text: 'replied to your comment',
        preview,
        postId: c.post_id != null ? String(c.post_id) : null,
      },
    ];
  });

  const followNotifications: NotificationRow[] = followsData.flatMap((f) => {
    const profile = (f.profile as ProfilePartial) ?? null;
    const actor = profile?.username ?? 'someone';
    return [
      {
        id: `follow-${String(f.follower_id)}-${String(f.created_at ?? '')}`,
        kind: 'follow' as const,
        createdAt: (f.created_at as string | null) ?? null,
        actorUsername: actor,
        actorAvatarColor: profile?.avatar_color ?? null,
        text: 'started following you',
      },
    ];
  });

  return [...likeNotifications, ...commentNotifications, ...replyNotifications, ...followNotifications]
    .sort((a, b) => {
      const aTs = new Date(a.createdAt ?? 0).getTime();
      const bTs = new Date(b.createdAt ?? 0).getTime();
      return bTs - aTs;
    })
    .slice(0, 80);
}

// ─── Profile mutations (used by Settings) ─────────────────────────────────────

export async function updateOwnProfile(args: {
  userId: string;
  username?: string;
  bio?: string;
  avatarColor?: string;
}): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (args.username !== undefined) patch.username = args.username;
  if (args.bio !== undefined) patch.bio = args.bio;
  if (args.avatarColor !== undefined) patch.avatar_color = args.avatarColor;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('profiles').update(patch).eq('id', args.userId);
  if (error) throw error;
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
