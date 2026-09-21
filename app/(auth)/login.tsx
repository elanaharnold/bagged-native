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
import { useAuth } from '@/providers/auth-provider';

type Mode = 'login' | 'forgot';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, requestPasswordReset } = useAuth();

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [busy, setBusy] = useState(false);

  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotErr, setForgotErr] = useState('');
  const [forgotNotice, setForgotNotice] = useState('');

  const submitLogin = async () => {
    if (!email.includes('@')) {
      setLoginError('Please enter your email address');
      return;
    }
    if (!password) {
      setLoginError('Please enter your password');
      return;
    }
    setBusy(true);
    setLoginError('');
    try {
      await signIn({ email, password });
    } catch (err) {
      console.warn('login failed:', err);
      setLoginError('Incorrect email or password');
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async () => {
    const em = email.trim();
    setForgotErr('');
    setForgotNotice('');
    if (!em.includes('@')) {
      setForgotErr('Enter the email you use for Bagged.');
      return;
    }
    setForgotBusy(true);
    try {
      await requestPasswordReset(em);
      setForgotNotice(
        'Check your email for a reset link. Open it on this device so Bagged can finish the reset. If you don’t see it, try your spam folder.'
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not send reset email. Try again in a moment.';
      setForgotErr(message);
    } finally {
      setForgotBusy(false);
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
              onPress={() => router.back()}
              hitSlop={10}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Back">
              <Text style={styles.backText}>←</Text>
            </Pressable>
            <View style={styles.backBtn} />
          </View>

          <View style={styles.hero}>
            <Text style={styles.heading}>
              {mode === 'login' ? 'Log in' : 'Forgot password'}
            </Text>
            {mode === 'forgot' ? (
              <Text style={styles.subhead}>
                Enter your account email and we&apos;ll send you a link to choose a new password.
              </Text>
            ) : null}
          </View>

          <View style={styles.fields}>
            <TextField
              variant="dark"
              label="Email"
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setLoginError('');
                setForgotErr('');
                setForgotNotice('');
              }}
              placeholder="your@email.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />

            {mode === 'login' ? (
              <View style={styles.spacer} />
            ) : null}

            {mode === 'login' ? (
              <TextField
                variant="dark"
                label="Password"
                labelRight={
                  <Pressable onPress={() => setMode('forgot')} hitSlop={6}>
                    <Text style={styles.forgotLink}>Forgot password?</Text>
                  </Pressable>
                }
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  setLoginError('');
                }}
                placeholder="••••••••"
                togglePassword
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                errorText={loginError || null}
                onSubmitEditing={submitLogin}
              />
            ) : null}

            {mode === 'forgot' && forgotErr ? (
              <Text style={styles.errorRow}>{forgotErr}</Text>
            ) : null}
            {mode === 'forgot' && forgotNotice ? (
              <Text style={styles.noticeRow}>{forgotNotice}</Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            {mode === 'login' ? (
              <>
                <PrimaryButton label="Log in" onPress={submitLogin} loading={busy} surface="dark" />
                <View style={styles.spacer} />
                <Pressable onPress={() => router.replace('/(auth)/sign-up')} hitSlop={8}>
                  <Text style={styles.swapPrompt}>
                    No account yet?{' '}
                    <Text style={styles.swapPromptEmphasis}>Create one</Text>
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <PrimaryButton
                  label="Send reset link"
                  onPress={submitForgot}
                  loading={forgotBusy}
                  surface="dark"
                />
                <View style={styles.spacer} />
                <Pressable
                  onPress={() => {
                    setMode('login');
                    setForgotErr('');
                    setForgotNotice('');
                  }}
                  hitSlop={8}>
                  <Text style={styles.swapPrompt}>Back to log in</Text>
                </Pressable>
              </>
            )}
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
  forgotLink: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.green,
  },
  errorRow: {
    marginTop: 12,
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.accent,
  },
  noticeRow: {
    marginTop: 12,
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 18,
  },
  actions: {
    marginTop: 28,
    alignItems: 'center',
  },
  swapPrompt: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
  },
  swapPromptEmphasis: {
    color: BaggedColors.green,
    fontWeight: '700',
  },
});
