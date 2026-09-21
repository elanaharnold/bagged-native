import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import * as React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/bagged/avatar';
import { BaggedColors, BaggedLayout } from '@/constants/bagged-theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

export const BOTTOM_TAB_BAR_BODY_HEIGHT = 52;

const TAB_ROUTE_ORDER = ['index', 'my-list', 'discover', 'friends', 'profile'] as const;

const TAB_ACCESSIBILITY_LABELS: Record<string, string> = {
  index: 'Home',
  'my-list': 'My List',
  discover: 'Discover',
  friends: 'Friends',
  profile: 'Profile',
};

const TAB_ACTIVE_COLOR = BaggedColors.accent;
const TAB_INACTIVE_COLOR = BaggedColors.muted;

function sketchHit(): void {
  if (Platform.OS === 'ios') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

type TabIconProps = {
  routeName: string;
  focused: boolean;
  onPress: () => void;
  profileChar: string;
  profileColor: string;
};

function BottomTabIcon({ routeName, focused, onPress, profileChar, profileColor }: TabIconProps) {
  const color = focused ? TAB_ACTIVE_COLOR : TAB_INACTIVE_COLOR;
  const label = TAB_ACCESSIBILITY_LABELS[routeName] ?? routeName;

  let icon: React.ReactNode;
  switch (routeName) {
    case 'index':
      icon = <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />;
      break;
    case 'my-list':
      icon = (
        <Ionicons
          name={focused ? 'document-text' : 'document-text-outline'}
          size={24}
          color={color}
        />
      );
      break;
    case 'discover':
      icon = <Ionicons name={focused ? 'search' : 'search-outline'} size={24} color={color} />;
      break;
    case 'friends':
      icon = <Ionicons name={focused ? 'people' : 'people-outline'} size={24} color={color} />;
      break;
    case 'profile':
      icon = (
        <Avatar char={profileChar} color={profileColor} size={26} borderColor={color} />
      );
      break;
    default:
      return null;
  }

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      onPress={() => {
        sketchHit();
        onPress();
      }}
      style={styles.tabButton}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      {icon}
    </Pressable>
  );
}

/** Primary nav — home, my list, discover, friends, profile — pinned to the bottom. */
export function BaggedBottomTabBar(props: BottomTabBarProps) {
  const { state, navigation, insets } = props;
  const tabBarStyle = 'style' in props ? (props as BottomTabBarProps & { style?: object }).style : undefined;
  const { userId, username } = useAuth();
  const [avatarColor, setAvatarColor] = React.useState<string>(BaggedColors.accent);

  React.useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('avatar_color')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const next = String((data as { avatar_color?: string | null } | null)?.avatar_color ?? '').trim();
        if (next) setAvatarColor(next);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const profileChar = (username || '?').charAt(0).toUpperCase();

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

  const bottomInset = Math.max(insets?.bottom ?? 0, 8);

  return (
    <View
      style={[
        styles.bar,
        tabBarStyle,
        {
          height: BOTTOM_TAB_BAR_BODY_HEIGHT + bottomInset,
          paddingBottom: bottomInset,
        },
      ]}>
      <View style={styles.row}>
        {sortedRoutes.map((route) => {
          const focused = state.routes[state.index].name === route.name;

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
              <BottomTabIcon
                routeName={route.name}
                focused={focused}
                onPress={onPress}
                profileChar={profileChar}
                profileColor={avatarColor}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BaggedColors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BaggedColors.border,
    ...BaggedLayout.shadowCard,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    height: BOTTOM_TAB_BAR_BODY_HEIGHT,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
});
