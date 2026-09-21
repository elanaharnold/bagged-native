import { useFocusEffect, useNavigation } from '@react-navigation/native';
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
import { PostNoteEditorModal } from '@/components/bagged/post-note-editor-modal';
import {
  ALL_CATEGORIES,
  ALL_STORES,
  FilterBar,
  rowMatchesCategoryFilter,
  rowMatchesDietFilter,
  rowMatchesStoreFilter,
  rowMatchesTwoLevelCategoryFilter,
  type FilterStore,
} from '@/components/bagged/filter-bar';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { subcategoryForRow } from '@/constants/categories';
import { STORES, displayStoreForRow, primaryGroceryStoreForKey } from '@/constants/grocery';
import {
  getFeed,
  getUserRankings,
  getWantToTry,
  isRadarOnlyDbRow,
  normalizedDescriptionKeyFromItem,
  productDescriptionKey,
  resolveProductDescriptionKey,
  rankKeyPair,
  toggleLike,
  type FeedPostRow,
  type WantToTryItem,
} from '@/lib/data';
import { feedRowToCardPost } from '@/lib/feed-post-card';
import { removeWantToTryWithFeed } from '@/lib/want-to-try-feed';
import {
  useWantToTryCaption,
  wantToTryCaptionProductLabel,
} from '@/hooks/use-want-to-try-caption';
import { usePostLikersModal } from '@/hooks/use-post-likers-modal';
import { useVerifiedAmbassadorUsernames } from '@/hooks/use-verified-ambassador-usernames';
import { pokeFeedRefresh, setFeedPatchListener, setFeedRefreshListener, takePendingBringToTopPostId } from '@/lib/feed-refresh-poke';
import { shareScoreCardFromFeedPost } from '@/lib/share-score-card';
import { storeListForRow } from '@/lib/format';
import { useDisplaySettings } from '@/providers/display-settings-provider';
import { useAuth } from '@/providers/auth-provider';
import { useShareScoreCard } from '@/providers/share-score-card-provider';

export default function FeedScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { userId, username, session } = useAuth();
  const { openShareScoreCard } = useShareScoreCard();
  const { showFeedDietBar, showMacroNutrition } = useDisplaySettings();
  const verifiedUsernames = useVerifiedAmbassadorUsernames();
  const storageImageHeaders = useMemo(
    () =>
      session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    [session?.access_token]
  );
  const [posts, setPosts] = useState<FeedCardPost[]>([]);
  const [wantSet, setWantSet] = useState<Set<string>>(() => new Set());
  const [wantByKey, setWantByKey] = useState<Map<string, WantToTryItem>>(() => new Map());
  const [feedLoading, setFeedLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<FilterStore>(ALL_STORES);
  const [parentFilter, setParentFilter] = useState<string | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);
  const [dietFilter, setDietFilter] = useState<string | null>(null);
  const listRef = useRef<FlatList<FeedCardPost>>(null);
  const scrollOffsetRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  const lastLoadAtRef = useRef(0);
  const pendingWantRef = useRef<{
    key: string;
    primary: string;
    item: string;
    brand: string;
    stores: string[];
    category: string;
  } | null>(null);
  const {
    captionTarget,
    captionSaving,
    requestWantToTryCaption,
    cancelWantToTryCaption,
    confirmWantToTryCaption,
  } = useWantToTryCaption(userId);
  const FEED_STALE_MS = 2 * 60 * 1000;

  const storeFilterOptions = useMemo<FilterStore[]>(
    () => [ALL_STORES, ...STORES],
    []
  );

  const filteredPosts = useMemo(
    () =>
      posts.filter(
        (p) =>
          rowMatchesStoreFilter(p, storeFilter) &&
          rowMatchesTwoLevelCategoryFilter(p, parentFilter, subcategoryFilter) &&
          rowMatchesDietFilter({ diet_tags: p.dietTags ?? null }, dietFilter)
      ),
    [posts, storeFilter, parentFilter, subcategoryFilter, dietFilter]
  );

  const loadFeed = useCallback(async (uid: string) => {
    setErrorMsg(null);
    const feedErrorMessage = "Couldn't load your feed. Pull to refresh.";
    try {
      const feedPromise = (async (): Promise<FeedPostRow[]> => {
        try {
          const rows = await getFeed(uid);
          if (rows.length === 0) {
            setErrorMsg(feedErrorMessage);
          }
          return rows;
        } catch (err) {
          console.warn('getFeed failed in loadFeed:', err);
          setErrorMsg(feedErrorMessage);
          return [];
        }
      })();

      // Run feed + want-to-try in parallel — both are user-scoped and the card
      // needs the want set to compute the active state.
      const [rows, wantRows, rankedRows] = await Promise.all([
        feedPromise,
        getWantToTry(uid).catch((err) => {
          console.warn('getWantToTry failed:', err);
          return [];
        }),
        getUserRankings(uid).catch((err) => {
          console.warn('getUserRankings failed:', err);
          return [];
        }),
      ]);
      const nextWantSet = new Set(wantRows.map((w) => rankKeyPair(w.item, w.store, w.brand)));
      const nextWantByKey = new Map(
        wantRows.map((w) => [rankKeyPair(w.item, w.store, w.brand), w] as const)
      );
      const rankedSet = new Set(
        rankedRows
          .filter((r) => !isRadarOnlyDbRow(r))
          .map((r) => rankKeyPair(r.item, primaryGroceryStoreForKey(r), r.product_brand))
      );
      setWantSet(nextWantSet);
      setWantByKey(nextWantByKey);
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
        scrollOffsetRef.current = 0;
        requestAnimationFrame(() => {
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        });
      } else if (scrollOffsetRef.current > 0) {
        const offset = scrollOffsetRef.current;
        requestAnimationFrame(() => {
          listRef.current?.scrollToOffset({ offset, animated: false });
        });
      }
      lastLoadAtRef.current = Date.now();
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
        setWantByKey(new Map());
        hasLoadedOnceRef.current = false;
        lastLoadAtRef.current = 0;
        return undefined;
      }
      const stale = Date.now() - lastLoadAtRef.current > FEED_STALE_MS;
      if (hasLoadedOnceRef.current && !stale) {
        return undefined;
      }
      let cancelled = false;
      if (!hasLoadedOnceRef.current) setFeedLoading(true);
      loadFeed(userId).finally(() => {
        if (!cancelled) {
          setFeedLoading(false);
          hasLoadedOnceRef.current = true;
        }
      });
      return () => {
        cancelled = true;
      };
    }, [userId, loadFeed])
  );

  // Home tab while already on feed → scroll back to top (tab bar still emits tabPress).
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      scrollOffsetRef.current = 0;
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    setFeedPatchListener((patch) => {
      setPosts((prev) =>
        prev.map((p) =>
          String(p.id) === String(patch.postId)
            ? {
                ...p,
                comments: Math.max(0, p.comments + (patch.commentsDelta ?? 0)),
              }
            : p
        )
      );
    });
    return () => setFeedPatchListener(null);
  }, []);

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
      const key = rankKeyPair(post.item, primary, post.brand);
      const wasWanted = wantSet.has(key);

      if (!wasWanted) {
        pendingWantRef.current = {
          key,
          primary,
          item: post.item,
          brand: post.brand ?? '',
          stores: post.stores?.length ? post.stores : primary ? [primary] : [],
          category: post.category ?? 'Snacks',
        };
        requestWantToTryCaption({
          item: post.item,
          brand: post.brand ?? '',
          descriptionKey: post.descriptionKey,
          stores: post.stores?.length ? post.stores : primary ? [primary] : [],
          category: post.category ?? 'Snacks',
          subcategory: post.subcategory ?? undefined,
          dietTags: post.dietTags ?? undefined,
          source: 'feed',
        });
        return;
      }

      // Optimistic update — flip every card with the same item/store key, not
      // just this one (the same product can repeat in the feed).
      const nextWantSet = new Set(wantSet);
      nextWantSet.delete(key);
      setWantSet(nextWantSet);
      setPosts((prev) =>
        prev
          .filter((p) => {
            const sameKey =
              rankKeyPair(p.item, primaryGroceryStoreForKey(p), p.brand) === key;
            const ownRadar = p.radarOnly && username && p.user === username;
            return !(sameKey && ownRadar);
          })
          .map((p) =>
            rankKeyPair(p.item, primaryGroceryStoreForKey(p), p.brand) === key
              ? { ...p, wantToTry: false }
              : p
          )
      );

      try {
        const existing = wantByKey.get(key);
        await removeWantToTryWithFeed(
          userId,
          post.item,
          primary,
          existing?.radarPostId,
          { fallbackRadarPostId: post.radarOnly ? post.id : null }
        );
        setWantByKey((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        pokeFeedRefresh();
      } catch (err) {
        console.warn('want-to-try sync failed:', err);
        void loadFeed(userId);
        Alert.alert(
          'Could not remove from Want to Try',
          err instanceof Error ? err.message : 'Try again in a moment.'
        );
      }
    },
    [userId, username, wantSet, wantByKey, loadFeed, requestWantToTryCaption]
  );

  const handleCancelWantCaption = useCallback(() => {
    pendingWantRef.current = null;
    cancelWantToTryCaption();
  }, [cancelWantToTryCaption]);

  const handleConfirmWantCaption = useCallback(
    async (note: string) => {
      if (!userId) return;
      const pending = pendingWantRef.current;
      try {
        const radarPostId = await confirmWantToTryCaption(note);
        if (!radarPostId || !pending) return;
        const { key, primary, item, brand, stores, category } = pending;
        pendingWantRef.current = null;
        setWantSet((prev) => new Set(prev).add(key));
        setPosts((prev) =>
          prev.map((p) =>
            rankKeyPair(p.item, primaryGroceryStoreForKey(p), p.brand) === key
              ? { ...p, wantToTry: true }
              : p
          )
        );
        setWantByKey((prev) =>
          new Map(prev).set(key, {
            id: `wt-${key}`,
            item,
            store: primary,
            stores,
            emoji: '',
            category,
            brand,
            radarPostId,
            note,
          })
        );
        pokeFeedRefresh(radarPostId);
      } catch (err) {
        console.warn('want-to-try caption save failed:', err);
        Alert.alert(
          'Could not save to Want to Try',
          err instanceof Error ? err.message : 'Try again in a moment.'
        );
      }
    },
    [userId, confirmWantToTryCaption]
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
  const { showLikers, modal: likersModal } = usePostLikersModal(handleOpenUser);

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
          subcategory: subcategoryForRow({
            subcategory: post.subcategory,
            category: post.category,
          }),
          brand: post.brand ?? '',
          wantSource: 'feed',
          descriptionKey:
            post.descriptionKey ??
            productDescriptionKey(post.item, post.brand),
        },
      });
    },
    [router]
  );

  const handleLongPressOwnPost = useCallback(
    (post: FeedCardPost) => {
      if (!username) return;
      const payload = shareScoreCardFromFeedPost(post, username);
      if (payload) openShareScoreCard(payload);
    },
    [openShareScoreCard, username]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <FilterBar
        variant="dropdown"
        store={storeFilter}
        category={ALL_CATEGORIES}
        storeOptions={storeFilterOptions}
        onStoreChange={setStoreFilter}
        onCategoryChange={() => {}}
        useTwoLevelCategories
        parentCategoryId={parentFilter}
        subcategoryId={subcategoryFilter}
        onParentCategoryChange={setParentFilter}
        onSubcategoryChange={setSubcategoryFilter}
        showDietRow={showFeedDietBar}
        dietFilter={dietFilter}
        onDietChange={setDietFilter}
      />
      <FlatList
        ref={listRef}
        data={filteredPosts}
        nestedScrollEnabled
        keyExtractor={(item) => String(item.id)}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <FeedCard
            post={item}
            imageHeaders={storageImageHeaders}
            onLike={handleLike}
            onShowLikers={(post) => showLikers(post.id)}
            onWantToTry={handleWantToTry}
            onComment={handleOpenComments}
            onPressUser={handleOpenUser}
            onPress={handleOpenProduct}
            onLongPress={
              username && item.user === username ? handleLongPressOwnPost : undefined
            }
            showMacroNutrition={showMacroNutrition ?? false}
            verifiedUsernames={verifiedUsernames}
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
                {storeFilter !== ALL_STORES || parentFilter != null || subcategoryFilter != null || dietFilter != null
                  ? 'Nothing matches that filter'
                  : 'Your feed is quiet'}
              </Text>
              <Text style={styles.emptyBody}>
                {storeFilter !== ALL_STORES || parentFilter != null || subcategoryFilter != null || dietFilter != null
                  ? 'Try a different store, category, or tag, or clear the filters.'
                  : 'Follow some friends or rank a few favorites — new posts will appear here.'}
              </Text>
            </View>
          )
        }
      />
      <PostNoteEditorModal
        visible={captionTarget != null}
        productName={captionTarget ? wantToTryCaptionProductLabel(captionTarget) : undefined}
        subtitle="Tell your followers why you want to try it — tag friends with @username."
        saveLabel="Save & post"
        saving={captionSaving}
        onClose={handleCancelWantCaption}
        onSave={(note) => void handleConfirmWantCaption(note)}
      />
      {likersModal}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BaggedColors.content,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 4,
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
