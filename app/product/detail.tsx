import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExpandableMentionText } from '@/components/bagged/expandable-text';
import { UsernameLink } from '@/components/bagged/username-link';
import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { Avatar } from '@/components/bagged/avatar';
import { MacrosPills } from '@/components/bagged/macros-pills';
import {
  EMPTY_MACROS,
  ProductMetadataEditorModal,
  type ProductMetadataEditorMode,
} from '@/components/bagged/product-metadata-editor-modal';
import { PostNoteEditorModal } from '@/components/bagged/post-note-editor-modal';
import { PostPhotoStrip } from '@/components/bagged/post-photo-strip';
import { RerankRequiredBanner } from '@/components/bagged/rerank-required-banner';
import { WantToTryTag } from '@/components/bagged/want-to-try-tag';
import { isPublicPostPhotoStorageUrl } from '@/lib/data';
import { ScoreBadge, scoreDisplayColor } from '@/components/bagged/score-badge';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { displayStoreForRow, resolveDisplayProductBrand, retailStoresForRow } from '@/constants/grocery';
import { DIET_TAGS } from '@/constants/diet-tags';
import {
  collectProductPhotoUrlsFromPosts,
  ensureUserPostForProductPhotos,
  fetchCommunityPostsForProduct,
  fetchCuratedProductProfileRow,
  getGlobalRankStatsForItem,
  getWantToTry,
  isAdminUsername,
  isRadarOnlyDbRow,
  profileIsVerifiedAmbassador,
  normalizePhotoUrls,
  normalizedDescriptionKeyFromItem,
  productDescriptionKey,
  resolveProductDescriptionKey,
  rateMacroFormFromNumbers,
  rateMacroFormHasAny,
  resolveProductProfileMacros,
  setProductMetadataGlobally,
  syncPostsSubcategoryFromCuratedCatalog,
  toggleLike,
  updatePostNote,
  wantToTryMatchesProduct,
  wantToTryStorePrimary,
  type FeedPostRow,
  type RateMacroFormState,
  type VerifiedCuratedNutrition,
  type WantToTryItem,
} from '@/lib/data';
import { MAX_REVIEW_PHOTOS } from '@/lib/review-photos';
import { confirmAndDeleteRankedPost } from '@/lib/confirm-delete-ranked-post';
import { pokeFeedRefresh } from '@/lib/feed-refresh-poke';
import { removeWantToTryWithFeed } from '@/lib/want-to-try-feed';
import {
  useWantToTryCaption,
  wantToTryCaptionProductLabel,
} from '@/hooks/use-want-to-try-caption';
import { usePostLikersModal } from '@/hooks/use-post-likers-modal';
import { normalizeWantToTrySource } from '@/lib/want-to-try-source';
import { formatPostTime, formatProductDisplayName, storeListForRow } from '@/lib/format';
import { categoriesForRow, resolveSubcategoryId, subcategoryLabelForRow } from '@/lib/categories';
import { legacyCategoryForSubcategory } from '@/constants/categories';
import { clampBaggedScore, isDisplayableBaggedScore, postNeedsRecategorization } from '@/lib/ranking';
import { useAuth } from '@/providers/auth-provider';
import { useVerifiedAmbassadorUsernames } from '@/hooks/use-verified-ambassador-usernames';

function storeFromParams(storeParam: string): string {
  return String(storeParam ?? '').trim();
}

/** Public URLs from `posts.photo_urls` (Supabase Storage bucket `post-photos`). */
function photoUrlsFromPost(row: FeedPostRow): string[] {
  return normalizePhotoUrls(row.photo_urls);
}

export default function ProductDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId, session, username } = useAuth();
  const verifiedUsernames = useVerifiedAmbassadorUsernames();
  const storageImageHeaders = useMemo(
    () =>
      session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    [session?.access_token]
  );
  const params = useLocalSearchParams<{
    item?: string;
    store?: string;
    category?: string;
    subcategory?: string;
    brand?: string;
    descriptionKey?: string;
    wantSource?: string;
  }>();

  const item = String(params.item ?? '').trim();
  const store = storeFromParams(String(params.store ?? ''));
  const categoryParam = String(params.category ?? '').trim();
  const subcategoryParam = String(params.subcategory ?? '').trim();
  const brand = String(params.brand ?? '').trim();
  const descriptionKey = resolveProductDescriptionKey({ item, brand, descriptionKey: params.descriptionKey });
  const wantSource = normalizeWantToTrySource(params.wantSource);

  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [posts, setPosts] = useState<FeedPostRow[]>([]);
  const [stats, setStats] = useState<{ avg: number | null; count: number }>({ avg: null, count: 0 });
  const [curated, setCurated] = useState<VerifiedCuratedNutrition | null>(null);
  const [wantToTry, setWantToTry] = useState(false);
  const [wantRadarPostId, setWantRadarPostId] = useState<string | null>(null);
  const [wantBusy, setWantBusy] = useState(false);
  const {
    captionTarget,
    captionSaving,
    requestWantToTryCaption,
    cancelWantToTryCaption,
    confirmWantToTryCaption,
  } = useWantToTryCaption(userId);
  const [profileStores, setProfileStores] = useState<string[]>([]);
  const [profileDietTags, setProfileDietTags] = useState<string[]>([]);
  const [profileCategories, setProfileCategories] = useState<string[]>([]);
  const [profileSubcategoryId, setProfileSubcategoryId] = useState<string | null>(null);
  const [metadataEditorMode, setMetadataEditorMode] = useState<ProductMetadataEditorMode | null>(
    null
  );
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const loadGenerationRef = useRef(0);

  const productWantIdentity = useMemo(
    () => ({
      item,
      store,
      stores: store ? [store] : [],
      brand: brand,
    }),
    [item, store, brand]
  );

  const wantStorePrimary = useMemo(
    () => wantToTryStorePrimary(productWantIdentity),
    [productWantIdentity]
  );

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!item) {
      setErrorMsg('Missing product.');
      setPosts([]);
      return;
    }
    setErrorMsg(null);
    try {
      const [rows, rankStats, nutrition, wantRows] = await Promise.all([
        fetchCommunityPostsForProduct(item, descriptionKey, brand),
        getGlobalRankStatsForItem(item, descriptionKey, brand),
        fetchCuratedProductProfileRow(item, brand).catch(() => null),
        userId ? getWantToTry(userId).catch(() => [] as WantToTryItem[]) : Promise.resolve([]),
      ]);
      if (generation !== loadGenerationRef.current) return;
      setPosts(rows);
      setStats(rankStats);
      setCurated(nutrition);
      const catalogSub = String(nutrition?.stored_subcategory ?? '').trim();
      if (catalogSub) {
        void syncPostsSubcategoryFromCuratedCatalog({
          descriptionKey,
          item,
          brand: brand || nutrition?.brand || '',
          curatedSubcategory: catalogSub,
        });
      }
      if (userId) {
        const identity = {
          item,
          store,
          stores: store ? [store] : [],
          brand: brand || nutrition?.brand || '',
        };
        const match = (wantRows as WantToTryItem[]).find((w) =>
          wantToTryMatchesProduct(w, identity)
        );
        setWantToTry(!!match);
        setWantRadarPostId(match?.radarPostId ?? null);
      } else {
        setWantToTry(false);
        setWantRadarPostId(null);
      }
    } catch (e) {
      if (generation !== loadGenerationRef.current) return;
      console.warn('product detail load:', e);
      setErrorMsg(e instanceof Error ? e.message : 'Could not load this product.');
      setPosts([]);
    }
  }, [item, descriptionKey, userId, store, brand]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      load().finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
        loadGenerationRef.current += 1;
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const myRankedPost = useMemo(() => {
    if (!userId) return null;
    const mine = posts.filter(
      (p) => String(p.user_id) === String(userId) && !isRadarOnlyDbRow(p)
    );
    if (mine.length === 0) return null;
    if (mine.length === 1) return mine[0];
    mine.sort((a, b) => {
      const pa = normalizePhotoUrls(a.photo_urls).length;
      const pb = normalizePhotoUrls(b.photo_urls).length;
      if (pb !== pa) return pb - pa;
      const ua = Math.max(
        a.updated_at ? new Date(a.updated_at).getTime() : 0,
        new Date(a.created_at ?? 0).getTime()
      );
      const ub = Math.max(
        b.updated_at ? new Date(b.updated_at).getTime() : 0,
        new Date(b.created_at ?? 0).getTime()
      );
      if (ub !== ua) return ub - ua;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
    return mine[0] ?? null;
  }, [posts, userId]);

  const myRankNeedsRerank = myRankedPost != null && postNeedsRecategorization(myRankedPost);

  const myRankedRating =
    myRankedPost != null &&
    !myRankNeedsRerank &&
    !isRadarOnlyDbRow(myRankedPost) &&
    isDisplayableBaggedScore(myRankedPost.rating)
      ? clampBaggedScore(Number(myRankedPost.rating))
      : null;

  const myRadarPost = useMemo(() => {
    if (!userId) return null;
    return posts.find((p) => String(p.user_id) === String(userId) && isRadarOnlyDbRow(p)) ?? null;
  }, [posts, userId]);

  const communityReviews = useMemo(
    () => posts.filter((p) => String(p.user_id) !== String(userId ?? '')),
    [posts, userId]
  );

  const handleReviewLike = useCallback(
    async (row: FeedPostRow) => {
      if (!userId) {
        Alert.alert('Sign in', 'Log in to like posts.');
        return;
      }
      const wasLiked = row.likes.some((l) => String(l.user_id) === String(userId));
      setPosts((prev) =>
        prev.map((p) =>
          p.id === row.id
            ? {
                ...p,
                likes: wasLiked
                  ? p.likes.filter((l) => String(l.user_id) !== String(userId))
                  : [...p.likes, { post_id: row.id, user_id: userId }],
              }
            : p
        )
      );
      try {
        await toggleLike(userId, row.id);
      } catch (err) {
        console.warn('toggleLike failed:', err);
        setPosts((prev) =>
          prev.map((p) =>
            p.id === row.id
              ? {
                  ...p,
                  likes: wasLiked
                    ? [...p.likes, { post_id: row.id, user_id: userId }]
                    : p.likes.filter((l) => String(l.user_id) !== String(userId)),
                }
              : p
          )
        );
      }
    },
    [userId]
  );

  const handleReviewComment = useCallback(
    (row: FeedPostRow) => {
      if (!userId) {
        Alert.alert('Sign in', 'Log in to comment on posts.');
        return;
      }
      router.push({
        pathname: '/comments/[postId]',
        params: { postId: String(row.id), postItem: String(row.item ?? '') },
      });
    },
    [router, userId]
  );

  const handleOpenUser = useCallback(
    (username: string) => {
      if (!username) return;
      router.push({ pathname: '/user/[username]', params: { username } });
    },
    [router]
  );
  const { showLikers, modal: likersModal } = usePostLikersModal(handleOpenUser);

  /** All review photos for this product identity — visible to everyone on the profile. */
  const allProductPhotos = useMemo(() => collectProductPhotoUrlsFromPosts(posts), [posts]);

  const displayBrand = useMemo(
    () =>
      resolveDisplayProductBrand(
        curated?.brand,
        brand,
        posts.map((p) => p.product_brand)
      ),
    [curated, brand, posts]
  );

  const displayStores = useMemo(() => {
    const fromCurated = curated?.stores?.length
      ? retailStoresForRow({
          stores: curated.stores,
          product_brand: displayBrand,
        })
      : [];
    if (fromCurated.length > 0) return fromCurated;
    const fromPosts = posts.flatMap((p) => storeListForRow(p));
    const uniq = [...new Set(fromPosts.filter(Boolean))];
    if (uniq.length) return uniq;
    const fromParam = displayStoreForRow({
      store,
      stores: store ? [store] : [],
      product_brand: displayBrand,
    });
    return fromParam ? [fromParam] : [];
  }, [curated, posts, store, displayBrand]);

  const isAdmin = isAdminUsername(username);

  const displayCategories = useMemo(() => {
    if (curated?.categories?.length) return curated.categories;
    const fromPosts = posts.flatMap((p) => categoriesForRow(p));
    const uniq = [...new Set(fromPosts.filter(Boolean))];
    if (uniq.length) return uniq;
    return categoriesForRow({ category: categoryParam || curated?.category });
  }, [curated, posts, categoryParam]);

  const displaySubcategoryId = useMemo(
    () =>
      resolveSubcategoryId(
        ...posts.map((p) => ({ subcategory: p.subcategory, category: p.category })),
        curated?.stored_subcategory
          ? { subcategory: curated.stored_subcategory, category: curated.category }
          : null,
        subcategoryParam
          ? { subcategory: subcategoryParam, category: categoryParam }
          : null,
        { category: categoryParam || curated?.category }
      ),
    [curated, posts, categoryParam, subcategoryParam]
  );

  const displaySubcategoryLabel = useMemo(
    () =>
      subcategoryLabelForRow({
        subcategory: profileSubcategoryId ?? displaySubcategoryId,
        category: displayCategories[0],
        categories: displayCategories,
      }),
    [profileSubcategoryId, displaySubcategoryId, displayCategories]
  );

  const displayCategory = displayCategories[0] ?? 'Snacks';

  const displayItem = useMemo(() => {
    const fromPost = posts.find((p) => String(p.item ?? '').trim())?.item;
    if (fromPost) return String(fromPost).trim();
    return item;
  }, [posts, item]);

  const macroSource = useMemo(
    () => resolveProductProfileMacros({ curated, posts }),
    [curated, posts]
  );

  const profileMacrosForm = useMemo((): RateMacroFormState => {
    if (!macroSource) return EMPTY_MACROS;
    return rateMacroFormFromNumbers(
      {
        cal: macroSource.cal,
        protein: macroSource.protein,
        carbs: macroSource.carbs,
        fat: macroSource.fat,
        servingLabel: macroSource.servingLabel,
      },
      { includeZeroValues: curated?.nutrition_verified === true }
    );
  }, [macroSource, curated?.nutrition_verified]);

  const myPhotoSlot = useMemo(() => {
    if (!userId) return null;
    const mine = posts.filter((p) => String(p.user_id) === String(userId));
    if (mine.length === 0) return null;
    const sorted = [...mine].sort((a, b) => {
      const aRanked = !isRadarOnlyDbRow(a) ? 1 : 0;
      const bRanked = !isRadarOnlyDbRow(b) ? 1 : 0;
      if (aRanked !== bRanked) return bRanked - aRanked;
      const pa = normalizePhotoUrls(a.photo_urls).length;
      const pb = normalizePhotoUrls(b.photo_urls).length;
      if (pb !== pa) return pb - pa;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
    return sorted[0] ?? null;
  }, [posts, userId]);

  /** Prefill the Rate nutrition step when the shared profile has macros. */
  const rateMacroAutofill = useMemo(() => {
    const m = resolveProductProfileMacros({ curated, posts });
    if (!m) return null;
    return rateMacroFormFromNumbers(
      {
        cal: m.cal,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        servingLabel: m.servingLabel,
      },
      {
        includeZeroValues: curated?.nutrition_verified === true,
        allowIntentionalAllZeros: true,
      }
    );
  }, [curated, posts]);

  const dietTagIds = useMemo(() => {
    if (curated != null) return curated.diet_tags ?? [];
    const fromPosts = posts.flatMap((p) => (Array.isArray(p.diet_tags) ? p.diet_tags : []));
    return [...new Set(fromPosts.filter(Boolean))];
  }, [curated, posts]);

  useEffect(() => {
    setProfileStores(displayStores);
  }, [displayStores]);

  useEffect(() => {
    setProfileDietTags(dietTagIds);
  }, [dietTagIds]);

  useEffect(() => {
    setProfileCategories(displayCategories);
  }, [displayCategories]);

  useEffect(() => {
    setProfileSubcategoryId(displaySubcategoryId);
  }, [displaySubcategoryId]);

  const openMetadataEditor = (mode: ProductMetadataEditorMode) => {
    if (!userId) {
      Alert.alert('Sign in', 'Log in to edit this product profile.');
      return;
    }
    setMetadataEditorMode(mode);
  };

  const saveProductMetadata = async (next: {
    stores: string[];
    dietTags: string[];
    categories?: string[];
    subcategory?: string;
    newItem?: string;
    newBrand?: string;
    macros?: RateMacroFormState;
  }) => {
    if (!userId || !item || metadataSaving) return;
    const hadMyRank = Boolean(myRankedPost);
    const prevSubcategoryId = profileSubcategoryId;
    setMetadataSaving(true);
    try {
      const res = await setProductMetadataGlobally({
        item,
        descriptionKey,
        productBrand: brand || displayBrand,
        category: (next.categories ?? profileCategories)[0] ?? displayCategory,
        categories: next.categories ?? profileCategories,
        ...(next.subcategory ? { subcategory: next.subcategory } : {}),
        stores: next.stores,
        dietTags: next.dietTags,
        ...(next.macros !== undefined ? { macros: next.macros } : {}),
        ...(metadataEditorMode === 'identity' && isAdmin
          ? {
              adminEdit: true,
              newItem: next.newItem,
              newBrand: next.newBrand,
            }
          : {}),
      });
      if (!res.ok) {
        Alert.alert('Could not save', res.message);
        return;
      }
      setProfileStores(next.stores);
      setProfileDietTags(next.dietTags);
      if (next.subcategory) {
        setProfileSubcategoryId(next.subcategory);
        setProfileCategories([legacyCategoryForSubcategory(next.subcategory)]);
      } else if (next.categories) {
        setProfileCategories(next.categories);
      }
      setMetadataEditorMode(null);
      if (metadataEditorMode === 'identity' && isAdmin) {
        const nextBrand = next.newBrand ?? '';
        const nextItem = (next.newItem?.trim() || item).trim();
        router.replace({
          pathname: '/product/detail',
          params: {
            item: nextItem,
            brand: nextBrand,
            category: (next.categories ?? profileCategories)[0] ?? displayCategory,
            store,
            wantSource: params.wantSource,
            descriptionKey: productDescriptionKey(nextItem, nextBrand),
          },
        });
        pokeFeedRefresh();
        return;
      }
      await load();
      if (
        metadataEditorMode === 'categories' &&
        next.subcategory &&
        hadMyRank &&
        next.subcategory !== prevSubcategoryId
      ) {
        Alert.alert(
          'Category updated',
          'Your score needs to be re-placed in the new category. Compare this item against others there to get an updated score.',
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Re-rank now',
              onPress: () => {
                if (myRankedPost) {
                  router.push({
                    pathname: '/rate',
                    params: { rerankPostId: String(myRankedPost.id) },
                  });
                }
              },
            },
          ]
        );
      }
    } catch (err) {
      console.warn('saveProductMetadata:', err);
      Alert.alert(
        'Could not save',
        err instanceof Error ? err.message : 'Try again in a moment.'
      );
    } finally {
      setMetadataSaving(false);
    }
  };

  const myPhotoCount = myPhotoSlot
    ? normalizePhotoUrls(myPhotoSlot.photo_urls).length
    : 0;
  const canAddPhotos = Boolean(userId) && myPhotoCount < MAX_REVIEW_PHOTOS;

  const goAddPhotos = async () => {
    if (!userId || photoBusy) return;
    setPhotoBusy(true);
    try {
      const res = await ensureUserPostForProductPhotos(userId, {
        item,
        brand: displayBrand,
        descriptionKey,
        category: displayCategory || 'Snacks',
        stores: profileStores,
        dietTags: profileDietTags,
      });
      if ('error' in res) {
        Alert.alert('Could not add photos', res.error);
        return;
      }
      router.push({
        pathname: '/add-review-photos',
        params: {
          postId: String(res.postId),
          item,
          brand: displayBrand,
        },
      });
    } catch (err) {
      Alert.alert(
        'Could not add photos',
        err instanceof Error ? err.message : 'Try again in a moment.'
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleDeleteRanking = () => {
    if (!userId || !myRankedPost) return;
    confirmAndDeleteRankedPost(
      userId,
      { id: myRankedPost.id, item: myRankedPost.item ?? item },
      () => {
        router.back();
      }
    );
  };

  const saveMyPostNote = async (note: string) => {
    if (!userId || !myRankedPost || noteSaving) return;
    setNoteSaving(true);
    try {
      await updatePostNote(userId, myRankedPost.id, note);
      const trimmed = note.trim();
      setPosts((prev) =>
        prev.map((p) => (String(p.id) === String(myRankedPost.id) ? { ...p, note: trimmed } : p))
      );
      setNoteEditorOpen(false);
      pokeFeedRefresh();
    } catch (err) {
      console.warn('saveMyPostNote:', err);
      Alert.alert(
        'Could not save',
        err instanceof Error ? err.message : 'Try again in a moment.'
      );
    } finally {
      setNoteSaving(false);
    }
  };

  const goRate = () => {
    if (!item) return;
    if (myRankedPost) {
      router.push({
        pathname: '/rate',
        params: { rerankPostId: String(myRankedPost.id) },
      });
      return;
    }
    const rateParams: Record<string, string> = {
      prefilledItem: item,
      prefilledBrand: displayBrand,
    };
    if (displayCategory) rateParams.prefilledCategory = displayCategory;
    if (displayStores.length > 0) rateParams.prefilledStores = displayStores.join(',');
    if (profileDietTags.length > 0) rateParams.prefilledDietTags = profileDietTags.join(',');
    if (rateMacroAutofill && rateMacroFormHasAny(rateMacroAutofill)) {
      if (rateMacroAutofill.cal) rateParams.prefilledMacroCal = rateMacroAutofill.cal;
      if (rateMacroAutofill.protein) rateParams.prefilledMacroProtein = rateMacroAutofill.protein;
      if (rateMacroAutofill.carbs) rateParams.prefilledMacroCarbs = rateMacroAutofill.carbs;
      if (rateMacroAutofill.fat) rateParams.prefilledMacroFat = rateMacroAutofill.fat;
      if (rateMacroAutofill.servingLabel) {
        rateParams.prefilledMacroServing = rateMacroAutofill.servingLabel;
      }
    }
    if (wantToTry) {
      rateParams.isWantToTry = 'true';
      if (wantRadarPostId) rateParams.wantToTryRadarPostId = wantRadarPostId;
    }
    router.push({
      pathname: '/rate',
      params: rateParams,
    });
  };

  const toggleWant = async () => {
    if (!userId || !item) {
      Alert.alert('Sign in', 'Log in to use Want to Try.');
      return;
    }
    if (wantBusy || captionSaving) return;
    const was = wantToTry;
    const wantIdentity = {
      item,
      store: wantStorePrimary,
      stores:
        profileStores.length > 0
          ? profileStores
          : wantStorePrimary
            ? [wantStorePrimary]
            : [],
      brand: displayBrand,
    };
    if (!was) {
      requestWantToTryCaption({
        item,
        brand: displayBrand,
        descriptionKey,
        stores: wantIdentity.stores,
        category: displayCategory,
        dietTags: profileDietTags,
        source: wantSource,
      });
      return;
    }
    setWantToTry(false);
    setWantBusy(true);
    try {
      await removeWantToTryWithFeed(userId, item, wantStorePrimary, wantRadarPostId, {
        fallbackRadarPostId: myRadarPost?.id ?? wantRadarPostId,
      });
      setWantRadarPostId(null);
      pokeFeedRefresh();
    } catch (err) {
      console.warn('want toggle:', err);
      setWantToTry(true);
      Alert.alert('Could not remove', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setWantBusy(false);
    }
  };

  const handleConfirmWantCaption = async (note: string) => {
    try {
      const radarPostId = await confirmWantToTryCaption(note);
      if (!radarPostId) return;
      setWantToTry(true);
      setWantRadarPostId(radarPostId);
      pokeFeedRefresh(radarPostId);
    } catch (err) {
      console.warn('want caption save:', err);
      Alert.alert(
        'Could not save',
        err instanceof Error ? err.message : 'Try again.'
      );
    }
  };

  if (!item) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <HeaderBar onBack={() => router.back()} title="Product" />
        <View style={styles.centered}>
          <Text style={styles.err}>Missing product link.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BaggedColors.onBg} />
        }
        contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeGhost}>
              <Ionicons name="close" size={24} color={BaggedColors.green} />
            </Pressable>
          </View>
          <View style={styles.heroInner}>
            {allProductPhotos.length > 0 ? (
              <Image
                key={allProductPhotos[0]}
                source={
                  isPublicPostPhotoStorageUrl(allProductPhotos[0])
                    ? { uri: allProductPhotos[0] }
                    : {
                        uri: allProductPhotos[0],
                        ...(storageImageHeaders && Object.keys(storageImageHeaders).length > 0
                          ? { headers: storageImageHeaders }
                          : {}),
                      }
                }
                style={styles.heroPhoto}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={styles.thumb}>
                <Text style={styles.thumbLetter}>{(item.charAt(0) || '?').toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.heroBody}>
              <AutoFitText style={styles.title} numberOfLines={4} minimumFontScale={0.78}>
                {formatProductDisplayName(displayItem)}
              </AutoFitText>
              {displayBrand ? (
                <AutoFitText style={styles.brandSub} numberOfLines={2} minimumFontScale={0.85}>
                  {formatProductDisplayName(displayBrand)}
                </AutoFitText>
              ) : isAdmin && userId ? (
                <Pressable
                  onPress={() => openMetadataEditor('identity')}
                  style={({ pressed }) => [styles.pillAdd, pressed && styles.pillPressed]}>
                  <Text style={styles.pillAddText}>Add brand</Text>
                </Pressable>
              ) : null}
              {profileStores.length > 0 || displaySubcategoryLabel ? (
                <View style={styles.pillRow}>
                  {profileStores.length > 0 ? (
                    profileStores.map((s) => (
                      <Pressable
                        key={s}
                        onPress={() => openMetadataEditor('stores')}
                        style={({ pressed }) => [styles.pillStore, pressed && styles.pillPressed]}>
                        <Text style={styles.pillStoreText}>{s}</Text>
                      </Pressable>
                    ))
                  ) : (
                    <Pressable
                      onPress={() => openMetadataEditor('stores')}
                      style={({ pressed }) => [styles.pillAdd, pressed && styles.pillPressed]}>
                      <Text style={styles.pillAddText}>Add stores</Text>
                    </Pressable>
                  )}
                  {!loading && displaySubcategoryLabel ? (
                    <Pressable
                      onPress={() => openMetadataEditor('categories')}
                      style={({ pressed }) => [styles.pillMuted, pressed && styles.pillPressed]}>
                      <Text style={styles.pillMutedText}>{displaySubcategoryLabel}</Text>
                    </Pressable>
                  ) : !loading && userId ? (
                    <Pressable
                      onPress={() => openMetadataEditor('categories')}
                      style={({ pressed }) => [styles.pillAdd, pressed && styles.pillPressed]}>
                      <Text style={styles.pillAddText}>Add category</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <View style={styles.pillRow}>
                  <Pressable
                    onPress={() => openMetadataEditor('stores')}
                    style={({ pressed }) => [styles.pillAdd, pressed && styles.pillPressed]}>
                    <Text style={styles.pillAddText}>Add stores</Text>
                  </Pressable>
                  {userId ? (
                    <Pressable
                      onPress={() => openMetadataEditor('categories')}
                      style={({ pressed }) => [styles.pillAdd, pressed && styles.pillPressed]}>
                      <Text style={styles.pillAddText}>Add category</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
              {isAdmin && userId ? (
                <Pressable
                  onPress={() => openMetadataEditor('identity')}
                  style={({ pressed }) => [styles.adminEditLink, pressed && styles.pillPressed]}>
                  <Text style={styles.adminEditLinkText}>Edit name & brand</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {loading ? (
            <View style={styles.heroLoading}>
              <ActivityIndicator color={BaggedColors.green} />
            </View>
          ) : (
            <View style={styles.avgBlock}>
              {stats.avg != null ? (
                <Text
                  style={[
                    styles.avgNum,
                    stats.avg != null && { color: scoreDisplayColor(stats.avg) },
                  ]}>
                  {stats.avg.toFixed(1)}
                </Text>
              ) : (
                <Text style={styles.avgNumMuted}>—</Text>
              )}
              <Text style={styles.avgLabel}>Community avg</Text>
              <Text style={styles.avgSub}>
                {stats.count > 0
                  ? `${stats.count} rating${stats.count === 1 ? '' : 's'}`
                  : 'No scores yet'}
              </Text>
            </View>
          )}
        </View>

        {allProductPhotos.length > 0 || canAddPhotos ? (
          <View style={styles.productPhotosSection}>
            <View style={styles.sectionTitleRow}>
              <Text style={[styles.sectionTitleDark, styles.sectionTitleInRow]}>
                Photos from the community
              </Text>
              {canAddPhotos ? (
                <Pressable
                  onPress={() => void goAddPhotos()}
                  disabled={photoBusy}
                  style={({ pressed }) => [styles.sectionEditBtn, pressed && styles.pillPressed]}>
                  {photoBusy ? (
                    <ActivityIndicator size="small" color={BaggedColors.accent} />
                  ) : (
                    <Text style={styles.sectionEditBtnText}>Add photos</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
            {allProductPhotos.length > 0 ? (
              <PostPhotoStrip
                urls={allProductPhotos}
                maxHeight={220}
                imageHeaders={storageImageHeaders}
              />
            ) : (
              <Text style={styles.photosEmptyHint}>
                No photos yet — tap Add photos to share the first one.
              </Text>
            )}
          </View>
        ) : null}

        {myRankedPost ? (
          <View style={styles.myRankBanner}>
            {myRankNeedsRerank ? (
              <RerankRequiredBanner count={1} onPress={goRate} />
            ) : null}
            <View style={styles.myRankHeader}>
              <Text style={styles.myRankLabel}>Your score</Text>
              <Pressable
                onPress={() => setNoteEditorOpen(true)}
                hitSlop={8}
                style={({ pressed }) => [styles.myRankNoteBtn, pressed && styles.pillPressed]}>
                <Text style={styles.myRankNoteBtnText}>
                  {myRankedPost.note?.trim() ? 'Edit note' : 'Add note'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.myRankRow}>
              {myRankNeedsRerank ? (
                <Text style={styles.myRankNoteEmpty}>
                  Re-rank to get a score in the new category.
                </Text>
              ) : (
                <>
              <Text
                style={[
                  styles.myRankScoreNum,
                  myRankedRating != null && { color: scoreDisplayColor(myRankedRating) },
                ]}>
                {myRankedRating != null ? myRankedRating.toFixed(1) : '—'}
              </Text>
              {myRankedPost.note?.trim() ? (
                <View style={styles.myRankNoteWrap}>
                  <ExpandableMentionText
                    text={myRankedPost.note.trim()}
                    style={styles.myRankNote}
                    mentionStyle={styles.noteMention}
                    numberOfLines={4}
                    quoted
                    verifiedUsernames={verifiedUsernames}
                  />
                </View>
              ) : (
                <Text style={styles.myRankNoteEmpty}>No note yet — tap Add note to share your take.</Text>
              )}
                </>
              )}
            </View>
          </View>
        ) : myRadarPost ? (
          <View style={styles.radarBanner}>
            <Text style={styles.radarBannerText}>On your Want to Try list (not ranked yet)</Text>
          </View>
        ) : null}

        {errorMsg ? (
          <Text style={styles.inlineErr}>{errorMsg}</Text>
        ) : null}

        {macroSource || userId ? (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Text style={[styles.sectionTitle, styles.sectionTitleInRow]}>Nutrition</Text>
              {userId ? (
                <Pressable
                  onPress={() => openMetadataEditor('macros')}
                  style={({ pressed }) => [styles.sectionEditBtn, pressed && styles.pillPressed]}>
                  <Text style={styles.sectionEditBtnText}>
                    {macroSource ? 'Edit nutrition' : 'Add nutrition'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {macroSource ? (
              <>
                {macroSource.servingLabel ? (
                  <Text style={styles.serving}>{macroSource.servingLabel}</Text>
                ) : null}
                <View style={styles.macrosCenter}>
                  <MacrosPills macros={macroSource} />
                </View>
              </>
            ) : userId ? (
              <Text style={styles.photosEmptyHint}>
                No nutrition on file yet — tap Add nutrition to enter macros for everyone.
              </Text>
            ) : null}
          </View>
        ) : null}

        {profileDietTags.length > 0 || userId ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Diet tags</Text>
            <View style={styles.dietRow}>
              {profileDietTags.map((id) => {
                const t = DIET_TAGS.find((x) => x.id === id);
                if (!t) return null;
                return (
                  <Pressable
                    key={id}
                    onPress={() => openMetadataEditor('diet')}
                    style={({ pressed }) => [
                      styles.dietChip,
                      { backgroundColor: t.bg },
                      pressed && styles.pillPressed,
                    ]}>
                    <Text style={[styles.dietChipText, { color: t.color }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
              {userId ? (
                <Pressable
                  onPress={() => openMetadataEditor('diet')}
                  style={({ pressed }) => [styles.dietAddChip, pressed && styles.pillPressed]}>
                  <Text style={styles.dietAddChipText}>
                    {profileDietTags.length > 0 ? 'Edit tags' : 'Add diet tags'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Community reviews</Text>
          {loading ? (
            <ActivityIndicator style={styles.listSpinner} color={BaggedColors.onBg} />
          ) : communityReviews.length === 0 ? (
            <Text style={styles.emptyReviews}>No one else has posted this product yet.</Text>
          ) : (
            communityReviews.map((p) => (
              <ReviewRow
                key={String(p.id)}
                row={p}
                viewerId={userId}
                imageHeaders={storageImageHeaders}
                verifiedUsernames={verifiedUsernames}
                onOpenPost={(id) =>
                  router.push({ pathname: '/post/[postId]', params: { postId: String(id) } })
                }
                onLike={handleReviewLike}
                onComment={handleReviewComment}
                onShowLikers={(id) => showLikers(id)}
              />
            ))
          )}
        </View>
        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <Pressable onPress={goRate} style={styles.btnPrimary}>
          <Text style={styles.btnPrimaryText}>{myRankedPost ? 'Re-rank' : 'Rate This'}</Text>
        </Pressable>
        {canAddPhotos ? (
          <Pressable
            onPress={() => void goAddPhotos()}
            disabled={photoBusy}
            style={[styles.btnSecondary, photoBusy && styles.btnSecondaryDisabled]}>
            {photoBusy ? (
              <ActivityIndicator color={BaggedColors.dark} />
            ) : (
              <Text style={styles.btnSecondaryText}>Add photos</Text>
            )}
          </Pressable>
        ) : null}
        {myRankedPost ? (
          <Pressable onPress={handleDeleteRanking} style={styles.btnDelete}>
            <Text style={styles.btnDeleteText}>Delete ranking</Text>
          </Pressable>
        ) : null}
        {!myRankedPost ? (
          <Pressable
            onPress={toggleWant}
            disabled={wantBusy || captionSaving}
            style={[styles.btnSecondary, wantToTry && styles.btnSecondaryOn]}>
            <Text style={[styles.btnSecondaryText, wantToTry && styles.btnSecondaryTextOn]}>
              {wantToTry ? 'On Want to Try' : 'Want to Try'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ProductMetadataEditorModal
        visible={metadataEditorMode != null}
        mode={metadataEditorMode ?? 'stores'}
        itemTitle={displayItem}
        brand={displayBrand}
        stores={profileStores}
        dietTags={profileDietTags}
        categories={profileCategories}
        subcategoryId={profileSubcategoryId}
        macros={profileMacrosForm}
        macrosLocked={curated?.nutrition_verified === true}
        saving={metadataSaving}
        onClose={() => {
          if (metadataSaving) return;
          setMetadataEditorMode(null);
        }}
        onSave={saveProductMetadata}
      />
      <PostNoteEditorModal
        visible={noteEditorOpen}
        initialNote={myRankedPost?.note}
        productName={formatProductDisplayName(displayItem)}
        saving={noteSaving}
        onClose={() => {
          if (noteSaving) return;
          setNoteEditorOpen(false);
        }}
        onSave={saveMyPostNote}
      />
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

function HeaderBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.simpleHeader}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.simpleBack}>
        <Ionicons name="chevron-back" size={22} color={BaggedColors.onBg} />
      </Pressable>
      <Text style={styles.simpleTitle}>{title}</Text>
      <View style={styles.simpleSpacer} />
    </View>
  );
}

function ReviewRow({
  row,
  viewerId,
  imageHeaders,
  verifiedUsernames,
  onOpenPost,
  onLike,
  onComment,
  onShowLikers,
}: {
  row: FeedPostRow;
  viewerId: string | null;
  imageHeaders?: Record<string, string>;
  verifiedUsernames?: ReadonlySet<string>;
  onOpenPost: (postId: string | number) => void;
  onLike: (row: FeedPostRow) => void;
  onComment: (row: FeedPostRow) => void;
  onShowLikers: (postId: string | number) => void;
}) {
  const username = row.profile?.username ?? 'unknown';
  const radar = isRadarOnlyDbRow(row);
  const liked = viewerId
    ? row.likes.some((l) => String(l.user_id) === String(viewerId))
    : false;
  const likeCount = row.likes.length;
  const commentCount = row.commentCount ?? 0;

  return (
    <View style={styles.reviewCard}>
      <Pressable onPress={() => onOpenPost(row.id)}>
        <View style={styles.reviewTop}>
          <Avatar char={(username || '?').charAt(0).toUpperCase()} color={row.profile?.avatar_color ?? BaggedColors.accent} size={36} />
          <View style={styles.reviewTopText}>
            <UsernameLink
              username={username}
              style={styles.reviewUser}
              verified={profileIsVerifiedAmbassador(row.profile)}
            />
            <Text style={styles.reviewTime}>{formatPostTime(row.created_at)}</Text>
          </View>
          {radar ? (
            <WantToTryTag compact />
          ) : (
            <ScoreBadge
              rating={isDisplayableBaggedScore(row.rating) ? Number(row.rating) : 0}
              size={14}
            />
          )}
        </View>
        {row.note?.trim() ? (
          <ExpandableMentionText
            text={row.note.trim()}
            style={styles.reviewNote}
            mentionStyle={styles.noteMention}
            numberOfLines={4}
            quoted
            verifiedUsernames={verifiedUsernames}
          />
        ) : null}
        <PostPhotoStrip urls={photoUrlsFromPost(row)} maxHeight={160} imageHeaders={imageHeaders} />
      </Pressable>

      <View style={styles.reviewActions}>
        <View style={styles.reviewActionBtn}>
          <Pressable onPress={() => onLike(row)} hitSlop={8}>
            <Ionicons
              name={liked ? 'heart' : 'heart-outline'}
              size={17}
              color={liked ? BaggedColors.heart : BaggedColors.ink}
            />
          </Pressable>
          {likeCount > 0 ? (
            <Pressable onPress={() => onShowLikers(row.id)} hitSlop={8}>
              <Text style={styles.reviewActionCount}>{likeCount}</Text>
            </Pressable>
          ) : (
            <Text style={styles.reviewActionCount}>{likeCount}</Text>
          )}
        </View>
        <Pressable onPress={() => onComment(row)} hitSlop={8} style={styles.reviewActionBtn}>
          <Ionicons name="chatbubble-outline" size={16} color={BaggedColors.ink} />
          <Text style={styles.reviewActionCount}>{commentCount}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BaggedColors.bg },
  scroll: { paddingBottom: 24 },
  hero: {
    backgroundColor: BaggedColors.dark,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingBottom: 20,
  },
  heroTop: { alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 4 },
  closeGhost: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInner: { flexDirection: 'row', gap: 14, paddingHorizontal: 20, paddingTop: 8 },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLetter: { fontFamily: BaggedFonts.display, fontSize: 28, color: BaggedColors.green },
  heroBody: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.green,
    lineHeight: 27,
    width: '100%',
  },
  brandSub: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.72)',
    marginTop: 4,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  pillStore: {
    backgroundColor: BaggedColors.accentPale,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  pillStoreText: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: BaggedColors.accent,
  },
  pillAdd: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  pillAddText: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  pillPressed: { opacity: 0.72 },
  pillMuted: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  pillMutedText: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
  },
  adminEditLink: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  adminEditLinkText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.green,
    textDecorationLine: 'underline',
  },
  heroLoading: { paddingVertical: 24, alignItems: 'center' },
  avgBlock: {
    marginHorizontal: 20,
    marginTop: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  avgNum: { fontFamily: BaggedFonts.display, fontSize: 28, color: BaggedColors.green },
  avgNumMuted: {
    fontFamily: BaggedFonts.display,
    fontSize: 28,
    color: 'rgba(255,255,255,0.35)',
  },
  avgHigh: { color: BaggedColors.scoreHigh },
  avgMid: { color: BaggedColors.gold },
  avgLow: { color: BaggedColors.scoreLow },
  avgLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  avgSub: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 4,
  },
  myRankBanner: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
  },
  myRankLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
  },
  myRankHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 12,
  },
  myRankNoteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
  },
  myRankNoteBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  myRankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  /** Same display size / face as `avgNum` in the hero (no ring). */
  myRankScoreNum: {
    fontFamily: BaggedFonts.display,
    fontSize: 28,
  },
  myRankNote: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.dark,
    fontStyle: 'italic',
  },
  myRankNoteWrap: {
    flex: 1,
    minWidth: 120,
  },
  myRankNoteEmpty: {
    flex: 1,
    minWidth: 120,
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    lineHeight: 18,
  },
  radarBanner: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: BaggedColors.accentPale,
  },
  radarBannerText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.accent,
    textAlign: 'center',
  },
  inlineErr: {
    marginHorizontal: 20,
    marginTop: 12,
    color: BaggedColors.accent,
    fontFamily: BaggedFonts.body,
    fontSize: 13,
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.onBgMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  sectionTitleDark: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  productPhotosSection: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  sectionTitleInRow: {
    marginBottom: 0,
    flex: 1,
  },
  sectionEditBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BaggedColors.borderOnBg,
    borderStyle: 'dashed',
  },
  sectionEditBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  photosEmptyHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  heroPhoto: {
    width: 88,
    height: 88,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  serving: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.onBgMuted,
    marginBottom: 8,
  },
  macrosCenter: { alignItems: 'center', marginBottom: 10 },
  dietRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dietChip: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  dietChipText: { fontFamily: BaggedFonts.body, fontSize: 11, fontWeight: '700' },
  dietAddChip: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: BaggedColors.borderOnBg,
    borderStyle: 'dashed',
  },
  dietAddChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: BaggedColors.onBgMuted,
  },
  listSpinner: { marginVertical: 20 },
  emptyReviews: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.onBgMuted,
    fontStyle: 'italic',
  },
  reviewCard: {
    backgroundColor: BaggedColors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BaggedColors.border,
    padding: 12,
    marginBottom: 10,
  },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewTopText: { flex: 1, minWidth: 0 },
  reviewUser: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  reviewTime: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.muted,
    marginTop: 2,
  },
  radarMini: {
    backgroundColor: BaggedColors.accentPale,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  radarMiniText: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  reviewNote: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    marginTop: 10,
    fontStyle: 'italic',
  },
  noteMention: {
    color: BaggedColors.accent,
    fontWeight: '700',
    fontStyle: 'normal',
  },
  reviewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BaggedColors.borderSoft,
  },
  reviewActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  reviewActionCount: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.ink,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: BaggedColors.bg,
    borderTopWidth: 1,
    borderTopColor: BaggedColors.borderOnBg,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: BaggedColors.dark,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    fontFamily: BaggedFonts.display,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.green,
    textAlign: 'center',
  },
  btnSecondary: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  btnSecondaryDisabled: { opacity: 0.6 },
  btnSecondaryOn: {
    borderColor: BaggedColors.dark,
    backgroundColor: BaggedColors.dark,
  },
  btnSecondaryText: {
    fontFamily: BaggedFonts.display,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.onBg,
    textAlign: 'center',
  },
  btnSecondaryTextOn: { color: BaggedColors.green },
  btnDelete: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
    backgroundColor: BaggedColors.white,
  },
  btnDeleteText: {
    fontFamily: BaggedFonts.display,
    fontSize: 13,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  err: { fontFamily: BaggedFonts.body, color: BaggedColors.accent },
  simpleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderOnBg,
  },
  simpleBack: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  simpleTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.onBg,
  },
  simpleSpacer: { width: 36 },
});
