import type { LocalPostPhotoAsset } from './local-post-photo-asset';

export type { LocalPostPhotoAsset };

/**
 * Loads `post-photo-upload` only when photos are actually being uploaded.
 * Keeps that module out of the feed / like / comment startup graph in Expo Go.
 */
export async function uploadPostPhotoLocalAssets(
  userId: string,
  postId: string | number,
  assets: LocalPostPhotoAsset[]
): Promise<string[]> {
  if (!assets.length) return [];
  const { uploadPostPhotoLocalAssets: upload } = await import('./post-photo-upload');
  return upload(userId, postId, assets);
}
