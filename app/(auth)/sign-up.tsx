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
import { logEvent } from '@/lib/log-event';
import { supabase } from '@/lib/supabase';

const USERNAME_ALLOWED_RE = /[^a-z0-9_.]/g;

function normalizeUsername(raw: string): string {
  return raw.toLowerCase().replace(USERNAME_ALLOWED_RE, '');
}

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useAuth();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [usernameError, setUsernameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const u = normalizeUsername(username);
    setUsernameError('');
    setEmailError('');
    setPasswordError('');

    if (u.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return;
    }
    if (!email.includes('@')) {
      setEmailError('Please enter a valid email');
      return;
    }
    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    setBusy(true);
    try {
      const { data: existingUsers } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', u)
        .limit(1);
      if (existingUsers && existingUsers.length > 0) {
        setUsernameError('Username already taken — try another');
        return;
      }
      await signUp({ email, password, username: u });
      logEvent('signup_completed', { method: 'email' });
      // Auth state listener flips to a session and the (auth) layout redirects.
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create your account.';
      if (message.includes('already exists') || message.includes('already registered')) {
        setEmailError('An account with this email already exists — try logging in');
      } else {
        setEmailError(message);
      }
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
            <Text style={styles.heading}>Pick a username</Text>
            <Text style={styles.subhead}>
              This is how your friends will find you on Bagged.
            </Text>
          </View>

          <View style={styles.fields}>
            <TextField
              variant="dark"
              label="Username"
              prefix="@"
              value={username}
              onChangeText={(t) => {
                setUsername(normalizeUsername(t));
                setUsernameError('');
              }}
              placeholder="your_username"
              maxLength={30}
              autoCapitalize="none"
              autoCorrect={false}
              errorText={usernameError || null}
              helperText={usernameError ? null : 'Letters, numbers, underscores, and dots only'}
            />

            <View style={styles.spacer} />

            <TextField
              variant="dark"
              label="Email"
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setEmailError('');
              }}
              placeholder="your@email.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              errorText={emailError || null}
            />

            <View style={styles.spacer} />

            <TextField
              variant="dark"
              label="Password"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setPasswordError('');
              }}
              placeholder="at least 6 characters"
              togglePassword
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              errorText={passwordError || null}
              onSubmitEditing={submit}
            />
          </View>

          <View style={styles.actions}>
            <PrimaryButton label="Create account" onPress={submit} loading={busy} surface="dark" />
            <View style={styles.spacer} />
            <Pressable onPress={() => router.replace('/(auth)/login')} hitSlop={8}>
              <Text style={styles.swapPrompt}>
                Already have an account?{' '}
                <Text style={styles.swapPromptEmphasis}>Log in</Text>
              </Text>
            </Pressable>
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
