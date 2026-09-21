import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import type { LocalPostPhotoAsset } from '@/lib/local-post-photo-asset';

export const MAX_REVIEW_PHOTOS = 4;

export function reviewPhotosToUploadAssets(
  photos: ImagePicker.ImagePickerAsset[]
): LocalPostPhotoAsset[] {
  return photos.map((a, index) => {
    const uri = String(a.uri ?? '').trim();
    const base64 = a.base64 ?? null;
    const hasBase64 = Boolean(base64 && String(base64).trim().length > 0);
    if (!uri && !hasBase64) {
      console.warn('[review-photos] asset missing uri and base64', { index });
    } else if (!hasBase64) {
      console.warn('[review-photos] asset has no inline base64; upload will read from disk', {
        index,
        uriPreview: uri.slice(0, 80),
        mimeType: a.mimeType ?? null,
      });
    }
    return {
      uri,
      mimeType: a.mimeType ?? null,
      base64,
    };
  });
}

export function pickerAssetsWithUri(assets: ImagePicker.ImagePickerAsset[]) {
  const valid = assets.filter((a) => String(a.uri ?? '').trim().length > 0);
  if (valid.length < assets.length) {
    console.warn('[review-photos] dropped picker assets without uri', {
      dropped: assets.length - valid.length,
    });
  }
  return valid;
}

type UseReviewPhotoPickerOptions = {
  maxPhotos?: number;
  /** Photos already saved on the post — counts toward the limit. */
  existingCount?: number;
};

/** Pick / capture images for a review (rate flow or add-photos screen). */
export function useReviewPhotoPicker(options?: UseReviewPhotoPickerOptions) {
  const maxPhotos = options?.maxPhotos ?? MAX_REVIEW_PHOTOS;
  const existingCount = options?.existingCount ?? 0;
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);

  const totalCount = existingCount + photos.length;
  const canAddMore = totalCount < maxPhotos;
  const remaining = Math.max(0, maxPhotos - totalCount);

  const pickFromLibrary = useCallback(async () => {
    if (remaining <= 0) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        'Allow photo library access to attach images to your review.'
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled) return;
    const picked = pickerAssetsWithUri(result.assets);
    if (picked.length === 0) {
      Alert.alert('Could not use photo', 'No valid image file was returned. Try another photo.');
      return;
    }
    setPhotos((prev) => [...prev, ...picked].slice(0, maxPhotos - existingCount));
  }, [remaining, existingCount, maxPhotos]);

  const takePhoto = useCallback(async () => {
    if (remaining <= 0) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take a photo for your review.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85, base64: true });
    if (result.canceled) return;
    const picked = pickerAssetsWithUri(result.assets);
    if (picked.length === 0) {
      Alert.alert(
        'Could not use photo',
        'No valid image file was returned. Try taking another picture.'
      );
      return;
    }
    setPhotos((prev) => [...prev, ...picked].slice(0, maxPhotos - existingCount));
  }, [remaining, existingCount, maxPhotos]);

  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearPhotos = useCallback(() => setPhotos([]), []);

  return {
    photos,
    setPhotos,
    pickFromLibrary,
    takePhoto,
    removePhoto,
    clearPhotos,
    canAddMore,
    remaining,
    totalCount,
    maxPhotos,
  };
}
