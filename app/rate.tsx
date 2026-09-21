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
  StyleSheet,
  Text,
  View,
  type ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { KeyboardFormScroll } from '@/components/bagged/keyboard-form-scroll';
import {
  SubcategoryStep,
  CompareStep,
  ProductSummary,
  VibeStep,
  type RatingFlowRankSnapshotItem,
  type RatingFlowSelectedProduct,
} from '@/components/bagged/rating-flow-steps';
import { SubcategoryPickerGrid } from '@/components/bagged/subcategory-picker-grid';
import { scoreDisplayColor } from '@/components/bagged/score-badge';
import { SearchResultRow } from '@/components/bagged/search-result-row';
import { MentionNoteField } from '@/components/bagged/mention-note-field';
import { TextField } from '@/components/bagged/text-field';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  HIGH_PROTEIN_LOW_CAL_ID,
  highProteinLowCalTagDisabled,
  highProteinLowCalTagLockedOn,
  qualifiesHighProteinLowCalFromMacroForm,
} from '@/constants/diet-tags';
import { DietTagChips } from '@/components/bagged/diet-tag-chips';
import {
  isLegitimateTraderJoesBrand,
  retailStoresForRow,
  STORES,
  storesForBrandAndSelections,
  TRADER_JOES_STORE,
} from '@/constants/grocery';
import { useDebounce } from '@/hooks/use-debounce';
import {
  bumpPostFeedRecency,
  createPost,
  deleteOtherUserRankedPostsSameSlot,
  enqueueNutritionLoadingDockFromRanking,
  insertCuratedProductStub,
  getUserRankings,
  isRadarOnlyDbRow,
  fetchCuratedSubcategoryForProduct,
  normalizePostMacros,
  productDescriptionKey,
  resolveProductDescriptionKey,
  rateMacroFormFromNumbers,
  rateMacroFormHasAny,
  searchProducts,
  searchRowBrand,
  searchRowIsAlreadyRanked,
  appendPostPhotoUrlsForUserPost,
  getPostPhotoUrlsForUserPost,
  normalizePhotoUrls,
  propagateProductMetadataFromRanking,
  setPostPhotoUrlsForUserPost,
  RANKED_DUPLICATE_MSG,
  resolveMacrosForRateProduct,
  resolveMacrosForSearchProductRow,
  setProductMetadataGlobally,
  syncPeerPostRanks,
  updateRankedPost,
  userHasWantToTryForProduct,
  wouldDuplicateRankedPost,
  type RankedPostRow,
  type RateMacroFormState,
  type SearchProductRow,
} from '@/lib/data';
import { uploadPostPhotoLocalAssets } from '@/lib/post-photo-upload-lazy';
import { removeStorageObjectsForPostPhotoUrls } from '@/lib/post-photo-storage';
import { pokeFeedRefresh } from '@/lib/feed-refresh-poke';
import { logEvent } from '@/lib/log-event';
import {
  postIdString,
  postWantToTryWithFeed,
  removeWantToTryAfterRanking,
} from '@/lib/want-to-try-feed';
import { formatProductDisplayName } from '@/lib/format';
import {
  chooseBetter,
  chooseTie,
  chooseWorse,
  canonicalRatingsFromRankedRows,
  postNeedsRecategorization,
  estimateTotalComparisons,
  initialCompareState,
  mapCategory,
  normalizeVibe,
  scoreCategoryAfterInsert,
  scoreCategoryAtRest,
  sortRowsByRankPosition,
  rankingScopeForRow,
  type Category,
  type CompareState,
  type Vibe,
} from '@/lib/ranking';
import { ReviewPhotoPicker } from '@/components/bagged/review-photo-picker';
import {
  MAX_REVIEW_PHOTOS,
  reviewPhotosToUploadAssets,
  useReviewPhotoPicker,
} from '@/lib/review-photos';
import { legacyCategoryForSubcategory, getSubcategory, mapLegacyCategoryToSubcategory, subcategoryForRow } from '@/constants/categories';
import { useAuth } from '@/providers/auth-provider';

type Step =
  | 'intent'
  | 'search'
  | 'manual_entry'
  | 'subcategory'
  | 'category'
  | 'radar_confirm'
  | 'vibe'
  | 'nutrition'
  | 'compare'
  | 'compare_preview'
  | 'note'
  | 'saving';

type EntryIntent = 'tried' | 'want';

type SelectedProduct = RatingFlowSelectedProduct;
type RankSnapshotItem = RatingFlowRankSnapshotItem;

type ConfirmedCategoryScoreRow = RankSnapshotItem & { rating: number; tiedAbove?: boolean };

function mapPreviewScoredRowsForSave(
  rows: ConfirmedCategoryScoreRow[],
  previewNewId: string | number,
  saveNewId: string | number
): ConfirmedCategoryScoreRow[] {
  const previewTokens = new Set(
    ['__preview__', '__new__', String(previewNewId)].filter(Boolean)
  );
  return rows.map((row) => ({
    ...row,
    id: previewTokens.has(String(row.id)) ? saveNewId : row.id,
  }));
}

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

export default function RateScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{
    prefilledItem?: string;
    prefilledBrand?: string;
    prefilledCategory?: string;
    prefilledStores?: string;
    rerankPostId?: string;
    prefilledMacroCal?: string;
    prefilledMacroProtein?: string;
    prefilledMacroCarbs?: string;
    prefilledMacroFat?: string;
    prefilledMacroServing?: string;
    prefilledDietTags?: string;
    prefilledNote?: string;
    /** 'want' opens the want-to-try flow already pointed at the prefilled product (barcode scanner). */
    prefilledIntent?: string;
    /** 'scan' when the product came from a barcode: never guess nutrition from a fuzzy name match. */
    prefilledSource?: string;
    isWantToTry?: string;
    wantToTryRadarPostId?: string;
  }>();
  const fromScan = params.prefilledSource === 'scan';
  const isWantToTryParam = params.isWantToTry === 'true';
  const wantToTryRadarPostIdParam = params.wantToTryRadarPostId ?? null;

  const [step, setStep] = useState<Step>(() => {
    if (params.prefilledItem) return params.prefilledIntent === 'want' ? 'radar_confirm' : 'subcategory';
    if (params.rerankPostId) return 'vibe';
    return 'intent';
  });
  const [entryIntent, setEntryIntent] = useState<EntryIntent | null>(() =>
    params.prefilledItem && params.prefilledIntent === 'want' ? 'want' : null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [manualCatalogNote, setManualCatalogNote] = useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  /** Manual entry already saved diet tags + nutrition to the shared catalog — skip duplicate steps. */
  const manualEntryMetadataDoneRef = useRef(false);
  const submitRadarRef = useRef<(() => Promise<void>) | null>(null);

  // ─── Selection state ────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<SelectedProduct | null>(() => {
    if (params.prefilledItem) {
      return {
        name: String(params.prefilledItem),
        brand: String(params.prefilledBrand ?? ''),
        descriptionKey: productDescriptionKey(
          String(params.prefilledItem),
          String(params.prefilledBrand ?? '')
        ),
      };
    }
    return null;
  });
  const [category, setCategory] = useState<Category | null>(() => {
    const pc = firstRouteParam(params.prefilledCategory);
    if (pc) return mapCategory(pc);
    return null;
  });
  const [subcategoryId, setSubcategoryId] = useState<string | null>(() => {
    const pc = firstRouteParam(params.prefilledCategory);
    if (pc) return mapLegacyCategoryToSubcategory(pc);
    return null;
  });
  const [curatedSubcategoryId, setCuratedSubcategoryId] = useState<string | null>(null);
  const [curatedSubcategoryLoading, setCuratedSubcategoryLoading] = useState(false);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [selectedStores, setSelectedStores] = useState<string[]>(() => {
    const brand = String(params.prefilledBrand ?? '');
    const raw = firstRouteParam(params.prefilledStores);
    const fromParams = raw
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    return storesForBrandAndSelections(brand, fromParams);
  });
  const [selectedDietTags, setSelectedDietTags] = useState<string[]>(() => {
    const raw = firstRouteParam(params.prefilledDietTags);
    if (!raw) return [];
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  });
  const [note, setNote] = useState(() => firstRouteParam(params.prefilledNote));
  /** Remote URLs already on the post when re-ranking (user can remove before save). */
  const [keptExistingPhotoUrls, setKeptExistingPhotoUrls] = useState<string[]>([]);
  const initialExistingPhotoUrlsRef = useRef<string[]>([]);
  const {
    photos: reviewPhotos,
    pickFromLibrary: pickReviewPhotosFromLibrary,
    takePhoto: takeReviewPhoto,
    removePhoto: removeReviewPhoto,
    canAddMore: canAddReviewPhotos,
  } = useReviewPhotoPicker({ existingCount: keptExistingPhotoUrls.length });
  const removeKeptExistingPhoto = useCallback((index: number) => {
    setKeptExistingPhotoUrls((prev) => prev.filter((_, i) => i !== index));
  }, []);
  const [macros, setMacros] = useState<RateMacroFormState>(() => macroFormFromRouteParams(params));
  /** Numbers we filled in for the user (not typed by them). The hint hides once they edit any field. */
  const [autoFilledMacros, setAutoFilledMacros] = useState<RateMacroFormState | null>(() => {
    const initial = macroFormFromRouteParams(params);
    return rateMacroFormHasAny(initial) ? initial : null;
  });
  const macrosAutoFilled =
    autoFilledMacros != null &&
    (['cal', 'protein', 'carbs', 'fat', 'servingLabel'] as const).every(
      (k) => macros[k] === autoFilledMacros[k]
    );

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
        if (cancelled) return;
        setResults(rows);
        logEvent('search_performed', {
          query: debouncedQuery.trim().toLowerCase().slice(0, 60),
          result_count: rows.length,
          context: 'rate',
        });
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, step]);

  useEffect(() => {
    const key = selected?.descriptionKey?.trim();
    if (!key || step === 'manual_entry') return;
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
  }, [selected?.descriptionKey, selected?.name, selected?.brand, step]);

  /** Prefill nutrition when a product is chosen (curated catalog, explore deep link, or rerank). */
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
    // Manual entry is user-supplied data — do not guess from FatSecret / catalog.
    if (step === 'manual_entry') return;
    if (selected?.searchRow) return;
    if (rateMacroFormHasAny(macroFormFromRouteParams(params))) return;

    let cancelled = false;

    (async () => {
      const form = await resolveMacrosForRateProduct({
        item,
        brand: selected?.brand ?? '',
        allowFatSecretGuess: !fromScan,
      });
      if (cancelled || !rateMacroFormHasAny(form)) return;
      setMacros((prev) => (rateMacroFormHasAny(prev) ? prev : form));
      setAutoFilledMacros((prev) => prev ?? form);
    })();

    return () => {
      cancelled = true;
    };
  }, [step, selected?.name, selected?.brand, selected?.searchRow, routeMacroSig, fromScan]);

  useEffect(() => {
    const qualifies = qualifiesHighProteinLowCalFromMacroForm(macros);
    const blockManual = highProteinLowCalTagDisabled(macros);
    setSelectedDietTags((prev) => {
      if (qualifies) {
        return prev.includes(HIGH_PROTEIN_LOW_CAL_ID)
          ? prev
          : [...prev, HIGH_PROTEIN_LOW_CAL_ID];
      }
      if (blockManual) {
        return prev.filter((t) => t !== HIGH_PROTEIN_LOW_CAL_ID);
      }
      return prev;
    });
  }, [macros.cal, macros.protein]);

  const toggleDietTag = useCallback(
    (id: string) => {
      if (id === HIGH_PROTEIN_LOW_CAL_ID) {
        if (highProteinLowCalTagLockedOn(macros)) return;
        if (highProteinLowCalTagDisabled(macros)) return;
      }
      setSelectedDietTags((prev) =>
        prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
      );
    },
    [macros]
  );

  // ─── Ranked list snapshot for the compare step ──────────────────────────────
  const [rankedSnapshot, setRankedSnapshot] = useState<RankSnapshotItem[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const rerankIdRef = useRef<string | null>(params.rerankPostId ? String(params.rerankPostId) : null);
  /** Scores frozen when the user taps "Looks right — continue" on the preview step. */
  const confirmedCategoryScoredRef = useRef<ConfirmedCategoryScoreRow[] | null>(null);
  const [confirmedPlacedRating, setConfirmedPlacedRating] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setSnapshotLoading(true);
    getUserRankings(userId)
      .then((rows) => {
        if (cancelled) return;
        const tried = (rows as RankedPostRow[])
          .filter((r) => !isRadarOnlyDbRow(r))
          .filter((r) => !postNeedsRecategorization(r))
          // Hide the post being reranked — otherwise the user gets asked to
          // compare it to itself.
          .filter((r) => (rerankIdRef.current ? String(r.id) !== rerankIdRef.current : true))
          .map((r) => ({
            id: r.id,
            item: r.item,
            brand: String(r.product_brand ?? '').trim(),
            store: r.store ?? '',
            category: r.category,
            subcategory: subcategoryForRow(r),
            vibe: normalizeVibe(r.vibe),
            rank_position: r.rank_position,
            tiedAbove: r.tied_above === true,
          }));
        const canonical = canonicalRatingsFromRankedRows(tried);
        const ratingById = new Map(canonical.map((r) => [String(r.id), r.rating]));
        const withCanonicalRatings: RankSnapshotItem[] = tried.map((r) => ({
          ...r,
          rating: ratingById.get(String(r.id)),
        }));
        // Per-category scoring infers ties on load; avoid global inferTiesByRating here
        // (it only sees globally adjacent rows and disagrees with My List).
        setRankedSnapshot(withCanonicalRatings);
        // If reranking, hydrate from the post being reranked.
        if (rerankIdRef.current) {
          const target = (rows as RankedPostRow[]).find(
            (r) => String(r.id) === rerankIdRef.current
          );
          if (target) {
            setSelected({
              name: target.item,
              brand: target.product_brand ?? '',
              descriptionKey: resolveProductDescriptionKey({
                item: target.item,
                brand: target.product_brand ?? '',
                descriptionKey: target.description_key,
              }),
            });
            const resolvedSub = subcategoryForRow(target);
            setSubcategoryId(resolvedSub);
            setCategory(legacyCategoryForSubcategory(resolvedSub) as Category);
            const sanitizedStores = retailStoresForRow({
              store: target.store,
              stores: target.stores,
              product_brand: target.product_brand,
            });
            setSelectedStores(sanitizedStores);
            setVibe(normalizeVibe(target.vibe));
            const past = normalizePostMacros(target.macros);
            if (past) {
              const filled = rateMacroFormFromNumbers(
                {
                  cal: past.cal,
                  protein: past.protein,
                  carbs: past.carbs,
                  fat: past.fat,
                  servingLabel: past.servingLabel,
                },
                { allowIntentionalAllZeros: true }
              );
              if (rateMacroFormHasAny(filled)) setMacros(filled);
            }
            const pastTags = Array.isArray(target.diet_tags)
              ? target.diet_tags.map((t) => String(t ?? '').trim()).filter(Boolean)
              : [];
            if (pastTags.length > 0) setSelectedDietTags(pastTags);
            const existingNote = String(target.note ?? '');
            setNote(existingNote);
            const savedPhotoUrls = normalizePhotoUrls(target.photo_urls);
            initialExistingPhotoUrlsRef.current = savedPhotoUrls;
            setKeptExistingPhotoUrls(savedPhotoUrls);
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

  const duplicateExcludeId = useMemo(
    () => rerankIdRef.current ?? postIdString(wantToTryRadarPostIdParam),
    [wantToTryRadarPostIdParam]
  );

  const checkDuplicateRank = useCallback(
    (item: string, brand: string, stores: string[]): string | null => {
      if (snapshotLoading) return null;
      if (
        wouldDuplicateRankedPost(rankedSnapshot, item, brand, stores, duplicateExcludeId)
      ) {
        return RANKED_DUPLICATE_MSG;
      }
      return null;
    },
    [rankedSnapshot, snapshotLoading, duplicateExcludeId]
  );

  // ─── Compare step state ─────────────────────────────────────────────────────
  const subcategoryScope = subcategoryId ?? (category ? mapLegacyCategoryToSubcategory(category) : '');
  /** Subcategory wins over stale search-inferred category when persisting. */
  const savedCategory = useMemo((): Category | null => {
    if (subcategoryScope) {
      return legacyCategoryForSubcategory(subcategoryScope) as Category;
    }
    return category;
  }, [subcategoryScope, category]);
  const categoryList = useMemo(
    () =>
      sortRowsByRankPosition(
        rankedSnapshot.filter((r) => rankingScopeForRow(r) === subcategoryScope)
      ),
    [rankedSnapshot, subcategoryScope]
  );
  const categoryScored = useMemo(() => scoreCategoryAtRest(categoryList), [categoryList]);
  const totalComparisons = estimateTotalComparisons(categoryList.length);

  const [compareState, setCompareState] = useState<CompareState>({
    lo: 0,
    hi: 0,
    mid: 0,
    comparisons: 0,
  });
  const comparisonPeer = categoryList[compareState.mid];
  const comparisonScore = useMemo(
    () =>
      comparisonPeer
        ? categoryScored.find((r) => String(r.id) === String(comparisonPeer.id))?.rating
        : undefined,
    [categoryScored, comparisonPeer]
  );
  const [compareUndo, setCompareUndo] = useState<CompareState[]>([]);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [tiedAboveOnInsert, setTiedAboveOnInsert] = useState(false);
  /** Set when user picks "tie" in compare — peer row index in the category list. */
  const [tieWithPeerIndex, setTieWithPeerIndex] = useState<number | null>(null);
  /** Score shown for the comparison peer when the user chose to tie (compare or preview). */
  const [tiePeerAnchorScore, setTiePeerAnchorScore] = useState<number | null>(null);
  const [noteBackStep, setNoteBackStep] = useState<Step>('compare');

  const hasPrefilledStart = Boolean(params.prefilledItem);
  const hasRerankStart = Boolean(params.rerankPostId);
  const showIntentStep = !hasPrefilledStart && !hasRerankStart;

  const rateStartedLoggedRef = useRef(false);
  useEffect(() => {
    if (rateStartedLoggedRef.current) return;
    rateStartedLoggedRef.current = true;
    logEvent('rate_started', {
      entry: hasRerankStart ? 'rerank' : hasPrefilledStart ? 'prefilled' : 'fresh',
      intent: params.prefilledIntent === 'want' ? 'want' : undefined,
    });
  }, [hasPrefilledStart, hasRerankStart, params.prefilledIntent]);

  useEffect(() => {
    if (!selected || snapshotLoading || hasRerankStart) return;
    if (isWantToTryParam && wantToTryRadarPostIdParam) return;
    const dup = checkDuplicateRank(selected.name, selected.brand, selectedStores);
    if (dup) setErrorMsg(dup);
  }, [
    selected,
    selectedStores,
    snapshotLoading,
    hasRerankStart,
    isWantToTryParam,
    wantToTryRadarPostIdParam,
    checkDuplicateRank,
  ]);

  const resetProductSelection = useCallback(() => {
    manualEntryMetadataDoneRef.current = false;
    setSelected(null);
    setCategory(null);
    setSubcategoryId(null);
    setCuratedSubcategoryId(null);
    setVibe(null);
    setSelectedStores([]);
    setSelectedDietTags([]);
    setMacros({ cal: '', protein: '', carbs: '', fat: '', servingLabel: '' });
    setManualCatalogNote(null);
    setInsertIndex(null);
    setTiedAboveOnInsert(false);
    setTieWithPeerIndex(null);
    setTiePeerAnchorScore(null);
    confirmedCategoryScoredRef.current = null;
    setConfirmedPlacedRating(null);
    setCompareUndo([]);
  }, []);

  const handleHeaderBack = useCallback(() => {
    setErrorMsg(null);
    switch (step) {
      case 'intent':
        router.back();
        break;
      case 'search':
        if (showIntentStep) setStep('intent');
        else router.back();
        break;
      case 'manual_entry':
      case 'radar_confirm':
        resetProductSelection();
        setStep('search');
        break;
      case 'subcategory':
        if (hasPrefilledStart || hasRerankStart) router.back();
        else {
          resetProductSelection();
          setStep('search');
        }
        break;
      case 'category':
      case 'vibe':
        setVibe(null);
        if (manualEntryMetadataDoneRef.current) {
          setStep('manual_entry');
        } else {
          setStep('subcategory');
        }
        break;
      case 'nutrition':
        setCompareUndo([]);
        setInsertIndex(null);
        setTiedAboveOnInsert(false);
        setTieWithPeerIndex(null);
        confirmedCategoryScoredRef.current = null;
      setConfirmedPlacedRating(null);
        setStep('vibe');
        break;
      case 'compare':
        setCompareUndo([]);
        setInsertIndex(null);
        setTiedAboveOnInsert(false);
        setTieWithPeerIndex(null);
        confirmedCategoryScoredRef.current = null;
      setConfirmedPlacedRating(null);
        setStep(manualEntryMetadataDoneRef.current ? 'vibe' : 'nutrition');
        break;
      case 'compare_preview':
        reopenCompare();
        break;
      case 'note':
        setStep(noteBackStep);
        break;
      default:
        break;
    }
  }, [
    step,
    showIntentStep,
    hasPrefilledStart,
    hasRerankStart,
    noteBackStep,
    resetProductSelection,
    router,
  ]);

  const canHeaderBack = step !== 'saving';

  const beginCompare = () => {
    if (selected) {
      const dup = checkDuplicateRank(selected.name, selected.brand, selectedStores);
      if (dup) {
        setErrorMsg(dup);
        return;
      }
    }
    setTiedAboveOnInsert(false);
    setTieWithPeerIndex(null);
    setTiePeerAnchorScore(null);
    if (categoryList.length === 0) {
      setInsertIndex(0);
      setNoteBackStep('nutrition');
      setStep('compare_preview');
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
      const finalIdx = result.insertIndex;
      setInsertIndex(finalIdx);
      if (kind === 'tie' && result.kind === 'done') {
        const peerIdx = result.tiedWith ?? null;
        setTieWithPeerIndex(peerIdx);
        setTiedAboveOnInsert(false);
        if (peerIdx != null) {
          const peer = categoryList[peerIdx];
          const peerScore = peer
            ? categoryScored.find((r) => String(r.id) === String(peer.id))?.rating
            : undefined;
          setTiePeerAnchorScore(
            typeof peerScore === 'number' && Number.isFinite(peerScore) ? peerScore : null
          );
        } else {
          setTiePeerAnchorScore(null);
        }
      } else {
        setTieWithPeerIndex(null);
        setTiedAboveOnInsert(false);
        setTiePeerAnchorScore(null);
        confirmedCategoryScoredRef.current = null;
      setConfirmedPlacedRating(null);
      }
      setCompareUndo([]);
      setNoteBackStep('compare_preview');
      setStep('compare_preview');
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

  /** From the preview screen: throw away the chosen slot, walk back into compare mode. */
  const reopenCompare = () => {
    if (categoryList.length === 0) return;
    setInsertIndex(null);
    setTiedAboveOnInsert(false);
    setTieWithPeerIndex(null);
    setTiePeerAnchorScore(null);
    confirmedCategoryScoredRef.current = null;
    setConfirmedPlacedRating(null);
    setCompareState(initialCompareState(categoryList.length));
    setCompareUndo([]);
    setStep('compare');
  };

  /**
   * Build the same in-memory ranked snapshot we'll persist on save, so the
   * preview step can read the new item's computed rating + its neighbors.
   */
  const previewScored = useMemo(() => {
    if (insertIndex == null || !selected || !vibe || !category || !subcategoryScope) return null;
    const previewPostId =
      rerankIdRef.current ??
      postIdString(wantToTryRadarPostIdParam) ??
      '__preview__';
    const newItem: RankSnapshotItem = {
      id: previewPostId,
      item: selected.name,
      brand: selected.brand,
      store: selectedStores[0] ?? '',
      category,
      subcategory: subcategoryScope,
      vibe,
    };
    const scored = scoreCategoryAfterInsert(rankedSnapshot, newItem, insertIndex, {
      markTiedAbove: tiedAboveOnInsert,
      tieWithPeerIndex: tieWithPeerIndex ?? undefined,
      categoryList,
      categoryScored,
      tiePeerAnchorScore: tiePeerAnchorScore,
    });
    const placedIdx = scored.findIndex((r) => String(r.id) === String(previewPostId));
    if (placedIdx < 0) return null;

    const abovePeer = insertIndex > 0 ? categoryList[insertIndex - 1] : null;
    const belowPeer = insertIndex < categoryList.length ? categoryList[insertIndex] : null;
    const neighborRating = (peer: RankSnapshotItem | null) =>
      peer
        ? categoryScored.find((r) => String(r.id) === String(peer.id))?.rating
        : undefined;

    return {
      scored,
      placedIdx,
      above: abovePeer ? { ...abovePeer, rating: neighborRating(abovePeer) } : null,
      below: belowPeer ? { ...belowPeer, rating: neighborRating(belowPeer) } : null,
    };
  }, [
    insertIndex,
    tiedAboveOnInsert,
    tieWithPeerIndex,
    tiePeerAnchorScore,
    categoryList,
    categoryScored,
    rankedSnapshot,
    selected,
    vibe,
    category,
    subcategoryScope,
    selectedStores,
    wantToTryRadarPostIdParam,
  ]);

  /**
   * Toggle the tie state for the inserted item from the preview screen.
   *
   * - When already tied: break the tie.
   * - When there is an item above: tie with it.
   * - When at the very top (no item above): shift the new item down by one and
   *   tie with the displaced peer so the user can change their mind on a 10.
   */
  const togglePreviewTie = () => {
    if (insertIndex == null || !previewScored) return;
    if (tiedAboveOnInsert || tieWithPeerIndex != null) {
      setTiedAboveOnInsert(false);
      setTieWithPeerIndex(null);
      setTiePeerAnchorScore(null);
      confirmedCategoryScoredRef.current = null;
      setConfirmedPlacedRating(null);
      return;
    }
    const aboveItem = previewScored.above;
    if (aboveItem) {
      setTieWithPeerIndex(null);
      setTiedAboveOnInsert(true);
      confirmedCategoryScoredRef.current = null;
      setConfirmedPlacedRating(null);
      setTiePeerAnchorScore(
        typeof aboveItem.rating === 'number' && Number.isFinite(aboveItem.rating)
          ? aboveItem.rating
          : null
      );
      return;
    }
    const belowItem = previewScored.below;
    if (!belowItem) return;
    setInsertIndex((idx) => (idx != null ? idx + 1 : idx));
    setTieWithPeerIndex(null);
    setTiedAboveOnInsert(true);
    confirmedCategoryScoredRef.current = null;
    setConfirmedPlacedRating(null);
    setTiePeerAnchorScore(
      typeof belowItem.rating === 'number' && Number.isFinite(belowItem.rating)
        ? belowItem.rating
        : null
    );
  };

  const openManualEntry = useCallback(() => {
    const name = query.trim();
    if (!name) return;
    setErrorMsg(null);
    setManualCatalogNote(null);
    setSelected({
      name,
      brand: '',
      descriptionKey: productDescriptionKey(name, ''),
    });
    setCategory('Snacks');
    setSubcategoryId(null);
    setSelectedStores(entryIntent === 'want' ? [] : []);
    setSelectedDietTags([]);
    setMacros({ cal: '', protein: '', carbs: '', fat: '', servingLabel: '' });
    setResults([]);
    setStep('manual_entry');
  }, [query, entryIntent]);

  const toggleManualStore = useCallback(
    (s: string) => {
      if (selected && isLegitimateTraderJoesBrand(selected.brand, { assumePlaceholder: false })) {
        setSelectedStores([TRADER_JOES_STORE]);
        return;
      }
      setSelectedStores((prev) => {
        if (prev.includes(s)) return prev.filter((x) => x !== s);
        return [...prev, s];
      });
    },
    [selected]
  );

  const toggleVibeStore = useCallback(
    (s: string) => {
      if (selected && isLegitimateTraderJoesBrand(selected.brand, { assumePlaceholder: false })) {
        setSelectedStores([TRADER_JOES_STORE]);
        return;
      }
      setSelectedStores((prev) => {
        if (prev.includes(s)) return prev.filter((x) => x !== s);
        return [...prev, s];
      });
    },
    [selected]
  );

  const submitManualProductForm = useCallback(async (options?: { continueAfterSave?: boolean }) => {
    const continueAfterSave = options?.continueAfterSave ?? true;
    const name = (selected?.name ?? '').trim();
    const brand = (selected?.brand ?? '').trim();
    if (!name) {
      setErrorMsg('Enter a product title.');
      return;
    }
    if (!brand) {
      setErrorMsg('Enter a brand name.');
      return;
    }
    if (!subcategoryId) {
      setErrorMsg('Pick a subcategory.');
      return;
    }
    if (!userId) {
      setErrorMsg('Sign in to add products.');
      return;
    }
    const cat = legacyCategoryForSubcategory(subcategoryId);
    const lockedStores = storesForBrandAndSelections(brand, selectedStores);
    setErrorMsg(null);
    setManualSubmitting(true);

    let note = '';
    try {
      const res = await insertCuratedProductStub(userId, {
        description: name,
        brandOwner: brand,
        foodCategory: cat,
        subcategory: subcategoryId,
        cal: macros.cal,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        stores: lockedStores,
        servingLabel: macros.servingLabel,
        dietTags: selectedDietTags,
      });
      if (!res.ok) {
        note =
          res.reason === 'no_user'
            ? 'Sign in to save this product to shared search.'
            : res.error?.message
              ? `Couldn't save to shared catalog: ${res.error.message}`
              : "Couldn't save to shared catalog.";
      } else if (res.duplicate) {
        note = 'This name is already in shared search.';
      } else {
        note = 'Saved to shared search.';
      }
    } catch {
      note = "Couldn't save to shared catalog.";
    }

    try {
      const globalRes = await setProductMetadataGlobally({
        item: name,
        descriptionKey: productDescriptionKey(name, brand),
        productBrand: brand,
        category: cat,
        subcategory: subcategoryId,
        stores: lockedStores,
        dietTags: selectedDietTags,
        macros,
      });
      if (!globalRes.ok && !note) {
        note = globalRes.message;
      }
    } catch (globalErr) {
      console.warn('setProductMetadataGlobally (manual):', globalErr);
    }

    try {
      const dock = await enqueueNutritionLoadingDockFromRanking(userId, {
        description: name,
        brandOwner: brand,
        foodCategory: cat,
        macros,
        dietTags: selectedDietTags,
        postId: null,
        forceQueue: true,
        itemDisplay: name,
      });
      if (dock.ok && dock.queued) {
        note = note ? `${note} Sent to the nutrition review queue.` : 'Sent to the nutrition review queue.';
      } else if (dock.ok === false && dock.reason === 'no_user') {
        note = (note || "Couldn't update review queue.") + ' Sign in to add to the review queue.';
      }
    } catch (e) {
      console.warn('Manual dock enqueue:', e);
    }

    setSelected({
      name,
      brand,
      descriptionKey: productDescriptionKey(name, brand),
    });
    setCategory(cat as Category);
    setSubcategoryId(subcategoryId);
    setSelectedStores(lockedStores);
    setManualCatalogNote(note || null);
    setManualSubmitting(false);
    setResults([]);
    const dup = checkDuplicateRank(name, brand, lockedStores);
    if (dup) {
      setErrorMsg(dup);
      return;
    }
    manualEntryMetadataDoneRef.current = true;
    if (!continueAfterSave) {
      router.dismiss();
      return;
    }
    if (entryIntent === 'want') {
      await submitRadarRef.current?.();
      return;
    }
    setStep('vibe');
  }, [
    selected,
    userId,
    category,
    subcategoryId,
    selectedStores,
    macros,
    selectedDietTags,
    entryIntent,
    checkDuplicateRank,
  ]);

  const pickFromSearch = useCallback(
    async (row: SearchProductRow) => {
      const brand = searchRowBrand(row);
      if (
        !snapshotLoading &&
        searchRowIsAlreadyRanked(row, rankedSnapshot, duplicateExcludeId)
      ) {
        return;
      }
      logEvent('search_result_picked', {
        source: row.isCurated ? 'catalog' : row.fatSecretId ? 'fatsecret' : 'other',
        has_brand: Boolean(brand),
      });
      const inferredCategory = mapCategory(
        String(row.foodCategory ?? '').trim() || row.description
      );
      const nextMacros = await resolveMacrosForRateProduct({
        item: row.description,
        brand,
        searchRow: row,
      });

      if (!brand) {
        setErrorMsg(null);
        setManualCatalogNote(
          'This item has no brand on file. Add a brand to save it to shared search.'
        );
        setSelected({
          name: row.description,
          brand: '',
          descriptionKey: row.descriptionKey?.trim() || productDescriptionKey(row.description, brand),
          searchRow: row,
        });
        setCategory(inferredCategory);
        setSubcategoryId(mapLegacyCategoryToSubcategory(inferredCategory));
        setSelectedStores([]);
        setSelectedDietTags([]);
        setMacros(nextMacros);
        setAutoFilledMacros(rateMacroFormHasAny(nextMacros) ? nextMacros : null);
        setQuery(row.description);
        setResults([]);
        setStep('manual_entry');
        return;
      }

      setSelected({
        name: row.description,
        brand,
        descriptionKey: productDescriptionKey(row.description, brand),
        searchRow: row,
      });
      setSelectedStores([]);
      setSelectedDietTags([]);
      setSubcategoryId(null);
      setCategory(inferredCategory);
      setMacros(nextMacros);
      setAutoFilledMacros(rateMacroFormHasAny(nextMacros) ? nextMacros : null);
      setQuery(row.description);
      setResults([]);
      if (entryIntent === 'want') {
        setStep('radar_confirm');
      } else {
        setStep('subcategory');
      }
    },
    [entryIntent, rankedSnapshot, snapshotLoading, duplicateExcludeId]
  );

  const toggleRadarStore = useCallback(
    (s: string) => {
      if (selected && isLegitimateTraderJoesBrand(selected.brand, { assumePlaceholder: false })) {
        setSelectedStores([TRADER_JOES_STORE]);
        return;
      }
      setSelectedStores((prev) => {
        if (prev.includes(s)) {
          if (prev.length <= 1) return [];
          return prev.filter((x) => x !== s);
        }
        return [...prev, s];
      });
    },
    [selected]
  );

  useEffect(() => {
    if (!selected?.brand) return;
    if (isLegitimateTraderJoesBrand(selected.brand, { assumePlaceholder: false })) {
      setSelectedStores([TRADER_JOES_STORE]);
    }
  }, [selected?.brand]);

  const submitRadar = async () => {
    if (!userId || !selected || !subcategoryId) {
      setErrorMsg('Pick a product and subcategory first.');
      return;
    }
    const cat = savedCategory ?? legacyCategoryForSubcategory(subcategoryId);
    setErrorMsg(null);
    setStep('saving');
    try {
      const lockedStores = storesForBrandAndSelections(selected.brand, selectedStores);
      const { radarPostId } = await postWantToTryWithFeed({
        userId,
        item: selected.name,
        brand: selected.brand,
        descriptionKey: selected.descriptionKey,
        stores: lockedStores,
        category: cat,
        subcategory: subcategoryId,
        dietTags: selectedDietTags,
        source: 'search',
        note,
      });
      logEvent('want_to_try_completed', { category: cat });

      if (reviewPhotos.length > 0) {
        const uploadAssets = reviewPhotosToUploadAssets(reviewPhotos);
        try {
          if (__DEV__) {
            console.log('[rate] uploading want-to-try photos', {
              radarPostId,
              count: uploadAssets.length,
            });
          }
          const uploaded = await uploadPostPhotoLocalAssets(
            userId,
            radarPostId,
            uploadAssets
          );
          if (uploaded.length > 0) {
            await appendPostPhotoUrlsForUserPost(userId, radarPostId, uploaded);
            if (__DEV__) {
              console.log('[rate] want-to-try photos attached', {
                radarPostId,
                urlCount: uploaded.length,
              });
            }
          }
        } catch (photoErr) {
          const message =
            photoErr instanceof Error
              ? photoErr.message
              : typeof photoErr === 'object' &&
                  photoErr !== null &&
                  'message' in photoErr
                ? String((photoErr as { message?: unknown }).message)
                : 'Unknown error';
          console.error('[rate] want-to-try photo upload failed', {
            radarPostId,
            photoCount: reviewPhotos.length,
            message,
            error: photoErr,
          });
          Alert.alert(
            'Saved without photos',
            `Posted to your feed and Want to Try list, but photos could not be uploaded: ${message}`
          );
        }
      }

      const macrosPayload = buildMacrosPayload(macros);
      try {
        await propagateProductMetadataFromRanking({
          userId,
          item: selected.name,
          descriptionKey: resolveProductDescriptionKey({
            item: selected.name,
            brand: selected.brand,
            descriptionKey: selected.descriptionKey,
          }),
          productBrand: selected.brand,
          category: savedCategory ?? legacyCategoryForSubcategory(subcategoryScope),
          subcategory: subcategoryScope,
          store: lockedStores[0] ?? '',
          stores: lockedStores,
          dietTags: selectedDietTags,
          macros: macrosPayload,
          sourcePostId: radarPostId,
        });
      } catch (propErr) {
        console.warn('propagateProductMetadataFromRanking (want):', propErr);
      }

      pokeFeedRefresh(radarPostId);
      router.dismiss();
    } catch (err) {
      console.warn('postWantToTryWithFeed failed:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Could not save.');
      setStep(manualEntryMetadataDoneRef.current ? 'manual_entry' : 'radar_confirm');
    }
  };

  submitRadarRef.current = submitRadar;

  // ─── Save ───────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!userId || !selected || !vibe || savedCategory == null || insertIndex == null) {
      setErrorMsg('Missing info — back up a step and try again.');
      return;
    }
    setErrorMsg(null);

    const rerankId = rerankIdRef.current;
    const convertRadarPostId = !rerankId ? postIdString(wantToTryRadarPostIdParam) : null;
    if (!rerankId && !convertRadarPostId) {
      const dup = checkDuplicateRank(
        selected.name,
        selected.brand,
        storesForBrandAndSelections(selected.brand, selectedStores)
      );
      if (dup) {
        setErrorMsg(dup);
        return;
      }
    }

    setStep('saving');
    try {
      const saveNewId = rerankId ?? convertRadarPostId ?? '__new__';
      const previewNewId = rerankId ?? convertRadarPostId ?? '__preview__';

      let scored: ConfirmedCategoryScoreRow[];

      if (confirmedCategoryScoredRef.current) {
        scored = mapPreviewScoredRowsForSave(
          confirmedCategoryScoredRef.current,
          previewNewId,
          saveNewId
        );
      } else {
        const newSnapshotItem: RankSnapshotItem & { rating?: number } = {
          id: saveNewId,
          item: selected.name,
          brand: selected.brand,
          store: selectedStores[0] ?? '',
          category,
          subcategory: subcategoryScope,
          vibe,
        };
        scored = scoreCategoryAfterInsert(rankedSnapshot, newSnapshotItem, insertIndex, {
          markTiedAbove: tiedAboveOnInsert,
          tieWithPeerIndex: tieWithPeerIndex ?? undefined,
          categoryList,
          categoryScored,
          tiePeerAnchorScore: tiePeerAnchorScore,
        });
      }

      confirmedCategoryScoredRef.current = null;
      setConfirmedPlacedRating(null);
      const buildCategoryPeers = (resolvedNewPostId?: string | number | null) =>
        scored.map((r, i) => ({
          id:
            resolvedNewPostId != null &&
            (String(r.id) === String(saveNewId) || r.id === '__new__')
              ? resolvedNewPostId
              : r.id,
          rating: r.rating,
          rankPosition: i + 1,
          tiedAbove: r.tiedAbove === true,
        }));
      const placedIdx = scored.findIndex((r) =>
        rerankId
          ? String(r.id) === String(rerankId)
          : convertRadarPostId
            ? String(r.id) === String(convertRadarPostId)
            : String(r.id) === String(saveNewId) || r.id === '__new__'
      );
      const placed = placedIdx >= 0 ? scored[placedIdx] : undefined;
      const finalRating = placed ? placed.rating : 10;
      const finalRankPosition = placedIdx >= 0 ? placedIdx + 1 : insertIndex + 1;

      const macrosPayload = buildMacrosPayload(macros);
      if (__DEV__) {
        console.log('[rate] post creation macros payload', {
          item: selected.name,
          brand: selected.brand,
          macrosForm: macros,
          macrosPayload,
        });
      }
      const dietTags = [
        ...new Set([
          ...selectedDietTags,
          ...(qualifiesHighProteinLowCalFromMacroForm(macros) ? [HIGH_PROTEIN_LOW_CAL_ID] : []),
        ]),
      ];
      const lockedStores = storesForBrandAndSelections(selected.brand, selectedStores);
      const primaryStore = lockedStores[0] ?? '';

      const convertedFromWantToTry =
        Boolean(convertRadarPostId) ||
        Boolean(isWantToTryParam) ||
        (await userHasWantToTryForProduct(userId, selected.name, selected.brand).catch(() => false));

      let postId: string | number | null = null;

      const persistRankedPost = async (targetPostId: string | number) => {
        const peers = buildCategoryPeers(targetPostId);
        const myPeer = peers.find((p) => String(p.id) === String(targetPostId));
        const myRankPos = myPeer?.rankPosition ?? 0;
        if (myRankPos <= 0) {
          setErrorMsg('Could not resolve position — try again.');
          setStep('note');
          return false;
        }
        await updateRankedPost(userId, targetPostId, {
          item: selected.name,
          descriptionKey: selected.descriptionKey,
          store: primaryStore,
          stores: lockedStores,
          productBrand: selected.brand,
          category: savedCategory ?? legacyCategoryForSubcategory(subcategoryScope),
          subcategory: subcategoryScope,
          emoji: '',
          note,
          rating: myPeer?.rating ?? finalRating,
          rankPosition: myRankPos,
          dietTags,
          macros: macrosPayload,
          vibe,
          radarOnly: false,
          convertedFromWantToTry,
          tiedAbove: myPeer?.tiedAbove === true,
        });
        postId = targetPostId;
        await syncPeerPostRanks(userId, peers, targetPostId);
        const descKey = resolveProductDescriptionKey({
          item: selected.name,
          brand: selected.brand,
          descriptionKey: selected.descriptionKey,
        });
        await deleteOtherUserRankedPostsSameSlot(userId, targetPostId, {
          descriptionKey: descKey,
          itemFallback: selected.name,
          primaryStoreNorm: primaryStore.trim().toLowerCase(),
        });
        await bumpPostFeedRecency(userId, targetPostId);
        return true;
      };

      if (rerankId) {
        const ok = await persistRankedPost(rerankId);
        if (!ok) return;
      } else if (convertRadarPostId) {
        const ok = await persistRankedPost(convertRadarPostId);
        if (!ok) return;
      } else {
        const created = await createPost({
          userId,
          item: selected.name,
          descriptionKey: selected.descriptionKey,
          store: primaryStore,
          stores: lockedStores,
          productBrand: selected.brand,
          category: savedCategory ?? legacyCategoryForSubcategory(subcategoryScope),
          subcategory: subcategoryScope,
          emoji: '',
          note,
          rating: finalRating,
          rankPosition: finalRankPosition,
          dietTags,
          macros: macrosPayload,
          vibe,
          photoUrls: [],
          radarOnly: false,
          convertedFromWantToTry,
          tiedAbove: placed?.tiedAbove === true,
        });
        postId = created.id;
        if (postId != null) {
          const peers = buildCategoryPeers(postId);
          await syncPeerPostRanks(userId, peers);
        }
      }

      logEvent('rate_completed', {
        category: savedCategory,
        isRerank: Boolean(rerankId),
      });

      if (!rerankId && postId == null && reviewPhotos.length > 0) {
        Alert.alert(
          'Photos not attached',
          'Your score was saved, but we could not attach photos to this post. Pull to refresh the feed, or try adding photos again from this product.'
        );
      }

      let attachedPhotoUrls: string[] = [];
      const editingExistingPost = Boolean(rerankId || convertRadarPostId);
      if (postId != null && editingExistingPost) {
        try {
          let finalPhotoUrls = [...keptExistingPhotoUrls];
          if (reviewPhotos.length > 0) {
            const uploadAssets = reviewPhotosToUploadAssets(reviewPhotos);
            if (__DEV__) {
              console.log('[rate] uploading review photos (rerank/edit)', {
                postId,
                count: uploadAssets.length,
                keptExisting: keptExistingPhotoUrls.length,
              });
            }
            const uploaded = await uploadPostPhotoLocalAssets(userId, postId, uploadAssets);
            if (uploaded.length === 0 && reviewPhotos.length > 0) {
              throw new Error('No photos were uploaded (empty result).');
            }
            finalPhotoUrls = [...finalPhotoUrls, ...uploaded].slice(0, MAX_REVIEW_PHOTOS);
          }
          const removedUrls = initialExistingPhotoUrlsRef.current.filter(
            (url) => !keptExistingPhotoUrls.includes(url)
          );
          if (removedUrls.length > 0) {
            await removeStorageObjectsForPostPhotoUrls(removedUrls);
          }
          await setPostPhotoUrlsForUserPost(userId, postId, finalPhotoUrls);
          attachedPhotoUrls = finalPhotoUrls;
        } catch (photoErr) {
          const message =
            photoErr instanceof Error
              ? photoErr.message
              : typeof photoErr === 'object' &&
                  photoErr !== null &&
                  'message' in photoErr
                ? String((photoErr as { message?: unknown }).message)
                : 'Unknown error';
          console.error('[rate] post photo save failed (rerank/edit)', {
            postId,
            photoCount: reviewPhotos.length,
            message,
            error: photoErr,
          });
          Alert.alert(
            'Ranking saved',
            `Your score was saved, but photos could not be updated: ${message}`
          );
          attachedPhotoUrls = await getPostPhotoUrlsForUserPost(userId, postId).catch(() => []);
        }
      } else if (postId != null && reviewPhotos.length > 0) {
        const uploadAssets = reviewPhotosToUploadAssets(reviewPhotos);
        try {
          if (__DEV__) {
            console.log('[rate] uploading review photos', {
              postId,
              count: uploadAssets.length,
            });
          }
          const uploaded = await uploadPostPhotoLocalAssets(userId, postId, uploadAssets);
          if (uploaded.length > 0) {
            attachedPhotoUrls = await appendPostPhotoUrlsForUserPost(userId, postId, uploaded);
            if (__DEV__) {
              console.log('[rate] review photos attached', {
                postId,
                urlCount: attachedPhotoUrls.length,
              });
            }
          } else {
            throw new Error('No photos were uploaded (empty result).');
          }
        } catch (photoErr) {
          const message =
            photoErr instanceof Error
              ? photoErr.message
              : typeof photoErr === 'object' &&
                  photoErr !== null &&
                  'message' in photoErr
                ? String((photoErr as { message?: unknown }).message)
                : 'Unknown error';
          console.error('[rate] post photo upload failed', {
            postId,
            photoCount: reviewPhotos.length,
            message,
            error: photoErr,
          });
          Alert.alert(
            'Ranking saved',
            `Your score was saved, but photos could not be uploaded: ${message}`
          );
        }
      } else if (postId != null) {
        attachedPhotoUrls = await getPostPhotoUrlsForUserPost(userId, postId).catch(() => []);
      }

      const descKeyForSync = resolveProductDescriptionKey({
        item: selected.name,
        brand: selected.brand,
        descriptionKey: selected.descriptionKey,
      });
      try {
        await propagateProductMetadataFromRanking({
          userId,
          item: selected.name,
          descriptionKey: descKeyForSync,
          productBrand: selected.brand,
          category: savedCategory ?? legacyCategoryForSubcategory(subcategoryScope),
          subcategory: subcategoryScope,
          store: primaryStore,
          stores: lockedStores,
          dietTags,
          macros: macrosPayload,
          sourcePostId: postId,
          photoUrls: attachedPhotoUrls,
        });
      } catch (propErr) {
        console.warn('propagateProductMetadataFromRanking failed:', propErr);
      }

      // Remove every want-to-try row (and radar feed post) for this product so
      // it only lives under Tried after ranking.
      try {
        await removeWantToTryAfterRanking(userId, {
          item: selected.name,
          descriptionKey: descKeyForSync,
          productBrand: selected.brand,
          radarPostIdHint: isWantToTryParam ? wantToTryRadarPostIdParam : null,
          keepRadarPostId: convertRadarPostId,
        });
      } catch {
        // Non-fatal — ranking itself succeeded
      }

      if (postId != null) {
        await bumpPostFeedRecency(userId, postId);
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
        <Pressable
          onPress={handleHeaderBack}
          hitSlop={10}
          style={styles.headerSideBtn}
          disabled={!canHeaderBack}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          {canHeaderBack ? (
            <Ionicons name="chevron-back" size={24} color={BaggedColors.onBg} />
          ) : null}
        </Pressable>
        <Text style={styles.headerTitle}>
          {step === 'compare'
            ? 'Comparing'
            : step === 'compare_preview'
              ? 'Confirm placement'
              : step === 'manual_entry'
                ? 'Add manually'
                : entryIntent === 'want'
                  ? 'Want to Try'
                  : 'Rate'}
        </Text>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.headerSideBtn}
          accessibilityRole="button"
          accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={BaggedColors.onBg} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 4 : 0}
        style={styles.flex}>
        {step === 'intent' ? (
          <IntentStep
            onTried={() => {
              setEntryIntent('tried');
              setStep('search');
            }}
            onWant={() => {
              setEntryIntent('want');
              setStep('search');
            }}
            onScan={() => router.replace('/scan')}
          />
        ) : null}

        {step === 'search' ? (
          <SearchStep
            query={query}
            setQuery={setQuery}
            results={results}
            loading={searching}
            placeholder={
              entryIntent === 'want' ? 'Find something to try' : 'Find a product to rate'
            }
            onPick={pickFromSearch}
            onManualEntry={openManualEntry}
            isAlreadyRanked={(row) =>
              !snapshotLoading &&
              searchRowIsAlreadyRanked(row, rankedSnapshot, duplicateExcludeId)
            }
          />
        ) : null}

        {step === 'manual_entry' && selected ? (
          <ManualEntryStep
            entryIntent={entryIntent}
            selected={selected}
            onChangeSelected={(patch) =>
              setSelected((s) => (s ? { ...s, ...patch } : s))
            }
            subcategoryId={subcategoryId}
            onSelectSubcategory={(id) => {
              setSubcategoryId(id);
              setCategory(id ? (legacyCategoryForSubcategory(id) as Category) : null);
            }}
            selectedStores={selectedStores}
            onToggleStore={toggleManualStore}
            selectedDietTags={selectedDietTags}
            onToggleDietTag={toggleDietTag}
            macros={macros}
            setMacros={setMacros}
            catalogNote={manualCatalogNote}
            errorMsg={errorMsg}
            submitting={manualSubmitting}
            reviewPhotos={reviewPhotos}
            onPickLibrary={pickReviewPhotosFromLibrary}
            onTakePhoto={takeReviewPhoto}
            onRemovePhoto={removeReviewPhoto}
            canAddMore={canAddReviewPhotos}
            note={note}
            setNote={setNote}
            userId={userId}
            onBack={handleHeaderBack}
            onSubmit={() => void submitManualProductForm({ continueAfterSave: true })}
            onSaveOnly={
              entryIntent === 'tried'
                ? () => void submitManualProductForm({ continueAfterSave: false })
                : undefined
            }
          />
        ) : null}

        {step === 'radar_confirm' && selected ? (
          <RadarConfirmStep
            selected={selected}
            subcategoryId={subcategoryId}
            onSelectSubcategory={(id) => {
              setSubcategoryId(id);
              setCategory(id ? (legacyCategoryForSubcategory(id) as Category) : null);
            }}
            selectedStores={selectedStores}
            onToggleStore={toggleRadarStore}
            selectedDietTags={selectedDietTags}
            onToggleDietTag={toggleDietTag}
            macros={macros}
            reviewPhotos={reviewPhotos}
            onPickLibrary={pickReviewPhotosFromLibrary}
            onTakePhoto={takeReviewPhoto}
            onRemovePhoto={removeReviewPhoto}
            canAddMore={canAddReviewPhotos}
            errorMsg={errorMsg}
            note={note}
            setNote={setNote}
            userId={userId}
            onBack={handleHeaderBack}
            onSubmit={submitRadar}
          />
        ) : null}

        {step === 'subcategory' && selected ? (
          <SubcategoryStep
            selected={selected}
            subcategoryId={subcategoryId}
            setSubcategoryId={(id) => {
              setSubcategoryId(id);
              setCategory(id ? (legacyCategoryForSubcategory(id) as Category) : null);
            }}
            curatedSubcategoryId={curatedSubcategoryId}
            curatedLoading={curatedSubcategoryLoading}
            onContinue={() => {
              const dup = checkDuplicateRank(selected.name, selected.brand, selectedStores);
              if (dup) {
                setErrorMsg(dup);
                return;
              }
              if (!subcategoryId) {
                setErrorMsg('Pick a subcategory to continue.');
                return;
              }
              setErrorMsg(null);
              setStep('vibe');
            }}
            onBack={handleHeaderBack}
            errorMsg={errorMsg}
          />
        ) : null}

        {step === 'vibe' && selected ? (
          <VibeStep
            selected={selected}
            category={category}
            subcategoryLabel={subcategoryId ? getSubcategory(subcategoryId)?.label : null}
            vibe={vibe}
            setVibe={setVibe}
            selectedStores={selectedStores}
            onToggleStore={toggleVibeStore}
            showStores={!manualEntryMetadataDoneRef.current}
            onBack={handleHeaderBack}
            onContinue={async () => {
              if (!vibe || !selected) return;
              const dup = checkDuplicateRank(selected.name, selected.brand, selectedStores);
              if (dup) {
                setErrorMsg(dup);
                return;
              }
              setErrorMsg(null);
              if (manualEntryMetadataDoneRef.current) {
                beginCompare();
                return;
              }
              if (!rateMacroFormHasAny(macros)) {
                const form = await resolveMacrosForRateProduct({
                  item: selected.name,
                  brand: selected.brand,
                  searchRow: selected.searchRow,
                  allowFatSecretGuess: !fromScan,
                });
                if (rateMacroFormHasAny(form)) {
                  setMacros(form);
                  setAutoFilledMacros(form);
                }
              }
              setStep('nutrition');
            }}
            snapshotLoading={false}
            errorMsg={errorMsg}
          />
        ) : null}

        {step === 'nutrition' && selected ? (
          <NutritionStep
            selected={selected}
            macros={macros}
            setMacros={setMacros}
            autoFilledNote={macrosAutoFilled}
            selectedDietTags={selectedDietTags}
            onToggleDietTag={toggleDietTag}
            onBack={handleHeaderBack}
            onContinue={() => {
              if (snapshotLoading) return;
              beginCompare();
            }}
            snapshotLoading={snapshotLoading}
            errorMsg={errorMsg}
          />
        ) : null}

        {step === 'compare' && selected && vibe ? (
          <CompareStep
            comparisons={compareState.comparisons}
            totalComparisons={totalComparisons}
            comparisonItem={comparisonPeer}
            comparisonScore={comparisonScore}
            selected={selected}
            onBetter={() => onChoose('better')}
            onWorse={() => onChoose('worse')}
            onTie={() => onChoose('tie')}
            onUndo={undoCompare}
            canUndo={compareUndo.length > 0}
          />
        ) : null}

        {step === 'compare_preview' && selected && previewScored ? (
          <ComparePreviewStep
            selected={selected}
            placedRating={previewScored.scored[previewScored.placedIdx]?.rating ?? 10}
            placedIndex={previewScored.placedIdx}
            totalInCategory={previewScored.scored.length}
            aboveItem={previewScored.above}
            aboveRating={previewScored.above?.rating}
            belowItem={previewScored.below}
            belowRating={previewScored.below?.rating}
            tiedWithAbove={tiedAboveOnInsert || tieWithPeerIndex != null}
            canTie={previewScored.above != null || previewScored.below != null}
            onToggleTie={togglePreviewTie}
            onConfirm={() => {
              if (previewScored) {
                const placed = previewScored.scored[previewScored.placedIdx];
                setConfirmedPlacedRating(
                  typeof placed?.rating === 'number' ? placed.rating : null
                );
                confirmedCategoryScoredRef.current = previewScored.scored.map((row) => ({
                  ...row,
                  rating: row.rating,
                }));
              }
              setNoteBackStep('compare_preview');
              setStep('note');
            }}
            onReopenCompare={reopenCompare}
          />
        ) : null}

        {step === 'note' && selected && vibe ? (
          <NoteStep
            selected={selected}
            placedRating={confirmedPlacedRating}
            note={note}
            setNote={setNote}
            userId={userId}
            reviewPhotos={reviewPhotos}
            existingPhotoUrls={keptExistingPhotoUrls}
            onRemoveExistingPhoto={removeKeptExistingPhoto}
            onPickLibrary={pickReviewPhotosFromLibrary}
            onTakePhoto={takeReviewPhoto}
            onRemovePhoto={removeReviewPhoto}
            canAddMore={canAddReviewPhotos}
            errorMsg={errorMsg}
            onSubmit={submit}
            onBack={handleHeaderBack}
          />
        ) : null}

        {step === 'saving' ? (
          <View style={styles.centered}>
            <ActivityIndicator color={BaggedColors.onBg} />
            <Text style={styles.savingText}>
              {entryIntent === 'want' ? 'Posting to feed…' : 'Saving your ranking…'}
            </Text>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Step components ──────────────────────────────────────────────────────────

function IntentStep({
  onTried,
  onWant,
  onScan,
}: {
  onTried: () => void;
  onWant: () => void;
  onScan: () => void;
}) {
  return (
    <KeyboardFormScroll contentContainerStyle={styles.stepContent}>
      <Text style={styles.stepHeading}>What are you adding?</Text>
      <Pressable onPress={onTried} style={styles.intentCardDark}>
        <Text style={styles.intentTitleLight}>I&apos;ve tried it</Text>
        <Text style={styles.intentSubLight}>Rank it, tag it, and post to the feed</Text>
      </Pressable>
      <Pressable onPress={onWant} style={styles.intentCardAccent}>
        <Text style={styles.intentTitleAccent}>Want to try</Text>
        <Text style={styles.intentSubAccent}>Save for later and share on the feed</Text>
      </Pressable>
      <Pressable onPress={onScan} style={styles.intentCardScan}>
        <Text style={styles.intentTitleScan}>Scan a barcode</Text>
        <Text style={styles.intentSubScan}>Point your camera at the item to find it fast</Text>
      </Pressable>
    </KeyboardFormScroll>
  );
}

function RadarConfirmStep({
  selected,
  subcategoryId,
  onSelectSubcategory,
  selectedStores,
  onToggleStore,
  selectedDietTags,
  onToggleDietTag,
  macros,
  reviewPhotos,
  onPickLibrary,
  onTakePhoto,
  onRemovePhoto,
  canAddMore,
  note,
  setNote,
  userId,
  errorMsg,
  onBack,
  onSubmit,
}: {
  selected: SelectedProduct;
  subcategoryId: string | null;
  onSelectSubcategory: (id: string | null) => void;
  selectedStores: string[];
  onToggleStore: (s: string) => void;
  selectedDietTags: string[];
  onToggleDietTag: (id: string) => void;
  macros: { cal: string; protein: string; carbs: string; fat: string; servingLabel: string };
  reviewPhotos: import('expo-image-picker').ImagePickerAsset[];
  onPickLibrary: () => void;
  onTakePhoto: () => void;
  onRemovePhoto: (index: number) => void;
  canAddMore: boolean;
  note: string;
  setNote: (v: string) => void;
  userId: string | null;
  errorMsg: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const tjOnly = isLegitimateTraderJoesBrand(selected.brand, { assumePlaceholder: false });
  return (
    <KeyboardFormScroll contentContainerStyle={styles.stepContent}>
      <ProductSummary selected={selected} />
      <Text style={styles.stepHeading}>Where would you get it?</Text>
      <Text style={styles.stepHint}>Optional — skip if you&apos;re not sure yet.</Text>
      {tjOnly ? (
        <Text style={styles.stepHint}>Trader Joe&apos;s brand items are only sold at Trader Joe&apos;s.</Text>
      ) : null}
      <View style={[styles.chipGrid, { marginTop: 8 }]}>
        {STORES.map((s) => {
          const active = selectedStores.includes(s);
          const disabled = tjOnly && s !== TRADER_JOES_STORE;
          return (
            <Pressable
              key={s}
              onPress={() => onToggleStore(s)}
              disabled={disabled}
              style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.stepHeading, { marginTop: 24 }]}>What type of product is this?</Text>
      <SubcategoryPickerGrid
        layout="stepped"
        selectedSubcategoryId={subcategoryId}
        onSelect={onSelectSubcategory}
      />
      <Text style={[styles.stepHeading, { marginTop: 24 }]}>Diet tags (optional)</Text>
      <DietTagChips selectedIds={selectedDietTags} onToggle={onToggleDietTag} macros={macros} />
      <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Caption (optional)</Text>
      <Text style={styles.stepHint}>
        Tell your followers why you want to try it — tag friends with @username.
      </Text>
      <MentionNoteField
        value={note}
        onChangeText={setNote}
        userId={userId}
        placeholder="Heard great things… / @friend recommended this…"
        multiline
        autoCapitalize="sentences"
        textAlignVertical="top"
        inputStyle={styles.noteInput}
      />
      <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Photos (optional)</Text>
      <Text style={styles.stepHint}>
        Add a snapshot of the item — helps followers spot it on the shelf.
      </Text>
      <ReviewPhotoPicker
        photos={reviewPhotos}
        onPickLibrary={onPickLibrary}
        onTakePhoto={onTakePhoto}
        onRemovePhoto={onRemovePhoto}
        canAddMore={canAddMore}
      />
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      <View style={styles.stepActions}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.linkBack}>← Back</Text>
        </Pressable>
        <Pressable
          onPress={onSubmit}
          disabled={subcategoryId == null}
          style={[styles.primaryBtn, subcategoryId == null && styles.primaryBtnDisabled]}>
          <Text style={styles.primaryBtnText}>Save & post to feed</Text>
        </Pressable>
      </View>
    </KeyboardFormScroll>
  );
}

function SearchStep({
  query,
  setQuery,
  results,
  loading,
  placeholder,
  onPick,
  onManualEntry,
  isAlreadyRanked,
}: {
  query: string;
  setQuery: (v: string) => void;
  results: SearchProductRow[];
  loading: boolean;
  placeholder: string;
  onPick: (row: SearchProductRow) => void | Promise<void>;
  onManualEntry: () => void;
  isAlreadyRanked?: (row: SearchProductRow) => boolean;
}) {
  const q = query.trim();
  const showManual = q.length >= 2 && !loading;

  const manualFooter = showManual ? (
    <Pressable onPress={onManualEntry} style={styles.manualSearchFooter}>
      <Text style={styles.manualSearchTitle}>
        {results.length === 0 ? `No results for "${q}"` : `Add "${q}" manually`}
      </Text>
      <Text style={styles.manualSearchSub}>
        Title, brand, stores, nutrition — shared search and staff review queue
      </Text>
      {results.length === 0 ? (
        <View style={styles.manualSearchBtn}>
          <Text style={styles.manualSearchBtnText}>Add manually</Text>
        </View>
      ) : null}
    </Pressable>
  ) : null;

  return (
    <View style={styles.stepFlex}>
      <View style={styles.searchBox}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
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
        renderItem={({ item }) => (
          <SearchResultRow
            row={item}
            onPress={onPick}
            alreadyRanked={isAlreadyRanked?.(item) ?? false}
          />
        )}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.listContent}
        ListFooterComponent={manualFooter}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={BaggedColors.onBg} />
            </View>
          ) : q.length < 2 ? (
            <View style={styles.centered}>
              <Text style={styles.stepHint}>Type at least two characters to start.</Text>
            </View>
          ) : (
            manualFooter
          )
        }
      />
    </View>
  );
}

function ManualEntryStep({
  entryIntent,
  selected,
  onChangeSelected,
  subcategoryId,
  onSelectSubcategory,
  selectedStores,
  onToggleStore,
  selectedDietTags,
  onToggleDietTag,
  macros,
  setMacros,
  catalogNote,
  errorMsg,
  submitting,
  reviewPhotos,
  onPickLibrary,
  onTakePhoto,
  onRemovePhoto,
  canAddMore,
  note,
  setNote,
  userId,
  onBack,
  onSubmit,
  onSaveOnly,
}: {
  entryIntent: EntryIntent | null;
  selected: SelectedProduct;
  onChangeSelected: (patch: Partial<SelectedProduct>) => void;
  subcategoryId: string | null;
  onSelectSubcategory: (id: string | null) => void;
  selectedStores: string[];
  onToggleStore: (s: string) => void;
  selectedDietTags: string[];
  onToggleDietTag: (id: string) => void;
  macros: RateMacroFormState;
  setMacros: (next: RateMacroFormState) => void;
  catalogNote: string | null;
  errorMsg: string | null;
  submitting: boolean;
  reviewPhotos: import('expo-image-picker').ImagePickerAsset[];
  onPickLibrary: () => void;
  onTakePhoto: () => void;
  onRemovePhoto: (index: number) => void;
  canAddMore: boolean;
  note: string;
  setNote: (v: string) => void;
  userId: string | null;
  onBack: () => void;
  onSubmit: () => void;
  onSaveOnly?: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollFieldIntoView = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  };
  const updateMacro = (key: keyof RateMacroFormState, value: string) => {
    setMacros({ ...macros, [key]: value });
  };
  const tjOnly = isLegitimateTraderJoesBrand(selected.brand, { assumePlaceholder: false });

  return (
    <KeyboardFormScroll
      ref={scrollRef}
      contentContainerStyle={styles.stepContent}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.stepHint, styles.manualIntro]}>
        {entryIntent === 'want'
          ? 'Enter everything you know — we\u2019ll save an unverified catalog stub and continue to Want to Try.'
          : 'Enter everything you know — we\u2019ll save an unverified catalog stub. Save only, or continue to rank if you\u2019ve tried it.'}
      </Text>

      <Text style={styles.fieldLabel}>Product title *</Text>
      <TextField
        value={selected.name}
        onChangeText={(v) => onChangeSelected({ name: v })}
        placeholder="e.g. Organic Blue Corn Tortilla Chips"
        autoCapitalize="words"
      />

      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Brand name *</Text>
      <TextField
        value={selected.brand}
        onChangeText={(v) => onChangeSelected({ brand: v })}
        placeholder="e.g. Trader Joe's, Kroger Private Selection"
        autoCapitalize="words"
      />

      <Text style={[styles.fieldLabel, { marginTop: 20 }]}>
        {entryIntent === 'want' ? 'Where would you get it? (optional)' : 'Where do you find it? (optional)'}
      </Text>
      {entryIntent === 'want' ? (
        <Text style={styles.stepHint}>Skip if you&apos;re not sure yet.</Text>
      ) : null}
      {tjOnly ? (
        <Text style={styles.stepHint}>Trader Joe&apos;s brand items are only sold at Trader Joe&apos;s.</Text>
      ) : null}
      <View style={[styles.chipGrid, { marginTop: 8 }]}>
        {STORES.map((s) => {
          const active = selectedStores.includes(s);
          const disabled = tjOnly && s !== TRADER_JOES_STORE;
          return (
            <Pressable
              key={s}
              onPress={() => onToggleStore(s)}
              disabled={disabled}
              style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Product type *</Text>
      <Text style={styles.stepHint}>Category, then the specific type.</Text>
      <SubcategoryPickerGrid
        layout="stepped"
        selectedSubcategoryId={subcategoryId}
        onSelect={onSelectSubcategory}
      />

      <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Diet tags (optional)</Text>
      <DietTagChips selectedIds={selectedDietTags} onToggle={onToggleDietTag} macros={macros} />

      {entryIntent === 'want' ? (
        <>
          <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Caption (optional)</Text>
          <Text style={styles.stepHint}>
            Tell your followers why you want to try it — tag friends with @username.
          </Text>
          <MentionNoteField
            value={note}
            onChangeText={setNote}
            userId={userId}
            placeholder="Heard great things… / @friend recommended this…"
            multiline
            autoCapitalize="sentences"
            textAlignVertical="top"
            inputStyle={styles.noteInput}
          />
        </>
      ) : null}

      <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Serving size (optional)</Text>
      <TextField
        value={macros.servingLabel}
        onChangeText={(v) => updateMacro('servingLabel', v)}
        placeholder="e.g. 2 cookies, 1 cup (240 ml), 28g"
        autoCapitalize="none"
        onFocus={scrollFieldIntoView}
      />

      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Macros per serving (optional)</Text>
      <View style={styles.macrosGrid}>
        {(
          [
            { key: 'cal' as const, label: 'Cal' },
            { key: 'protein' as const, label: 'Protein (g)' },
            { key: 'carbs' as const, label: 'Carbs (g)' },
            { key: 'fat' as const, label: 'Fat (g)' },
          ] as const
        ).map((m) => (
          <View key={m.key} style={styles.macrosCell}>
            <Text style={styles.macrosLabel}>{m.label}</Text>
            <TextField
              value={macros[m.key]}
              onChangeText={(v) => updateMacro(m.key, v)}
              keyboardType="decimal-pad"
              placeholder="enter"
              onFocus={scrollFieldIntoView}
            />
          </View>
        ))}
      </View>

      {entryIntent === 'want' ? (
        <>
          <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Photos (optional)</Text>
          <Text style={styles.stepHint}>
            Add a snapshot of the item — helps followers spot it on the shelf.
          </Text>
          <ReviewPhotoPicker
            photos={reviewPhotos}
            onPickLibrary={onPickLibrary}
            onTakePhoto={onTakePhoto}
            onRemovePhoto={onRemovePhoto}
            canAddMore={canAddMore}
          />
        </>
      ) : null}

      {catalogNote ? <Text style={styles.catalogNote}>{catalogNote}</Text> : null}
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

      <View style={styles.stepActions}>
        <Pressable onPress={onBack} hitSlop={8} disabled={submitting}>
          <Text style={styles.linkBack}>← Back to search</Text>
        </Pressable>
        {onSaveOnly ? (
          <Pressable
            onPress={onSaveOnly}
            disabled={submitting || !subcategoryId}
            hitSlop={8}
            style={styles.manualSaveOnlyBtn}>
            <Text style={styles.manualSaveOnlyText}>{submitting ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onSubmit}
          disabled={submitting || !subcategoryId}
          style={[styles.primaryBtn, (submitting || !subcategoryId) && styles.primaryBtnDisabled]}>
          <Text style={styles.primaryBtnText}>
            {submitting
              ? 'Saving…'
              : entryIntent === 'want'
                ? 'Save & post to feed'
                : 'Save & rank'}
          </Text>
        </Pressable>
      </View>
    </KeyboardFormScroll>
  );
}

function ComparePreviewStep({
  selected,
  placedRating,
  placedIndex,
  totalInCategory,
  aboveItem,
  aboveRating,
  belowItem,
  belowRating,
  tiedWithAbove,
  canTie,
  onToggleTie,
  onConfirm,
  onReopenCompare,
}: {
  selected: SelectedProduct;
  placedRating: number;
  placedIndex: number;
  totalInCategory: number;
  aboveItem: RankSnapshotItem | null;
  aboveRating: number | undefined;
  belowItem: RankSnapshotItem | null;
  belowRating: number | undefined;
  tiedWithAbove: boolean;
  canTie: boolean;
  onToggleTie: () => void;
  onConfirm: () => void;
  onReopenCompare: () => void;
}) {
  const headline = (() => {
    if (placedIndex === 0 && totalInCategory > 1) {
      return tiedWithAbove ? 'Tied for #1' : 'Your new #1';
    }
    if (placedIndex === totalInCategory - 1 && totalInCategory > 1) {
      return tiedWithAbove ? 'Tied for last' : 'Lowest in this category';
    }
    if (totalInCategory === 1) return 'Your first in this category';
    return `Placed ${placedIndex + 1} of ${totalInCategory}`;
  })();

  const scoreTone = { color: scoreDisplayColor(placedRating) };

  const tieCtaLabel = (() => {
    if (tiedWithAbove) {
      return `Break tie with ${aboveItem ? formatProductDisplayName(aboveItem.item) : 'item above'}`;
    }
    if (aboveItem) {
      return `Tie at ${(aboveRating ?? 10).toFixed(1)} with ${formatProductDisplayName(aboveItem.item)}`;
    }
    if (belowItem) {
      // No item above → user is at the very top; offer the tie-with-displaced #1 path.
      return `Tie at ${(belowRating ?? 10).toFixed(1)} with ${formatProductDisplayName(belowItem.item)}`;
    }
    return 'No item to tie with';
  })();

  return (
    <KeyboardFormScroll contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
      <ProductSummary selected={selected} />
      <Text style={[styles.stepHeading, { marginTop: 4 }]}>{headline}</Text>
      <View style={styles.previewScoreRow}>
        <Text style={[styles.previewScoreNum, scoreTone]}>{placedRating.toFixed(1)}</Text>
        <View style={styles.previewScoreBody}>
          <Text style={styles.previewScoreLabel}>Your score</Text>
          <Text style={styles.previewScoreSub}>
            {tiedWithAbove
              ? `Tied with the item above — both rate ${placedRating.toFixed(1)}.`
              : 'You can tweak this below or keep it.'}
          </Text>
        </View>
      </View>

      <View style={styles.previewNeighbors}>
        {aboveItem ? (
          <PreviewNeighborRow
            position="above"
            item={aboveItem}
            score={aboveRating}
            tiedWithSelected={tiedWithAbove}
          />
        ) : (
          <Text style={styles.previewNeighborEmpty}>Nothing ranked above this in the category.</Text>
        )}
        <View style={styles.previewSelfRow}>
          <AutoFitText style={styles.previewSelfTitle} numberOfLines={3} minimumFontScale={0.85}>
            {formatProductDisplayName(selected.name)}
          </AutoFitText>
          <Text style={[styles.previewSelfScore, scoreTone]}>{placedRating.toFixed(1)}</Text>
        </View>
        {belowItem ? (
          <PreviewNeighborRow position="below" item={belowItem} score={belowRating} />
        ) : (
          <Text style={styles.previewNeighborEmpty}>Nothing ranked below this in the category.</Text>
        )}
      </View>

      <Pressable
        onPress={onToggleTie}
        disabled={!canTie}
        style={[styles.previewTieBtn, !canTie && styles.primaryBtnDisabled]}>
        <Text style={styles.previewTieBtnText}>{tieCtaLabel}</Text>
      </Pressable>

      <Pressable onPress={onReopenCompare} style={styles.previewRerankBtn}>
        <Text style={styles.previewRerankText}>Re-rank from scratch</Text>
      </Pressable>

      <View style={styles.stepActions}>
        <View />
        <Pressable onPress={onConfirm} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Looks right — continue</Text>
        </Pressable>
      </View>
    </KeyboardFormScroll>
  );
}

function PreviewNeighborRow({
  position,
  item,
  score,
  tiedWithSelected,
}: {
  position: 'above' | 'below';
  item: RankSnapshotItem;
  score: number | undefined;
  tiedWithSelected?: boolean;
}) {
  return (
    <View style={styles.previewNeighborRow}>
      <Text style={styles.previewNeighborLabel}>
        {position === 'above' ? '↑' : '↓'} {position === 'above' ? 'Above' : 'Below'}
        {tiedWithSelected ? ' · tied' : ''}
      </Text>
      <AutoFitText style={styles.previewNeighborTitle} numberOfLines={3} minimumFontScale={0.85}>
        {formatProductDisplayName(item.item)}
      </AutoFitText>
      <AutoFitText style={styles.previewNeighborBrand} numberOfLines={2} minimumFontScale={0.85}>
        {formatProductDisplayName(item.brand)}
      </AutoFitText>
      {typeof score === 'number' ? (
        <Text style={[styles.previewNeighborScore, { color: scoreDisplayColor(score) }]}>
          {score.toFixed(1)}
        </Text>
      ) : null}
    </View>
  );
}

function NutritionStep({
  selected,
  macros,
  setMacros,
  autoFilledNote,
  selectedDietTags,
  onToggleDietTag,
  onBack,
  onContinue,
  snapshotLoading,
  errorMsg,
}: {
  selected: SelectedProduct;
  macros: { cal: string; protein: string; carbs: string; fat: string; servingLabel: string };
  setMacros: (next: { cal: string; protein: string; carbs: string; fat: string; servingLabel: string }) => void;
  /** True while the numbers shown were filled in automatically and the user has not changed them. */
  autoFilledNote?: boolean;
  selectedDietTags: string[];
  onToggleDietTag: (id: string) => void;
  onBack: () => void;
  onContinue: () => void;
  snapshotLoading: boolean;
  errorMsg?: string | null;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollFieldIntoView = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  };
  const updateField = (key: keyof typeof macros, value: string) => {
    setMacros({ ...macros, [key]: value });
  };
  return (
    <KeyboardFormScroll
      ref={scrollRef}
      contentContainerStyle={styles.stepContent}
      keyboardShouldPersistTaps="handled">
      <ProductSummary selected={selected} />
      <Text style={[styles.stepHeading, { marginTop: 0 }]}>Diet tags (optional)</Text>
      <DietTagChips selectedIds={selectedDietTags} onToggle={onToggleDietTag} macros={macros} />
      <Text style={[styles.stepHeading, { marginTop: 28 }]}>Nutrition (optional)</Text>
      <Text style={styles.stepHint}>
        Per serving — leave blank if you&apos;re not sure. We&apos;ll show pills on your rating
        when filled in.
      </Text>
      {autoFilledNote ? (
        <Text style={[styles.stepHint, { fontWeight: '600' }]}>
          Filled in automatically and may not match your package. Check it against the label.
        </Text>
      ) : null}
      <View style={styles.macrosGrid}>
        <View style={styles.macrosCell}>
          <Text style={styles.macrosLabel}>Calories</Text>
          <TextField
            value={macros.cal}
            onChangeText={(v) => updateField('cal', v)}
            keyboardType="decimal-pad"
            placeholder="enter"
          />
        </View>
        <View style={styles.macrosCell}>
          <Text style={styles.macrosLabel}>Protein (g)</Text>
          <TextField
            value={macros.protein}
            onChangeText={(v) => updateField('protein', v)}
            keyboardType="decimal-pad"
            placeholder="enter"
          />
        </View>
        <View style={styles.macrosCell}>
          <Text style={styles.macrosLabel}>Carbs (g)</Text>
          <TextField
            value={macros.carbs}
            onChangeText={(v) => updateField('carbs', v)}
            keyboardType="decimal-pad"
            placeholder="enter"
            onFocus={scrollFieldIntoView}
          />
        </View>
        <View style={styles.macrosCell}>
          <Text style={styles.macrosLabel}>Fat (g)</Text>
          <TextField
            value={macros.fat}
            onChangeText={(v) => updateField('fat', v)}
            keyboardType="decimal-pad"
            placeholder="enter"
            onFocus={scrollFieldIntoView}
          />
        </View>
      </View>
      <Text style={styles.macrosLabel}>Serving size</Text>
      <TextField
        value={macros.servingLabel}
        onChangeText={(v) => updateField('servingLabel', v)}
        placeholder="e.g. 1 bar (40g)"
        autoCapitalize="none"
        onFocus={scrollFieldIntoView}
      />
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
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
    </KeyboardFormScroll>
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
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
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
  placedRating,
  note,
  setNote,
  userId,
  reviewPhotos,
  existingPhotoUrls,
  onRemoveExistingPhoto,
  onPickLibrary,
  onTakePhoto,
  onRemovePhoto,
  canAddMore,
  errorMsg,
  onSubmit,
  onBack,
}: {
  selected: SelectedProduct;
  placedRating: number | null;
  note: string;
  setNote: (v: string) => void;
  userId: string | null;
  reviewPhotos: import('expo-image-picker').ImagePickerAsset[];
  existingPhotoUrls: string[];
  onRemoveExistingPhoto: (index: number) => void;
  onPickLibrary: () => void;
  onTakePhoto: () => void;
  onRemovePhoto: (index: number) => void;
  canAddMore: boolean;
  errorMsg: string | null;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <KeyboardFormScroll contentContainerStyle={styles.stepContent}>
      <ProductSummary selected={selected} />
      {typeof placedRating === 'number' ? (
        <View style={styles.noteScoreRow}>
          <Text style={styles.noteScoreLabel}>Your score</Text>
          <Text
            style={[
              styles.noteScoreValue,
              { color: scoreDisplayColor(placedRating) },
            ]}>
            {placedRating.toFixed(1)}
          </Text>
        </View>
      ) : null}
      <Text style={styles.stepHeading}>Add a note (optional)</Text>
      <Text style={styles.stepHint}>
        Tell your followers what you thought — tag friends with @username.
      </Text>
      <MentionNoteField
        value={note}
        onChangeText={setNote}
        userId={userId}
        placeholder="One of my favorites… / better than expected… / @friend check this out…"
        multiline
        autoCapitalize="sentences"
        textAlignVertical="top"
        inputStyle={styles.noteInput}
      />
      <Text style={[styles.stepHeading, { marginTop: 22 }]}>Photos (optional)</Text>
      <ReviewPhotoPicker
        photos={reviewPhotos}
        existingPhotoUrls={existingPhotoUrls}
        onRemoveExistingPhoto={onRemoveExistingPhoto}
        onPickLibrary={onPickLibrary}
        onTakePhoto={onTakePhoto}
        onRemovePhoto={onRemovePhoto}
        canAddMore={canAddMore}
        existingCount={existingPhotoUrls.length}
      />
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      <View style={styles.stepActions}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.linkBack}>← Back</Text>
        </Pressable>
        <Pressable onPress={onSubmit} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save ranking</Text>
        </Pressable>
      </View>
    </KeyboardFormScroll>
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
  headerSideBtn: {
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
  noteInput: {
    minHeight: 120,
    maxHeight: 240,
  },
  noteScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: BaggedColors.card,
    borderWidth: 1,
    borderColor: BaggedColors.border,
  },
  noteScoreLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.onBgMuted,
  },
  noteScoreValue: {
    fontFamily: BaggedFonts.display,
    fontSize: 28,
  },
  fieldLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.onBgMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },
  catalogNote: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.onBgMuted,
    lineHeight: 18,
    marginTop: 14,
  },
  manualSearchFooter: {
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BaggedColors.borderOnBg,
    marginTop: 8,
  },
  manualSearchTitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  manualSearchSub: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.onBgMuted,
    marginTop: 4,
    lineHeight: 16,
  },
  manualSearchBtn: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
  },
  manualSearchBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.accent,
  },
  manualIntro: {
    textAlign: 'left',
    marginBottom: 8,
  },
  stepHeading: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.onBg,
    marginBottom: 6,
    marginTop: 12,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  chipDisabled: {
    opacity: 0.45,
  },
  chipText: {
    fontFamily: BaggedFonts.display,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.onBgMuted,
  },
  chipTextActive: {
    color: BaggedColors.green,
  },
  intentCardScan: {
    marginTop: 12,
    padding: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BaggedColors.dark,
    backgroundColor: BaggedColors.white,
  },
  intentTitleScan: {
    fontFamily: BaggedFonts.display,
    fontSize: 17,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  intentSubScan: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    marginTop: 4,
  },
  intentCardDark: {
    marginTop: 16,
    padding: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BaggedColors.dark,
    backgroundColor: BaggedColors.dark,
  },
  intentCardAccent: {
    marginTop: 12,
    padding: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
    backgroundColor: BaggedColors.accentPale,
  },
  intentTitleLight: {
    fontFamily: BaggedFonts.display,
    fontSize: 17,
    fontWeight: '700',
    color: BaggedColors.green,
  },
  intentSubLight: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 4,
  },
  intentTitleAccent: {
    fontFamily: BaggedFonts.display,
    fontSize: 17,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  intentSubAccent: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    marginTop: 4,
  },
  dietChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: BaggedColors.borderOnBg,
    backgroundColor: 'transparent',
  },
  dietChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: BaggedColors.onBgMuted,
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
  manualSaveOnlyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  manualSaveOnlyText: {
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
    color: BaggedColors.green,
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
    borderColor: BaggedColors.border,
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
  previewScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
  },
  previewScoreNum: {
    fontFamily: BaggedFonts.display,
    fontSize: 44,
    lineHeight: 48,
  },
  previewScoreBody: {
    flex: 1,
    minWidth: 0,
  },
  previewScoreLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  previewScoreSub: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.dark,
    marginTop: 4,
    lineHeight: 18,
  },
  previewNeighbors: {
    marginTop: 16,
    gap: 8,
  },
  previewNeighborRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: BaggedColors.card,
    borderWidth: 1,
    borderColor: BaggedColors.border,
  },
  previewNeighborLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    width: 72,
  },
  previewNeighborTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.dark,
    lineHeight: 17,
  },
  previewNeighborBrand: {
    flex: 1,
    minWidth: 0,
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.muted,
    marginTop: 2,
    lineHeight: 14,
  },
  previewNeighborScore: {
    fontFamily: BaggedFonts.display,
    fontSize: 16,
    color: BaggedColors.dark,
  },
  previewNeighborEmpty: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.onBgMuted,
    fontStyle: 'italic',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  previewSelfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: BaggedColors.accentPale,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
  },
  previewSelfTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: BaggedFonts.display,
    fontSize: 15,
    color: BaggedColors.dark,
    lineHeight: 19,
  },
  previewSelfScore: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
  },
  previewTieBtn: {
    marginTop: 18,
    alignSelf: 'stretch',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: BaggedColors.dark,
    alignItems: 'center',
  },
  previewTieBtnText: {
    fontFamily: BaggedFonts.display,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.green,
  },
  previewRerankBtn: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 10,
  },
  previewRerankText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
    textDecorationLine: 'underline',
  },
});
