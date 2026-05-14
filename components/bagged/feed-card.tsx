import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { MacrosPills } from '@/components/bagged/macros-pills';
import { PostPhotoStrip } from '@/components/bagged/post-photo-strip';
import { ScoreBadge } from '@/components/bagged/score-badge';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { formatPostTime, formatProductDisplayName } from '@/lib/format';
import type { PostMacros } from '@/lib/data';

export type FeedCardPost = {
  id: string | number;
  user: string;
  avatar: string;
  avatarColor: string;
  item: string;
  brand: string;
  store: string;
  stores: string[];
  category: string;
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
};

type FeedCardProps = {
  post: FeedCardPost;
  /** Optional — helps Supabase Storage when the bucket is not fully public. */
  imageHeaders?: Record<string, string>;
  onPress: (post: FeedCardPost) => void;
  onPressUser: (username: string) => void;
  onComment: (post: FeedCardPost) => void;
  onLike: (post: FeedCardPost) => void;
  onWantToTry: (post: FeedCardPost) => void;
  showMacroNutrition?: boolean;
  onPressEdit?: () => void;
  showEdit?: boolean;
};

export function FeedCard({
  post,
  imageHeaders,
  onPress,
  onPressUser,
  onComment,
  onLike,
  onWantToTry,
  showMacroNutrition,
  onPressEdit,
  showEdit,
}: FeedCardProps) {
  const time = post.createdAt ? formatPostTime(post.createdAt) : '';
  const categoryLabel = post.category?.trim() ? post.category : 'Uncategorized';
  const storeLabel = post.store?.trim() ? post.store : 'Unknown store';

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Pressable onPress={() => onPressUser(post.user)} style={styles.userLeft} hitSlop={8}>
          <View style={[styles.avatar, { backgroundColor: post.avatarColor }]}>
            <Text style={styles.avatarText}>{post.avatar}</Text>
          </View>
          <View style={styles.userMeta}>
            <AutoFitText style={styles.username} numberOfLines={1}>
              @{post.user}
            </AutoFitText>
            {time ? (
              <AutoFitText style={styles.time} numberOfLines={1}>
                {time}
              </AutoFitText>
            ) : null}
          </View>
        </Pressable>

        <View style={styles.metaRight}>
          <View style={styles.storeCategory}>
            <AutoFitText style={styles.metaSmall} numberOfLines={1}>
              {storeLabel}
            </AutoFitText>
            <Text style={styles.metaDot}> · </Text>
            <AutoFitText style={styles.metaSmall} numberOfLines={1}>
              {categoryLabel}
            </AutoFitText>
          </View>
          {post.rating != null && Number.isFinite(post.rating) ? (
            <ScoreBadge score={post.rating} size={44} />
          ) : (
            <View style={styles.radarBadge}>
              <Text style={styles.radarBadgeText}>—</Text>
            </View>
          )}
        </View>
      </View>

      <Pressable onPress={() => onPress(post)} style={styles.bodyPress}>
        <AutoFitText style={styles.productName} numberOfLines={3} minimumFontScale={0.45}>
          {post.item || 'Untitled item'}
        </AutoFitText>
        {post.brand ? (
          <AutoFitText style={styles.brand} numberOfLines={2} minimumFontScale={0.55}>
            {formatProductDisplayName(post.brand)}
          </AutoFitText>
        ) : null}

        {post.note ? (
          <Text style={styles.note}>&ldquo;{post.note}&rdquo;</Text>
        ) : null}

        {showMacroNutrition ? <MacrosPills macros={post.macros} /> : null}

        <PostPhotoStrip urls={post.photoUrls} imageHeaders={imageHeaders} />
      </Pressable>

      <View style={styles.actions}>
        <View style={styles.actionsLeft}>
          <Pressable onPress={() => onLike(post)} hitSlop={8} style={styles.iconRow}>
            <Ionicons
              name={post.liked ? 'heart' : 'heart-outline'}
              size={20}
              color={post.liked ? BaggedColors.heart : BaggedColors.ink}
            />
            <Text style={styles.actionCount}>{post.likes}</Text>
          </Pressable>

          <Pressable onPress={() => onComment(post)} hitSlop={8} style={styles.iconRow}>
            <Ionicons name="chatbubble-outline" size={19} color={BaggedColors.ink} />
            <Text style={styles.actionCount}>{post.comments}</Text>
          </Pressable>
        </View>

        <View style={styles.actionsRight}>
          {showEdit && onPressEdit ? (
            <Pressable onPress={onPressEdit} style={styles.editBtn} hitSlop={6}>
              <Text style={styles.editText}>Edit</Text>
            </Pressable>
          ) : null}

          {post.viewerHasRanked ? null : (
            <Pressable
              onPress={() => onWantToTry(post)}
              style={[styles.wantBtn, post.wantToTry && styles.wantBtnActive]}
              hitSlop={6}>
              <Text style={[styles.wantText, post.wantToTry && styles.wantTextActive]}>
                {post.wantToTry ? 'On Want to Try' : 'Want to Try'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const radarSize = 44;

const styles = StyleSheet.create({
  card: {
    backgroundColor: BaggedColors.card,
    borderRadius: BaggedLayout.cardRadius,
    paddingVertical: 18,
    paddingHorizontal: BaggedLayout.screenPadding,
    marginBottom: 14,
    ...BaggedLayout.shadowCard,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  userLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: {
    color: BaggedColors.white,
    fontWeight: '800',
    fontSize: 16,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  userMeta: {
    marginLeft: 10,
    flex: 1,
    minWidth: 0,
  },
  username: {
    color: BaggedColors.ink,
    fontWeight: '700',
    fontSize: 15,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  time: {
    marginTop: 2,
    color: BaggedColors.muted,
    fontSize: 12,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  metaRight: {
    alignItems: 'flex-end',
    maxWidth: '48%',
    minWidth: 0,
    flexShrink: 1,
    gap: 8,
  },
  storeCategory: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    minWidth: 0,
    maxWidth: '100%',
  },
  metaSmall: {
    color: BaggedColors.muted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  metaDot: {
    color: BaggedColors.muted,
    fontSize: 11,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  radarBadge: {
    width: radarSize,
    height: radarSize,
    borderRadius: radarSize / 2,
    borderWidth: 2,
    borderColor: BaggedColors.borderStrong,
    backgroundColor: BaggedColors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarBadgeText: {
    fontSize: 16,
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
    fontSize: 28,
    letterSpacing: -0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    lineHeight: 32,
    marginBottom: 8,
  },
  brand: {
    color: BaggedColors.muted,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 10,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  note: {
    color: BaggedColors.ink,
    fontSize: 15,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 10,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  actions: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionCount: {
    color: BaggedColors.ink,
    fontSize: 13,
    fontWeight: '600',
    minWidth: 14,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  actionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  editBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderStrong,
    backgroundColor: BaggedColors.cream,
  },
  editText: {
    color: BaggedColors.muted,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: BaggedFonts.display,
  },
  wantBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: BaggedLayout.pillRadius,
    borderWidth: 1.5,
    borderColor: BaggedColors.ink,
    backgroundColor: BaggedColors.card,
  },
  wantBtnActive: {
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.cream,
  },
  wantText: {
    color: BaggedColors.ink,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: BaggedFonts.display,
  },
  wantTextActive: {
    color: BaggedColors.muted,
    fontWeight: '600',
  },
});
