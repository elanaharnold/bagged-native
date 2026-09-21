import { Redirect, Tabs } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { BaggedAppHeader } from '@/components/bagged/app-header';
import { BaggedBottomTabBar } from '@/components/bagged/bottom-tab-bar';
import { BaggedRateFab } from '@/components/bagged/rate-fab';
import { BaggedColors } from '@/constants/bagged-theme';
import { isFindPeoplePending, isOnboardingIncomplete } from '@/lib/auth';
import { useAuth } from '@/providers/auth-provider';

function SyncedBottomTabBar({
  onIndexChange,
  ...props
}: BottomTabBarProps & { onIndexChange: (index: number) => void }) {
  React.useEffect(() => {
    onIndexChange(props.state.index);
  }, [props.state.index, onIndexChange]);
  return <BaggedBottomTabBar {...props} />;
}

export default function TabLayout() {
  const { ready, session } = useAuth();
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const onTabIndexChange = useCallback((index: number) => {
    setActiveTabIndex(index);
  }, []);

  if (!ready) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={BaggedColors.dark} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/welcome" />;
  }

  if (isOnboardingIncomplete(session)) {
    return <Redirect href="/(auth)/onboarding" />;
  }

  if (isFindPeoplePending(session)) {
    return <Redirect href="/find-people" />;
  }

  return (
    <View style={styles.shell}>
      <BaggedAppHeader activeTabIndex={activeTabIndex} />
      <View style={styles.tabsWrap}>
        <Tabs
          tabBar={(props) => <SyncedBottomTabBar {...props} onIndexChange={onTabIndexChange} />}
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: BaggedColors.accent,
            tabBarInactiveTintColor: BaggedColors.muted,
            tabBarStyle: {
              backgroundColor: BaggedColors.card,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: BaggedColors.border,
              elevation: 0,
              shadowOpacity: 0,
            },
          }}>
          <Tabs.Screen name="index" options={{ title: 'Feed' }} />
          <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
          <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
          <Tabs.Screen name="rate-fab" options={{ title: 'Rate' }} />
          <Tabs.Screen name="my-list" options={{ title: 'My List' }} />
          <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
        </Tabs>
      </View>
      <BaggedRateFab />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: BaggedColors.bg,
  },
  tabsWrap: {
    flex: 1,
    backgroundColor: BaggedColors.content,
  },
  splash: {
    flex: 1,
    backgroundColor: BaggedColors.content,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
