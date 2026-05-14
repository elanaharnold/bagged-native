import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { searchRowBrand, type SearchProductRow } from '@/lib/data';
import { formatProductDisplayName } from '@/lib/format';

type SearchResultRowProps = {
  row: SearchProductRow;
  onPress: (row: SearchProductRow) => void;
};

export function SearchResultRow({ row, onPress }: SearchResultRowProps) {
  const brand = searchRowBrand(row);
  return (
    <Pressable
      onPress={() => onPress(row)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.thumb}>
        <Text style={styles.thumbText}>
          {(row.description.charAt(0) || '?').toUpperCase()}
        </Text>
      </View>
      <View style={styles.body}>
        <AutoFitText style={styles.name} numberOfLines={2}>
          {formatProductDisplayName(row.description)}
        </AutoFitText>
        {brand ? (
          <AutoFitText style={styles.brand} numberOfLines={1}>
            {formatProductDisplayName(brand)}
          </AutoFitText>
        ) : null}
        {row.foodCategory ? (
          <AutoFitText style={styles.category} numberOfLines={1}>
            {row.foodCategory}
          </AutoFitText>
        ) : null}
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
  pressed: { opacity: 0.7 },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.dark,
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
  name: {
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
  category: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.onBgMuted,
    marginTop: 2,
    fontStyle: 'italic',
  },
});
