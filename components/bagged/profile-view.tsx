import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
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

import { AutoFitText } from './auto-fit-text';
import { Avatar } from './avatar';
import { MacrosPills } from './macros-pills';
import { ScoreBadge } from './score-badge';
import { TextField } from './text-field';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  fetchFollowerFollowingCounts,
  fetchLeaderboardByRankedCount,
  fetchProfileByUsername,
  followUsername,
  getUserRankings,
  isRadarOnlyDbRow,
  normalizeMacros,
  normalizedDescriptionKeyFromItem,
  unfollowUsername,
  viewerFollowsUsername,
  type LeaderboardRow,
  type ProfileRow,
  type RankedPostRow,
} from '@/lib/data';
import { formatProductDisplayName } from '@/lib/format';
import { computeScoresByCategory, normalizeVibe } from '@/lib/ranking';
import { useAuth } from '@/providers/auth-provider';
import { useDisplaySettings } from '@/providers/display-settings-provider';

type ProfileViewProps = {
  username: string;
  /** When true, hides the follow button + back arrow (used by the self-profile tab). */
  isSelf: boolean;
  /** Show a back chevron + handler — used on /user/[username] only. */
  onBack?: () => void;
  /** Top tab bar already applies the status-bar inset — skip top on tab profile only. */
  omitTopSafeArea?: boolean;
  /** Tab shell shows floating + RATE ITEM — add scroll inset so content isn’t hidden. */
  extraBottomInset?: number;
};

type ScoredRow = RankedPostRow & { rating: number };

export function ProfileView({ username, isSelf, onBack, omitTopSafeArea, extraBottomInset = 0 }: ProfileViewProps) {
  const router = useRouter();
  const { userId } = useAuth();
  const { showMacroNutrition } = useDisplaySettings();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [posts, setPosts] = useState<RankedPostRow[]>([]);
  const [counts, setCounts] = useState<{ followers: number; following: number }>({
    followers: 0,
    following: 0,
  });
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async () => {
    if (!username) return;
    const prof = await fetchProfileByUsername(username);
    setProfile(prof);
    if (!prof) {
      setPosts([]);
      setCounts({ followers: 0, following: 0 });
      setFollowing(false);
      setLeaderboard([]);
      return;
    }
    const [postRows, c, follows, lb] = await Promise.all([
      getUserRankings(prof.id),
      fetchFollowerFollowingCounts({ username, userId: prof.id }),
      userId && !isSelf ? viewerFollowsUsername(userId, username) : Promise.resolve(false),
      fetchLeaderboardByRankedCount().catch((err) => {
        console.warn('leaderboard load:', err);
        return [] as LeaderboardRow[];
      }),
    ]);
    setPosts(postRows.filter((p) => !isRadarOnlyDbRow(p)));
    setCounts(c);
    setFollowing(Boolean(follows));
    setLeaderboard(lb);
  }, [username, userId, isSelf]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      load()
        .catch((err) => console.warn('profile load:', err))
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
    await load().catch((err) => console.warn('profile refresh:', err));
    setRefreshing(false);
  }, [load]);

  const triedScored = useMemo<ScoredRow[]>(
    () =>
      computeScoresByCategory(posts.map((p) => ({ ...p, vibe: normalizeVibe(p.vibe) }))) as ScoredRow[],
    [posts]
  );

  /** Filter the scored list against the in-profile search box. */
  const filteredRanked = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return triedScored;
    return triedScored.filter((p) => {
      const blob = [
        p.item,
        p.product_brand,
        p.store,
        p.note,
        p.category,
        ...(Array.isArray(p.stores) ? p.stores : []),
      ]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ');
      return blob.includes(q);
    });
  }, [triedScored, searchQuery]);

  const byCategory = useMemo(() => {
    const buckets = new Map<string, ScoredRow[]>();
    for (const row of filteredRanked) {
      const key = row.category || 'Snacks';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(row);
    }
    return Array.from(buckets.entries())
      .map(([cat, items]) => ({
        category: cat,
        items: [...items].sort((a, b) => b.rating - a.rating),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [filteredRanked]);

  /** Categories start collapsed; user expands to reveal items. */
  const isExpanded = (cat: string) => expanded[cat] === true;
  const toggleCategory = (cat: string) =>
    setExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }));

  const handleToggleFollow = async () => {
    if (!userId || isSelf || followBusy) return;
    setFollowBusy(true);
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    setCounts((c) => ({
      ...c,
      followers: Math.max(0, c.followers + (wasFollowing ? -1 : 1)),
    }));
    try {
      if (wasFollowing) {
        await unfollowUsername(userId, username);
      } else {
        await followUsername(userId, username);
      }
    } catch (err) {
      console.warn('follow toggle failed:', err);
      setFollowing(wasFollowing);
      setCounts((c) => ({
        ...c,
        followers: Math.max(0, c.followers + (wasFollowing ? 1 : -1)),
      }));
    } finally {
      setFollowBusy(false);
    }
  };

  return (
    <SafeAreaView
      style={styles.screen}
      edges={omitTopSafeArea ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          extraBottomInset > 0 && { paddingBottom: 32 + extraBottomInset },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />
        }>
        <View style={styles.headerCard}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={10} style={styles.headerBack}>
              <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            </Pressable>
          ) : null}

          {isSelf ? (
            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={10}
              style={styles.headerSettings}>
              <Ionicons name="settings-outline" size={20} color="#FFFFFF" />
            </Pressable>
          ) : null}

          <View style={styles.heroRow}>
            <Avatar
              char={(username || '?').charAt(0).toUpperCase()}
              color={profile?.avatar_color ?? BaggedColors.accent}
              size={72}
            />
            <View style={styles.heroBody}>
              <Text style={styles.handle}>@{username}</Text>
              <Text style={styles.bio}>
                {profile?.bio?.trim() || (isSelf ? 'Open settings to add a bio.' : '')}
              </Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <Stat label="Ranked" value={posts.length} />
            <Stat
              label="Followers"
              value={counts.followers}
              onPress={() =>
                router.push({
                  pathname: '/connections/[username]/[kind]',
                  params: { username, kind: 'followers' },
                })
              }
            />
            <Stat
              label="Following"
              value={counts.following}
              onPress={() =>
                router.push({
                  pathname: '/connections/[username]/[kind]',
                  params: { username, kind: 'following' },
                })
              }
            />
          </View>

          {isSelf ? null : (
            <Pressable
              onPress={handleToggleFollow}
              disabled={followBusy || !userId}
              style={[styles.followBtn, following && styles.followBtnActive]}>
              <Text style={[styles.followText, following && styles.followTextActive]}>
                {following ? 'Following' : 'Follow'}
              </Text>
            </Pressable>
          )}
        </View>

        <LeaderboardSection
          rows={leaderboard}
          activeUsername={username}
          expanded={leaderboardExpanded}
          onToggleExpand={() => setLeaderboardExpanded((v) => !v)}
          onPressUser={(u) => {
            if (!u || u === username) return;
            router.push({ pathname: '/user/[username]', params: { username: u } });
          }}
        />

        {posts.length > 0 ? (
          <View style={styles.searchBlock}>
            <TextField
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search this list"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={BaggedColors.dark} />
          </View>
        ) : !profile ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>Profile not found</Text>
            <Text style={styles.emptyBody}>
              We couldn&apos;t find anyone with that username. Check the spelling?
            </Text>
          </View>
        ) : byCategory.length === 0 ? (
          <View style={styles.centered}>
            {searchQuery.trim() ? (
              <>
                <Text style={styles.emptyTitle}>No matches</Text>
                <Text style={styles.emptyBody}>Try clearing the search or a different keyword.</Text>
              </>
            ) : (
              <>
                <Text style={styles.emptyTitle}>
                  {isSelf ? 'No rankings yet' : `@${username} hasn't ranked anything yet.`}
                </Text>
                <Text style={styles.emptyBody}>
                  {isSelf
                    ? 'Tap the orange + button to rate your first product.'
                    : "Check back later — they'll show up here."}
                </Text>
              </>
            )}
          </View>
        ) : (
          byCategory.map(({ category, items }) => {
            const open = isExpanded(category);
            return (
              <View key={category} style={styles.categoryBlock}>
                <Pressable
                  onPress={() => toggleCategory(category)}
                  hitSlop={6}
                  style={styles.categoryHeader}>
                  <Text style={styles.categoryTitle}>
                    {category} <Text style={styles.categoryCount}>{items.length}</Text>
                  </Text>
                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={BaggedColors.muted}
                  />
                </Pressable>
                {open ? (
                  <View style={styles.categoryBody}>
                    {items.map((row, idx) => {
                      const macros = normalizeMacros(row.macros);
                      return (
                        <Pressable
                          key={String(row.id)}
                          onPress={() => {
                            const dk =
                              String(
                                (row as { description_key?: string | null }).description_key ?? ''
                              ).trim().toLowerCase() || normalizedDescriptionKeyFromItem(row.item);
                            router.push({
                              pathname: '/product/detail',
                              params: {
                                item: row.item,
                                brand: row.product_brand ?? '',
                                category: row.category,
                                store: row.store ?? '',
                                descriptionKey: dk,
                              },
                            });
                          }}
                          style={({ pressed }) => [styles.rowItem, pressed && styles.pressed]}>
                          <Text style={styles.rank} numberOfLines={1}>
                            #{idx + 1}
                          </Text>
                          <View style={styles.rowBody}>
                            <AutoFitText style={styles.rowItemName} numberOfLines={2}>
                              {formatProductDisplayName(row.item)}
                            </AutoFitText>
                            <AutoFitText style={styles.rowMeta} numberOfLines={1}>
                              {row.store ?? ''}
                              {row.product_brand
                                ? ` · ${formatProductDisplayName(row.product_brand)}`
                                : ''}
                            </AutoFitText>
                            {showMacroNutrition ? <MacrosPills macros={macros} size="sm" /> : null}
                          </View>
                          <ScoreBadge rating={row.rating} size={14} />
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  onPress,
}: {
  label: string;
  value: number;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.statBox, pressed && { opacity: 0.75 }]}
        accessibilityRole="button">
        {body}
      </Pressable>
    );
  }
  return <View style={styles.statBox}>{body}</View>;
}

function LeaderboardSection({
  rows,
  activeUsername,
  expanded,
  onToggleExpand,
  onPressUser,
}: {
  rows: LeaderboardRow[];
  activeUsername: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onPressUser: (username: string) => void;
}) {
  if (rows.length === 0) return null;
  const visible = expanded ? rows : rows.slice(0, 3);
  return (
    <View style={styles.leaderboardBlock}>
      <View style={styles.leaderboardHeader}>
        <Text style={styles.leaderboardTitle}>Bagged leaderboard</Text>
        {rows.length > 3 ? (
          <Pressable onPress={onToggleExpand} hitSlop={6}>
            <Text style={styles.leaderboardToggle}>
              {expanded ? 'Show less' : `Show all ${rows.length}`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.leaderboardBody}>
        {visible.map((row) => {
          const active = row.username === activeUsername;
          return (
            <Pressable
              key={row.userId}
              onPress={() => onPressUser(row.username)}
              hitSlop={4}
              style={[styles.leaderboardRow, active && styles.leaderboardRowActive]}>
              <Text
                style={[styles.leaderboardRank, active && styles.leaderboardRankActive]}
                numberOfLines={1}>
                #{row.rank}
              </Text>
              <Avatar
                char={row.username.charAt(0).toUpperCase()}
                color={row.avatarColor ?? BaggedColors.accent}
                size={32}
              />
              <AutoFitText
                style={[styles.leaderboardName, active && styles.leaderboardNameActive]}
                numberOfLines={1}>
                @{row.username}
              </AutoFitText>
              <Text style={styles.leaderboardCount}>
                {row.rankedCount} ranked
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BaggedColors.content },
  scroll: {
    paddingBottom: 32,
  },
  headerCard: {
    backgroundColor: BaggedColors.dark,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
  },
  headerBack: {
    position: 'absolute',
    top: 16,
    left: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    zIndex: 1,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 16,
    marginBottom: 16,
  },
  heroBody: {
    flex: 1,
  },
  handle: {
    fontFamily: BaggedFonts.body,
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  bio: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: '#FFFFFF',
  },
  statLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  followBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: BaggedColors.accent,
  },
  followBtnActive: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  followText: {
    fontFamily: BaggedFonts.display,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  followTextActive: {
    color: '#FFFFFF',
  },
  headerSettings: {
    position: 'absolute',
    top: 16,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    zIndex: 1,
  },
  searchBlock: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 4,
  },
  leaderboardBlock: {
    marginTop: 18,
    paddingHorizontal: 20,
  },
  leaderboardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  leaderboardTitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  leaderboardToggle: {
    fontFamily: BaggedFonts.display,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  leaderboardBody: {
    backgroundColor: BaggedColors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    overflow: 'hidden',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderSoft,
  },
  leaderboardRowActive: {
    backgroundColor: BaggedColors.accentPale,
  },
  leaderboardRank: {
    fontFamily: BaggedFonts.display,
    fontSize: 16,
    color: BaggedColors.muted,
    minWidth: 56,
    flexShrink: 0,
    textAlign: 'center',
    lineHeight: 20,
    includeFontPadding: false,
  },
  leaderboardRankActive: {
    color: BaggedColors.accent,
  },
  leaderboardName: {
    flex: 1,
    minWidth: 0,
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
  leaderboardNameActive: {
    color: BaggedColors.accent,
  },
  leaderboardCount: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    fontWeight: '600',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  categoryCount: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '500',
    color: BaggedColors.muted,
  },
  centered: {
    paddingHorizontal: 24,
    paddingVertical: 64,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.dark,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.muted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  categoryBlock: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  categoryTitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  categoryBody: {
    backgroundColor: BaggedColors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    overflow: 'hidden',
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderSoft,
  },
  pressed: { opacity: 0.7 },
  rank: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.muted,
    minWidth: 56,
    flexShrink: 0,
    textAlign: 'center',
    lineHeight: 22,
    includeFontPadding: false,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowItemName: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.dark,
    lineHeight: 18,
  },
  rowMeta: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    marginTop: 2,
  },
});
