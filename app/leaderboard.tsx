import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LeaderboardList } from '@/components/bagged/leaderboard-list';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { usernameFromSession } from '@/lib/auth';
import {
  ensureProfileForUser,
  fetchLeaderboardByRankedCount,
  type LeaderboardRow,
} from '@/lib/data';
import { useAuth } from '@/providers/auth-provider';

export default function LeaderboardScreen() {
  const router = useRouter();
  const { userId, session, username: authUsername } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [selfUsername, setSelfUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMsg(null);
    try {
      const [lb, prof] = await Promise.all([
        fetchLeaderboardByRankedCount(),
        userId ? ensureProfileForUser(userId) : Promise.resolve(null),
      ]);
      setRows(lb);
      setSelfUsername(
        prof?.username?.trim() || authUsername || usernameFromSession(session) || null
      );
    } catch (e) {
      console.warn('leaderboard load:', e);
      setErrorMsg(e instanceof Error ? e.message : 'Could not load leaderboard.');
      setRows([]);
    }
  }, [userId, authUsername, session]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      load().finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openProfile = useCallback(
    (uname: string) => {
      const u = uname.trim();
      if (!u || u === selfUsername) return;
      router.push({ pathname: '/user/[username]', params: { username: u } });
    },
    [router, selfUsername]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={BaggedColors.dark} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Bagged leaderboard</Text>
          <Text style={styles.subtitle}>Ranked by total items rated</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={BaggedColors.dark} />
        </View>
      ) : errorMsg ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{errorMsg}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BaggedColors.dark} />
          }>
          {rows.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>No rankings yet</Text>
              <Text style={styles.emptyBody}>When people start rating products, they&apos;ll show up here.</Text>
            </View>
          ) : (
            <LeaderboardList
              rows={rows}
              activeUsername={selfUsername}
              onPressUser={openProfile}
            />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BaggedColors.content,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BaggedColors.border,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.dark,
  },
  subtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    marginTop: 2,
  },
  scrollContent: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 16,
    paddingBottom: 32,
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    minHeight: 200,
  },
  error: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.muted,
    textAlign: 'center',
  },
  emptyTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 16,
    color: BaggedColors.dark,
    marginBottom: 6,
  },
  emptyBody: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
