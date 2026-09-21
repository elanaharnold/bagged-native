import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/bagged/avatar';
import { UsernameLink } from '@/components/bagged/username-link';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import type { LeaderboardRow } from '@/lib/data';

type LeaderboardListProps = {
  rows: LeaderboardRow[];
  activeUsername?: string | null;
  onPressUser: (username: string) => void;
};

export function LeaderboardList({ rows, activeUsername, onPressUser }: LeaderboardListProps) {
  if (rows.length === 0) return null;

  return (
    <View style={styles.body}>
      {rows.map((row, idx) => {
        const active = Boolean(activeUsername && row.username === activeUsername);
        const isLast = idx === rows.length - 1;
        return (
          <Pressable
            key={row.userId}
            onPress={() => onPressUser(row.username)}
            hitSlop={4}
            style={({ pressed }) => [
              styles.row,
              active && styles.rowActive,
              isLast && styles.rowLast,
              pressed && styles.pressed,
            ]}>
            <Text
              style={[styles.rank, active && styles.rankActive]}
              numberOfLines={1}
              allowFontScaling={false}>
              #{row.rank}
            </Text>
            <Avatar
              char={row.username.charAt(0).toUpperCase()}
              color={row.avatarColor ?? BaggedColors.accent}
              size={32}
            />
            <View style={styles.nameCol}>
              <UsernameLink
                username={row.username}
                style={[styles.name, active && styles.nameActive]}
                verified={row.isVerifiedAmbassador}
              />
            </View>
            <Text style={styles.count}>{row.rankedCount} ranked</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    backgroundColor: BaggedColors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderSoft,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowActive: {
    backgroundColor: BaggedColors.accentPaleActive,
  },
  pressed: {
    opacity: 0.85,
  },
  rank: {
    fontFamily: BaggedFonts.display,
    fontSize: 16,
    color: BaggedColors.muted,
    minWidth: 56,
    flexShrink: 0,
    textAlign: 'center',
    lineHeight: 20,
    includeFontPadding: false,
  },
  rankActive: {
    color: BaggedColors.accent,
  },
  nameCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  name: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
  nameActive: {
    color: BaggedColors.accent,
  },
  count: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
    fontWeight: '600',
  },
});
