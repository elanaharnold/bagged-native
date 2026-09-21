import { useRouter } from 'expo-router';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <View style={styles.center}>
        <Text style={styles.wordmark} accessibilityRole="header">
          bagged
        </Text>

        <View style={styles.links}>
          <Pressable
            onPress={() => router.push('/(auth)/sign-up')}
            style={({ pressed }) => [styles.linkBlock, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Create account">
            <Text style={styles.createAccount}>CREATE ACCOUNT</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/(auth)/login')}
            style={({ pressed }) => [styles.linkBlock, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Log in">
            <Text style={styles.logIn}>LOG IN</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BaggedColors.accent,
    paddingHorizontal: 28,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontFamily: BaggedFonts.display,
    fontSize: 56,
    color: BaggedColors.cream,
    letterSpacing: -1.5,
    textTransform: 'lowercase',
    textAlign: 'center',
    marginBottom: 48,
  },
  links: {
    alignItems: 'center',
    gap: 36,
  },
  linkBlock: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  pressed: {
    opacity: 0.55,
  },
  createAccount: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.cream,
    letterSpacing: -0.3,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  logIn: {
    fontFamily: BaggedFonts.display,
    fontSize: 30,
    color: BaggedColors.cream,
    letterSpacing: -0.5,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
});
