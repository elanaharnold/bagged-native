import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
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

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { Avatar } from '@/components/bagged/avatar';
import { MacrosPills } from '@/components/bagged/macros-pills';
import { PostPhotoStrip } from '@/components/bagged/post-photo-strip';
import { ScoreBadge } from '@/components/bagged/score-badge';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import {
  addToWantToTry,
  fetchCommunityPostsForProduct,
  fetchVerifiedCuratedNutritionByDescription,
  getGlobalRankStatsForItem,
  getWantToTry,
  isRadarOnlyDbRow,
  normalizeMacros,
  normalizePhotoUrls,
  normalizedDescriptionKeyFromItem,
  rateMacroFormFromNumbers,
  rateMacroFormHasAny,
  rankKeyPair,
  removeFromWantToTry,
  type FeedPostRow,
  type VerifiedCuratedNutrition,
} from '@/lib/data';
import { formatPostTime, formatProductDisplayName, storeListForRow } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';
import { useDisplaySettings } from '@/providers/display-settings-provider';

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
  const { userId, session } = useAuth();
  const { showMacroNutrition } = useDisplaySettings();
  const storageImageHeaders = useMemo(
    () =>
      session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    [session?.access_token]
  );
  const params = useLocalSearchParams<{
    item?: string;
    store?: string;
    category?: string;
    brand?: string;
    descriptionKey?: string;
  }>();

  const item = String(params.item ?? '').trim();
  const store = storeFromParams(String(params.store ?? ''));
  const categoryParam = String(params.category ?? '').trim();
  const brand = String(params.brand ?? '').trim();
  const descriptionKey =
    String(params.descriptionKey ?? '').trim().toLowerCase() || normalizedDescriptionKeyFromItem(item);

  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [posts, setPosts] = useState<FeedPostRow[]>([]);
  const [stats, setStats] = useState<{ avg: number | null; count: number }>({ avg: null, count: 0 });
  const [curated, setCurated] = useState<VerifiedCuratedNutrition | null>(null);
  const [wantToTry, setWantToTry] = useState(false);
  const [wantBusy, setWantBusy] = useState(false);

  const wantKey = useMemo(() => rankKeyPair(item, store), [item, store]);

  const load = useCallback(async () => {
    if (!item) {
      setErrorMsg('Missing product.');
      setPosts([]);
      return;
    }
    setErrorMsg(null);
    try {
      const [rows, rankStats, nutrition, wantRows] = await Promise.all([
        fetchCommunityPostsForProduct(item, descriptionKey),
        getGlobalRankStatsForItem(item, descriptionKey),
        fetchVerifiedCuratedNutritionByDescription(item).catch(() => null),
        userId
          ? getWantToTry(userId).catch(() => [] as { item: string; store: string }[])
          : Promise.resolve([]),
      ]);
      setPosts(rows);
      setStats(rankStats);
      setCurated(nutrition);
      if (userId) {
        const next = new Set(wantRows.map((w) => rankKeyPair(w.item, w.store)));
        setWantToTry(next.has(wantKey));
      } else {
        setWantToTry(false);
      }
    } catch (e) {
      console.warn('product detail load:', e);
      setErrorMsg(e instanceof Error ? e.message : 'Could not load this product.');
      setPosts([]);
    }
  }, [item, descriptionKey, userId, wantKey]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      load().finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
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
      (p) =>
        String(p.user_id) === String(userId) && !isRadarOnlyDbRow(p) && Number(p.rating) > 0
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

  const myRankedRating = myRankedPost != null ? Number(myRankedPost.rating) : null;

  const myRadarPost = useMemo(() => {
    if (!userId) return null;
    return posts.find((p) => String(p.user_id) === String(userId) && isRadarOnlyDbRow(p)) ?? null;
  }, [posts, userId]);

  const communityReviews = useMemo(
    () => posts.filter((p) => String(p.user_id) !== String(userId ?? '')),
    [posts, userId]
  );

  const displayBrand = useMemo(() => {
    if (curated?.brand) return curated.brand;
    if (brand) return brand;
    for (const p of posts) {
      const b = String(p.product_brand ?? '').trim();
      if (b) return b;
    }
    return '';
  }, [curated, brand, posts]);

  const displayStores = useMemo(() => {
    if (curated?.stores?.length) return curated.stores;
    const fromPosts = posts.flatMap((p) => [...storeListForRow(p)]);
    const uniq = [...new Set(fromPosts.filter(Boolean))];
    if (uniq.length) return uniq;
    return store ? [store] : [];
  }, [curated, posts, store]);

  const displayCategory = (curated?.category || categoryParam).trim();

  const macroSource = useMemo(() => {
    if (
      curated &&
      (curated.cal != null ||
        curated.protein != null ||
        curated.carbs != null ||
        curated.fat != null)
    ) {
      return {
        cal: curated.cal,
        protein: curated.protein,
        carbs: curated.carbs,
        fat: curated.fat,
      };
    }
    const withMacros = posts.find((p) => normalizeMacros(p.macros) != null);
    return withMacros ? normalizeMacros(withMacros.macros) : null;
  }, [curated, posts]);

  /** Prefill the Rate nutrition step when verified curated or a community post has macros */
  const rateMacroAutofill = useMemo(() => {
    if (
      curated &&
      (curated.cal != null ||
        curated.protein != null ||
        curated.carbs != null ||
        curated.fat != null)
    ) {
      return rateMacroFormFromNumbers({
        cal: curated.cal,
        protein: curated.protein,
        carbs: curated.carbs,
        fat: curated.fat,
        servingLabel: curated.serving_label,
      });
    }
    const withMacros = posts.find((p) => normalizeMacros(p.macros) != null);
    const n = withMacros ? normalizeMacros(withMacros.macros) : null;
    if (!n) return null;
    return rateMacroFormFromNumbers({
      cal: n.cal,
      protein: n.protein,
      carbs: n.carbs,
      fat: n.fat,
      servingLabel: n.servingLabel,
    });
  }, [curated, posts]);

  const dietTagIds = useMemo(() => {
    if (curated?.diet_tags?.length) return curated.diet_tags;
    const fromPosts = posts.flatMap((p) => (Array.isArray(p.diet_tags) ? p.diet_tags : []));
    return [...new Set(fromPosts.filter(Boolean))];
  }, [curated, posts]);

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
    if (rateMacroAutofill && rateMacroFormHasAny(rateMacroAutofill)) {
      if (rateMacroAutofill.cal) rateParams.prefilledMacroCal = rateMacroAutofill.cal;
      if (rateMacroAutofill.protein) rateParams.prefilledMacroProtein = rateMacroAutofill.protein;
      if (rateMacroAutofill.carbs) rateParams.prefilledMacroCarbs = rateMacroAutofill.carbs;
      if (rateMacroAutofill.fat) rateParams.prefilledMacroFat = rateMacroAutofill.fat;
      if (rateMacroAutofill.servingLabel) {
        rateParams.prefilledMacroServing = rateMacroAutofill.servingLabel;
      }
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
    if (wantBusy) return;
    const was = wantToTry;
    setWantToTry(!was);
    setWantBusy(true);
    try {
      if (was) {
        await removeFromWantToTry(userId, item, store);
      } else {
        await addToWantToTry(userId, {
          item,
          store,
          emoji: '',
          category: displayCategory,
          productBrand: displayBrand,
        });
      }
    } catch (err) {
      console.warn('want toggle:', err);
      setWantToTry(was);
      Alert.alert(
        was ? 'Could not remove' : 'Could not save',
        err instanceof Error ? err.message : 'Try again.'
      );
    } finally {
      setWantBusy(false);
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
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </Pressable>
          </View>
          <View style={styles.heroInner}>
            <View style={styles.thumb}>
              <Text style={styles.thumbLetter}>{(item.charAt(0) || '?').toUpperCase()}</Text>
            </View>
            <View style={styles.heroBody}>
              <Text style={styles.title}>{formatProductDisplayName(item)}</Text>
              {displayBrand ? (
                <Text style={styles.brandSub}>{formatProductDisplayName(displayBrand)}</Text>
              ) : null}
              {displayStores.length > 0 || displayCategory ? (
                <View style={styles.pillRow}>
                  {displayStores.map((s) => (
                    <View key={s} style={styles.pillStore}>
                      <Text style={styles.pillStoreText}>{s}</Text>
                    </View>
                  ))}
                  {displayCategory ? (
                    <View style={styles.pillMuted}>
                      <Text style={styles.pillMutedText}>{displayCategory}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>

          {loading ? (
            <View style={styles.heroLoading}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : (
            <View style={styles.avgBlock}>
              {stats.avg != null ? (
                <Text
                  style={[
                    styles.avgNum,
                    stats.avg >= 9
                      ? styles.avgHigh
                      : stats.avg >= 7
                        ? styles.avgMid
                        : styles.avgLow,
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

        {myRankedPost ? (
          <View style={styles.myRankBanner}>
            <Text style={styles.myRankLabel}>Your score</Text>
            <View style={styles.myRankRow}>
              <Text
                style={[
                  styles.myRankScoreNum,
                  myRankedRating != null && myRankedRating >= 9
                    ? styles.avgHigh
                    : myRankedRating != null && myRankedRating >= 7
                      ? styles.avgMid
                      : styles.avgLow,
                ]}>
                {myRankedRating != null ? myRankedRating.toFixed(1) : '—'}
              </Text>
              {myRankedPost.note?.trim() ? (
                <AutoFitText style={styles.myRankNote} numberOfLines={3} minimumFontScale={0.55}>
                  “{myRankedPost.note.trim()}”
                </AutoFitText>
              ) : null}
            </View>
            {photoUrlsFromPost(myRankedPost).length > 0 ? (
              <PostPhotoStrip
                urls={photoUrlsFromPost(myRankedPost)}
                maxHeight={160}
                imageHeaders={storageImageHeaders}
              />
            ) : null}
          </View>
        ) : myRadarPost ? (
          <View style={styles.radarBanner}>
            <Text style={styles.radarBannerText}>On your Want to Try list (not ranked yet)</Text>
          </View>
        ) : null}

        {errorMsg ? (
          <Text style={styles.inlineErr}>{errorMsg}</Text>
        ) : null}

        {showMacroNutrition && (macroSource != null || dietTagIds.length > 0) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Nutrition & tags</Text>
            {curated?.serving_label ? (
              <Text style={styles.serving}>{curated.serving_label}</Text>
            ) : null}
            {showMacroNutrition && macroSource ? (
              <View style={styles.macrosCenter}>
                <MacrosPills macros={macroSource} />
              </View>
            ) : null}
            {showMacroNutrition && dietTagIds.length > 0 ? (
              <View style={styles.dietRow}>
                {dietTagIds.map((id) => {
                  const t = DIET_TAGS.find((x) => x.id === id);
                  if (!t) return null;
                  return (
                    <View key={id} style={[styles.dietChip, { backgroundColor: t.bg }]}>
                      <Text style={[styles.dietChipText, { color: t.color }]}>{t.label}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
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
                imageHeaders={storageImageHeaders}
                onUser={(u) => router.push({ pathname: '/user/[username]', params: { username: u } })}
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
        {!myRankedPost ? (
          <Pressable
            onPress={toggleWant}
            disabled={wantBusy}
            style={[styles.btnSecondary, wantToTry && styles.btnSecondaryOn]}>
            <Text style={[styles.btnSecondaryText, wantToTry && styles.btnSecondaryTextOn]}>
              {wantToTry ? 'On Want to Try' : 'Want to Try'}
            </Text>
          </Pressable>
        ) : null}
      </View>
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
  imageHeaders,
  onUser,
}: {
  row: FeedPostRow;
  imageHeaders?: Record<string, string>;
  onUser: (username: string) => void;
}) {
  const username = row.profile?.username ?? 'unknown';
  const radar = isRadarOnlyDbRow(row);
  return (
    <View style={styles.reviewCard}>
      <Pressable onPress={() => onUser(username)} style={styles.reviewTop}>
        <Avatar char={(username || '?').charAt(0).toUpperCase()} color={row.profile?.avatar_color ?? BaggedColors.accent} size={36} />
        <View style={styles.reviewTopText}>
          <Text style={styles.reviewUser}>@{username}</Text>
          <Text style={styles.reviewTime}>{formatPostTime(row.created_at)}</Text>
        </View>
        {radar ? (
          <View style={styles.radarMini}>
            <Text style={styles.radarMiniText}>Want to try</Text>
          </View>
        ) : (
          <ScoreBadge rating={Number(row.rating ?? 0)} size={14} />
        )}
      </Pressable>
      {row.note?.trim() ? (
        <Text style={styles.reviewNote}>“{row.note.trim()}”</Text>
      ) : null}
      <PostPhotoStrip urls={photoUrlsFromPost(row)} maxHeight={160} imageHeaders={imageHeaders} />
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
  thumbLetter: { fontFamily: BaggedFonts.display, fontSize: 28, color: '#FFFFFF' },
  heroBody: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: '#FFFFFF',
    lineHeight: 27,
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
  heroLoading: { paddingVertical: 24, alignItems: 'center' },
  avgBlock: {
    marginHorizontal: 20,
    marginTop: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  avgNum: { fontFamily: BaggedFonts.display, fontSize: 28, color: '#FFFFFF' },
  avgNumMuted: {
    fontFamily: BaggedFonts.display,
    fontSize: 28,
    color: 'rgba(255,255,255,0.35)',
  },
  avgHigh: { color: BaggedColors.scoreHigh },
  avgMid: { color: BaggedColors.gold },
  avgLow: { color: '#F87171' },
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
    marginBottom: 8,
  },
  myRankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  /** Same display size / face as `avgNum` in the hero (no ring). */
  myRankScoreNum: {
    fontFamily: BaggedFonts.display,
    fontSize: 28,
  },
  myRankNote: {
    flex: 1,
    minWidth: 120,
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.dark,
    fontStyle: 'italic',
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
  },
  btnPrimaryText: {
    fontFamily: BaggedFonts.display,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnSecondary: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  btnSecondaryOn: {
    borderColor: BaggedColors.dark,
    backgroundColor: BaggedColors.dark,
  },
  btnSecondaryText: {
    fontFamily: BaggedFonts.display,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.onBg,
  },
  btnSecondaryTextOn: { color: '#FFFFFF' },
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
