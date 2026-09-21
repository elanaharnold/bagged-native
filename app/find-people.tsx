import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/bagged/avatar';
import { PrimaryButton } from '@/components/bagged/primary-button';
import { UsernameLink } from '@/components/bagged/username-link';
import { VerifiedAmbassadorBadge } from '@/components/bagged/verified-ambassador-badge';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import { isFindPeoplePending, isOnboardingIncomplete } from '@/lib/auth';
import {
  ensureProfileForUser,
  fetchSuggestedFriendProfiles,
  followUsername,
  isMandatoryFollowTarget,
  loadFriendsTabFollowing,
  type FindPeopleProfileRow,
  unfollowUsername,
  usernamesMatch,
} from '@/lib/data';
import { inviteFriendsToBagged } from '@/lib/invite-friends';
import { useAuth } from '@/providers/auth-provider';

export default function FindPeopleScreen() {
  const router = useRouter();
  const { ready, session, userId, username: authUsername, markFindPeopleSeen } = useAuth();

  const [selfUsername, setSelfUsername] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<FindPeopleProfileRow[]>([]);
  const [followingUsernames, setFollowingUsernames] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const prof = await ensureProfileForUser(userId);
    const [followingRows, suggestedRows] = await Promise.all([
      loadFriendsTabFollowing(userId),
      fetchSuggestedFriendProfiles(userId, 30),
    ]);
    const un = prof?.username?.trim() || authUsername?.trim() || null;
    setSelfUsername(un);
    setFollowingUsernames(new Set(followingRows.map((r) => r.username.toLowerCase())));
    setSuggested(
      suggestedRows.filter(
        (row) =>
          !usernamesMatch(row.username, un) &&
          !isMandatoryFollowTarget(row.username) &&
          !followingRows.some((f) => usernamesMatch(f.username, row.username))
      )
    );
  }, [userId, authUsername]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err) => console.warn('find-people load:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const followingSet = useMemo(() => followingUsernames, [followingUsernames]);

  const handleToggleFollow = useCallback(
    async (targetUsername: string) => {
      if (!userId || !targetUsername || usernamesMatch(targetUsername, selfUsername)) return;
      const norm = targetUsername.toLowerCase();
      const isFollowing = followingSet.has(norm);
      if (isMandatoryFollowTarget(norm) && isFollowing) return;
      try {
        if (isFollowing) {
          await unfollowUsername(userId, targetUsername);
          setFollowingUsernames((prev) => {
            const next = new Set(prev);
            next.delete(norm);
            return next;
          });
        } else {
          await followUsername(userId, targetUsername);
          setFollowingUsernames((prev) => new Set(prev).add(norm));
        }
      } catch (err) {
        console.warn('find-people follow toggle:', err);
      }
    },
    [userId, selfUsername, followingSet]
  );

  const handleInvite = useCallback(async () => {
    setInviteBusy(true);
    try {
      await inviteFriendsToBagged();
    } finally {
      setInviteBusy(false);
    }
  }, []);

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await markFindPeopleSeen();
      router.replace('/(tabs)');
    } catch (err) {
      console.warn('find-people finish:', err);
      setFinishing(false);
    }
  }, [finishing, markFindPeopleSeen, router]);

  if (!ready) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.loadingRow}>
          <ActivityIndicator color={BaggedColors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/welcome" />;
  }

  if (isOnboardingIncomplete(session)) {
    return <Redirect href="/(auth)/onboarding" />;
  }

  if (!isFindPeoplePending(session)) {
    return <Redirect href="/(tabs)" />;
  }

  if (!userId) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Text style={styles.muted}>Sign in to continue.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Find people to follow</Text>
        <Text style={styles.subtitle}>
          Follow a few people so your feed has reviews from day one. Verified ambassadors show up
          first; diet-tag matches come next; everyone else is sorted by how much they&apos;ve ranked.
        </Text>

        <Pressable
          onPress={() => void handleInvite()}
          disabled={inviteBusy}
          style={styles.inviteBtn}
          accessibilityRole="button"
          accessibilityLabel="Invite friends to Bagged">
          <Text style={styles.inviteBtnText}>{inviteBusy ? 'Opening share…' : 'Invite friends'}</Text>
          <Text style={styles.inviteBtnSub}>Know someone who&apos;d love Bagged? Send them a link.</Text>
        </Pressable>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={BaggedColors.accent} />
          </View>
        ) : suggested.length === 0 ? (
          <Text style={styles.emptyHint}>
            No other profiles to suggest yet — invite friends to get the party started.
          </Text>
        ) : (
          suggested.map((u) => {
            const isFollowing = followingSet.has(u.username.toLowerCase());
            return (
              <View key={u.id} style={styles.card}>
                <View style={styles.cardMain}>
                  <Avatar
                    char={(u.username[0] ?? '?').toUpperCase()}
                    color={u.avatarColor ?? BaggedColors.accent}
                    size={44}
                  />
                  <View style={styles.cardTextCol}>
                    <View style={styles.cardNameRow}>
                      <UsernameLink
                        username={u.username}
                        style={styles.cardName}
                        static
                        verified={u.isVerifiedAmbassador}
                      />
                    </View>
                    {u.isVerifiedAmbassador ? <VerifiedAmbassadorBadge compact /> : null}
                    <Text style={styles.cardMeta} numberOfLines={2}>
                      {(u.rankedCount ?? 0) > 0
                        ? `${u.rankedCount} items ranked`
                        : 'No rankings yet'}
                      {u.bio?.trim() ? ` · ${u.bio.trim()}` : ''}
                    </Text>
                    {u.dietTags.length > 0 ? (
                      <View style={styles.cardDietRow}>
                        {u.dietTags.map((id) => {
                          const tag = DIET_TAGS.find((t) => t.id === id);
                          if (!tag) return null;
                          return (
                            <View
                              key={id}
                              style={[styles.cardDietChip, { backgroundColor: tag.bg }]}>
                              <Text style={[styles.cardDietChipText, { color: tag.color }]}>
                                {tag.label}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                </View>
                <Pressable
                  onPress={() => void handleToggleFollow(u.username)}
                  style={isFollowing ? styles.pillMuted : styles.followBtn}
                  accessibilityRole="button"
                  accessibilityLabel={isFollowing ? `Unfollow ${u.username}` : `Follow ${u.username}`}>
                  <Text style={isFollowing ? styles.pillMutedText : styles.followBtnText}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </Pressable>
              </View>
            );
          })
        )}

        <View style={styles.bottomPad} />
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={() => void finish()} disabled={finishing} hitSlop={8} style={styles.skipBtn}>
          <Text style={styles.skipBtnText}>Skip</Text>
        </Pressable>
        <PrimaryButton
          surface="dark"
          label={finishing ? 'Opening Bagged…' : 'Continue to Bagged'}
          disabled={finishing}
          onPress={() => void finish()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BaggedColors.dark,
  },
  scroll: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 8,
    paddingBottom: 120,
  },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 26,
    color: BaggedColors.white,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.72)',
    marginBottom: 16,
  },
  inviteBtn: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  inviteBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  inviteBtnSub: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
    lineHeight: 17,
  },
  loadingRow: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    paddingVertical: 24,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minWidth: 0,
  },
  cardTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  cardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardName: {
    fontFamily: BaggedFonts.body,
    fontWeight: '700',
    fontSize: 14,
    color: BaggedColors.white,
  },
  cardMeta: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 17,
  },
  cardDietRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  cardDietChip: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cardDietChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    fontWeight: '700',
  },
  followBtn: {
    flexShrink: 0,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: BaggedColors.accent,
  },
  followBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.white,
  },
  pillMuted: {
    flexShrink: 0,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  pillMutedText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
  },
  bottomPad: {
    height: 16,
  },
  footer: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: BaggedColors.dark,
    gap: 12,
  },
  skipBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    textDecorationLine: 'underline',
  },
  muted: {
    fontFamily: BaggedFonts.body,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    padding: 24,
  },
});
