import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { KeyboardFormScroll } from '@/components/bagged/keyboard-form-scroll';
import { scoreDisplayColor } from '@/components/bagged/score-badge';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  isLegitimateTraderJoesBrand,
  STORES,
  TRADER_JOES_STORE,
} from '@/constants/grocery';
import type { SearchProductRow } from '@/lib/data';
import { formatProductDisplayName } from '@/lib/format';
import { CATEGORIES, type Category, type Vibe } from '@/lib/ranking';
import { SubcategoryPickerGrid } from '@/components/bagged/subcategory-picker-grid';
import { getSubcategory } from '@/constants/categories';

export type RatingFlowSelectedProduct = {
  name: string;
  brand: string;
  descriptionKey: string;
  /** Search hit when the user picked from results — pins FatSecret macro autofill. */
  searchRow?: SearchProductRow | null;
};

export type RatingFlowRankSnapshotItem = {
  id: string | number;
  item: string;
  brand: string;
  store: string;
  category: Category | string;
  subcategory?: string;
  vibe: Vibe;
  rating?: number;
  rank_position?: number | null;
  /** True when this item shares a rating with the row immediately above it. */
  tiedAbove?: boolean;
};

export const RATING_FLOW_VIBE_OPTIONS: { id: Vibe; label: string; subtitle: string }[] = [
  { id: 'liked', label: 'I loved it', subtitle: 'Top of the list' },
  { id: 'fine', label: 'It was fine', subtitle: 'Middle of the road' },
  { id: 'meh', label: "Didn't like it", subtitle: 'Better avoided' },
];

export function ProductSummary({
  selected,
  subtitle,
}: {
  selected: RatingFlowSelectedProduct;
  subtitle?: string;
}) {
  return (
    <View style={styles.summary}>
      <AutoFitText style={styles.summaryName} numberOfLines={4} minimumFontScale={0.82}>
        {formatProductDisplayName(selected.name)}
      </AutoFitText>
      {selected.brand ? (
        <AutoFitText style={styles.summaryBrand} numberOfLines={2} minimumFontScale={0.85}>
          {formatProductDisplayName(selected.brand)}
        </AutoFitText>
      ) : null}
      {subtitle ? <Text style={styles.summarySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function SubcategoryStep({
  selected,
  subcategoryId,
  setSubcategoryId,
  curatedSubcategoryId,
  curatedLoading,
  onContinue,
  onBack,
  errorMsg,
}: {
  selected: RatingFlowSelectedProduct;
  subcategoryId: string | null;
  setSubcategoryId: (id: string | null) => void;
  curatedSubcategoryId: string | null;
  curatedLoading: boolean;
  onContinue: () => void;
  onBack: () => void;
  errorMsg?: string | null;
}) {
  const curatedLabel = curatedSubcategoryId
    ? getSubcategory(curatedSubcategoryId)?.label ?? curatedSubcategoryId
    : null;
  const canConfirmCurated =
    curatedSubcategoryId != null && subcategoryId === curatedSubcategoryId;
  const [showManualPicker, setShowManualPicker] = useState(false);

  useEffect(() => {
    setShowManualPicker(false);
  }, [selected.descriptionKey, curatedSubcategoryId]);

  const curatedOnlySelection =
    curatedLabel != null &&
    !showManualPicker &&
    subcategoryId === curatedSubcategoryId;
  const showPicker = !curatedOnlySelection;

  const chooseDifferentCategory = () => {
    setShowManualPicker(true);
    setSubcategoryId(null);
  };

  return (
    <KeyboardFormScroll contentContainerStyle={styles.stepContent}>
      <ProductSummary selected={selected} />
      <Text style={styles.stepHeading}>What type of product is this?</Text>
      <Text style={styles.stepHint}>
        We&apos;ll only compare it to other items in this subcategory.
      </Text>

      {curatedLoading ? (
        <View style={styles.centeredInline}>
          <ActivityIndicator color={BaggedColors.onBg} />
        </View>
      ) : curatedLabel ? (
        <View style={styles.curatedConfirmBlock}>
          <Text style={styles.stepHint}>From our catalog:</Text>
          <Pressable
            onPress={() => setSubcategoryId(curatedSubcategoryId!)}
            style={[styles.curatedConfirmBtn, canConfirmCurated && styles.curatedConfirmBtnActive]}>
            <Text
              style={[
                styles.curatedConfirmText,
                canConfirmCurated && styles.curatedConfirmTextActive,
              ]}>
              {curatedLabel}
            </Text>
          </Pressable>
          {curatedOnlySelection ? (
            <Pressable onPress={chooseDifferentCategory} hitSlop={8} style={styles.chooseDifferentBtn}>
              <Text style={styles.chooseDifferentText}>Wrong category? Choose another</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showPicker ? (
        <SubcategoryPickerGrid
          layout="stepped"
          selectedSubcategoryId={subcategoryId}
          onSelect={setSubcategoryId}
        />
      ) : null}

      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      <View style={styles.stepActions}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.linkBack}>← Back</Text>
        </Pressable>
        <Pressable
          onPress={onContinue}
          disabled={!subcategoryId}
          style={[styles.primaryBtn, !subcategoryId && styles.primaryBtnDisabled]}>
          <Text style={styles.primaryBtnText}>Continue</Text>
        </Pressable>
      </View>
    </KeyboardFormScroll>
  );
}

export function CategoryStep({
  selected,
  category,
  setCategory,
  onContinue,
  onBack,
  errorMsg,
}: {
  selected: RatingFlowSelectedProduct;
  category: Category | null;
  setCategory: (c: Category) => void;
  onContinue: () => void;
  onBack: () => void;
  errorMsg?: string | null;
}) {
  return (
    <KeyboardFormScroll contentContainerStyle={styles.stepContent}>
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
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
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
    </KeyboardFormScroll>
  );
}

export function VibeStep({
  selected,
  category,
  subcategoryLabel,
  vibe,
  setVibe,
  selectedStores,
  onToggleStore,
  showStores = true,
  onBack,
  onContinue,
  snapshotLoading,
  errorMsg,
  continueLabel = 'Start comparing',
}: {
  selected: RatingFlowSelectedProduct;
  category: Category | null;
  subcategoryLabel?: string | null;
  vibe: Vibe | null;
  setVibe: (v: Vibe) => void;
  selectedStores: string[];
  onToggleStore: (s: string) => void;
  showStores?: boolean;
  onBack: () => void;
  onContinue: () => void;
  snapshotLoading: boolean;
  errorMsg?: string | null;
  continueLabel?: string;
}) {
  const tjOnly = isLegitimateTraderJoesBrand(selected.brand, { assumePlaceholder: false });
  return (
    <KeyboardFormScroll contentContainerStyle={styles.stepContent}>
      <ProductSummary selected={selected} subtitle={subcategoryLabel ?? category ?? undefined} />
      <Text style={styles.stepHeading}>How was it?</Text>
      <View style={styles.vibeColumn}>
        {RATING_FLOW_VIBE_OPTIONS.map((opt) => {
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
      {showStores ? (
        <>
          <Text style={[styles.stepHeading, { marginTop: 28 }]}>Where&apos;d you buy it?</Text>
          <Text style={styles.stepHint}>
            Optional — select every store where you find this item.
          </Text>
          {tjOnly ? (
            <Text style={styles.stepHint}>
              Trader Joe&apos;s brand items are only sold at Trader Joe&apos;s.
            </Text>
          ) : null}
          <View style={styles.chipGrid}>
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
        </>
      ) : null}
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      <View style={styles.stepActions}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.linkBack}>← Back</Text>
        </Pressable>
        <Pressable
          onPress={onContinue}
          disabled={!vibe || snapshotLoading}
          style={[styles.primaryBtn, (!vibe || snapshotLoading) && styles.primaryBtnDisabled]}>
          <Text style={styles.primaryBtnText}>
            {snapshotLoading ? 'Loading…' : continueLabel}
          </Text>
        </Pressable>
      </View>
    </KeyboardFormScroll>
  );
}

export function CompareStep({
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
  showTieOption = true,
  compareCaption,
}: {
  comparisons: number;
  totalComparisons: number;
  comparisonItem: RatingFlowRankSnapshotItem | undefined;
  comparisonScore: number | undefined;
  selected: RatingFlowSelectedProduct;
  onBetter: () => void;
  onWorse: () => void;
  onTie: () => void;
  onUndo: () => void;
  canUndo: boolean;
  showTieOption?: boolean;
  compareCaption?: string;
}) {
  if (!comparisonItem) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={BaggedColors.onBg} />
      </View>
    );
  }
  const progress =
    totalComparisons === 0 ? 100 : Math.min(100, Math.round((comparisons / totalComparisons) * 100));
  return (
    <View style={styles.stepFlex}>
      <View style={styles.compareWrapper}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.compareCaption}>
          {compareCaption ??
            `Which do you prefer? Tap the winner — it ranks higher. · Comparison ${comparisons + 1}`}
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
            brand={comparisonItem.brand}
            score={comparisonScore}
            onPress={onWorse}
          />
        </View>

        {showTieOption ? (
          <Pressable onPress={onTie} style={styles.tieBtn} hitSlop={8}>
            <Text style={styles.tieBtnText}>Too tough — tie at the same score</Text>
          </Pressable>
        ) : null}

        {canUndo ? (
          <Pressable onPress={onUndo} style={styles.undoBtn} hitSlop={8}>
            <Text style={styles.undoText}>Undo last comparison</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function CompareCard({
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
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.compareCard, pressed && styles.cardPressed]}>
      <Text style={styles.compareLabel}>{label}</Text>
      <View style={styles.compareCardBody}>
        <AutoFitText style={styles.compareTitle} numberOfLines={4} minimumFontScale={0.8}>
          {formatProductDisplayName(title)}
        </AutoFitText>
        <AutoFitText style={styles.compareBrand} numberOfLines={2} minimumFontScale={0.85}>
          {formatProductDisplayName(brand)}
        </AutoFitText>
        <View style={styles.compareScoreSlot}>
          {typeof score === 'number' ? (
            <Text
              style={[
                styles.compareScoreNum,
                typeof score === 'number' && { color: scoreDisplayColor(score) },
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

const styles = StyleSheet.create({
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
  centeredInline: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  curatedConfirmBlock: {
    gap: 8,
    marginBottom: 16,
  },
  curatedConfirmBtn: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    backgroundColor: BaggedColors.card,
  },
  curatedConfirmBtnActive: {
    borderColor: BaggedColors.dark,
    backgroundColor: BaggedColors.dark,
  },
  curatedConfirmText: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.dark,
    textAlign: 'center',
  },
  curatedConfirmTextActive: {
    color: BaggedColors.green,
  },
  chooseDifferentBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  chooseDifferentText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.accent,
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
    backgroundColor: BaggedColors.accentPaleActive,
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
    color: BaggedColors.green,
    fontWeight: '700',
    fontSize: 14,
  },
  errorText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.accent,
    marginTop: 12,
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
    borderColor: BaggedColors.border,
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
    flexGrow: 1,
    flexShrink: 1,
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
    flexShrink: 1,
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
});
