import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BaggedRateFab } from '@/components/bagged/rate-fab';
import { BaggedTopTabBar } from '@/components/bagged/top-tab-bar';
import { BaggedColors } from '@/constants/bagged-theme';
import { useAuth } from '@/providers/auth-provider';

export default function TabLayout() {
  const { ready, session } = useAuth();

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

  return (
    <View style={styles.shell}>
      <Tabs
        tabBar={(props) => <BaggedTopTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarPosition: 'top',
          tabBarActiveTintColor: BaggedColors.dark,
          tabBarInactiveTintColor: BaggedColors.muted,
          tabBarStyle: {
            backgroundColor: BaggedColors.bg,
            borderTopWidth: 0,
            elevation: 0,
            shadowOpacity: 0,
          },
        }}>
        <Tabs.Screen name="index" options={{ title: 'Feed' }} />
        <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
        <Tabs.Screen name="rate-fab" options={{ title: 'Rate' }} />
        <Tabs.Screen name="my-list" options={{ title: 'My List' }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      </Tabs>
      <BaggedRateFab />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  splash: {
    flex: 1,
    backgroundColor: BaggedColors.content,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
