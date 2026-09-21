import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { KeyboardFormScroll } from '@/components/bagged/keyboard-form-scroll';

import { TextField } from '@/components/bagged/text-field';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import {
  birthdayToDisplay,
  formatBirthdayDraftInput,
  normalizeBirthday,
  parseBirthdayInput,
} from '@/lib/birthday';

type ProfileEditorModalProps = {
  visible: boolean;
  initialBio?: string | null;
  initialDietTags?: string[];
  initialZipCode?: string | null;
  initialBirthday?: string | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (next: {
    bio: string;
    dietTags: string[];
    zipCode?: string | null;
    birthday?: string | null;
  }) => void;
};

export function ProfileEditorModal({
  visible,
  initialBio,
  initialDietTags = [],
  initialZipCode = null,
  initialBirthday = null,
  saving = false,
  onClose,
  onSave,
}: ProfileEditorModalProps) {
  const [draftBio, setDraftBio] = useState('');
  const [draftDietTags, setDraftDietTags] = useState<string[]>([]);
  const [draftZipCode, setDraftZipCode] = useState('');
  const [draftBirthday, setDraftBirthday] = useState('');
  const keyboardHeight = useKeyboardHeight();
  const keyboardOpen = keyboardHeight > 0;
  const sheetKeyboardStyle = keyboardOpen
    ? {
        marginBottom: keyboardHeight,
        maxHeight: Dimensions.get('window').height - keyboardHeight - 16,
      }
    : null;

  useEffect(() => {
    if (!visible) return;
    setDraftBio(String(initialBio ?? '').trim());
    setDraftDietTags([...initialDietTags]);
    setDraftZipCode(String(initialZipCode ?? '').trim());
    setDraftBirthday(birthdayToDisplay(initialBirthday));
  }, [visible, initialBio, initialDietTags, initialZipCode, initialBirthday]);

  const toggleDietTag = (id: string) => {
    setDraftDietTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    const birthday = parseBirthdayInput(draftBirthday);
    if (draftBirthday.trim() && !birthday) {
      Alert.alert('Check your birthday', 'Enter a valid date as MM/DD/YYYY.');
      return;
    }
    const nextZip = draftZipCode.trim() || null;
    const initialZip = String(initialZipCode ?? '').trim() || null;
    const savedBirthday = normalizeBirthday(initialBirthday);
    onSave({
      bio: draftBio.trim(),
      dietTags: draftDietTags,
      ...(nextZip !== initialZip ? { zipCode: nextZip } : {}),
      ...(birthday !== savedBirthday ? { birthday } : {}),
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, sheetKeyboardStyle]}
            onPress={(e) => e.stopPropagation()}>
            <View style={styles.header}>
              <Text style={styles.title}>Edit profile</Text>
              <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn} disabled={saving}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            <Text style={styles.subtitle}>
              Tell people what you review and which diets you care about.
            </Text>
            <KeyboardFormScroll
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Bio</Text>
                <TextField
                  value={draftBio}
                  onChangeText={setDraftBio}
                  placeholder="Tell people what you bag"
                  multiline
                  numberOfLines={4}
                  autoCapitalize="sentences"
                  textAlignVertical="top"
                  inputStyle={styles.bioInput}
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Zip code</Text>
                <Text style={styles.fieldHint}>
                  We&apos;ll show you what&apos;s trending near you.
                </Text>
                <TextField
                  value={draftZipCode}
                  onChangeText={setDraftZipCode}
                  placeholder="e.g. 90210"
                  keyboardType="number-pad"
                  maxLength={10}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Birthday</Text>
                <TextField
                  value={draftBirthday}
                  onChangeText={(t) => setDraftBirthday(formatBirthdayDraftInput(t))}
                  placeholder="MM/DD/YYYY"
                  keyboardType="number-pad"
                  maxLength={10}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={[styles.fieldGroup, styles.fieldGroupLast]}>
                <Text style={styles.fieldLabel}>Diet tags</Text>
                <Text style={styles.fieldHint}>Optional — helps others find reviewers like you.</Text>
                <View style={styles.chipGrid}>
                {DIET_TAGS.map((tag) => {
                  const active = draftDietTags.includes(tag.id);
                  return (
                    <Pressable
                      key={tag.id}
                      onPress={() => toggleDietTag(tag.id)}
                      style={[
                        styles.dietChip,
                        { borderColor: tag.color, backgroundColor: active ? tag.bgActive : tag.bg },
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
              </View>
            </KeyboardFormScroll>
            <View style={styles.footer}>
              <Pressable onPress={onClose} disabled={saving} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}>
                {saving ? (
                  <ActivityIndicator color={BaggedColors.white} />
                ) : (
                  <Text style={styles.saveText}>Save</Text>
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
    marginBottom: 16,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 16 },
  fieldGroup: {
    marginBottom: 20,
  },
  fieldGroupLast: {
    marginBottom: 0,
  },
  fieldLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.muted,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.onBgMuted,
    lineHeight: 17,
    marginBottom: 8,
  },
  bioInput: {
    minHeight: 96,
    maxHeight: 160,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  dietChip: {
    borderWidth: 2,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dietChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '500',
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
