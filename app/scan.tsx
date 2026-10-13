import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/bagged/primary-button';
import { SearchResultRow } from '@/components/bagged/search-result-row';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { subcategoryForRow } from '@/constants/categories';
import { useDebounce } from '@/hooks/use-debounce';
import {
  findSimilarRankedPost,
  linkBarcodeToProduct,
  lookupBarcode,
  normalizeScan,
  productDetailParamsForSearchRow,
  reportSameProduct,
  type BarcodeSource,
  type ScannedBarcode,
} from '@/lib/barcode';
import {
  productDescriptionKey,
  searchProducts,
  searchRowBrand,
  type RankedPostRow,
  type SearchProductRow,
} from '@/lib/data';
import { formatProductDisplayName } from '@/lib/format';
import { logEvent } from '@/lib/log-event';
import { useAuth } from '@/providers/auth-provider';

type Phase =
  | { name: 'scanning' }
  | { name: 'looking_up'; scan: ScannedBarcode }
  | {
      /** The scanned product looks like one the user already ranked: ask before assuming. */
      name: 'confirm_existing';
      scan: ScannedBarcode;
      source: BarcodeSource;
      row: SearchProductRow;
      /** Save the barcode → product link when the user moves on (Open Food Facts hits). */
      needsLink: boolean;
      existing: RankedPostRow;
    }
  | { name: 'not_found'; scan: ScannedBarcode }
  | { name: 'error'; scan: ScannedBarcode; message: string };

/** True when the scanned product and the user's ranked post share the same product key. */
function sameProductKey(row: SearchProductRow, post: RankedPostRow): boolean {
  const scannedKey = (
    String(row.descriptionKey ?? '').trim() ||
    productDescriptionKey(row.description, searchRowBrand(row))
  ).toLowerCase();
  const rankedKey = (
    String(post.description_key ?? '').trim() ||
    productDescriptionKey(post.item, post.product_brand)
  ).toLowerCase();
  return Boolean(scannedKey) && scannedKey === rankedKey;
}

export default function ScanScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ name: 'scanning' });
  const [torch, setTorch] = useState(false);
  const lockRef = useRef(false);
  const mountedRef = useRef(true);
  const openedLoggedRef = useRef(false);
  const permissionLoggedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (openedLoggedRef.current) return;
    openedLoggedRef.current = true;
    logEvent('scan_opened');
  }, []);

  useEffect(() => {
    if (!permission?.granted || permissionLoggedRef.current) return;
    permissionLoggedRef.current = true;
    logEvent('scan_permission', { status: 'granted' });
  }, [permission?.granted]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  const handleAllowCamera = useCallback(async () => {
    const result = await requestPermission();
    if (!result.granted) logEvent('scan_permission', { status: 'denied' });
  }, [requestPermission]);

  /** A scan always lands on the product page: reviews first, then Rank it / Want to try. */
  const openScannedProduct = useCallback(
    (args: { scan: ScannedBarcode; source: BarcodeSource; row: SearchProductRow; needsLink: boolean }) => {
      logEvent('scan_to_product', { source: args.source, product_opened_from: 'scan' });
      if (args.needsLink) void linkBarcodeToProduct({ gtin: args.scan.gtin, row: args.row });
      const params = productDetailParamsForSearchRow(args.row, 'scan');
      // Open Food Facts data needs credit wherever we show it.
      if (args.source === 'open_food_facts') params.infoSource = 'open_food_facts';
      router.replace({ pathname: '/product/detail', params });
    },
    [router]
  );

  const runLookup = useCallback(async (scan: ScannedBarcode) => {
    setPhase({ name: 'looking_up', scan });
    const result = await lookupBarcode(scan);
    if (!mountedRef.current) return;
    if (result.kind === 'match') {
      logEvent('scan_matched', { source: result.source });
      const needsLink = result.source === 'open_food_facts';
      // Before opening it, check whether the user already ranked this product
      // under a slightly different name (search results and barcode databases word things differently).
      const existing = userId ? await findSimilarRankedPost(userId, result.row) : null;
      if (!mountedRef.current) return;
      if (existing && sameProductKey(result.row, existing)) {
        // Exactly the product they ranked: no need to ask, its page shows their score.
        logEvent('scan_already_ranked_exact', { source: result.source });
        openScannedProduct({ scan, source: result.source, row: result.row, needsLink });
        return;
      }
      if (existing) {
        logEvent('scan_already_ranked_prompt', { source: result.source });
        setPhase({
          name: 'confirm_existing',
          scan,
          source: result.source,
          row: result.row,
          needsLink,
          existing,
        });
        return;
      }
      openScannedProduct({ scan, source: result.source, row: result.row, needsLink });
    } else if (result.kind === 'none') {
      logEvent('scan_not_found', { barcode: scan.gtin });
      setPhase({ name: 'not_found', scan });
    } else {
      logEvent('scan_lookup_error', { barcode: scan.gtin });
      setPhase({ name: 'error', scan, message: result.message });
    }
  }, [userId, openScannedProduct]);

  const onScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (lockRef.current) return;
      const scan = normalizeScan(result.data, result.type);
      if (!scan) return; // misread or not a retail barcode: keep looking
      lockRef.current = true;
      if (Platform.OS === 'ios') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      logEvent('scan_detected', { type: result.type });
      void runLookup(scan);
    },
    [runLookup]
  );

  const rescan = useCallback(() => {
    lockRef.current = false;
    setPhase({ name: 'scanning' });
  }, []);

  /**
   * "Yes, same product": the scanner's name is the one we keep on the barcode, the user's post is
   * left alone, and a report goes to the admin who merges the two names.
   */
  const confirmExisting = useCallback(() => {
    if (phase.name !== 'confirm_existing') return;
    logEvent('scan_already_ranked_confirmed', { source: phase.source });
    if (phase.needsLink) void linkBarcodeToProduct({ gtin: phase.scan.gtin, row: phase.row });
    void reportSameProduct({ gtin: phase.scan.gtin, scanned: phase.row, existing: phase.existing });
    const post = phase.existing;
    router.replace({
      pathname: '/product/detail',
      params: {
        item: post.item,
        brand: post.product_brand ?? '',
        category: post.category,
        subcategory: subcategoryForRow(post),
        store: post.store ?? '',
        descriptionKey:
          post.description_key ?? productDescriptionKey(post.item, post.product_brand),
      },
    });
  }, [phase, router]);

  /** "No, different product": open the scanned product's own page. */
  const rejectExisting = useCallback(() => {
    if (phase.name !== 'confirm_existing') return;
    logEvent('scan_already_ranked_rejected', { source: phase.source });
    openScannedProduct({
      scan: phase.scan,
      source: phase.source,
      row: phase.row,
      needsLink: phase.needsLink,
    });
  }, [phase, openScannedProduct]);

  const pickFromSearch = useCallback(
    (row: SearchProductRow) => {
      if (phase.name !== 'not_found') return;
      logEvent('scan_linked_product');
      // Link now (not on open) so the next scan of this barcode finds it.
      void linkBarcodeToProduct({ gtin: phase.scan.gtin, row });
      openScannedProduct({ scan: phase.scan, source: 'community', row, needsLink: false });
    },
    [phase, openScannedProduct]
  );

  const addManually = useCallback(() => {
    logEvent('scan_manual_add');
    router.replace('/rate');
  }, [router]);

  // ─── Permission gates ─────────────────────────────────────────────────────
  if (!permission) {
    return (
      <View style={styles.centeredDark}>
        <ActivityIndicator color={BaggedColors.white} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionScreen} edges={['top', 'bottom', 'left', 'right']}>
        <Pressable onPress={close} hitSlop={10} style={styles.closeBtnLight} accessibilityLabel="Close">
          <Ionicons name="close" size={24} color={BaggedColors.ink} />
        </Pressable>
        <View style={styles.permissionBody}>
          <Ionicons name="barcode-outline" size={56} color={BaggedColors.accent} />
          <Text style={styles.permissionTitle}>Scan a barcode</Text>
          <Text style={styles.permissionText}>
            Bagged uses your camera to read the barcode on a snack or grocery item so you can
            look it up in seconds. Nothing is recorded or saved.
          </Text>
          {permission.canAskAgain ? (
            <PrimaryButton label="Allow camera" onPress={() => void handleAllowCamera()} />
          ) : (
            <PrimaryButton label="Open Settings" onPress={() => void Linking.openSettings()} />
          )}
          <PrimaryButton
            label="Search instead"
            variant="ghost"
            onPress={() => router.replace('/rate')}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Not found / error: full-screen search so the next scan matches ───────
  if (phase.name === 'not_found' || phase.name === 'error') {
    return (
      <SafeAreaView style={styles.sheetScreen} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.sheetHeader}>
          <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={BaggedColors.ink} />
          </Pressable>
        </View>
        {phase.name === 'error' ? (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetTitle}>Something went wrong</Text>
            <Text style={styles.sheetText}>{phase.message}</Text>
            <PrimaryButton label="Try again" onPress={() => void runLookup(phase.scan)} />
            <PrimaryButton label="Scan another" variant="secondary" onPress={rescan} />
            <PrimaryButton label="Search instead" variant="ghost" onPress={addManually} />
          </View>
        ) : (
          <NotFoundSearch
            onPick={pickFromSearch}
            onRescan={rescan}
            onManual={addManually}
          />
        )}
      </SafeAreaView>
    );
  }

  // ─── Camera ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={phase.name === 'scanning' ? onScanned : undefined}
      />

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom', 'left', 'right']} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={close} hitSlop={10} style={styles.roundBtn} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={BaggedColors.white} />
          </Pressable>
          <Pressable
            onPress={() => setTorch((t) => !t)}
            hitSlop={10}
            style={styles.roundBtn}
            accessibilityLabel={torch ? 'Turn flashlight off' : 'Turn flashlight on'}>
            <Ionicons name={torch ? 'flash' : 'flash-outline'} size={20} color={BaggedColors.white} />
          </Pressable>
        </View>

        {phase.name !== 'confirm_existing' ? (
          <View style={styles.frameWrap} pointerEvents="none">
            <View style={styles.frame} />
            <Text style={styles.hint}>
              {phase.name === 'looking_up' ? 'Looking that up…' : 'Point at the barcode'}
            </Text>
            {phase.name === 'looking_up' ? (
              <ActivityIndicator color={BaggedColors.white} style={styles.spinner} />
            ) : null}
          </View>
        ) : null}

        {phase.name === 'confirm_existing' ? (
          <View style={styles.matchCard}>
            <Text style={styles.matchLabel}>Is this the same product?</Text>
            <Text style={styles.matchMeta}>You scanned</Text>
            <Text style={styles.matchName}>{formatProductDisplayName(phase.row.description)}</Text>
            {searchRowBrand(phase.row) ? (
              <Text style={styles.matchBrand}>{searchRowBrand(phase.row)}</Text>
            ) : null}
            <Text style={[styles.matchMeta, styles.existingGap]}>You already ranked</Text>
            <Text style={styles.matchName}>{formatProductDisplayName(phase.existing.item)}</Text>
            {String(phase.existing.product_brand ?? '').trim() ? (
              <Text style={styles.matchBrand}>{String(phase.existing.product_brand).trim()}</Text>
            ) : null}
            <View style={styles.matchActions}>
              <PrimaryButton label="Yes, same product" onPress={confirmExisting} />
              <PrimaryButton
                label="No, it's different"
                variant="secondary"
                onPress={rejectExisting}
              />
              <PrimaryButton label="Scan another" variant="ghost" onPress={rescan} />
            </View>
          </View>
        ) : null}

      </SafeAreaView>
    </View>
  );
}

function NotFoundSearch({
  onPick,
  onRescan,
  onManual,
}: {
  onPick: (row: SearchProductRow) => void;
  onRescan: () => void;
  onManual: () => void;
}) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 350);
  const [results, setResults] = useState<SearchProductRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchProducts(q)
      .then((rows) => {
        if (cancelled) return;
        setResults(rows);
        logEvent('search_performed', {
          query: q.toLowerCase().slice(0, 60),
          result_count: rows.length,
          context: 'scan',
        });
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <View style={styles.sheetBody}>
      <Text style={styles.sheetTitle}>We don&apos;t know this one yet</Text>
      <Text style={styles.sheetText}>
        Search for it once and the next scan will find it for everyone.
      </Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search for this product"
        placeholderTextColor={BaggedColors.muted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={styles.searchInput}
      />
      {loading ? <ActivityIndicator color={BaggedColors.ink} style={styles.searchSpinner} /> : null}
      <FlatList
        style={styles.resultsList}
        data={results}
        keyExtractor={(item, idx) => `${item.descriptionKey ?? item.description}-${item.fatSecretId ?? ''}-${idx}`}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <SearchResultRow row={item} onPress={onPick} />}
        ListFooterComponent={
          <View style={styles.footerActions}>
            <PrimaryButton label="Add it manually" variant="secondary" onPress={onManual} />
            <PrimaryButton label="Scan another" variant="ghost" onPress={onRescan} />
          </View>
        }
      />
    </View>
  );
}

const FRAME_W = 280;
const FRAME_H = 170;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameWrap: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  frame: {
    width: FRAME_W,
    height: FRAME_H,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: BaggedColors.white,
    backgroundColor: 'transparent',
  },
  hint: {
    marginTop: 16,
    fontFamily: BaggedFonts.display,
    fontSize: 16,
    color: BaggedColors.white,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  spinner: { marginTop: 12 },
  matchCard: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
    backgroundColor: BaggedColors.white,
    borderWidth: 1.5,
    borderColor: BaggedColors.ink,
  },
  matchLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  matchName: {
    marginTop: 6,
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.ink,
  },
  matchBrand: {
    marginTop: 2,
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.muted,
  },
  matchMeta: {
    marginTop: 6,
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
  },
  existingGap: {
    marginTop: 14,
  },
  matchActions: { marginTop: 16, gap: 8 },
  centeredDark: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionScreen: { flex: 1, backgroundColor: BaggedColors.white },
  closeBtnLight: { padding: 16, alignSelf: 'flex-start' },
  permissionBody: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 14 },
  permissionTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 26,
    color: BaggedColors.ink,
  },
  permissionText: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: BaggedColors.muted,
  },
  sheetScreen: { flex: 1, backgroundColor: BaggedColors.white },
  sheetHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  sheetBody: { flex: 1, paddingHorizontal: 16, gap: 10 },
  sheetTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 24,
    color: BaggedColors.ink,
  },
  sheetText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: BaggedColors.muted,
  },
  searchInput: {
    marginTop: 4,
    borderWidth: 1.5,
    borderColor: BaggedColors.ink,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: BaggedFonts.body,
    fontSize: 16,
    color: BaggedColors.ink,
  },
  searchSpinner: { marginVertical: 6 },
  resultsList: { flex: 1 },
  footerActions: { paddingVertical: 16, gap: 8 },
});
