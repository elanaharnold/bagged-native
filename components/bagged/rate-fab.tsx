import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOTTOM_TAB_BAR_BODY_HEIGHT } from '@/components/bagged/bottom-tab-bar';
import { BaggedColors } from '@/constants/bagged-theme';

const FAB_SIZE = 60;
const FAB_GAP_ABOVE_TAB_BAR = 10;

/** Floating primary CTA — charcoal circle with a plus icon (rate or want-to-try). */
export function BaggedRateFab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomOffset =
    Math.max(insets.bottom, 8) + BOTTOM_TAB_BAR_BODY_HEIGHT + FAB_GAP_ABOVE_TAB_BAR;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          bottom: bottomOffset,
        },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add an item"
        onPress={() => {
          if (Platform.OS === 'ios') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
          router.push('/rate');
        }}
        style={styles.fab}
        hitSlop={8}>
        <Ionicons name="add" size={32} color={BaggedColors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: BaggedColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: BaggedColors.charcoal,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 5,
  },
});
