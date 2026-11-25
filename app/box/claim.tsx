import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/bagged/primary-button';
import { TextField } from '@/components/bagged/text-field';
import { BaggedColors, BaggedFonts, BaggedLayout } from '@/constants/bagged-theme';
import { claimBoxCode, parseBoxCode } from '@/lib/boxes';

/** Scan the QR code on a Bagged box (or type its code) to claim it. */
export default function ClaimBoxScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const handlingRef = useRef(false);

  const claim = useCallback(
    async (raw: string) => {
      if (handlingRef.current) return;
      handlingRef.current = true;
      setBusy(true);
      setMessage(null);
      const result = await claimBoxCode(raw);
      setBusy(false);
      if (result.ok) {
        if (Platform.OS === 'ios') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace('/box');
        return;
      }
      setMessage(result.message);
      // Let the camera try again after a beat, so one bad scan doesn't loop.
      setTimeout(() => {
        handlingRef.current = false;
      }, 1500);
    },
    [router]
  );

  const onScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (handlingRef.current) return;
      if (!parseBoxCode(result.data)) {
        setMessage("That code isn't a Bagged box. Look for the QR code on the box card.");
        return;
      }
      void claim(result.data);
    },
    [claim]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={BaggedColors.dark} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Add a box</Text>
          <Text style={styles.subtitle}>Scan the QR code on your Bagged box</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.cameraWrap}>
          {!permission ? (
            <ActivityIndicator color={BaggedColors.dark} />
          ) : permission.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={busy ? undefined : onScanned}
            />
          ) : (
            <View style={styles.permission}>
              <Text style={styles.permissionText}>Allow camera access to scan your box.</Text>
              <PrimaryButton label="Allow camera" onPress={() => void requestPermission()} />
            </View>
          )}
          {busy ? (
            <View style={styles.busyOverlay}>
              <ActivityIndicator color={BaggedColors.white} />
            </View>
          ) : null}
        </View>

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <Text style={styles.orLabel}>Or type the code</Text>
        <TextField
          value={typed}
          onChangeText={setTyped}
          placeholder="BAG-7K2Q9X"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <PrimaryButton
          label="Claim box"
          loading={busy}
          disabled={typed.trim().length < 6}
          onPress={() => void claim(typed)}
        />
      </KeyboardAvoidingView>
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
  body: { flex: 1, padding: BaggedLayout.screenPadding, gap: 12 },
  cameraWrap: {
    height: 280,
    borderRadius: BaggedLayout.cardRadius,
    overflow: 'hidden',
    backgroundColor: BaggedColors.accentPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permission: { alignItems: 'center', gap: 12, padding: 16 },
  permissionText: { fontFamily: BaggedFonts.body, fontSize: 14, color: BaggedColors.ink, textAlign: 'center' },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { fontFamily: BaggedFonts.body, fontSize: 14, color: BaggedColors.ink, textAlign: 'center' },
  orLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    marginTop: 8,
  },
});
