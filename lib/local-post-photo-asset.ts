export type LocalPostPhotoAsset = {
  uri: string;
  mimeType?: string | null;
  /** From `expo-image-picker` with `base64: true`. */
  base64?: string | null;
};
