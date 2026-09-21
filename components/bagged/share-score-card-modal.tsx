import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  SHARE_EXPORT_HEIGHT,
  SHARE_SCORE_CARD_WIDTH,
  shareableExportHeight,
  ShareScoreCardArt,
} from '@/components/bagged/share-score-card-art';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { getGlobalRankStatsForItem } from '@/lib/data';
import type { ShareableData } from '@/lib/share-score-card';
import { shareableHasNutritionContent, shareableHasPhoto } from '@/lib/share-score-card';
import { useAuth } from '@/providers/auth-provider';

type ShareScoreCardModalProps = {
  visible: boolean;
  data: ShareableData | null;
  onClose: () => void;
};

export function ShareScoreCardModal({ visible, data, onClose }: ShareScoreCardModalProps) {
  const { session } = useAuth();
  const captureRefView = useRef<ViewShot>(null);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [renderData, setRenderData] = useState<ShareableData | null>(null);
  const [photoReady, setPhotoReady] = useState(true);
  const [statsReady, setStatsReady] = useState(false);
  const [showNutritionTags, setShowNutritionTags] = useState(false);
  const [layoutHeight, setLayoutHeight] = useState(SHARE_EXPORT_HEIGHT);

  const imageHeaders = session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : undefined;

  useEffect(() => {
    if (!visible || !data) {
      setRenderData(null);
      setPhotoReady(true);
      setStatsReady(false);
      setShowNutritionTags(false);
      setLayoutHeight(SHARE_EXPORT_HEIGHT);
      return;
    }
    setRenderData(data);
    setShowNutritionTags(false);
    setPhotoReady(!shareableHasPhoto(data));
    setStatsReady(false);
    setLayoutHeight(
      shareableExportHeight(shareableHasPhoto(data), data.note?.trim() || null, false)
    );
    let cancelled = false;
    void getGlobalRankStatsForItem(data.item, data.descriptionKey ?? '', data.brand ?? '')
      .then((stats) => {
        if (cancelled) return;
        setRenderData((prev) => (prev ? { ...prev, communityAvg: stats.avg } : prev));
        setStatsReady(true);
      })
      .catch(() => {
        if (!cancelled) setStatsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, data]);

  const waitForCaptureReady = useCallback(async () => {
    const deadline = Date.now() + 2200;
    while (Date.now() < deadline) {
      if (photoReady && statsReady) return;
      await new Promise((r) => setTimeout(r, 80));
    }
  }, [photoReady, statsReady]);

  const capturePng = useCallback(async () => {
    if (!captureRefView.current) {
      throw new Error('Score card is not ready yet.');
    }
    await waitForCaptureReady();
    return captureRef(captureRefView, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
    });
  }, [waitForCaptureReady]);

  const handleSave = useCallback(async () => {
    if (!renderData || busy) return;
    setBusy('save');
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photos access needed',
          'Allow Bagged to save images so you can post your score card to Instagram.'
        );
        return;
      }
      const uri = await capturePng();
      await MediaLibrary.saveToLibraryAsync(uri);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Your shareable is in Photos — ready for Instagram.');
    } catch (err) {
      console.warn('save score card:', err);
      Alert.alert(
        'Could not save',
        err instanceof Error ? err.message : 'Try again in a moment.'
      );
    } finally {
      setBusy(null);
    }
  }, [busy, capturePng, renderData]);

  const handleShare = useCallback(async () => {
    if (!renderData || busy) return;
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
        dialogTitle: 'Share your Bagged shareable',
      });
    } catch (err) {
      console.warn('share score card:', err);
      Alert.alert(
        'Could not share',
        err instanceof Error ? err.message : 'Try again in a moment.'
      );
    } finally {
      setBusy(null);
    }
  }, [busy, capturePng, renderData]);

  const handleExportHeightChange = useCallback((height: number) => {
    setLayoutHeight((prev) => (height > prev ? height : prev));
  }, []);

  const nutritionVisible =
    renderData != null &&
    shareableHasNutritionContent(renderData) &&
    showNutritionTags;

  const estimatedHeight = useMemo(() => {
    if (!renderData) return SHARE_EXPORT_HEIGHT;
    return shareableExportHeight(
      shareableHasPhoto(renderData),
      renderData.note?.trim() || null,
      nutritionVisible
    );
  }, [renderData, nutritionVisible]);

  if (!renderData) return null;

  const canShowNutrition = shareableHasNutritionContent(renderData);
  const exportHeight = Math.max(estimatedHeight, layoutHeight);
  const previewWidth = Math.min(320, Dimensions.get('window').width - 72);
  const previewScale = previewWidth / SHARE_SCORE_CARD_WIDTH;
  const previewHeight = exportHeight * previewScale;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <Text style={styles.title}>Your shareable</Text>
          <Text style={styles.subtitle}>Save to Photos or share straight to Instagram.</Text>

          {canShowNutrition ? (
            <Pressable
              onPress={() => setShowNutritionTags((v) => !v)}
              style={({ pressed }) => [
                styles.nutritionToggle,
                showNutritionTags && styles.nutritionToggleOn,
                pressed && styles.pressed,
              ]}
              accessibilityRole="switch"
              accessibilityState={{ checked: showNutritionTags }}>
              <Text
                style={[styles.nutritionToggleText, showNutritionTags && styles.nutritionToggleTextOn]}
                allowFontScaling={false}>
                {showNutritionTags ? 'Macros & diet tags on' : 'Add macros & diet tags'}
              </Text>
            </Pressable>
          ) : null}

          <View style={[styles.previewClip, { width: previewWidth, height: previewHeight }]}>
            <View
              pointerEvents="none"
              style={{
                width: SHARE_SCORE_CARD_WIDTH,
                height: exportHeight,
                transform: [
                  { scale: previewScale },
                  {
                    translateX: -(SHARE_SCORE_CARD_WIDTH * (1 - previewScale)) / 2,
                  },
                  {
                    translateY: -(exportHeight * (1 - previewScale)) / 2,
                  },
                ],
              }}>
              <ShareScoreCardArt
                data={renderData}
                imageHeaders={imageHeaders}
                showNutritionTags={nutritionVisible}
                onExportHeightChange={handleExportHeightChange}
              />
            </View>
          </View>

          <View style={styles.hiddenCapture} pointerEvents="none">
            <ShareScoreCardArt
              ref={captureRefView}
              data={renderData}
              imageHeaders={imageHeaders}
              showNutritionTags={nutritionVisible}
              onPhotoReady={() => setPhotoReady(true)}
              onExportHeightChange={handleExportHeightChange}
            />
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
    marginBottom: 12,
    lineHeight: 19,
  },
  nutritionToggle: {
    alignSelf: 'stretch',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderStrong,
    backgroundColor: BaggedColors.cream,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 14,
    alignItems: 'center',
  },
  nutritionToggleOn: {
    borderColor: BaggedColors.accent,
    backgroundColor: BaggedColors.accentPaleActive,
  },
  nutritionToggleText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
  nutritionToggleTextOn: {
    color: BaggedColors.accent,
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
