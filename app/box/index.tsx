import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BoxProgress } from '@/components/bagged/box-progress';
import { PrimaryButton } from '@/components/bagged/primary-button';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { productDetailParamsForSearchRow } from '@/lib/barcode';
import { fetchMyBoxes, searchRowsForBoxItems, type MyBox } from '@/lib/boxes';
import type { SearchProductRow } from '@/lib/data';

/** "Your box": what's in each box the user claimed and how much they've ranked. */
export default function BoxScreen() {
  const router = useRouter();
  const [boxes, setBoxes] = useState<MyBox[]>([]);
  const [rowsByKey, setRowsByKey] = useState<Map<string, SearchProductRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const next = await fetchMyBoxes();
    setBoxes(next);
    const rows = await searchRowsForBoxItems(next.flatMap((b) => b.items));
    setRowsByKey(
      new Map(rows.map((r) => [String(r.descriptionKey ?? '').toLowerCase(), r]))
    );
  }, []);

  // Refresh every time the screen comes back into view (e.g. after ranking an item).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await load();
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openItem = useCallback(
    (descriptionKey: string) => {
      const row = rowsByKey.get(descriptionKey.toLowerCase());
      if (!row) return;
      router.push({ pathname: '/product/detail', params: productDetailParamsForSearchRow(row, 'search') });
    },
    [router, rowsByKey]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={BaggedColors.dark} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Your box</Text>
          <Text style={styles.subtitle}>Rank everything to unlock your next one</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={BaggedColors.dark} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {boxes.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="cube-outline" size={40} color={BaggedColors.muted} />
              <Text style={styles.emptyTitle}>No box yet</Text>
              <Text style={styles.emptyText}>
                Got a Bagged box? Scan the code on it to see what&apos;s inside and start ranking.
              </Text>
            </View>
          ) : (
            boxes.map((box) => (
              <View key={box.boxId} style={styles.card}>
                <Text style={styles.boxName}>{box.name}</Text>
                <BoxProgress rankedCount={box.rankedCount} total={box.total} daysLeft={box.daysLeft} />
                {box.isComplete ? (
                  <Text style={styles.doneText}>
                    You ranked everything. Your next box is unlocked.
                  </Text>
                ) : null}
                <View style={styles.items}>
                  {box.items.map((item) => (
                    <Pressable
                      key={item.descriptionKey}
                      disabled={item.ranked}
                      onPress={() => openItem(item.descriptionKey)}
                      style={({ pressed }) => [styles.itemRow, pressed && styles.itemRowPressed]}>
                      <Ionicons
                        name={item.ranked ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={item.ranked ? BaggedColors.accent : BaggedColors.muted}
                      />
                      <View style={styles.itemText}>
                        <Text style={[styles.itemName, item.ranked && styles.itemNameDone]} numberOfLines={2}>
                          {item.name}
                        </Text>
                        {item.brand ? <Text style={styles.itemBrand}>{item.brand}</Text> : null}
                      </View>
                      {item.ranked ? (
                        <Text style={styles.rankedLabel}>Ranked</Text>
                      ) : (
                        <View style={styles.rankBtn}>
                          <Text style={styles.rankBtnText}>Rank</Text>
                        </View>
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            ))
          )}
          <View style={styles.footer}>
            <PrimaryButton
              label={boxes.length === 0 ? 'Add a box' : 'Add another box'}
              variant={boxes.length === 0 ? 'primary' : 'ghost'}
              onPress={() => router.push('/box/claim')}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BaggedColors.content },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BaggedColors.border,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerSpacer: { width: 40 },
  title: { fontFamily: BaggedFonts.display, fontSize: 18, color: BaggedColors.dark },
  subtitle: { fontFamily: BaggedFonts.body, fontSize: 12, color: BaggedColors.muted, marginTop: 2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { padding: BaggedLayout.screenPadding, gap: 16 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 16 },
  emptyTitle: { fontFamily: BaggedFonts.display, fontSize: 20, color: BaggedColors.dark },
  emptyText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: BaggedColors.muted,
    textAlign: 'center',
  },
  card: {
    borderWidth: 1,
    borderColor: BaggedColors.borderSoft,
    borderRadius: BaggedLayout.cardRadius,
    padding: 16,
    gap: 12,
  },
  boxName: { fontFamily: BaggedFonts.display, fontSize: 22, color: BaggedColors.dark },
  doneText: { fontFamily: BaggedFonts.body, fontSize: 14, fontWeight: '600', color: BaggedColors.accent },
  items: { gap: 2 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BaggedColors.borderSoft,
  },
  itemRowPressed: { opacity: 0.6 },
  itemText: { flex: 1 },
  itemName: { fontFamily: BaggedFonts.body, fontSize: 15, fontWeight: '600', color: BaggedColors.ink },
  itemNameDone: { color: BaggedColors.muted },
  itemBrand: { fontFamily: BaggedFonts.body, fontSize: 13, color: BaggedColors.muted, marginTop: 2 },
  rankedLabel: { fontFamily: BaggedFonts.body, fontSize: 13, color: BaggedColors.muted },
  rankBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: BaggedColors.accent,
  },
  rankBtnText: { fontFamily: BaggedFonts.body, fontSize: 13, fontWeight: '700', color: BaggedColors.white },
  footer: { marginTop: 8 },
});
