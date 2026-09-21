import 'react-native-gesture-handler';

import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { BaggedColors } from '@/constants/bagged-theme';
import { logEvent } from '@/lib/log-event';
import { AuthProvider } from '@/providers/auth-provider';
import { DisplaySettingsProvider } from '@/providers/display-settings-provider';
import { PushNotificationsProvider } from '@/providers/push-notifications-provider';
import { ShareScoreCardProvider } from '@/providers/share-score-card-provider';

SplashScreen.preventAutoHideAsync();

function AppOpenTracker() {
  useEffect(() => {
    logEvent('app_open');
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        logEvent('app_open');
      }
    });
    return () => sub.remove();
  }, []);

  return null;
}

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
    <GestureHandlerRootView style={{ flex: 1 }}>
    <AuthProvider>
      <AppOpenTracker />
      <PushNotificationsProvider>
      <DisplaySettingsProvider>
        <ShareScoreCardProvider>
        <ThemeProvider value={BaggedNavigationTheme}>
          <Stack>
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="find-people"
              options={{
                headerShown: false,
                gestureEnabled: false,
                contentStyle: { backgroundColor: BaggedColors.dark },
              }}
            />
            <Stack.Screen
              name="rate"
              options={{
                presentation: 'modal',
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="scan"
              options={{
                presentation: 'modal',
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="add-review-photos"
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
            <Stack.Screen name="leaderboard" options={{ headerShown: false }} />
            <Stack.Screen name="admin-duplicates" options={{ headerShown: false }} />
            <Stack.Screen name="post/[postId]" options={{ headerShown: false }} />
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
        </ShareScoreCardProvider>
      </DisplaySettingsProvider>
      </PushNotificationsProvider>
    </AuthProvider>
    </GestureHandlerRootView>
  );
}
