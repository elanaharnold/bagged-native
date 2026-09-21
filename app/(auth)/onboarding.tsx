import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { PrimaryButton } from '@/components/bagged/primary-button';
import {
  CompareStep,
  SubcategoryStep,
  VibeStep,
  type RatingFlowSelectedProduct,
} from '@/components/bagged/rating-flow-steps';
import { ReferralCodeStep } from '@/components/bagged/referral-code-step';
import { ScoreBadge } from '@/components/bagged/score-badge';
import { TextField } from '@/components/bagged/text-field';
import { KeyboardFormScroll } from '@/components/bagged/keyboard-form-scroll';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import {
  formatBirthdayDraftInput,
  parseBirthdayInput,
} from '@/lib/birthday';
import {
  DIET_TAGS,
  NO_DIET_RESTRICTIONS_ID,
  ONBOARDING_PROFILE_DIET_TAGS,
} from '@/constants/diet-tags';
import {
  getSubcategory,
  legacyCategoryForSubcategory,
  mapLegacyCategoryToSubcategory,
} from '@/constants/categories';
import {
  ensureMandatoryFollowRow,
  backfillPostsMissingMacros,
  ensureProfileForUser,
  fetchCuratedSubcategoryForProduct,
  insertOnboardingRatedPosts,
  productDescriptionKey,
  searchProducts,
  searchRowBrand,
  updateOwnProfile,
  type OnboardingRatedPick,
  type SearchProductRow,
} from '@/lib/data';
import { formatProductDisplayName } from '@/lib/format';
import { logEvent } from '@/lib/log-event';
import {
  findOnboardingComparePeers,
  insertIndexForVibeSegment,
  mergeScoredCategoryIntoRatedItems,
  nextOnboardingItemId,
  peerInsertIndexToCategoryInsertIndex,
  ratedItemsToRankSnapshot,
  type OnboardingRatedItem,
} from '@/lib/onboarding-rating';
import {
  chooseBetter,
  chooseWorse,
  estimateTotalComparisons,
  initialCompareState,
  mapCategory,
  rankingScopeForRow,
  scoreCategoryAfterInsert,
  scoreCategoryAtRest,
  sortRowsByRankPosition,
  type Category,
  type CompareState,
  type Vibe,
} from '@/lib/ranking';
import {
  isLegitimateTraderJoesBrand,
  storesForBrandAndSelections,
  TRADER_JOES_STORE,
} from '@/constants/grocery';
import { useAuth } from '@/providers/auth-provider';

const MAX_FAVORITES = 3;

type ManualDraft = { item: string; brand: string };
type OnboardingPhase = 'favorites' | 'diet' | 'referral' | 'birthday' | 'zip';
type FavoriteSubStep = 'list' | 'search' | 'manual' | 'subcategory' | 'vibe' | 'compare' | 'metadata';

export default function OnboardingScreen() {
  const router = useRouter();
  const { userId, markOnboardingComplete } = useAuth();

  const [ratedItems, setRatedItems] = useState<OnboardingRatedItem[]>([]);
  const [favoriteSubStep, setFavoriteSubStep] = useState<FavoriteSubStep>('list');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchProductRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<RatingFlowSelectedProduct | null>(null);
  const [manualDraft, setManualDraft] = useState<ManualDraft | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [curatedSubcategoryId, setCuratedSubcategoryId] = useState<string | null>(null);
  const [curatedSubcategoryLoading, setCuratedSubcategoryLoading] = useState(false);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [selectedDietTags, setSelectedDietTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [pendingScored, setPendingScored] = useState<
    Array<{ id: string | number; rating: number; tiedAbove?: boolean }> | null
  >(null);
  const [pendingNewId, setPendingNewId] = useState<string | null>(null);

  const [compareState, setCompareState] = useState<CompareState>({
    lo: 0,
    hi: 0,
    mid: 0,
    comparisons: 0,
  });
  const [compareUndo, setCompareUndo] = useState<CompareState[]>([]);

  const [phase, setPhase] = useState<OnboardingPhase>('favorites');
  const [profileDietTags, setProfileDietTags] = useState<string[]>([]);
  const [birthdayDraft, setBirthdayDraft] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const completeInFlight = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const rankedSnapshot = useMemo(() => ratedItemsToRankSnapshot(ratedItems), [ratedItems]);

  const subcategoryScope =
    subcategoryId ?? (category ? mapLegacyCategoryToSubcategory(category) : '');

  const categoryList = useMemo(
    () =>
      subcategoryScope
        ? sortRowsByRankPosition(
            rankedSnapshot.filter((row) => rankingScopeForRow(row) === subcategoryScope)
          )
        : [],
    [rankedSnapshot, subcategoryScope]
  );

  const categoryScored = useMemo(() => scoreCategoryAtRest(categoryList), [categoryList]);

  const comparePeers = useMemo(() => {
    if (!subcategoryScope || !vibe) return [];
    return findOnboardingComparePeers(ratedItems, subcategoryScope, vibe);
  }, [ratedItems, subcategoryScope, vibe]);

  const comparisonPeer = comparePeers[compareState.mid];
  const comparisonScore = useMemo(
    () =>
      comparisonPeer
        ? categoryScored.find((row) => String(row.id) === String(comparisonPeer.id))?.rating
        : undefined,
    [categoryScored, comparisonPeer]
  );

  const totalComparisons = estimateTotalComparisons(comparePeers.length);

  const resetActivePick = useCallback(() => {
    setSelected(null);
    setManualDraft(null);
    setCategory(null);
    setSubcategoryId(null);
    setCuratedSubcategoryId(null);
    setVibe(null);
    setSelectedStores([]);
    setSelectedDietTags([]);
    setNote('');
    setQuery('');
    setResults([]);
    setPendingScored(null);
    setPendingNewId(null);
    setCompareState({ lo: 0, hi: 0, mid: 0, comparisons: 0 });
    setCompareUndo([]);
  }, []);

  const scheduleSearch = useCallback(
    (q: string) => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      setQuery(q);
      if (q.trim().length < 2) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      searchTimer.current = setTimeout(() => {
        searchProducts(q.trim())
          .then((rows) => setResults(rows))
          .catch((err) => {
            console.warn('onboarding search:', err);
            setResults([]);
          })
          .finally(() => setSearching(false));
      }, 350);
    },
    []
  );

  const isDuplicatePick = useCallback(
    (item: string, brand: string) => {
      const key = productDescriptionKey(item, brand);
      if (!key) return false;
      return ratedItems.some((row) => productDescriptionKey(row.item, row.brand) === key);
    },
    [ratedItems]
  );

  const pickProduct = useCallback(
    (p: SearchProductRow | { description: string; brandOwner?: string }) => {
      const brand =
        'foodCategory' in p
          ? searchRowBrand(p as SearchProductRow)
          : String((p as { brandOwner?: string }).brandOwner ?? '').trim();
      const desc = String('description' in p ? p.description : '').trim();
      if (!desc) return;

      if (isDuplicatePick(desc, brand)) {
        Alert.alert('Already added', 'That item is already on your starter list.');
        return;
      }

      if (!brand) {
        setManualDraft({ item: desc, brand: manualDraft?.brand ?? '' });
        setQuery(desc);
        setResults([]);
        setFavoriteSubStep('manual');
        return;
      }

      const searchRow = 'foodCategory' in p ? (p as SearchProductRow) : null;
      const inferredCategory = mapCategory(
        [searchRow?.foodCategory, desc, brand].filter(Boolean).join(' ')
      );
      const inferredSubcategory = mapLegacyCategoryToSubcategory(inferredCategory);
      const rawStores = storesForBrandAndSelections(brand, []);
      setSelected({
        name: desc,
        brand,
        descriptionKey: productDescriptionKey(desc, brand),
        searchRow,
      });
      setCategory(inferredCategory);
      setSubcategoryId(inferredSubcategory);
      setSelectedStores(rawStores);
      setQuery(desc);
      setResults([]);
      setManualDraft(null);
      setFavoriteSubStep('subcategory');
    },
    [isDuplicatePick, manualDraft?.brand]
  );

  const commitManualDraft = useCallback(() => {
    if (!manualDraft) return;
    const item = manualDraft.item.trim();
    const brand = manualDraft.brand.trim();
    if (!item || !brand) return;
    pickProduct({ description: item, brandOwner: brand });
  }, [manualDraft, pickProduct]);

  const beginAddFavorite = useCallback(() => {
    if (ratedItems.length >= MAX_FAVORITES) return;
    resetActivePick();
    setFavoriteSubStep('search');
  }, [ratedItems.length, resetActivePick]);

  useEffect(() => {
    const key = selected?.descriptionKey?.trim();
    if (!key || favoriteSubStep === 'manual') return;
    let cancelled = false;
    setCuratedSubcategoryLoading(true);
    fetchCuratedSubcategoryForProduct(key, selected?.name, selected?.brand)
      .then((sub) => {
        if (cancelled) return;
        setCuratedSubcategoryId(sub);
        if (sub && !subcategoryId) {
          setSubcategoryId(sub);
          setCategory(legacyCategoryForSubcategory(sub) as Category);
        }
      })
      .finally(() => {
        if (!cancelled) setCuratedSubcategoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.descriptionKey, selected?.name, selected?.brand, favoriteSubStep]);

  const finalizePlacement = useCallback(
    (insertIndex: number) => {
      if (!selected || !vibe || !subcategoryScope) return;
      const newId = nextOnboardingItemId(ratedItems);
      const legacyCategory = category ?? legacyCategoryForSubcategory(subcategoryScope);
      const newSnapshotItem = {
        id: newId,
        item: selected.name,
        brand: selected.brand,
        store: selectedStores[0] ?? '',
        category: legacyCategory,
        subcategory: subcategoryScope,
        vibe,
      };
      const scored = scoreCategoryAfterInsert(rankedSnapshot, newSnapshotItem, insertIndex, {
        categoryList,
        categoryScored,
      });
      setPendingScored(scored);
      setPendingNewId(newId);
      setFavoriteSubStep('metadata');
    },
    [
      selected,
      vibe,
      subcategoryScope,
      category,
      ratedItems,
      rankedSnapshot,
      categoryList,
      categoryScored,
      selectedStores,
    ]
  );

  const beginCompareOrPlace = useCallback(() => {
    if (!vibe || !subcategoryScope || !selected) return;
    if (comparePeers.length === 0) {
      const insertIndex =
        categoryList.length === 0 ? 0 : insertIndexForVibeSegment(categoryList, vibe);
      finalizePlacement(insertIndex);
      return;
    }
    setCompareState(initialCompareState(comparePeers.length));
    setCompareUndo([]);
    setFavoriteSubStep('compare');
  }, [vibe, subcategoryScope, selected, comparePeers.length, categoryList, finalizePlacement]);

  const onChooseCompare = useCallback(
    (kind: 'better' | 'worse') => {
      setCompareUndo((stack) => [...stack, compareState]);
      const result =
        kind === 'better'
          ? chooseBetter(compareState, comparePeers.length)
          : chooseWorse(compareState, comparePeers.length);
      if (result.kind === 'continue') {
        setCompareState(result.next);
        return;
      }
      const fullInsert = peerInsertIndexToCategoryInsertIndex(
        categoryList,
        comparePeers,
        result.insertIndex
      );
      setCompareUndo([]);
      finalizePlacement(fullInsert);
    },
    [compareState, comparePeers, categoryList, finalizePlacement]
  );

  const undoCompare = useCallback(() => {
    setCompareUndo((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setCompareState(next);
      return stack.slice(0, -1);
    });
  }, []);

  const commitMetadata = useCallback(() => {
    if (!selected || !vibe || !subcategoryScope || !pendingScored || !pendingNewId) return;
    const lockedStores = storesForBrandAndSelections(selected.brand, selectedStores);
    const legacyCategory = category ?? legacyCategoryForSubcategory(subcategoryScope);
    const draftNewItem: OnboardingRatedItem = {
      id: pendingNewId,
      item: selected.name,
      brand: selected.brand,
      store: lockedStores[0] ?? '',
      stores: lockedStores,
      category: legacyCategory,
      subcategory: subcategoryScope,
      vibe,
      rankPosition: 1,
      rating: 10,
      dietTags: selectedDietTags,
      note: note.trim(),
      searchRow: selected.searchRow ?? null,
    };
    setRatedItems((prev) =>
      mergeScoredCategoryIntoRatedItems(prev, subcategoryScope, pendingScored, draftNewItem)
    );
    resetActivePick();
    setFavoriteSubStep('list');
  }, [
    selected,
    vibe,
    subcategoryScope,
    category,
    pendingScored,
    pendingNewId,
    selectedStores,
    selectedDietTags,
    note,
    resetActivePick,
  ]);

  const removeRatedItem = useCallback((id: string) => {
    setRatedItems((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const toggleStore = useCallback(
    (storeName: string) => {
      if (!selected) return;
      const tjOnly = isLegitimateTraderJoesBrand(selected.brand, { assumePlaceholder: false });
      setSelectedStores((prev) => {
        if (tjOnly) return [TRADER_JOES_STORE];
        const next = prev.includes(storeName)
          ? prev.filter((s) => s !== storeName)
          : [...prev, storeName];
        return storesForBrandAndSelections(selected.brand, next);
      });
    },
    [selected]
  );

  const toggleMetadataDietTag = useCallback((tagId: string) => {
    setSelectedDietTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  }, []);

  const toggleOnboardingDietTag = useCallback((id: string) => {
    if (id === NO_DIET_RESTRICTIONS_ID) {
      setProfileDietTags([]);
      return;
    }
    setProfileDietTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const advanceFromFavorites = useCallback(() => {
    setPhase('diet');
  }, []);

  const completeSetup = useCallback(async () => {
    if (!userId || submitting || completeInFlight.current) return;
    const birthday = parseBirthdayInput(birthdayDraft);
    if (!birthday) {
      Alert.alert('Birthday required', 'Enter your birthday as MM/DD/YYYY.');
      setPhase('birthday');
      return;
    }
    completeInFlight.current = true;
    setSubmitting(true);
    try {
      await ensureMandatoryFollowRow(userId);
      await ensureProfileForUser(userId);
      await updateOwnProfile({
        userId,
        dietTags: profileDietTags,
        birthday,
        ...(zipCode.trim() ? { zipCode: zipCode.trim() } : {}),
      });
      const picks: OnboardingRatedPick[] = ratedItems.map((row) => ({
        item: row.item,
        brand: row.brand,
        store: row.store,
        stores: row.stores,
        category: String(row.category),
        subcategory: row.subcategory,
        vibe: row.vibe,
        rating: row.rating,
        rankPosition: row.rankPosition,
        tiedAbove: row.tiedAbove === true,
        dietTags: row.dietTags ?? [],
        note: row.note ?? '',
        searchRow: row.searchRow ?? null,
      }));
      if (picks.length > 0) {
        await insertOnboardingRatedPosts(userId, picks);
        void backfillPostsMissingMacros({
          userId,
          onlyLikelyOnboarding: true,
          limit: 12,
          delayMs: 200,
        }).catch((err) => console.warn('onboarding macros backfill:', err));
      }
      await markOnboardingComplete();
      logEvent('onboarding_completed', { rated_items: ratedItems.length });
      router.replace('/find-people');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Try again.';
      Alert.alert('Could not finish setup', msg);
    } finally {
      setSubmitting(false);
      completeInFlight.current = false;
    }
  }, [
    userId,
    submitting,
    ratedItems,
    profileDietTags,
    birthdayDraft,
    zipCode,
    markOnboardingComplete,
    router,
  ]);

  const advanceFromDiet = useCallback(() => {
    setPhase('referral');
  }, []);

  const advanceFromReferral = useCallback(() => {
    setPhase('birthday');
  }, []);

  const advanceFromBirthday = useCallback(() => {
    const parsed = parseBirthdayInput(birthdayDraft);
    if (!parsed) {
      Alert.alert('Birthday required', 'Enter your birthday as MM/DD/YYYY.');
      return;
    }
    setPhase('zip');
  }, [birthdayDraft]);

  const handleFavoriteBack = useCallback(() => {
    switch (favoriteSubStep) {
      case 'search':
        resetActivePick();
        setFavoriteSubStep('list');
        break;
      case 'manual':
        setManualDraft(null);
        setFavoriteSubStep('search');
        break;
      case 'subcategory':
        resetActivePick();
        setFavoriteSubStep('search');
        break;
      case 'vibe':
        setVibe(null);
        setFavoriteSubStep('subcategory');
        break;
      case 'compare':
        setCompareUndo([]);
        setFavoriteSubStep('vibe');
        break;
      case 'metadata':
        if (comparePeers.length > 0) {
          setFavoriteSubStep('compare');
        } else {
          setVibe(null);
          setFavoriteSubStep('vibe');
        }
        break;
      default:
        break;
    }
  }, [favoriteSubStep, comparePeers.length, resetActivePick]);

  if (!userId) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Text style={styles.muted}>You need to be signed in to continue.</Text>
      </SafeAreaView>
    );
  }

  const showLightWizard =
    phase === 'favorites' &&
    favoriteSubStep !== 'list' &&
    favoriteSubStep !== 'metadata';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}>
        {phase === 'favorites' && favoriteSubStep === 'list' ? (
          <>
            <KeyboardFormScroll
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <Text style={styles.title}>Add your favorites</Text>
              <Text style={styles.subtitle}>
                Search for up to {MAX_FAVORITES} products you love — any category. These become
                your first rankings on Bagged.
              </Text>

              {ratedItems.length > 0 ? (
                <View style={styles.ratedList}>
                  {ratedItems.map((row) => (
                    <View key={row.id} style={styles.ratedCard}>
                      <View style={styles.ratedCardMain}>
                        <View style={styles.ratedTitleBlock}>
                          <AutoFitText style={styles.ratedName} numberOfLines={3}>
                            {formatProductDisplayName(row.item)}
                          </AutoFitText>
                          {row.brand ? (
                            <AutoFitText style={styles.ratedBrand} numberOfLines={2}>
                              {formatProductDisplayName(row.brand)}
                            </AutoFitText>
                          ) : null}
                          <Text style={styles.ratedMeta}>
                            {getSubcategory(row.subcategory)?.label ?? row.category} ·{' '}
                            {row.vibe === 'liked'
                              ? 'Loved it'
                              : row.vibe === 'fine'
                                ? 'It was fine'
                                : "Didn't like it"}
                          </Text>
                        </View>
                        <ScoreBadge score={row.rating} size={44} />
                      </View>
                      <Pressable
                        onPress={() => removeRatedItem(row.id)}
                        hitSlop={8}
                        style={styles.removeBtn}>
                        <Text style={styles.removeBtnText}>Remove</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyHint}>
                  No favorites yet — add one below, or skip and fill in your profile first.
                </Text>
              )}

              {ratedItems.length < MAX_FAVORITES ? (
                <Pressable onPress={beginAddFavorite} style={styles.addBtn}>
                  <Text style={styles.addBtnText}>
                    {ratedItems.length === 0 ? 'Search for a product' : 'Add another favorite'}
                  </Text>
                </Pressable>
              ) : null}

              <View style={styles.bottomPad} />
            </KeyboardFormScroll>

            <View style={styles.footer}>
              <Pressable onPress={advanceFromFavorites} hitSlop={8} style={styles.skipBtn}>
                <Text style={styles.skipBtnText}>Skip</Text>
              </Pressable>
              <PrimaryButton
                surface="dark"
                label="Continue"
                onPress={advanceFromFavorites}
                loading={submitting}
              />
            </View>
          </>
        ) : null}

        {phase === 'favorites' && favoriteSubStep === 'search' ? (
          <View style={styles.lightShell}>
            <KeyboardFormScroll
              contentContainerStyle={styles.lightScroll}
              keyboardShouldPersistTaps="handled">
              <Pressable onPress={handleFavoriteBack} hitSlop={8}>
                <Text style={styles.lightBack}>← Back</Text>
              </Pressable>
              <Text style={styles.lightTitle}>Search for a product</Text>
              <TextField
                variant="light"
                disableAutofill
                label=""
                value={query}
                onChangeText={scheduleSearch}
                placeholder="Start typing…"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {searching ? (
                <View style={styles.searchingRow}>
                  <ActivityIndicator size="small" color={BaggedColors.muted} />
                  <Text style={styles.lightHint}>Searching…</Text>
                </View>
              ) : null}
              {results.map((r, ri) => (
                <Pressable
                  key={`${r.description}-${ri}`}
                  onPress={() => pickProduct(r)}
                  style={[styles.resultRow, ri < results.length - 1 ? styles.resultRowBorder : null]}>
                  <AutoFitText style={styles.resultTitle} numberOfLines={3}>
                    {formatProductDisplayName(r.description)}
                  </AutoFitText>
                  <AutoFitText style={styles.resultBrand} numberOfLines={2}>
                    {searchRowBrand(r)}
                  </AutoFitText>
                </Pressable>
              ))}
              {query.trim().length >= 2 && !searching ? (
                <Pressable
                  onPress={() => pickProduct({ description: query.trim(), brandOwner: '' })}
                  style={styles.manualRow}>
                  <Text style={styles.manualText}>Add &quot;{query.trim()}&quot; manually</Text>
                </Pressable>
              ) : null}
            </KeyboardFormScroll>
          </View>
        ) : null}

        {phase === 'favorites' && favoriteSubStep === 'manual' && manualDraft ? (
          <View style={styles.lightShell}>
            <KeyboardFormScroll
              contentContainerStyle={styles.lightScroll}
              keyboardShouldPersistTaps="handled">
              <Pressable onPress={handleFavoriteBack} hitSlop={8}>
                <Text style={styles.lightBack}>← Back</Text>
              </Pressable>
              <Text style={styles.lightTitle}>Add brand</Text>
              <Text style={styles.lightHint}>We need the brand so others can find this item.</Text>
              <TextField
                variant="light"
                disableAutofill
                label="Item"
                value={manualDraft.item}
                onChangeText={(t) => setManualDraft((d) => (d ? { ...d, item: t } : d))}
                autoCapitalize="words"
              />
              <TextField
                variant="light"
                disableAutofill
                label="Brand"
                value={manualDraft.brand}
                onChangeText={(t) => setManualDraft((d) => (d ? { ...d, brand: t } : d))}
                placeholder="e.g. Trader Joe's"
                autoCapitalize="words"
              />
              <PrimaryButton
                surface="light"
                label="Continue"
                onPress={commitManualDraft}
                disabled={!manualDraft.item.trim() || !manualDraft.brand.trim()}
              />
            </KeyboardFormScroll>
          </View>
        ) : null}

        {phase === 'favorites' && favoriteSubStep === 'subcategory' && selected ? (
          <View style={styles.lightShell}>
            <SubcategoryStep
              selected={selected}
              subcategoryId={subcategoryId}
              setSubcategoryId={(id) => {
                setSubcategoryId(id);
                setCategory(id ? (legacyCategoryForSubcategory(id) as Category) : null);
              }}
              curatedSubcategoryId={curatedSubcategoryId}
              curatedLoading={curatedSubcategoryLoading}
              onContinue={() => setFavoriteSubStep('vibe')}
              onBack={handleFavoriteBack}
            />
          </View>
        ) : null}

        {phase === 'favorites' && favoriteSubStep === 'vibe' && selected ? (
          <View style={styles.lightShell}>
            <VibeStep
              selected={selected}
              category={category}
              subcategoryLabel={subcategoryId ? getSubcategory(subcategoryId)?.label : null}
              vibe={vibe}
              setVibe={setVibe}
              selectedStores={selectedStores}
              onToggleStore={toggleStore}
              onBack={handleFavoriteBack}
              onContinue={beginCompareOrPlace}
              snapshotLoading={false}
              continueLabel="Continue"
            />
          </View>
        ) : null}

        {phase === 'favorites' && favoriteSubStep === 'compare' && selected && vibe ? (
          <View style={styles.lightShell}>
            <CompareStep
              comparisons={compareState.comparisons}
              totalComparisons={totalComparisons}
              comparisonItem={comparisonPeer}
              comparisonScore={comparisonScore}
              selected={selected}
              onBetter={() => onChooseCompare('better')}
              onWorse={() => onChooseCompare('worse')}
              onTie={() => {}}
              onUndo={undoCompare}
              canUndo={compareUndo.length > 0}
              showTieOption={false}
              compareCaption={`Which did you like more? · Comparison ${compareState.comparisons + 1}`}
            />
            <View style={styles.compareBackBar}>
              <Pressable onPress={handleFavoriteBack} hitSlop={8}>
                <Text style={styles.lightBack}>← Back</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {phase === 'favorites' && favoriteSubStep === 'metadata' && selected ? (
          <>
            <KeyboardFormScroll
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <Pressable onPress={handleFavoriteBack} hitSlop={8}>
                <Text style={styles.darkBack}>← Back</Text>
              </Pressable>
              <Text style={styles.title}>Anything else?</Text>
              <Text style={styles.subtitle}>All optional — diet tags and a quick note.</Text>

              <View style={styles.pickedBlock}>
                <AutoFitText style={styles.ratedName} numberOfLines={3}>
                  {formatProductDisplayName(selected.name)}
                </AutoFitText>
                {selected.brand ? (
                  <AutoFitText style={styles.ratedBrand} numberOfLines={2}>
                    {formatProductDisplayName(selected.brand)}
                  </AutoFitText>
                ) : null}
              </View>

              <Text style={styles.sectionLabel}>Diet tags</Text>
              <View style={styles.chipGrid}>
                {DIET_TAGS.map((tag) => {
                  const active = selectedDietTags.includes(tag.id);
                  return (
                    <Pressable
                      key={tag.id}
                      onPress={() => toggleMetadataDietTag(tag.id)}
                      style={[
                        styles.dietChip,
                        {
                          borderColor: tag.color,
                          backgroundColor: active ? tag.bgActive : tag.bg,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.dietChipText,
                          { color: tag.color },
                          active && { fontWeight: '700' },
                        ]}>
                        {tag.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.reviewPrompt}>Write a review (optional)</Text>
              <TextField
                variant="dark"
                disableAutofill
                label=""
                value={note}
                onChangeText={setNote}
                placeholder="What do you like about it?"
                multiline
                textAlignVertical="top"
                autoCapitalize="sentences"
                inputStyle={styles.noteInput}
              />
              <View style={styles.bottomPad} />
            </KeyboardFormScroll>

            <View style={styles.footer}>
              <PrimaryButton surface="dark" label="Save to my list" onPress={commitMetadata} />
            </View>
          </>
        ) : null}

        {phase === 'diet' ? (
          <>
            <KeyboardFormScroll
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <Text style={[styles.title, styles.dietStepTitle]}>What describes your eating style?</Text>
              <Text style={[styles.subtitle, styles.dietStepSubtitle]}>
                Pick all that apply — optional, and you can change this later.
              </Text>
              <View style={[styles.chipGrid, styles.chipGridCentered]}>
                {ONBOARDING_PROFILE_DIET_TAGS.map((tag) => {
                  const active = profileDietTags.includes(tag.id);
                  return (
                    <Pressable
                      key={tag.id}
                      onPress={() => toggleOnboardingDietTag(tag.id)}
                      style={[
                        styles.dietChip,
                        {
                          borderColor: tag.color,
                          backgroundColor: active ? tag.bgActive : tag.bg,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.dietChipText,
                          { color: tag.color },
                          active && { fontWeight: '700' },
                        ]}>
                        {tag.label}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => toggleOnboardingDietTag(NO_DIET_RESTRICTIONS_ID)}
                  style={[
                    styles.dietChip,
                    profileDietTags.length === 0 && styles.storeChipActive,
                  ]}>
                  <Text
                    style={[
                      styles.dietChipText,
                      profileDietTags.length === 0 && styles.storeChipTextActive,
                    ]}>
                    No restrictions
                  </Text>
                </Pressable>
              </View>
              <View style={styles.bottomPad} />
            </KeyboardFormScroll>

            <View style={styles.footer}>
              <PrimaryButton surface="dark" label="Continue" onPress={advanceFromDiet} />
            </View>
          </>
        ) : null}

        {phase === 'referral' ? (
          <>
            <KeyboardFormScroll
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <ReferralCodeStep onComplete={advanceFromReferral} />
              <View style={styles.bottomPad} />
            </KeyboardFormScroll>
          </>
        ) : null}

        {phase === 'birthday' ? (
          <>
            <KeyboardFormScroll
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <Text style={styles.title}>When&apos;s your birthday?</Text>
              <Text style={styles.subtitle}>Required — helps us understand who&apos;s using Bagged.</Text>
              <TextField
                variant="dark"
                disableAutofill
                label=""
                value={birthdayDraft}
                onChangeText={(t) => setBirthdayDraft(formatBirthdayDraftInput(t))}
                placeholder="MM/DD/YYYY"
                keyboardType="number-pad"
                maxLength={10}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.bottomPad} />
            </KeyboardFormScroll>

            <View style={styles.footer}>
              <PrimaryButton surface="dark" label="Continue" onPress={advanceFromBirthday} />
            </View>
          </>
        ) : null}

        {phase === 'zip' ? (
          <>
            <KeyboardFormScroll
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <Text style={styles.title}>What&apos;s your zip code?</Text>
              <Text style={styles.subtitle}>
                We&apos;ll show you what&apos;s trending near you.
              </Text>
              <TextField
                variant="dark"
                disableAutofill
                label=""
                value={zipCode}
                onChangeText={setZipCode}
                placeholder="e.g. 90210"
                keyboardType="number-pad"
                maxLength={10}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.bottomPad} />
            </KeyboardFormScroll>

            <View style={styles.footer}>
              <Pressable
                onPress={() => void completeSetup()}
                disabled={submitting}
                hitSlop={8}
                style={styles.skipBtn}>
                <Text style={styles.skipBtnText}>Skip</Text>
              </Pressable>
              <PrimaryButton
                surface="dark"
                label="Let's go!"
                onPress={() => void completeSetup()}
                disabled={submitting}
                loading={submitting}
              />
            </View>
          </>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BaggedColors.dark,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 8,
    paddingBottom: 120,
  },
  lightShell: {
    flex: 1,
    backgroundColor: BaggedColors.bg,
  },
  lightScroll: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 12,
    paddingBottom: 32,
  },
  lightBack: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.onBgMuted,
    marginBottom: 8,
  },
  darkBack: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 8,
  },
  lightTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.onBg,
    marginBottom: 12,
  },
  lightHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
    marginBottom: 12,
  },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 26,
    color: BaggedColors.white,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.72)',
    marginBottom: 16,
  },
  emptyHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 20,
  },
  ratedList: {
    gap: 12,
    marginBottom: 16,
  },
  ratedCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  ratedCardMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  ratedTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  ratedName: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.white,
  },
  ratedBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
  },
  ratedMeta: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 4,
  },
  removeBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  removeBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    textDecorationLine: 'underline',
  },
  addBtn: {
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
    alignItems: 'center',
  },
  addBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  resultRow: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  resultRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BaggedColors.borderOnBg,
  },
  resultTitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.onBg,
  },
  resultBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.onBgMuted,
    marginTop: 2,
  },
  manualRow: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  manualText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.accent,
  },
  compareBackBar: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingBottom: 16,
  },
  pickedBlock: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  sectionLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)',
  },
  sectionLabelSpaced: {
    marginTop: 16,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  chipGridCentered: {
    justifyContent: 'center',
  },
  dietStepTitle: {
    textAlign: 'center',
  },
  dietStepSubtitle: {
    textAlign: 'center',
  },
  storeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  storeChipActive: {
    borderColor: BaggedColors.accent,
    backgroundColor: BaggedColors.borderSoft,
  },
  storeChipDisabled: {
    opacity: 0.4,
  },
  storeChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
  },
  storeChipTextActive: {
    color: BaggedColors.white,
  },
  dietChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  dietChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '500',
  },
  reviewPrompt: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 16,
    marginBottom: 8,
  },
  noteInput: {
    minHeight: 96,
    maxHeight: 200,
  },
  bottomPad: {
    height: 24,
  },
  footer: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: BaggedColors.dark,
    gap: 12,
  },
  skipBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    textDecorationLine: 'underline',
  },
  muted: {
    fontFamily: BaggedFonts.body,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    padding: 24,
  },
});
