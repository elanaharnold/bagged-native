import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedCard, type FeedCardPost } from '@/components/bagged/feed-card';
import { PostNoteEditorModal } from '@/components/bagged/post-note-editor-modal';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { subcategoryForRow } from '@/constants/categories';
import { primaryGroceryStoreForKey } from '@/constants/grocery';
import {
  fetchFeedPostById,
  getUserRankings,
  getWantToTry,
  productDescriptionKey,
  rankKeyPair,
  toggleLike,
  type WantToTryItem,
} from '@/lib/data';
import { feedRowToCardPost } from '@/lib/feed-post-card';
import { storeListForRow } from '@/lib/format';
import { removeWantToTryWithFeed } from '@/lib/want-to-try-feed';
import {
  useWantToTryCaption,
  wantToTryCaptionProductLabel,
} from '@/hooks/use-want-to-try-caption';
import { usePostLikersModal } from '@/hooks/use-post-likers-modal';
import { useDisplaySettings } from '@/providers/display-settings-provider';
import { useAuth } from '@/providers/auth-provider';

export default function PostScreen() {
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { userId, session } = useAuth();
  const { showMacroNutrition } = useDisplaySettings();

  const [cardPost, setCardPost] = useState<FeedCardPost | null>(null);
  const [wantSet, setWantSet] = useState<Set<string>>(() => new Set());
  const [wantByKey, setWantByKey] = useState<Map<string, WantToTryItem>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const {
    captionTarget,
    captionSaving,
    requestWantToTryCaption,
    cancelWantToTryCaption,
    confirmWantToTryCaption,
  } = useWantToTryCaption(userId);

  const storageImageHeaders = useMemo(
    () =>
      session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    [session?.access_token]
  );

  const loadPost = useCallback(async () => {
    const pid = String(postId ?? '').trim();
    if (!pid) {
      setCardPost(null);
      setLoading(false);
      setErrorMsg('Post not found.');
      return;
    }

    setErrorMsg(null);
    try {
      const [fetched, wantRows, rankedRows] = await Promise.all([
        fetchFeedPostById(pid),
        userId
          ? getWantToTry(userId).catch((err) => {
              console.warn('getWantToTry failed:', err);
              return [];
            })
          : Promise.resolve([]),
        userId
          ? getUserRankings(userId).catch((err) => {
              console.warn('getUserRankings failed:', err);
              return [];
            })
          : Promise.resolve([]),
      ]);

      if (!fetched) {
        setCardPost(null);
        setErrorMsg('Post not found.');
        return;
      }

      const nextWantSet = new Set<string>();
      const nextWantByKey = new Map<string, WantToTryItem>();
      for (const w of wantRows) {
        const key = rankKeyPair(w.item, primaryGroceryStoreForKey(w), w.brand);
        nextWantSet.add(key);
        nextWantByKey.set(key, w);
      }
      const rankedSet = new Set(
        rankedRows
          .filter((r) => !r.radar_only)
          .map((r) => rankKeyPair(r.item, primaryGroceryStoreForKey(r), r.product_brand))
      );

      setWantSet(nextWantSet);
      setWantByKey(nextWantByKey);
      setCardPost(
        feedRowToCardPost(fetched, userId ?? '', nextWantSet, rankedSet)
      );
    } catch (err) {
      console.warn('loadPost failed:', err);
      setCardPost(null);
      setErrorMsg(err instanceof Error ? err.message : 'Could not load this post.');
    } finally {
      setLoading(false);
    }
  }, [postId, userId]);

  useEffect(() => {
    setLoading(true);
    void loadPost();
  }, [loadPost]);

  const handleLike = useCallback(
    async (post: FeedCardPost) => {
      if (!userId) return;
      const wasLiked = post.liked;
      setCardPost((prev) =>
        prev && prev.id === post.id
          ? {
              ...prev,
              liked: !wasLiked,
              likes: Math.max(0, prev.likes + (wasLiked ? -1 : 1)),
            }
          : prev
      );
      try {
        await toggleLike(userId, post.id);
      } catch (err) {
        console.warn('toggleLike failed:', err);
        setCardPost((prev) =>
          prev && prev.id === post.id
            ? {
                ...prev,
                liked: wasLiked,
                likes: Math.max(0, prev.likes + (wasLiked ? 1 : -1)),
              }
            : prev
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

      const nextWantSet = new Set(wantSet);
      nextWantSet.delete(key);
      setWantSet(nextWantSet);
      setCardPost((prev) =>
        prev && prev.id === post.id ? { ...prev, wantToTry: false } : prev
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
        await loadPost();
      } catch (err) {
        console.warn('want-to-try sync failed:', err);
        setWantSet(wantSet);
        setCardPost((prev) =>
          prev && prev.id === post.id ? { ...prev, wantToTry: true } : prev
        );
        Alert.alert(
          'Could not remove from Want to Try',
          err instanceof Error ? err.message : 'Try again in a moment.'
        );
      }
    },
    [userId, wantSet, wantByKey, loadPost, requestWantToTryCaption]
  );

  const handleConfirmWantCaption = useCallback(
    async (note: string) => {
      if (!userId) return;
      try {
        const radarPostId = await confirmWantToTryCaption(note);
        if (!radarPostId) return;
        await loadPost();
      } catch (err) {
        console.warn('want-to-try caption save failed:', err);
        Alert.alert(
          'Could not save to Want to Try',
          err instanceof Error ? err.message : 'Try again in a moment.'
        );
      }
    },
    [userId, confirmWantToTryCaption, loadPost]
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
    (handle: string) => {
      if (!handle) return;
      router.push({ pathname: '/user/[username]', params: { username: handle } });
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
            post.descriptionKey ?? productDescriptionKey(post.item, post.brand),
        },
      });
    },
    [router]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={BaggedColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>Post</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={BaggedColors.dark} />
          </View>
        ) : cardPost ? (
          <FeedCard
            post={cardPost}
            imageHeaders={storageImageHeaders}
            onLike={handleLike}
            onShowLikers={(post) => showLikers(post.id)}
            onWantToTry={handleWantToTry}
            onComment={handleOpenComments}
            onPressUser={handleOpenUser}
            onPress={handleOpenProduct}
            showMacroNutrition={showMacroNutrition ?? false}
          />
        ) : (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>Post not found</Text>
            <Text style={styles.emptyBody}>
              {errorMsg ?? 'This post may have been removed.'}
            </Text>
          </View>
        )}
      </ScrollView>
      <PostNoteEditorModal
        visible={captionTarget != null}
        productName={captionTarget ? wantToTryCaptionProductLabel(captionTarget) : undefined}
        subtitle="Tell your followers why you want to try it — tag friends with @username."
        saveLabel="Save & post"
        saving={captionSaving}
        onClose={cancelWantToTryCaption}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BaggedColors.borderSoft,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 20,
    color: BaggedColors.ink,
  },
  headerSpacer: {
    width: 40,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 32,
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
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
    maxWidth: 280,
  },
});
