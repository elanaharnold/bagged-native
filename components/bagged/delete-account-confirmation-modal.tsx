import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/bagged/primary-button';
import { TextField } from '@/components/bagged/text-field';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { DELETE_ACCOUNT_CONFIRMATION_PHRASE } from '@/lib/auth';

export { DELETE_ACCOUNT_CONFIRMATION_PHRASE };

type DeleteAccountConfirmationModalProps = {
  visible: boolean;
  username?: string | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function DeleteAccountConfirmationModal({
  visible,
  username,
  busy = false,
  onClose,
  onConfirm,
}: DeleteAccountConfirmationModalProps) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!visible) {
      setStep(1);
      setTyped('');
    }
  }, [visible]);

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  const phraseOk = typed.trim() === DELETE_ACCOUNT_CONFIRMATION_PHRASE;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Delete account permanently</Text>
          <Pressable onPress={handleClose} hitSlop={10} disabled={busy}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </Pressable>
        </View>

        {step === 1 ? (
          <View style={styles.body}>
            <Text style={styles.lead}>
              This cannot be undone. There is no backup on the free Supabase plan.
            </Text>
            <View style={styles.bulletList}>
              <Text style={styles.bullet}>• Every ranking and post you created</Text>
              <Text style={styles.bullet}>• Your profile{username ? ` (@${username})` : ''}</Text>
              <Text style={styles.bullet}>• Your login — you will need to sign up again</Text>
              <Text style={styles.bullet}>• Post photos stored for your account</Text>
              <Text style={styles.bullet}>• Your likes, comments, and Want to Try list</Text>
            </View>
            <Text style={styles.note}>
              Other users&apos; data is not affected. This only deletes your account.
            </Text>
            <PrimaryButton
              label="I understand — continue"
              onPress={() => setStep(2)}
              surface="dark"
            />
          </View>
        ) : (
          <View style={styles.body}>
            <Text style={styles.lead}>
              Type{' '}
              <Text style={styles.phrase}>{DELETE_ACCOUNT_CONFIRMATION_PHRASE}</Text> to confirm.
            </Text>
            <TextField
              variant="dark"
              value={typed}
              onChangeText={setTyped}
              placeholder={DELETE_ACCOUNT_CONFIRMATION_PHRASE}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
            />
            <PrimaryButton
              label={busy ? 'Deleting…' : 'Delete my account forever'}
              onPress={onConfirm}
              loading={busy}
              disabled={!phraseOk || busy}
              surface="dark"
            />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BaggedColors.dark,
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    flex: 1,
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.green,
    marginRight: 12,
  },
  cancelLink: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.72)',
  },
  body: {
    gap: 16,
  },
  lead: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.88)',
  },
  phrase: {
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  bulletList: {
    gap: 8,
    paddingVertical: 4,
  },
  bullet: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.78)',
  },
  note: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.55)',
  },
});
