import { StyleSheet, Text, View } from 'react-native';

import { BaggedFonts } from '@/constants/bagged-theme';
import { type PostMacros } from '@/lib/data';

type Pill = { value: string; bg: string; color: string };

/**
 * Renders the four macros as compact monospace pills, matching the web
 * `macrosPills` helper. Returns null when nothing is set, so callers can
 * unconditionally drop it into a row.
 */
export function MacrosPills({
  macros,
  size = 'md',
}: {
  macros: PostMacros | null | undefined;
  size?: 'sm' | 'md';
}) {
  if (!macros) return null;
  const cells: Pill[] = [];
  if (macros.cal != null) cells.push({ value: `${Math.round(macros.cal)} cal`, bg: '#F4F2EC', color: '#555555' });
  if (macros.protein != null) cells.push({ value: `${Math.round(macros.protein)}g pro`, bg: '#E6F7EE', color: '#1A8C4E' });
  if (macros.carbs != null) cells.push({ value: `${Math.round(macros.carbs)}g carbs`, bg: '#FFF3E0', color: '#F57C00' });
  if (macros.fat != null) cells.push({ value: `${Math.round(macros.fat)}g fat`, bg: '#E1F5FE', color: '#0288D1' });
  if (cells.length === 0) return null;

  const fontSize = size === 'sm' ? 10 : 11;
  const padV = size === 'sm' ? 1 : 2;
  const padH = size === 'sm' ? 6 : 8;

  return (
    <View style={styles.row}>
      {cells.map((p) => (
        <View
          key={p.value}
          style={[
            styles.pill,
            {
              backgroundColor: p.bg,
              paddingVertical: padV,
              paddingHorizontal: padH,
            },
          ]}>
          <Text style={[styles.pillText, { color: p.color, fontSize }]}>{p.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  pill: {
    borderRadius: 8,
  },
  pillText: {
    fontFamily: BaggedFonts.body,
    fontWeight: '700',
  },
});
