import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/bagged/primary-button';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  dismissDuplicate,
  errorText,
  fetchDuplicateCandidates,
  fetchProductEditSuggestions,
  isBothRated,
  mergeDuplicate,
  resolveProductEditSuggestion,
  suggestedCanonicalSide,
  type DuplicateCandidate,
  type DuplicateSide,
  type ProductEditSuggestion,
} from '@/lib/admin-duplicates';
import { isAdminUsername, PRODUCT_EDIT_SUGGESTION_LABELS } from '@/lib/data';
import { formatProductDisplayName } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';

type Filter = 'both' | 'all';
type Tab = 'duplicates' | 'suggestions';

function pairId(c: DuplicateCandidate): string {
  return `${c.key_a}|${c.key_b}`;
}

export default function AdminDuplicatesScreen() {
  const router = useRouter();
  const { username } = useAuth();
  const isAdmin = isAdminUsername(username);
  const [items, setItems] = useState<DuplicateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('both');
  const [tab, setTab] = useState<Tab>('duplicates');
  const [suggestions, setSuggestions] = useState<ProductEditSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionsErrorMsg, setSuggestionsErrorMsg] = useState<string | null>(null);
  const [suggestionBusyId, setSuggestionBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErrorMsg(null);
      setItems(await fetchDuplicateCandidates());
    } catch (err) {
      setErrorMsg(errorText(err));
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    try {
      setSuggestionsErrorMsg(null);
      setSuggestions(await fetchProductEditSuggestions());
    } catch (err) {
      setSuggestionsErrorMsg(errorText(err));
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void load().finally(() => setLoading(false));
  }, [isAdmin, load]);

  useEffect(() => {
    if (!isAdmin) {
      setSuggestionsLoading(false);
      return;
    }
    void loadSuggestions().finally(() => setSuggestionsLoading(false));
  }, [isAdmin, loadSuggestions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), loadSuggestions()]);
    setRefreshing(false);
  }, [load, loadSuggestions]);

  const bothCount = useMemo(() => items.filter((c) => c.reported || isBothRated(c)).length, [items]);
  const visible = useMemo(
    () => (filter === 'both' ? items.filter((c) => c.reported || isBothRated(c)) : items),
    [items, filter]
  );

  const removeItem = useCallback((c: DuplicateCandidate) => {
    setItems((prev) => prev.filter((x) => pairId(x) !== pairId(c)));
  }, []);

  const confirmMerge = useCallback(
    (c: DuplicateCandidate, keep: DuplicateSide) => {
      const keepName = formatProductDisplayName(keep === 'a' ? c.item_a : c.item_b);
      const dropName = formatProductDisplayName(keep === 'a' ? c.item_b : c.item_a);
      Alert.alert(
        'Merge these products?',
        `Everyone's posts, want-to-try items and barcodes for "${dropName}" will be renamed to "${keepName}". This can't be undone from the app.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Merge',
            style: 'destructive',
            onPress: async () => {
              setBusyId(pairId(c));
              const res = await mergeDuplicate(c, keep);
              setBusyId(null);
              if (res.ok) {
                removeItem(c);
                // Other pairs that involved the retired name are now out of date.
                void load();
                return;
              }
              if (res.reason === 'same_user_conflict') {
                Alert.alert(
                  'Same person ranked both',
                  `${res.users.length ? res.users.map((u) => `@${u}`).join(', ') : 'A user'} ranked both versions. Either they are two different products, or delete one of their two posts first, then merge.`
                );
                return;
              }
              Alert.alert('Could not merge', res.message);
            },
          },
        ]
      );
    },
    [removeItem, load]
  );

  /** Open the product's page (reviews, photos, nutrition) for one side of a pair. */
  const openProduct = useCallback(
    (c: DuplicateCandidate, side: DuplicateSide) => {
      const isA = side === 'a';
      router.push({
        pathname: '/product/detail',
        params: {
          item: isA ? c.item_a : c.item_b,
          brand: isA ? c.brand_a : c.brand_b,
          descriptionKey: isA ? c.key_a : c.key_b,
        },
      });
    },
    [router]
  );

  const onDismiss = useCallback(
    async (c: DuplicateCandidate) => {
      setBusyId(pairId(c));
      const ok = await dismissDuplicate(c);
      setBusyId(null);
      if (ok) removeItem(c);
      else Alert.alert('Could not save', 'Try again in a moment.');
    },
    [removeItem]
  );

  const removeSuggestion = useCallback((s: ProductEditSuggestion) => {
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
  }, []);

  const onResolveSuggestion = useCallback(
    async (s: ProductEditSuggestion, status: 'applied' | 'dismissed') => {
      setSuggestionBusyId(s.id);
      const ok = await resolveProductEditSuggestion(s.id, status);
      setSuggestionBusyId(null);
      if (ok) removeSuggestion(s);
      else Alert.alert('Could not save', 'Try again in a moment.');
    },
    [removeSuggestion]
  );

  const openProductForSuggestion = useCallback(
    (s: ProductEditSuggestion) => {
      router.push({
        pathname: '/product/detail',
        params: {
          item: s.item,
          brand: s.brand ?? '',
          descriptionKey: s.description_key,
        },
      });
    },
    [router]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={BaggedColors.dark} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>
            {tab === 'duplicates' ? 'Potential duplicates' : 'Edit suggestions'}
          </Text>
          <Text style={styles.subtitle}>Admin only</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {!isAdmin ? (
        <View style={styles.centered}>
          <Text style={styles.emptyBody}>This page is only for admins.</Text>
        </View>
      ) : (
        <>
          <View style={styles.filters}>
            <FilterChip
              label={`Duplicates (${items.length})`}
              active={tab === 'duplicates'}
              onPress={() => setTab('duplicates')}
            />
            <FilterChip
              label={`Suggestions (${suggestions.length})`}
              active={tab === 'suggestions'}
              onPress={() => setTab('suggestions')}
            />
          </View>

          {tab === 'duplicates' ? (
            loading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={BaggedColors.dark} />
              </View>
            ) : (
              <>
                <View style={styles.filters}>
                  <FilterChip
                    label={`Both rated (${bothCount})`}
                    active={filter === 'both'}
                    onPress={() => setFilter('both')}
                  />
                  <FilterChip
                    label={`All (${items.length})`}
                    active={filter === 'all'}
                    onPress={() => setFilter('all')}
                  />
                </View>
                <Text style={styles.filterHint}>
                  {filter === 'both'
                    ? 'Both names have ratings, so merging combines their community averages.'
                    : 'Includes pairs where only one name has ratings.'}
                  {' '}Tap a product name to see its reviews.
                </Text>
                <FlatList
                  data={visible}
                  keyExtractor={pairId}
                  contentContainerStyle={styles.scrollContent}
                  initialNumToRender={6}
                  windowSize={7}
                  refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BaggedColors.dark} />
                  }
                  ListHeaderComponent={errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
                  ListEmptyComponent={
                    errorMsg ? null : (
                      <View style={styles.centered}>
                        <Text style={styles.emptyTitle}>Nothing to review</Text>
                        <Text style={styles.emptyBody}>
                          {filter === 'both' && items.length > 0
                            ? 'No pairs with ratings on both names. Try All.'
                            : 'Products that look like an existing one will show up here.'}
                        </Text>
                      </View>
                    )
                  }
                  renderItem={({ item }) => (
                    <DuplicateCard
                      c={item}
                      busy={busyId === pairId(item)}
                      onKeep={(side) => confirmMerge(item, side)}
                      onOpen={(side) => openProduct(item, side)}
                      onDismiss={() => void onDismiss(item)}
                    />
                  )}
                />
              </>
            )
          ) : suggestionsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={BaggedColors.dark} />
            </View>
          ) : (
            <FlatList
              data={suggestions}
              keyExtractor={(s) => s.id}
              contentContainerStyle={styles.scrollContent}
              initialNumToRender={6}
              windowSize={7}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BaggedColors.dark} />
              }
              ListHeaderComponent={
                suggestionsErrorMsg ? <Text style={styles.error}>{suggestionsErrorMsg}</Text> : null
              }
              ListEmptyComponent={
                suggestionsErrorMsg ? null : (
                  <View style={styles.centered}>
                    <Text style={styles.emptyTitle}>Nothing to review</Text>
                    <Text style={styles.emptyBody}>
                      Edits users suggest from a product page will show up here.
                    </Text>
                  </View>
                )
              }
              renderItem={({ item }) => (
                <SuggestionCard
                  s={item}
                  busy={suggestionBusyId === item.id}
                  onOpen={() => openProductForSuggestion(item)}
                  onApplied={() => void onResolveSuggestion(item, 'applied')}
                  onDismiss={() => void onResolveSuggestion(item, 'dismissed')}
                />
              )}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function DuplicateCard({
  c,
  busy,
  onKeep,
  onOpen,
  onDismiss,
}: {
  c: DuplicateCandidate;
  busy: boolean;
  onKeep: (side: DuplicateSide) => void;
  onOpen: (side: DuplicateSide) => void;
  onDismiss: () => void;
}) {
  const suggested = suggestedCanonicalSide(c);
  const blocked = c.conflict_users > 0;
  return (
    <View style={styles.card}>
      {c.reported ? (
        <Text style={styles.reported}>A user confirmed these are the same product</Text>
      ) : c.extras === 0 ? (
        <Text style={styles.similar}>Same words, worded differently</Text>
      ) : (
        <Text style={styles.similar}>
          One name has {c.extras} extra word{c.extras === 1 ? '' : 's'}. Check they are not different
          flavors or sizes.
        </Text>
      )}

      <ProductBlock c={c} side="a" suggested={suggested === 'a'} onOpen={onOpen} />
      <View style={styles.divider} />
      <ProductBlock c={c} side="b" suggested={suggested === 'b'} onOpen={onOpen} />

      {blocked ? (
        <Text style={styles.warn}>
          The same person ranked both versions. That usually means they are different products, so
          this can&apos;t be merged unless you delete one of their posts first.
        </Text>
      ) : null}

      <View style={styles.actions}>
        <PrimaryButton
          label={`Keep "${short(c.item_a)}"`}
          disabled={busy || blocked}
          onPress={() => onKeep('a')}
        />
        <PrimaryButton
          label={`Keep "${short(c.item_b)}"`}
          variant="secondary"
          disabled={busy || blocked}
          onPress={() => onKeep('b')}
        />
        <PrimaryButton label="Not the same" variant="ghost" disabled={busy} onPress={onDismiss} />
      </View>
      {busy ? <ActivityIndicator color={BaggedColors.dark} style={styles.spinner} /> : null}
    </View>
  );
}

function SuggestionCard({
  s,
  busy,
  onOpen,
  onApplied,
  onDismiss,
}: {
  s: ProductEditSuggestion;
  busy: boolean;
  onOpen: () => void;
  onApplied: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.blockTop}>
        <Pressable
          onPress={onOpen}
          style={styles.nameLink}
          accessibilityRole="link"
          accessibilityLabel={`Open ${formatProductDisplayName(s.item)}`}>
          <Text style={[styles.name, styles.nameUnderline]}>{formatProductDisplayName(s.item)}</Text>
          <Ionicons name="chevron-forward" size={16} color={BaggedColors.muted} />
        </Pressable>
        <Text style={styles.suggestionBadge}>{PRODUCT_EDIT_SUGGESTION_LABELS[s.suggestion_type]}</Text>
      </View>
      {s.brand ? <Text style={styles.brand}>{s.brand}</Text> : null}
      <Text style={styles.suggestionShouldBe}>Should be: {s.suggested_value}</Text>
      {s.note ? <Text style={styles.meta}>Note: {s.note}</Text> : null}
      <Text style={styles.meta}>{new Date(s.created_at).toLocaleDateString()}</Text>
      <View style={styles.actions}>
        <PrimaryButton label="Open product" variant="secondary" disabled={busy} onPress={onOpen} />
        <PrimaryButton label="Mark applied" disabled={busy} onPress={onApplied} />
        <PrimaryButton label="Dismiss" variant="ghost" disabled={busy} onPress={onDismiss} />
      </View>
      {busy ? <ActivityIndicator color={BaggedColors.dark} style={styles.spinner} /> : null}
    </View>
  );
}

function short(name: string): string {
  const n = formatProductDisplayName(name);
  return n.length > 34 ? `${n.slice(0, 33)}\u2026` : n;
}

function ProductBlock({
  c,
  side,
  suggested,
  onOpen,
}: {
  c: DuplicateCandidate;
  side: DuplicateSide;
  suggested: boolean;
  onOpen: (side: DuplicateSide) => void;
}) {
  const item = side === 'a' ? c.item_a : c.item_b;
  const brand = side === 'a' ? c.brand_a : c.brand_b;
  const raters = side === 'a' ? c.raters_a : c.raters_b;
  const users = side === 'a' ? c.users_a : c.users_b;
  const barcodes = side === 'a' ? c.barcodes_a : c.barcodes_b;
  const verified = side === 'a' ? c.verified_a : c.verified_b;
  const isNew = side === 'a' ? c.virtual_a : c.virtual_b;
  const isScanned = c.reported && c.scanned_key === (side === 'a' ? c.key_a : c.key_b);
  const extra = c.extra_side === side && c.extra_words.length > 0 ? c.extra_words.join(', ') : null;
  return (
    <View style={styles.block}>
      <View style={styles.blockTop}>
        {isNew ? (
          <Text style={styles.name}>{formatProductDisplayName(item)}</Text>
        ) : (
          <Pressable
            onPress={() => onOpen(side)}
            style={styles.nameLink}
            accessibilityRole="link"
            accessibilityLabel={`Open ${formatProductDisplayName(item)}`}>
            <Text style={[styles.name, styles.nameUnderline]}>{formatProductDisplayName(item)}</Text>
            <Ionicons name="chevron-forward" size={16} color={BaggedColors.muted} />
          </Pressable>
        )}
        {suggested ? <Text style={styles.suggested}>Suggested</Text> : null}
      </View>
      {brand ? <Text style={styles.brand}>{brand}</Text> : null}
      {extra ? <Text style={styles.extra}>Extra: {extra}</Text> : null}
      <Text style={styles.meta}>
        {isNew
          ? 'Not in the catalog yet'
          : `Ranked ${raters} time${raters === 1 ? '' : 's'} by ${users} ${users === 1 ? 'person' : 'people'}`}
        {verified ? '  \u00b7  Nutrition verified' : ''}
      </Text>
      {isScanned ? <Text style={styles.meta}>Name from the barcode scanner</Text> : null}
      {barcodes.length > 0 ? (
        <Text style={styles.meta}>Barcode {barcodes.join(', ')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BaggedColors.content },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BaggedColors.border,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerSpacer: { width: 40 },
  title: { fontFamily: BaggedFonts.display, fontSize: 18, color: BaggedColors.dark },
  subtitle: { fontFamily: BaggedFonts.body, fontSize: 12, color: BaggedColors.muted, marginTop: 2 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
  },
  chipActive: { backgroundColor: BaggedColors.accent, borderColor: BaggedColors.accent },
  chipText: { fontFamily: BaggedFonts.body, fontSize: 13, fontWeight: '700', color: BaggedColors.dark },
  chipTextActive: { color: BaggedColors.white },
  filterHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  scrollContent: { padding: 16, gap: 14, flexGrow: 1 },
  error: { fontFamily: BaggedFonts.body, fontSize: 14, color: BaggedColors.scoreLow, textAlign: 'center' },
  emptyTitle: { fontFamily: BaggedFonts.display, fontSize: 18, color: BaggedColors.dark, marginBottom: 6 },
  emptyBody: { fontFamily: BaggedFonts.body, fontSize: 14, color: BaggedColors.muted, textAlign: 'center' },
  card: {
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  reported: { fontFamily: BaggedFonts.body, fontSize: 12, fontWeight: '700', color: BaggedColors.accent },
  similar: { fontFamily: BaggedFonts.body, fontSize: 12, color: BaggedColors.muted },
  block: { gap: 2 },
  blockTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontFamily: BaggedFonts.body, fontSize: 16, fontWeight: '700', color: BaggedColors.dark },
  nameLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  nameUnderline: { textDecorationLine: 'underline' },
  suggested: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.accent,
    backgroundColor: BaggedColors.accentPale,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  brand: { fontFamily: BaggedFonts.body, fontSize: 13, color: BaggedColors.muted },
  suggestionBadge: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.dark,
    backgroundColor: BaggedColors.borderSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  suggestionShouldBe: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.dark,
    marginTop: 2,
  },
  extra: { fontFamily: BaggedFonts.body, fontSize: 12, fontWeight: '700', color: BaggedColors.scoreLow },
  meta: { fontFamily: BaggedFonts.body, fontSize: 12, color: BaggedColors.muted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: BaggedColors.borderSoft },
  warn: { fontFamily: BaggedFonts.body, fontSize: 12, color: BaggedColors.scoreLow },
  actions: { gap: 8, marginTop: 4 },
  spinner: { marginTop: 4 },
});
