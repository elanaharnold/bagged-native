import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import { STORES } from '@/constants/grocery';

/** Sentinels matching the web app's filter labels. */
export const ALL_STORES = 'All Stores';
export const ALL_CATEGORIES = 'All';

export const FILTER_CATEGORIES = [
  ALL_CATEGORIES,
  'Snacks',
  'Dairy',
  'Dairy Alt',
  'Meat & Seafood',
  'Spices',
  'Condiments',
  'Produce',
  'Frozen',
  'Beverages',
  'Alcohol',
] as const;

export type FilterStore = typeof ALL_STORES | (typeof STORES)[number];
export type FilterCategory = (typeof FILTER_CATEGORIES)[number];

/**
 * Returns true when `row` matches the picked store. Mirrors web
 * `rowMatchesSelectedStore`: tolerant to either `stores[]` or single `store`.
 */
export function rowMatchesStoreFilter(
  row: { store?: string | null; stores?: string[] | null },
  selected: FilterStore
): boolean {
  if (!selected || selected === ALL_STORES) return true;
  const want = selected.trim().toLowerCase();
  const list = Array.isArray(row.stores) && row.stores.length ? row.stores : row.store ? [row.store] : [];
  return list.some((s) => String(s).trim().toLowerCase() === want);
}

export function rowMatchesCategoryFilter(
  row: { category?: string | null },
  selected: FilterCategory
): boolean {
  if (!selected || selected === ALL_CATEGORIES) return true;
  return String(row.category ?? '').trim() === selected;
}

export function rowMatchesDietFilter(
  row: { diet_tags?: string[] | null },
  selectedDietId: string | null
): boolean {
  if (!selectedDietId) return true;
  const tags = Array.isArray(row.diet_tags) ? row.diet_tags : [];
  return tags.includes(selectedDietId);
}

type FilterBarProps = {
  store: FilterStore;
  category: FilterCategory;
  onStoreChange: (store: FilterStore) => void;
  onCategoryChange: (category: FilterCategory) => void;
  /** When true, shows an "All Diets" + diet-tag strip (matches web feed). */
  showDietRow?: boolean;
  dietFilter?: string | null;
  onDietChange?: (dietId: string | null) => void;
  /** `text` = feed-style underlined chips (matches web feed). `chips` = filled outline pills (matches web My List). */
  variant?: 'text' | 'chips';
};

export function FilterBar({
  store,
  category,
  onStoreChange,
  onCategoryChange,
  showDietRow = false,
  dietFilter = null,
  onDietChange,
  variant = 'text',
}: FilterBarProps) {
  const chips = variant === 'chips';
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Shopping at</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, chips && styles.chipRowGap]}>
        {[ALL_STORES, ...STORES].map((option) => {
          const active = store === option;
          return (
            <Pressable
              key={option}
              onPress={() => onStoreChange(option as FilterStore)}
              hitSlop={6}
              style={chips ? [styles.chip, active && styles.chipActive] : styles.pill}>
              <Text
                style={[
                  styles.pillText,
                  active && styles.pillTextActive,
                  chips && styles.chipText,
                  chips && active && styles.chipTextActive,
                ]}>
                {option}
              </Text>
              {!chips && active ? <View style={styles.activeUnderline} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {showDietRow && onDietChange ? (
        <>
          <Text style={[styles.eyebrow, styles.dietEyebrow]}>Diet</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.row, styles.rowSpaced, chips && styles.chipRowGap]}>
            {(['__all__', ...DIET_TAGS.map((t) => t.id)] as const).map((id) => {
              const active = id === '__all__' ? !dietFilter : dietFilter === id;
              const label =
                id === '__all__' ? 'All Diets' : DIET_TAGS.find((t) => t.id === id)?.label ?? id;
              return (
                <Pressable
                  key={id}
                  onPress={() => {
                    if (id === '__all__') {
                      onDietChange(null);
                      return;
                    }
                    onDietChange(dietFilter === id ? null : id);
                  }}
                  hitSlop={6}
                  style={chips ? [styles.chip, active && styles.chipActive] : styles.pill}>
                  <Text
                    style={[
                      styles.pillText,
                      active && styles.pillTextActive,
                      chips && styles.chipText,
                      chips && active && styles.chipTextActive,
                    ]}>
                    {label}
                  </Text>
                  {!chips && active ? <View style={styles.activeUnderline} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, styles.rowSpaced, chips && styles.chipRowGap]}>
        {FILTER_CATEGORIES.map((option) => {
          const active = category === option;
          return (
            <Pressable
              key={option}
              onPress={() => onCategoryChange(option)}
              hitSlop={6}
              style={chips ? [styles.chip, active && styles.chipActive] : styles.pill}>
              <Text
                style={[
                  styles.pillText,
                  active && styles.pillTextActive,
                  chips && styles.chipText,
                  chips && active && styles.chipTextActive,
                ]}>
                {option}
              </Text>
              {!chips && active ? <View style={styles.activeUnderline} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 6,
  },
  eyebrow: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  row: {
    paddingRight: 24,
    gap: 18,
  },
  rowSpaced: {
    marginTop: 6,
  },
  dietEyebrow: {
    marginTop: 10,
  },
  pill: {
    paddingVertical: 4,
    alignItems: 'center',
  },
  pillText: {
    fontFamily: BaggedFonts.display,
    fontSize: 13,
    fontWeight: '500',
    color: BaggedColors.muted,
  },
  pillTextActive: {
    color: BaggedColors.dark,
    fontWeight: '700',
  },
  activeUnderline: {
    marginTop: 4,
    height: 2,
    width: '100%',
    backgroundColor: BaggedColors.dark,
    borderRadius: 1,
  },
  chipRowGap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 24,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: 'transparent',
  },
  chipActive: {
    backgroundColor: BaggedColors.dark,
    borderColor: BaggedColors.dark,
  },
  chipText: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
