import { Image, StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

const VerifiedIcon = require('@/assets/images/verified-ambassador-icon.png');

type SizeProps = {
  compact?: boolean;
};

export function VerifiedAmbassadorCheck({ compact = false }: SizeProps) {
  return (
    <Image
      source={VerifiedIcon}
      style={[styles.icon, compact && styles.iconCompact]}
      accessibilityIgnoresInvertColors
      accessibilityLabel="Verified"
    />
  );
}

export function VerifiedAmbassadorLabel({ compact = false }: SizeProps) {
  return <Text style={[styles.label, compact && styles.labelCompact]}>Verified Ambassador</Text>;
}

/** Username row + label stack for verified ambassadors. */
export function VerifiedAmbassadorBadge({ compact = false }: SizeProps) {
  return (
    <View style={[styles.labelWrap, compact && styles.labelWrapCompact]}>
      <VerifiedAmbassadorLabel compact={compact} />
    </View>
  );
}

const styles = StyleSheet.create({
  labelWrap: {
    marginTop: 2,
    marginBottom: 2,
  },
  labelWrapCompact: {
    marginTop: 1,
    marginBottom: 0,
  },
  icon: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  iconCompact: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  label: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  labelCompact: {
    fontSize: 11,
    fontWeight: '600',
  },
});
