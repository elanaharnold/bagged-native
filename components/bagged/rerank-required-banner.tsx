import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

type RerankRequiredBannerProps = {
  count: number;
  /** When set, the whole banner is tappable (e.g. jump to the only pending item). */
  onPress?: () => void;
};

export function RerankRequiredBanner({ count, onPress }: RerankRequiredBannerProps) {
  if (count <= 0) return null;

  const body = (
    <View style={styles.banner}>
      <Text style={styles.title}>Re-rank needed</Text>
      <Text style={styles.body}>
        {count === 1
          ? 'This item was moved to a new category. Compare it against others in that category to get a new score.'
          : `${count} items were moved to new categories. Re-rank each one to get an updated score.`}
      </Text>
      {onPress ? <Text style={styles.cta}>Tap to re-rank</Text> : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

type RerankRequiredChipProps = {
  onPress: () => void;
};

export function RerankRequiredChip({ onPress }: RerankRequiredChipProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <Text style={styles.chipText}>Re-rank</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 20,
    marginBottom: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BaggedColors.gold,
    backgroundColor: 'rgba(255, 193, 7, 0.12)',
    gap: 6,
  },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  body: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: BaggedColors.onBgMuted,
  },
  cta: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: BaggedColors.accent,
    marginTop: 2,
  },
  chip: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: BaggedColors.dark,
  },
  chipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.green,
  },
  pressed: { opacity: 0.85 },
});
