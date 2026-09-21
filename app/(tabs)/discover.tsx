import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { PostNoteEditorModal } from '@/components/bagged/post-note-editor-modal';
import { ALL_STORES, rowMatchesDietFilters } from '@/components/bagged/filter-bar';
import {
  getParentCategoryById,
  getSubcategoriesForParent,
  legacyCategoryForSubcategory,
  PARENT_CATEGORIES,
  mapLegacyCategoryToSubcategory,
} from '@/constants/categories';
import { MacrosPills } from '@/components/bagged/macros-pills';
import { ScoreBadge } from '@/components/bagged/score-badge';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import { STORES, displayStoreForRow, primaryGroceryStoreForKey } from '@/constants/grocery';
import { useDebounce } from '@/hooks/use-debounce';
import {
  useWantToTryCaption,
  wantToTryCaptionProductLabel,
} from '@/hooks/use-want-to-try-caption';
import {
  fetchCuratedProductTagsByDescription,
  fetchDiscoverExploreCurated,
  fetchDiscoverExploreSearch,
  fetchDiscoverNewReleases,
  fetchDiscoverTrendingThisWeek,
  DISCOVER_NEW_RELEASE_RETENTION_DAYS,
  ensureUserPostForProductPhotos,
  getUserRankings,
  getWantToTry,
  isAdminUsername,
  isRadarOnlyDbRow,
  markCuratedProductAsNewRelease,
  updateCuratedNewRelease,
  normalizeDiscoverExploreMacros,
  normalizePostMacros,
  normalizedDescriptionKeyFromItem,
  productDescriptionKey,
  resolveProductDescriptionKey,
  rankKeyPair,
  rateMacroFormFromNumbers,
  rateMacroFormHasAny,
  rateMacroFormFieldToOptionalNumber,
  rateMacroFormToPrefillParams,
  searchProducts,
  searchRowBrand,
  type DiscoverExploreRow,
  type DiscoverNewReleaseRow,
  type DiscoverTrendingRow,
  type SearchProductRow,
  type WantToTryItem,
} from '@/lib/data';
import { pokeFeedRefresh, setDiscoverRefreshListener } from '@/lib/feed-refresh-poke';
import { formatProductDisplayName } from '@/lib/format';
import { removeWantToTryWithFeed } from '@/lib/want-to-try-feed';
import { CATEGORIES, mapCategory, type Category } from '@/lib/ranking';
import { useAuth } from '@/providers/auth-provider';
import { useDisplaySettings } from '@/providers/display-settings-provider';

/** Curated explore list caps (higher than web so mobile shows a longer scroll). */
const EXPLORE_BROWSE_LIMIT = 150;
const EXPLORE_SEARCH_LIMIT = 100;

type DiscoverStoreFilter = typeof ALL_STORES | (typeof STORES)[number];

function DiscoverAvgScoreThumb({ avg }: { avg: number | null | undefined }) {
  const hasAvg = avg != null && Number.isFinite(avg) && avg > 0;
  return (
    <View style={styles.thumb}>
      {hasAvg ? (
        <ScoreBadge score={avg} size={14} />
      ) : (
        <Text style={styles.thumbEmpty}>—</Text>
      )}
    </View>
  );
}

function DiscoverSectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionBlockHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function FilterSectionToggle({
  label,
  expanded,
  onPress,
}: {
  label: string;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.filterToggleRow}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${label} filter`}>
      <Text style={styles.filterToggleLabel}>{label}</Text>
      <Ionicons
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={14}
        color={BaggedColors.muted}
      />
    </Pressable>
  );
}

function DiscoverFilterPanel({
  store,
  onStoreChange,
  diets,
  onToggleDiet,
  onClearDiets,
  parentCategoryId,
  onParentCategoryChange,
  subcategoryId,
  onSubcategoryChange,
  showCategory = false,
}: {
  store: DiscoverStoreFilter;
  onStoreChange: (s: DiscoverStoreFilter) => void;
  diets: string[];
  onToggleDiet: (dietId: string) => void;
  onClearDiets: () => void;
  parentCategoryId?: string | null;
  onParentCategoryChange?: (id: string | null) => void;
  subcategoryId?: string | null;
  onSubcategoryChange?: (id: string | null) => void;
  showCategory?: boolean;
}) {
  const [storeExpanded, setStoreExpanded] = useState(false);
  const [dietExpanded, setDietExpanded] = useState(false);
  const [categoryExpanded, setCategoryExpanded] = useState(false);
  const [subcategoryExpanded, setSubcategoryExpanded] = useState(false);

  return (
    <View style={styles.filterPanel}>
      <FilterSectionToggle
        label="Store"
        expanded={storeExpanded}
        onPress={() => setStoreExpanded((open) => !open)}
      />
      {storeExpanded ? (
        <View style={styles.filterChipWrap}>
          {([ALL_STORES, ...STORES] as DiscoverStoreFilter[]).map((s) => {
            const active = store === s;
            return (
              <Pressable
                key={s}
                onPress={() => onStoreChange(s)}
                style={[styles.storeChip, active && styles.storeChipActive]}>
                <Text style={[styles.storeChipText, active && styles.storeChipTextActive]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <FilterSectionToggle
        label="Diet"
        expanded={dietExpanded}
        onPress={() => setDietExpanded((open) => !open)}
      />
      {dietExpanded ? (
        <View style={styles.filterChipWrap}>
          <Pressable
            onPress={onClearDiets}
            style={[styles.storeChip, diets.length === 0 && styles.storeChipActive]}>
            <Text style={[styles.storeChipText, diets.length === 0 && styles.storeChipTextActive]}>
              Any
            </Text>
          </Pressable>
          {DIET_TAGS.map((tag) => {
            const active = diets.includes(tag.id);
            return (
              <Pressable
                key={tag.id}
                onPress={() => onToggleDiet(tag.id)}
                style={[styles.storeChip, active && styles.storeChipActive]}>
                <Text style={[styles.storeChipText, active && styles.storeChipTextActive]}>
                  {tag.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {showCategory && onParentCategoryChange ? (
        <>
          <FilterSectionToggle
            label="Category"
            expanded={categoryExpanded}
            onPress={() => setCategoryExpanded((open) => !open)}
          />
          {categoryExpanded ? (
            <View style={styles.filterChipWrap}>
              <Pressable
                onPress={() => {
                  onParentCategoryChange(null);
                  onSubcategoryChange?.(null);
                }}
                style={[styles.storeChip, !parentCategoryId && styles.storeChipActive]}>
                <Text style={[styles.storeChipText, !parentCategoryId && styles.storeChipTextActive]}>
                  Any
                </Text>
              </Pressable>
              {PARENT_CATEGORIES.map((parent) => {
                const active = parentCategoryId === parent.id;
                return (
                  <Pressable
                    key={parent.id}
                    onPress={() => {
                      onParentCategoryChange(active ? null : parent.id);
                      onSubcategoryChange?.(null);
                    }}
                    style={[styles.storeChip, active && styles.storeChipActive]}>
                    <Text style={[styles.storeChipText, active && styles.storeChipTextActive]}>
                      {parent.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {parentCategoryId ? (
            <>
              <FilterSectionToggle
                label="Subcategory"
                expanded={subcategoryExpanded}
                onPress={() => setSubcategoryExpanded((open) => !open)}
              />
              {subcategoryExpanded ? (
                <View style={styles.filterChipWrap}>
                  {getSubcategoriesForParent(parentCategoryId).map((sub) => {
                    const active = subcategoryId === sub.id;
                    return (
                      <Pressable
                        key={sub.id}
                        onPress={() => onSubcategoryChange?.(active ? null : sub.id)}
                        style={[styles.storeChip, active && styles.storeChipActive]}>
                        <Text style={[styles.storeChipText, active && styles.storeChipTextActive]}>
                          {sub.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function trendingActivityLabel(row: DiscoverTrendingRow): string {
  const parts: string[] = [];
  if (row.rankerCount > 0) {
    parts.push(`${row.rankerCount} ranked`);
  }
  if (row.wantCount > 0) {
    parts.push(`${row.wantCount} want to try`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Trending this week';
}

type DiscoverProductInput = {
  item: string;
  brand?: string;
  category?: string;
  descriptionKey?: string;
  store?: string;
  stores?: string[];
  dietTags?: string[];
  cal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  servingLabel?: string | null;
  nutritionVerified?: boolean;
};

function discoverProductWantKey(p: Pick<DiscoverProductInput, 'item' | 'store' | 'stores' | 'brand'>) {
  return rankKeyPair(
    p.item,
    primaryGroceryStoreForKey({
      store: p.store,
      stores: p.stores,
      product_brand: p.brand,
    }),
    p.brand
  );
}

function DiscoverProductActions({
  title,
  hasRanked,
  onWantToTry,
  onRate,
  onWant,
  layout = 'column',
  variant = 'light',
}: {
  title: string;
  hasRanked: boolean;
  onWantToTry: boolean;
  onRate: () => void;
  onWant: () => void;
  layout?: 'column' | 'row';
  variant?: 'light' | 'dark';
}) {
  const isDark = variant === 'dark';
  const plusColor = isDark ? BaggedColors.green : BaggedColors.accent;
  const bookmarkIdle = isDark ? 'rgba(255,255,255,0.55)' : BaggedColors.muted;
  const bookmarkActive = isDark ? BaggedColors.green : BaggedColors.accent;

  return (
    <View
      style={[
        styles.exploreResultActions,
        layout === 'row' && styles.exploreResultActionsRow,
      ]}>
      <Pressable
        onPress={onRate}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={hasRanked ? `Re-rank ${title}` : `Rate ${title}`}
        style={({ pressed }) => [
          hasRanked ? styles.exploreRerankBtn : styles.exploreIconBtn,
          isDark ? styles.exploreIconBtnDark : styles.exploreRateBtn,
          hasRanked && isDark && styles.exploreRerankBtnDark,
          pressed && styles.cardPressed,
        ]}>
        {hasRanked ? (
          <Text style={[styles.exploreRerankText, isDark && styles.exploreRerankTextDark]}>
            Re-rank
          </Text>
        ) : (
          <Ionicons name="add" size={20} color={plusColor} />
        )}
      </Pressable>
      {!hasRanked ? (
        <Pressable
          onPress={onWant}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={
            onWantToTry ? `Remove ${title} from Want to Try` : `Add ${title} to Want to Try`
          }
          style={({ pressed }) => [
            styles.exploreIconBtn,
            isDark && styles.exploreIconBtnDark,
            onWantToTry && (isDark ? styles.exploreWantBtnOnDark : styles.exploreWantBtnOn),
            pressed && styles.cardPressed,
          ]}>
          <Ionicons
            name={onWantToTry ? 'bookmark' : 'bookmark-outline'}
            size={18}
            color={onWantToTry ? bookmarkActive : bookmarkIdle}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const { userId, username } = useAuth();
  const { showMacroNutrition } = useDisplaySettings();
  const isAdmin = isAdminUsername(username);

  const [adminPickerOpen, setAdminPickerOpen] = useState(false);
  const [adminEditingRow, setAdminEditingRow] = useState<DiscoverNewReleaseRow | null>(null);
  const [adminPhotoBusyKey, setAdminPhotoBusyKey] = useState<string | null>(null);

  const [exploreStore, setExploreStore] = useState<DiscoverStoreFilter>(ALL_STORES);
  const [exploreDiet, setExploreDiet] = useState<string[]>([]);
  const [exploreParentId, setExploreParentId] = useState<string | null>(null);
  const [exploreSubcategoryId, setExploreSubcategoryId] = useState<string | null>(null);

  const [newReleasesStore, setNewReleasesStore] = useState<DiscoverStoreFilter>(ALL_STORES);
  const [newReleasesDiet, setNewReleasesDiet] = useState<string[]>([]);
  const [newReleasesParentId, setNewReleasesParentId] = useState<string | null>(null);
  const [newReleasesSubcategoryId, setNewReleasesSubcategoryId] = useState<string | null>(null);

  const [exploreQuery, setExploreQuery] = useState('');
  const debouncedExploreQuery = useDebounce(exploreQuery, 400);

  const [exploreLoadingCatalog, setExploreLoadingCatalog] = useState(false);
  const [exploreCatalogRows, setExploreCatalogRows] = useState<DiscoverExploreRow[]>([]);
  const [exploreLoadingSearch, setExploreLoadingSearch] = useState(false);
  const [exploreSearchRows, setExploreSearchRows] = useState<DiscoverExploreRow[]>([]);
  /** Bump on tab focus so Explore picks up store label edits from product profiles. */
  const [exploreRefreshTick, setExploreRefreshTick] = useState(0);

  const [newReleases, setNewReleases] = useState<DiscoverNewReleaseRow[]>([]);
  const [trending, setTrending] = useState<DiscoverTrendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rankedKeySet, setRankedKeySet] = useState<Set<string>>(() => new Set());
  const [wantSet, setWantSet] = useState<Set<string>>(() => new Set());
  const [wantByKey, setWantByKey] = useState<Map<string, WantToTryItem>>(() => new Map());
  const pendingWantRef = useRef<{ key: string; primary: string; product: DiscoverProductInput } | null>(
    null
  );
  const {
    captionTarget,
    captionSaving,
    requestWantToTryCaption,
    cancelWantToTryCaption,
    confirmWantToTryCaption,
  } = useWantToTryCaption(userId);

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
            .map((r) =>
              rankKeyPair(r.item, primaryGroceryStoreForKey(r), r.product_brand)
            )
        )
      );
    } catch {
      setRankedKeySet(new Set());
    }
  }, [userId]);

  const refreshWantSet = useCallback(async () => {
    if (!userId) {
      setWantSet(new Set());
      setWantByKey(new Map());
      return;
    }
    try {
      const rows = await getWantToTry(userId);
      setWantSet(new Set(rows.map((w) => rankKeyPair(w.item, w.store, w.brand))));
      setWantByKey(new Map(rows.map((w) => [rankKeyPair(w.item, w.store, w.brand), w] as const)));
    } catch {
      setWantSet(new Set());
      setWantByKey(new Map());
    }
  }, [userId]);

  const exploreLegacyCategory = useMemo((): Category | null => {
    if (exploreSubcategoryId) return legacyCategoryForSubcategory(exploreSubcategoryId) as Category;
    if (exploreParentId) {
      const first = getSubcategoriesForParent(exploreParentId)[0]?.id;
      return first ? (legacyCategoryForSubcategory(first) as Category) : null;
    }
    return null;
  }, [exploreParentId, exploreSubcategoryId]);

  const newReleasesLegacyCategory = useMemo((): Category | null => {
    if (newReleasesSubcategoryId) {
      return legacyCategoryForSubcategory(newReleasesSubcategoryId) as Category;
    }
    if (newReleasesParentId) {
      const first = getSubcategoriesForParent(newReleasesParentId)[0]?.id;
      return first ? (legacyCategoryForSubcategory(first) as Category) : null;
    }
    return null;
  }, [newReleasesParentId, newReleasesSubcategoryId]);

  const exploreBrowseActive =
    exploreStore !== ALL_STORES || exploreDiet.length > 0 || !!exploreParentId || !!exploreSubcategoryId;

  const exploreDietForFetch = exploreDiet.length === 1 ? exploreDiet[0] : '';

  const toggleExploreDiet = useCallback((dietId: string) => {
    setExploreDiet((prev) =>
      prev.includes(dietId) ? prev.filter((id) => id !== dietId) : [...prev, dietId]
    );
  }, []);

  const toggleNewReleasesDiet = useCallback((dietId: string) => {
    setNewReleasesDiet((prev) =>
      prev.includes(dietId) ? prev.filter((id) => id !== dietId) : [...prev, dietId]
    );
  }, []);

  const newReleasesDietForFetch = newReleasesDiet.length === 1 ? newReleasesDiet[0] : '';

  const load = useCallback(async () => {
    const [nr, tr] = await Promise.allSettled([
      fetchDiscoverNewReleases({
        limit: 36,
        store: newReleasesStore,
        dietTag: newReleasesDietForFetch,
        category: newReleasesLegacyCategory ?? undefined,
      }),
      fetchDiscoverTrendingThisWeek({ limit: 20 }),
    ]);
    setNewReleases(nr.status === 'fulfilled' ? nr.value : []);
    setTrending(tr.status === 'fulfilled' ? tr.value : []);
  }, [newReleasesStore, newReleasesDietForFetch, newReleasesLegacyCategory]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setExploreRefreshTick((n) => n + 1);
      setLoading(true);
      Promise.all([load(), refreshRankedKeys(), refreshWantSet()])
        .catch((err) => console.warn('discover load:', err))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [load, refreshRankedKeys, refreshWantSet])
  );

  useEffect(() => {
    const refreshDiscover = () => {
      setExploreRefreshTick((n) => n + 1);
      if (userId) {
        void Promise.all([load(), refreshRankedKeys(), refreshWantSet()]).catch((err) =>
          console.warn('discover refresh after metadata edit:', err)
        );
      }
    };
    setDiscoverRefreshListener(refreshDiscover);
    return () => setDiscoverRefreshListener(null);
  }, [userId, load, refreshRankedKeys, refreshWantSet]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), refreshRankedKeys(), refreshWantSet()]);
    } catch (err) {
      console.warn('discover refresh:', err);
    }
    setRefreshing(false);
  }, [load, refreshRankedKeys, refreshWantSet]);

  useEffect(() => {
    if (!exploreBrowseActive) {
      setExploreCatalogRows([]);
      setExploreLoadingCatalog(false);
      return;
    }

    let cancelled = false;
    setExploreLoadingCatalog(true);

    const run = async () => {
      try {
        const rows = await fetchDiscoverExploreCurated({
          store: exploreStore,
          dietTag: exploreDietForFetch,
          category: exploreLegacyCategory ?? undefined,
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
  }, [exploreBrowseActive, exploreStore, exploreDietForFetch, exploreLegacyCategory, exploreRefreshTick]);

  useEffect(() => {
    if (exploreBrowseActive) {
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
        const rows = await fetchDiscoverExploreSearch({
          query: q,
          store: exploreStore,
          dietTag: exploreDietForFetch,
          category: exploreLegacyCategory ?? undefined,
          limit: EXPLORE_SEARCH_LIMIT,
        });
        if (cancelled) return;
        setExploreSearchRows(Array.isArray(rows) ? rows : []);
      } catch (e) {
        if (cancelled) return;
        console.warn('fetchDiscoverExploreSearch:', e);
        setExploreSearchRows([]);
      } finally {
        if (!cancelled) setExploreLoadingSearch(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    exploreBrowseActive,
    debouncedExploreQuery,
    exploreStore,
    exploreDietForFetch,
    exploreLegacyCategory,
    exploreRefreshTick,
  ]);

  const exploreDisplayRows = useMemo(() => {
    const matchesSubcategory = (row: { foodCategory?: string | null; category?: string | null; subcategory?: string | null }) => {
      if (exploreSubcategoryId) {
        const rowSub = String(row.subcategory ?? '').trim() || mapLegacyCategoryToSubcategory(String(row.category ?? row.foodCategory ?? ''));
        return rowSub === exploreSubcategoryId;
      }
      if (exploreParentId) {
        const rowSub = String(row.subcategory ?? '').trim() || mapLegacyCategoryToSubcategory(String(row.category ?? row.foodCategory ?? ''));
        return getSubcategoriesForParent(exploreParentId).some((s) => s.id === rowSub);
      }
      return true;
    };

    const matchesDiets = (row: { dietTags?: string[] }) =>
      exploreDiet.length <= 1 ? true : rowMatchesDietFilters(row, exploreDiet);

    if (exploreBrowseActive) {
      const q = exploreQuery.trim().toLowerCase();
      let rows = exploreCatalogRows.filter(matchesSubcategory).filter(matchesDiets);
      if (!q) return rows;
      return rows.filter((row) => {
        const title = String(row?.description ?? '').toLowerCase();
        const brand = String(row?.brandOwner ?? row?.brandName ?? '').toLowerCase();
        return title.includes(q) || brand.includes(q);
      });
    }
    if (debouncedExploreQuery.trim().length < 2) return [];
    return exploreSearchRows.filter(matchesSubcategory).filter(matchesDiets);
  }, [
    exploreBrowseActive,
    exploreCatalogRows,
    exploreSearchRows,
    exploreQuery,
    debouncedExploreQuery,
    exploreParentId,
    exploreSubcategoryId,
    exploreDiet,
  ]);

  const displayNewReleases = useMemo(() => {
    if (newReleasesDiet.length <= 1) return newReleases;
    return newReleases.filter((row) => rowMatchesDietFilters(row, newReleasesDiet));
  }, [newReleases, newReleasesDiet]);

  const exploreLoading = exploreBrowseActive ? exploreLoadingCatalog : exploreLoadingSearch;

  const openProduct = (p: {
    item: string;
    brand: string;
    category: string;
    store?: string;
    descriptionKey?: string;
  }) => {
    const dk = resolveProductDescriptionKey({
      item: p.item,
      brand: p.brand,
      descriptionKey: p.descriptionKey,
    });
    router.push({
      pathname: '/product/detail',
      params: {
        item: p.item,
        brand: p.brand,
        category: p.category,
        store: p.store ?? '',
        wantSource: 'discover',
        descriptionKey: dk,
      },
    });
  };

  const openExploreRow = (row: DiscoverExploreRow) => {
    const title = row.description;
    const store = displayStoreForRow({
      store: row.store,
      stores: row.stores,
      product_brand: row.brandOwner || row.brandName,
    });
    openProduct({
      item: title,
      brand: row.brandOwner || row.brandName,
      category: String(row.foodCategory ?? '').trim(),
      store,
      descriptionKey: row.descriptionKey,
    });
  };

  const openAdminPhotosForRelease = useCallback(
    async (row: DiscoverNewReleaseRow) => {
      if (!userId) {
        Alert.alert('Sign in', 'Log in to add photos to this release.');
        return;
      }
      const busyKey = row.descriptionKey;
      setAdminPhotoBusyKey(busyKey);
      try {
        const brand = row.brandOwner || row.brandName || '';
        const stores =
          row.stores.length > 0 ? row.stores : row.store ? [row.store] : [];
        const res = await ensureUserPostForProductPhotos(userId, {
          item: row.description,
          brand,
          descriptionKey: row.descriptionKey,
          category: row.foodCategory,
          stores,
          dietTags: row.dietTags,
        });
        if ('error' in res) {
          Alert.alert('Could not add photos', res.error);
          return;
        }
        router.push({
          pathname: '/add-review-photos',
          params: {
            postId: String(res.postId),
            item: row.description,
            brand,
          },
        });
      } catch (err) {
        Alert.alert(
          'Could not add photos',
          err instanceof Error ? err.message : 'Try again in a moment.'
        );
      } finally {
        setAdminPhotoBusyKey((prev) => (prev === busyKey ? null : prev));
      }
    },
    [userId, router]
  );

  const rankFromDiscoverProduct = (product: DiscoverProductInput) => {
    const rateParams: Record<string, string> = {
      prefilledItem: product.item,
      prefilledBrand: product.brand || '',
    };
    const fc = String(product.category ?? '').trim();
    if (fc) rateParams.prefilledCategory = fc;
    const auto = rateMacroFormFromNumbers(
      {
        cal: product.cal,
        protein: product.protein,
        carbs: product.carbs,
        fat: product.fat,
        servingLabel: product.servingLabel,
      },
      {
        includeZeroValues: product.nutritionVerified === true,
        allowIntentionalAllZeros: product.nutritionVerified === true,
      }
    );
    if (rateMacroFormHasAny(auto)) {
      Object.assign(rateParams, rateMacroFormToPrefillParams(auto));
    }
    router.push({
      pathname: '/rate',
      params: rateParams,
    });
  };

  const wantFromDiscoverProduct = async (product: DiscoverProductInput) => {
    if (!userId) {
      Alert.alert('Sign in', 'Log in to use Want to Try.');
      return;
    }
    const key = discoverProductWantKey(product);
    const wasWanted = wantSet.has(key);
    const stores = (product.stores ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
    const primary = primaryGroceryStoreForKey({
      store: product.store,
      stores: product.stores,
      product_brand: product.brand,
    });

    if (!wasWanted) {
      pendingWantRef.current = { key, primary, product };
      requestWantToTryCaption({
        item: product.item,
        brand: product.brand || '',
        descriptionKey: product.descriptionKey ?? undefined,
        stores,
        category: product.category || 'Snacks',
        dietTags: product.dietTags ?? [],
        source: 'discover',
      });
      return;
    }

    const nextWantSet = new Set(wantSet);
    nextWantSet.delete(key);
    setWantSet(nextWantSet);

    try {
      const existing = wantByKey.get(key);
      await removeWantToTryWithFeed(userId, product.item, primary, existing?.radarPostId);
      setWantByKey((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      pokeFeedRefresh();
    } catch (err) {
      console.warn('discover want:', err);
      setWantSet(wantSet);
      Alert.alert(
        'Could not remove from Want to Try',
        err instanceof Error ? err.message : 'Try again.'
      );
    }
  };

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
        const { key, primary, product } = pending;
        pendingWantRef.current = null;
        setWantSet((prev) => new Set(prev).add(key));
        pokeFeedRefresh(radarPostId);
        setWantByKey((prev) =>
          new Map(prev).set(key, {
            id: `wt-${key}`,
            item: product.item,
            store: primary,
            stores: (product.stores ?? []).map((s) => String(s ?? '').trim()).filter(Boolean).length
              ? (product.stores ?? []).map((s) => String(s ?? '').trim()).filter(Boolean)
              : primary
                ? [primary]
                : [],
            emoji: '',
            category: product.category || 'Snacks',
            brand: product.brand || '',
            radarPostId,
            note,
          })
        );
      } catch (err) {
        console.warn('discover want caption save failed:', err);
        Alert.alert(
          'Could not save to Want to Try',
          err instanceof Error ? err.message : 'Try again.'
        );
      }
    },
    [userId, confirmWantToTryCaption]
  );

  const exploreRowToProduct = (row: DiscoverExploreRow): DiscoverProductInput => ({
    item: row.description,
    brand: row.brandOwner || row.brandName,
    category: row.foodCategory,
    descriptionKey: row.descriptionKey,
    store: row.store,
    stores: row.stores,
    dietTags: row.dietTags,
    cal: row.cal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    servingLabel: row.servingLabel,
    nutritionVerified: row.nutritionVerification === 'verified',
  });

  const newReleaseToProduct = (row: DiscoverNewReleaseRow): DiscoverProductInput => ({
    item: row.description,
    brand: row.brandOwner || row.brandName,
    category: row.foodCategory,
    descriptionKey: row.descriptionKey,
    store: row.store,
    stores: row.stores,
    dietTags: row.dietTags,
    cal: row.cal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    servingLabel: row.servingLabel ?? null,
  });

  const trendingRowToProduct = (row: DiscoverTrendingRow): DiscoverProductInput => {
    const m = row.macros;
    return {
      item: row.item,
      brand: row.brand,
      category: row.category,
      descriptionKey: row.key,
      store: row.store,
      stores: row.stores,
      dietTags: row.dietTags,
      cal: m?.cal ?? null,
      protein: m?.protein ?? null,
      carbs: m?.carbs ?? null,
      fat: m?.fat ?? null,
      servingLabel: m?.servingLabel ?? null,
    };
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <View style={styles.headerRow}>
        <Text style={styles.brand}>Discover</Text>
        <Text style={styles.headerSub}>Find products, new drops, and what&apos;s trending</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BaggedColors.dark} />
        }>
        <View style={styles.discoverSection}>
          <DiscoverSectionHeader
            title="Explore"
            subtitle="Narrow by store, diet, or category — or search the full catalog"
          />

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

          <DiscoverFilterPanel
            store={exploreStore}
            onStoreChange={setExploreStore}
            diets={exploreDiet}
            onToggleDiet={toggleExploreDiet}
            onClearDiets={() => setExploreDiet([])}
            parentCategoryId={exploreParentId}
            onParentCategoryChange={setExploreParentId}
            subcategoryId={exploreSubcategoryId}
            onSubcategoryChange={setExploreSubcategoryId}
            showCategory
          />

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
                  const store = displayStoreForRow({
                    store: row.store,
                    stores: row.stores,
                    product_brand: row.brandOwner || row.brandName,
                  });
                  const product = exploreRowToProduct(row);
                  const viewerHasRanked = rankedKeySet.has(discoverProductWantKey(product));
                  const onWantToTry = wantSet.has(discoverProductWantKey(product));
                  return (
                    <View
                      key={`${row.descriptionKey || normalizedDescriptionKeyFromItem(title)}-${idx}`}
                      style={styles.exploreResultCard}>
                      <View style={styles.exploreResultMain}>
                        <Pressable
                          onPress={() => openExploreRow(row)}
                          style={({ pressed }) => [styles.exploreResultTap, pressed && styles.cardPressed]}>
                          <DiscoverAvgScoreThumb avg={row.avgRating} />
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
                            {showMacroNutrition && normalizeDiscoverExploreMacros(row) ? (
                              <MacrosPills macros={normalizeDiscoverExploreMacros(row)} size="sm" />
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
                        </Pressable>
                        <DiscoverProductActions
                          title={title}
                          hasRanked={viewerHasRanked}
                          onWantToTry={onWantToTry}
                          onRate={() => rankFromDiscoverProduct(product)}
                          onWant={() => void wantFromDiscoverProduct(product)}
                        />
                      </View>
                    </View>
                  );
                })
              : null}
        </View>

        <View style={[styles.discoverSection, styles.discoverSectionSpaced]}>
          <DiscoverSectionHeader
            title="New Releases"
            subtitle={`Curated picks · drop off after ${DISCOVER_NEW_RELEASE_RETENTION_DAYS} days`}
          />

          <DiscoverFilterPanel
            store={newReleasesStore}
            onStoreChange={setNewReleasesStore}
            diets={newReleasesDiet}
            onToggleDiet={toggleNewReleasesDiet}
            onClearDiets={() => setNewReleasesDiet([])}
            parentCategoryId={newReleasesParentId}
            onParentCategoryChange={setNewReleasesParentId}
            subcategoryId={newReleasesSubcategoryId}
            onSubcategoryChange={setNewReleasesSubcategoryId}
            showCategory
          />

          {isAdmin ? (
            <Pressable
              onPress={() => {
                setAdminEditingRow(null);
                setAdminPickerOpen(true);
              }}
              style={({ pressed }) => [styles.adminAddBtn, pressed && styles.adminAddBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Add a new release">
              <Ionicons name="add-circle" size={18} color={BaggedColors.accent} />
              <Text style={styles.adminAddBtnText}>Add new release</Text>
            </Pressable>
          ) : null}

          {loading && displayNewReleases.length === 0 ? (
            <View style={styles.sectionLoading}>
              <ActivityIndicator color={BaggedColors.dark} />
            </View>
          ) : null}

          {!loading && displayNewReleases.length === 0 ? (
            <EmptyHint
              message={`No curated new releases in the last ${DISCOVER_NEW_RELEASE_RETENTION_DAYS} days for this filter yet.`}
            />
          ) : null}

          {displayNewReleases.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.newReleasesRail}>
              {displayNewReleases.map((row) => {
                const product = newReleaseToProduct(row);
                const title = row.description;
                const hasRanked = rankedKeySet.has(discoverProductWantKey(product));
                const onWantToTry = wantSet.has(discoverProductWantKey(product));
                return (
                <View key={`nr-${row.descriptionKey}`} style={styles.newReleaseCard}>
                  <Pressable
                    onPress={() =>
                      openProduct({
                        item: row.description,
                        brand: row.brandOwner || row.brandName,
                        category: String(row.foodCategory ?? '').trim(),
                        store: row.store,
                        descriptionKey: row.descriptionKey,
                      })
                    }
                    style={({ pressed }) => [styles.newReleaseCardInner, pressed && styles.cardPressed]}>
                    <DiscoverAvgScoreThumb avg={row.avgRating} />
                    <AutoFitText style={styles.newReleaseTitle} numberOfLines={3}>
                      {formatProductDisplayName(row.description)}
                    </AutoFitText>
                    {row.brandOwner || row.brandName ? (
                      <AutoFitText style={styles.newReleaseBrand} numberOfLines={2}>
                        {formatProductDisplayName(row.brandOwner || row.brandName)}
                      </AutoFitText>
                    ) : null}
                    <View style={styles.newReleaseMetaRow}>
                      <View style={styles.lightPill}>
                        <Text style={styles.lightPillTextStrong}>New</Text>
                      </View>
                      {row.foodCategory?.trim() ? (
                        <View style={styles.lightPill}>
                          <Text style={styles.lightPillText}>{row.foodCategory}</Text>
                        </View>
                      ) : null}
                    </View>
                    {row.store ? (
                      <Text style={styles.newReleaseStore} numberOfLines={1}>
                        {row.store}
                      </Text>
                    ) : null}
                    {showMacroNutrition && normalizeDiscoverExploreMacros(row) ? (
                      <MacrosPills macros={normalizeDiscoverExploreMacros(row)} size="sm" />
                    ) : null}
                  </Pressable>
                  <DiscoverProductActions
                    title={title}
                    hasRanked={hasRanked}
                    onWantToTry={onWantToTry}
                    onRate={() => rankFromDiscoverProduct(product)}
                    onWant={() => void wantFromDiscoverProduct(product)}
                    layout="row"
                  />
                  {isAdmin ? (
                    <View style={styles.adminCardActions}>
                      <Pressable
                        onPress={() => void openAdminPhotosForRelease(row)}
                        disabled={adminPhotoBusyKey === row.descriptionKey}
                        style={({ pressed }) => [
                          styles.adminEditBtn,
                          pressed && styles.adminEditBtnPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Add photos to ${row.description}`}
                        hitSlop={6}>
                        {adminPhotoBusyKey === row.descriptionKey ? (
                          <ActivityIndicator size="small" color={BaggedColors.muted} />
                        ) : (
                          <Ionicons name="camera-outline" size={14} color={BaggedColors.muted} />
                        )}
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setAdminEditingRow(row);
                          setAdminPickerOpen(true);
                        }}
                        style={({ pressed }) => [
                          styles.adminEditBtn,
                          pressed && styles.adminEditBtnPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${row.description}`}
                        hitSlop={6}>
                        <Ionicons name="pencil" size={13} color={BaggedColors.muted} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
              })}
            </ScrollView>
          ) : null}
        </View>

        <View style={[styles.discoverSection, styles.discoverSectionSpaced]}>
          <DiscoverSectionHeader
            title="Trending Products"
            subtitle="Most ranked and saved to Want to Try in the last 7 days"
          />

          {loading && trending.length === 0 ? (
            <View style={styles.sectionLoading}>
              <ActivityIndicator color={BaggedColors.dark} />
            </View>
          ) : null}

          {!loading && trending.length === 0 ? (
            <EmptyHint message="No trending activity in the last 7 days yet." />
          ) : null}

          {trending.map((row) => {
            const product = trendingRowToProduct(row);
            const title = row.item;
            const hasRanked = rankedKeySet.has(discoverProductWantKey(product));
            const onWantToTry = wantSet.has(discoverProductWantKey(product));
            return (
              <View key={`trend-${row.key}`} style={styles.trendingCard}>
                <View style={styles.trendingMainRow}>
                  <Pressable
                    onPress={() =>
                      openProduct({
                        item: row.item,
                        brand: row.brand,
                        category: row.category,
                        store: row.store,
                      })
                    }
                    style={({ pressed }) => [styles.trendingTap, pressed && styles.cardPressed]}>
                    <View style={styles.trendingTopRow}>
                      <DiscoverAvgScoreThumb avg={row.avgRating} />
                      <View style={styles.cardBody}>
                        <Text style={styles.trendingEyebrow}>{trendingActivityLabel(row)}</Text>
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
                        </View>
                        {showMacroNutrition && normalizePostMacros(row.macros) ? (
                          <MacrosPills macros={normalizePostMacros(row.macros)} size="sm" />
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                  <DiscoverProductActions
                    title={title}
                    hasRanked={hasRanked}
                    onWantToTry={onWantToTry}
                    onRate={() => rankFromDiscoverProduct(product)}
                    onWant={() => void wantFromDiscoverProduct(product)}
                    variant="dark"
                  />
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
      {isAdmin ? (
        <NewReleaseAdminModal
          visible={adminPickerOpen}
          userId={userId}
          editingRow={adminEditingRow}
          onClose={() => {
            setAdminPickerOpen(false);
            setAdminEditingRow(null);
          }}
          onSaved={() => {
            setAdminPickerOpen(false);
            setAdminEditingRow(null);
            void load();
          }}
        />
      ) : null}
      <PostNoteEditorModal
        visible={captionTarget != null}
        productName={captionTarget ? wantToTryCaptionProductLabel(captionTarget) : undefined}
        subtitle="Tell your followers why you want to try it — tag friends with @username."
        saveLabel="Save & post"
        saving={captionSaving}
        onClose={handleCancelWantCaption}
        onSave={(note) => void handleConfirmWantCaption(note)}
      />
    </SafeAreaView>
  );
}

type AdminModalMode = 'search' | 'manual';
/** Inside `search` mode: `list` = browsing results, `configure` = picked a row and choosing tags. */
type SearchSubview = 'list' | 'configure';

const EMPTY_MANUAL_MACROS = { cal: '', protein: '', carbs: '', fat: '', servingLabel: '' };

function legacyCategoryChipLabel(c: Category): string {
  if (c === 'Meat & Seafood') {
    return getParentCategoryById('meat-seafood')?.label ?? 'Meat, Seafood, & Alt';
  }
  return c;
}

function NewReleaseAdminModal({
  visible,
  userId,
  editingRow,
  onClose,
  onSaved,
}: {
  visible: boolean;
  userId: string | null;
  editingRow: DiscoverNewReleaseRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditing = editingRow != null;
  const editingKeyRef = useRef<string | null>(null);
  const [mode, setMode] = useState<AdminModalMode>('search');
  const [searchSubview, setSearchSubview] = useState<SearchSubview>('list');

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 350);
  const [results, setResults] = useState<SearchProductRow[]>([]);
  const [searching, setSearching] = useState(false);

  // ─── Configure-picked-row state (search → configure sub-step) ─────────────
  const [pickedRow, setPickedRow] = useState<SearchProductRow | null>(null);
  const [pickedStores, setPickedStores] = useState<string[]>([]);
  const [pickedDietTags, setPickedDietTags] = useState<string[]>([]);
  /** Stores the catalog already has on file (so chips can show "Already" pills). */
  const [pickedExistingStores, setPickedExistingStores] = useState<string[]>([]);
  /** Diet tags the catalog already has on file. */
  const [pickedExistingDietTags, setPickedExistingDietTags] = useState<string[]>([]);
  const [pickedSaving, setPickedSaving] = useState(false);
  const [pickedTagsLoading, setPickedTagsLoading] = useState(false);

  const [manualTitle, setManualTitle] = useState('');
  const [manualBrand, setManualBrand] = useState('');
  const [manualCategory, setManualCategory] = useState<Category>('Snacks');
  const [manualStores, setManualStores] = useState<string[]>([]);
  const [manualDietTags, setManualDietTags] = useState<string[]>([]);
  const [manualMacros, setManualMacros] = useState(EMPTY_MANUAL_MACROS);
  const [manualSaving, setManualSaving] = useState(false);

  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const resetManualForm = useCallback(() => {
    setManualTitle('');
    setManualBrand('');
    setManualCategory('Snacks');
    setManualStores([]);
    setManualDietTags([]);
    setManualMacros(EMPTY_MANUAL_MACROS);
    setManualSaving(false);
  }, []);

  const resetPickedForm = useCallback(() => {
    setPickedRow(null);
    setPickedStores([]);
    setPickedDietTags([]);
    setPickedExistingStores([]);
    setPickedExistingDietTags([]);
    setPickedSaving(false);
    setPickedTagsLoading(false);
  }, []);

  useEffect(() => {
    if (!visible) {
      setMode('search');
      setSearchSubview('list');
      setQuery('');
      setResults([]);
      setSearching(false);
      setFeedback(null);
      editingKeyRef.current = null;
      resetManualForm();
      resetPickedForm();
    }
  }, [visible, resetManualForm, resetPickedForm]);

  useEffect(() => {
    if (!visible || !editingRow) return;
    editingKeyRef.current = editingRow.descriptionKey;
    setMode('manual');
    setSearchSubview('list');
    setFeedback(null);
    setManualTitle(editingRow.description);
    setManualBrand(editingRow.brandOwner || editingRow.brandName || '');
    setManualCategory(mapCategory(String(editingRow.foodCategory ?? '').trim() || 'Snacks'));
    const stores =
      editingRow.stores.length > 0
        ? editingRow.stores
        : editingRow.store
          ? [editingRow.store]
          : [];
    setManualStores(stores);
    setManualDietTags(Array.isArray(editingRow.dietTags) ? [...editingRow.dietTags] : []);
    setManualMacros({
      cal: editingRow.cal != null ? String(editingRow.cal) : '',
      protein: editingRow.protein != null ? String(editingRow.protein) : '',
      carbs: editingRow.carbs != null ? String(editingRow.carbs) : '',
      fat: editingRow.fat != null ? String(editingRow.fat) : '',
      servingLabel: editingRow.servingLabel ?? '',
    });
  }, [visible, editingRow]);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!visible || mode !== 'search' || searchSubview !== 'list') return;
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    searchProducts(q)
      .then((rows) => {
        if (!cancelled) setResults(rows);
      })
      .catch((err) => {
        console.warn('admin new-release search:', err);
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, mode, searchSubview, debouncedQuery]);

  const switchToManual = useCallback(() => {
    setFeedback(null);
    const seed = query.trim();
    if (seed && !manualTitle.trim()) {
      setManualTitle(seed);
    }
    setMode('manual');
  }, [query, manualTitle]);

  const switchToSearch = useCallback(() => {
    setFeedback(null);
    setMode('search');
    setSearchSubview('list');
    resetPickedForm();
  }, [resetPickedForm]);

  const backToSearchList = useCallback(() => {
    setFeedback(null);
    setSearchSubview('list');
    resetPickedForm();
  }, [resetPickedForm]);

  const togglePickedStore = useCallback((store: string) => {
    setPickedStores((prev) =>
      prev.includes(store) ? prev.filter((s) => s !== store) : [...prev, store]
    );
  }, []);

  const togglePickedDietTag = useCallback((id: string) => {
    setPickedDietTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  /** Open the configure sub-view for a search result; pre-fill chips with what the catalog already has. */
  const openConfigureForRow = useCallback((row: SearchProductRow) => {
    setFeedback(null);
    setPickedRow(row);
    setPickedStores([]);
    setPickedDietTags([]);
    setPickedExistingStores([]);
    setPickedExistingDietTags([]);
    setSearchSubview('configure');
    setPickedTagsLoading(true);
    const desc = String(row.description ?? '').trim();
    if (!desc) {
      setPickedTagsLoading(false);
      return;
    }
    fetchCuratedProductTagsByDescription(desc)
      .then((tags) => {
        if (!tags) return;
        setPickedExistingStores(tags.stores);
        setPickedExistingDietTags(tags.dietTags);
      })
      .catch((err) => {
        console.warn('admin configure tag fetch:', err);
      })
      .finally(() => setPickedTagsLoading(false));
  }, []);

  const toggleManualStore = useCallback((store: string) => {
    setManualStores((prev) =>
      prev.includes(store) ? prev.filter((s) => s !== store) : [...prev, store]
    );
  }, []);

  const toggleManualDietTag = useCallback((id: string) => {
    setManualDietTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const setMacroField = useCallback(
    (field: keyof typeof EMPTY_MANUAL_MACROS) => (value: string) => {
      setManualMacros((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  /**
   * Confirm the currently picked search row as a New Release, sending along
   * any admin-selected store / diet-tag chips so the catalog row picks them up.
   */
  const confirmPickedRow = useCallback(async () => {
    if (!userId || !pickedRow) return;
    const row = pickedRow;
    const brand = searchRowBrand(row);
    if (!brand) {
      setFeedback({ tone: 'warn', text: 'That row has no brand on file — go back and pick a branded result.' });
      return;
    }
    setPickedSaving(true);
    setFeedback(null);
    try {
      const res = await markCuratedProductAsNewRelease(userId, {
        description: row.description,
        brandOwner: brand,
        foodCategory: row.foodCategory,
        cal: row.cal,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
        servingLabel: row.servingLabel ?? undefined,
        stores: pickedStores,
        dietTags: pickedDietTags,
      });
      if (res.ok) {
        setFeedback({
          tone: 'ok',
          text:
            res.action === 'inserted'
              ? `Added “${row.description}” to New Releases.`
              : `Marked “${row.description}” as a New Release.`,
        });
        setTimeout(onSaved, 600);
      } else if (res.reason === 'empty_brand') {
        setFeedback({ tone: 'warn', text: 'That row has no brand on file — go back and pick a branded result.' });
      } else if (res.reason === 'forbidden') {
        setFeedback({ tone: 'warn', text: 'You do not have permission to add new releases.' });
      } else {
        setFeedback({ tone: 'warn', text: res.message || 'Could not save. Try again.' });
      }
    } catch (err) {
      console.warn('markCuratedProductAsNewRelease:', err);
      setFeedback({
        tone: 'warn',
        text: err instanceof Error ? err.message : 'Could not save. Try again.',
      });
    } finally {
      setPickedSaving(false);
    }
  }, [userId, pickedRow, pickedStores, pickedDietTags, onSaved]);

  const submitManual = useCallback(async () => {
    if (!userId) {
      setFeedback({ tone: 'warn', text: 'Sign in to save this release.' });
      return;
    }
    const title = manualTitle.trim();
    const brand = manualBrand.trim();
    if (!title) {
      setFeedback({ tone: 'warn', text: 'Enter a product title.' });
      return;
    }
    if (!brand) {
      setFeedback({ tone: 'warn', text: 'Enter a brand.' });
      return;
    }
    setManualSaving(true);
    setFeedback(null);
    const priorKey = editingKeyRef.current;
    try {
      const payload = {
        description: title,
        brandOwner: brand,
        foodCategory: manualCategory,
        cal: rateMacroFormFieldToOptionalNumber(manualMacros.cal),
        protein: rateMacroFormFieldToOptionalNumber(manualMacros.protein),
        carbs: rateMacroFormFieldToOptionalNumber(manualMacros.carbs),
        fat: rateMacroFormFieldToOptionalNumber(manualMacros.fat),
        stores: manualStores,
        servingLabel: manualMacros.servingLabel.trim() || undefined,
        dietTags: manualDietTags,
      };
      const res =
        priorKey != null
          ? await updateCuratedNewRelease(userId, { descriptionKey: priorKey, ...payload })
          : await markCuratedProductAsNewRelease(userId, payload);
      if (res.ok) {
        setFeedback({
          tone: 'ok',
          text:
            priorKey != null
              ? `Saved changes to “${title}”.`
              : res.action === 'inserted'
                ? `Added “${title}” to New Releases.`
                : `“${title}” already existed — marked as a New Release.`,
        });
        setTimeout(onSaved, 700);
      } else if (res.reason === 'empty_brand') {
        setFeedback({ tone: 'warn', text: 'Brand is required.' });
      } else if (res.reason === 'forbidden') {
        setFeedback({ tone: 'warn', text: 'You do not have permission to edit new releases.' });
      } else {
        setFeedback({ tone: 'warn', text: res.message || 'Could not save. Try again.' });
      }
    } catch (err) {
      console.warn('manual new release save:', err);
      setFeedback({
        tone: 'warn',
        text: err instanceof Error ? err.message : 'Could not save. Try again.',
      });
    } finally {
      setManualSaving(false);
    }
  }, [
    userId,
    manualTitle,
    manualBrand,
    manualCategory,
    manualMacros,
    manualStores,
    manualDietTags,
    onSaved,
  ]);

  const trimmedQuery = debouncedQuery.trim();
  const showInlineManualCta =
    mode === 'search' &&
    searchSubview === 'list' &&
    !searching &&
    trimmedQuery.length >= 2 &&
    results.length === 0;
  const headerTitle =
    isEditing
      ? 'Edit new release'
      : mode === 'manual'
        ? 'New release (manual)'
        : searchSubview === 'configure'
          ? 'Tag this release'
          : 'Add new release';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.adminSheet}>
        <View style={styles.adminSheetHeader}>
          <Text style={styles.adminSheetTitle}>{headerTitle}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.adminSheetClose}>
            <Ionicons name="close" size={22} color={BaggedColors.dark} />
          </Pressable>
        </View>

        {mode === 'search' && searchSubview === 'list' ? (
          <>
            <Text style={styles.adminSheetHint}>
              Search the catalog. Tap a product to add store + diet tags, then post it to New
              Releases.
            </Text>
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search products…"
              placeholderTextColor={BaggedColors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.adminSheetInput}
              returnKeyType="search"
            />
            {feedback ? (
              <Text
                style={[
                  styles.adminFeedback,
                  feedback.tone === 'warn' ? styles.adminFeedbackWarn : styles.adminFeedbackOk,
                ]}>
                {feedback.text}
              </Text>
            ) : null}
            <ScrollView
              style={styles.flex}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.adminSheetList}>
              {searching ? (
                <View style={styles.adminSheetLoading}>
                  <ActivityIndicator color={BaggedColors.dark} />
                </View>
              ) : null}
              {showInlineManualCta ? (
                <Pressable
                  onPress={switchToManual}
                  style={({ pressed }) => [styles.manualCta, pressed && styles.cardPressed]}>
                  <Ionicons name="add-circle" size={22} color={BaggedColors.accent} />
                  <View style={styles.manualCtaBody}>
                    <Text style={styles.manualCtaTitle}>No match — add it manually</Text>
                    <Text style={styles.manualCtaSub} numberOfLines={2}>
                      Create a brand-new entry for “{trimmedQuery}” and post it to New Releases.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={BaggedColors.muted} />
                </Pressable>
              ) : null}
              {results.map((row, idx) => {
                const brand = searchRowBrand(row);
                const key = row.descriptionKey || `${row.description}::${brand}::${idx}`;
                return (
                  <Pressable
                    key={key}
                    onPress={() => openConfigureForRow(row)}
                    style={({ pressed }) => [
                      styles.adminResultRow,
                      pressed && styles.cardPressed,
                    ]}>
                    <View style={styles.adminResultBody}>
                      <AutoFitText style={styles.adminResultTitle} numberOfLines={3}>
                        {row.description}
                      </AutoFitText>
                      {brand ? (
                        <AutoFitText style={styles.adminResultBrand} numberOfLines={2}>
                          {brand}
                        </AutoFitText>
                      ) : (
                        <Text style={styles.adminResultBrandMissing}>No brand — pick another row</Text>
                      )}
                      <View style={styles.adminResultMeta}>
                        {row.foodCategory ? (
                          <View style={styles.adminMetaPill}>
                            <Text style={styles.adminMetaPillText}>{row.foodCategory}</Text>
                          </View>
                        ) : null}
                        {row.isCurated ? (
                          <View style={[styles.adminMetaPill, styles.adminMetaPillCurated]}>
                            <Text style={styles.adminMetaPillText}>Curated</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={BaggedColors.muted} />
                  </Pressable>
                );
              })}
              <Pressable
                onPress={switchToManual}
                style={({ pressed }) => [styles.manualFooterBtn, pressed && styles.cardPressed]}>
                <Ionicons name="create-outline" size={16} color={BaggedColors.dark} />
                <Text style={styles.manualFooterBtnText}>Add a release manually</Text>
              </Pressable>
            </ScrollView>
          </>
        ) : mode === 'search' && searchSubview === 'configure' && pickedRow ? (
          <>
            <Pressable
              onPress={backToSearchList}
              style={({ pressed }) => [styles.manualBackBtn, pressed && styles.cardPressed]}
              hitSlop={6}>
              <Ionicons name="chevron-back" size={18} color={BaggedColors.muted} />
              <Text style={styles.manualBackText}>Back to search</Text>
            </Pressable>
            {feedback ? (
              <Text
                style={[
                  styles.adminFeedback,
                  feedback.tone === 'warn' ? styles.adminFeedbackWarn : styles.adminFeedbackOk,
                ]}>
                {feedback.text}
              </Text>
            ) : null}
            <ScrollView
              style={styles.flex}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.manualForm}>
              <View style={styles.pickedSummaryCard}>
                <AutoFitText style={styles.pickedSummaryTitle} numberOfLines={4}>
                  {pickedRow.description}
                </AutoFitText>
                {searchRowBrand(pickedRow) ? (
                  <AutoFitText style={styles.pickedSummaryBrand} numberOfLines={2}>
                    {searchRowBrand(pickedRow)}
                  </AutoFitText>
                ) : (
                  <Text style={styles.adminResultBrandMissing}>No brand on file</Text>
                )}
                <View style={styles.adminResultMeta}>
                  {pickedRow.foodCategory ? (
                    <View style={styles.adminMetaPill}>
                      <Text style={styles.adminMetaPillText}>{pickedRow.foodCategory}</Text>
                    </View>
                  ) : null}
                  {pickedRow.isCurated ? (
                    <View style={[styles.adminMetaPill, styles.adminMetaPillCurated]}>
                      <Text style={styles.adminMetaPillText}>Curated</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <Text style={styles.adminSheetHint}>
                Pick the stores it&apos;s sold at and any diet tags that apply. We&apos;ll merge
                with whatever the catalog already has.
              </Text>

              {pickedTagsLoading ? (
                <View style={styles.pickedExistingLoading}>
                  <ActivityIndicator color={BaggedColors.muted} size="small" />
                  <Text style={styles.pickedExistingLoadingText}>
                    Checking catalog for existing tags…
                  </Text>
                </View>
              ) : null}

              <Text style={styles.manualLabel}>Stores (tap to add)</Text>
              {pickedExistingStores.length > 0 ? (
                <Text style={styles.pickedExistingHint}>
                  Already on file: {pickedExistingStores.join(', ')}
                </Text>
              ) : null}
              <View style={styles.manualChipWrap}>
                {STORES.map((s) => {
                  const active = pickedStores.includes(s);
                  const already = pickedExistingStores.includes(s);
                  return (
                    <Pressable
                      key={s}
                      onPress={() => togglePickedStore(s)}
                      style={[styles.manualChip, active && styles.manualChipActive]}>
                      <Text
                        style={[styles.manualChipText, active && styles.manualChipTextActive]}>
                        {s}
                        {already ? ' ✓' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.manualLabel}>Diet tags (tap to add)</Text>
              {pickedExistingDietTags.length > 0 ? (
                <Text style={styles.pickedExistingHint}>
                  Already on file:{' '}
                  {pickedExistingDietTags
                    .map((id) => DIET_TAGS.find((t) => t.id === id)?.label ?? id)
                    .join(', ')}
                </Text>
              ) : null}
              <View style={styles.manualChipWrap}>
                {DIET_TAGS.map((tag) => {
                  const active = pickedDietTags.includes(tag.id);
                  const already = pickedExistingDietTags.includes(tag.id);
                  return (
                    <Pressable
                      key={tag.id}
                      onPress={() => togglePickedDietTag(tag.id)}
                      style={[
                        styles.manualChip,
                        {
                          borderColor: tag.color,
                          backgroundColor: active ? tag.bgActive : tag.bg,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.manualChipText,
                          { color: tag.color },
                          active && { fontWeight: '700' },
                        ]}>
                        {tag.label}
                        {already ? ' ✓' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                onPress={() => void confirmPickedRow()}
                disabled={pickedSaving}
                style={({ pressed }) => [
                  styles.manualSubmit,
                  pressed && styles.cardPressed,
                  pickedSaving && { opacity: 0.6 },
                ]}>
                {pickedSaving ? (
                  <ActivityIndicator color={BaggedColors.green} />
                ) : (
                  <Text style={styles.manualSubmitText}>
                    {pickedStores.length === 0 && pickedDietTags.length === 0
                      ? 'Add to New Releases (no tags)'
                      : 'Add to New Releases'}
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </>
        ) : (
          <>
            {!isEditing ? (
              <Pressable
                onPress={switchToSearch}
                style={({ pressed }) => [styles.manualBackBtn, pressed && styles.cardPressed]}
                hitSlop={6}>
                <Ionicons name="chevron-back" size={18} color={BaggedColors.muted} />
                <Text style={styles.manualBackText}>Back to search</Text>
              </Pressable>
            ) : null}
            <Text style={styles.adminSheetHint}>
              {isEditing
                ? 'Fix the product title, brand, category, stores, tags, or macros. Changes apply to the curated catalog and this New Release.'
                : 'Enter the product details. We’ll create a curated entry, stamp today as the release date, and post it to Discover · New Releases.'}
            </Text>
            {feedback ? (
              <Text
                style={[
                  styles.adminFeedback,
                  feedback.tone === 'warn' ? styles.adminFeedbackWarn : styles.adminFeedbackOk,
                ]}>
                {feedback.text}
              </Text>
            ) : null}
            <ScrollView
              style={styles.flex}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.manualForm}>
              <Text style={styles.manualLabel}>Product title</Text>
              <TextInput
                value={manualTitle}
                onChangeText={setManualTitle}
                placeholder="e.g. Spicy Honey Roasted Almonds"
                placeholderTextColor={BaggedColors.muted}
                style={styles.manualInput}
                autoCapitalize="words"
              />

              <Text style={styles.manualLabel}>Brand</Text>
              <TextInput
                value={manualBrand}
                onChangeText={setManualBrand}
                placeholder="e.g. Trader Joe’s"
                placeholderTextColor={BaggedColors.muted}
                style={styles.manualInput}
                autoCapitalize="words"
              />

              <Text style={styles.manualLabel}>Category</Text>
              <View style={styles.manualChipWrap}>
                {CATEGORIES.map((c) => {
                  const active = manualCategory === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setManualCategory(c)}
                      style={[styles.manualChip, active && styles.manualChipActive]}>
                      <Text style={[styles.manualChipText, active && styles.manualChipTextActive]}>
                        {legacyCategoryChipLabel(c)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.manualLabel}>Stores (tap to toggle)</Text>
              <View style={styles.manualChipWrap}>
                {STORES.map((s) => {
                  const active = manualStores.includes(s);
                  return (
                    <Pressable
                      key={s}
                      onPress={() => toggleManualStore(s)}
                      style={[styles.manualChip, active && styles.manualChipActive]}>
                      <Text style={[styles.manualChipText, active && styles.manualChipTextActive]}>
                        {s}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.manualLabel}>Diet tags (optional)</Text>
              <View style={styles.manualChipWrap}>
                {DIET_TAGS.map((tag) => {
                  const active = manualDietTags.includes(tag.id);
                  return (
                    <Pressable
                      key={tag.id}
                      onPress={() => toggleManualDietTag(tag.id)}
                      style={[
                        styles.manualChip,
                        {
                          borderColor: tag.color,
                          backgroundColor: active ? tag.bgActive : tag.bg,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.manualChipText,
                          { color: tag.color },
                          active && { fontWeight: '700' },
                        ]}>
                        {tag.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.manualLabel}>Macros (optional)</Text>
              <View style={styles.macroGrid}>
                <ManualMacroInput
                  label="Cal"
                  value={manualMacros.cal}
                  onChangeText={setMacroField('cal')}
                />
                <ManualMacroInput
                  label="Protein (g)"
                  value={manualMacros.protein}
                  onChangeText={setMacroField('protein')}
                />
                <ManualMacroInput
                  label="Carbs (g)"
                  value={manualMacros.carbs}
                  onChangeText={setMacroField('carbs')}
                />
                <ManualMacroInput
                  label="Fat (g)"
                  value={manualMacros.fat}
                  onChangeText={setMacroField('fat')}
                />
              </View>

              <Text style={styles.manualLabel}>Serving label (optional)</Text>
              <TextInput
                value={manualMacros.servingLabel}
                onChangeText={setMacroField('servingLabel')}
                placeholder="e.g. 1 cup (240ml)"
                placeholderTextColor={BaggedColors.muted}
                style={styles.manualInput}
              />

              <Pressable
                onPress={() => void submitManual()}
                disabled={manualSaving}
                style={({ pressed }) => [
                  styles.manualSubmit,
                  pressed && styles.cardPressed,
                  manualSaving && { opacity: 0.6 },
                ]}>
                {manualSaving ? (
                  <ActivityIndicator color={BaggedColors.green} />
                ) : (
                  <Text style={styles.manualSubmitText}>
                    {isEditing ? 'Save changes' : 'Add to New Releases'}
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ManualMacroInput({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.macroCellLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholder="enter"
        placeholderTextColor={BaggedColors.muted}
        style={styles.macroInput}
      />
    </View>
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
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
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
  discoverSection: {
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderRadius: 16,
    padding: 16,
  },
  discoverSectionSpaced: {
    marginTop: 20,
  },
  sectionBlockHeader: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    fontWeight: '800',
    color: BaggedColors.dark,
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    fontWeight: '500',
    marginTop: 4,
    lineHeight: 18,
  },
  filterPanel: {
    marginBottom: 4,
    gap: 2,
  },
  sectionLoading: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  newReleasesRail: {
    gap: 12,
    paddingRight: 4,
    paddingBottom: 4,
  },
  newReleaseCard: {
    width: 220,
    backgroundColor: BaggedColors.content,
    borderWidth: 1,
    borderColor: BaggedColors.border,
    borderLeftWidth: 4,
    borderLeftColor: BaggedColors.accent,
    borderRadius: 14,
    padding: 12,
  },
  newReleaseCardInner: {
    gap: 8,
  },
  newReleaseTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.dark,
    marginTop: 4,
  },
  newReleaseBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
  },
  newReleaseMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  newReleaseStore: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.muted,
    fontWeight: '600',
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
  filterToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  filterToggleLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '800',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  filterChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  storeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
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
    color: BaggedColors.green,
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
    gap: 8,
    alignItems: 'center',
  },
  exploreResultTap: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    minWidth: 0,
  },
  exploreResultActions: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingLeft: 4,
  },
  exploreResultActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingLeft: 0,
    marginTop: 10,
    gap: 8,
  },
  exploreIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
  },
  exploreRateBtn: {
    backgroundColor: BaggedColors.accentPale,
    borderColor: BaggedColors.accent,
  },
  exploreRerankBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
    backgroundColor: BaggedColors.accentPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exploreRerankText: {
    fontFamily: BaggedFonts.display,
    fontSize: 11,
    fontWeight: '800',
    color: BaggedColors.accent,
  },
  exploreWantBtnOn: {
    backgroundColor: BaggedColors.accentPaleActive,
    borderColor: BaggedColors.accent,
  },
  exploreIconBtnDark: {
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  exploreWantBtnOnDark: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: BaggedColors.green,
  },
  exploreRerankBtnDark: {
    borderColor: BaggedColors.green,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  exploreRerankTextDark: {
    color: BaggedColors.green,
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
  adminAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: BaggedColors.dietTagBg,
    borderWidth: 1,
    borderColor: BaggedColors.borderSoft,
    marginBottom: 12,
  },
  adminAddBtnPressed: {
    opacity: 0.7,
  },
  adminAddBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  adminCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    marginTop: 8,
  },
  adminEditBtn: {
    padding: 5,
    borderRadius: 6,
  },
  adminEditBtnPressed: {
    opacity: 0.6,
  },
  flex: { flex: 1 },
  adminSheet: {
    flex: 1,
    backgroundColor: BaggedColors.content,
    paddingTop: 18,
  },
  adminSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: BaggedLayout.screenPadding,
    marginBottom: 8,
  },
  adminSheetTitle: {
    flex: 1,
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.dark,
  },
  adminSheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminSheetHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    paddingHorizontal: BaggedLayout.screenPadding,
    marginBottom: 14,
    lineHeight: 18,
  },
  adminSheetInput: {
    marginHorizontal: BaggedLayout.screenPadding,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: BaggedColors.card,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.dark,
  },
  adminFeedback: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    paddingHorizontal: BaggedLayout.screenPadding,
    marginTop: 10,
  },
  adminFeedbackOk: {
    color: BaggedColors.accent,
  },
  adminFeedbackWarn: {
    color: BaggedColors.red,
  },
  adminSheetList: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 8,
  },
  adminSheetLoading: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  adminResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: BaggedColors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BaggedColors.border,
  },
  adminResultBody: {
    flex: 1,
    minWidth: 0,
  },
  adminResultTitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
  adminResultBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    marginTop: 2,
  },
  adminResultBrandMissing: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontStyle: 'italic',
    color: BaggedColors.accent,
    marginTop: 2,
  },
  adminResultMeta: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  adminMetaPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  adminMetaPillCurated: {
    backgroundColor: BaggedColors.dietTagBgActive,
  },
  adminMetaPillText: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.dark,
  },
  manualCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
    backgroundColor: BaggedColors.accentPale,
  },
  manualCtaBody: {
    flex: 1,
    minWidth: 0,
  },
  manualCtaTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 14,
    fontWeight: '800',
    color: BaggedColors.accent,
  },
  manualCtaSub: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.dark,
    marginTop: 2,
    lineHeight: 16,
  },
  manualFooterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
    marginTop: 4,
  },
  manualFooterBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  manualBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    paddingHorizontal: BaggedLayout.screenPadding,
    marginBottom: 4,
  },
  manualBackText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
  manualForm: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 12,
    paddingBottom: 48,
    gap: 6,
  },
  manualLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '800',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 6,
  },
  manualInput: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.dark,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderRadius: 12,
    backgroundColor: BaggedColors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  manualChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  manualChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
  },
  manualChipActive: {
    backgroundColor: BaggedColors.dark,
    borderColor: BaggedColors.dark,
  },
  manualChipText: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
  manualChipTextActive: {
    color: BaggedColors.green,
  },
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  macroCell: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 0,
  },
  macroCellLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    marginBottom: 4,
  },
  macroInput: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.dark,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderRadius: 10,
    backgroundColor: BaggedColors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickedSummaryCard: {
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderLeftWidth: 4,
    borderLeftColor: BaggedColors.accent,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 12,
  },
  pickedSummaryTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 17,
    color: BaggedColors.dark,
    lineHeight: 22,
  },
  pickedSummaryBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    marginTop: 4,
  },
  pickedExistingHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    marginTop: -2,
    marginBottom: 6,
    fontStyle: 'italic',
  },
  pickedExistingLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  pickedExistingLoadingText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
  },
  manualSubmit: {
    marginTop: 24,
    backgroundColor: BaggedColors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualSubmitText: {
    fontFamily: BaggedFonts.display,
    fontSize: 15,
    fontWeight: '800',
    color: BaggedColors.green,
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
  trendingMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trendingTap: {
    flex: 1,
    minWidth: 0,
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
    color: BaggedColors.green,
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
    color: BaggedColors.green,
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
    backgroundColor: BaggedColors.white,
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
    borderColor: BaggedColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmpty: {
    fontFamily: BaggedFonts.display,
    fontSize: 16,
    color: BaggedColors.muted,
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
