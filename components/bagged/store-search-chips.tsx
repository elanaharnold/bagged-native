import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  Keyboard,
  Pressable,
  type ScrollView,
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
  scrollRef,
}: {
  selectedStores: string[];
  onToggleStore: (store: string) => void;
  /** Trader Joe's brand items: every other store is disabled. */
  tjOnly?: boolean;
  /** The parent screen's chip styles, so the buttons look the same as before. */
  chipStyles: StoreChipStyles;
  /**
   * The screen's ScrollView. When the search box is focused it scrolls to the top of the
   * screen so the matching stores sit between it and the keyboard instead of behind it.
   */
  scrollRef?: RefObject<ScrollView | null>;
}) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const searching = query.trim().length > 0;
  const visible = useMemo(() => storesMatchingQuery(query), [query]);

  const rowRef = useRef<View>(null);
  /** Height of the full button list, so the section doesn't collapse while searching. */
  const [fullListHeight, setFullListHeight] = useState(0);
  const pendingKeyboardSub = useRef<{ remove: () => void } | null>(null);

  useEffect(() => () => pendingKeyboardSub.current?.remove(), []);

  const scrollSearchToTop = useCallback(() => {
    const scroll = scrollRef?.current;
    const row = rowRef.current;
    if (!scroll || !row) return;
    // Measure against the scroll content (not the visible frame) to get an absolute offset.
    // getInnerViewRef exists at runtime but is missing from React Native's type definitions.
    const withInnerRef = scroll as unknown as { getInnerViewRef?: () => unknown };
    const inner = withInnerRef.getInnerViewRef?.() ?? scroll.getInnerViewNode();
    if (!inner) return;
    row.measureLayout(
      inner as View,
      (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 12), animated: true }),
      () => {}
    );
  }, [scrollRef]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    if (!scrollRef) return;
    pendingKeyboardSub.current?.remove();
    if (Keyboard.isVisible()) {
      setTimeout(scrollSearchToTop, 50);
      return;
    }
    // Wait for the keyboard so our scroll lands after the system's own focus scroll.
    pendingKeyboardSub.current = Keyboard.addListener('keyboardDidShow', () => {
      pendingKeyboardSub.current?.remove();
      pendingKeyboardSub.current = null;
      scrollSearchToTop();
    });
  }, [scrollRef, scrollSearchToTop]);

  return (
    <View>
      <View ref={rowRef} style={styles.searchRow}>
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
          onFocus={handleFocus}
          onBlur={() => setFocused(false)}
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
      <View
        // Hold the full list's height while searching so the page doesn't shrink under the
        // keyboard and drag the results out of view.
        style={focused || searching ? { minHeight: fullListHeight } : undefined}
        onLayout={(e) => {
          if (!searching) setFullListHeight(e.nativeEvent.layout.height);
        }}>
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
