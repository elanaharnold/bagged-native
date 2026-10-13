import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ALL_STORES, dietTagCountsFromRows, rowMatchesDietFilters, rowMatchesStoreFilter, rowMatchesTwoLevelCategoryFilter, type FilterStore } from '@/components/bagged/filter-bar';
import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { ExpandableMentionText } from '@/components/bagged/expandable-text';
import { WantToTryTag } from '@/components/bagged/want-to-try-tag';
import { MacrosPills } from '@/components/bagged/macros-pills';
import { PostNoteEditorModal } from '@/components/bagged/post-note-editor-modal';
import { RerankRequiredBanner, RerankRequiredChip } from '@/components/bagged/rerank-required-banner';
import { ScoreBadge } from '@/components/bagged/score-badge';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import {
  getParentCategory,
  getParentCategoryById,
  getSubcategoriesForParent,
  getSubcategory,
  PARENT_CATEGORIES,
  subcategoryForRow,
} from '@/constants/categories';
import { displayStoreForRow } from '@/constants/grocery';
import {
  filterWantToTryExcludingRanked,
  getUserRankings,
  getWantToTry,
  isRadarOnlyDbRow,
  normalizePostMacros,
  productDescriptionKey,
  updateWantToTryNote,
  type RankedPostRow,
  type WantToTryItem,
} from '@/lib/data';
import { pokeFeedRefresh, setMyListRefreshListener } from '@/lib/feed-refresh-poke';
import { formatProductDisplayName } from '@/lib/format';
import { subcategoryLabelForRow } from '@/lib/categories';
import { removeWantToTryAfterRanking, removeWantToTryWithFeed } from '@/lib/want-to-try-feed';
import {
  canonicalRatingsFromRankedRows,
  normalizeVibe,
  postNeedsRecategorization,
} from '@/lib/ranking';
import { shareScoreCardFromRankedRow } from '@/lib/share-score-card';
import { twoLevelCategoryListShareableFromRows } from '@/lib/share-category-list';
import { useAuth } from '@/providers/auth-provider';
import { useDisplaySettings } from '@/providers/display-settings-provider';
import { useShareScoreCard } from '@/providers/share-score-card-provider';

type Subtab = 'tried' | 'want';
type ScoredRow = RankedPostRow & { rating: number };

export default function MyListScreen() {
  const router = useRouter();
  const { userId, username } = useAuth();
  const { showMacroNutrition } = useDisplaySettings();
  const { openShareScoreCard, openCategoryListShareable } = useShareScoreCard();

  const [subtab, setSubtab] = useState<Subtab>('tried');
  const [tried, setTried] = useState<RankedPostRow[]>([]);
  const [wantList, setWantList] = useState<WantToTryItem[]>([]);
  const [noteEditorWant, setNoteEditorWant] = useState<WantToTryItem | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [storeFilter, setStoreFilter] = useState<FilterStore>(ALL_STORES);
  const [dietFilters, setDietFilters] = useState<string[]>([]);
  const [parentFilter, setParentFilter] = useState<string | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<TextInput>(null);

  const load = useCallback(async (uid: string) => {
    const [posts, wants] = await Promise.all([
      getUserRankings(uid),
      getWantToTry(uid).catch((err) => {
        console.warn('getWantToTry:', err);
        return [] as WantToTryItem[];
      }),
    ]);
    const ranked = posts.filter((p) => !isRadarOnlyDbRow(p));
    const visibleWants = filterWantToTryExcludingRanked(wants, ranked);
    setTried(ranked);
    setWantList(visibleWants);

    const staleWants = wants.filter((w) => !visibleWants.some((v) => v.id === w.id));
    for (const row of staleWants) {
      removeWantToTryAfterRanking(uid, {
        item: row.item,
        radarPostIdHint: row.radarPostId,
      }).catch((err) => console.warn('removeWantToTryAfterRanking:', err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      setLoading(true);
      load(userId).finally(() => setLoading(false));
    }, [userId, load])
  );

  useEffect(() => {
    if (!userId) {
      setMyListRefreshListener(null);
      return undefined;
    }
    const refreshMyList = () => {
      void load(userId);
    };
    setMyListRefreshListener(refreshMyList);
    return () => setMyListRefreshListener(null);
  }, [userId, load]);

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    await load(userId);
    setRefreshing(false);
  }, [userId, load]);

  const pendingRerank = useMemo(
    () => tried.filter((row) => postNeedsRecategorization(row)),
    [tried]
  );

  const handleRerankPost = useCallback(
    (postId: string | number) => {
      router.push({
        pathname: '/rate',
        params: { rerankPostId: String(postId) },
      });
    },
    [router]
  );

  const triedScored = useMemo<ScoredRow[]>(
    () =>
      canonicalRatingsFromRankedRows(
        tried.map((p) => ({ ...p, vibe: normalizeVibe(p.vibe) }))
      ) as ScoredRow[],
    [tried]
  );

  const searchTried = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return triedScored;
    return triedScored.filter((p) => {
      const blob = [
        p.item,
        p.product_brand,
        p.store,
        p.note,
        p.category,
        getSubcategory(subcategoryForRow(p))?.label,
        ...(Array.isArray(p.stores) ? p.stores : []),
      ]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ');
      return blob.includes(q);
    });
  }, [triedScored, searchQuery]);

  const searchWant = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return wantList;
    return wantList.filter((p) => {
      const blob = [p.item, p.brand, p.store, p.category, p.note, ...(Array.isArray(p.stores) ? p.stores : [])]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ');
      return blob.includes(q);
    });
  }, [wantList, searchQuery]);

  const storeFilteredTried = useMemo(
    () => searchTried.filter((r) => rowMatchesStoreFilter(r, storeFilter)),
    [searchTried, storeFilter]
  );

  const dietFilteredTried = useMemo(
    () => storeFilteredTried.filter((r) => rowMatchesDietFilters(r, dietFilters)),
    [storeFilteredTried, dietFilters]
  );

  const storeFilteredWant = useMemo(
    () => searchWant.filter((r) => rowMatchesStoreFilter(r, storeFilter)),
    [searchWant, storeFilter]
  );

  const dietCounts = useMemo(
    () => (subtab === 'tried' ? dietTagCountsFromRows(storeFilteredTried) : new Map<string, number>()),
    [subtab, storeFilteredTried]
  );

  const parentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const source = subtab === 'tried' ? dietFilteredTried : storeFilteredWant;
    for (const row of source) {
      const subId = subcategoryForRow(row);
      const parent = getParentCategory(subId);
      if (parent) counts.set(parent.id, (counts.get(parent.id) ?? 0) + 1);
    }
    return counts;
  }, [subtab, dietFilteredTried, storeFilteredWant]);

  const subcategoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!parentFilter) return counts;
    const source = subtab === 'tried' ? dietFilteredTried : storeFilteredWant;
    for (const row of source) {
      const subId = subcategoryForRow(row);
      if (getParentCategory(subId)?.id !== parentFilter) continue;
      counts.set(subId, (counts.get(subId) ?? 0) + 1);
    }
    return counts;
  }, [subtab, dietFilteredTried, storeFilteredWant, parentFilter]);

  const relevantStores = useMemo(() => {
    const source = subtab === 'tried' ? searchTried : searchWant;
    const stores = new Set<string>();
    for (const row of source) {
      const s = displayStoreForRow(row);
      if (s) stores.add(s);
    }
    return [...stores].sort((a, b) => a.localeCompare(b));
  }, [subtab, searchTried, searchWant]);

  const filteredTried = useMemo(
    () =>
      dietFilteredTried.filter((r) =>
        rowMatchesTwoLevelCategoryFilter(r, parentFilter, subcategoryFilter)
      ),
    [dietFilteredTried, parentFilter, subcategoryFilter]
  );

  const filteredWant = useMemo(
    () =>
      storeFilteredWant.filter((r) =>
        rowMatchesTwoLevelCategoryFilter(r, parentFilter, subcategoryFilter)
      ),
    [storeFilteredWant, parentFilter, subcategoryFilter]
  );

  const showRankNumbers = subcategoryFilter != null;

  const flatTriedList = useMemo((): ScoredRow[] => {
    if (!showRankNumbers) {
      return [...filteredTried].sort((a, b) => b.rating - a.rating);
    }
    if (subcategoryFilter != null) {
      return [...filteredTried].sort((a, b) => b.rating - a.rating);
    }
    return [...filteredTried].sort((a, b) => b.rating - a.rating);
  }, [filteredTried, showRankNumbers, subcategoryFilter]);

  const showSubcategoryOnRows = subcategoryFilter == null;

  const listTitle = useMemo(() => {
    if (subcategoryFilter) return getSubcategory(subcategoryFilter)?.label ?? 'Rankings';
    if (parentFilter) return getParentCategoryById(parentFilter)?.label ?? 'Rankings';
    if (storeFilter !== ALL_STORES) return storeFilter;
    return 'All rankings';
  }, [parentFilter, subcategoryFilter, storeFilter]);

  const listCount =
    subtab === 'tried'
      ? filteredTried.length
      : filteredWant.length;

  const handleOpenProductFromTried = (row: ScoredRow) => {
    const dk = productDescriptionKey(row.item, row.product_brand);
    router.push({
      pathname: '/product/detail',
      params: {
        item: row.item,
        brand: row.product_brand ?? '',
        category: row.category,
        subcategory: subcategoryForRow(row),
        store: row.store ?? '',
        descriptionKey: dk,
      },
    });
  };

  const handleShareScoreCard = (row: ScoredRow) => {
    if (!username) return;
    const payload = shareScoreCardFromRankedRow(row, username);
    if (payload) openShareScoreCard(payload);
  };

  const shareCategoryList = useCallback(
    (opts: { parentId?: string | null; subcategoryId?: string | null; label: string }) => {
      if (!username) return;
      const payload = twoLevelCategoryListShareableFromRows(
        opts.label,
        triedScored,
        username,
        { parentId: opts.parentId, subcategoryId: opts.subcategoryId },
        {
          displayName: username,
          avatarChar: username.charAt(0).toUpperCase(),
        }
      );
      if (payload) openCategoryListShareable(payload);
    },
    [username, triedScored, openCategoryListShareable]
  );

  const shareCategoryListForCurrentFilter = useCallback(() => {
    if (subcategoryFilter) {
      shareCategoryList({
        parentId: parentFilter,
        subcategoryId: subcategoryFilter,
        label: getSubcategory(subcategoryFilter)?.label ?? 'Category',
      });
      return;
    }
    if (parentFilter) {
      shareCategoryList({
        parentId: parentFilter,
        label: getParentCategoryById(parentFilter)?.label ?? 'Category',
      });
    }
  }, [parentFilter, subcategoryFilter, shareCategoryList]);

  const handleOpenProductFromWant = (row: WantToTryItem) => {
    router.push({
      pathname: '/product/detail',
      params: {
        item: row.item,
        brand: row.brand,
        category: row.category,
        subcategory: subcategoryForRow(row),
        store: row.store,
        descriptionKey: productDescriptionKey(row.item, row.brand),
      },
    });
  };

  const handleRemoveWant = async (item: WantToTryItem) => {
    if (!userId) return;
    setWantList((prev) => prev.filter((w) => w.id !== item.id));
    try {
      await removeWantToTryWithFeed(userId, item.item, item.store, item.radarPostId);
      pokeFeedRefresh();
    } catch (err) {
      console.warn('remove from want:', err);
      setWantList((prev) => [...prev, item]);
    }
  };

  const handlePromoteWant = (item: WantToTryItem) => {
    const params: Record<string, string> = {
      prefilledItem: item.item,
      prefilledBrand: item.brand ?? '',
    };
    if (item.category) params.prefilledCategory = item.category;
    if (item.note?.trim()) params.prefilledNote = item.note.trim();
    params.isWantToTry = 'true';
    if (item.radarPostId) params.wantToTryRadarPostId = item.radarPostId;
    router.push({ pathname: '/rate', params });
  };

  const handleSaveWantNote = async (note: string) => {
    if (!userId || !noteEditorWant || noteSaving) return;
    setNoteSaving(true);
    try {
      await updateWantToTryNote(userId, noteEditorWant.item, noteEditorWant.store, note);
      setWantList((prev) =>
        prev.map((w) =>
          w.id === noteEditorWant.id ? { ...w, note: note.trim() } : w
        )
      );
      setNoteEditorWant(null);
    } catch (err) {
      console.warn('updateWantToTryNote:', err);
    } finally {
      setNoteSaving(false);
    }
  };

  const showFilters =
    !loading && (subtab === 'tried' ? tried.length > 0 : wantList.length > 0);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, []);

  const closeSearch = useCallback((clearQuery = true) => {
    searchInputRef.current?.blur();
    setSearchOpen(false);
    if (clearQuery) setSearchQuery('');
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <View style={styles.header}>
        {searchOpen ? (
          <View style={styles.headerSearchBar}>
            <Ionicons name="search" size={18} color={BaggedColors.muted} />
            <TextInput
              ref={searchInputRef}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search this list"
              placeholderTextColor={BaggedColors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={styles.headerSearchInput}
            />
            <Pressable
              onPress={() => closeSearch(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close search">
              <Ionicons name="close-circle" size={20} color={BaggedColors.muted} />
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.brand}>My List</Text>
            <Pressable
              onPress={openSearch}
              style={styles.headerSearchBtn}
              accessibilityRole="button"
              accessibilityLabel="Search this list">
              <Ionicons
                name={searchQuery.trim() ? 'search' : 'search-outline'}
                size={22}
                color={BaggedColors.dark}
              />
              {searchQuery.trim() ? <View style={styles.searchActiveDot} /> : null}
            </Pressable>
          </>
        )}
      </View>
      <View style={styles.subtabRow}>
        <SubtabButton label="Tried" count={tried.length} active={subtab === 'tried'} onPress={() => setSubtab('tried')} />
        <SubtabButton
          label="Want to Try"
          count={wantList.length}
          active={subtab === 'want'}
          onPress={() => setSubtab('want')}
        />
      </View>

      {showFilters ? (
        <View style={styles.filtersBlock}>
          {relevantStores.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}>
              <FilterChip
                label="All stores"
                active={storeFilter === ALL_STORES}
                onPress={() => setStoreFilter(ALL_STORES)}
              />
              {relevantStores.map((store) => (
                <FilterChip
                  key={store}
                  label={store}
                  active={storeFilter === store}
                  onPress={() => setStoreFilter(store as FilterStore)}
                />
              ))}
            </ScrollView>
          ) : null}

          {subtab === 'tried' && dietCounts.size > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}>
              <FilterChip
                label="Any diet"
                active={dietFilters.length === 0}
                onPress={() => setDietFilters([])}
              />
              {DIET_TAGS.filter((tag) => (dietCounts.get(tag.id) ?? 0) > 0).map((tag) => {
                const active = dietFilters.includes(tag.id);
                return (
                  <FilterChip
                    key={tag.id}
                    label={`${tag.label} (${dietCounts.get(tag.id)})`}
                    active={active}
                    onPress={() =>
                      setDietFilters((prev) =>
                        active ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                      )
                    }
                  />
                );
              })}
            </ScrollView>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}>
            <FilterChip
              label="All"
              active={parentFilter == null}
              onPress={() => {
                setParentFilter(null);
                setSubcategoryFilter(null);
              }}
            />
            {PARENT_CATEGORIES.filter((p) => (parentCounts.get(p.id) ?? 0) > 0).map((parent) => {
              const active = parentFilter === parent.id;
              return (
              <FilterChip
                key={parent.id}
                label={`${parent.label} (${parentCounts.get(parent.id)})`}
                active={active}
                onPress={() => {
                  setParentFilter(active ? null : parent.id);
                  setSubcategoryFilter(null);
                }}
                onLongPress={() =>
                  shareCategoryList({ parentId: parent.id, label: parent.label })
                }
              />
              );
            })}
          </ScrollView>

          {parentFilter ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}>
              <FilterChip
                label="All in category"
                active={subcategoryFilter == null}
                onPress={() => setSubcategoryFilter(null)}
                onLongPress={() => {
                  const parent = getParentCategoryById(parentFilter);
                  if (parent) {
                    shareCategoryList({ parentId: parent.id, label: parent.label });
                  }
                }}
              />
              {getSubcategoriesForParent(parentFilter)
                .filter((sub) => (subcategoryCounts.get(sub.id) ?? 0) > 0)
                .map((sub) => {
                  const active = subcategoryFilter === sub.id;
                  return (
                  <FilterChip
                    key={sub.id}
                    label={`${sub.label} (${subcategoryCounts.get(sub.id)})`}
                    active={active}
                    onPress={() => setSubcategoryFilter(active ? null : sub.id)}
                    onLongPress={() =>
                      shareCategoryList({
                        parentId: parentFilter,
                        subcategoryId: sub.id,
                        label: sub.label,
                      })
                    }
                  />
                  );
                })}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BaggedColors.dark} />
        }>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={BaggedColors.dark} />
          </View>
        ) : subtab === 'tried' ? (
          flatTriedList.length === 0 ? (
            <EmptyState
              title={
                searchQuery.trim() ||
                parentFilter ||
                subcategoryFilter ||
                storeFilter !== ALL_STORES ||
                dietFilters.length > 0
                  ? 'No matches'
                  : 'Your list is empty'
              }
              body={
                searchQuery.trim() ||
                parentFilter ||
                subcategoryFilter ||
                storeFilter !== ALL_STORES ||
                dietFilters.length > 0
                  ? 'Try a different filter or search term.'
                  : 'Tap the orange + tab below to rate something.'
              }
            />
          ) : (
            <>
              {pendingRerank.length > 0 ? (
                <RerankRequiredBanner
                  count={pendingRerank.length}
                  onPress={
                    pendingRerank.length === 1
                      ? () => handleRerankPost(pendingRerank[0]!.id)
                      : undefined
                  }
                />
              ) : null}
              <Pressable
                onLongPress={shareCategoryListForCurrentFilter}
                disabled={!parentFilter && !subcategoryFilter}
                delayLongPress={420}
                accessibilityRole="header"
                accessibilityHint="Long press to share your top items in this category">
                <Text style={styles.listHeading}>
                  {listTitle} · {listCount} item{listCount === 1 ? '' : 's'}
                </Text>
              </Pressable>
              <View style={styles.listCard}>
                {flatTriedList.map((row, idx) => (
                  <TriedRow
                    key={String(row.id)}
                    row={row}
                    rank={idx + 1}
                    showRank={showRankNumbers && !postNeedsRecategorization(row)}
                    showMacros={showMacroNutrition}
                    showSubcategory={showSubcategoryOnRows}
                    needsRerank={postNeedsRecategorization(row)}
                    onRerank={() => handleRerankPost(row.id)}
                    onPress={() => handleOpenProductFromTried(row)}
                    onLongPress={() => handleShareScoreCard(row)}
                  />
                ))}
              </View>
            </>
          )
        ) : filteredWant.length === 0 ? (
          <EmptyState
            title={searchQuery.trim() || parentFilter || subcategoryFilter ? 'No matches' : 'No saved items yet'}
            body={
              searchQuery.trim() || parentFilter || subcategoryFilter
                ? 'Try a different filter or search term.'
                : 'Search or scan a product, then tap Want to Try. You can also save items from the feed.'
            }
          />
        ) : (
          <>
            <Text style={styles.listHeading}>
              {listTitle} · {listCount} item{listCount === 1 ? '' : 's'}
            </Text>
            <View style={styles.listCard}>
              {filteredWant.map((row) => (
                <WantRow
                  key={row.id}
                  row={row}
                  onOpen={() => handleOpenProductFromWant(row)}
                  onPromote={() => handlePromoteWant(row)}
                  onRemove={() => handleRemoveWant(row)}
                  onEditNote={() => setNoteEditorWant(row)}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <PostNoteEditorModal
        visible={noteEditorWant != null}
        initialNote={noteEditorWant?.note}
        productName={
          noteEditorWant ? formatProductDisplayName(noteEditorWant.item) : undefined
        }
        saving={noteSaving}
        onClose={() => {
          if (noteSaving) return;
          setNoteEditorWant(null);
        }}
        onSave={handleSaveWantNote}
      />
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
  onLongPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={420}
      style={[styles.filterChip, active && styles.filterChipActive]}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SubtabButton({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.subtabBtn, active && styles.subtabBtnActive]}
      hitSlop={6}>
      <Text style={[styles.subtabLabel, active && styles.subtabLabelActive]} numberOfLines={1}>
        {label}{' '}
        <Text style={styles.subtabCount}>{count}</Text>
      </Text>
    </Pressable>
  );
}

function TriedRow({
  row,
  rank,
  showRank = true,
  showMacros,
  showSubcategory = false,
  needsRerank = false,
  onRerank,
  onPress,
  onLongPress,
}: {
  row: ScoredRow;
  rank: number;
  showRank?: boolean;
  showMacros: boolean;
  showSubcategory?: boolean;
  needsRerank?: boolean;
  onRerank?: () => void;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const macros = normalizePostMacros(row.macros);
  const subcategoryLabel = showSubcategory
    ? subcategoryLabelForRow(row)
    : null;
  return (
    <View style={styles.rowItem}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={420}
        style={({ pressed }) => [styles.triedRowMain, pressed && styles.pressed]}>
        {showRank ? (
          <Text style={styles.rank} numberOfLines={1} allowFontScaling={false}>
            #{rank}
          </Text>
        ) : null}
        <View style={styles.rowBody}>
          <AutoFitText style={styles.rowItemName} numberOfLines={3}>
            {formatProductDisplayName(row.item)}
          </AutoFitText>
          <AutoFitText style={styles.rowMeta} numberOfLines={1}>
            {[
              displayStoreForRow(row) || null,
              row.product_brand ? formatProductDisplayName(row.product_brand) : null,
              subcategoryLabel,
            ]
              .filter(Boolean)
              .join(' · ')}
          </AutoFitText>
          {showMacros ? <MacrosPills macros={macros} size="sm" /> : null}
        </View>
        <View style={styles.scoreSlot}>
          {needsRerank && onRerank ? (
            <RerankRequiredChip onPress={onRerank} />
          ) : (
            <ScoreBadge rating={row.rating} size={14} />
          )}
        </View>
      </Pressable>
    </View>
  );
}

function WantRow({
  row,
  onOpen,
  onPromote,
  onRemove,
  onEditNote,
}: {
  row: WantToTryItem;
  onOpen: () => void;
  onPromote: () => void;
  onRemove: () => void;
  onEditNote: () => void;
}) {
  return (
    <View style={styles.wantRowItem}>
      <View style={styles.wantRowTop}>
        <Pressable onPress={onOpen} style={styles.wantRowMain}>
          <View style={styles.wantRowTitleRow}>
            <WantToTryTag compact />
            <View style={styles.rowBody}>
              <AutoFitText style={styles.rowItemName} numberOfLines={3}>
                {formatProductDisplayName(row.item)}
              </AutoFitText>
              <AutoFitText style={styles.rowMeta} numberOfLines={1}>
                {[
                  displayStoreForRow({
                    store: row.store,
                    stores: row.stores,
                    product_brand: row.brand,
                  }) || null,
                  row.brand ? formatProductDisplayName(row.brand) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </AutoFitText>
            </View>
          </View>
        </Pressable>
        <View style={styles.wantActions}>
          <Pressable
            onPress={onPromote}
            hitSlop={8}
            accessibilityLabel={`Rate ${row.item} and move to Tried`}
            accessibilityRole="button"
            style={({ pressed }) => [styles.wantActionBtn, styles.wantPromoteBtn, pressed && styles.pressed]}>
            <Ionicons name="add" size={20} color={BaggedColors.accent} />
          </Pressable>
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            accessibilityLabel={`Remove ${row.item} from Want to Try`}
            accessibilityRole="button"
            style={({ pressed }) => [styles.wantActionBtn, pressed && styles.pressed]}>
            <Ionicons name="trash-outline" size={18} color={BaggedColors.muted} />
          </Pressable>
        </View>
      </View>
      {row.note?.trim() ? (
        <View style={styles.wantNoteWrap}>
          <ExpandableMentionText
            text={row.note.trim()}
            style={styles.wantNote}
            mentionStyle={styles.wantNoteMention}
            numberOfLines={2}
            quoted
          />
        </View>
      ) : null}
      <Pressable onPress={onEditNote} hitSlop={8} style={styles.wantNoteBtn}>
        <Text style={styles.wantNoteBtnText}>
          {row.note?.trim() ? 'Edit note' : 'Add note'}
        </Text>
      </Pressable>
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BaggedColors.content },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    minHeight: 44,
  },
  headerSearchBtn: {
    padding: 6,
    position: 'relative',
  },
  headerSearchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerSearchInput: {
    flex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    color: BaggedColors.dark,
    paddingVertical: 0,
    minHeight: 22,
  },
  searchActiveDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: BaggedColors.accent,
  },
  brand: {
    flex: 1,
    fontFamily: BaggedFonts.display,
    fontSize: 28,
    color: BaggedColors.dark,
    letterSpacing: -0.5,
  },
  subtabRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
  },
  subtabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
  },
  subtabBtnActive: {
    backgroundColor: BaggedColors.dark,
    borderColor: BaggedColors.dark,
  },
  subtabLabel: {
    fontFamily: BaggedFonts.display,
    fontSize: 13,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  subtabLabelActive: {
    color: BaggedColors.green,
  },
  subtabCount: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.65,
  },
  filtersBlock: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 12,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
    maxWidth: 220,
  },
  filterChipActive: {
    backgroundColor: BaggedColors.dark,
    borderColor: BaggedColors.dark,
  },
  filterChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
  filterChipTextActive: {
    color: BaggedColors.green,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32 + BaggedLayout.rateFabListInset,
    flexGrow: 1,
  },
  listHeading: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.muted,
    marginBottom: 8,
  },
  listCard: {
    backgroundColor: BaggedColors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.dark,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.muted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderSoft,
  },
  wantRowItem: {
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderSoft,
    paddingBottom: 8,
  },
  wantRowTop: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  triedRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 0,
  },
  wantRowMain: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  wantRowTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    minWidth: 0,
  },
  pressed: { opacity: 0.7 },
  rank: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.muted,
    minWidth: 44,
    flexShrink: 0,
    textAlign: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowItemName: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.dark,
    lineHeight: 18,
  },
  rowMeta: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    marginTop: 2,
  },
  scoreSlot: {
    minWidth: 40,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  wantActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 8,
  },
  wantActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wantPromoteBtn: {
    backgroundColor: BaggedColors.accentPale,
  },
  wantNoteWrap: {
    paddingHorizontal: 14,
    paddingBottom: 4,
  },
  wantNote: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  wantNoteMention: {
    fontWeight: '700',
    color: BaggedColors.dark,
    fontStyle: 'normal',
  },
  wantNoteBtn: {
    alignSelf: 'flex-start',
    marginLeft: 14,
    marginTop: 2,
    paddingVertical: 4,
  },
  wantNoteBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.accent,
  },
});
