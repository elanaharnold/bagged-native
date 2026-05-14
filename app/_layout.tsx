import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { BaggedColors } from '@/constants/bagged-theme';
import { AuthProvider } from '@/providers/auth-provider';
import { DisplaySettingsProvider } from '@/providers/display-settings-provider';

SplashScreen.preventAutoHideAsync();

const BaggedNavigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: BaggedColors.ink,
    background: BaggedColors.content,
    card: BaggedColors.card,
    text: BaggedColors.ink,
    border: BaggedColors.border,
    notification: BaggedColors.accent,
  },
};

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'Comico-Regular': require('../assets/fonts/Comico-Regular.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <AuthProvider>
      <DisplaySettingsProvider>
        <ThemeProvider value={BaggedNavigationTheme}>
          <Stack>
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="rate"
              options={{
                presentation: 'modal',
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="comments/[postId]"
              options={{
                presentation: 'modal',
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="notifications"
              options={{
                presentation: 'modal',
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="connections/[username]/[kind]"
              options={{
                presentation: 'modal',
                headerShown: false,
              }}
            />
            <Stack.Screen name="user/[username]" options={{ headerShown: false }} />
            <Stack.Screen name="product/detail" options={{ headerShown: false }} />
            <Stack.Screen
              name="settings"
              options={{
                headerShown: false,
                contentStyle: { backgroundColor: BaggedColors.content },
              }}
            />
          </Stack>
          <StatusBar style="light" />
        </ThemeProvider>
      </DisplaySettingsProvider>
    </AuthProvider>
  );
}
