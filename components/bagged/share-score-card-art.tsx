import { Image } from 'expo-image';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import ViewShot from 'react-native-view-shot';

import { Avatar } from '@/components/bagged/avatar';
import { MacrosPills } from '@/components/bagged/macros-pills';
import { scoreDisplayColor } from '@/components/bagged/score-badge';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { DIET_TAGS } from '@/constants/diet-tags';
import { retailStoresForRow } from '@/constants/grocery';
import { shareableHasNutritionContent, type ShareableData } from '@/lib/share-score-card';
import { formatProductDisplayName } from '@/lib/format';
import { normalizePostMacros } from '@/lib/data';
import { clampBaggedScore, isDisplayableBaggedScore } from '@/lib/ranking';

const SHAREABLE_LOGO = require('@/assets/images/bagged-shareable-logo.png');

export const SHARE_SCORE_CARD_WIDTH = 360;

/** Instagram Story aspect ratio (9:16) — full green canvas at export resolution. */
export const SHARE_EXPORT_HEIGHT = Math.round((SHARE_SCORE_CARD_WIDTH * 16) / 9);

const SCORE_CIRCLE_SIZE = 76;
const CARD_PADDING = 20;
const HEADER_BLOCK = 52;
const PRODUCT_BLOCK = 96;
const PHOTO_SIZE = 96;
const PHOTO_GAP = 8;
const PHOTO_TOP_MARGIN = 14;
const NUTRITION_BLOCK = 54;
const CARD_BOTTOM = 20;
/** Green margin around the white card in the exported image. */
const FRAME_PAD = 20;
const CARD_RADIUS = 18;
const NOTE_LINE_HEIGHT = 19;
const NOTE_TOP_MARGIN = 14;
const NOTE_LABEL_CHARS = 7;

function noteInnerWidth(): number {
  return SHARE_SCORE_CARD_WIDTH - FRAME_PAD * 2 - CARD_PADDING * 2;
}

/** Estimate wrapped lines for the note quote (accounts for the inline "Notes: " label). */
function estimateNoteLineCount(note: string): number {
  const text = String(note ?? '').trim();
  if (!text) return 0;
  const charsPerLine = Math.max(18, Math.floor(noteInnerWidth() / 7.2));
  const firstLineChars = Math.max(10, charsPerLine - NOTE_LABEL_CHARS);
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    let remaining = paragraph.length;
    if (lines === 0) {
      if (remaining <= firstLineChars) {
        lines = 1;
      } else {
        remaining -= firstLineChars;
        lines = 1 + Math.ceil(remaining / charsPerLine);
      }
    } else {
      lines += Math.max(1, Math.ceil(remaining / charsPerLine));
    }
  }
  return Math.max(1, lines);
}

function noteBlockHeight(note: string | null | undefined): number {
  const lines = estimateNoteLineCount(String(note ?? ''));
  if (lines === 0) return 0;
  return NOTE_TOP_MARGIN + lines * NOTE_LINE_HEIGHT;
}

/** Inner white card height (content only). */
export function shareableCardContentHeight(
  hasPhoto: boolean,
  note?: string | null,
  showNutritionTags = false
): number {
  let h = CARD_PADDING + HEADER_BLOCK + PRODUCT_BLOCK + CARD_BOTTOM;
  if (showNutritionTags) h += NUTRITION_BLOCK + 6;
  if (hasPhoto) h += PHOTO_SIZE + PHOTO_TOP_MARGIN;
  h += noteBlockHeight(note);
  return h;
}

/** Full export size — at least 9:16 story canvas; grows when the note needs more room. */
export function shareableExportHeight(
  hasPhoto: boolean,
  note?: string | null,
  showNutritionTags = false
): number {
  const cardHeight = shareableCardContentHeight(hasPhoto, note, showNutritionTags);
  return Math.max(SHARE_EXPORT_HEIGHT, cardHeight + FRAME_PAD * 2);
}

type ShareableArtProps = {
  data: ShareableData;
  imageHeaders?: Record<string, string>;
  showNutritionTags?: boolean;
  onPhotoReady?: () => void;
  onExportHeightChange?: (height: number) => void;
};

export const ShareScoreCardArt = forwardRef<ViewShot, ShareableArtProps>(function ShareableArt(
  { data, imageHeaders, showNutritionTags = false, onPhotoReady, onExportHeightChange },
  ref
) {
  const score = clampBaggedScore(data.rating);
  const scoreColor = scoreDisplayColor(score);
  const communityAvg = isDisplayableBaggedScore(data.communityAvg)
    ? clampBaggedScore(data.communityAvg)
    : null;
  const storeTags = retailStoresForRow({
    store: data.store,
    stores: data.stores,
    product_brand: data.brand,
  });
  const storeLabel = storeTags.length > 0 ? storeTags.join(' · ') : data.store || '';
  const metaLine = [storeLabel, data.category].filter(Boolean).join(' · ');

  const photoUrls = useMemo(() => {
    const fromList = (data.photoUrls ?? []).filter(Boolean);
    if (fromList.length > 0) return fromList.slice(0, 3);
    return data.photoUrl ? [data.photoUrl] : [];
  }, [data.photoUrls, data.photoUrl]);

  const [failedPhotos, setFailedPhotos] = useState<Set<string>>(() => new Set());
  const [loadedPhotos, setLoadedPhotos] = useState<Set<string>>(() => new Set());
  const visiblePhotos = photoUrls.filter((u) => !failedPhotos.has(u));
  const hasPhoto = visiblePhotos.length > 0;
  const hasNote = Boolean(data.note?.trim());
  const macros = normalizePostMacros(data.macros);
  const dietTagIds = (data.dietTags ?? []).map((t) => String(t ?? '').trim()).filter(Boolean);
  const showNutrition =
    showNutritionTags && shareableHasNutritionContent({ ...data, macros, dietTags: dietTagIds });

  const estimatedHeight = useMemo(
    () => shareableExportHeight(hasPhoto, data.note, showNutrition),
    [hasPhoto, data.note, showNutrition]
  );
  const [exportHeight, setExportHeight] = useState(estimatedHeight);

  useEffect(() => {
    setExportHeight(estimatedHeight);
  }, [estimatedHeight]);

  useEffect(() => {
    onExportHeightChange?.(exportHeight);
  }, [exportHeight, onExportHeightChange]);

  const avatarChar =
    data.avatarChar?.trim() || (data.username || '?').charAt(0).toUpperCase();
  const displayName = data.displayName?.trim() || data.username || 'You';

  useEffect(() => {
    setFailedPhotos(new Set());
    setLoadedPhotos(new Set());
  }, [photoUrls.join('|')]);

  useEffect(() => {
    if (!hasPhoto) {
      onPhotoReady?.();
      return;
    }
    if (loadedPhotos.size >= visiblePhotos.length) {
      onPhotoReady?.();
    }
  }, [hasPhoto, loadedPhotos.size, visiblePhotos.length, onPhotoReady]);

  const markPhotoLoaded = (uri: string) => {
    setLoadedPhotos((prev) => {
      if (prev.has(uri)) return prev;
      const next = new Set(prev);
      next.add(uri);
      return next;
    });
  };

  const markPhotoFailed = (uri: string) => {
    setFailedPhotos((prev) => {
      const next = new Set(prev);
      next.add(uri);
      return next;
    });
    onPhotoReady?.();
  };

  return (
    <ViewShot
      ref={ref}
      options={{ format: 'png', quality: 1, result: 'tmpfile' }}
      style={[styles.shot, { height: exportHeight }]}>
      <View style={styles.frame} collapsable={false}>
        <View
          style={styles.card}
          onLayout={(e) => {
            const needed = e.nativeEvent.layout.height + FRAME_PAD * 2;
            setExportHeight((prev) => Math.max(prev, needed, SHARE_EXPORT_HEIGHT));
          }}>
          {/* Header — avatar, name, logo */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Avatar
                char={avatarChar}
                color={data.avatarColor ?? BaggedColors.accent}
                size={44}
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

          {/* Product + score */}
          <View style={styles.productRow}>
            <View style={styles.productLeft}>
              <Text style={styles.productName} allowFontScaling={false} numberOfLines={3}>
                {formatProductDisplayName(data.item) || 'Untitled item'}
              </Text>
              {data.brand ? (
                <Text style={styles.brand} allowFontScaling={false} numberOfLines={2}>
                  {formatProductDisplayName(data.brand)}
                </Text>
              ) : null}
              {metaLine ? (
                <Text style={styles.stores} allowFontScaling={false} numberOfLines={2}>
                  {metaLine}
                </Text>
              ) : null}
            </View>

            <View style={styles.scoreColumn}>
              <View style={[styles.scoreCircle, { borderColor: scoreColor }]}>
                <Text
                  style={[
                    styles.score,
                    {
                      color: scoreColor,
                      marginTop: Platform.OS === 'ios' ? 2 : 0,
                    },
                  ]}
                  allowFontScaling={false}
                  numberOfLines={1}>
                  {score.toFixed(1)}
                </Text>
              </View>
              {communityAvg != null ? (
                <View style={styles.communityUnder}>
                  <Text style={styles.communityLabel} allowFontScaling={false}>
                    Community avg
                  </Text>
                  <Text
                    style={[styles.communityScore, { color: scoreDisplayColor(communityAvg) }]}
                    allowFontScaling={false}>
                    {communityAvg.toFixed(1)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {showNutrition ? (
            <View style={styles.nutritionBlock}>
              {dietTagIds.length > 0 ? (
                <View style={styles.dietRow}>
                  {dietTagIds.map((id) => {
                    const tag = DIET_TAGS.find((t) => t.id === id);
                    if (!tag) return null;
                    return (
                      <View key={id} style={[styles.dietChip, { backgroundColor: tag.bg }]}>
                        <Text style={[styles.dietChipText, { color: tag.color }]} allowFontScaling={false}>
                          {tag.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
              <MacrosPills macros={macros} size="sm" compact />
            </View>
          ) : null}

          {/* Photo strip */}
          {hasPhoto ? (
            <View style={styles.photoRow}>
              {visiblePhotos.map((uri) => (
                <View key={uri} style={styles.photoCell}>
                  <Image
                    source={{ uri, headers: imageHeaders }}
                    style={styles.photo}
                    contentFit="cover"
                    onLoad={() => markPhotoLoaded(uri)}
                    onError={() => markPhotoFailed(uri)}
                  />
                </View>
              ))}
            </View>
          ) : null}

          {/* Notes */}
          {hasNote ? (
            <Text style={styles.notesLine} allowFontScaling={false}>
              <Text style={styles.notesLabel}>Notes: </Text>
              <Text style={styles.noteQuote}>“{data.note!.trim()}”</Text>
            </Text>
          ) : null}
        </View>
      </View>
    </ViewShot>
  );
});

const styles = StyleSheet.create({
  shot: {
    width: SHARE_SCORE_CARD_WIDTH,
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
    paddingBottom: CARD_BOTTOM,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  displayName: {
    fontFamily: BaggedFonts.body,
    fontSize: 16,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  handle: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
  headerLogo: {
    width: 72,
    height: 32,
    flexShrink: 0,
    marginTop: 2,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 4,
  },
  productLeft: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    paddingTop: 2,
  },
  productName: {
    fontFamily: BaggedFonts.display,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
    textTransform: 'uppercase',
    color: BaggedColors.dark,
  },
  brand: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 18,
    color: BaggedColors.muted,
  },
  stores: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: BaggedColors.muted,
    marginTop: 2,
  },
  scoreColumn: {
    width: SCORE_CIRCLE_SIZE + 8,
    alignItems: 'center',
    flexShrink: 0,
  },
  scoreCircle: {
    width: SCORE_CIRCLE_SIZE,
    height: SCORE_CIRCLE_SIZE,
    borderRadius: SCORE_CIRCLE_SIZE / 2,
    borderWidth: 2.5,
    backgroundColor: BaggedColors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  score: {
    fontFamily: BaggedFonts.display,
    fontSize: 30,
    width: SCORE_CIRCLE_SIZE,
    height: SCORE_CIRCLE_SIZE,
    lineHeight: SCORE_CIRCLE_SIZE,
    letterSpacing: -0.5,
    includeFontPadding: false,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  communityUnder: {
    alignItems: 'center',
    marginTop: 6,
    gap: 1,
  },
  communityLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 9,
    fontWeight: '600',
    color: BaggedColors.muted,
    textAlign: 'center',
  },
  communityScore: {
    fontFamily: BaggedFonts.display,
    fontSize: 14,
    lineHeight: 16,
    textAlign: 'center',
  },
  nutritionBlock: {
    alignSelf: 'stretch',
    marginTop: 8,
    gap: 4,
  },
  dietRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  dietChip: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  dietChipText: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: BaggedFonts.body,
  },
  photoRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: PHOTO_GAP,
    marginTop: PHOTO_TOP_MARGIN,
  },
  photoCell: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: BaggedColors.cream,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderSoft,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  notesLine: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 19,
    color: BaggedColors.ink,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  notesLabel: {
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  noteQuote: {
    fontStyle: 'italic',
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
    color: BaggedColors.ink,
  },
});

/** @deprecated Use SHARE_EXPORT_HEIGHT */
export const SHARE_SCORE_CARD_HEIGHT = SHARE_EXPORT_HEIGHT;
