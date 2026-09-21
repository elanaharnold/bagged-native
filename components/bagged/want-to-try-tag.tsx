import { StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

type WantToTryTagProps = {
  /** Smaller pill for tight rows (My List). */
  compact?: boolean;
};

/** Distinguishes want-to-try posts / list rows from ranked items. */
export function WantToTryTag({ compact = false }: WantToTryTagProps) {
  return (
    <View style={[styles.badge, compact && styles.badgeCompact]}>
      <Text style={[styles.text, compact && styles.textCompact]} allowFontScaling={false}>
        Want to try
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: BaggedColors.accentPale,
    borderWidth: 1,
    borderColor: BaggedColors.accent,
    flexShrink: 0,
  },
  badgeCompact: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  text: {
    fontFamily: BaggedFonts.body,
    fontSize: 10,
    fontWeight: '700',
    color: BaggedColors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  textCompact: {
    fontSize: 9,
    letterSpacing: 0.25,
  },
});
