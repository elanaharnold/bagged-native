import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExpandableMentionText } from './expandable-text';
import { AutoFitText } from './auto-fit-text';
import { Avatar } from './avatar';
import { UsernameLink } from './username-link';
import { MacrosPills } from './macros-pills';
import { PostNoteEditorModal } from './post-note-editor-modal';
import { InviteFriendsModal } from './invite-friends-modal';
import { ProfileEditorModal } from './profile-editor-modal';
import { RerankRequiredBanner, RerankRequiredChip } from './rerank-required-banner';
import { ScoreBadge } from './score-badge';
import { VerifiedAmbassadorBadge } from './verified-ambassador-badge';
import { KeyboardFormScroll } from '@/components/bagged/keyboard-form-scroll';
import { LeaderboardList } from '@/components/bagged/leaderboard-list';
import { ALL_STORES, dietTagCountsFromRows, rowMatchesDietFilters, rowMatchesStoreFilter, type FilterStore } from '@/components/bagged/filter-bar';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  getParentCategory,
  getParentCategoryById,
  getSubcategoriesForParent,
  getSubcategory,
  PARENT_CATEGORIES,
  subcategoryForRow,
} from '@/constants/categories';
import { DIET_TAGS } from '@/constants/diet-tags';
import { displayStoreForRow } from '@/constants/grocery';
import {
  fetchFollowerFollowingCounts,
  fetchLeaderboardByRankedCount,
  ensureProfileForUser,
  fetchProfileByUsername,
  followUsername,
  getUserRankings,
  isAdminUsername,
  isMandatoryFollowTarget,
  isRadarOnlyDbRow,
  leaderboardRankForUsername,
  normalizePostMacros,
  persistCanonicalRatingDrift,
  productDescriptionKey,
  setVerifiedAmbassador,
  unfollowUsername,
  updatePostNote,
  updateOwnProfile,
  viewerFollowsUsername,
  type LeaderboardRow,
  type ProfileRow,
  type RankedPostRow,
} from '@/lib/data';
import { confirmAndDeleteRankedPost } from '@/lib/confirm-delete-ranked-post';
import { formatProductDisplayName } from '@/lib/format';
import { pokeFeedRefresh } from '@/lib/feed-refresh-poke';
import {
  canonicalRatingsFromRankedRows,
  normalizeVibe,
  postNeedsRecategorization,
  sortRowsByRankPosition,
} from '@/lib/ranking';
import { rowMatchesTwoLevelCategoryFilter, subcategoryLabelForRow } from '@/lib/categories';
import { shareScoreCardFromRankedRow } from '@/lib/share-score-card';
import { twoLevelCategoryListShareableFromRows } from '@/lib/share-category-list';
import { useAuth } from '@/providers/auth-provider';
import { useDisplaySettings } from '@/providers/display-settings-provider';
import { useShareScoreCard } from '@/providers/share-score-card-provider';
import { useVerifiedAmbassadorUsernames } from '@/hooks/use-verified-ambassador-usernames';

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
  const { userId, username: viewerUsername } = useAuth();
  const { showMacroNutrition } = useDisplaySettings();
  const { openShareScoreCard, openCategoryListShareable } = useShareScoreCard();
  const verifiedUsernames = useVerifiedAmbassadorUsernames();

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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const [storeFilter, setStoreFilter] = useState<FilterStore>(ALL_STORES);
  const [dietFilters, setDietFilters] = useState<string[]>([]);
  const [parentCategoryFilter, setParentCategoryFilter] = useState<string | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);
  const [noteEditorPost, setNoteEditorPost] = useState<ScoredRow | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [verifiedToggleBusy, setVerifiedToggleBusy] = useState(false);

  const profileDietTags = profile?.diet_tags ?? [];
  const showAdminVerifiedToggle = !isSelf && isAdminUsername(viewerUsername) && Boolean(profile?.id);

  const load = useCallback(async () => {
    if (isSelf) {
      if (!userId) return;
    } else if (!username?.trim()) {
      return;
    }
    const prof =
      isSelf && userId
        ? await ensureProfileForUser(userId)
        : await fetchProfileByUsername(username.trim());
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
      fetchFollowerFollowingCounts({ username: prof.username, userId: prof.id }),
      userId && !isSelf ? viewerFollowsUsername(userId, prof.username) : Promise.resolve(false),
      fetchLeaderboardByRankedCount().catch((err) => {
        console.warn('leaderboard load:', err);
        return [] as LeaderboardRow[];
      }),
    ]);
    const ranked = postRows.filter((p) => !isRadarOnlyDbRow(p));
    if (isSelf && userId) {
      const scored = canonicalRatingsFromRankedRows(
        ranked.map((p) => ({ ...p, vibe: normalizeVibe(p.vibe) }))
      );
      void persistCanonicalRatingDrift(userId, scored, ranked);
    }
    setPosts(ranked);
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
      canonicalRatingsFromRankedRows(
        posts.map((p) => ({ ...p, vibe: normalizeVibe(p.vibe) }))
      ) as ScoredRow[],
    [posts]
  );

  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return triedScored;
    return triedScored.filter((p) => {
      const blob = [
        p.item,
        p.product_brand,
        p.store,
        p.note,
        p.category,
        getSubcategory(subcategoryForRow(p))?.label,
        ...(Array.isArray(p.stores) ? p.stores : []),
      ]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ');
      return blob.includes(q);
    });
  }, [triedScored, searchQuery]);

  const storeFiltered = useMemo(
    () => searchFiltered.filter((r) => rowMatchesStoreFilter(r, storeFilter)),
    [searchFiltered, storeFilter]
  );

  const dietFiltered = useMemo(
    () => storeFiltered.filter((r) => rowMatchesDietFilters(r, dietFilters)),
    [storeFiltered, dietFilters]
  );

  const dietCounts = useMemo(() => dietTagCountsFromRows(storeFiltered), [storeFiltered]);

  const parentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of dietFiltered) {
      const subId = subcategoryForRow(row);
      const parent = getParentCategory(subId);
      if (parent) counts.set(parent.id, (counts.get(parent.id) ?? 0) + 1);
    }
    return counts;
  }, [dietFiltered]);

  const subcategoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!parentCategoryFilter) return counts;
    for (const row of dietFiltered) {
      const subId = subcategoryForRow(row);
      if (getParentCategory(subId)?.id !== parentCategoryFilter) continue;
      counts.set(subId, (counts.get(subId) ?? 0) + 1);
    }
    return counts;
  }, [dietFiltered, parentCategoryFilter]);

  const relevantStores = useMemo(() => {
    const stores = new Set<string>();
    for (const row of searchFiltered) {
      const s = displayStoreForRow(row);
      if (s) stores.add(s);
    }
    return [...stores].sort((a, b) => a.localeCompare(b));
  }, [searchFiltered]);

  const filteredRanked = useMemo(
    () =>
      dietFiltered.filter((p) =>
        rowMatchesTwoLevelCategoryFilter(p, parentCategoryFilter, subcategoryFilter)
      ),
    [dietFiltered, parentCategoryFilter, subcategoryFilter]
  );

  const showRankNumbers = subcategoryFilter != null;
  const showSubcategoryOnRows = subcategoryFilter == null;

  const displayRanked = useMemo(() => {
    if (!showRankNumbers) {
      return [...filteredRanked].sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
    }
    if (subcategoryFilter != null) {
      return sortRowsByRankPosition(filteredRanked);
    }
    return [...filteredRanked].sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
  }, [filteredRanked, showRankNumbers, subcategoryFilter]);

  const listTitle = useMemo(() => {
    if (subcategoryFilter) return getSubcategory(subcategoryFilter)?.label ?? 'Rankings';
    if (parentCategoryFilter) {
      return getParentCategoryById(parentCategoryFilter)?.label ?? 'Rankings';
    }
    if (storeFilter !== ALL_STORES) return storeFilter;
    return 'All rankings';
  }, [parentCategoryFilter, subcategoryFilter, storeFilter]);

  const listCount = filteredRanked.length;

  const pendingRerank = useMemo(
    () => (isSelf ? posts.filter((row) => postNeedsRecategorization(row)) : []),
    [isSelf, posts]
  );

  const handleRerankPost = useCallback(
    (postId: string | number) => {
      router.push({
        pathname: '/rate',
        params: { rerankPostId: String(postId) },
      });
    },
    [router]
  );

  const showListFilters = !loading && profile != null && posts.length > 0;

  const handleDeleteRanked = (row: ScoredRow) => {
    if (!userId || !isSelf) return;
    confirmAndDeleteRankedPost(userId, { id: row.id, item: row.item }, () => {
      setPosts((prev) => prev.filter((p) => p.id !== row.id));
    });
  };

  const handleSavePostNote = async (note: string) => {
    if (!userId || !isSelf || !noteEditorPost || noteSaving) return;
    setNoteSaving(true);
    try {
      await updatePostNote(userId, noteEditorPost.id, note);
      const trimmed = note.trim();
      setPosts((prev) =>
        prev.map((p) => (p.id === noteEditorPost.id ? { ...p, note: trimmed } : p))
      );
      setNoteEditorPost(null);
      pokeFeedRefresh();
    } catch (err) {
      console.warn('handleSavePostNote:', err);
      Alert.alert(
        'Could not save',
        err instanceof Error ? err.message : 'Try again in a moment.'
      );
    } finally {
      setNoteSaving(false);
    }
  };

  const handleSaveProfile = async (next: {
    bio: string;
    dietTags: string[];
    zipCode?: string | null;
    birthday?: string | null;
  }) => {
    if (!userId || !isSelf || profileSaving) return;
    setProfileSaving(true);
    try {
      await updateOwnProfile({
        userId,
        bio: next.bio,
        dietTags: next.dietTags,
        ...(next.zipCode !== undefined ? { zipCode: next.zipCode } : {}),
        ...(next.birthday !== undefined ? { birthday: next.birthday } : {}),
      });
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              bio: next.bio || null,
              diet_tags: next.dietTags,
              ...(next.zipCode !== undefined ? { zip_code: next.zipCode } : {}),
              ...(next.birthday !== undefined ? { birthday: next.birthday } : {}),
            }
          : prev
      );
      setProfileEditorOpen(false);
    } catch (err) {
      console.warn('handleSaveProfile:', err);
      Alert.alert(
        'Could not save',
        err instanceof Error ? err.message : 'Try again in a moment.'
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const displayUsername = profile?.username?.trim() || username?.trim() || '';
  const profileLeaderboardRank = useMemo(
    () => leaderboardRankForUsername(leaderboard, displayUsername),
    [leaderboard, displayUsername]
  );

  const handleShareScoreCard = (row: ScoredRow) => {
    if (!isSelf || !displayUsername) return;
    const payload = shareScoreCardFromRankedRow(row, displayUsername);
    if (payload) {
      openShareScoreCard({
        ...payload,
        displayName: displayUsername,
        avatarChar: displayUsername.charAt(0).toUpperCase(),
        avatarColor: profile?.avatar_color ?? undefined,
      });
    }
  };

  const handleShareCategoryList = useCallback(
    (opts: { parentId?: string | null; subcategoryId?: string | null; label: string }) => {
      if (!isSelf || !displayUsername) return;
      const payload = twoLevelCategoryListShareableFromRows(
        opts.label,
        triedScored,
        displayUsername,
        { parentId: opts.parentId, subcategoryId: opts.subcategoryId },
        {
          displayName: displayUsername,
          avatarChar: displayUsername.charAt(0).toUpperCase(),
          avatarColor: profile?.avatar_color ?? undefined,
        }
      );
      if (payload) openCategoryListShareable(payload);
    },
    [isSelf, displayUsername, triedScored, profile?.avatar_color, openCategoryListShareable]
  );

  const shareCategoryListForCurrentFilter = useCallback(() => {
    if (subcategoryFilter) {
      handleShareCategoryList({
        parentId: parentCategoryFilter,
        subcategoryId: subcategoryFilter,
        label: getSubcategory(subcategoryFilter)?.label ?? 'Category',
      });
      return;
    }
    if (parentCategoryFilter) {
      handleShareCategoryList({
        parentId: parentCategoryFilter,
        label: getParentCategoryById(parentCategoryFilter)?.label ?? 'Category',
      });
    }
  }, [parentCategoryFilter, subcategoryFilter, handleShareCategoryList]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, []);

  const closeSearch = useCallback((clearQuery = true) => {
    searchInputRef.current?.blur();
    setSearchOpen(false);
    if (clearQuery) setSearchQuery('');
  }, []);

  const handleToggleFollow = async () => {
    const targetUsername = profile?.username?.trim();
    if (!userId || isSelf || followBusy || !targetUsername) return;
    if (following && isMandatoryFollowTarget(targetUsername)) return;

    setFollowBusy(true);
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    setCounts((c) => ({
      ...c,
      followers: Math.max(0, c.followers + (wasFollowing ? -1 : 1)),
    }));
    try {
      if (wasFollowing) {
        await unfollowUsername(userId, targetUsername);
      } else {
        await followUsername(userId, targetUsername);
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

  const handleToggleVerifiedAmbassador = async (next: boolean) => {
    if (!profile?.id || verifiedToggleBusy) return;
    setVerifiedToggleBusy(true);
    const prior = profile.is_verified_ambassador;
    setProfile((p) => (p ? { ...p, is_verified_ambassador: next } : p));
    try {
      await setVerifiedAmbassador(profile.id, next);
    } catch (err) {
      setProfile((p) => (p ? { ...p, is_verified_ambassador: prior } : p));
      Alert.alert(
        'Could not update',
        err instanceof Error ? err.message : 'Try again in a moment.'
      );
    } finally {
      setVerifiedToggleBusy(false);
    }
  };

  return (
    <SafeAreaView
      style={styles.screen}
      edges={omitTopSafeArea ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}>
      <KeyboardFormScroll
        contentContainerStyle={[
          styles.scroll,
          extraBottomInset > 0 && { paddingBottom: 32 + extraBottomInset },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BaggedColors.green} />
        }>
        <View style={styles.headerCard}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={10} style={styles.headerBack}>
              <Ionicons name="chevron-back" size={22} color={BaggedColors.green} />
            </Pressable>
          ) : null}

          <View style={styles.heroRow}>
            <Avatar
              char={(displayUsername || '?').charAt(0).toUpperCase()}
              color={profile?.avatar_color ?? BaggedColors.accent}
              size={72}
            />
            <View style={styles.heroBody}>
              <UsernameLink
                username={displayUsername}
                style={styles.handle}
                static={isSelf}
                verified={profile?.is_verified_ambassador}
              />
              {profile?.is_verified_ambassador ? <VerifiedAmbassadorBadge /> : null}
              <Text style={styles.bio}>
                {profile?.bio?.trim() ||
                  (isSelf ? 'Add a bio and diet tags so people know what you review.' : '')}
              </Text>
              {profileDietTags.length > 0 ? (
                <View style={styles.profileDietRow}>
                  {profileDietTags.map((id) => {
                    const tag = DIET_TAGS.find((t) => t.id === id);
                    if (!tag) return null;
                    return (
                      <View
                        key={id}
                        style={[styles.profileDietChip, { backgroundColor: tag.bg }]}>
                        <Text style={[styles.profileDietChipText, { color: tag.color }]}>
                          {tag.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
              {isSelf ? (
                <View style={styles.profileActionRow}>
                  <Pressable
                    onPress={() => setProfileEditorOpen(true)}
                    style={({ pressed }) => [styles.editProfileBtn, pressed && { opacity: 0.8 }]}>
                    <Text style={styles.editProfileBtnText}>Edit profile</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setInviteVisible(true)}
                    style={({ pressed }) => [styles.inviteProfileBtn, pressed && { opacity: 0.8 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Invite friends">
                    <Ionicons name="share-outline" size={16} color={BaggedColors.green} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.statsRow}>
            <Stat label="Ranked" value={posts.length} />
            {profileLeaderboardRank != null ? (
              <Stat
                label="Leaderboard"
                value={`#${profileLeaderboardRank}`}
                onPress={() => router.push('/leaderboard')}
              />
            ) : null}
            <Stat
              label="Followers"
              value={counts.followers}
              onPress={() =>
                router.push({
                  pathname: '/connections/[username]/[kind]',
                  params: { username: displayUsername, kind: 'followers' },
                })
              }
            />
            <Stat
              label="Following"
              value={counts.following}
              onPress={() =>
                router.push({
                  pathname: '/connections/[username]/[kind]',
                  params: { username: displayUsername, kind: 'following' },
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

          {showAdminVerifiedToggle ? (
            <View style={styles.adminVerifiedRow}>
              <Text style={styles.adminVerifiedLabel}>Verified Ambassador</Text>
              <Switch
                value={profile?.is_verified_ambassador ?? false}
                onValueChange={(next) => void handleToggleVerifiedAmbassador(next)}
                disabled={verifiedToggleBusy}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: BaggedColors.accent }}
                thumbColor={BaggedColors.white}
                accessibilityLabel="Toggle verified ambassador badge"
              />
            </View>
          ) : null}
        </View>

        <LeaderboardSection
          rows={leaderboard}
          activeUsername={displayUsername}
          expanded={leaderboardExpanded}
          onToggleExpand={() => setLeaderboardExpanded((v) => !v)}
          onPressUser={(u) => {
            if (!u || u === displayUsername) return;
            router.push({ pathname: '/user/[username]', params: { username: u } });
          }}
        />

        {showListFilters ? (
          <View style={styles.listSearchRow}>
            {searchOpen ? (
              <View style={styles.headerSearchBar}>
                <Ionicons name="search" size={18} color={BaggedColors.muted} />
                <TextInput
                  ref={searchInputRef}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search this list"
                  placeholderTextColor={BaggedColors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={styles.headerSearchInput}
                />
                <Pressable
                  onPress={() => closeSearch(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Close search">
                  <Ionicons name="close-circle" size={20} color={BaggedColors.muted} />
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.listSectionLabel}>Rankings</Text>
                <Pressable
                  onPress={openSearch}
                  style={styles.headerSearchBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Search this list">
                  <Ionicons
                    name={searchQuery.trim() ? 'search' : 'search-outline'}
                    size={22}
                    color={BaggedColors.dark}
                  />
                  {searchQuery.trim() ? <View style={styles.searchActiveDot} /> : null}
                </Pressable>
              </>
            )}
          </View>
        ) : null}

        {showListFilters ? (
          <View style={styles.filtersBlock}>
            {relevantStores.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}>
                <FilterChip
                  label="All stores"
                  active={storeFilter === ALL_STORES}
                  onPress={() => setStoreFilter(ALL_STORES)}
                />
                {relevantStores.map((store) => (
                  <FilterChip
                    key={store}
                    label={store}
                    active={storeFilter === store}
                    onPress={() => setStoreFilter(store as FilterStore)}
                  />
                ))}
              </ScrollView>
            ) : null}

            {dietCounts.size > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}>
                <FilterChip
                  label="Any diet"
                  active={dietFilters.length === 0}
                  onPress={() => setDietFilters([])}
                />
                {DIET_TAGS.filter((tag) => (dietCounts.get(tag.id) ?? 0) > 0).map((tag) => {
                  const active = dietFilters.includes(tag.id);
                  return (
                    <FilterChip
                      key={tag.id}
                      label={`${tag.label} (${dietCounts.get(tag.id)})`}
                      active={active}
                      onPress={() =>
                        setDietFilters((prev) =>
                          active ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                        )
                      }
                    />
                  );
                })}
              </ScrollView>
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}>
              <FilterChip
                label="All"
                active={parentCategoryFilter == null}
                onPress={() => {
                  setParentCategoryFilter(null);
                  setSubcategoryFilter(null);
                }}
              />
              {PARENT_CATEGORIES.filter((p) => (parentCounts.get(p.id) ?? 0) > 0).map((parent) => {
                const active = parentCategoryFilter === parent.id;
                return (
                  <FilterChip
                    key={parent.id}
                    label={`${parent.label} (${parentCounts.get(parent.id)})`}
                    active={active}
                    onPress={() => {
                      setParentCategoryFilter(active ? null : parent.id);
                      setSubcategoryFilter(null);
                    }}
                    onLongPress={
                      isSelf
                        ? () =>
                            handleShareCategoryList({ parentId: parent.id, label: parent.label })
                        : undefined
                    }
                  />
                );
              })}
            </ScrollView>

            {parentCategoryFilter ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}>
                <FilterChip
                  label="All in category"
                  active={subcategoryFilter == null}
                  onPress={() => setSubcategoryFilter(null)}
                  onLongPress={
                    isSelf
                      ? () => {
                          const parent = getParentCategoryById(parentCategoryFilter);
                          if (parent) {
                            handleShareCategoryList({ parentId: parent.id, label: parent.label });
                          }
                        }
                      : undefined
                  }
                />
                {getSubcategoriesForParent(parentCategoryFilter)
                  .filter((sub) => (subcategoryCounts.get(sub.id) ?? 0) > 0)
                  .map((sub) => {
                    const active = subcategoryFilter === sub.id;
                    return (
                      <FilterChip
                        key={sub.id}
                        label={`${sub.label} (${subcategoryCounts.get(sub.id)})`}
                        active={active}
                        onPress={() => setSubcategoryFilter(active ? null : sub.id)}
                        onLongPress={
                          isSelf
                            ? () =>
                                handleShareCategoryList({
                                  parentId: parentCategoryFilter,
                                  subcategoryId: sub.id,
                                  label: sub.label,
                                })
                            : undefined
                        }
                      />
                    );
                  })}
              </ScrollView>
            ) : null}
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={BaggedColors.dark} />
          </View>
        ) : !profile ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>
              {isSelf ? 'Could not load your profile' : 'Profile not found'}
            </Text>
            <Text style={styles.emptyBody}>
              {isSelf
                ? 'Pull to refresh. If this keeps happening, log out and sign in again from Settings or reinstall the app.'
                : "We couldn't find anyone with that username. Check the spelling?"}
            </Text>
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>
              {isSelf ? 'No rankings yet' : `@${displayUsername} hasn't ranked anything yet.`}
            </Text>
            <Text style={styles.emptyBody}>
              {isSelf
                ? 'Tap the orange + button to rate your first product.'
                : "Check back later — they'll show up here."}
            </Text>
          </View>
        ) : displayRanked.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.emptyBody}>Try a different filter or search term.</Text>
          </View>
        ) : (
          <View style={styles.listSection}>
            {isSelf && pendingRerank.length > 0 ? (
              <RerankRequiredBanner
                count={pendingRerank.length}
                onPress={
                  pendingRerank.length === 1
                    ? () => handleRerankPost(pendingRerank[0]!.id)
                    : undefined
                }
              />
            ) : null}
            <Pressable
              onLongPress={isSelf ? shareCategoryListForCurrentFilter : undefined}
              disabled={!isSelf || (!parentCategoryFilter && !subcategoryFilter)}
              delayLongPress={420}
              accessibilityRole="header"
              accessibilityHint={
                isSelf ? 'Long press to share your top items in this category' : undefined
              }>
              <Text style={styles.listHeading}>
                {listTitle} · {listCount} item{listCount === 1 ? '' : 's'}
              </Text>
            </Pressable>
            <View style={styles.categoryBody}>
            {displayRanked.map((row, idx) => {
              const macros = normalizePostMacros(row.macros);
              const subcategoryLabel = showSubcategoryOnRows ? subcategoryLabelForRow(row) : null;
              const needsRerank = isSelf && postNeedsRecategorization(row);
              return (
                <View key={String(row.id)} style={styles.rowItem}>
                  <Pressable
                    onPress={() => {
                      const dk = productDescriptionKey(row.item, row.product_brand);
                      router.push({
                        pathname: '/product/detail',
                        params: {
                          item: row.item,
                          brand: row.product_brand ?? '',
                          category: row.category,
                          subcategory: subcategoryForRow(row),
                          store: row.store ?? '',
                          wantSource: 'profile',
                          descriptionKey: dk,
                        },
                      });
                    }}
                    onLongPress={isSelf ? () => handleShareScoreCard(row) : undefined}
                    delayLongPress={420}
                    style={({ pressed }) => [styles.rowItemMain, pressed && styles.pressed]}>
                    {showRankNumbers && !needsRerank ? (
                      <Text style={styles.rank} numberOfLines={1}>
                        #{idx + 1}
                      </Text>
                    ) : null}
                    <View style={styles.rowBody}>
                      <AutoFitText style={styles.rowItemName} numberOfLines={3}>
                        {formatProductDisplayName(row.item)}
                      </AutoFitText>
                      <AutoFitText style={styles.rowMeta} numberOfLines={1}>
                        {[
                          displayStoreForRow(row) || null,
                          row.product_brand ? formatProductDisplayName(row.product_brand) : null,
                          subcategoryLabel,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </AutoFitText>
                      {showMacroNutrition ? <MacrosPills macros={macros} size="sm" /> : null}
                      {row.note?.trim() ? (
                        <ExpandableMentionText
                          text={row.note.trim()}
                          style={styles.rowNote}
                          mentionStyle={styles.rowNoteMention}
                          numberOfLines={2}
                          quoted
                          verifiedUsernames={verifiedUsernames}
                        />
                      ) : null}
                    </View>
                    <View style={styles.scoreSlot}>
                      {needsRerank ? (
                        <RerankRequiredChip onPress={() => handleRerankPost(row.id)} />
                      ) : (
                        <ScoreBadge rating={row.rating} size={14} />
                      )}
                    </View>
                  </Pressable>
                  {isSelf ? (
                    <View style={styles.rowOwnerActions}>
                      <Pressable
                        onPress={() => setNoteEditorPost(row)}
                        hitSlop={8}
                        style={styles.rowNoteBtn}>
                        <Text style={styles.rowNoteBtnText}>
                          {row.note?.trim() ? 'Edit note' : 'Add note'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleDeleteRanked(row)}
                        hitSlop={8}
                        style={styles.rowDeleteBtn}>
                        <Text style={styles.rowDeleteText}>Delete</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
            </View>
          </View>
        )}
      </KeyboardFormScroll>
      <PostNoteEditorModal
        visible={noteEditorPost != null}
        initialNote={noteEditorPost?.note}
        productName={
          noteEditorPost ? formatProductDisplayName(noteEditorPost.item) : undefined
        }
        saving={noteSaving}
        onClose={() => {
          if (noteSaving) return;
          setNoteEditorPost(null);
        }}
        onSave={handleSavePostNote}
      />
      <ProfileEditorModal
        visible={profileEditorOpen}
        initialBio={profile?.bio}
        initialDietTags={profileDietTags}
        initialZipCode={profile?.zip_code}
        initialBirthday={profile?.birthday}
        saving={profileSaving}
        onClose={() => {
          if (profileSaving) return;
          setProfileEditorOpen(false);
        }}
        onSave={handleSaveProfile}
      />
      {isSelf ? (
        <InviteFriendsModal visible={inviteVisible} onClose={() => setInviteVisible(false)} />
      ) : null}
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
  onLongPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={420}
      style={[styles.filterChip, active && styles.filterChipActive]}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Stat({
  label,
  value,
  onPress,
}: {
  label: string;
  value: number | string;
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
        <LeaderboardList
          rows={visible}
          activeUsername={activeUsername}
          onPressUser={onPressUser}
        />
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
    color: BaggedColors.green,
  },
  adminVerifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  adminVerifiedLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  bio: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 18,
  },
  profileDietRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  profileDietChip: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  profileDietChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
  },
  profileActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  editProfileBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  inviteProfileBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editProfileBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.green,
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
    color: BaggedColors.green,
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
    color: BaggedColors.green,
  },
  followTextActive: {
    color: BaggedColors.green,
  },
  searchBlock: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 4,
  },
  listSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 4,
    minHeight: 44,
  },
  listSectionLabel: {
    flex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  headerSearchBtn: {
    padding: 6,
    position: 'relative',
  },
  headerSearchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerSearchInput: {
    flex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    color: BaggedColors.dark,
    paddingVertical: 0,
    minHeight: 22,
  },
  searchActiveDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: BaggedColors.accent,
  },
  filtersBlock: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 12,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
    maxWidth: 220,
  },
  filterChipActive: {
    backgroundColor: BaggedColors.dark,
    borderColor: BaggedColors.dark,
  },
  filterChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
  filterChipTextActive: {
    color: BaggedColors.green,
  },
  listHeading: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.muted,
    marginBottom: 10,
  },
  categoryFilterRow: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  listSection: {
    paddingHorizontal: 20,
    marginBottom: 16,
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
    overflow: 'hidden',
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
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderSoft,
  },
  rowItemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 0,
  },
  rowDeleteBtn: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: BaggedColors.borderSoft,
  },
  rowOwnerActions: {
    flexDirection: 'column',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: BaggedColors.borderSoft,
  },
  rowNoteBtn: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BaggedColors.borderSoft,
  },
  rowNoteBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  rowNote: {
    marginTop: 4,
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  rowNoteMention: {
    color: BaggedColors.accent,
    fontWeight: '700',
    fontStyle: 'normal',
  },
  rowDeleteText: {
    fontFamily: BaggedFonts.display,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  pressed: { opacity: 0.7 },
  rank: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.muted,
    minWidth: 44,
    flexShrink: 0,
    textAlign: 'center',
    lineHeight: 22,
    includeFontPadding: false,
  },
  rowBody: { flex: 1, minWidth: 0 },
  scoreSlot: {
    minWidth: 40,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
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
