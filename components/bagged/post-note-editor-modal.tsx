import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { TextField } from '@/components/bagged/text-field';
import { MentionNoteField } from '@/components/bagged/mention-note-field';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { useAuth } from '@/providers/auth-provider';

type PostNoteEditorModalProps = {
  visible: boolean;
  initialNote?: string | null;
  productName?: string;
  subtitle?: string;
  saveLabel?: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
};

export function PostNoteEditorModal({
  visible,
  initialNote,
  productName,
  subtitle,
  saveLabel,
  saving = false,
  onClose,
  onSave,
}: PostNoteEditorModalProps) {
  const [draft, setDraft] = useState('');
  const { userId } = useAuth();

  useEffect(() => {
    if (!visible) return;
    setDraft(String(initialNote ?? '').trim());
  }, [visible, initialNote]);

  const title = draft.trim() || initialNote?.trim() ? 'Edit note' : 'Add a note';

  const keyboardHeight = useKeyboardHeight();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, keyboardHeight > 0 && { marginBottom: keyboardHeight }]}
            onPress={(e) => e.stopPropagation()}>
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn} disabled={saving}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {productName ? (
              <Text style={styles.productName} numberOfLines={2}>
                {productName}
              </Text>
            ) : null}
            <Text style={styles.subtitle}>
              {subtitle ??
                'Tell your followers what you thought — tag friends with @username.'}
            </Text>
            <View style={styles.fieldWrap}>
              <MentionNoteField
                value={draft}
                onChangeText={setDraft}
                userId={userId}
                placeholder="One of my favorites… / better than expected… / @friend check this out…"
                multiline
                autoCapitalize="sentences"
                textAlignVertical="top"
                inputStyle={styles.noteInput}
              />
            </View>
            <View style={styles.footer}>
              <Pressable onPress={onClose} disabled={saving} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => onSave(draft)}
                disabled={saving}
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}>
                {saving ? (
                  <ActivityIndicator color={BaggedColors.white} />
                ) : (
                  <Text style={styles.saveText}>{saveLabel ?? 'Save note'}</Text>
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
    backgroundColor: BaggedColors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 22,
    lineHeight: 24,
    color: BaggedColors.muted,
  },
  productName: {
    fontFamily: BaggedFonts.display,
    fontSize: 16,
    color: BaggedColors.dark,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
    lineHeight: 18,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  fieldWrap: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  noteInput: {
    minHeight: 120,
    maxHeight: 240,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cancelText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
  saveBtn: {
    backgroundColor: BaggedColors.dark,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minWidth: 108,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.55,
  },
  saveText: {
    fontFamily: BaggedFonts.display,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.white,
  },
});
