import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DIET_TAGS,
  HIGH_PROTEIN_LOW_CAL_ID,
  type MacroRatioInput,
  isHighProteinLowCalTagToggleDisabled,
} from '@/constants/diet-tags';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

type Props = {
  selectedIds: string[];
  onToggle: (id: string) => void;
  macros: MacroRatioInput;
};

export function DietTagChips({ selectedIds, onToggle, macros }: Props) {
  return (
    <View style={styles.chipGrid}>
      {DIET_TAGS.map((tag) => {
        const active = selectedIds.includes(tag.id);
        const disabled =
          tag.id === HIGH_PROTEIN_LOW_CAL_ID &&
          isHighProteinLowCalTagToggleDisabled(macros, active);
        return (
          <Pressable
            key={tag.id}
            onPress={() => onToggle(tag.id)}
            disabled={disabled}
            style={[
              styles.dietChip,
              { borderColor: tag.color, backgroundColor: tag.bg },
              active && { backgroundColor: tag.bgActive },
              disabled && styles.dietChipDisabled,
            ]}>
            <Text
              style={[
                styles.dietChipText,
                { color: tag.color },
                active && { fontWeight: '700' },
                disabled && !active && styles.dietChipTextDisabled,
              ]}>
              {tag.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dietChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BaggedColors.dietTag,
    backgroundColor: BaggedColors.dietTagBg,
  },
  dietChipDisabled: {
    opacity: 0.4,
  },
  dietChipText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.dietTag,
  },
  dietChipTextDisabled: {
    color: BaggedColors.onBgMuted,
  },
});
