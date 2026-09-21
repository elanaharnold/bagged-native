import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/bagged/primary-button';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  dismissDuplicate,
  fetchDuplicateCandidates,
  mergeDuplicate,
  suggestedCanonicalSide,
  type DuplicateCandidate,
  type DuplicateSide,
} from '@/lib/admin-duplicates';
import { isAdminUsername } from '@/lib/data';
import { formatProductDisplayName } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';

function pairId(c: DuplicateCandidate): string {
  return `${c.key_a}|${c.key_b}`;
}

export default function AdminDuplicatesScreen() {
  const router = useRouter();
  const { username } = useAuth();
  const isAdmin = isAdminUsername(username);
  const [items, setItems] = useState<DuplicateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErrorMsg(null);
      setItems(await fetchDuplicateCandidates());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load duplicates.');
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void load().finally(() => setLoading(false));
  }, [isAdmin, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const removeItem = useCallback((c: DuplicateCandidate) => {
    setItems((prev) => prev.filter((x) => pairId(x) !== pairId(c)));
  }, []);

  const confirmMerge = useCallback(
    (c: DuplicateCandidate, keep: DuplicateSide) => {
      const keepName = formatProductDisplayName(keep === 'a' ? c.item_a : c.item_b);
      const dropName = formatProductDisplayName(keep === 'a' ? c.item_b : c.item_a);
      Alert.alert(
        'Merge these products?',
        `Everyone's posts, want-to-try items and barcodes for "${dropName}" will be renamed to "${keepName}". This can't be undone from the app.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Merge',
            style: 'destructive',
            onPress: async () => {
              setBusyId(pairId(c));
              const res = await mergeDuplicate(c, keep);
              setBusyId(null);
              if (res.ok) {
                removeItem(c);
                return;
              }
              if (res.reason === 'same_user_conflict') {
                Alert.alert(
                  'Same person ranked both',
                  `${res.users.length ? res.users.map((u) => `@${u}`).join(', ') : 'A user'} ranked both versions. Delete one of their two posts first, then merge.`
                );
                return;
              }
              Alert.alert('Could not merge', res.message);
            },
          },
        ]
      );
    },
    [removeItem]
  );

  const onDismiss = useCallback(
    async (c: DuplicateCandidate) => {
      setBusyId(pairId(c));
      const ok = await dismissDuplicate(c);
      setBusyId(null);
      if (ok) removeItem(c);
      else Alert.alert('Could not save', 'Try again in a moment.');
    },
    [removeItem]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={BaggedColors.dark} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Potential duplicates</Text>
          <Text style={styles.subtitle}>Admin only</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {!isAdmin ? (
        <View style={styles.centered}>
          <Text style={styles.emptyBody}>This page is only for admins.</Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={BaggedColors.dark} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BaggedColors.dark} />
          }>
          {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
          {!errorMsg && items.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>Nothing to review</Text>
              <Text style={styles.emptyBody}>
                Scanned products that look like an existing one will show up here.
              </Text>
            </View>
          ) : null}
          {items.map((c) => (
            <DuplicateCard
              key={pairId(c)}
              c={c}
              busy={busyId === pairId(c)}
              onKeep={(side) => confirmMerge(c, side)}
              onDismiss={() => void onDismiss(c)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function DuplicateCard({
  c,
  busy,
  onKeep,
  onDismiss,
}: {
  c: DuplicateCandidate;
  busy: boolean;
  onKeep: (side: DuplicateSide) => void;
  onDismiss: () => void;
}) {
  const suggested = suggestedCanonicalSide(c);
  const blocked = c.conflict_users > 0;
  return (
    <View style={styles.card}>
      {c.reported ? (
        <Text style={styles.reported}>A user confirmed these are the same product</Text>
      ) : (
        <Text style={styles.similar}>Names look {Math.round(c.sim * 100)}% alike</Text>
      )}

      <ProductBlock c={c} side="a" suggested={suggested === 'a'} />
      <View style={styles.divider} />
      <ProductBlock c={c} side="b" suggested={suggested === 'b'} />

      {blocked ? (
        <Text style={styles.warn}>
          The same person ranked both versions, so this can&apos;t be merged until one of their posts
          is deleted.
        </Text>
      ) : null}

      <View style={styles.actions}>
        <PrimaryButton
          label={`Keep "${short(c.item_a)}"`}
          disabled={busy || blocked}
          onPress={() => onKeep('a')}
        />
        <PrimaryButton
          label={`Keep "${short(c.item_b)}"`}
          variant="secondary"
          disabled={busy || blocked}
          onPress={() => onKeep('b')}
        />
        <PrimaryButton label="Not the same" variant="ghost" disabled={busy} onPress={onDismiss} />
      </View>
      {busy ? <ActivityIndicator color={BaggedColors.dark} style={styles.spinner} /> : null}
    </View>
  );
}

function short(name: string): string {
  const n = formatProductDisplayName(name);
  return n.length > 34 ? `${n.slice(0, 33)}…` : n;
}

function ProductBlock({
  c,
  side,
  suggested,
}: {
  c: DuplicateCandidate;
  side: DuplicateSide;
  suggested: boolean;
}) {
  const item = side === 'a' ? c.item_a : c.item_b;
  const brand = side === 'a' ? c.brand_a : c.brand_b;
  const raters = side === 'a' ? c.raters_a : c.raters_b;
  const users = side === 'a' ? c.users_a : c.users_b;
  const barcodes = side === 'a' ? c.barcodes_a : c.barcodes_b;
  const verified = side === 'a' ? c.verified_a : c.verified_b;
  const isNew = side === 'a' ? c.virtual_a : c.virtual_b;
  const isScanned = c.reported && c.scanned_key === (side === 'a' ? c.key_a : c.key_b);
  return (
    <View style={styles.block}>
      <View style={styles.blockTop}>
        <Text style={styles.name}>{formatProductDisplayName(item)}</Text>
        {suggested ? <Text style={styles.suggested}>Suggested</Text> : null}
      </View>
      {brand ? <Text style={styles.brand}>{brand}</Text> : null}
      <Text style={styles.meta}>
        {isNew
          ? 'Not in the catalog yet'
          : `Ranked ${raters} time${raters === 1 ? '' : 's'} by ${users} ${users === 1 ? 'person' : 'people'}`}
        {verified ? '  ·  Nutrition verified' : ''}
      </Text>
      {isScanned ? <Text style={styles.meta}>Name from the barcode scanner</Text> : null}
      {barcodes.length > 0 ? (
        <Text style={styles.meta}>Barcode {barcodes.join(', ')}</Text>
      ) : null}
    </View>
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  scrollContent: { padding: 16, gap: 14, flexGrow: 1 },
  error: { fontFamily: BaggedFonts.body, fontSize: 14, color: BaggedColors.scoreLow, textAlign: 'center' },
  emptyTitle: { fontFamily: BaggedFonts.display, fontSize: 18, color: BaggedColors.dark, marginBottom: 6 },
  emptyBody: { fontFamily: BaggedFonts.body, fontSize: 14, color: BaggedColors.muted, textAlign: 'center' },
  card: {
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  reported: { fontFamily: BaggedFonts.body, fontSize: 12, fontWeight: '700', color: BaggedColors.accent },
  similar: { fontFamily: BaggedFonts.body, fontSize: 12, color: BaggedColors.muted },
  block: { gap: 2 },
  blockTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontFamily: BaggedFonts.body, fontSize: 16, fontWeight: '700', color: BaggedColors.dark },
  suggested: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.accent,
    backgroundColor: BaggedColors.accentPale,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  brand: { fontFamily: BaggedFonts.body, fontSize: 13, color: BaggedColors.muted },
  meta: { fontFamily: BaggedFonts.body, fontSize: 12, color: BaggedColors.muted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: BaggedColors.borderSoft },
  warn: { fontFamily: BaggedFonts.body, fontSize: 12, color: BaggedColors.scoreLow },
  actions: { gap: 8, marginTop: 4 },
  spinner: { marginTop: 4 },
});
