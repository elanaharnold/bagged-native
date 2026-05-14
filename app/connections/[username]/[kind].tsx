import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/bagged/avatar';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  ConnectionRow,
  fetchFollowersForProfileUsername,
  fetchFollowingForProfileUserId,
  fetchProfileByUsername,
} from '@/lib/data';

type Kind = 'followers' | 'following';

export default function ConnectionsListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ username: string; kind: string }>();
  const username = String(params.username ?? '').trim();
  const kindRaw = String(params.kind ?? '').toLowerCase();
  const kind: Kind | null = kindRaw === 'followers' || kindRaw === 'following' ? kindRaw : null;

  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const title = kind === 'following' ? 'Following' : kind === 'followers' ? 'Followers' : 'Connections';

  const load = useCallback(async () => {
    if (!username || !kind) {
      setRows([]);
      setErrorMsg(!username ? 'Missing username.' : 'Invalid list.');
      return;
    }
    setErrorMsg(null);
    try {
      if (kind === 'followers') {
        const list = await fetchFollowersForProfileUsername(username);
        setRows(list);
        return;
      }
      const prof = await fetchProfileByUsername(username);
      if (!prof?.id) {
        setRows([]);
        setErrorMsg('Profile not found.');
        return;
      }
      const list = await fetchFollowingForProfileUserId(prof.id);
      setRows(list);
    } catch (e) {
      console.warn('connections load:', e);
      setErrorMsg(e instanceof Error ? e.message : 'Could not load list.');
      setRows([]);
    }
  }, [username, kind]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={BaggedColors.onBg} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub}>@{username}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={BaggedColors.onBg} />
        </View>
      ) : errorMsg ? (
        <View style={styles.centered}>
          <Text style={styles.err}>{errorMsg}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.username}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/user/[username]',
                  params: { username: item.username },
                })
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <Avatar
                char={(item.username || '?').charAt(0).toUpperCase()}
                color={item.avatarColor ?? BaggedColors.accent}
                size={48}
              />
              <Text style={styles.handle}>@{item.username}</Text>
              <Ionicons name="chevron-forward" size={18} color={BaggedColors.onBgMuted} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BaggedColors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderOnBg,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerSpacer: { width: 40 },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.onBg,
  },
  sub: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.onBgMuted,
    marginTop: 2,
  },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderOnBg,
  },
  pressed: { opacity: 0.85 },
  handle: {
    flex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.onBg,
  },
  centered: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  err: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.accent,
    textAlign: 'center',
  },
  empty: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.onBgMuted,
    textAlign: 'center',
    marginTop: 32,
  },
});
