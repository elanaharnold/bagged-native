import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';

/** Floating primary CTA — web-style charcoal pill, bottom center above safe area. */
export function BaggedRateFab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          paddingBottom: Math.max(insets.bottom, 10) + 8,
        },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Rate an item"
        onPress={() => {
          if (Platform.OS === 'ios') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
          router.push('/rate');
        }}
        style={styles.pill}
        hitSlop={8}>
        <Text style={styles.label}>+ RATE ITEM</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: BaggedLayout.pillRadius,
    backgroundColor: BaggedColors.dark,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 5,
  },
  label: {
    color: BaggedColors.white,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: BaggedFonts.display,
  },
});
