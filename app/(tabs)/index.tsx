import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedCard, type FeedCardPost } from '@/components/bagged/feed-card';
import {
  ALL_CATEGORIES,
  ALL_STORES,
  FilterBar,
  rowMatchesCategoryFilter,
  rowMatchesDietFilter,
  rowMatchesStoreFilter,
  type FilterCategory,
  type FilterStore,
} from '@/components/bagged/filter-bar';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { primaryGroceryStoreForKey } from '@/constants/grocery';
import {
  addToWantToTry,
  getFeed,
  getUserRankings,
  getWantToTry,
  isRadarOnlyDbRow,
  normalizeMacros,
  normalizePhotoUrls,
  normalizedDescriptionKeyFromItem,
  rankKeyPair,
  removeFromWantToTry,
  toggleLike,
  type FeedPostRow,
} from '@/lib/data';
import { setFeedRefreshListener, takePendingBringToTopPostId } from '@/lib/feed-refresh-poke';
import { storeListForRow } from '@/lib/format';
import { useDisplaySettings } from '@/providers/display-settings-provider';
import { useAuth } from '@/providers/auth-provider';

function feedRowToCardPost(
  row: FeedPostRow,
  viewerId: string,
  wantSet: Set<string>,
  rankedSet: Set<string>
): FeedCardPost {
  const username = row.profile?.username ?? 'unknown';
  const stores = row.stores?.length ? row.stores : row.store ? [row.store] : [];
  const radarOnly = row.radar_only === true;
  const liked = row.likes.some((l) => String(l.user_id) === String(viewerId));
  const photoUrls = normalizePhotoUrls(row.photo_urls);
  const wantToTry = wantSet.has(rankKeyPair(row.item, primaryGroceryStoreForKey(row)));
  const viewerHasRanked = rankedSet.has(rankKeyPair(row.item, primaryGroceryStoreForKey(row)));

  return {
    id: row.id,
    user: username,
    avatar: (username || '?').charAt(0).toUpperCase(),
    avatarColor: row.profile?.avatar_color ?? BaggedColors.accent,
    item: row.item ?? '',
    brand: row.product_brand ?? '',
    store: row.store ?? '',
    stores,
    category: row.category ?? '',
    rating: radarOnly ? null : (row.rating ?? null),
    note: row.note ?? '',
    photoUrls,
    likes: row.likes.length,
    comments: row.commentCount ?? 0,
    liked,
    wantToTry,
    radarOnly,
    createdAt: row.created_at,
    macros: normalizeMacros(row.macros),
    dietTags: Array.isArray(row.diet_tags) ? row.diet_tags : null,
    descriptionKey:
      row.description_key != null && String(row.description_key).trim()
        ? String(row.description_key).trim().toLowerCase()
        : normalizedDescriptionKeyFromItem(row.item ?? ''),
    viewerHasRanked,
  };
}

export default function FeedScreen() {
  const router = useRouter();
  const { userId, session } = useAuth();
  const { showFeedDietBar, showMacroNutrition } = useDisplaySettings();
  const storageImageHeaders = useMemo(
    () =>
      session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    [session?.access_token]
  );
  const [posts, setPosts] = useState<FeedCardPost[]>([]);
  const [wantSet, setWantSet] = useState<Set<string>>(() => new Set());
  const [feedLoading, setFeedLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<FilterStore>(ALL_STORES);
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>(ALL_CATEGORIES);
  const [dietFilter, setDietFilter] = useState<string | null>(null);
  const listRef = useRef<FlatList<FeedCardPost>>(null);

  const filteredPosts = useMemo(
    () =>
      posts.filter(
        (p) =>
          rowMatchesStoreFilter(p, storeFilter) &&
          rowMatchesCategoryFilter(p, categoryFilter) &&
          rowMatchesDietFilter({ diet_tags: p.dietTags ?? null }, dietFilter)
      ),
    [posts, storeFilter, categoryFilter, dietFilter]
  );

  const loadFeed = useCallback(async (uid: string) => {
    setErrorMsg(null);
    try {
      // Run feed + want-to-try in parallel — both are user-scoped and the card
      // needs the want set to compute the active state.
      const [rows, wantRows, rankedRows] = await Promise.all([
        getFeed(uid),
        getWantToTry(uid).catch((err) => {
          console.warn('getWantToTry failed:', err);
          return [];
        }),
        getUserRankings(uid).catch((err) => {
          console.warn('getUserRankings failed:', err);
          return [];
        }),
      ]);
      const nextWantSet = new Set(wantRows.map((w) => rankKeyPair(w.item, w.store)));
      const rankedSet = new Set(
        rankedRows
          .filter((r) => !isRadarOnlyDbRow(r))
          .map((r) => rankKeyPair(r.item, primaryGroceryStoreForKey(r)))
      );
      setWantSet(nextWantSet);
      let cards = rows.map((r) => feedRowToCardPost(r, uid, nextWantSet, rankedSet));
      const pinId = takePendingBringToTopPostId();
      let shouldScrollToTop = false;
      if (pinId) {
        const idx = cards.findIndex((p) => String(p.id) === pinId);
        if (idx > 0) {
          const copy = [...cards];
          const [item] = copy.splice(idx, 1);
          cards = [item, ...copy];
          shouldScrollToTop = true;
        } else if (idx === 0) {
          shouldScrollToTop = true;
        }
      }
      setPosts(cards);
      if (shouldScrollToTop) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not load your feed. Pull to retry.';
      setErrorMsg(message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setPosts([]);
        setWantSet(new Set());
        return undefined;
      }
      let cancelled = false;
      setFeedLoading(true);
      loadFeed(userId).finally(() => {
        if (!cancelled) setFeedLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [userId, loadFeed])
  );

  useEffect(() => {
    if (!userId) {
      setFeedRefreshListener(null);
      return undefined;
    }
    const run = () => {
      void loadFeed(userId);
    };
    setFeedRefreshListener(run);
    return () => setFeedRefreshListener(null);
  }, [userId, loadFeed]);

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    await loadFeed(userId);
    setRefreshing(false);
  }, [userId, loadFeed]);

  const handleLike = useCallback(
    async (post: FeedCardPost) => {
      if (!userId) return;
      const wasLiked = post.liked;
      // Optimistic update — keep response time snappy on a slow network.
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, liked: !wasLiked, likes: Math.max(0, p.likes + (wasLiked ? -1 : 1)) }
            : p
        )
      );
      try {
        await toggleLike(userId, post.id);
      } catch (err) {
        console.warn('toggleLike failed:', err);
        setPosts((prev) =>
          prev.map((p) =>
            p.id === post.id
              ? { ...p, liked: wasLiked, likes: Math.max(0, p.likes + (wasLiked ? 1 : -1)) }
              : p
          )
        );
      }
    },
    [userId]
  );

  const handleWantToTry = useCallback(
    async (post: FeedCardPost) => {
      if (!userId) return;
      const primary = primaryGroceryStoreForKey(post);
      const key = rankKeyPair(post.item, primary);
      const wasWanted = wantSet.has(key);

      // Optimistic update — flip every card with the same item/store key, not
      // just this one (the same product can repeat in the feed).
      const nextWantSet = new Set(wantSet);
      if (wasWanted) {
        nextWantSet.delete(key);
      } else {
        nextWantSet.add(key);
      }
      setWantSet(nextWantSet);
      setPosts((prev) =>
        prev.map((p) =>
          rankKeyPair(p.item, primaryGroceryStoreForKey(p)) === key
            ? { ...p, wantToTry: !wasWanted }
            : p
        )
      );

      try {
        if (wasWanted) {
          await removeFromWantToTry(userId, post.item, primary);
        } else {
          await addToWantToTry(userId, {
            item: post.item,
            store: primary,
            emoji: '',
            category: post.category ?? 'Snacks',
            productBrand: post.brand ?? '',
          });
        }
      } catch (err) {
        console.warn('want-to-try sync failed:', err);
        // Roll back to the pre-toggle state.
        setWantSet(wantSet);
        setPosts((prev) =>
          prev.map((p) =>
            rankKeyPair(p.item, primaryGroceryStoreForKey(p)) === key
              ? { ...p, wantToTry: wasWanted }
              : p
          )
        );
        Alert.alert(
          wasWanted ? 'Could not remove from Want to Try' : 'Could not save to Want to Try',
          err instanceof Error ? err.message : 'Try again in a moment.'
        );
      }
    },
    [userId, wantSet]
  );

  const handleOpenComments = useCallback(
    (post: FeedCardPost) => {
      router.push({
        pathname: '/comments/[postId]',
        params: { postId: String(post.id), postItem: post.item },
      });
    },
    [router]
  );

  const handleOpenUser = useCallback(
    (username: string) => {
      if (!username) return;
      router.push({ pathname: '/user/[username]', params: { username } });
    },
    [router]
  );

  const handleOpenProduct = useCallback(
    (post: FeedCardPost) => {
      if (!post.item) return;
      const fromRowStores = storeListForRow(post);
      const storeParam = fromRowStores[0] ?? String(post.store ?? '').trim();
      router.push({
        pathname: '/product/detail',
        params: {
          item: post.item,
          store: storeParam,
          category: String(post.category ?? '').trim(),
          brand: post.brand ?? '',
          descriptionKey:
            post.descriptionKey ?? normalizedDescriptionKeyFromItem(post.item),
        },
      });
    },
    [router]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <FilterBar
        variant="text"
        store={storeFilter}
        category={categoryFilter}
        onStoreChange={setStoreFilter}
        onCategoryChange={setCategoryFilter}
        showDietRow={showFeedDietBar}
        dietFilter={dietFilter}
        onDietChange={setDietFilter}
      />
      <FlatList
        ref={listRef}
        data={filteredPosts}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <FeedCard
            post={item}
            imageHeaders={storageImageHeaders}
            onLike={handleLike}
            onWantToTry={handleWantToTry}
            onComment={handleOpenComments}
            onPressUser={handleOpenUser}
            onPress={handleOpenProduct}
            showMacroNutrition={showMacroNutrition ?? false}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={BaggedColors.dark}
          />
        }
        ListEmptyComponent={
          feedLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={BaggedColors.dark} />
            </View>
          ) : errorMsg ? (
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>Hmm — that didn&apos;t load</Text>
              <Text style={styles.emptyBody}>{errorMsg}</Text>
            </View>
          ) : (
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>
                {storeFilter !== ALL_STORES || categoryFilter !== ALL_CATEGORIES || dietFilter != null
                  ? 'Nothing matches that filter'
                  : 'Your feed is quiet'}
              </Text>
              <Text style={styles.emptyBody}>
                {storeFilter !== ALL_STORES || categoryFilter !== ALL_CATEGORIES || dietFilter != null
                  ? 'Try a different store, category, or diet, or clear the filters.'
                  : 'Follow some friends or rank a few favorites — new posts will appear here.'}
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BaggedColors.content,
  },
  listContent: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 6,
    paddingBottom: 32 + BaggedLayout.rateFabListInset,
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.dark,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.muted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
});
