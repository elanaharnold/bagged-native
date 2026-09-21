import type { LocalPostPhotoAsset } from './local-post-photo-asset';
import { POST_PHOTOS_BUCKET, publicUrlForPostPhotoStoragePath } from './post-photo-storage';
import { supabase } from './supabase';

export { POST_PHOTOS_BUCKET } from './post-photo-storage';
export type { LocalPostPhotoAsset } from './local-post-photo-asset';

const MIN_IMAGE_BYTES = 32;
const MAX_UPLOAD_ATTEMPTS = 3;

function fileExtFromMime(mime: string | undefined): string {
  const m = String(mime ?? '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic') || m.includes('heif')) return 'heic';
  return 'jpg';
}

function resolveContentType(asset: LocalPostPhotoAsset): string {
  const mime = String(asset.mimeType ?? '').trim().toLowerCase();
  if (mime && mime.startsWith('image/')) return mime;
  const ext = fileExtFromMime(asset.mimeType ?? undefined);
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  return 'image/jpeg';
}

/** Strip optional `data:image/...;base64,` prefix and whitespace. */
function normalizeBase64Payload(raw: string): string {
  const t = String(raw ?? '').trim();
  const comma = t.indexOf(',');
  const payload = comma >= 0 && t.toLowerCase().startsWith('data:') ? t.slice(comma + 1) : t;
  return payload.replace(/\s/g, '');
}

/**
 * Decode base64 to ArrayBuffer (RN-safe). Do not use `fetch(data:...).blob()` —
 * that often yields 0-byte blobs in React Native.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const cleaned = normalizeBase64Payload(base64);
  if (!cleaned) {
    throw new Error('Base64 image data is empty.');
  }
  const atobFn = globalThis.atob;
  if (typeof atobFn !== 'function') {
    throw new Error('Cannot decode image: base64 decoder is unavailable.');
  }
  let binary: string;
  try {
    binary = atobFn(cleaned);
  } catch {
    throw new Error('Could not decode the selected image. Try another photo.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

type ImageBytes = {
  body: ArrayBuffer;
  contentType: string;
  byteLength: number;
  source: 'picker-base64' | 'picker-uri';
};

/** Read a local `file://` / `ph://` asset URI without expo-file-system (avoids Metro HMR issues). */
async function readLocalUriAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) {
    throw new Error(`Could not read the selected image (${res.status}).`);
  }
  const body = await res.arrayBuffer();
  if (!body || body.byteLength < MIN_IMAGE_BYTES) {
    throw new Error(
      `Image read returned no data (${body?.byteLength ?? 0} bytes). Try a different photo.`
    );
  }
  return body;
}

function pathParts(path: string): { dir: string; name: string } {
  const p = String(path ?? '').trim();
  const slash = p.lastIndexOf('/');
  if (slash < 0) return { dir: '', name: p };
  return { dir: p.slice(0, slash), name: p.slice(slash + 1) };
}

function coerceObjectSizeBytes(row: unknown): number | null {
  if (!row || typeof row !== 'object') return null;
  const obj = row as Record<string, unknown>;
  if (typeof obj.metadata === 'object' && obj.metadata) {
    const meta = obj.metadata as Record<string, unknown>;
    if (typeof meta.size === 'number' && Number.isFinite(meta.size)) return meta.size;
  }
  if (typeof obj.size === 'number' && Number.isFinite(obj.size)) return obj.size;
  return null;
}

/**
 * Verify the uploaded object exists in storage with a non-zero size.
 * Prevents silently keeping 0-byte objects if the RN transport flakes.
 */
async function verifyUploadedObjectHasBytes(
  path: string,
  expectedMinBytes: number
): Promise<{ ok: boolean; size: number | null }> {
  const { dir, name } = pathParts(path);
  const { data, error } = await supabase.storage.from(POST_PHOTOS_BUCKET).list(dir, {
    search: name,
    limit: 20,
  });
  if (error) {
    console.warn('[post-photo-upload] verify list failed', {
      path,
      message: error.message,
    });
    return { ok: false, size: null };
  }
  const row = (data ?? []).find((x) => String((x as { name?: unknown }).name ?? '') === name);
  const size = coerceObjectSizeBytes(row);
  if (size == null) return { ok: false, size: null };
  return { ok: size >= expectedMinBytes, size };
}

/**
 * Read image bytes from an expo-image-picker asset.
 * Prefers inline base64; falls back to `fetch(localUri)` (no expo-file-system).
 */
export async function readLocalPostPhotoBytes(asset: LocalPostPhotoAsset): Promise<ImageBytes> {
  const uri = String(asset.uri ?? '').trim();
  const contentType = resolveContentType(asset);

  const rawB64 = asset.base64 != null ? String(asset.base64).trim() : '';
  if (rawB64.length > 0) {
    const body = base64ToArrayBuffer(rawB64);
    const byteLength = body.byteLength;
    if (__DEV__) {
      console.log('[post-photo-upload] decoded picker base64', {
        uriPreview: uri.slice(0, 96),
        byteLength,
        contentType,
      });
    }
    return { body, contentType, byteLength, source: 'picker-base64' };
  }

  if (!uri) {
    throw new Error('Photo asset has no URI and no base64 data from the image picker.');
  }

  if (__DEV__) {
    console.log('[post-photo-upload] reading local uri', {
      uriPreview: uri.slice(0, 96),
      contentType,
    });
  }

  let body: ArrayBuffer;
  try {
    body = await readLocalUriAsArrayBuffer(uri);
  } catch (readErr) {
    const msg = readErr instanceof Error ? readErr.message : String(readErr);
    console.error('[post-photo-upload] fetch(uri) read failed', {
      uriPreview: uri.slice(0, 96),
      message: msg,
    });
    throw new Error(
      'Could not read the selected image from your device. Try picking the photo again, or take a new picture with the camera.'
    );
  }

  const byteLength = body.byteLength;
  if (__DEV__) {
    console.log('[post-photo-upload] read file via fetch(uri)', {
      uriPreview: uri.slice(0, 96),
      byteLength,
      contentType,
    });
  }
  return { body, contentType, byteLength, source: 'picker-uri' };
}

/**
 * Upload images from device (expo-image-picker) — returns public URLs in order.
 * Uses ArrayBuffer bodies (not Blob) so Supabase Storage receives real bytes on React Native.
 */
export async function uploadPostPhotoLocalAssets(
  userId: string,
  postId: string | number,
  assets: LocalPostPhotoAsset[]
): Promise<string[]> {
  const out: string[] = [];
  const uid = String(userId ?? '').trim();
  const pid = String(postId ?? '').trim();
  if (!uid || !pid) {
    console.warn('[post-photo-upload] skipped: missing userId or postId', { uid: !!uid, pid: !!pid });
    return out;
  }
  if (!assets.length) {
    console.warn('[post-photo-upload] skipped: no assets');
    return out;
  }

  if (__DEV__) {
    console.log('[post-photo-upload] starting', { uid, pid, count: assets.length });
  }

  let idx = 0;
  for (const asset of assets) {
    const uri = String(asset.uri ?? '').trim();
    if (!uri && !(asset.base64 != null && String(asset.base64).trim())) {
      console.warn('[post-photo-upload] skipping asset with no uri/base64', { index: idx });
      continue;
    }

    const ext = fileExtFromMime(asset.mimeType ?? undefined);
    const path = `${uid}/${pid}/${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 9)}.${ext}`;

    let imageBytes: ImageBytes;
    try {
      imageBytes = await readLocalPostPhotoBytes(asset);
    } catch (readErr) {
      console.error('[post-photo-upload] read failed', {
        index: idx,
        uriPreview: uri.slice(0, 96),
        hasBase64: Boolean(asset.base64 && String(asset.base64).trim()),
        error: readErr instanceof Error ? readErr.message : readErr,
      });
      throw readErr;
    }

    if (imageBytes.byteLength < MIN_IMAGE_BYTES) {
      const err = new Error(
        `Image is empty (${imageBytes.byteLength} bytes). Try a different photo.`
      );
      console.error('[post-photo-upload] rejected empty payload', {
        path,
        byteLength: imageBytes.byteLength,
        source: imageBytes.source,
      });
      throw err;
    }

    // RN transport stability: use typed array body + verify persisted object size.
    const uploadBody = new Uint8Array(imageBytes.body);
    let uploadedOk = false;
    let lastUploadErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      const { error } = await supabase.storage
        .from(POST_PHOTOS_BUCKET)
        .upload(path, uploadBody, {
          cacheControl: '3600',
          upsert: attempt > 1,
          contentType: imageBytes.contentType,
        });

      if (error) {
        lastUploadErr = error;
        console.error('[post-photo-upload] storage.upload failed', {
          path,
          contentType: imageBytes.contentType,
          byteLength: imageBytes.byteLength,
          source: imageBytes.source,
          attempt,
          message: error.message,
          name: error.name,
        });
        continue;
      }

      const verify = await verifyUploadedObjectHasBytes(path, MIN_IMAGE_BYTES);
      if (verify.ok) {
        uploadedOk = true;
        break;
      }

      lastUploadErr = new Error(
        `Uploaded object has invalid size (${verify.size ?? 'unknown'} bytes).`
      );
      console.error('[post-photo-upload] upload verification failed', {
        path,
        attempt,
        expectedMinBytes: MIN_IMAGE_BYTES,
        actualSize: verify.size,
      });
    }

    if (!uploadedOk) {
      // Best-effort cleanup: remove potentially broken object before surfacing error.
      try {
        await supabase.storage.from(POST_PHOTOS_BUCKET).remove([path]);
      } catch {
        // Ignore cleanup failures
      }
      throw lastUploadErr instanceof Error
        ? lastUploadErr
        : new Error('Could not upload image bytes reliably. Please try a different photo.');
    }

    const { data } = supabase.storage.from(POST_PHOTOS_BUCKET).getPublicUrl(path);
    if (data?.publicUrl) {
      if (__DEV__) {
        console.log('[post-photo-upload] upload ok', {
          path,
          byteLength: imageBytes.byteLength,
          contentType: imageBytes.contentType,
          publicUrl: data.publicUrl,
        });
      }
      out.push(data.publicUrl);
    } else {
      console.error('[post-photo-upload] upload succeeded but getPublicUrl returned nothing', {
        path,
      });
      throw new Error('Upload succeeded but could not resolve the public image URL.');
    }
    idx += 1;
  }

  if (__DEV__) {
    console.log('[post-photo-upload] finished', { uploaded: out.length, expected: assets.length });
  }
  return out;
}
