import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardFormScroll } from '@/components/bagged/keyboard-form-scroll';
import { PrimaryButton } from '@/components/bagged/primary-button';
import { TextField } from '@/components/bagged/text-field';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { updatePassword } from '@/lib/auth';
import { useAuth } from '@/providers/auth-provider';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErrorMsg('');
    const p = password.trim();
    const p2 = password2.trim();
    if (p.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    if (p !== p2) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (!session) {
      setErrorMsg('This reset link expired or was already used. Request a new one from Log in.');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(p);
      router.replace('/(tabs)');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not update password. Try requesting a new link.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}>
        <KeyboardFormScroll
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <Pressable
              onPress={() => router.replace('/(auth)/login')}
              hitSlop={10}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Back to log in">
              <Text style={styles.backText}>←</Text>
            </Pressable>
            <View style={styles.backBtn} />
          </View>

          <View style={styles.hero}>
            <Text style={styles.heading}>Choose a new password</Text>
            <Text style={styles.subhead}>
              Set a new password for your Bagged account, then log in with it.
            </Text>
          </View>

          <View style={styles.fields}>
            <TextField
              variant="dark"
              label="New password"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setErrorMsg('');
              }}
              placeholder="••••••••"
              togglePassword
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
            />
            <View style={styles.spacer} />
            <TextField
              variant="dark"
              label="Confirm password"
              value={password2}
              onChangeText={(t) => {
                setPassword2(t);
                setErrorMsg('');
              }}
              placeholder="••••••••"
              togglePassword
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              errorText={errorMsg || null}
              onSubmitEditing={submit}
            />
          </View>

          <View style={styles.actions}>
            <PrimaryButton
              label="Update password"
              onPress={submit}
              loading={busy}
              disabled={!session}
              surface="dark"
            />
            {!session ? (
              <Text style={styles.hint}>
                Open the reset link from your email on this device, or request a new link from Log
                in.
              </Text>
            ) : null}
          </View>
        </KeyboardFormScroll>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BaggedColors.dark,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  backText: {
    fontFamily: BaggedFonts.body,
    fontSize: 18,
    color: BaggedColors.green,
    marginTop: -2,
  },
  hero: {
    marginBottom: 32,
  },
  heading: {
    fontFamily: BaggedFonts.display,
    fontSize: 36,
    color: BaggedColors.green,
    letterSpacing: -0.6,
    marginBottom: 10,
  },
  subhead: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 22,
  },
  fields: {
    width: '100%',
  },
  spacer: {
    height: 14,
  },
  actions: {
    marginTop: 28,
    alignItems: 'center',
    gap: 16,
  },
  hint: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 18,
    textAlign: 'center',
  },
});
