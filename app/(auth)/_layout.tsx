import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BaggedColors } from '@/constants/bagged-theme';
import { useAuth } from '@/providers/auth-provider';

export default function AuthLayout() {
  const { ready, session } = useAuth();

  if (!ready) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={BaggedColors.onBg} />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: BaggedColors.bg },
        animation: 'fade',
      }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" />
      <Stack.Screen
        name="sign-up"
        options={{ contentStyle: { backgroundColor: BaggedColors.dark } }}
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
