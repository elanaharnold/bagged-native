import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { MAX_REVIEW_PHOTOS } from '@/lib/review-photos';

type ReviewPhotoPickerProps = {
  photos: ImagePicker.ImagePickerAsset[];
  onPickLibrary: () => void;
  onTakePhoto: () => void;
  onRemovePhoto: (index: number) => void;
  canAddMore: boolean;
  maxPhotos?: number;
  existingCount?: number;
  /** Saved review photos (remote URLs) — shown with remove controls when re-editing. */
  existingPhotoUrls?: string[];
  onRemoveExistingPhoto?: (index: number) => void;
  hint?: string;
};

export function ReviewPhotoPicker({
  photos,
  onPickLibrary,
  onTakePhoto,
  onRemovePhoto,
  canAddMore,
  maxPhotos = MAX_REVIEW_PHOTOS,
  existingCount = 0,
  existingPhotoUrls = [],
  onRemoveExistingPhoto,
  hint,
}: ReviewPhotoPickerProps) {
  const savedCount = existingPhotoUrls.length || existingCount;
  const total = savedCount + photos.length;
  const defaultHint =
    hint ??
    (savedCount > 0
      ? `${savedCount} saved · add up to ${maxPhotos - savedCount} more (${total}/${maxPhotos} total)`
      : `Up to ${maxPhotos} images per review`);

  return (
    <View style={styles.wrap}>
      {existingPhotoUrls.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Saved on your review</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}>
            {existingPhotoUrls.map((url, idx) => (
              <View key={`${url}-${idx}`} style={styles.thumbWrap}>
                <Image source={{ uri: url }} style={styles.thumb} contentFit="cover" />
                {onRemoveExistingPhoto ? (
                  <Pressable
                    onPress={() => onRemoveExistingPhoto(idx)}
                    style={styles.remove}
                    hitSlop={6}>
                    <Ionicons name="close" size={16} color={BaggedColors.green} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}
      <Text style={[styles.hint, existingPhotoUrls.length > 0 && styles.hintAfterSaved]}>
        {defaultHint}
      </Text>
      {photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}>
          {photos.map((asset, idx) => (
            <View key={`${asset.uri}-${idx}`} style={styles.thumbWrap}>
              <Image source={{ uri: asset.uri }} style={styles.thumb} contentFit="cover" />
              <Pressable onPress={() => onRemovePhoto(idx)} style={styles.remove} hitSlop={6}>
                <Ionicons name="close" size={16} color={BaggedColors.green} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          onPress={onPickLibrary}
          disabled={!canAddMore}
          style={[styles.btn, !canAddMore && styles.btnDisabled]}>
          <Ionicons name="images-outline" size={20} color={BaggedColors.dark} />
          <Text style={styles.btnText}>Library</Text>
        </Pressable>
        {Platform.OS !== 'web' ? (
          <Pressable
            onPress={onTakePhoto}
            disabled={!canAddMore}
            style={[styles.btn, !canAddMore && styles.btnDisabled]}>
            <Ionicons name="camera-outline" size={20} color={BaggedColors.dark} />
            <Text style={styles.btnText}>Camera</Text>
          </Pressable>
        ) : null}
      </View>
      {!canAddMore && total >= maxPhotos ? (
        <Text style={styles.limitNote}>Photo limit reached for this review.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  hint: {
    color: BaggedColors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  hintAfterSaved: {
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
  },
  thumbWrap: {
    position: 'relative',
  },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: 12,
    backgroundColor: BaggedColors.borderSoft,
    borderWidth: 1,
    borderColor: BaggedColors.border,
  },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 4,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnText: {
    fontFamily: BaggedFonts.display,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  limitNote: {
    marginTop: 10,
    textAlign: 'center',
    color: BaggedColors.muted,
    fontSize: 13,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
});
