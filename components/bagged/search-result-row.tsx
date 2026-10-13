import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { searchRowBrand, type SearchProductRow } from '@/lib/data';
import { formatProductDisplayName } from '@/lib/format';

type SearchResultRowProps = {
  row: SearchProductRow;
  onPress: (row: SearchProductRow) => void;
  alreadyRanked?: boolean;
  /** Still tappable when already ranked (e.g. opening the product page instead of ranking). */
  pressableWhenRanked?: boolean;
};

export function SearchResultRow({
  row,
  onPress,
  alreadyRanked = false,
  pressableWhenRanked = false,
}: SearchResultRowProps) {
  const brand = searchRowBrand(row);
  const blocked = alreadyRanked && !pressableWhenRanked;
  return (
    <Pressable
      onPress={() => {
        if (blocked) return;
        onPress(row);
      }}
      style={({ pressed }) => [
        styles.row,
        blocked && styles.rowAlreadyRanked,
        pressed && !blocked && styles.pressed,
      ]}>
      <View style={styles.thumb}>
        <Text style={styles.thumbText}>
          {(row.description.charAt(0) || '?').toUpperCase()}
        </Text>
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <AutoFitText style={styles.name} numberOfLines={3}>
            {formatProductDisplayName(row.description)}
          </AutoFitText>
          {typeof row.ratedCount === 'number' && row.ratedCount > 0 ? (
            <View style={styles.ratedPill}>
              <Text style={styles.ratedPillText}>Rated by {row.ratedCount} users</Text>
            </View>
          ) : null}
        </View>
        {brand ? (
          <AutoFitText style={styles.brand} numberOfLines={1}>
            {formatProductDisplayName(brand)}
          </AutoFitText>
        ) : null}
        <View style={styles.metaRow}>
          {row.foodCategory ? (
            <AutoFitText style={styles.category} numberOfLines={1}>
              {row.foodCategory}
            </AutoFitText>
          ) : null}
          {alreadyRanked ? (
            <View style={styles.alreadyRankedPill}>
              <Text style={styles.alreadyRankedText}>Already ranked</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderOnBg,
  },
  rowAlreadyRanked: {
    opacity: 0.72,
  },
  pressed: { opacity: 0.7 },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.dark,
  },
  body: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.onBg,
    lineHeight: 19,
  },
  brand: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.onBgMuted,
    marginTop: 2,
  },
  ratedPill: {
    flexShrink: 0,
    backgroundColor: BaggedColors.accent,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 1,
  },
  ratedPillText: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    fontWeight: '700',
    color: BaggedColors.white,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  category: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.onBgMuted,
    fontStyle: 'italic',
  },
  alreadyRankedPill: {
    backgroundColor: BaggedColors.card,
    borderWidth: 1,
    borderColor: BaggedColors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  alreadyRankedText: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    fontWeight: '700',
    color: BaggedColors.onBgMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
