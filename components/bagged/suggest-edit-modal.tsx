import { useEffect, useState } from 'react';
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
import { PRODUCT_EDIT_SUGGESTION_LABELS, type ProductEditSuggestionType } from '@/lib/data';

const SUGGESTION_TYPES: ProductEditSuggestionType[] = [
  'name',
  'brand',
  'nutrition',
  'category_store',
  'other',
];

const PLACEHOLDER_BY_TYPE: Record<ProductEditSuggestionType, string> = {
  name: 'e.g. Protein Pastry – Brown Sugar Cinnamon',
  brand: 'e.g. Should be Legendary Foods',
  nutrition: 'e.g. 210 cal, 15g protein, 22g carbs, 8g fat per bar',
  category_store: 'e.g. Should be Protein Bars, sold at Target',
  other: "What's wrong with this product?",
};

type SuggestEditModalProps = {
  visible: boolean;
  itemTitle: string;
  brand: string;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (next: {
    suggestionType: ProductEditSuggestionType;
    suggestedValue: string;
    note: string;
  }) => void;
};

export function SuggestEditModal({
  visible,
  itemTitle,
  brand,
  saving = false,
  onClose,
  onSubmit,
}: SuggestEditModalProps) {
  const [type, setType] = useState<ProductEditSuggestionType>('name');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible) return;
    setType('name');
    setValue('');
    setNote('');
  }, [visible]);

  const canSubmit = value.trim().length > 0 && !saving;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.header}>
              <Text style={styles.title}>Suggest an edit</Text>
              <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            <Text style={styles.subtitle}>
              Flag something wrong on {itemTitle}
              {brand ? ` (${brand})` : ''} and we&apos;ll review it.
            </Text>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive">
              <Text style={styles.sectionLabel}>What's wrong?</Text>
              <View style={styles.chipGrid}>
                {SUGGESTION_TYPES.map((t) => {
                  const active = type === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setType(t)}
                      style={[styles.chip, active && styles.chipActive]}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {PRODUCT_EDIT_SUGGESTION_LABELS[t]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.sectionLabel}>What should it be?</Text>
              <TextInput
                value={value}
                onChangeText={setValue}
                placeholder={PLACEHOLDER_BY_TYPE[type]}
                placeholderTextColor={BaggedColors.muted}
                style={styles.input}
                multiline
                autoCapitalize="sentences"
              />

              <Text style={styles.sectionLabel}>Anything else? (optional)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Extra context for us"
                placeholderTextColor={BaggedColors.muted}
                style={[styles.input, styles.noteInput]}
                multiline
              />
            </ScrollView>
            <View style={styles.footer}>
              <Pressable onPress={onClose} disabled={saving} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => onSubmit({ suggestionType: type, suggestedValue: value, note })}
                disabled={!canSubmit}
                style={[styles.saveBtn, !canSubmit && styles.saveBtnDisabled]}>
                {saving ? (
                  <ActivityIndicator color={BaggedColors.green} />
                ) : (
                  <Text style={styles.saveText}>Send</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

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
  title: { fontFamily: BaggedFonts.display, fontSize: 20, color: BaggedColors.onBg },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: BaggedColors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 22, lineHeight: 24, color: BaggedColors.muted },
  subtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
    lineHeight: 18,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  scroll: { flexGrow: 0, flexShrink: 1, maxHeight: 420 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 16 },
  sectionLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.muted,
    marginTop: 14,
    marginBottom: 6,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { borderColor: BaggedColors.dark, backgroundColor: BaggedColors.dark },
  chipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: BaggedColors.onBgMuted,
  },
  chipTextActive: { color: BaggedColors.green, fontWeight: '700' },
  input: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.dark,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    borderRadius: 10,
    backgroundColor: BaggedColors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    textAlignVertical: 'top',
  },
  noteInput: { minHeight: 60 },
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
  cancelText: { fontFamily: BaggedFonts.display, fontSize: 15, fontWeight: '700', color: BaggedColors.onBg },
  saveBtn: {
    flex: 1.4,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: BaggedColors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.65 },
  saveText: { fontFamily: BaggedFonts.display, fontSize: 15, fontWeight: '700', color: BaggedColors.green },
});
