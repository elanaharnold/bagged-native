import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExpandableMentionText } from '@/components/bagged/expandable-text';
import { UsernameLink } from '@/components/bagged/username-link';
import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { MacrosPills } from '@/components/bagged/macros-pills';
import { PostPhotoStrip } from '@/components/bagged/post-photo-strip';
import { ScoreBadge } from '@/components/bagged/score-badge';
import { WantToTryTag } from '@/components/bagged/want-to-try-tag';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import { retailStoresForRow } from '@/constants/grocery';
import { subcategoryLabelForRow } from '@/lib/categories';
import { formatPostTime, formatProductDisplayName } from '@/lib/format';
import { isDisplayableBaggedScore } from '@/lib/ranking';
import type { PostMacros } from '@/lib/data';

export type FeedCardPost = {
  id: string | number;
  user: string;
  userVerified?: boolean;
  avatar: string;
  avatarColor: string;
  item: string;
  brand: string;
  store: string;
  stores: string[];
  category: string;
  categories?: string[];
  subcategory?: string | null;
  rating: number | null;
  note: string;
  photoUrls: string[];
  likes: number;
  comments: number;
  liked: boolean;
  wantToTry: boolean;
  /** When true, hide Want to Try — viewer already has a real ranking for this product key. */
  viewerHasRanked?: boolean;
  radarOnly: boolean;
  createdAt?: string | null;
  macros: PostMacros | null;
  dietTags?: string[] | null;
  descriptionKey?: string;
  /** Latest comment from someone else on the viewer's post. */
  replyHighlight?: { username: string; preview: string; verified?: boolean } | null;
};

type FeedCardProps = {
  post: FeedCardPost;
  /** Optional — helps Supabase Storage when the bucket is not fully public. */
  imageHeaders?: Record<string, string>;
  onPress: (post: FeedCardPost) => void;
  onPressUser: (username: string) => void;
  onComment: (post: FeedCardPost) => void;
  onLike: (post: FeedCardPost) => void;
  onShowLikers?: (post: FeedCardPost) => void;
  onWantToTry: (post: FeedCardPost) => void;
  showMacroNutrition?: boolean;
  /** Long-press on own ranked posts — opens shareable score card. */
  onLongPress?: (post: FeedCardPost) => void;
  verifiedUsernames?: ReadonlySet<string>;
};

const SCORE_SIZE = 32;
const AVATAR_SIZE = 32;

export function FeedCard({
  post,
  imageHeaders,
  onPress,
  onPressUser,
  onComment,
  onLike,
  onShowLikers,
  onWantToTry,
  showMacroNutrition,
  onLongPress,
  verifiedUsernames,
}: FeedCardProps) {
  const time = post.createdAt ? formatPostTime(post.createdAt) : '';
  const categoryLabel = subcategoryLabelForRow({
    subcategory: post.subcategory,
    category: post.category,
    categories: post.categories,
  });
  const storeTags = retailStoresForRow({
    store: post.store,
    stores: post.stores,
    product_brand: post.brand,
  });
  const storeFallback = post.radarOnly ? 'Store not set' : 'Unknown store';
  const storeLabel = storeTags.length > 0 ? storeTags.join(' · ') : storeFallback;
  const hasTags =
    (post.dietTags && post.dietTags.length > 0) ||
    (showMacroNutrition && post.macros != null);

  return (
    <View style={styles.card}>
      <Pressable
        onLongPress={onLongPress ? () => onLongPress(post) : undefined}
        delayLongPress={420}
        disabled={!onLongPress}>
        <View style={styles.headerRow}>
        <Pressable onPress={() => onPressUser(post.user)} style={styles.userLeft} hitSlop={8}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: post.avatarColor, width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 },
            ]}>
            <Text style={styles.avatarText} allowFontScaling={false}>
              {post.avatar}
            </Text>
          </View>
          <View style={styles.userMeta}>
            <View style={styles.usernameRow}>
              <UsernameLink username={post.user} style={styles.username} verified={post.userVerified} />
              {time ? <Text style={styles.username}> · {time}</Text> : null}
            </View>
            <Text style={styles.metaLine} numberOfLines={2} allowFontScaling={false}>
              {storeLabel} · {categoryLabel}
            </Text>
          </View>
        </Pressable>

        {post.radarOnly || !isDisplayableBaggedScore(post.rating) ? (
          post.radarOnly ? (
            <WantToTryTag />
          ) : (
            <View style={styles.radarBadge}>
              <Text style={styles.radarBadgeText} allowFontScaling={false}>
                —
              </Text>
            </View>
          )
        ) : (
          <ScoreBadge score={post.rating} size={SCORE_SIZE} />
        )}
      </View>

      <Pressable onPress={() => onPress(post)} style={styles.bodyPress}>
        <AutoFitText style={styles.productName} numberOfLines={3} minimumFontScale={0.82}>
          {post.item || 'Untitled item'}
        </AutoFitText>
        {post.brand ? (
          <AutoFitText style={styles.brand} numberOfLines={1} minimumFontScale={0.88}>
            {formatProductDisplayName(post.brand)}
          </AutoFitText>
        ) : null}

        {post.note ? (
          <ExpandableMentionText
            text={post.note}
            style={styles.note}
            mentionStyle={styles.noteMention}
            numberOfLines={3}
            quoted
            verifiedUsernames={verifiedUsernames}
          />
        ) : null}

        {hasTags ? (
          <View style={styles.tagBlock}>
            {post.dietTags && post.dietTags.length > 0 ? (
              <View style={styles.dietRow}>
                {post.dietTags.map((id) => {
                  const t = DIET_TAGS.find((x) => x.id === id);
                  if (!t) return null;
                  return (
                    <View key={id} style={[styles.dietChip, { backgroundColor: t.bg }]}>
                      <Text style={[styles.dietChipText, { color: t.color }]} allowFontScaling={false}>
                        {t.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
            {showMacroNutrition ? (
              <MacrosPills macros={post.macros} size="sm" centered compact />
            ) : null}
          </View>
        ) : null}
      </Pressable>
      </Pressable>

      {(post.photoUrls?.length ?? 0) > 0 ? (
        <View style={styles.photoStripWrap}>
          <PostPhotoStrip urls={post.photoUrls} maxHeight={140} imageHeaders={imageHeaders} />
        </View>
      ) : null}

      {post.replyHighlight ? (
        <Pressable onPress={() => onComment(post)} style={styles.replyHighlight}>
          <Text style={styles.replyHighlightLabel}>
            {post.radarOnly ? 'Comment on your post' : 'Comment on your ranking'}
          </Text>
          <UsernameLink
            username={post.replyHighlight.username}
            style={styles.replyHighlightUser}
            verified={post.replyHighlight.verified}
          />
          <ExpandableMentionText
            text={post.replyHighlight.preview}
            style={styles.replyHighlightPreview}
            mentionStyle={styles.noteMention}
            numberOfLines={3}
            quoted
            verifiedUsernames={verifiedUsernames}
          />
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        <View style={styles.actionsLeft}>
          <View style={styles.iconRow}>
            <Pressable onPress={() => onLike(post)} hitSlop={8}>
              <Ionicons
                name={post.liked ? 'heart' : 'heart-outline'}
                size={17}
                color={post.liked ? BaggedColors.heart : BaggedColors.ink}
              />
            </Pressable>
            {post.likes > 0 && onShowLikers ? (
              <Pressable onPress={() => onShowLikers(post)} hitSlop={8}>
                <Text style={styles.actionCount} allowFontScaling={false}>
                  {post.likes}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.actionCount} allowFontScaling={false}>
                {post.likes}
              </Text>
            )}
          </View>

          <Pressable onPress={() => onComment(post)} hitSlop={8} style={styles.iconRow}>
            <Ionicons name="chatbubble-outline" size={16} color={BaggedColors.ink} />
            <Text style={styles.actionCount} allowFontScaling={false}>
              {post.comments}
            </Text>
          </Pressable>
        </View>

        {!post.viewerHasRanked ? (
          <Pressable
            onPress={() => onWantToTry(post)}
            style={[styles.wantBtn, post.wantToTry && styles.wantBtnActive]}
            hitSlop={6}>
            <Text
              style={[styles.wantText, post.wantToTry && styles.wantTextActive]}
              allowFontScaling={false}>
              {post.wantToTry ? 'Saved' : 'Want to try'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: BaggedColors.card,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderSoft,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  userLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: {
    color: BaggedColors.white,
    fontWeight: '700',
    fontSize: 13,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  userMeta: {
    marginLeft: 8,
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  username: {
    color: BaggedColors.ink,
    fontWeight: '600',
    fontSize: 13,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  metaLine: {
    color: BaggedColors.muted,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.25,
    lineHeight: 13,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  radarBadge: {
    width: SCORE_SIZE,
    height: SCORE_SIZE,
    borderRadius: SCORE_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderStrong,
    backgroundColor: BaggedColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radarBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: BaggedColors.muted,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  bodyPress: {
    alignSelf: 'stretch',
  },
  productName: {
    color: BaggedColors.dark,
    fontFamily: BaggedFonts.display,
    fontSize: 20,
    letterSpacing: -0.3,
    textTransform: 'uppercase',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 2,
    width: '100%',
  },
  brand: {
    color: BaggedColors.muted,
    fontSize: 13,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 6,
    width: '100%',
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  note: {
    color: BaggedColors.ink,
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 6,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  noteMention: {
    color: BaggedColors.accent,
    fontWeight: '700',
    fontStyle: 'normal',
  },
  tagBlock: {
    gap: 4,
    marginBottom: 4,
  },
  dietRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
  dietChip: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  dietChipText: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  photoStripWrap: {
    marginTop: 6,
  },
  replyHighlight: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: BaggedColors.accentPale,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.border,
  },
  replyHighlightLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  replyHighlightUser: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.dark,
    marginBottom: 2,
  },
  replyHighlightPreview: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.dark,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  actions: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BaggedColors.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionCount: {
    color: BaggedColors.ink,
    fontSize: 12,
    fontWeight: '600',
    minWidth: 12,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  wantBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderStrong,
    backgroundColor: BaggedColors.cream,
  },
  wantBtnActive: {
    borderColor: BaggedColors.accent,
    backgroundColor: BaggedColors.accentPaleActive,
  },
  wantText: {
    color: BaggedColors.dark,
    fontSize: 11,
    fontWeight: '600',
    fontFamily: BaggedFonts.body,
  },
  wantTextActive: {
    color: BaggedColors.accent,
  },
});
