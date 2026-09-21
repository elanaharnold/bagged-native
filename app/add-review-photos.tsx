import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { PostPhotoStrip } from '@/components/bagged/post-photo-strip';
import { ReviewPhotoPicker } from '@/components/bagged/review-photo-picker';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  appendPostPhotoUrlsForUserPost,
  bumpPostFeedRecency,
  getPostPhotoUrlsForUserPost,
} from '@/lib/data';
import { uploadPostPhotoLocalAssets } from '@/lib/post-photo-upload-lazy';
import { pokeFeedRefresh } from '@/lib/feed-refresh-poke';
import { formatProductDisplayName } from '@/lib/format';
import {
  MAX_REVIEW_PHOTOS,
  reviewPhotosToUploadAssets,
  useReviewPhotoPicker,
} from '@/lib/review-photos';
import { useAuth } from '@/providers/auth-provider';

export default function AddReviewPhotosScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{
    postId?: string;
    item?: string;
    brand?: string;
  }>();

  const postId = String(params.postId ?? '').trim();
  const itemName = String(params.item ?? '').trim();
  const brand = String(params.brand ?? '').trim();

  const [existingUrls, setExistingUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const {
    photos: newPhotos,
    pickFromLibrary,
    takePhoto,
    removePhoto,
    canAddMore,
    remaining,
  } = useReviewPhotoPicker({
    existingCount: existingUrls.length,
  });

  const loadExisting = useCallback(async () => {
    if (!userId || !postId) {
      setExistingUrls([]);
      return;
    }
    const urls = await getPostPhotoUrlsForUserPost(userId, postId);
    setExistingUrls(urls);
  }, [userId, postId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadExisting()
      .catch((err) => {
        console.warn('[add-review-photos] load failed:', err);
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Could not load your review.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadExisting]);

  const handleSave = async () => {
    if (!userId) {
      Alert.alert('Sign in', 'Log in to add photos to your review.');
      return;
    }
    if (!postId) {
      setErrorMsg('Missing review — go back and try again.');
      return;
    }
    if (newPhotos.length === 0) {
      setErrorMsg('Pick at least one photo to add.');
      return;
    }
    if (existingUrls.length >= MAX_REVIEW_PHOTOS) {
      Alert.alert('Photo limit', `This review already has the maximum of ${MAX_REVIEW_PHOTOS} photos.`);
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      const uploadAssets = reviewPhotosToUploadAssets(newPhotos);
      if (__DEV__) {
        console.log('[add-review-photos] uploading', {
          postId,
          newCount: uploadAssets.length,
          existingCount: existingUrls.length,
        });
      }
      const uploaded = await uploadPostPhotoLocalAssets(userId, postId, uploadAssets);
      if (uploaded.length === 0) {
        throw new Error('No photos were uploaded.');
      }
      const merged = await appendPostPhotoUrlsForUserPost(userId, postId, uploaded);
      await bumpPostFeedRecency(userId, postId);
      pokeFeedRefresh(postId);
      if (__DEV__) {
        console.log('[add-review-photos] saved', { postId, totalUrls: merged.length });
      }
      router.back();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message?: unknown }).message)
            : 'Upload failed';
      console.error('[add-review-photos] save failed', { postId, message, error: err });
      setErrorMsg(message);
    } finally {
      setSaving(false);
    }
  };

  if (!postId) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header onClose={() => router.back()} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Invalid review link.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const atLimit = existingUrls.length >= MAX_REVIEW_PHOTOS;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header onClose={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Add photos</Text>
        {itemName ? (
          <AutoFitText style={styles.productName} numberOfLines={4}>
            {formatProductDisplayName(itemName)}
          </AutoFitText>
        ) : null}
        {brand ? (
          <AutoFitText style={styles.brand} numberOfLines={2}>
            {formatProductDisplayName(brand)}
          </AutoFitText>
        ) : null}
        <Text style={styles.sub}>
          Photos show on your review, the feed, and this product&apos;s page — no need to re-rank.
        </Text>

        {loading ? (
          <ActivityIndicator style={styles.spinner} color={BaggedColors.dark} />
        ) : (
          <>
            {existingUrls.length > 0 ? (
              <View style={styles.existingBlock}>
                <Text style={styles.sectionLabel}>Already on your review</Text>
                <PostPhotoStrip urls={existingUrls} maxHeight={160} expandable={false} />
              </View>
            ) : null}

            {atLimit ? (
              <Text style={styles.atLimit}>
                You already have {MAX_REVIEW_PHOTOS} photos on this review.
              </Text>
            ) : (
              <>
                <Text style={[styles.sectionLabel, { marginTop: existingUrls.length > 0 ? 20 : 0 }]}>
                  New photos
                </Text>
                <ReviewPhotoPicker
                  photos={newPhotos}
                  onPickLibrary={pickFromLibrary}
                  onTakePhoto={takePhoto}
                  onRemovePhoto={removePhoto}
                  canAddMore={canAddMore}
                  existingCount={existingUrls.length}
                  hint={
                    remaining > 0
                      ? `Add up to ${remaining} more (${existingUrls.length + newPhotos.length}/${MAX_REVIEW_PHOTOS} total)`
                      : undefined
                  }
                />
              </>
            )}
          </>
        )}

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={handleSave}
          disabled={saving || loading || atLimit || newPhotos.length === 0}
          style={[
            styles.saveBtn,
            (saving || loading || atLimit || newPhotos.length === 0) && styles.saveBtnDisabled,
          ]}>
          <Text style={styles.saveBtnText}>
            {saving ? 'Uploading…' : newPhotos.length > 0 ? `Save ${newPhotos.length} photo${newPhotos.length === 1 ? '' : 's'}` : 'Save photos'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
        <Ionicons name="close" size={26} color={BaggedColors.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BaggedColors.content,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  closeBtn: {
    alignSelf: 'flex-start',
    padding: 4,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  heading: {
    fontFamily: BaggedFonts.display,
    fontSize: 28,
    fontWeight: '700',
    color: BaggedColors.dark,
    marginBottom: 12,
  },
  productName: {
    fontFamily: BaggedFonts.display,
    fontSize: 22,
    fontWeight: '700',
    color: BaggedColors.ink,
    textAlign: 'center',
    marginBottom: 6,
  },
  brand: {
    fontSize: 15,
    color: BaggedColors.muted,
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  sub: {
    fontSize: 15,
    lineHeight: 22,
    color: BaggedColors.muted,
    marginBottom: 20,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  existingBlock: {
    marginBottom: 8,
  },
  atLimit: {
    fontSize: 15,
    color: BaggedColors.muted,
    lineHeight: 22,
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  spinner: {
    marginVertical: 32,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    marginTop: 16,
    color: BaggedColors.heart,
    fontSize: 14,
    textAlign: 'center',
    fontFamily: BaggedFonts.body === 'System' ? undefined : BaggedFonts.body,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BaggedColors.border,
    backgroundColor: BaggedColors.card,
  },
  saveBtn: {
    backgroundColor: BaggedColors.dark,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    fontFamily: BaggedFonts.display,
    color: BaggedColors.green,
    fontWeight: '700',
    fontSize: 15,
  },
});
