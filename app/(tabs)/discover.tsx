import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { MacrosPills } from '@/components/bagged/macros-pills';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import { STORES, primaryGroceryStoreForKey } from '@/constants/grocery';
import { useDebounce } from '@/hooks/use-debounce';
import {
  addToWantToTry,
  fetchDiscoverExploreCurated,
  fetchDiscoverNewReleases,
  fetchDiscoverTopWantToTry,
  fetchDiscoverTrendingThisWeek,
  DISCOVER_NEW_RELEASE_RETENTION_DAYS,
  getUserRankings,
  isRadarOnlyDbRow,
  normalizedDescriptionKeyFromItem,
  rankKeyPair,
  rateMacroFormFromNumbers,
  rateMacroFormHasAny,
  type DiscoverExploreRow,
  type DiscoverNewReleaseRow,
  type DiscoverTrendingRow,
  type DiscoverWantToTryRow,
} from '@/lib/data';
import { formatProductDisplayName } from '@/lib/format';
import { CATEGORIES, type Category } from '@/lib/ranking';
import { useAuth } from '@/providers/auth-provider';
import { useDisplaySettings } from '@/providers/display-settings-provider';

const ALL_STORES = 'All Stores';
/** Collapsed New Releases rail — tap section header to show all (within 7-day window). */
const NEW_RELEASES_COLLAPSED_COUNT = 3;
/** Curated explore list caps (higher than web so mobile shows a longer scroll). */
const EXPLORE_BROWSE_LIMIT = 150;
const EXPLORE_SEARCH_LIMIT = 100;

type DiscoverStoreFilter = typeof ALL_STORES | (typeof STORES)[number];

function storeForRow(maybe: string | null | undefined): string {
  const s = String(maybe ?? '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === 'none' || lower === 'n/a') return '';
  return s;
}

export default function DiscoverScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const { showMacroNutrition } = useDisplaySettings();

  const [discoverStore, setDiscoverStore] = useState<DiscoverStoreFilter>(ALL_STORES);
  const [discoverDiet, setDiscoverDiet] = useState<string | null>(null);
  const [discoverCategory, setDiscoverCategory] = useState<Category | null>(null);

  const [exploreOpen, setExploreOpen] = useState(false);
  const [exploreQuery, setExploreQuery] = useState('');
  const debouncedExploreQuery = useDebounce(exploreQuery, 400);

  const [exploreLoadingCatalog, setExploreLoadingCatalog] = useState(false);
  const [exploreCatalogRows, setExploreCatalogRows] = useState<DiscoverExploreRow[]>([]);
  const [exploreLoadingSearch, setExploreLoadingSearch] = useState(false);
  const [exploreSearchRows, setExploreSearchRows] = useState<DiscoverExploreRow[]>([]);

  const [newReleases, setNewReleases] = useState<DiscoverNewReleaseRow[]>([]);
  const [newReleasesExpanded, setNewReleasesExpanded] = useState(false);
  const [trending, setTrending] = useState<DiscoverTrendingRow[]>([]);
  const [wantTop, setWantTop] = useState<DiscoverWantToTryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rankedKeySet, setRankedKeySet] = useState<Set<string>>(() => new Set());

  const refreshRankedKeys = useCallback(async () => {
    if (!userId) {
      setRankedKeySet(new Set());
      return;
    }
    try {
      const rows = await getUserRankings(userId);
      setRankedKeySet(
        new Set(
          rows
            .filter((r) => !isRadarOnlyDbRow(r))
            .map((r) => rankKeyPair(r.item, primaryGroceryStoreForKey(r)))
        )
      );
    } catch {
      setRankedKeySet(new Set());
    }
  }, [userId]);

  const exploreBrowseActive =
    discoverStore !== ALL_STORES || !!discoverDiet || !!discoverCategory;

  const dietLabel = useMemo(() => {
    const diet = DIET_TAGS.find((t) => t.id === discoverDiet);
    return diet ? diet.label : 'Any diet';
  }, [discoverDiet]);

  const exploreToggleLabel = useMemo(() => {
    const storeLabel = discoverStore === ALL_STORES ? 'All stores' : discoverStore;
    const dietSeg = discoverDiet ? ` · ${dietLabel}` : '';
    const catSeg = discoverCategory ? ` · ${discoverCategory}` : '';
    return `Explore · ${storeLabel}${dietSeg}${catSeg}`;
  }, [discoverStore, discoverDiet, discoverCategory, dietLabel]);

  useEffect(() => {
    setNewReleasesExpanded(false);
  }, [discoverStore, discoverDiet]);

  const newReleasesCanExpand = newReleases.length > NEW_RELEASES_COLLAPSED_COUNT;
  const displayedNewReleases = useMemo(() => {
    if (!newReleasesCanExpand || newReleasesExpanded) return newReleases;
    return newReleases.slice(0, NEW_RELEASES_COLLAPSED_COUNT);
  }, [newReleases, newReleasesCanExpand, newReleasesExpanded]);

  const load = useCallback(async () => {
    const dietTag = discoverDiet ?? '';
    const [nr, tr, wt] = await Promise.allSettled([
      fetchDiscoverNewReleases({ limit: 36, store: discoverStore, dietTag }),
      fetchDiscoverTrendingThisWeek({ limit: 8, store: discoverStore, dietTag }),
      fetchDiscoverTopWantToTry({ limit: 8, store: discoverStore }),
    ]);
    setNewReleases(nr.status === 'fulfilled' ? nr.value : []);
    setTrending(tr.status === 'fulfilled' ? tr.value : []);
    setWantTop(wt.status === 'fulfilled' ? wt.value : []);
  }, [discoverStore, discoverDiet]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      Promise.all([load(), refreshRankedKeys()])
        .catch((err) => console.warn('discover load:', err))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [load, refreshRankedKeys])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), refreshRankedKeys()]);
    } catch (err) {
      console.warn('discover refresh:', err);
    }
    setRefreshing(false);
  }, [load, refreshRankedKeys]);

  useEffect(() => {
    if (!exploreOpen || !exploreBrowseActive) {
      setExploreCatalogRows([]);
      setExploreLoadingCatalog(false);
      return;
    }

    let cancelled = false;
    setExploreLoadingCatalog(true);

    const run = async () => {
      try {
        const rows = await fetchDiscoverExploreCurated({
          store: discoverStore,
          dietTag: discoverDiet ?? '',
          category: discoverCategory ?? undefined,
          query: '',
          limit: EXPLORE_BROWSE_LIMIT,
        });
        if (cancelled) return;
        setExploreCatalogRows(Array.isArray(rows) ? rows : []);
      } catch (e) {
        if (cancelled) return;
        console.warn('fetchDiscoverExploreCurated (browse):', e);
        setExploreCatalogRows([]);
      } finally {
        if (!cancelled) setExploreLoadingCatalog(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [exploreOpen, exploreBrowseActive, discoverStore, discoverDiet, discoverCategory]);

  useEffect(() => {
    if (!exploreOpen || exploreBrowseActive) {
      setExploreSearchRows([]);
      setExploreLoadingSearch(false);
      return;
    }

    const q = debouncedExploreQuery.trim();
    if (q.length < 2) {
      setExploreSearchRows([]);
      setExploreLoadingSearch(false);
      return;
    }

    let cancelled = false;
    setExploreLoadingSearch(true);

    const run = async () => {
      try {
        const rows = await fetchDiscoverExploreCurated({
          store: discoverStore,
          dietTag: discoverDiet ?? '',
          category: discoverCategory ?? undefined,
          query: q,
          limit: EXPLORE_SEARCH_LIMIT,
        });
        if (cancelled) return;
        setExploreSearchRows(Array.isArray(rows) ? rows : []);
      } catch (e) {
        if (cancelled) return;
        console.warn('fetchDiscoverExploreCurated (search):', e);
        setExploreSearchRows([]);
      } finally {
        if (!cancelled) setExploreLoadingSearch(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [exploreOpen, exploreBrowseActive, debouncedExploreQuery, discoverStore, discoverDiet, discoverCategory]);

  const exploreDisplayRows = useMemo(() => {
    if (!exploreOpen) return [];
    if (exploreBrowseActive) {
      const q = exploreQuery.trim().toLowerCase();
      if (!q) return exploreCatalogRows;
      return exploreCatalogRows.filter((row) => {
        const title = String(row?.description ?? '').toLowerCase();
        const brand = String(row?.brandOwner ?? row?.brandName ?? '').toLowerCase();
        return title.includes(q) || brand.includes(q);
      });
    }
    if (debouncedExploreQuery.trim().length < 2) return [];
    return exploreSearchRows;
  }, [
    exploreOpen,
    exploreBrowseActive,
    exploreCatalogRows,
    exploreSearchRows,
    exploreQuery,
    debouncedExploreQuery,
  ]);

  const exploreLoading = exploreBrowseActive ? exploreLoadingCatalog : exploreLoadingSearch;

  const openProduct = (p: {
    item: string;
    brand: string;
    category: string;
    store?: string;
    descriptionKey?: string;
  }) => {
    const dk =
      String(p.descriptionKey ?? '').trim().toLowerCase() ||
      normalizedDescriptionKeyFromItem(p.item);
    router.push({
      pathname: '/product/detail',
      params: {
        item: p.item,
        brand: p.brand,
        category: p.category,
        store: p.store ?? '',
        descriptionKey: dk,
      },
    });
  };

  const openExploreRow = (row: DiscoverExploreRow) => {
    const title = row.description;
    const store = storeForRow(row.stores?.[0] ?? row.store);
    openProduct({
      item: title,
      brand: row.brandOwner || row.brandName,
      category: String(row.foodCategory ?? '').trim(),
      store,
      descriptionKey: row.descriptionKey,
    });
  };

  const rankFromExploreRow = (row: DiscoverExploreRow) => {
    const rateParams: Record<string, string> = {
      prefilledItem: row.description,
      prefilledBrand: row.brandOwner || row.brandName || '',
    };
    const fc = String(row.foodCategory ?? '').trim();
    if (fc) rateParams.prefilledCategory = fc;
    const auto = rateMacroFormFromNumbers({
      cal: row.cal,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      servingLabel: row.servingLabel,
    });
    if (rateMacroFormHasAny(auto)) {
      if (auto.cal) rateParams.prefilledMacroCal = auto.cal;
      if (auto.protein) rateParams.prefilledMacroProtein = auto.protein;
      if (auto.carbs) rateParams.prefilledMacroCarbs = auto.carbs;
      if (auto.fat) rateParams.prefilledMacroFat = auto.fat;
      if (auto.servingLabel) rateParams.prefilledMacroServing = auto.servingLabel;
    }
    router.push({
      pathname: '/rate',
      params: rateParams,
    });
  };

  const wantFromExploreRow = async (row: DiscoverExploreRow) => {
    if (!userId) {
      Alert.alert('Sign in', 'Log in to use Want to Try.');
      return;
    }
    const store = storeForRow(row.stores?.[0] ?? row.store);
    try {
      await addToWantToTry(userId, {
        item: row.description,
        store: store || 'General',
        emoji: '',
        category: row.foodCategory || 'Snacks',
        productBrand: row.brandOwner || row.brandName || null,
      });
      Alert.alert('Saved', 'Added to your Want to Try list.');
    } catch (err) {
      console.warn('explore want:', err);
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Try again.');
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <View style={styles.headerRow}>
        <View style={styles.headerTextBlock}>
          <Text style={styles.brand}>Discover</Text>
          <Text style={styles.headerSub}>Trending in the bagged community</Text>
        </View>
        <Pressable
          onPress={() => setExploreOpen((v) => !v)}
          style={[styles.exploreToggle, exploreOpen && styles.exploreToggleOn]}>
          <AutoFitText
            style={[styles.exploreToggleText, exploreOpen && styles.exploreToggleTextOn]}
            numberOfLines={1}
            minimumFontScale={0.65}>
            {exploreOpen ? 'Hide Explore' : exploreToggleLabel}
          </AutoFitText>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BaggedColors.dark} />
        }>
        {exploreOpen ? (
          <View style={styles.exploreCard}>
            <Text style={styles.exploreCardTitle}>Explore</Text>

            <TextInput
              value={exploreQuery}
              onChangeText={setExploreQuery}
              placeholder={
                exploreBrowseActive
                  ? 'Search within this list…'
                  : 'Search the full curated catalog (2+ letters)…'
              }
              placeholderTextColor={BaggedColors.muted}
              style={styles.exploreSearchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />

            <Text style={styles.filterLabel}>Store</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {([ALL_STORES, ...STORES] as DiscoverStoreFilter[]).map((s) => {
                const active = discoverStore === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setDiscoverStore(s)}
                    style={[styles.storeChip, active && styles.storeChipActive]}>
                    <Text style={[styles.storeChipText, active && styles.storeChipTextActive]}>{s}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.filterLabel}>Diet</Text>
            <View style={styles.dietWrap}>
              <Pressable
                onPress={() => setDiscoverDiet(null)}
                style={[styles.dietChip, !discoverDiet && styles.dietChipActiveDark]}>
                <Text style={[styles.dietChipText, !discoverDiet && styles.dietChipTextActiveDark]}>Any</Text>
              </Pressable>
              {DIET_TAGS.map((tag) => {
                const active = discoverDiet === tag.id;
                return (
                  <Pressable
                    key={tag.id}
                    onPress={() => setDiscoverDiet(active ? null : tag.id)}
                    style={[
                      styles.dietChip,
                      active && { borderColor: tag.color, backgroundColor: tag.bg },
                    ]}>
                    <Text
                      style={[
                        styles.dietChipText,
                        active && { color: tag.color, fontWeight: '700' },
                      ]}>
                      {tag.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.filterLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <Pressable
                onPress={() => setDiscoverCategory(null)}
                style={[styles.storeChip, discoverCategory === null && styles.storeChipActive]}>
                <Text
                  style={[styles.storeChipText, discoverCategory === null && styles.storeChipTextActive]}>
                  Any
                </Text>
              </Pressable>
              {CATEGORIES.map((c) => {
                const active = discoverCategory === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setDiscoverCategory(active ? null : c)}
                    style={[styles.storeChip, active && styles.storeChipActive]}>
                    <Text style={[styles.storeChipText, active && styles.storeChipTextActive]}>{c}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {exploreLoading ? (
              <View style={styles.exploreLoadingBox}>
                <ActivityIndicator color={BaggedColors.dark} />
                <Text style={styles.exploreLoadingText}>Loading…</Text>
              </View>
            ) : null}

            {!exploreLoading && exploreBrowseActive && exploreCatalogRows.length === 0 ? (
              <Text style={styles.exploreHint}>No curated picks for this filter yet.</Text>
            ) : null}

            {!exploreLoading &&
            exploreBrowseActive &&
            exploreCatalogRows.length > 0 &&
            exploreDisplayRows.length === 0 ? (
              <Text style={styles.exploreHint}>No matches in this list — try a different search.</Text>
            ) : null}

            {!exploreLoading && !exploreBrowseActive && debouncedExploreQuery.trim().length < 2 ? (
              <Text style={styles.exploreHint}>
                Choose a store, diet, or category to see picks, or type at least 2 characters to search everything.
              </Text>
            ) : null}

            {!exploreLoading &&
            !exploreBrowseActive &&
            debouncedExploreQuery.trim().length >= 2 &&
            exploreSearchRows.length === 0 ? (
              <Text style={styles.exploreHint}>No matches.</Text>
            ) : null}

            {!exploreLoading
              ? exploreDisplayRows.map((row, idx) => {
                  const title = row.description;
                  const store = storeForRow(row.stores?.[0] ?? row.store);
                  const viewerHasRankedExplore = rankedKeySet.has(
                    rankKeyPair(title, primaryGroceryStoreForKey(row))
                  );
                  return (
                    <View
                      key={`${row.descriptionKey || normalizedDescriptionKeyFromItem(title)}-${idx}`}
                      style={styles.exploreResultCard}>
                      <Pressable onPress={() => openExploreRow(row)} style={styles.exploreResultMain}>
                        <View style={styles.thumb}>
                          <Text style={styles.thumbInitial}>{(title.charAt(0) || '?').toUpperCase()}</Text>
                        </View>
                        <View style={styles.cardBody}>
                          <AutoFitText style={styles.exploreResultTitle} numberOfLines={2}>
                            {formatProductDisplayName(title)}
                          </AutoFitText>
                          {row.brandOwner || row.brandName ? (
                            <AutoFitText style={styles.exploreResultBrand} numberOfLines={1}>
                              {formatProductDisplayName(row.brandOwner || row.brandName)}
                            </AutoFitText>
                          ) : null}
                          <View style={styles.exploreMetaRow}>
                            {store ? (
                              <View style={styles.lightPill}>
                                <Text style={styles.lightPillText}>{store}</Text>
                              </View>
                            ) : null}
                            {row.foodCategory?.trim() ? (
                              <View style={styles.lightPill}>
                                <Text style={styles.lightPillText}>{row.foodCategory}</Text>
                              </View>
                            ) : null}
                          </View>
                          {showMacroNutrition && (row.cal != null || row.protein != null) ? (
                            <MacrosPills
                              macros={{
                                cal: row.cal ?? null,
                                protein: row.protein ?? null,
                                carbs: row.carbs ?? null,
                                fat: row.fat ?? null,
                              }}
                              size="sm"
                            />
                          ) : null}
                          {row.dietTags.length > 0 ? (
                            <View style={styles.exploreDietRow}>
                              {row.dietTags.map((id) => {
                                const t = DIET_TAGS.find((x) => x.id === id);
                                if (!t) return null;
                                return (
                                  <View key={id} style={[styles.miniDietChip, { backgroundColor: t.bg }]}>
                                    <Text style={[styles.miniDietChipText, { color: t.color }]}>{t.label}</Text>
                                  </View>
                                );
                              })}
                            </View>
                          ) : null}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={BaggedColors.muted} />
                      </Pressable>
                      <View style={styles.exploreActions}>
                        <Pressable onPress={() => rankFromExploreRow(row)} style={styles.exploreActionBtnDark}>
                          <Text style={styles.exploreActionBtnDarkText}>Rate</Text>
                        </Pressable>
                        {viewerHasRankedExplore ? null : (
                          <Pressable onPress={() => wantFromExploreRow(row)} style={styles.exploreActionBtnOutline}>
                            <Text style={styles.exploreActionBtnOutlineText}>Want to Try</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })
              : null}
          </View>
        ) : null}

        {loading && newReleases.length === 0 && trending.length === 0 && wantTop.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator color={BaggedColors.dark} />
          </View>
        ) : null}

        {newReleasesCanExpand ? (
          <Pressable
            onPress={() => setNewReleasesExpanded((v) => !v)}
            style={({ pressed }) => [styles.expandableSectionHeader, pressed && styles.cardPressed]}
            accessibilityRole="button"
            accessibilityLabel={newReleasesExpanded ? 'Collapse new releases' : 'Expand new releases'}>
            <View style={styles.expandableSectionHeaderText}>
              <Text style={styles.expandableSectionTitle}>New Releases</Text>
              <Text style={styles.expandableSectionSub}>
                Curated picks · drop off after {DISCOVER_NEW_RELEASE_RETENTION_DAYS} days
              </Text>
            </View>
            <Ionicons
              name={newReleasesExpanded ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={BaggedColors.dark}
            />
          </Pressable>
        ) : (
          <View style={styles.newReleasesStaticHeader}>
            <Text style={styles.sectionHeader}>New Releases</Text>
            <Text style={styles.expandableSectionSub}>
              Curated picks · drop off after {DISCOVER_NEW_RELEASE_RETENTION_DAYS} days
            </Text>
          </View>
        )}
        {newReleases.length === 0 && !loading ? (
          <EmptyHint
            message={`No curated new releases in the last ${DISCOVER_NEW_RELEASE_RETENTION_DAYS} days for this filter yet.`}
          />
        ) : null}
        {displayedNewReleases.map((row) => (
          <Pressable
            key={`nr-${row.descriptionKey}`}
            onPress={() =>
              openProduct({
                item: row.description,
                brand: row.brandOwner || row.brandName,
                category: String(row.foodCategory ?? '').trim(),
                store: row.store,
                descriptionKey: row.descriptionKey,
              })
            }
            style={({ pressed }) => [styles.lightCard, pressed && styles.cardPressed]}>
            <View style={styles.lightTopRow}>
              <View style={styles.thumb}>
                <Text style={styles.thumbInitial}>{(row.description.charAt(0) || '?').toUpperCase()}</Text>
              </View>
              <View style={styles.cardBody}>
                <AutoFitText style={styles.lightTitle} numberOfLines={2}>
                  {formatProductDisplayName(row.description)}
                </AutoFitText>
                {row.brandOwner || row.brandName ? (
                  <AutoFitText style={styles.lightBrand} numberOfLines={1}>
                    {formatProductDisplayName(row.brandOwner || row.brandName)}
                  </AutoFitText>
                ) : null}
                <View style={styles.lightMetaRow}>
                  <View style={styles.lightPill}>
                    <Text style={styles.lightPillTextStrong}>New</Text>
                  </View>
                  {row.foodCategory?.trim() ? (
                    <View style={styles.lightPill}>
                      <Text style={styles.lightPillText}>{row.foodCategory}</Text>
                    </View>
                  ) : null}
                  {row.store ? (
                    <View style={styles.lightPill}>
                      <Text style={styles.lightPillText}>{row.store}</Text>
                    </View>
                  ) : null}
                </View>
                {showMacroNutrition && (row.cal != null || row.protein != null) ? (
                  <MacrosPills
                    macros={{
                      cal: row.cal ?? null,
                      protein: row.protein ?? null,
                      carbs: row.carbs ?? null,
                      fat: row.fat ?? null,
                    }}
                    size="sm"
                  />
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={BaggedColors.muted} />
            </View>
          </Pressable>
        ))}
        {newReleasesCanExpand && !newReleasesExpanded ? (
          <Text style={styles.newReleasesCollapsedHint}>
            +{newReleases.length - NEW_RELEASES_COLLAPSED_COUNT} more — tap header above
          </Text>
        ) : null}

        <SectionHeader label="Trending This Week" style={{ marginTop: 24 }} />
        {trending.length === 0 && !loading ? (
          <EmptyHint message="No rankings posted in the last 7 days for this filter." />
        ) : null}
        {trending.map((row) => (
          <Pressable
            key={`trend-${row.key}`}
            onPress={() =>
              openProduct({
                item: row.item,
                brand: row.brand,
                category: row.category,
                store: row.store,
              })
            }
            style={({ pressed }) => [styles.trendingCard, pressed && styles.cardPressed]}>
            <View style={styles.trendingTopRow}>
              <View style={styles.thumb}>
                <Text style={styles.thumbInitial}>{(row.item.charAt(0) || '?').toUpperCase()}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.trendingEyebrow}>
                  {row.rankerCount} ranker{row.rankerCount === 1 ? '' : 's'}
                </Text>
                <AutoFitText style={styles.trendingTitle} numberOfLines={2}>
                  {formatProductDisplayName(row.item)}
                </AutoFitText>
                {row.brand ? (
                  <AutoFitText style={styles.trendingBrand} numberOfLines={1}>
                    {formatProductDisplayName(row.brand)} · {row.category}
                  </AutoFitText>
                ) : (
                  <AutoFitText style={styles.trendingBrand} numberOfLines={1}>
                    {row.category}
                  </AutoFitText>
                )}
                <View style={styles.trendingMetaRow}>
                  {row.store ? (
                    <View style={styles.darkPill}>
                      <Text style={styles.darkPillText}>{row.store}</Text>
                    </View>
                  ) : null}
                  <View style={styles.darkPill}>
                    <Text style={styles.darkPillText}>avg {row.avgRating > 0 ? row.avgRating.toFixed(1) : '—'}</Text>
                  </View>
                </View>
                {showMacroNutrition && row.macros ? <MacrosPills macros={row.macros} size="sm" /> : null}
              </View>
            </View>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                openProduct({
                  item: row.item,
                  brand: row.brand,
                  category: row.category,
                  store: row.store,
                });
              }}
              hitSlop={6}
              style={styles.rankBtnLight}>
              <Text style={styles.rankBtnLightText}>View product</Text>
            </Pressable>
          </Pressable>
        ))}

        <SectionHeader label="Trending in Want to Try" style={{ marginTop: 24 }} />
        {wantTop.length === 0 && !loading ? (
          <EmptyHint message="No want-to-try items for this filter yet." />
        ) : null}
        {wantTop.map((row) => (
          <Pressable
            key={`wt-${row.key}`}
            onPress={() =>
              openProduct({
                item: row.item,
                brand: row.brand,
                category: row.category,
                store: row.store,
              })
            }
            style={({ pressed }) => [styles.lightCard, pressed && styles.cardPressed]}>
            <View style={styles.lightTopRow}>
              <View style={styles.thumb}>
                <Text style={styles.thumbInitial}>{(row.item.charAt(0) || '?').toUpperCase()}</Text>
              </View>
              <View style={styles.cardBody}>
                <AutoFitText style={styles.lightTitle} numberOfLines={2}>
                  {formatProductDisplayName(row.item)}
                </AutoFitText>
                {row.brand ? (
                  <AutoFitText style={styles.lightBrand} numberOfLines={1}>
                    {formatProductDisplayName(row.brand)}
                  </AutoFitText>
                ) : null}
                <View style={styles.lightMetaRow}>
                  <View style={styles.accentPill}>
                    <Text style={styles.accentPillText}>
                      {row.rankerCount} want{row.rankerCount === 1 ? '' : 's'} to try
                    </Text>
                  </View>
                  {row.store ? (
                    <View style={styles.lightPill}>
                      <Text style={styles.lightPillText}>{row.store}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={BaggedColors.muted} />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ label, style }: { label: string; style?: object }) {
  return <Text style={[styles.sectionHeader, style]}>{label}</Text>;
}

function EmptyHint({ message }: { message: string }) {
  return <Text style={styles.emptyHint}>{message}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BaggedColors.content },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerTextBlock: { flex: 1, minWidth: 0 },
  brand: {
    fontFamily: BaggedFonts.display,
    fontSize: 28,
    color: BaggedColors.dark,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    fontWeight: '500',
    marginTop: 2,
  },
  exploreToggle: {
    maxWidth: '48%',
    minWidth: 0,
    flexShrink: 1,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  exploreToggleOn: {
    backgroundColor: BaggedColors.dark,
    borderColor: BaggedColors.dark,
  },
  exploreToggleText: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.dark,
    textAlign: 'center',
  },
  exploreToggleTextOn: {
    color: '#FFFFFF',
  },
  exploreCard: {
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  exploreCardTitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '800',
    color: BaggedColors.dark,
    marginBottom: 10,
  },
  exploreSearchInput: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.dark,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderRadius: 12,
    backgroundColor: BaggedColors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  filterLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '800',
    color: BaggedColors.muted,
    marginBottom: 7,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 6,
    paddingBottom: 12,
  },
  dietWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  dietChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    marginBottom: 8,
  },
  dietChipActiveDark: {
    backgroundColor: BaggedColors.dark,
    borderColor: BaggedColors.dark,
  },
  dietChipText: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '500',
    color: BaggedColors.muted,
  },
  dietChipTextActiveDark: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  storeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
  },
  storeChipActive: {
    backgroundColor: BaggedColors.dark,
    borderColor: BaggedColors.dark,
  },
  storeChipText: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
  storeChipTextActive: {
    color: '#FFFFFF',
  },
  exploreLoadingBox: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  exploreLoadingText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
  },
  exploreHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    textAlign: 'center',
    paddingVertical: 12,
    fontStyle: 'italic',
  },
  exploreResultCard: {
    backgroundColor: BaggedColors.card,
    borderWidth: 1,
    borderColor: BaggedColors.border,
    borderLeftWidth: 4,
    borderLeftColor: BaggedColors.accent,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  exploreResultMain: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  exploreResultTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  exploreResultBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.muted,
    marginTop: 2,
  },
  exploreMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  exploreDietRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
  },
  miniDietChip: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  miniDietChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    fontWeight: '600',
  },
  exploreActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  exploreActionBtnDark: {
    backgroundColor: BaggedColors.dark,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  exploreActionBtnDarkText: {
    fontFamily: BaggedFonts.display,
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  exploreActionBtnOutline: {
    borderWidth: 1.5,
    borderColor: BaggedColors.dark,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  exploreActionBtnOutlineText: {
    fontFamily: BaggedFonts.display,
    fontSize: 11,
    fontWeight: '800',
    color: BaggedColors.dark,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32 + BaggedLayout.rateFabListInset,
    paddingTop: 4,
  },
  centered: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  sectionHeader: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 10,
  },
  expandableSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
    marginBottom: 10,
  },
  expandableSectionHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  expandableSectionTitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  expandableSectionSub: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    fontWeight: '500',
    marginTop: 4,
    lineHeight: 16,
  },
  newReleasesStaticHeader: {
    marginBottom: 10,
  },
  newReleasesCollapsedHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    fontStyle: 'italic',
    marginTop: -4,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  emptyHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    paddingVertical: 8,
    paddingHorizontal: 4,
    fontStyle: 'italic',
  },
  cardPressed: { opacity: 0.85 },

  trendingCard: {
    backgroundColor: BaggedColors.dark,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: BaggedColors.accent,
    padding: 14,
    marginBottom: 10,
  },
  trendingTopRow: {
    flexDirection: 'row',
    gap: 12,
  },
  trendingEyebrow: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  trendingTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 19,
    color: '#FFFFFF',
    lineHeight: 24,
  },
  trendingBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
  },
  trendingMetaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  darkPill: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 16,
  },
  darkPillText: {
    fontFamily: BaggedFonts.display,
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  rankBtnLight: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: BaggedColors.accentPale,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  rankBtnLightText: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.accent,
  },

  lightCard: {
    backgroundColor: BaggedColors.card,
    borderWidth: 1,
    borderColor: BaggedColors.border,
    borderLeftWidth: 4,
    borderLeftColor: BaggedColors.accent,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  lightTopRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  lightTitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  lightBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    marginTop: 2,
  },
  lightMetaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  lightPill: {
    backgroundColor: '#F4F2EC',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  lightPillText: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
  lightPillTextStrong: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  accentPill: {
    backgroundColor: BaggedColors.accentPale,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  accentPillText: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbInitial: {
    fontFamily: BaggedFonts.display,
    fontSize: 20,
    color: BaggedColors.dark,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
});
