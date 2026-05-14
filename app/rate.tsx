import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { SearchResultRow } from '@/components/bagged/search-result-row';
import { TextField } from '@/components/bagged/text-field';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { HIGH_PROTEIN_LOW_CAL_ID, qualifiesHighProteinLowCalFromMacroForm } from '@/constants/diet-tags';
import { STORES } from '@/constants/grocery';
import { useDebounce } from '@/hooks/use-debounce';
import {
  bumpPostFeedRecency,
  createPost,
  deleteOtherUserRankedPostsSameSlot,
  fetchRateMacroHintFromSearchApi,
  fetchVerifiedCuratedNutritionByDescription,
  getUserRankings,
  isRadarOnlyDbRow,
  mergeRateMacroFormFillEmpty,
  normalizeMacros,
  normalizedDescriptionKeyFromItem,
  rateMacroFormFromNumbers,
  rateMacroFormHasAny,
  searchProducts,
  searchRowBrand,
  setPostPhotoUrlsForUserPost,
  syncPeerPostRanks,
  updateRankedPost,
  uploadPostPhotoLocalAssets,
  type RankedPostRow,
  type RateMacroFormState,
  type SearchProductRow,
} from '@/lib/data';
import { pokeFeedRefresh } from '@/lib/feed-refresh-poke';
import { formatProductDisplayName } from '@/lib/format';
import {
  CATEGORIES,
  chooseBetter,
  chooseTie,
  chooseWorse,
  computeScoresByCategory,
  estimateTotalComparisons,
  initialCompareState,
  insertIntoCategoryRanked,
  mapCategory,
  normalizeVibe,
  type Category,
  type CompareState,
  type Vibe,
} from '@/lib/ranking';
import { useAuth } from '@/providers/auth-provider';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

type Step = 'search' | 'category' | 'vibe' | 'nutrition' | 'compare' | 'note' | 'saving';

type SelectedProduct = {
  name: string;
  brand: string;
  descriptionKey: string;
};

type RankSnapshotItem = {
  id: string | number;
  item: string;
  store: string;
  category: Category | string;
  vibe: Vibe;
};

function firstRouteParam(v: string | string[] | undefined): string {
  if (v == null) return '';
  const s = Array.isArray(v) ? v[0] : v;
  return String(s ?? '').trim();
}

function macroFormFromRouteParams(p: {
  prefilledMacroCal?: string | string[];
  prefilledMacroProtein?: string | string[];
  prefilledMacroCarbs?: string | string[];
  prefilledMacroFat?: string | string[];
  prefilledMacroServing?: string | string[];
}): RateMacroFormState {
  return {
    cal: firstRouteParam(p.prefilledMacroCal),
    protein: firstRouteParam(p.prefilledMacroProtein),
    carbs: firstRouteParam(p.prefilledMacroCarbs),
    fat: firstRouteParam(p.prefilledMacroFat),
    servingLabel: firstRouteParam(p.prefilledMacroServing),
  };
}

const MAX_REVIEW_PHOTOS = 4;

const VIBE_OPTIONS: { id: Vibe; label: string; subtitle: string }[] = [
  { id: 'liked', label: 'I loved it', subtitle: 'Top of the list' },
  { id: 'fine', label: 'It was fine', subtitle: 'Middle of the road' },
  { id: 'meh', label: "Didn't like it", subtitle: 'Better avoided' },
];

export default function RateScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{
    prefilledItem?: string;
    prefilledBrand?: string;
    prefilledCategory?: string;
    rerankPostId?: string;
    prefilledMacroCal?: string;
    prefilledMacroProtein?: string;
    prefilledMacroCarbs?: string;
    prefilledMacroFat?: string;
    prefilledMacroServing?: string;
  }>();

  const [step, setStep] = useState<Step>(() => {
    if (params.prefilledItem) return 'category';
    if (params.rerankPostId) return 'vibe';
    return 'search';
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ─── Selection state ────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<SelectedProduct | null>(() => {
    if (params.prefilledItem) {
      return {
        name: String(params.prefilledItem),
        brand: String(params.prefilledBrand ?? ''),
        descriptionKey: String(params.prefilledItem).trim().toLowerCase(),
      };
    }
    return null;
  });
  const [category, setCategory] = useState<Category | null>(() => {
    const pc = firstRouteParam(params.prefilledCategory);
    if (pc) return mapCategory(pc);
    return null;
  });
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [store, setStore] = useState<string>('');
  const [note, setNote] = useState('');
  const [reviewPhotos, setReviewPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [macros, setMacros] = useState<RateMacroFormState>(() => macroFormFromRouteParams(params));

  // ─── Search step ────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 350);
  const [results, setResults] = useState<SearchProductRow[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (step !== 'search') return;
    if (debouncedQuery.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    searchProducts(debouncedQuery)
      .then((rows) => {
        if (!cancelled) setResults(rows);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, step]);

  /** When the flow starts with a product but no macro query params: verified curated, then `/api/search` (FatSecret-first). */
  const routeMacroSig = [
    firstRouteParam(params.prefilledMacroCal),
    firstRouteParam(params.prefilledMacroProtein),
    firstRouteParam(params.prefilledMacroCarbs),
    firstRouteParam(params.prefilledMacroFat),
    firstRouteParam(params.prefilledMacroServing),
  ].join('|');

  useEffect(() => {
    const item = selected?.name?.trim();
    if (!item) return;
    if (rateMacroFormHasAny(macroFormFromRouteParams(params))) return;

    let cancelled = false;
    const empty: RateMacroFormState = {
      cal: '',
      protein: '',
      carbs: '',
      fat: '',
      servingLabel: '',
    };

    (async () => {
      let merged = empty;
      const curated = await fetchVerifiedCuratedNutritionByDescription(item).catch(() => null);
      if (cancelled) return;
      if (curated) {
        merged = mergeRateMacroFormFillEmpty(
          merged,
          rateMacroFormFromNumbers({
            cal: curated.cal,
            protein: curated.protein,
            carbs: curated.carbs,
            fat: curated.fat,
            servingLabel: curated.serving_label,
          })
        );
      }
      const apiHint = await fetchRateMacroHintFromSearchApi(item).catch(() => null);
      if (cancelled) return;
      if (apiHint) merged = mergeRateMacroFormFillEmpty(merged, apiHint);

      if (!rateMacroFormHasAny(merged)) return;
      setMacros((prev) => {
        if (rateMacroFormHasAny(prev)) return prev;
        return merged;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [selected?.name, routeMacroSig]);

  // ─── Ranked list snapshot for the compare step ──────────────────────────────
  const [rankedSnapshot, setRankedSnapshot] = useState<RankSnapshotItem[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const rerankIdRef = useRef<string | null>(params.rerankPostId ? String(params.rerankPostId) : null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setSnapshotLoading(true);
    getUserRankings(userId)
      .then((rows) => {
        if (cancelled) return;
        const tried = (rows as RankedPostRow[])
          .filter((r) => !isRadarOnlyDbRow(r))
          // Hide the post being reranked — otherwise the user gets asked to
          // compare it to itself.
          .filter((r) => (rerankIdRef.current ? String(r.id) !== rerankIdRef.current : true))
          .map<RankSnapshotItem>((r) => ({
            id: r.id,
            item: r.item,
            store: r.store ?? '',
            category: r.category,
            vibe: normalizeVibe(r.vibe),
          }));
        setRankedSnapshot(tried);
        // If reranking, hydrate from the post being reranked.
        if (rerankIdRef.current) {
          const target = (rows as RankedPostRow[]).find(
            (r) => String(r.id) === rerankIdRef.current
          );
          if (target) {
            setSelected({
              name: target.item,
              brand: target.product_brand ?? '',
              descriptionKey:
                String(target.description_key ?? '').trim().toLowerCase() ||
                normalizedDescriptionKeyFromItem(target.item),
            });
            const catRaw = String(target.category ?? '').trim();
            setCategory(catRaw ? mapCategory(catRaw) : mapCategory(target.item));
            setStore(String(target.store ?? '').trim());
            setVibe(normalizeVibe(target.vibe));
            const past = normalizeMacros(target.macros);
            if (past) {
              const filled = rateMacroFormFromNumbers({
                cal: past.cal,
                protein: past.protein,
                carbs: past.carbs,
                fat: past.fat,
                servingLabel: past.servingLabel,
              });
              if (rateMacroFormHasAny(filled)) setMacros(filled);
            }
          }
        }
      })
      .finally(() => {
        if (!cancelled) setSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // ─── Compare step state ─────────────────────────────────────────────────────
  const categoryList = useMemo(
    () => rankedSnapshot.filter((r) => r.category === category),
    [rankedSnapshot, category]
  );
  const categoryScored = useMemo(
    // Single-category input — `computeScoresByCategory` runs the vibe clamp on
    // the only bucket and returns one scored row per item.
    () => computeScoresByCategory(categoryList),
    [categoryList]
  );
  const totalComparisons = estimateTotalComparisons(categoryList.length);

  const [compareState, setCompareState] = useState<CompareState>({
    lo: 0,
    hi: 0,
    mid: 0,
    comparisons: 0,
  });
  const [compareUndo, setCompareUndo] = useState<CompareState[]>([]);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);

  const beginCompare = () => {
    if (categoryList.length === 0) {
      setInsertIndex(0);
      setStep('note');
      return;
    }
    setCompareState(initialCompareState(categoryList.length));
    setCompareUndo([]);
    setStep('compare');
  };

  const onChoose = (kind: 'better' | 'worse' | 'tie') => {
    setCompareUndo((s) => [...s, compareState]);
    const result =
      kind === 'better'
        ? chooseBetter(compareState, categoryList.length)
        : kind === 'worse'
          ? chooseWorse(compareState, categoryList.length)
          : chooseTie(compareState, categoryList.length);
    if (result.kind === 'continue') {
      setCompareState(result.next);
    } else {
      setInsertIndex(result.insertIndex);
      setCompareUndo([]);
      setStep('note');
    }
  };

  const undoCompare = () => {
    setCompareUndo((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setCompareState(next);
      return stack.slice(0, -1);
    });
  };

  const pickReviewPhotosFromLibrary = useCallback(async () => {
    const remaining = MAX_REVIEW_PHOTOS - reviewPhotos.length;
    if (remaining <= 0) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        'Allow photo library access to attach images to your review.'
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled) return;
    setReviewPhotos((prev) => [...prev, ...result.assets].slice(0, MAX_REVIEW_PHOTOS));
  }, [reviewPhotos.length]);

  const takeReviewPhoto = useCallback(async () => {
    if (reviewPhotos.length >= MAX_REVIEW_PHOTOS) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take a photo for your review.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85, base64: true });
    if (result.canceled) return;
    const a = result.assets[0];
    if (a) setReviewPhotos((prev) => [...prev, a].slice(0, MAX_REVIEW_PHOTOS));
  }, [reviewPhotos.length]);

  const removeReviewPhoto = useCallback((index: number) => {
    setReviewPhotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ─── Save ───────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!userId || !selected || !vibe || category == null || insertIndex == null) {
      setErrorMsg('Missing info — back up a step and try again.');
      return;
    }
    setErrorMsg(null);
    setStep('saving');
    try {
      // Build the ranked list with the new (or re-ranked) item inserted at the chosen spot,
      // then score the category to find the rating for that entry.
      const rerankId = rerankIdRef.current;

      const newSnapshotItem: RankSnapshotItem & { rating?: number } = {
        id: rerankId ?? '__new__',
        item: selected.name,
        store,
        category,
        vibe,
      };
      const newRanked = insertIntoCategoryRanked(rankedSnapshot, newSnapshotItem, insertIndex);
      const inCategory = newRanked.filter((r) => r.category === category);
      const scored = computeScoresByCategory(inCategory);
      const placed = scored.find((r) => (rerankId ? String(r.id) === String(rerankId) : r.id === '__new__'));
      const finalRating = placed ? placed.rating : 10;

      const macrosPayload = buildMacrosPayload(macros);
      const dietTags = qualifiesHighProteinLowCalFromMacroForm(macros) ? [HIGH_PROTEIN_LOW_CAL_ID] : [];
      const storeTrim = store.trim();

      let postId: string | number | null = null;

      if (rerankId) {
        const myRankPos = scored.findIndex((r) => String(r.id) === String(rerankId)) + 1;
        if (myRankPos <= 0) {
          setErrorMsg('Could not resolve position — try again.');
          setStep('note');
          return;
        }
        await updateRankedPost(userId, rerankId, {
          item: selected.name,
          descriptionKey: selected.descriptionKey,
          store: storeTrim,
          stores: storeTrim ? [storeTrim] : [],
          productBrand: selected.brand,
          category,
          emoji: '',
          note,
          rating: finalRating,
          rankPosition: myRankPos,
          dietTags,
          macros: macrosPayload,
          vibe,
          radarOnly: false,
        });
        postId = rerankId;
        const peers = scored.map((r, i) => ({
          id: r.id,
          rating: r.rating,
          rankPosition: i + 1,
        }));
        await syncPeerPostRanks(userId, peers, rerankId);
        const descKey =
          String(selected.descriptionKey ?? '').trim().toLowerCase() ||
          normalizedDescriptionKeyFromItem(selected.name);
        await deleteOtherUserRankedPostsSameSlot(userId, rerankId, {
          descriptionKey: descKey,
          itemFallback: selected.name,
          primaryStoreNorm: storeTrim.trim().toLowerCase(),
        });
        await bumpPostFeedRecency(userId, rerankId);
      } else {
        const created = await createPost({
          userId,
          item: selected.name,
          descriptionKey: selected.descriptionKey,
          store: storeTrim,
          stores: storeTrim ? [storeTrim] : [],
          productBrand: selected.brand,
          category,
          emoji: '',
          note,
          rating: finalRating,
          rankPosition: insertIndex + 1,
          dietTags,
          macros: macrosPayload,
          vibe,
          photoUrls: [],
          radarOnly: false,
        });
        postId = created.id;
      }

      if (!rerankId && postId == null && reviewPhotos.length > 0) {
        Alert.alert(
          'Photos not attached',
          'Your score was saved, but we could not attach photos to this post. Pull to refresh the feed, or try adding photos again from this product.'
        );
      }

      if (postId != null && reviewPhotos.length > 0) {
        try {
          const uploaded = await uploadPostPhotoLocalAssets(
            userId,
            postId,
            reviewPhotos.map((a) => ({
              uri: a.uri,
              mimeType: a.mimeType ?? null,
              base64: a.base64 ?? null,
            }))
          );
          if (uploaded.length > 0) {
            await setPostPhotoUrlsForUserPost(userId, postId, uploaded);
          }
        } catch (photoErr) {
          console.warn('post photo upload failed:', photoErr);
          Alert.alert(
            'Ranking saved',
            'Your score was saved, but photos could not be uploaded. Check your connection and try again later.'
          );
        }
      }

      pokeFeedRefresh(postId);
      router.dismiss();
    } catch (err) {
      console.warn('createPost failed:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Could not save.');
      setStep('note');
    }
  };

  // ─── Step views ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={BaggedColors.onBg} />
        </Pressable>
        <Text style={styles.headerTitle}>{step === 'compare' ? 'Comparing' : 'Rate'}</Text>
        <View style={styles.closeBtn} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        {step === 'search' ? (
          <SearchStep
            query={query}
            setQuery={setQuery}
            results={results}
            loading={searching}
            onPick={(row) => {
              router.push({
                pathname: '/product/detail',
                params: {
                  item: row.description,
                  brand: searchRowBrand(row),
                  category: String(row.foodCategory ?? '').trim(),
                  store: '',
                  descriptionKey: row.descriptionKey?.trim() || row.description.trim().toLowerCase(),
                },
              });
            }}
          />
        ) : null}

        {step === 'category' && selected ? (
          <CategoryStep
            selected={selected}
            category={category}
            setCategory={setCategory}
            onContinue={() => setStep('vibe')}
            onBack={() => (params.prefilledItem ? router.back() : setStep('search'))}
          />
        ) : null}

        {step === 'vibe' && selected ? (
          <VibeStep
            selected={selected}
            category={category}
            vibe={vibe}
            setVibe={setVibe}
            store={store}
            setStore={setStore}
            onBack={() => setStep('category')}
            onContinue={() => {
              if (!vibe) return;
              setStep('nutrition');
            }}
            snapshotLoading={false}
          />
        ) : null}

        {step === 'nutrition' && selected ? (
          <NutritionStep
            selected={selected}
            macros={macros}
            setMacros={setMacros}
            onBack={() => setStep('vibe')}
            onContinue={() => {
              if (snapshotLoading) return;
              beginCompare();
            }}
            snapshotLoading={snapshotLoading}
          />
        ) : null}

        {step === 'compare' && selected && vibe ? (
          <CompareStep
            comparisons={compareState.comparisons}
            totalComparisons={totalComparisons}
            comparisonItem={categoryList[compareState.mid]}
            comparisonScore={categoryScored[compareState.mid]?.rating}
            selected={selected}
            onBetter={() => onChoose('better')}
            onWorse={() => onChoose('worse')}
            onTie={() => onChoose('tie')}
            onUndo={undoCompare}
            canUndo={compareUndo.length > 0}
          />
        ) : null}

        {step === 'note' && selected && vibe ? (
          <NoteStep
            selected={selected}
            note={note}
            setNote={setNote}
            reviewPhotos={reviewPhotos}
            onPickLibrary={pickReviewPhotosFromLibrary}
            onTakePhoto={takeReviewPhoto}
            onRemovePhoto={removeReviewPhoto}
            errorMsg={errorMsg}
            onSubmit={submit}
            onBack={() => setStep('compare')}
          />
        ) : null}

        {step === 'saving' ? (
          <View style={styles.centered}>
            <ActivityIndicator color={BaggedColors.onBg} />
            <Text style={styles.savingText}>Saving your ranking…</Text>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Step components ──────────────────────────────────────────────────────────

function SearchStep({
  query,
  setQuery,
  results,
  loading,
  onPick,
}: {
  query: string;
  setQuery: (v: string) => void;
  results: SearchProductRow[];
  loading: boolean;
  onPick: (row: SearchProductRow) => void;
}) {
  return (
    <View style={styles.stepFlex}>
      <View style={styles.searchBox}>
        <TextField
          variant="dark"
          value={query}
          onChangeText={setQuery}
          placeholder="Find a product to rate"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
      </View>
      <FlatList
        data={results}
        keyExtractor={(item, idx) =>
          `${item.descriptionKey ?? item.description}-${item.fatSecretId ?? ''}-${idx}`
        }
        renderItem={({ item }) => <SearchResultRow row={item} onPress={onPick} />}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={BaggedColors.onBg} />
            </View>
          ) : query.trim().length < 2 ? (
            <View style={styles.centered}>
              <Text style={styles.stepHint}>Type at least two characters to start.</Text>
            </View>
          ) : (
            <View style={styles.centered}>
              <Text style={styles.stepHint}>No matches — try a different name or brand.</Text>
            </View>
          )
        }
      />
    </View>
  );
}

function CategoryStep({
  selected,
  category,
  setCategory,
  onContinue,
  onBack,
}: {
  selected: SelectedProduct;
  category: Category | null;
  setCategory: (c: Category) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.stepContent}>
      <ProductSummary selected={selected} />
      <Text style={styles.stepHeading}>What category?</Text>
      <Text style={styles.stepHint}>
        We&apos;ll compare this to other items in the same category only.
      </Text>
      <View style={styles.chipGrid}>
        {CATEGORIES.map((c) => {
          const active = category === c;
          return (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.stepActions}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.linkBack}>← Back</Text>
        </Pressable>
        <Pressable
          onPress={onContinue}
          disabled={category == null}
          style={[styles.primaryBtn, category == null && styles.primaryBtnDisabled]}>
          <Text style={styles.primaryBtnText}>Continue</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function VibeStep({
  selected,
  category,
  vibe,
  setVibe,
  store,
  setStore,
  onBack,
  onContinue,
  snapshotLoading,
}: {
  selected: SelectedProduct;
  category: Category | null;
  vibe: Vibe | null;
  setVibe: (v: Vibe) => void;
  store: string;
  setStore: (s: string) => void;
  onBack: () => void;
  onContinue: () => void;
  snapshotLoading: boolean;
}) {
  return (
    <ScrollView contentContainerStyle={styles.stepContent}>
      <ProductSummary selected={selected} subtitle={category ?? undefined} />
      <Text style={styles.stepHeading}>How was it?</Text>
      <View style={styles.vibeColumn}>
        {VIBE_OPTIONS.map((opt) => {
          const active = vibe === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => setVibe(opt.id)}
              style={[styles.vibeRow, active && styles.vibeRowActive]}>
              <Text style={[styles.vibeLabel, active && styles.vibeLabelActive]}>{opt.label}</Text>
              <Text style={[styles.vibeSubtitle, active && styles.vibeSubtitleActive]}>
                {opt.subtitle}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.stepHeading, { marginTop: 28 }]}>Where&apos;d you buy it?</Text>
      <Text style={styles.stepHint}>
        Optional — leave as &quot;Not sure&quot; if your store isn&apos;t listed.
      </Text>
      <View style={styles.chipGrid}>
        <Pressable
          onPress={() => setStore('')}
          style={[styles.chip, store.trim() === '' && styles.chipActive]}>
          <Text style={[styles.chipText, store.trim() === '' && styles.chipTextActive]}>Not sure / other</Text>
        </Pressable>
        {STORES.map((s) => {
          const active = store === s;
          return (
            <Pressable
              key={s}
              onPress={() => setStore(s)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.stepActions}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.linkBack}>← Back</Text>
        </Pressable>
        <Pressable
          onPress={onContinue}
          disabled={!vibe || snapshotLoading}
          style={[styles.primaryBtn, (!vibe || snapshotLoading) && styles.primaryBtnDisabled]}>
          <Text style={styles.primaryBtnText}>
            {snapshotLoading ? 'Loading…' : 'Start comparing'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function CompareStep({
  comparisons,
  totalComparisons,
  comparisonItem,
  comparisonScore,
  selected,
  onBetter,
  onWorse,
  onTie,
  onUndo,
  canUndo,
}: {
  comparisons: number;
  totalComparisons: number;
  comparisonItem: RankSnapshotItem | undefined;
  comparisonScore: number | undefined;
  selected: SelectedProduct;
  onBetter: () => void;
  onWorse: () => void;
  onTie: () => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  if (!comparisonItem) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={BaggedColors.onBg} />
      </View>
    );
  }
  const progress = totalComparisons === 0 ? 100 : Math.min(100, Math.round((comparisons / totalComparisons) * 100));
  return (
    <View style={styles.stepFlex}>
      <View style={styles.compareWrapper}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.compareCaption}>
          Which do you prefer? · Comparison {comparisons + 1}
        </Text>

        <View style={styles.compareCardsRow}>
          <CompareCard
            label="Your new item"
            title={selected.name}
            brand={selected.brand}
            onPress={onBetter}
          />
          <CompareCard
            label="Already on your list"
            title={comparisonItem.item}
            brand=""
            score={comparisonScore}
            onPress={onWorse}
          />
        </View>

        <Pressable onPress={onTie} style={styles.tieBtn} hitSlop={8}>
          <Text style={styles.tieBtnText}>Too tough — they&apos;re about the same</Text>
        </Pressable>

        {canUndo ? (
          <Pressable onPress={onUndo} style={styles.undoBtn} hitSlop={8}>
            <Text style={styles.undoText}>Undo last comparison</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function CompareCard({
  label,
  title,
  brand,
  score,
  onPress,
}: {
  label: string;
  title: string;
  brand: string;
  score?: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.compareCard, pressed && styles.cardPressed]}>
      <Text style={styles.compareLabel}>{label}</Text>
      <View style={styles.compareCardBody}>
        <AutoFitText
          style={styles.compareTitle}
          numberOfLines={5}
          minimumFontScale={0.32}>
          {formatProductDisplayName(title)}
        </AutoFitText>
        {brand ? (
          <AutoFitText style={styles.compareBrand} numberOfLines={2} minimumFontScale={0.45}>
            {formatProductDisplayName(brand)}
          </AutoFitText>
        ) : null}
        <View style={styles.compareScoreSlot}>
          {typeof score === 'number' ? (
            <Text
              style={[
                styles.compareScoreNum,
                score >= 9 ? styles.compareScoreHigh : score >= 7 ? styles.compareScoreMid : styles.compareScoreLow,
              ]}>
              {score.toFixed(1)}
            </Text>
          ) : null}
        </View>
      </View>
      <Text style={styles.compareCta}>I prefer this →</Text>
    </Pressable>
  );
}

function NutritionStep({
  selected,
  macros,
  setMacros,
  onBack,
  onContinue,
  snapshotLoading,
}: {
  selected: SelectedProduct;
  macros: { cal: string; protein: string; carbs: string; fat: string; servingLabel: string };
  setMacros: (next: { cal: string; protein: string; carbs: string; fat: string; servingLabel: string }) => void;
  onBack: () => void;
  onContinue: () => void;
  snapshotLoading: boolean;
}) {
  const updateField = (key: keyof typeof macros, value: string) => {
    setMacros({ ...macros, [key]: value });
  };
  return (
    <ScrollView contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
      <ProductSummary selected={selected} />
      <Text style={styles.stepHeading}>Nutrition (optional)</Text>
      <Text style={styles.stepHint}>
        Per serving — leave blank if you&apos;re not sure. We&apos;ll show pills on your rating
        when filled in.
      </Text>
      <View style={styles.macrosGrid}>
        <View style={styles.macrosCell}>
          <Text style={styles.macrosLabel}>Calories</Text>
          <TextField
            variant="dark"
            value={macros.cal}
            onChangeText={(v) => updateField('cal', v)}
            keyboardType="number-pad"
            placeholder="0"
          />
        </View>
        <View style={styles.macrosCell}>
          <Text style={styles.macrosLabel}>Protein (g)</Text>
          <TextField
            variant="dark"
            value={macros.protein}
            onChangeText={(v) => updateField('protein', v)}
            keyboardType="number-pad"
            placeholder="0"
          />
        </View>
        <View style={styles.macrosCell}>
          <Text style={styles.macrosLabel}>Carbs (g)</Text>
          <TextField
            variant="dark"
            value={macros.carbs}
            onChangeText={(v) => updateField('carbs', v)}
            keyboardType="number-pad"
            placeholder="0"
          />
        </View>
        <View style={styles.macrosCell}>
          <Text style={styles.macrosLabel}>Fat (g)</Text>
          <TextField
            variant="dark"
            value={macros.fat}
            onChangeText={(v) => updateField('fat', v)}
            keyboardType="number-pad"
            placeholder="0"
          />
        </View>
      </View>
      <Text style={styles.macrosLabel}>Serving size</Text>
      <TextField
        variant="dark"
        value={macros.servingLabel}
        onChangeText={(v) => updateField('servingLabel', v)}
        placeholder="e.g. 1 bar (40g)"
        autoCapitalize="none"
      />
      <View style={styles.stepActions}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.linkBack}>← Back</Text>
        </Pressable>
        <Pressable
          onPress={onContinue}
          disabled={snapshotLoading}
          style={[styles.primaryBtn, snapshotLoading && styles.primaryBtnDisabled]}>
          <Text style={styles.primaryBtnText}>
            {snapshotLoading ? 'Loading…' : 'Start comparing'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** Coerce the form state to a `posts.macros` JSON value (or null when empty). */
function buildMacrosPayload(input: {
  cal: string;
  protein: string;
  carbs: string;
  fat: string;
  servingLabel: string;
}): Record<string, unknown> | null {
  const num = (v: string): number | null => {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const cal = num(input.cal);
  const protein = num(input.protein);
  const carbs = num(input.carbs);
  const fat = num(input.fat);
  const sl = input.servingLabel.trim();
  if (cal == null && protein == null && carbs == null && fat == null && !sl) return null;
  const out: Record<string, unknown> = {};
  if (cal != null) out.cal = cal;
  if (protein != null) out.protein = protein;
  if (carbs != null) out.carbs = carbs;
  if (fat != null) out.fat = fat;
  if (sl) out.servingLabel = sl;
  return out;
}

function NoteStep({
  selected,
  note,
  setNote,
  reviewPhotos,
  onPickLibrary,
  onTakePhoto,
  onRemovePhoto,
  errorMsg,
  onSubmit,
  onBack,
}: {
  selected: SelectedProduct;
  note: string;
  setNote: (v: string) => void;
  reviewPhotos: ImagePicker.ImagePickerAsset[];
  onPickLibrary: () => void;
  onTakePhoto: () => void;
  onRemovePhoto: (index: number) => void;
  errorMsg: string | null;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const canAddMore = reviewPhotos.length < MAX_REVIEW_PHOTOS;

  return (
    <ScrollView contentContainerStyle={styles.stepContent}>
      <ProductSummary selected={selected} />
      <Text style={styles.stepHeading}>Add a note (optional)</Text>
      <Text style={styles.stepHint}>
        Tell your followers what you thought — what worked, what didn&apos;t.
      </Text>
      <TextField
        variant="dark"
        value={note}
        onChangeText={setNote}
        placeholder="One of my favorites… / better than expected… / didn't love the texture…"
        multiline
        numberOfLines={4}
        autoCapitalize="sentences"
      />
      <Text style={[styles.stepHeading, { marginTop: 22 }]}>Photos (optional)</Text>
      <Text style={styles.stepHint}>
        Up to {MAX_REVIEW_PHOTOS} images — same album as on the web.
      </Text>
      {reviewPhotos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.reviewPhotoRow}>
          {reviewPhotos.map((asset, idx) => (
            <View key={`${asset.uri}-${idx}`} style={styles.reviewPhotoThumbWrap}>
              <Image source={{ uri: asset.uri }} style={styles.reviewPhotoThumb} contentFit="cover" />
              <Pressable
                onPress={() => onRemovePhoto(idx)}
                style={styles.reviewPhotoRemove}
                hitSlop={6}>
                <Ionicons name="close" size={16} color="#fff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.reviewPhotoActions}>
        <Pressable
          onPress={onPickLibrary}
          disabled={!canAddMore}
          style={[styles.reviewPhotoBtn, !canAddMore && styles.reviewPhotoBtnDisabled]}>
          <Ionicons name="images-outline" size={20} color={BaggedColors.dark} />
          <Text style={styles.reviewPhotoBtnText}>Library</Text>
        </Pressable>
        {Platform.OS !== 'web' ? (
          <Pressable
            onPress={onTakePhoto}
            disabled={!canAddMore}
            style={[styles.reviewPhotoBtn, !canAddMore && styles.reviewPhotoBtnDisabled]}>
            <Ionicons name="camera-outline" size={20} color={BaggedColors.dark} />
            <Text style={styles.reviewPhotoBtnText}>Camera</Text>
          </Pressable>
        ) : null}
      </View>
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      <View style={styles.stepActions}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.linkBack}>← Back</Text>
        </Pressable>
        <Pressable onPress={onSubmit} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save ranking</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function ProductSummary({ selected, subtitle }: { selected: SelectedProduct; subtitle?: string }) {
  return (
    <View style={styles.summary}>
      <AutoFitText style={styles.summaryName} numberOfLines={6} minimumFontScale={0.38}>
        {formatProductDisplayName(selected.name)}
      </AutoFitText>
      {selected.brand ? (
        <AutoFitText style={styles.summaryBrand} numberOfLines={3} minimumFontScale={0.5}>
          {formatProductDisplayName(selected.brand)}
        </AutoFitText>
      ) : null}
      {subtitle ? <Text style={styles.summarySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BaggedColors.bg,
  },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderOnBg,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.onBg,
  },
  searchBox: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    flexGrow: 1,
  },
  stepFlex: { flex: 1 },
  stepContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  stepHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.onBgMuted,
    lineHeight: 20,
    textAlign: 'center',
  },
  stepHeading: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.onBg,
    marginBottom: 6,
    marginTop: 12,
  },
  summary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: BaggedColors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    marginBottom: 12,
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  summaryName: {
    fontFamily: BaggedFonts.display,
    fontSize: 20,
    color: BaggedColors.dark,
    lineHeight: 24,
    width: '100%',
  },
  summaryBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    marginTop: 2,
    width: '100%',
  },
  summarySubtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.accent,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 6,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    backgroundColor: 'transparent',
  },
  chipActive: {
    backgroundColor: BaggedColors.dark,
    borderColor: BaggedColors.dark,
  },
  chipText: {
    fontFamily: BaggedFonts.display,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.onBgMuted,
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  vibeColumn: {
    gap: 10,
    marginTop: 16,
  },
  vibeRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
  },
  vibeRowActive: {
    borderColor: BaggedColors.accent,
    backgroundColor: BaggedColors.accentPale,
  },
  vibeLabel: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.dark,
  },
  vibeLabelActive: {
    color: BaggedColors.accent,
  },
  vibeSubtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    marginTop: 2,
  },
  vibeSubtitleActive: {
    color: BaggedColors.dark,
  },
  stepActions: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkBack: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.onBgMuted,
  },
  primaryBtn: {
    backgroundColor: BaggedColors.dark,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    fontFamily: BaggedFonts.display,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  reviewPhotoRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
  },
  reviewPhotoThumbWrap: {
    position: 'relative',
  },
  reviewPhotoThumb: {
    width: 88,
    height: 88,
    borderRadius: 12,
    backgroundColor: BaggedColors.borderSoft,
    borderWidth: 1,
    borderColor: BaggedColors.border,
  },
  reviewPhotoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewPhotoActions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 4,
  },
  reviewPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BaggedColors.dark,
    backgroundColor: BaggedColors.card,
  },
  reviewPhotoBtnDisabled: {
    opacity: 0.45,
  },
  reviewPhotoBtnText: {
    fontFamily: BaggedFonts.display,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  compareWrapper: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: {
    height: '100%',
    backgroundColor: BaggedColors.accent,
  },
  compareCaption: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
    textAlign: 'center',
    marginBottom: 18,
  },
  compareCardsRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    maxHeight: 400,
  },
  compareCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: BaggedColors.card,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: BaggedColors.dark,
    padding: 14,
    justifyContent: 'space-between',
    minHeight: 240,
  },
  cardPressed: {
    opacity: 0.85,
  },
  compareLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    flexShrink: 0,
  },
  compareCardBody: {
    flex: 1,
    minWidth: 0,
    marginTop: 8,
    justifyContent: 'flex-start',
  },
  compareTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.dark,
    lineHeight: 22,
    width: '100%',
  },
  compareBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    marginTop: 6,
    width: '100%',
  },
  compareScoreSlot: {
    marginTop: 10,
    alignItems: 'flex-start',
  },
  compareScoreNum: {
    fontFamily: BaggedFonts.display,
    fontSize: 28,
  },
  compareScoreHigh: { color: BaggedColors.scoreHigh },
  compareScoreMid: { color: BaggedColors.gold },
  compareScoreLow: { color: BaggedColors.scoreLow },
  compareCta: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: BaggedColors.accent,
    marginTop: 10,
    flexShrink: 0,
  },
  tieBtn: {
    marginTop: 18,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
  },
  tieBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.onBg,
  },
  undoBtn: {
    marginTop: 10,
    alignItems: 'center',
  },
  undoText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.onBgMuted,
    fontWeight: '600',
  },
  errorText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.accent,
    marginTop: 12,
  },
  savingText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.onBgMuted,
  },
  macrosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 4,
    marginTop: 12,
  },
  macrosCell: {
    width: '47%',
    flexGrow: 1,
  },
  macrosLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.onBgMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
    marginTop: 12,
  },
});
