import { StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { formatMacroNumber, macroFieldIsSet, type PostMacros } from '@/lib/data';

/**
 * Renders the four macros as compact monospace pills, matching the web
 * `macrosPills` helper. Returns null when nothing is set, so callers can
 * unconditionally drop it into a row.
 */
export function MacrosPills({
  macros,
  size = 'md',
  centered = false,
  compact = false,
}: {
  macros: PostMacros | null | undefined;
  size?: 'sm' | 'md';
  centered?: boolean;
  compact?: boolean;
}) {
  if (!macros) return null;
  const cells: string[] = [];
  if (macroFieldIsSet(macros.cal))
    cells.push(`${formatMacroNumber(Number(macros.cal))} cal`);
  if (macroFieldIsSet(macros.protein))
    cells.push(`${formatMacroNumber(Number(macros.protein))}g pro`);
  if (macroFieldIsSet(macros.carbs))
    cells.push(`${formatMacroNumber(Number(macros.carbs))}g carbs`);
  if (macroFieldIsSet(macros.fat))
    cells.push(`${formatMacroNumber(Number(macros.fat))}g fat`);
  if (cells.length === 0) return null;

  const fontSize = size === 'sm' ? 10 : 11;
  const padV = size === 'sm' ? 1 : 2;
  const padH = size === 'sm' ? 6 : 8;

  return (
    <View style={[styles.row, centered && styles.rowCentered, compact && styles.rowCompact]}>
      {cells.map((value) => (
        <View
          key={value}
          style={[
            styles.pill,
            {
              paddingVertical: padV,
              paddingHorizontal: padH,
            },
          ]}>
          <Text style={[styles.pillText, { fontSize }]}>{value}</Text>
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
  rowCentered: {
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
  },
  rowCompact: {
    marginTop: 0,
    gap: 4,
  },
  pill: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BaggedColors.dietTag,
  },
  pillText: {
    fontFamily: BaggedFonts.body,
    fontWeight: '700',
    color: BaggedColors.dietTag,
  },
});
