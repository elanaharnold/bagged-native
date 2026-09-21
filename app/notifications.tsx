import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExpandableText } from '@/components/bagged/expandable-text';
import { Avatar } from '@/components/bagged/avatar';
import { UsernameLink } from '@/components/bagged/username-link';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { fetchActivityNotifications, fetchProfileById, type ActivityNotification } from '@/lib/data';
import { formatPostTime } from '@/lib/format';
import {
  emitNotificationsBadgeRefresh,
  setNotificationsLastReadNow,
} from '@/lib/notifications-read';
import { useAuth } from '@/providers/auth-provider';

export default function NotificationsModalScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const [items, setItems] = useState<ActivityNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setErrorMsg(null);
    const prof = await fetchProfileById(userId);
    const un = prof?.username ?? '';
    if (!un) {
      setItems([]);
      return;
    }
    try {
      const rows = await fetchActivityNotifications(userId, un);
      setItems(rows);
    } catch (e) {
      console.warn('notifications:', e);
      setErrorMsg(e instanceof Error ? e.message : 'Could not load notifications.');
      setItems([]);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let cancelled = false;
      setLoading(true);
      load()
        .finally(() => {
          if (!cancelled) setLoading(false);
        })
        .then(() => {
          if (!cancelled) setNotificationsLastReadNow();
        });
      return () => {
        cancelled = true;
        void setNotificationsLastReadNow().then(() => emitNotificationsBadgeRefresh());
      };
    }, [userId, load])
  );

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    await load();
    await setNotificationsLastReadNow();
    setRefreshing(false);
  }, [userId, load]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerRow}>
        <View style={styles.headerMain}>
          <Text style={styles.brand}>Notifications</Text>
          <Text style={styles.sub}>Likes, comments, replies, and new followers</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Close">
          <Ionicons name="close" size={28} color={BaggedColors.onBg} />
        </Pressable>
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
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BaggedColors.onBg} />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
              <Text style={styles.emptyBody}>
                When someone likes or comments on your posts, replies to you, or follows you, it&apos;ll show up here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                if (item.kind === 'follow') {
                  router.push({
                    pathname: '/user/[username]',
                    params: { username: item.actorUsername },
                  });
                } else if (item.postId) {
                  router.push({
                    pathname: '/comments/[postId]',
                    params: {
                      postId: item.postId,
                      postItem: item.postItemPreview ?? '',
                      highlightCommentId:
                        item.kind === 'comment' || item.kind === 'comment_reply'
                          ? item.commentId ?? ''
                          : '',
                    },
                  });
                }
              }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/user/[username]',
                    params: { username: item.actorUsername },
                  })
                }
                hitSlop={6}>
                <Avatar
                  char={(item.actorUsername || '?').charAt(0).toUpperCase()}
                  color={item.actorAvatar ?? BaggedColors.accent}
                  size={44}
                />
              </Pressable>
              <View style={styles.body}>
                <Text style={styles.line}>
                  {item.kind === 'like' ? (
                    <>
                      <UsernameLink
                        username={item.actorUsername}
                        style={styles.bold}
                        verified={item.actorVerifiedAmbassador}
                      /> liked your ranking
                      {item.postItemPreview ? (
                        <>
                          {' '}
                          <Text style={styles.itemPreview}>“{item.postItemPreview.slice(0, 48)}”</Text>
                        </>
                      ) : null}
                    </>
                  ) : item.kind === 'comment' ? (
                    <>
                      <UsernameLink
                        username={item.actorUsername}
                        style={styles.bold}
                        verified={item.actorVerifiedAmbassador}
                      /> commented on{' '}
                      {item.postItemPreview ? (
                        <Text style={styles.itemPreview}>“{item.postItemPreview.slice(0, 40)}”</Text>
                      ) : (
                        'your post'
                      )}
                    </>
                  ) : item.kind === 'comment_reply' ? (
                    <>
                      <UsernameLink
                        username={item.actorUsername}
                        style={styles.bold}
                        verified={item.actorVerifiedAmbassador}
                      /> replied to your
                      comment
                    </>
                  ) : (
                    <>
                      <UsernameLink
                        username={item.actorUsername}
                        style={styles.bold}
                        verified={item.actorVerifiedAmbassador}
                      /> started following
                      you
                    </>
                  )}
                </Text>
                {item.bodyPreview ? (
                  <ExpandableText style={styles.snippet} numberOfLines={2}>
                    {item.bodyPreview}
                  </ExpandableText>
                ) : null}
                <Text style={styles.time}>{formatPostTime(item.createdAt)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BaggedColors.bg },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerMain: { flex: 1, minWidth: 0 },
  closeBtn: {
    padding: 4,
    marginTop: -2,
  },
  brand: {
    fontFamily: BaggedFonts.display,
    fontSize: 28,
    color: BaggedColors.onBg,
    letterSpacing: -0.5,
  },
  sub: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
    marginTop: 2,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderOnBg,
  },
  pressed: { opacity: 0.85 },
  body: { flex: 1, minWidth: 0 },
  line: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.onBg,
    lineHeight: 20,
  },
  bold: { fontWeight: '700' },
  itemPreview: { fontStyle: 'italic', color: BaggedColors.onBgMuted },
  snippet: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
    marginTop: 6,
    lineHeight: 18,
  },
  time: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.onBgMuted,
    marginTop: 6,
  },
  centered: {
    flex: 1,
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 20,
    color: BaggedColors.onBg,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.onBgMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  err: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.accent,
    textAlign: 'center',
  },
});
