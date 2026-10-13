import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { SubcategoryPickerGrid } from '@/components/bagged/subcategory-picker-grid';
import { StoreSearchChips } from '@/components/bagged/store-search-chips';
import { DIET_TAGS } from '@/constants/diet-tags';
import {
  isLegitimateTraderJoesBrand,
  mergeStoresForBrand,
  TRADER_JOES_STORE,
} from '@/constants/grocery';
import type { RateMacroFormState } from '@/lib/data';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';

export type ProductMetadataEditorMode = 'stores' | 'diet' | 'macros' | 'categories' | 'identity';

const EMPTY_MACROS: RateMacroFormState = {
  cal: '',
  protein: '',
  carbs: '',
  fat: '',
  servingLabel: '',
};

type ProductMetadataEditorModalProps = {
  visible: boolean;
  mode: ProductMetadataEditorMode;
  itemTitle: string;
  brand: string;
  stores: string[];
  dietTags: string[];
  categories: string[];
  subcategoryId?: string | null;
  macros: RateMacroFormState;
  /** Staff-verified catalog nutrition — macros editor is read-only. */
  macrosLocked?: boolean;
  saving?: boolean;
  onClose: () => void;
  onSave: (next: {
    stores: string[];
    dietTags: string[];
    categories?: string[];
    subcategory?: string;
    newItem?: string;
    newBrand?: string;
    macros?: RateMacroFormState;
  }) => void;
};

export function ProductMetadataEditorModal({
  visible,
  mode,
  itemTitle,
  brand,
  stores,
  dietTags,
  categories,
  subcategoryId = null,
  macros,
  macrosLocked = false,
  saving = false,
  onClose,
  onSave,
}: ProductMetadataEditorModalProps) {
  const [draftStores, setDraftStores] = useState<string[]>(stores);
  const [draftDietTags, setDraftDietTags] = useState<string[]>(dietTags);
  const [draftSubcategoryId, setDraftSubcategoryId] = useState<string | null>(subcategoryId);
  const [draftItemTitle, setDraftItemTitle] = useState(itemTitle);
  const [draftBrand, setDraftBrand] = useState(brand);
  const [draftMacros, setDraftMacros] = useState<RateMacroFormState>(macros);
  const scrollRef = useRef<ScrollView>(null);
  const keyboardHeight = useKeyboardHeight();

  useEffect(() => {
    if (!visible) return;
    setDraftStores(mergeStoresForBrand(brand, stores));
    setDraftDietTags(dietTags);
    setDraftSubcategoryId(subcategoryId);
    setDraftItemTitle(itemTitle);
    setDraftBrand(brand);
    setDraftMacros(macros);
  }, [visible, stores, dietTags, subcategoryId, itemTitle, brand, macros]);

  const tjOnly = isLegitimateTraderJoesBrand(brand, { assumePlaceholder: false });

  const toggleStore = (store: string) => {
    if (tjOnly && store !== TRADER_JOES_STORE) return;
    setDraftStores((prev) =>
      prev.includes(store) ? prev.filter((s) => s !== store) : [...prev, store]
    );
  };

  const toggleDietTag = (id: string) => {
    setDraftDietTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const setMacroField =
    (field: keyof RateMacroFormState) => (value: string) => {
      setDraftMacros((prev) => ({ ...prev, [field]: value }));
    };

  const title =
    mode === 'stores'
      ? 'Stores'
      : mode === 'diet'
        ? 'Diet tags'
        : mode === 'categories'
          ? 'Category'
          : mode === 'identity'
            ? 'Name & brand'
            : 'Nutrition';
  const subtitle =
    mode === 'stores'
      ? 'Tap to select every store that sells this item. Changes apply everywhere for this product.'
      : mode === 'diet'
        ? 'Tap to select all diet tags that apply. Changes apply everywhere for this product.'
        : mode === 'categories'
          ? 'Choose the subcategory that best fits this product. Changes apply everywhere.'
          : mode === 'identity'
            ? 'Update the product title and brand for everyone. Leave brand empty if unknown.'
            : macrosLocked
              ? 'This product has staff-verified nutrition — macros cannot be edited here.'
              : 'Enter per-serving nutrition. Changes apply everywhere for this product.';

  const handleSave = () => {
    if (mode === 'macros') {
      onSave({ stores, dietTags, categories, macros: draftMacros });
      return;
    }
    if (mode === 'categories') {
      onSave({ stores, dietTags, subcategory: draftSubcategoryId ?? undefined });
      return;
    }
    if (mode === 'identity') {
      onSave({
        stores,
        dietTags,
        categories,
        newItem: draftItemTitle.trim(),
        newBrand: draftBrand.trim(),
      });
      return;
    }
    onSave({ stores: draftStores, dietTags: draftDietTags, categories });
  };

  const keyboardOpen = keyboardHeight > 0;
  const sheetKeyboardStyle =
    keyboardOpen && (mode === 'identity' || mode === 'macros')
      ? { marginBottom: keyboardHeight }
      : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, sheetKeyboardStyle]}
            onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {mode === 'identity' ? (
            <View style={styles.identityFields}>
              <Text style={styles.macroSectionLabel}>Product name</Text>
              <TextInput
                value={draftItemTitle}
                onChangeText={setDraftItemTitle}
                placeholder="e.g. Organic whole milk"
                placeholderTextColor={BaggedColors.muted}
                style={styles.macroInput}
                autoCapitalize="words"
              />
              <Text style={styles.macroSectionLabel}>Brand</Text>
              <TextInput
                value={draftBrand}
                onChangeText={setDraftBrand}
                placeholder="e.g. Horizon (optional)"
                placeholderTextColor={BaggedColors.muted}
                style={styles.macroInput}
                autoCapitalize="words"
              />
            </View>
          ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              mode === 'macros' && styles.scrollContentMacros,
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={mode === 'macros'}>
            {mode === 'stores' ? (
              <>
                {tjOnly ? (
                  <Text style={styles.hint}>
                    Trader Joe&apos;s brand items are only sold at Trader Joe&apos;s.
                  </Text>
                ) : null}
                <StoreSearchChips
                  selectedStores={draftStores}
                  onToggleStore={toggleStore}
                  tjOnly={tjOnly}
                  chipStyles={styles}
                  scrollRef={scrollRef}
                />
              </>
            ) : mode === 'diet' ? (
              <View style={styles.chipGrid}>
                {DIET_TAGS.map((tag) => {
                  const active = draftDietTags.includes(tag.id);
                  return (
                    <Pressable
                      key={tag.id}
                      onPress={() => toggleDietTag(tag.id)}
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
            ) : mode === 'categories' ? (
              <SubcategoryPickerGrid
                layout="stepped"
                selectedSubcategoryId={draftSubcategoryId}
                onSelect={setDraftSubcategoryId}
              />
            ) : (
              <>
                <View style={styles.macroGrid}>
                  <MacroField
                    label="Cal"
                    value={draftMacros.cal}
                    onChangeText={setMacroField('cal')}
                    disabled={macrosLocked}
                  />
                  <MacroField
                    label="Protein (g)"
                    value={draftMacros.protein}
                    onChangeText={setMacroField('protein')}
                    disabled={macrosLocked}
                  />
                  <MacroField
                    label="Carbs (g)"
                    value={draftMacros.carbs}
                    onChangeText={setMacroField('carbs')}
                    disabled={macrosLocked}
                    onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
                  />
                  <MacroField
                    label="Fat (g)"
                    value={draftMacros.fat}
                    onChangeText={setMacroField('fat')}
                    disabled={macrosLocked}
                    onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
                  />
                </View>
                <Text style={styles.macroSectionLabel}>Serving label (optional)</Text>
                <TextInput
                  value={draftMacros.servingLabel}
                  onChangeText={setMacroField('servingLabel')}
                  editable={!macrosLocked}
                  placeholder="e.g. 1 cup (240ml)"
                  placeholderTextColor={BaggedColors.muted}
                  style={[styles.macroInput, macrosLocked && styles.macroInputDisabled]}
                  onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
                />
              </>
            )}
          </ScrollView>
          )}
          <View style={styles.footer}>
            <Pressable onPress={onClose} disabled={saving} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={
                saving ||
                (mode === 'macros' && macrosLocked) ||
                (mode === 'identity' && !draftItemTitle.trim()) ||
                (mode === 'categories' && !draftSubcategoryId)
              }
              style={[
                styles.saveBtn,
                (saving ||
                  (mode === 'macros' && macrosLocked) ||
                  (mode === 'identity' && !draftItemTitle.trim()) ||
                  (mode === 'categories' && !draftSubcategoryId)) &&
                  styles.saveBtnDisabled,
              ]}>
              {saving ? (
                <ActivityIndicator color={BaggedColors.green} />
              ) : (
                <Text style={styles.saveText}>Save globally</Text>
              )}
            </Pressable>
          </View>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

function MacroField({
  label,
  value,
  onChangeText,
  disabled,
  onFocus,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  disabled?: boolean;
  onFocus?: () => void;
}) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.macroCellLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        keyboardType="decimal-pad"
        placeholder="enter"
        placeholderTextColor={BaggedColors.muted}
        style={[styles.macroInput, disabled && styles.macroInputDisabled]}
        onFocus={onFocus}
      />
    </View>
  );
}

export { EMPTY_MACROS };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: BaggedColors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '88%',
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 20,
    color: BaggedColors.onBg,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: BaggedColors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 22,
    lineHeight: 24,
    color: BaggedColors.muted,
  },
  subtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
    lineHeight: 18,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  hint: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  identityFields: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  scroll: { flexGrow: 0, flexShrink: 1, maxHeight: 420 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 12 },
  scrollContentMacros: { paddingBottom: 160 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: {
    borderColor: BaggedColors.dark,
    backgroundColor: BaggedColors.dark,
  },
  chipDisabled: { opacity: 0.45 },
  chipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: BaggedColors.onBgMuted,
  },
  chipTextActive: { color: BaggedColors.green, fontWeight: '700' },
  dietChip: {
    borderWidth: 2,
    borderColor: BaggedColors.borderOnBg,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dietChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: BaggedColors.onBgMuted,
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
  macroSectionLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.muted,
    marginTop: 14,
    marginBottom: 6,
  },
  macroInput: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.dark,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    borderRadius: 10,
    backgroundColor: BaggedColors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  macroInputDisabled: {
    opacity: 0.55,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: BaggedColors.borderOnBg,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: BaggedFonts.display,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.onBg,
  },
  saveBtn: {
    flex: 1.4,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: BaggedColors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.65 },
  saveText: {
    fontFamily: BaggedFonts.display,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.green,
  },
});
