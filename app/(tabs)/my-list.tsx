import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ALL_CATEGORIES,
  ALL_STORES,
  FilterBar,
  rowMatchesCategoryFilter,
  rowMatchesStoreFilter,
  type FilterCategory,
  type FilterStore,
} from '@/components/bagged/filter-bar';
import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { MacrosPills } from '@/components/bagged/macros-pills';
import { ScoreBadge } from '@/components/bagged/score-badge';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import {
  getUserRankings,
  getWantToTry,
  isRadarOnlyDbRow,
  normalizeMacros,
  normalizedDescriptionKeyFromItem,
  removeFromWantToTry,
  type RankedPostRow,
  type WantToTryItem,
} from '@/lib/data';
import { formatProductDisplayName } from '@/lib/format';
import { computeScoresByCategory, normalizeVibe } from '@/lib/ranking';
import { useAuth } from '@/providers/auth-provider';
import { useDisplaySettings } from '@/providers/display-settings-provider';

type Subtab = 'tried' | 'want';

type ScoredRow = RankedPostRow & { rating: number };

export default function MyListScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const { showMacroNutrition } = useDisplaySettings();

  const [subtab, setSubtab] = useState<Subtab>('tried');
  const [tried, setTried] = useState<RankedPostRow[]>([]);
  const [wantList, setWantList] = useState<WantToTryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [storeFilter, setStoreFilter] = useState<FilterStore>(ALL_STORES);
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>(ALL_CATEGORIES);

  const load = useCallback(
    async (uid: string) => {
      const [posts, wants] = await Promise.all([
        getUserRankings(uid),
        getWantToTry(uid).catch((err) => {
          console.warn('getWantToTry:', err);
          return [] as WantToTryItem[];
        }),
      ]);
      setTried(posts.filter((p) => !isRadarOnlyDbRow(p)));
      setWantList(wants);
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      setLoading(true);
      load(userId).finally(() => setLoading(false));
    }, [userId, load])
  );

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    await load(userId);
    setRefreshing(false);
  }, [userId, load]);

  // Score the tried list using the same algorithm the web uses on My List.
  // We score the full list (so ranks within a category are stable) and only
  // filter the result for display — that way score = "where this item sits
  // in the user's whole category", not "in the filtered subset".
  const triedScored = useMemo<ScoredRow[]>(
    () =>
      computeScoresByCategory(
        tried.map((p) => ({ ...p, vibe: normalizeVibe(p.vibe) }))
      ) as ScoredRow[],
    [tried]
  );

  const filteredTried = useMemo(
    () =>
      triedScored.filter(
        (r) => rowMatchesStoreFilter(r, storeFilter) && rowMatchesCategoryFilter(r, categoryFilter)
      ),
    [triedScored, storeFilter, categoryFilter]
  );

  const filteredWant = useMemo(
    () =>
      wantList.filter(
        (r) => rowMatchesStoreFilter(r, storeFilter) && rowMatchesCategoryFilter(r, categoryFilter)
      ),
    [wantList, storeFilter, categoryFilter]
  );

  const triedByCategory = useMemo(() => {
    const buckets = new Map<string, ScoredRow[]>();
    for (const row of filteredTried) {
      const key = row.category || 'Snacks';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(row);
    }
    return Array.from(buckets.entries()).map(([cat, items]) => ({
      category: cat,
      items: [...items].sort((a, b) => b.rating - a.rating),
    }));
  }, [filteredTried]);

  const wantByCategory = useMemo(() => {
    const buckets = new Map<string, WantToTryItem[]>();
    for (const row of filteredWant) {
      const key = row.category || 'Snacks';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(row);
    }
    return Array.from(buckets.entries()).map(([cat, items]) => ({ category: cat, items }));
  }, [filteredWant]);

  const handleOpenProductFromTried = (row: ScoredRow) => {
    const dk =
      String((row as { description_key?: string | null }).description_key ?? '').trim().toLowerCase() ||
      normalizedDescriptionKeyFromItem(row.item);
    router.push({
      pathname: '/product/detail',
      params: {
        item: row.item,
        brand: row.product_brand ?? '',
        category: row.category,
        store: row.store ?? '',
        descriptionKey: dk,
      },
    });
  };

  const handleOpenProductFromWant = (row: WantToTryItem) => {
    router.push({
      pathname: '/product/detail',
      params: {
        item: row.item,
        brand: row.brand,
        category: row.category,
        store: row.store,
        descriptionKey: normalizedDescriptionKeyFromItem(row.item),
      },
    });
  };

  const handleRemoveWant = async (item: WantToTryItem) => {
    if (!userId) return;
    setWantList((prev) => prev.filter((w) => w.id !== item.id));
    try {
      await removeFromWantToTry(userId, item.item, item.store);
    } catch (err) {
      console.warn('remove from want:', err);
      setWantList((prev) => [...prev, item]);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.brand}>My List</Text>
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
      <FilterBar
        variant="chips"
        store={storeFilter}
        category={categoryFilter}
        onStoreChange={setStoreFilter}
        onCategoryChange={setCategoryFilter}
      />
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
          triedByCategory.length === 0 ? (
            <EmptyState
              title="Your list is empty"
              body="Tap the orange + tab below to rate something."
            />
          ) : (
            triedByCategory.map(({ category, items }) => (
              <CategorySection key={category} title={category}>
                {items.map((row, idx) => (
                  <TriedRow
                    key={String(row.id)}
                    row={row}
                    rank={idx + 1}
                    showMacros={showMacroNutrition}
                    onPress={() => handleOpenProductFromTried(row)}
                  />
                ))}
              </CategorySection>
            ))
          )
        ) : wantByCategory.length === 0 ? (
          <EmptyState
            title="No saved items yet"
            body="Tap “Want to Try” on a feed card to save it for later."
          />
        ) : (
          wantByCategory.map(({ category, items }) => (
            <CategorySection key={category} title={category}>
              {items.map((row) => (
                <WantRow
                  key={row.id}
                  row={row}
                  onOpen={() => handleOpenProductFromWant(row)}
                  onRemove={() => handleRemoveWant(row)}
                />
              ))}
            </CategorySection>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
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
      <Text style={[styles.subtabLabel, active && styles.subtabLabelActive]}>
        {label} <Text style={styles.subtabCount}>{count}</Text>
      </Text>
    </Pressable>
  );
}

function CategorySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.categoryBlock}>
      <Text style={styles.categoryTitle}>{title}</Text>
      <View style={styles.categoryBody}>{children}</View>
    </View>
  );
}

function TriedRow({
  row,
  rank,
  showMacros,
  onPress,
}: {
  row: ScoredRow;
  rank: number;
  showMacros: boolean;
  onPress: () => void;
}) {
  const macros = normalizeMacros(row.macros);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.rowItem, pressed && styles.pressed]}>
      <Text style={styles.rank}>#{rank}</Text>
      <View style={styles.rowBody}>
        <AutoFitText style={styles.rowItemName} numberOfLines={2}>
          {formatProductDisplayName(row.item)}
        </AutoFitText>
        <AutoFitText style={styles.rowMeta} numberOfLines={1}>
          {(row.store || '').toString()}
          {row.product_brand ? ` · ${formatProductDisplayName(row.product_brand)}` : ''}
        </AutoFitText>
        {showMacros ? <MacrosPills macros={macros} size="sm" /> : null}
      </View>
      <ScoreBadge rating={row.rating} size={14} />
    </Pressable>
  );
}

function WantRow({
  row,
  onOpen,
  onRemove,
}: {
  row: WantToTryItem;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.rowItem}>
      <Pressable onPress={onOpen} style={styles.wantRowMain}>
        <View style={styles.wantBullet} />
        <View style={styles.rowBody}>
          <AutoFitText style={styles.rowItemName} numberOfLines={2}>
            {formatProductDisplayName(row.item)}
          </AutoFitText>
          <AutoFitText style={styles.rowMeta} numberOfLines={1}>
            {row.store}
            {row.brand ? ` · ${formatProductDisplayName(row.brand)}` : ''}
          </AutoFitText>
        </View>
      </Pressable>
      <Pressable onPress={onRemove} hitSlop={8} style={styles.removeBtn}>
        <Text style={styles.removeText}>Remove</Text>
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
    color: '#FFFFFF',
  },
  subtabCount: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.65,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32 + BaggedLayout.rateFabListInset,
    flexGrow: 1,
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
  categoryBlock: {
    marginBottom: 24,
  },
  categoryTitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  categoryBody: {
    backgroundColor: BaggedColors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    overflow: 'hidden',
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderSoft,
  },
  wantRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  pressed: { opacity: 0.7 },
  rank: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.muted,
    width: 32,
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
  wantBullet: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: BaggedColors.accent,
    marginLeft: 11,
    marginRight: 11,
  },
  removeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  removeText: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
});
