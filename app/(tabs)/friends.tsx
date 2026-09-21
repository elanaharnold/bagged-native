import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

import { Avatar } from '@/components/bagged/avatar';
import { InviteFriendsModal } from '@/components/bagged/invite-friends-modal';
import { LeaderboardList } from '@/components/bagged/leaderboard-list';
import { UsernameLink } from '@/components/bagged/username-link';
import { VerifiedAmbassadorBadge } from '@/components/bagged/verified-ambassador-badge';
import { TextField } from '@/components/bagged/text-field';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import { useDebounce } from '@/hooks/use-debounce';
import {
  type ConnectionRow,
  type FindPeopleProfileRow,
  type FriendsTabFollowingEntry,
  type LeaderboardRow,
  ensureProfileForUser,
  fetchFollowersForProfileUsername,
  fetchLeaderboardByRankedCount,
  fetchSuggestedFriendProfiles,
  followUsername,
  getUserRankings,
  isMandatoryFollowTarget,
  leaderboardRankForUsername,
  usernamesMatch,
  isRadarOnlyDbRow,
  loadFriendsTabFollowing,
  searchProfilesForFindPeople,
  unfollowUsername,
} from '@/lib/data';
import { usernameFromSession } from '@/lib/auth';
import { useAuth } from '@/providers/auth-provider';

export default function FriendsScreen() {
  const router = useRouter();
  const { userId, session, username: authUsername } = useAuth();

  const [selfUsername, setSelfUsername] = useState<string | null>(null);
  const [selfAvatarColor, setSelfAvatarColor] = useState<string | null>(null);
  const [selfVerifiedAmbassador, setSelfVerifiedAmbassador] = useState(false);
  const [following, setFollowing] = useState<FriendsTabFollowingEntry[]>([]);
  const [followers, setFollowers] = useState<ConnectionRow[]>([]);
  const [suggested, setSuggested] = useState<FindPeopleProfileRow[]>([]);
  const [rankedCount, setRankedCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [findQuery, setFindQuery] = useState('');
  const debouncedFind = useDebounce(findQuery, 350);
  const [findResults, setFindResults] = useState<FindPeopleProfileRow[]>([]);
  const [findLoading, setFindLoading] = useState(false);
  const [inviteVisible, setInviteVisible] = useState(false);

  const followingLower = useMemo(
    () => new Set(following.map((f) => f.username.toLowerCase())),
    [following]
  );

  const selfLeaderboardRank = useMemo(
    () => leaderboardRankForUsername(leaderboard, selfUsername),
    [leaderboard, selfUsername]
  );

  const load = useCallback(async () => {
    if (!userId) {
      setSelfUsername(null);
      setFollowing([]);
      setFollowers([]);
      setSuggested([]);
      setLeaderboard([]);
      return;
    }
    const prof = await ensureProfileForUser(userId);
    const un =
      prof?.username?.trim() || authUsername || usernameFromSession(session) || null;
    setSelfUsername(un);
    setSelfAvatarColor(prof?.avatar_color ?? null);
    setSelfVerifiedAmbassador(Boolean(prof?.is_verified_ambassador));
    if (!un) {
      setFollowing([]);
      setFollowers([]);
      setSuggested([]);
      setRankedCount(0);
      setLeaderboard([]);
      return;
    }

    const [followingRows, followerRows, posts, suggestedRows, lb] = await Promise.all([
      loadFriendsTabFollowing(userId),
      fetchFollowersForProfileUsername(un),
      getUserRankings(userId),
      fetchSuggestedFriendProfiles(userId),
      fetchLeaderboardByRankedCount().catch((err) => {
        console.warn('friends leaderboard load:', err);
        return [] as LeaderboardRow[];
      }),
    ]);

    setFollowing(followingRows);
    setFollowers(followerRows);
    setSuggested(suggestedRows);
    setRankedCount(posts.filter((p) => !isRadarOnlyDbRow(p)).length);
    setLeaderboard(lb);
  }, [userId, authUsername, session]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      load()
        .catch((e) => console.warn('friends load:', e))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load().catch((e) => console.warn('friends refresh:', e));
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    const q = debouncedFind.trim();
    if (q.length < 2) {
      setFindResults([]);
      setFindLoading(false);
      return;
    }
    let cancelled = false;
    setFindLoading(true);
    searchProfilesForFindPeople(q, userId ?? '', selfUsername ?? '')
      .then((rows) => {
        if (!cancelled) setFindResults(rows);
      })
      .catch((e) => {
        console.warn('find people search:', e);
        if (!cancelled) setFindResults([]);
      })
      .finally(() => {
        if (!cancelled) setFindLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedFind, selfUsername, userId]);

  const reloadFollowingOnly = useCallback(async () => {
    if (!userId) return;
    try {
      const rows = await loadFriendsTabFollowing(userId);
      setFollowing(rows);
    } catch (e) {
      console.warn('reload following:', e);
    }
  }, [userId]);

  const handleToggleFollowTarget = useCallback(
    async (targetUsername: string) => {
      if (!userId || !targetUsername || usernamesMatch(targetUsername, selfUsername)) return;
      const norm = targetUsername.toLowerCase();
      const isFollowing = followingLower.has(norm);
      if (isMandatoryFollowTarget(norm) && isFollowing) return;
      try {
        if (isFollowing) {
          await unfollowUsername(userId, targetUsername);
        } else {
          await followUsername(userId, targetUsername);
        }
        await reloadFollowingOnly();
      } catch (e) {
        console.warn('toggle follow:', e);
      }
    },
    [userId, selfUsername, followingLower, reloadFollowingOnly]
  );

  const openProfile = useCallback(
    (uname: string) => {
      const u = uname.trim();
      if (!u || u === selfUsername) return;
      router.push({ pathname: '/user/[username]', params: { username: u } });
    },
    [router, selfUsername]
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <ActivityIndicator color={BaggedColors.dark} />
      </SafeAreaView>
    );
  }

  if (!userId || !selfUsername) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
        <Text style={styles.muted}>Sign in with a profile to use Friends.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: BaggedLayout.screenPadding + BaggedLayout.rateFabListInset },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text style={styles.pageTitle}>Friends</Text>

        <View style={styles.searchWrap}>
          <TextField
            value={findQuery}
            onChangeText={setFindQuery}
            placeholder="Search by username or bio..."
            autoCapitalize="none"
            autoCorrect={false}
            disableAutofill
          />
        </View>

        {findQuery.trim().length >= 2 ? (
          <View style={styles.searchResults}>
            {findLoading ? (
              <Text style={styles.searchHint}>Loading…</Text>
            ) : findResults.length === 0 ? (
              <Text style={styles.searchHint}>No matches</Text>
            ) : (
              findResults.map((u) => {
                const isFollowing = followingLower.has(u.username.toLowerCase());
                const lockedMandatory = isMandatoryFollowTarget(u.username) && isFollowing;
                const canOpen = u.username !== selfUsername;
                return (
                  <View key={u.id} style={styles.card}>
                    <Pressable
                      onPress={() => canOpen && openProfile(u.username)}
                      disabled={!canOpen}
                      style={styles.cardMain}
                      accessibilityRole="button"
                      accessibilityLabel={`@${u.username} profile`}>
                      <Avatar
                        char={(u.username[0] ?? '?').toUpperCase()}
                        color={u.avatarColor ?? BaggedColors.accent}
                        size={40}
                      />
                      <View style={styles.cardTextCol}>
                        <View style={styles.cardNameRow}>
                          <UsernameLink
                            username={u.username}
                            style={styles.cardName}
                            static={!canOpen}
                            verified={u.isVerifiedAmbassador}
                          />
                        </View>
                        {u.isVerifiedAmbassador ? <VerifiedAmbassadorBadge compact /> : null}
                        <Text style={styles.cardMeta} numberOfLines={2}>
                          {u.bio?.trim() ? u.bio : 'No bio yet'}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      disabled={lockedMandatory}
                      onPress={() => {
                        if (lockedMandatory) return;
                        handleToggleFollowTarget(u.username);
                      }}
                      style={[
                        isFollowing ? styles.pillMuted : styles.followBackBtn,
                        lockedMandatory ? styles.followBtnDisabled : null,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={isFollowing ? `Unfollow ${u.username}` : `Follow ${u.username}`}>
                      <Text style={isFollowing ? styles.pillMutedText : styles.followBackText}>
                        {isFollowing ? 'Following' : 'Follow'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        <View style={styles.hero}>
          <Avatar
            char={(selfUsername[0] ?? '?').toUpperCase()}
            color={selfAvatarColor ?? BaggedColors.accent}
            size={56}
          />
          <View style={styles.heroMid}>
            <UsernameLink
              username={selfUsername}
              style={styles.heroHandle}
              static
              verified={selfVerifiedAmbassador}
            />
            <Pressable
              onPress={() => router.push('/leaderboard')}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={
                selfLeaderboardRank != null
                  ? `View leaderboard, you are ranked number ${selfLeaderboardRank}`
                  : 'View leaderboard'
              }>
              <Text style={styles.heroSub}>
                {rankedCount} items ranked
                {selfLeaderboardRank != null ? ` · #${selfLeaderboardRank} on leaderboard` : ''}
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={() => setInviteVisible(true)}
          style={({ pressed }) => [styles.inviteRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Invite friends">
          <View style={styles.inviteRowMain}>
            <View style={styles.inviteIconWrap}>
              <Ionicons name="share-outline" size={20} color={BaggedColors.accent} />
            </View>
            <View style={styles.inviteTextCol}>
              <Text style={styles.inviteTitle}>Invite friends</Text>
              <Text style={styles.inviteSubtitle}>Share your referral code</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={BaggedColors.muted} />
        </Pressable>

        {leaderboard.length > 0 ? (
          <View style={styles.leaderboardBlock}>
            <Pressable
              onPress={() => router.push('/leaderboard')}
              style={({ pressed }) => [styles.leaderboardHeader, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="View full Bagged leaderboard">
              <Text style={styles.sectionLabel}>Bagged leaderboard</Text>
              <View style={styles.leaderboardLink}>
                <Text style={styles.leaderboardLinkText}>View all</Text>
                <Ionicons name="chevron-forward" size={16} color={BaggedColors.accent} />
              </View>
            </Pressable>
            <LeaderboardList
              rows={leaderboard.slice(0, 3)}
              activeUsername={selfUsername}
              onPressUser={openProfile}
            />
            {leaderboard.length > 3 ? (
              <Pressable
                onPress={() => router.push('/leaderboard')}
                style={({ pressed }) => [styles.leaderboardFooter, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`View all ${leaderboard.length} leaderboard entries`}>
                <Text style={styles.leaderboardFooterText}>
                  See all {leaderboard.length} rankers
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Suggested friends</Text>
        <Text style={styles.sectionHint}>
          Verified ambassadors appear first, then people who share your diet tags, then sorted by
          items ranked.
        </Text>
        {suggested.length === 0 ? (
          <Text style={styles.emptySuggested}>No other profiles yet.</Text>
        ) : (
          suggested.map((u) => {
            const isFollowing = followingLower.has(u.username.toLowerCase());
            const lockedMandatory = isMandatoryFollowTarget(u.username) && isFollowing;
            const canOpen = u.username !== selfUsername;
            return (
              <View key={u.id} style={styles.card}>
                <Pressable
                  onPress={() => canOpen && openProfile(u.username)}
                  disabled={!canOpen}
                  style={styles.cardMain}
                  accessibilityRole="button"
                  accessibilityLabel={`@${u.username} profile`}>
                  <Avatar
                    char={(u.username[0] ?? '?').toUpperCase()}
                    color={u.avatarColor ?? BaggedColors.accent}
                    size={40}
                  />
                  <View style={styles.cardTextCol}>
                    <View style={styles.cardNameRow}>
                      <UsernameLink
                        username={u.username}
                        style={styles.cardName}
                        static={!canOpen}
                        verified={u.isVerifiedAmbassador}
                      />
                    </View>
                    {u.isVerifiedAmbassador ? <VerifiedAmbassadorBadge compact /> : null}
                    <Text style={styles.cardMeta} numberOfLines={2}>
                      {(u.rankedCount ?? 0) > 0
                        ? `${u.rankedCount} items ranked`
                        : 'No rankings yet'}
                      {u.bio?.trim() ? ` · ${u.bio}` : ''}
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
                </Pressable>
                <Pressable
                  disabled={lockedMandatory}
                  onPress={() => {
                    if (lockedMandatory) return;
                    handleToggleFollowTarget(u.username);
                  }}
                  style={[
                    isFollowing ? styles.pillMuted : styles.followBackBtn,
                    lockedMandatory ? styles.followBtnDisabled : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={isFollowing ? `Unfollow ${u.username}` : `Follow ${u.username}`}>
                  <Text
                    style={[
                      isFollowing ? styles.pillMutedText : styles.followBackText,
                    ]}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </Pressable>
              </View>
            );
          })
        )}

        <Text style={[styles.sectionLabel, styles.followingHeader]}>Following</Text>

        {following.map((f) => {
          const canOpen = f.username !== selfUsername;
          return (
            <View key={f.id} style={styles.card}>
              <Pressable
                onPress={() => canOpen && openProfile(f.username)}
                disabled={!canOpen}
                style={styles.cardMain}
                accessibilityRole="button"
                accessibilityLabel={`@${f.username} profile`}>
                <Avatar
                  char={(f.username[0] ?? '?').toUpperCase()}
                  color={f.avatarColor ?? BaggedColors.accent}
                  size={40}
                />
                <View style={styles.cardTextCol}>
                  <UsernameLink
                    username={f.username}
                    style={styles.cardName}
                    static={!canOpen}
                    verified={f.isVerifiedAmbassador}
                  />
                  <Text style={styles.cardMeta}>
                    {f.rankedCount} items ranked · View profile
                  </Text>
                </View>
              </Pressable>
              {f.isMandatory ? (
                <View style={styles.pillMuted}>
                  <Text style={styles.pillMutedText}>Following</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => handleToggleFollowTarget(f.username)}
                  style={styles.pillMuted}
                  accessibilityRole="button"
                  accessibilityLabel={`Unfollow ${f.username}`}>
                  <Text style={styles.pillMutedText}>Following</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {following.length === 0 ? (
          <Text style={styles.emptyFollowing}>
            Not following anyone yet — search above to find people.
          </Text>
        ) : null}

        <Text style={[styles.sectionLabel, styles.followersHeader]}>Followers</Text>
        {followers.length === 0 ? (
          <Text style={styles.emptyFollowers}>No followers yet</Text>
        ) : (
          followers.map((f) => {
            const isFollowing = followingLower.has(f.username.toLowerCase());
            const canOpen = f.username !== selfUsername && f.username.length > 0;
            return (
              <View key={f.username} style={styles.card}>
                <Pressable
                  onPress={() => canOpen && openProfile(f.username)}
                  disabled={!canOpen}
                  style={styles.cardMain}
                  accessibilityRole="button">
                  <Avatar
                    char={(f.username[0] ?? '?').toUpperCase()}
                    color={f.avatarColor ?? BaggedColors.accent}
                    size={40}
                  />
                  <View style={styles.cardTextCol}>
                    <UsernameLink
                    username={f.username}
                    style={styles.cardName}
                    static={!canOpen}
                    verified={f.isVerifiedAmbassador}
                  />
                    <Text style={styles.cardMeta}>
                      {canOpen ? 'Tap to view profile' : 'follows you'}
                    </Text>
                  </View>
                </Pressable>
                {!isFollowing ? (
                  <Pressable
                    onPress={() => handleToggleFollowTarget(f.username)}
                    style={styles.followBackBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Follow back ${f.username}`}>
                    <Text style={styles.followBackText}>Follow Back</Text>
                  </Pressable>
                ) : (
                  <View style={styles.pillMuted}>
                    <Text style={styles.pillMutedText}>Following</Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
      <InviteFriendsModal visible={inviteVisible} onClose={() => setInviteVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BaggedColors.content,
  },
  centered: {
    flex: 1,
    backgroundColor: BaggedColors.content,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  scrollContent: {
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 8,
  },
  pageTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.dark,
    marginBottom: 12,
  },
  searchWrap: {
    marginBottom: 16,
  },
  searchResults: {
    marginBottom: 16,
  },
  searchHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    paddingVertical: 8,
    textAlign: 'center',
  },
  hero: {
    backgroundColor: BaggedColors.dark,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
  },
  heroMid: {
    flex: 1,
    minWidth: 0,
  },
  heroHandle: {
    fontFamily: BaggedFonts.body,
    fontWeight: '700',
    fontSize: 20,
    color: BaggedColors.white,
  },
  heroSub: {
    marginTop: 2,
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  inviteRow: {
    backgroundColor: BaggedColors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    ...BaggedLayout.shadowCard,
  },
  inviteRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  inviteIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BaggedColors.accentPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteTextCol: {
    flex: 1,
    minWidth: 0,
  },
  inviteTitle: {
    fontFamily: BaggedFonts.body,
    fontWeight: '700',
    fontSize: 14,
    color: BaggedColors.dark,
  },
  inviteSubtitle: {
    marginTop: 2,
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
  },
  leaderboardBlock: {
    marginBottom: 20,
  },
  leaderboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  leaderboardLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  leaderboardLinkText: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  leaderboardFooter: {
    alignItems: 'center',
    paddingTop: 10,
  },
  leaderboardFooterText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.accent,
  },
  pressed: {
    opacity: 0.8,
  },
  sectionLabel: {
    fontFamily: BaggedFonts.body,
    fontWeight: '700',
    fontSize: 13,
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    lineHeight: 17,
    marginBottom: 12,
    marginTop: -4,
  },
  followingHeader: {
    marginTop: 24,
    marginBottom: 12,
  },
  card: {
    backgroundColor: BaggedColors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...BaggedLayout.shadowCard,
  },
  cardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  cardTextCol: {
    flex: 1,
    minWidth: 0,
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
    color: BaggedColors.dark,
  },
  cardMeta: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
  },
  cardDietRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
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
  pillMuted: {
    flexShrink: 0,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: 'transparent',
  },
  pillMutedText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.muted,
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
  emptyFollowing: {
    textAlign: 'center',
    paddingVertical: 20,
    paddingBottom: 10,
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
  },
  emptySuggested: {
    textAlign: 'center',
    paddingVertical: 16,
    paddingBottom: 8,
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
  },
  followBtnDisabled: {
    opacity: 0.75,
  },
  followersHeader: {
    marginTop: 24,
    marginBottom: 12,
  },
  emptyFollowers: {
    textAlign: 'center',
    paddingVertical: 20,
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
  },
  muted: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.muted,
    textAlign: 'center',
  },
});
