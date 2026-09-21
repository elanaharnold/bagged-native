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
import { UsernameLink } from '@/components/bagged/username-link';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { usernameFromSession } from '@/lib/auth';
import {
  ConnectionRow,
  ensureProfileForUser,
  fetchFollowersForProfileUsername,
  fetchFollowingForProfileUserId,
  fetchProfileByUsername,
  followUsername,
  isMandatoryFollowTarget,
  loadFriendsTabFollowing,
  unfollowUsername,
  usernamesMatch,
} from '@/lib/data';
import { useAuth } from '@/providers/auth-provider';

type Kind = 'followers' | 'following';

export default function ConnectionsListScreen() {
  const router = useRouter();
  const { userId, session, username: authUsername } = useAuth();
  const params = useLocalSearchParams<{ username: string; kind: string }>();
  const username = String(params.username ?? '').trim();
  const kindRaw = String(params.kind ?? '').toLowerCase();
  const kind: Kind | null = kindRaw === 'followers' || kindRaw === 'following' ? kindRaw : null;

  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selfUsername, setSelfUsername] = useState<string | null>(null);
  const [followingUsernames, setFollowingUsernames] = useState<Set<string>>(() => new Set());
  const [profileVerified, setProfileVerified] = useState(false);

  const title = kind === 'following' ? 'Following' : kind === 'followers' ? 'Followers' : 'Connections';
  const isOwnProfile = Boolean(selfUsername && usernamesMatch(username, selfUsername));
  const showFollowActions = kind === 'followers' && isOwnProfile && Boolean(userId);

  const loadFollowingSet = useCallback(async () => {
    if (!userId) {
      setFollowingUsernames(new Set());
      return;
    }
    const followingRows = await loadFriendsTabFollowing(userId);
    setFollowingUsernames(new Set(followingRows.map((r) => r.username.toLowerCase())));
  }, [userId]);

  const load = useCallback(async () => {
    if (!username || !kind) {
      setRows([]);
      setErrorMsg(!username ? 'Missing username.' : 'Invalid list.');
      return;
    }
    setErrorMsg(null);
    try {
      const ownerProfile = await fetchProfileByUsername(username);
      setProfileVerified(Boolean(ownerProfile?.is_verified_ambassador));
      if (kind === 'followers') {
        const list = await fetchFollowersForProfileUsername(username);
        setRows(list);
        return;
      }
      if (!ownerProfile?.id) {
        setRows([]);
        setErrorMsg('Profile not found.');
        return;
      }
      const list = await fetchFollowingForProfileUserId(ownerProfile.id);
      setRows(list);
    } catch (e) {
      console.warn('connections load:', e);
      setErrorMsg(e instanceof Error ? e.message : 'Could not load list.');
      setRows([]);
    }
  }, [username, kind]);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setSelfUsername(null);
      setFollowingUsernames(new Set());
      return;
    }
    ensureProfileForUser(userId)
      .then((prof) => {
        if (cancelled) return;
        const un =
          prof?.username?.trim() || authUsername || usernameFromSession(session) || null;
        setSelfUsername(un);
      })
      .catch((e) => console.warn('connections self profile:', e));
    return () => {
      cancelled = true;
    };
  }, [userId, authUsername, session]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([load(), showFollowActions ? loadFollowingSet() : Promise.resolve()])
      .catch((e) => console.warn('connections load:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, loadFollowingSet, showFollowActions]);

  const handleToggleFollow = useCallback(
    async (targetUsername: string) => {
      if (!userId || !targetUsername || usernamesMatch(targetUsername, selfUsername)) return;
      const norm = targetUsername.toLowerCase();
      const isFollowing = followingUsernames.has(norm);
      if (isMandatoryFollowTarget(norm) && isFollowing) return;
      try {
        if (isFollowing) {
          await unfollowUsername(userId, targetUsername);
        } else {
          await followUsername(userId, targetUsername);
        }
        await loadFollowingSet();
      } catch (e) {
        console.warn('connections toggle follow:', e);
      }
    },
    [userId, selfUsername, followingUsernames, loadFollowingSet]
  );

  const openProfile = useCallback(
    (uname: string) => {
      const u = uname.trim();
      if (!u || usernamesMatch(u, selfUsername)) return;
      router.push({ pathname: '/user/[username]', params: { username: u } });
    },
    [router, selfUsername]
  );

  const renderTrailing = useCallback(
    (item: ConnectionRow) => {
      if (showFollowActions) {
        const isFollowing = followingUsernames.has(item.username.toLowerCase());
        if (!isFollowing) {
          return (
            <Pressable
              onPress={() => void handleToggleFollow(item.username)}
              style={styles.followBackBtn}
              accessibilityRole="button"
              accessibilityLabel={`Follow back ${item.username}`}>
              <Text style={styles.followBackText}>Follow Back</Text>
            </Pressable>
          );
        }
        return (
          <Pressable
            onPress={() => void handleToggleFollow(item.username)}
            disabled={isMandatoryFollowTarget(item.username)}
            style={[
              styles.pillMuted,
              isMandatoryFollowTarget(item.username) && styles.pillMutedDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Unfollow ${item.username}`}>
            <Text style={styles.pillMutedText}>Following</Text>
          </Pressable>
        );
      }
      return <Ionicons name="chevron-forward" size={18} color={BaggedColors.onBgMuted} />;
    },
    [showFollowActions, followingUsernames, handleToggleFollow]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={BaggedColors.onBg} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>{title}</Text>
          <UsernameLink username={username} style={styles.sub} verified={profileVerified} />
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
          renderItem={({ item }) => {
            const canOpen = !usernamesMatch(item.username, selfUsername) && item.username.length > 0;
            return (
              <View style={styles.row}>
                <Pressable
                  onPress={() => canOpen && openProfile(item.username)}
                  disabled={!canOpen}
                  style={({ pressed }) => [styles.rowMain, pressed && canOpen && styles.pressed]}>
                  <Avatar
                    char={(item.username || '?').charAt(0).toUpperCase()}
                    color={item.avatarColor ?? BaggedColors.accent}
                    size={48}
                  />
                  <UsernameLink
                    username={item.username}
                    style={styles.handle}
                    static={!canOpen}
                    verified={item.isVerifiedAmbassador}
                  />
                </Pressable>
                {renderTrailing(item)}
              </View>
            );
          }}
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
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  pressed: { opacity: 0.85 },
  handle: {
    flex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.onBg,
  },
  followBackBtn: {
    flexShrink: 0,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
    backgroundColor: BaggedColors.accent,
  },
  followBackText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.white,
  },
  pillMuted: {
    flexShrink: 0,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    backgroundColor: 'transparent',
  },
  pillMutedDisabled: {
    opacity: 0.75,
  },
  pillMutedText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.onBgMuted,
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
