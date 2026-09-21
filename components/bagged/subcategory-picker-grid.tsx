import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  getParentCategory,
  PARENT_CATEGORIES,
  type ParentCategory,
  type Subcategory,
} from '@/constants/categories';

type SubcategoryPickerGridProps = {
  selectedSubcategoryId: string | null;
  onSelect: (subcategoryId: string | null) => void;
  /** When set, only show subcategories under this parent. */
  parentId?: string | null;
  /** Hide these subcategory ids (e.g. the suggestion user already rejected). */
  excludeSubcategoryIds?: string[];
  compact?: boolean;
  /** `stepped` picks parent first, then subcategory — better for long forms. */
  layout?: 'full' | 'stepped';
};

export function SubcategoryPickerGrid({
  selectedSubcategoryId,
  onSelect,
  parentId = null,
  excludeSubcategoryIds = [],
  compact = false,
  layout = 'full',
}: SubcategoryPickerGridProps) {
  const excluded = new Set(excludeSubcategoryIds);
  const parents: ParentCategory[] = parentId
    ? PARENT_CATEGORIES.filter((p) => p.id === parentId)
    : PARENT_CATEGORIES;

  const selectedParentId = getParentCategory(selectedSubcategoryId ?? '')?.id ?? null;
  const [activeParentId, setActiveParentId] = useState<string | null>(selectedParentId);

  useEffect(() => {
    if (selectedParentId) {
      setActiveParentId(selectedParentId);
    }
  }, [selectedParentId]);

  if (layout === 'stepped' && !parentId) {
    const activeParent = parents.find((p) => p.id === activeParentId) ?? null;
    const subs =
      activeParent?.subcategories.filter((sub) => !excluded.has(sub.id)) ?? [];

    const pickParent = (nextParentId: string) => {
      setActiveParentId(nextParentId);
      if (selectedSubcategoryId) {
        const currentParent = getParentCategory(selectedSubcategoryId)?.id;
        if (currentParent !== nextParentId) {
          onSelect(null);
        }
      }
    };

    return (
      <View style={styles.steppedWrap}>
        <View style={styles.pillGrid}>
          {parents.map((parent) => {
            const active = activeParentId === parent.id;
            return (
              <Pressable
                key={parent.id}
                onPress={() => pickParent(parent.id)}
                style={[styles.pill, active && styles.pillActive]}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {parent.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {activeParent ? (
          <View style={styles.subPillBlock}>
            <Text style={styles.subListHeading}>{activeParent.label}</Text>
            <View style={styles.pillGrid}>
              {subs.map((sub) => {
                const selected = selectedSubcategoryId === sub.id;
                return (
                  <Pressable
                    key={sub.id}
                    onPress={() => onSelect(sub.id)}
                    style={[styles.pill, selected && styles.pillActive]}>
                    <Text style={[styles.pillText, selected && styles.pillTextActive]}>
                      {sub.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <Text style={styles.steppedHint}>Select a category above to see types.</Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {parents.map((parent) => {
        const subs = parent.subcategories.filter((sub) => !excluded.has(sub.id));
        if (subs.length === 0) return null;
        return (
          <View key={parent.id} style={styles.parentBlock}>
            <Text style={styles.parentLabel}>{parent.label}</Text>
            <View style={styles.tileGrid}>
              {subs.map((sub) => (
                <SubcategoryTile
                  key={sub.id}
                  subcategory={sub}
                  selected={selectedSubcategoryId === sub.id}
                  compact={compact}
                  onPress={() => onSelect(sub.id)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SubcategoryTile({
  subcategory,
  selected,
  compact,
  onPress,
}: {
  subcategory: Subcategory;
  selected: boolean;
  compact: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        compact && styles.tileCompact,
        selected && styles.tileSelected,
        pressed && styles.tilePressed,
      ]}>
      <Text style={[styles.tileText, selected && styles.tileTextSelected]} numberOfLines={3}>
        {subcategory.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  steppedWrap: {
    gap: 12,
    marginTop: 4,
  },
  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
    backgroundColor: 'transparent',
  },
  pillActive: {
    borderColor: BaggedColors.dark,
    backgroundColor: BaggedColors.dark,
  },
  pillText: {
    fontFamily: BaggedFonts.display,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.onBgMuted,
  },
  pillTextActive: {
    color: BaggedColors.green,
  },
  steppedHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    textAlign: 'center',
    paddingVertical: 8,
  },
  subPillBlock: {
    gap: 8,
  },
  subListHeading: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.onBgMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  wrap: {
    gap: 20,
  },
  parentBlock: {
    gap: 10,
  },
  parentLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    minWidth: '47%',
    flexGrow: 1,
    flexBasis: '47%',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
  },
  tileCompact: {
    minWidth: '44%',
    flexBasis: '44%',
    paddingVertical: 12,
  },
  tileSelected: {
    borderColor: BaggedColors.dark,
    backgroundColor: BaggedColors.dark,
  },
  tilePressed: {
    opacity: 0.85,
  },
  tileText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.dark,
    lineHeight: 17,
  },
  tileTextSelected: {
    color: BaggedColors.green,
  },
});
