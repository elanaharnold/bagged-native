import { StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

/** "3 of 6 ranked" with a bar. `compact` is the slim version for the + screen. */
export function BoxProgress({
  rankedCount,
  total,
  daysLeft,
  compact = false,
}: {
  rankedCount: number;
  total: number;
  daysLeft?: number;
  compact?: boolean;
}) {
  const pct = total > 0 ? Math.min(1, rankedCount / total) : 0;
  const done = total > 0 && rankedCount >= total;
  return (
    <View style={compact ? styles.wrapCompact : styles.wrap}>
      <View style={styles.labels}>
        <Text style={[styles.count, compact && styles.countCompact]}>
          {done ? 'All ranked' : `${rankedCount} of ${total} ranked`}
        </Text>
        {typeof daysLeft === 'number' && !done ? (
          <Text style={styles.days}>
            {daysLeft === 0 ? 'Due today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
          </Text>
        ) : null}
      </View>
      <View
        style={[styles.track, compact && styles.trackCompact]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: rankedCount }}>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  wrapCompact: { gap: 6 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  count: { fontFamily: BaggedFonts.body, fontSize: 15, fontWeight: '700', color: BaggedColors.ink },
  countCompact: { fontSize: 13 },
  days: { fontFamily: BaggedFonts.body, fontSize: 13, color: BaggedColors.muted },
  track: {
    height: 10,
    borderRadius: 999,
    backgroundColor: BaggedColors.accentPale,
    overflow: 'hidden',
  },
  trackCompact: { height: 6 },
  fill: { height: '100%', borderRadius: 999, backgroundColor: BaggedColors.accent },
});
