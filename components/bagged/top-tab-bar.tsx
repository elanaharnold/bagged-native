import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import * as React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { useNotificationUnread } from '@/hooks/use-notification-unread';
import { useAuth } from '@/providers/auth-provider';

const TAB_ROUTE_ORDER = ['index', 'my-list', 'discover', 'profile'] as const;

const TAB_LABELS: Record<string, string> = {
  index: 'FEED',
  'my-list': 'MY LIST',
  discover: 'DISCOVER',
  profile: 'PROFILE',
};

function sketchHit(): void {
  if (Platform.OS === 'ios') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

type TabLabelProps = {
  label: string;
  focused: boolean;
  onPress: () => void;
};

function TopTabLabel({ label, focused, onPress }: TabLabelProps) {
  const textEl = (
    <Text style={[styles.tabText, focused ? styles.tabTextActive : styles.tabTextMuted]}>{label}</Text>
  );

  if (!focused) {
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: false }}
        onPress={() => {
          sketchHit();
          onPress();
        }}
        style={styles.tabPlain}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
        {textEl}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: true }}
      onPress={() => {
        sketchHit();
        onPress();
      }}
      style={styles.tabSketchWrap}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
      {/* Offset “scribble” strokes — reads like a hand-drawn box on the web */}
      <View style={styles.sketchStrokeBack} pointerEvents="none" />
      <View style={styles.sketchStrokeFront} pointerEvents="none" />
      <View style={styles.sketchFill}>{textEl}</View>
    </Pressable>
  );
}

export function BaggedTopTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const router = useRouter();
  const { userId } = useAuth();
  const notifUnread = useNotificationUnread(userId, state.index);

  const visibleRoutes = React.useMemo(
    () => state.routes.filter((r) => r.name !== 'rate-fab'),
    [state.routes]
  );

  const sortedRoutes = React.useMemo(() => {
    const rank = (name: string) => {
      const i = TAB_ROUTE_ORDER.indexOf(name as (typeof TAB_ROUTE_ORDER)[number]);
      return i === -1 ? 99 : i;
    };
    return [...visibleRoutes].sort((a, b) => rank(a.name) - rank(b.name));
  }, [visibleRoutes]);

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
            <Ionicons name="notifications-outline" size={24} color={BaggedColors.onBg} />
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
            <Ionicons name="settings-outline" size={24} color={BaggedColors.onBg} />
          </Pressable>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        {sortedRoutes.map((route) => {
          const focused = state.routes[state.index].name === route.name;
          const label = TAB_LABELS[route.name] ?? route.name.toUpperCase();

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <View key={route.key} style={styles.tabItem}>
              <TopTabLabel label={label} focused={focused} onPress={onPress} />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BaggedColors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BaggedColors.borderOnBg,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingBottom: 10,
  },
  brand: {
    fontFamily: BaggedFonts.display,
    fontSize: 30,
    color: BaggedColors.onBg,
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
    backgroundColor: BaggedColors.accent,
    borderWidth: 2,
    borderColor: BaggedColors.bg,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: BaggedLayout.screenPadding,
    paddingTop: 2,
    gap: 4,
  },
  tabItem: {
    justifyContent: 'center',
  },
  tabPlain: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    fontFamily: BaggedFonts.display,
  },
  tabTextMuted: {
    color: BaggedColors.onBgMuted,
  },
  tabTextActive: {
    color: BaggedColors.ink,
  },
  tabSketchWrap: {
    marginHorizontal: 2,
    paddingVertical: 2,
    paddingHorizontal: 2,
    justifyContent: 'center',
  },
  sketchStrokeBack: {
    position: 'absolute',
    top: 1,
    left: 0,
    right: -1,
    bottom: 0,
    borderWidth: 2,
    borderColor: BaggedColors.ink,
    borderRadius: 12,
    transform: [{ rotate: '-1deg' }],
    opacity: 0.88,
  },
  sketchStrokeFront: {
    position: 'absolute',
    top: 0,
    left: -1,
    right: 0,
    bottom: 1,
    borderWidth: 1.5,
    borderColor: BaggedColors.ink,
    borderRadius: 11,
    transform: [{ rotate: '0.7deg' }],
    opacity: 0.92,
  },
  sketchFill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: BaggedColors.card,
    overflow: 'hidden',
  },
});
