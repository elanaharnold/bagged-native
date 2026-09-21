import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExpandableMentionText } from '@/components/bagged/expandable-text';
import { UsernameLink } from '@/components/bagged/username-link';
import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { Avatar } from '@/components/bagged/avatar';
import { PostPhotoStrip } from '@/components/bagged/post-photo-strip';
import { ScoreBadge } from '@/components/bagged/score-badge';
import { WantToTryTag } from '@/components/bagged/want-to-try-tag';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { retailStoresForRow } from '@/constants/grocery';
import { formatPostTime, formatProductDisplayName } from '@/lib/format';
import { normalizePhotoUrls, profileIsVerifiedAmbassador, type FeedPostRow } from '@/lib/data';
import { isDisplayableBaggedScore } from '@/lib/ranking';

type CommentsPostSummaryProps = {
  post: FeedPostRow;
  imageHeaders?: Record<string, string>;
  onPressUser?: (username: string) => void;
};

export function CommentsPostSummary({ post, imageHeaders, onPressUser }: CommentsPostSummaryProps) {
  const username = post.profile?.username ?? 'unknown';
  const avatarColor = post.profile?.avatar_color ?? BaggedColors.accent;
  const stores = retailStoresForRow(post);
  const storeLabel = stores.length > 0 ? stores.join(' · ') : '';
  const categoryLabel = post.category?.trim() ? post.category : 'Uncategorized';
  const radarOnly = post.radar_only === true;
  const rating = radarOnly ? null : post.rating;
  const photoUrls = normalizePhotoUrls(post.photo_urls);
  const time = post.created_at ? formatPostTime(post.created_at) : '';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => onPressUser?.(username)}
          disabled={!onPressUser}
          style={styles.userRow}
          hitSlop={6}>
          <Avatar char={username.charAt(0).toUpperCase()} color={avatarColor} size={36} />
          <View style={styles.userMeta}>
            <View style={styles.usernameRow}>
              <UsernameLink
                username={username}
                style={styles.username}
                verified={profileIsVerifiedAmbassador(post.profile)}
              />
              {time ? <Text style={styles.username}> · {time}</Text> : null}
            </View>
            <Text style={styles.metaLine} numberOfLines={2}>
              {[storeLabel, categoryLabel].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Pressable>
        {isDisplayableBaggedScore(rating) ? (
          <ScoreBadge score={rating} size={32} />
        ) : radarOnly ? (
          <WantToTryTag />
        ) : null}
      </View>

      <AutoFitText style={styles.productName} numberOfLines={3} minimumFontScale={0.82}>
        {formatProductDisplayName(post.item) || 'Untitled item'}
      </AutoFitText>
      {post.product_brand?.trim() ? (
        <AutoFitText style={styles.brand} numberOfLines={1} minimumFontScale={0.88}>
          {formatProductDisplayName(post.product_brand)}
        </AutoFitText>
      ) : null}
      {post.note?.trim() ? (
        <ExpandableMentionText
          text={post.note.trim()}
          style={styles.note}
          mentionStyle={styles.noteMention}
          numberOfLines={3}
          quoted
        />
      ) : null}
      {photoUrls.length > 0 ? (
        <View style={styles.photoWrap}>
          <PostPhotoStrip urls={photoUrls} maxHeight={120} imageHeaders={imageHeaders} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: BaggedColors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.border,
    padding: 14,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  userRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  userMeta: {
    flex: 1,
    minWidth: 0,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  username: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
  metaLine: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.muted,
    marginTop: 2,
  },
  productName: {
    fontFamily: BaggedFonts.display,
    fontSize: 20,
    color: BaggedColors.dark,
    textAlign: 'center',
    marginBottom: 4,
  },
  brand: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    textAlign: 'center',
    marginBottom: 6,
  },
  note: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.dark,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  noteMention: {
    color: BaggedColors.accent,
    fontWeight: '700',
    fontStyle: 'normal',
  },
  photoWrap: {
    marginTop: 10,
  },
});
