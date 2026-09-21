import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import { STORES } from '@/constants/grocery';
import { rowMatchesCategoryFilter as rowMatchesCategoryFilterImpl, rowMatchesTwoLevelCategoryFilter } from '@/lib/categories';
import {
  getParentCategoryById,
  getSubcategory,
  PARENT_CATEGORIES,
} from '@/constants/categories';

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
  'Protein/Supplements',
] as const;

export type FilterStore = typeof ALL_STORES | (typeof STORES)[number];
export type FilterCategory = (typeof FILTER_CATEGORIES)[number];

type DropdownMenu = 'store' | 'diet' | 'category';

type DropdownOption = {
  key: string;
  label: string;
};

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
  row: { category?: string | null; categories?: string[] | null; subcategory?: string | null },
  selected: FilterCategory
): boolean {
  if (!selected || selected === ALL_CATEGORIES) return true;
  return rowMatchesCategoryFilterImpl(row, selected);
}

export { rowMatchesTwoLevelCategoryFilter };

export function rowMatchesDietFilter(
  row: { diet_tags?: string[] | null },
  selectedDietId: string | null
): boolean {
  if (!selectedDietId) return true;
  const tags = Array.isArray(row.diet_tags) ? row.diet_tags : [];
  return tags.includes(selectedDietId);
}

/** Match when the row has any of the selected diet tag ids (OR). */
export function rowMatchesDietFilters(
  row: { diet_tags?: string[] | null; dietTags?: string[] | null },
  selectedIds: string[]
): boolean {
  if (!selectedIds.length) return true;
  const tags = Array.isArray(row.diet_tags)
    ? row.diet_tags
    : Array.isArray(row.dietTags)
      ? row.dietTags
      : [];
  return selectedIds.some((id) => tags.includes(id));
}

/** Count ranked rows per diet tag id (after store/search narrowing). */
export function dietTagCountsFromRows(
  rows: Array<{ diet_tags?: string[] | null; dietTags?: string[] | null }>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const tags = Array.isArray(row.diet_tags)
      ? row.diet_tags
      : Array.isArray(row.dietTags)
        ? row.dietTags
        : [];
    for (const raw of tags) {
      const id = String(raw ?? '').trim();
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

function categoryLabel(category: FilterCategory): string {
  if (category === ALL_CATEGORIES) return 'All Categories';
  if (category === 'Meat & Seafood') {
    return getParentCategoryById('meat-seafood')?.label ?? 'Meat, Seafood, & Alt';
  }
  return category;
}

function dietLabel(dietFilter: string | null): string {
  if (!dietFilter) return 'All Diets';
  return DIET_TAGS.find((t) => t.id === dietFilter)?.label ?? dietFilter;
}

export function twoLevelCategoryFilterLabel(
  parentCategoryId: string | null | undefined,
  subcategoryId: string | null | undefined
): string {
  if (subcategoryId) {
    return getSubcategory(subcategoryId)?.label ?? subcategoryId;
  }
  if (parentCategoryId) {
    return getParentCategoryById(parentCategoryId)?.label ?? parentCategoryId;
  }
  return 'All Categories';
}

type TwoLevelCategorySheetProps = {
  visible: boolean;
  parentCategoryId: string | null;
  subcategoryId: string | null;
  onSelect: (parentId: string | null, subcategoryId: string | null) => void;
  onClose: () => void;
};

export function TwoLevelCategorySheet({
  visible,
  parentCategoryId,
  subcategoryId,
  onSelect,
  onClose,
}: TwoLevelCategorySheetProps) {
  const allActive = !parentCategoryId && !subcategoryId;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>Category</Text>
          <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
            <Pressable
              onPress={() => {
                onSelect(null, null);
                onClose();
              }}
              style={({ pressed }) => [
                styles.sheetOption,
                allActive && styles.sheetOptionActive,
                pressed && styles.sheetOptionPressed,
              ]}>
              <Text style={[styles.sheetOptionText, allActive && styles.sheetOptionTextActive]}>
                All Categories
              </Text>
              {allActive ? (
                <Ionicons name="checkmark" size={18} color={BaggedColors.accent} />
              ) : null}
            </Pressable>
            {PARENT_CATEGORIES.map((parent) => {
              const parentActive = parentCategoryId === parent.id && !subcategoryId;
              return (
                <View key={parent.id}>
                  <Pressable
                    onPress={() => {
                      onSelect(parent.id, null);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.sheetOption,
                      styles.sheetParentOption,
                      parentActive && styles.sheetOptionActive,
                      pressed && styles.sheetOptionPressed,
                    ]}>
                    <Text
                      style={[styles.sheetParentText, parentActive && styles.sheetOptionTextActive]}
                      numberOfLines={2}>
                      {parent.label}
                    </Text>
                    {parentActive ? (
                      <Ionicons name="checkmark" size={18} color={BaggedColors.accent} />
                    ) : null}
                  </Pressable>
                  {parent.subcategories.map((sub) => {
                    const active = subcategoryId === sub.id;
                    return (
                      <Pressable
                        key={sub.id}
                        onPress={() => {
                          onSelect(parent.id, sub.id);
                          onClose();
                        }}
                        style={({ pressed }) => [
                          styles.sheetOption,
                          styles.sheetSubOption,
                          active && styles.sheetOptionActive,
                          pressed && styles.sheetOptionPressed,
                        ]}>
                        <Text
                          style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}
                          numberOfLines={2}>
                          {sub.label}
                        </Text>
                        {active ? (
                          <Ionicons name="checkmark" size={18} color={BaggedColors.accent} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type TwoLevelCategoryTriggerProps = {
  parentCategoryId: string | null;
  subcategoryId: string | null;
  onPress: () => void;
  chips?: boolean;
};

export function TwoLevelCategoryTrigger({
  parentCategoryId,
  subcategoryId,
  onPress,
  chips = false,
}: TwoLevelCategoryTriggerProps) {
  const active = parentCategoryId != null || subcategoryId != null;
  const label = twoLevelCategoryFilterLabel(parentCategoryId, subcategoryId);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={chips ? [styles.chip, active && styles.chipActive] : styles.dropdownTrigger}>
      <Text
        style={[
          chips ? styles.chipText : styles.dropdownValue,
          chips && active && styles.chipTextActive,
          !chips && styles.categoryTriggerValue,
        ]}
        numberOfLines={1}>
        {label}
      </Text>
      <Ionicons
        name="chevron-down"
        size={chips ? 14 : 16}
        color={chips && active ? BaggedColors.green : BaggedColors.dark}
      />
    </Pressable>
  );
}

type FilterBarProps = {
  store: FilterStore;
  category: FilterCategory;
  onStoreChange: (store: FilterStore) => void;
  onCategoryChange: (category: FilterCategory) => void;
  /** Two-level parent → subcategory chips (feed / my list). */
  useTwoLevelCategories?: boolean;
  parentCategoryId?: string | null;
  subcategoryId?: string | null;
  onParentCategoryChange?: (parentId: string | null) => void;
  onSubcategoryChange?: (subcategoryId: string | null) => void;
  /** When true, shows diet filter (chip strip or dropdown on feed). */
  showDietRow?: boolean;
  dietFilter?: string | null;
  onDietChange?: (dietId: string | null) => void;
  /** `text` / `chips` = horizontal pills; `dropdown` = compact menus (feed). */
  variant?: 'text' | 'chips' | 'dropdown';
  /** Override store pills (e.g. alphabetized list with All Stores first). */
  storeOptions?: readonly FilterStore[];
};

type FilterDropdownTriggerProps = {
  label: string;
  value: string;
  open: boolean;
  onPress: () => void;
};

function FilterDropdownTrigger({ label, value, open, onPress }: FilterDropdownTriggerProps) {
  return (
    <View style={styles.dropdownField}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.dropdownTrigger, pressed && styles.dropdownTriggerPressed]}>
        <Text style={styles.dropdownValue} numberOfLines={1}>
          {value}
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={BaggedColors.dark}
        />
      </Pressable>
    </View>
  );
}

type FilterDropdownSheetProps = {
  visible: boolean;
  title: string;
  options: DropdownOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onClose: () => void;
};

function FilterDropdownSheet({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
}: FilterDropdownSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
            {options.map((option) => {
              const active = option.key === selectedKey;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => {
                    onSelect(option.key);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.sheetOption,
                    active && styles.sheetOptionActive,
                    pressed && styles.sheetOptionPressed,
                  ]}>
                  <Text
                    style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}
                    numberOfLines={2}>
                    {option.label}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark" size={18} color={BaggedColors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FilterBarDropdowns({
  store,
  category,
  onStoreChange,
  onCategoryChange,
  useTwoLevelCategories,
  parentCategoryId,
  subcategoryId,
  onParentCategoryChange,
  onSubcategoryChange,
  showDietRow,
  dietFilter,
  onDietChange,
  storeOptions,
}: FilterBarProps) {
  const [openMenu, setOpenMenu] = useState<DropdownMenu | null>(null);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const storePills = storeOptions ?? [ALL_STORES, ...STORES];

  const storeDropdownOptions = useMemo<DropdownOption[]>(
    () => storePills.map((option) => ({ key: option, label: option })),
    [storePills]
  );

  const dietDropdownOptions = useMemo<DropdownOption[]>(
    () => [
      { key: '__all__', label: 'All Diets' },
      ...DIET_TAGS.map((tag) => ({ key: tag.id, label: tag.label })),
    ],
    []
  );

  const categoryDropdownOptions = useMemo<DropdownOption[]>(
    () => FILTER_CATEGORIES.map((option) => ({ key: option, label: categoryLabel(option) })),
    []
  );

  const sheetProps = useMemo(() => {
    if (openMenu === 'store') {
      return {
        title: 'Store',
        options: storeDropdownOptions,
        selectedKey: store,
        onSelect: (key: string) => onStoreChange(key as FilterStore),
      };
    }
    if (openMenu === 'diet') {
      return {
        title: 'Diet',
        options: dietDropdownOptions,
        selectedKey: dietFilter ?? '__all__',
        onSelect: (key: string) => onDietChange?.(key === '__all__' ? null : key),
      };
    }
    if (openMenu === 'category' && !useTwoLevelCategories) {
      return {
        title: 'Category',
        options: categoryDropdownOptions,
        selectedKey: category,
        onSelect: (key: string) => onCategoryChange(key as FilterCategory),
      };
    }
    return null;
  }, [
    openMenu,
    store,
    category,
    dietFilter,
    useTwoLevelCategories,
    storeDropdownOptions,
    dietDropdownOptions,
    categoryDropdownOptions,
    onStoreChange,
    onCategoryChange,
    onDietChange,
  ]);

  return (
    <View style={styles.container}>
      <View style={styles.dropdownRow}>
        <FilterDropdownTrigger
          label="Store"
          value={store}
          open={openMenu === 'store'}
          onPress={() => setOpenMenu((prev) => (prev === 'store' ? null : 'store'))}
        />
        {showDietRow && onDietChange ? (
          <FilterDropdownTrigger
            label="Diet"
            value={dietLabel(dietFilter ?? null)}
            open={openMenu === 'diet'}
            onPress={() => setOpenMenu((prev) => (prev === 'diet' ? null : 'diet'))}
          />
        ) : null}
        {useTwoLevelCategories && onParentCategoryChange ? (
          <View style={styles.dropdownField}>
            <Text style={styles.dropdownLabel}>Category</Text>
            <TwoLevelCategoryTrigger
              parentCategoryId={parentCategoryId ?? null}
              subcategoryId={subcategoryId ?? null}
              onPress={() => setCategorySheetOpen(true)}
            />
          </View>
        ) : (
          <FilterDropdownTrigger
            label="Category"
            value={categoryLabel(category)}
            open={openMenu === 'category'}
            onPress={() => setOpenMenu((prev) => (prev === 'category' ? null : 'category'))}
          />
        )}
      </View>

      {sheetProps ? (
        <FilterDropdownSheet
          visible={openMenu != null}
          title={sheetProps.title}
          options={sheetProps.options}
          selectedKey={sheetProps.selectedKey}
          onSelect={sheetProps.onSelect}
          onClose={() => setOpenMenu(null)}
        />
      ) : null}
      {useTwoLevelCategories && onParentCategoryChange ? (
        <TwoLevelCategorySheet
          visible={categorySheetOpen}
          parentCategoryId={parentCategoryId ?? null}
          subcategoryId={subcategoryId ?? null}
          onSelect={(parentId, subId) => {
            onParentCategoryChange(parentId);
            onSubcategoryChange?.(subId);
          }}
          onClose={() => setCategorySheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

export function FilterBar({
  store,
  category,
  onStoreChange,
  onCategoryChange,
  useTwoLevelCategories = false,
  parentCategoryId = null,
  subcategoryId = null,
  onParentCategoryChange,
  onSubcategoryChange,
  showDietRow = false,
  dietFilter = null,
  onDietChange,
  variant = 'text',
  storeOptions,
}: FilterBarProps) {
  if (variant === 'dropdown') {
    return (
      <FilterBarDropdowns
        store={store}
        category={category}
        onStoreChange={onStoreChange}
        onCategoryChange={onCategoryChange}
        useTwoLevelCategories={useTwoLevelCategories}
        parentCategoryId={parentCategoryId}
        subcategoryId={subcategoryId}
        onParentCategoryChange={onParentCategoryChange}
        onSubcategoryChange={onSubcategoryChange}
        showDietRow={showDietRow}
        dietFilter={dietFilter}
        onDietChange={onDietChange}
        storeOptions={storeOptions}
      />
    );
  }

  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const chips = variant === 'chips';
  const storePills = storeOptions ?? [ALL_STORES, ...STORES];
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Shopping at</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, chips && styles.chipRowGap]}>
        {storePills.map((option) => {
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.row,
              styles.rowSpaced,
              styles.dietRow,
              chips && styles.chipRowGap,
            ]}>
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
      {useTwoLevelCategories && onParentCategoryChange ? (
        <View style={[styles.row, styles.rowSpaced, chips && styles.chipRowGap, styles.categoryTriggerRow]}>
          <TwoLevelCategoryTrigger
            parentCategoryId={parentCategoryId ?? null}
            subcategoryId={subcategoryId ?? null}
            onPress={() => setCategorySheetOpen(true)}
            chips={chips}
          />
        </View>
      ) : (
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
                {categoryLabel(option)}
              </Text>
              {!chips && active ? <View style={styles.activeUnderline} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      )}
      {useTwoLevelCategories && onParentCategoryChange ? (
        <TwoLevelCategorySheet
          visible={categorySheetOpen}
          parentCategoryId={parentCategoryId ?? null}
          subcategoryId={subcategoryId ?? null}
          onSelect={(parentId, subId) => {
            onParentCategoryChange(parentId);
            onSubcategoryChange?.(subId);
          }}
          onClose={() => setCategorySheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  dropdownRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dropdownField: {
    flex: 1,
    minWidth: 0,
  },
  dropdownLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 9,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
  },
  dropdownTriggerPressed: {
    opacity: 0.85,
  },
  dropdownValue: {
    flex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: BaggedColors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.dark,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  sheetList: {
    paddingHorizontal: 12,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
  },
  sheetOptionActive: {
    backgroundColor: BaggedColors.accentPaleActive,
  },
  sheetOptionPressed: {
    opacity: 0.85,
  },
  sheetOptionText: {
    flex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    color: BaggedColors.dark,
  },
  sheetOptionTextActive: {
    fontWeight: '700',
    color: BaggedColors.accent,
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
  dietRow: {
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
    color: BaggedColors.green,
    fontWeight: '700',
  },
  categoryTriggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryTriggerValue: {
    flex: 1,
  },
  sheetParentOption: {
    paddingTop: 16,
  },
  sheetParentText: {
    flex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sheetSubOption: {
    paddingLeft: 24,
  },
});
