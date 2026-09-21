import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/bagged/primary-button';
import { TextField } from '@/components/bagged/text-field';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { redeemReferralCode } from '@/hooks/use-referral-code';
import { logEvent } from '@/lib/log-event';

type Props = {
  onComplete: () => void;
};

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function ReferralCodeStep({ onComplete }: Props) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleApply = async () => {
    if (!code.trim()) return;
    setStatus('submitting');
    setErrorMessage('');

    const result = await redeemReferralCode(code);

    if (!result.success) {
      setStatus('error');
      setErrorMessage(errorMessageFor(result.error));
      return;
    }

    setStatus('success');
    logEvent('referral_code_redeemed');
    setTimeout(onComplete, 1200);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Have a referral code?</Text>
      <Text style={styles.subtitle}>Enter it below to link up with whoever invited you.</Text>

      {status === 'success' ? (
        <View style={styles.successBox}>
          <Text style={styles.successText}>Code applied — you&apos;re all set</Text>
        </View>
      ) : (
        <>
          <TextField
            variant="dark"
            disableAutofill
            label=""
            value={code}
            onChangeText={(text) => {
              setCode(text.toUpperCase());
              if (status === 'error') setStatus('idle');
            }}
            placeholder="Enter code"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={status !== 'submitting'}
            errorText={status === 'error' ? errorMessage : null}
            inputStyle={styles.codeInput}
          />

          <View style={styles.applySpacer} />

          <PrimaryButton
            surface="dark"
            label={status === 'submitting' ? 'Applying…' : 'Apply'}
            onPress={() => void handleApply()}
            disabled={status === 'submitting' || !code.trim()}
            loading={status === 'submitting'}
          />
        </>
      )}

      {status !== 'success' ? (
        <Pressable onPress={onComplete} hitSlop={8} style={styles.skipBtn}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function errorMessageFor(error?: string): string {
  switch (error) {
    case 'invalid_code':
      return "That code doesn't look right. Double-check and try again.";
    case 'already_redeemed':
      return "You've already used a referral code.";
    case 'self_referral':
      return "You can't use your own code.";
    case 'not_authenticated':
      return 'Something went wrong — try again in a moment.';
    default:
      return 'Something went wrong. Try again.';
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 26,
    color: BaggedColors.white,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.72)',
    marginBottom: 20,
  },
  codeInput: {
    letterSpacing: 1,
  },
  applySpacer: {
    height: 16,
  },
  successBox: {
    backgroundColor: BaggedColors.accentPale,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
    padding: 14,
    marginBottom: 16,
  },
  successText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.accent,
    textAlign: 'center',
  },
  skipBtn: {
    alignSelf: 'center',
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    textDecorationLine: 'underline',
  },
});
