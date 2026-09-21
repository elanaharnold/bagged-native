import { Redirect, Stack, usePathname } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BaggedColors } from '@/constants/bagged-theme';
import { isOnboardingIncomplete } from '@/lib/auth';
import { useAuth } from '@/providers/auth-provider';

export default function AuthLayout() {
  const { ready, session } = useAuth();
  const pathname = usePathname();

  if (!ready) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={BaggedColors.onBg} />
      </View>
    );
  }

  if (session) {
    const onResetPassword = pathname.includes('reset-password');
    const incomplete = isOnboardingIncomplete(session);
    if (!onResetPassword) {
      if (incomplete && !pathname.includes('onboarding')) {
        return <Redirect href="/(auth)/onboarding" />;
      }
      if (!incomplete && !pathname.includes('onboarding')) {
        return <Redirect href="/(tabs)" />;
      }
    }
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: BaggedColors.bg },
        animation: 'fade',
      }}>
      <Stack.Screen name="welcome" options={{ contentStyle: { backgroundColor: BaggedColors.accent } }} />
      <Stack.Screen
        name="login"
        options={{ contentStyle: { backgroundColor: BaggedColors.dark } }}
      />
      <Stack.Screen
        name="reset-password"
        options={{ contentStyle: { backgroundColor: BaggedColors.dark } }}
      />
      <Stack.Screen
        name="sign-up"
        options={{ contentStyle: { backgroundColor: BaggedColors.dark } }}
      />
      <Stack.Screen
        name="onboarding"
        options={{
          contentStyle: { backgroundColor: BaggedColors.accent },
          gestureEnabled: false,
        }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: BaggedColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
