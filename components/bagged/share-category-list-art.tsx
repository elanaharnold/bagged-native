import { Image } from 'expo-image';
import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ViewShot from 'react-native-view-shot';

import { Avatar } from '@/components/bagged/avatar';
import { scoreDisplayColor } from '@/components/bagged/score-badge';
import {
  SHARE_EXPORT_HEIGHT,
  SHARE_SCORE_CARD_WIDTH,
} from '@/components/bagged/share-score-card-art';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import type { CategoryListShareableData } from '@/lib/share-category-list';

const SHAREABLE_LOGO = require('@/assets/images/bagged-shareable-logo.png');

const FRAME_PAD = 20;
const CARD_RADIUS = 18;
const CARD_PADDING = 20;

type ShareCategoryListArtProps = {
  data: CategoryListShareableData;
};

export const ShareCategoryListArt = forwardRef<ViewShot, ShareCategoryListArtProps>(
  function ShareCategoryListArt({ data }, ref) {
    const avatarChar =
      data.avatarChar?.trim() || (data.username || '?').charAt(0).toUpperCase();
    const displayName = data.displayName?.trim() || data.username || 'You';
    const showRankNumbers = data.showRankNumbers !== false;

    return (
      <ViewShot
        ref={ref}
        options={{ format: 'png', quality: 1, result: 'tmpfile' }}
        style={styles.shot}>
        <View style={styles.frame} collapsable={false}>
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Avatar
                  char={avatarChar}
                  color={data.avatarColor ?? BaggedColors.accent}
                  size={40}
                  borderColor={BaggedColors.borderSoft}
                />
                <View style={styles.headerText}>
                  <Text style={styles.displayName} allowFontScaling={false} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text style={styles.handle} allowFontScaling={false} numberOfLines={1}>
                    @{data.username}
                  </Text>
                </View>
              </View>
              <Image source={SHAREABLE_LOGO} style={styles.headerLogo} contentFit="contain" />
            </View>

            <Text style={styles.categoryTitle} allowFontScaling={false}>
              {data.category}
            </Text>
            <Text style={styles.listSubtitle} allowFontScaling={false}>
              My top {Math.min(10, data.entries.length)}
            </Text>

            <View style={styles.list}>
              {data.entries.map((row, idx) => {
                const scoreColor = scoreDisplayColor(row.rating);
                return (
                  <View key={`${idx}-${row.item}`} style={styles.listRow}>
                    {showRankNumbers ? (
                      <Text style={styles.rankNum} allowFontScaling={false} numberOfLines={1}>
                        #{row.rank}
                      </Text>
                    ) : null}
                    <View style={styles.rowBody}>
                      <View style={styles.titleRow}>
                        <Text style={styles.itemTitle} allowFontScaling={false} numberOfLines={1}>
                          {row.item}
                        </Text>
                        <Text
                          style={[styles.itemScore, { color: scoreColor }]}
                          allowFontScaling={false}
                          numberOfLines={1}>
                          {row.rating.toFixed(1)}
                        </Text>
                      </View>
                      {row.brand ? (
                        <Text style={styles.itemBrand} allowFontScaling={false} numberOfLines={1}>
                          {row.brand}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </ViewShot>
    );
  }
);

export const CATEGORY_LIST_EXPORT_HEIGHT = SHARE_EXPORT_HEIGHT;

const styles = StyleSheet.create({
  shot: {
    width: SHARE_SCORE_CARD_WIDTH,
    height: SHARE_EXPORT_HEIGHT,
    backgroundColor: BaggedColors.accent,
  },
  frame: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: FRAME_PAD,
  },
  card: {
    alignSelf: 'stretch',
    width: '100%',
    backgroundColor: BaggedColors.white,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    paddingHorizontal: CARD_PADDING,
    paddingTop: CARD_PADDING,
    paddingBottom: CARD_PADDING,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  displayName: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  handle: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
  headerLogo: {
    width: 64,
    height: 28,
    flexShrink: 0,
    marginTop: 2,
  },
  categoryTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.3,
    textTransform: 'uppercase',
    color: BaggedColors.dark,
    marginBottom: 2,
  },
  listSubtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.muted,
    marginBottom: 12,
  },
  list: {
    gap: 10,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  rankNum: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.muted,
    minWidth: 28,
    flexShrink: 0,
    marginTop: 2,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    fontFamily: BaggedFonts.display,
    fontSize: 14,
    lineHeight: 17,
    letterSpacing: -0.2,
    textTransform: 'uppercase',
    color: BaggedColors.dark,
  },
  itemScore: {
    fontFamily: BaggedFonts.display,
    fontSize: 16,
    lineHeight: 18,
    flexShrink: 0,
    minWidth: 28,
    textAlign: 'right',
  },
  itemBrand: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    lineHeight: 14,
    color: BaggedColors.muted,
    paddingRight: 36,
  },
});
