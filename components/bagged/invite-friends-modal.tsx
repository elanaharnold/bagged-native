import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/bagged/primary-button';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { useReferralCode } from '@/hooks/use-referral-code';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function InviteFriendsModal({ visible, onClose }: Props) {
  const { code, loading } = useReferralCode();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleShare = async () => {
    if (!code) return;
    try {
      await Share.share({
        message: `What groceries u been into recently?

Let me know on Bagged- the first social grocery ranking app.

Use code ${code} when you sign up:
https://apps.apple.com/us/app/bagged/id6769496569`,
      });
    } catch {
      // User dismissed — no-op.
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={styles.sheet}>
          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>

          <Text style={styles.title}>Invite your friends</Text>
          <Text style={styles.subtitle}>
            Share your code so friends can link up with you on Bagged.
          </Text>

          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{loading ? '······' : (code ?? '—')}</Text>
            <Pressable
              onPress={() => void handleCopy()}
              hitSlop={8}
              disabled={!code || loading}
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Copied' : 'Copy referral code'}>
              <Text style={[styles.copyText, (!code || loading) && styles.copyTextDisabled]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
          </View>

          <PrimaryButton
            label="Share invite link"
            onPress={() => void handleShare()}
            disabled={!code || loading}
            surface="light"
          />

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: BaggedColors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: BaggedLayout.screenPadding + 8,
    paddingBottom: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.border,
  },
  closeButton: {
    alignSelf: 'flex-end',
    marginBottom: 8,
  },
  closeText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 24,
    color: BaggedColors.dark,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: BaggedColors.muted,
    textAlign: 'center',
    marginBottom: 20,
  },
  codeBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: BaggedColors.accentPale,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderSoft,
    padding: 14,
    marginBottom: 16,
  },
  codeText: {
    fontFamily: BaggedFonts.body,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
    color: BaggedColors.dark,
  },
  copyText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  copyTextDisabled: {
    opacity: 0.4,
  },
});
