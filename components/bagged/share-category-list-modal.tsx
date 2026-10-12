import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type ViewShot from 'react-native-view-shot';
import { captureRef } from 'react-native-view-shot';

import {
  CATEGORY_LIST_EXPORT_HEIGHT,
  ShareCategoryListArt,
} from '@/components/bagged/share-category-list-art';
import { SHARE_SCORE_CARD_WIDTH } from '@/components/bagged/share-score-card-art';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import type { CategoryListShareableData } from '@/lib/share-category-list';

type ShareCategoryListModalProps = {
  visible: boolean;
  data: CategoryListShareableData | null;
  onClose: () => void;
};

export function ShareCategoryListModal({ visible, data, onClose }: ShareCategoryListModalProps) {
  const captureRefView = useRef<ViewShot>(null);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);

  const capturePng = useCallback(async () => {
    if (!captureRefView.current) {
      throw new Error('Category list shareable is not ready yet.');
    }
    return captureRef(captureRefView, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!data || busy) return;
    setBusy('save');
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      if (status !== 'granted') {
        Alert.alert(
          'Photos access needed',
          'Allow Bagged to save images so you can post your shareable to Instagram.'
        );
        return;
      }
      const uri = await capturePng();
      await MediaLibrary.saveToLibraryAsync(uri);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Your shareable is in Photos — ready for Instagram.');
    } catch (err) {
      console.warn('save category list shareable:', err);
      Alert.alert(
        'Could not save',
        err instanceof Error ? err.message : 'Try again in a moment.'
      );
    } finally {
      setBusy(null);
    }
  }, [busy, capturePng, data]);

  const handleShare = useCallback(async () => {
    if (!data || busy) return;
    setBusy('share');
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Sharing unavailable', 'Save to Photos instead and share from there.');
        return;
      }
      const uri = await capturePng();
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: 'Share your Bagged top 10',
      });
    } catch (err) {
      console.warn('share category list shareable:', err);
      Alert.alert(
        'Could not share',
        err instanceof Error ? err.message : 'Try again in a moment.'
      );
    } finally {
      setBusy(null);
    }
  }, [busy, capturePng, data]);

  if (!data) return null;

  const previewWidth = Math.min(320, Dimensions.get('window').width - 72);
  const previewScale = previewWidth / SHARE_SCORE_CARD_WIDTH;
  const exportHeight = CATEGORY_LIST_EXPORT_HEIGHT;
  const previewHeight = exportHeight * previewScale;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <Text style={styles.title}>Category top 10</Text>
          <Text style={styles.subtitle}>Save to Photos or share straight to Instagram.</Text>

          <View style={[styles.previewClip, { width: previewWidth, height: previewHeight }]}>
            <View
              pointerEvents="none"
              style={{
                width: SHARE_SCORE_CARD_WIDTH,
                height: exportHeight,
                transform: [
                  { scale: previewScale },
                  { translateX: -(SHARE_SCORE_CARD_WIDTH * (1 - previewScale)) / 2 },
                  { translateY: -(exportHeight * (1 - previewScale)) / 2 },
                ],
              }}>
              <ShareCategoryListArt data={data} />
            </View>
          </View>

          <View style={styles.hiddenCapture} pointerEvents="none">
            <ShareCategoryListArt ref={captureRefView} data={data} />
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={handleSave}
              disabled={busy != null}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed, busy && styles.disabled]}>
              {busy === 'save' ? (
                <ActivityIndicator color={BaggedColors.cream} />
              ) : (
                <Text style={styles.primaryBtnText}>Save to Photos</Text>
              )}
            </Pressable>
            <Pressable
              onPress={handleShare}
              disabled={busy != null}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed, busy && styles.disabled]}>
              {busy === 'share' ? (
                <ActivityIndicator color={BaggedColors.dark} />
              ) : (
                <Text style={styles.secondaryBtnText}>Share…</Text>
              )}
            </Pressable>
          </View>

          <Pressable onPress={onClose} hitSlop={8} style={styles.dismissBtn}>
            <Text style={styles.dismissText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  sheet: {
    backgroundColor: BaggedColors.cream,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderStrong,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    color: BaggedColors.dark,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.muted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 19,
  },
  previewClip: {
    overflow: 'hidden',
    borderRadius: 16,
    marginBottom: 18,
    backgroundColor: BaggedColors.accent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderSoft,
  },
  hiddenCapture: {
    position: 'absolute',
    left: -9999,
    top: 0,
    opacity: 0,
  },
  actions: {
    alignSelf: 'stretch',
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: BaggedColors.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 16,
    fontWeight: '700',
    color: BaggedColors.cream,
  },
  secondaryBtn: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderStrong,
    minHeight: 48,
  },
  secondaryBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 16,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
  dismissBtn: {
    marginTop: 12,
    paddingVertical: 8,
  },
  dismissText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
});
