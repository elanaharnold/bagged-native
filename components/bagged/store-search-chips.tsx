import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { STORES, TRADER_JOES_STORE } from '@/constants/grocery';

/** Lowercase letters and digits only, so "trader joes" finds "Trader Joe's" and "heb" finds "H-E-B". */
function squash(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function storesMatchingQuery(query: string, stores: readonly string[] = STORES): string[] {
  const q = squash(query);
  if (!q) return [...stores];
  return stores.filter((s) => squash(s).includes(q));
}

export type StoreChipStyles = {
  chipGrid?: StyleProp<ViewStyle>;
  chip?: StyleProp<ViewStyle>;
  chipActive?: StyleProp<ViewStyle>;
  chipDisabled?: StyleProp<ViewStyle>;
  chipText?: StyleProp<TextStyle>;
  chipTextActive?: StyleProp<TextStyle>;
};

/**
 * Store buttons with a small search box above them. Typing narrows the buttons to matching
 * stores; clearing the box (or picking one) brings them all back.
 */
export function StoreSearchChips({
  selectedStores,
  onToggleStore,
  tjOnly = false,
  chipStyles,
}: {
  selectedStores: string[];
  onToggleStore: (store: string) => void;
  /** Trader Joe's brand items: every other store is disabled. */
  tjOnly?: boolean;
  /** The parent screen's chip styles, so the buttons look the same as before. */
  chipStyles: StoreChipStyles;
}) {
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const visible = useMemo(() => storesMatchingQuery(query), [query]);

  return (
    <View>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={BaggedColors.onBgMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search stores"
          placeholderTextColor={BaggedColors.onBgMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          style={styles.input}
          accessibilityLabel="Search stores"
        />
        {searching ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear store search">
            <Ionicons name="close-circle" size={18} color={BaggedColors.onBgMuted} />
          </Pressable>
        ) : null}
      </View>
      {visible.length === 0 ? (
        <Text style={styles.empty}>No stores match &quot;{query.trim()}&quot;</Text>
      ) : (
        <View style={chipStyles.chipGrid}>
          {visible.map((s) => {
            const active = selectedStores.includes(s);
            const disabled = tjOnly && s !== TRADER_JOES_STORE;
            return (
              <Pressable
                key={s}
                onPress={() => {
                  onToggleStore(s);
                  // Picked from a search: show the full list again with the new pick highlighted.
                  if (searching) setQuery('');
                }}
                disabled={disabled}
                style={[
                  chipStyles.chip,
                  active && chipStyles.chipActive,
                  disabled && chipStyles.chipDisabled,
                ]}>
                <Text style={[chipStyles.chipText, active && chipStyles.chipTextActive]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.onBg,
  },
  empty: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
    paddingVertical: 6,
  },
});
