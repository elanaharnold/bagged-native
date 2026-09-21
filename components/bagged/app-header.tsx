import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { useNotificationUnread } from '@/hooks/use-notification-unread';
import { useAuth } from '@/providers/auth-provider';

function sketchHit(): void {
  if (Platform.OS === 'ios') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

type BaggedAppHeaderProps = {
  /** Active tab index — drives notification refresh when switching tabs. */
  activeTabIndex?: number;
};

/** Green chrome: cream wordmark + notifications + settings. Sits above tab content. */
export function BaggedAppHeader({ activeTabIndex = 0 }: BaggedAppHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const notifUnread = useNotificationUnread(userId, activeTabIndex);

  return (
    <View
      style={[
        styles.bar,
        {
          paddingTop: insets.top + 4,
        },
      ]}>
      <View style={styles.headerRow}>
        <Text style={styles.brand} accessibilityRole="header">
          bagged
        </Text>
        <View style={styles.headerIcons}>
          <Pressable
            onPress={() => {
              sketchHit();
              router.push('/notifications');
            }}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Notifications">
            <Ionicons name="notifications-outline" size={24} color={BaggedColors.cream} />
            {notifUnread ? <View style={styles.notifDot} /> : null}
          </Pressable>
          <Pressable
            onPress={() => {
              sketchHit();
              router.push('/settings');
            }}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Settings">
            <Ionicons name="settings-outline" size={24} color={BaggedColors.cream} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BaggedColors.blue,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.25)',
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: BaggedLayout.screenPadding,
  },
  brand: {
    fontFamily: BaggedFonts.display,
    fontSize: 30,
    color: BaggedColors.cream,
    letterSpacing: -0.5,
    textTransform: 'lowercase',
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  iconBtn: {
    position: 'relative',
    padding: 6,
  },
  notifDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: BaggedColors.cream,
    borderWidth: 2,
    borderColor: BaggedColors.blue,
  },
});
