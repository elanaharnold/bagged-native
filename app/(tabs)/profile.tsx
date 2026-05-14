import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileView } from '@/components/bagged/profile-view';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { fetchProfileById } from '@/lib/data';
import { useAuth } from '@/providers/auth-provider';

export default function SelfProfileTab() {
  const { userId } = useAuth();
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!userId) {
        setUsername(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      fetchProfileById(userId)
        .then((p) => {
          if (!cancelled) setUsername(p?.username ?? null);
        })
        .catch((err) => console.warn('fetchProfileById:', err))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [userId])
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.fallback} edges={['bottom', 'left', 'right']}>
        <ActivityIndicator color={BaggedColors.dark} />
      </SafeAreaView>
    );
  }

  if (!username) {
    return (
      <SafeAreaView style={styles.fallback} edges={['bottom', 'left', 'right']}>
        <Text style={styles.fallbackText}>No profile found for this account.</Text>
      </SafeAreaView>
    );
  }

  return <ProfileView username={username} isSelf omitTopSafeArea extraBottomInset={BaggedLayout.rateFabListInset} />;
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: BaggedColors.content,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  fallbackText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.muted,
    textAlign: 'center',
  },
});
