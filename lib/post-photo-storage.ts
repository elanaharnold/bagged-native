import { supabase } from './supabase';

/** Supabase Storage public bucket; URLs are stored on `posts.photo_urls` (same as web). */
export const POST_PHOTOS_BUCKET = 'post-photos';

const POST_PHOTOS_PUBLIC_MARKER = '/object/public/post-photos/';

/** Resolve storage object paths from public URLs (for delete / cleanup). */
export function storagePathsFromPostPhotoPublicUrls(urls: string[]): string[] {
  const paths: string[] = [];
  for (const raw of urls) {
    const u = String(raw ?? '');
    const i = u.indexOf(POST_PHOTOS_PUBLIC_MARKER);
    if (i === -1) continue;
    try {
      paths.push(decodeURIComponent(u.slice(i + POST_PHOTOS_PUBLIC_MARKER.length)));
    } catch {
      paths.push(u.slice(i + POST_PHOTOS_PUBLIC_MARKER.length));
    }
  }
  return paths;
}

/** Delete storage objects referenced by public post photo URLs. */
export async function removeStorageObjectsForPostPhotoUrls(urls: string[]): Promise<void> {
  const paths = storagePathsFromPostPhotoPublicUrls(urls);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(POST_PHOTOS_BUCKET).remove(paths);
  if (error) console.warn('removeStorageObjectsForPostPhotoUrls:', error.message);
}

export function publicUrlForPostPhotoStoragePath(
  supabaseUrl: string,
  objectPath: string
): string {
  const base = String(supabaseUrl ?? '').replace(/\/$/, '');
  const encoded = objectPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${base}/storage/v1/object/public/${POST_PHOTOS_BUCKET}/${encoded}`;
}
