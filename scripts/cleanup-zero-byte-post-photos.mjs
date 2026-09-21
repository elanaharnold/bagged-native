#!/usr/bin/env node
/**
 * Remove 0-byte objects from the `post-photos` bucket and strip their URLs from `posts.photo_urls`.
 *
 * Requires service role (not the anon key):
 *   SUPABASE_URL=https://….supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=…
 *
 * Loads ../bagged/.env when present. Dry-run by default:
 *   node scripts/cleanup-zero-byte-post-photos.mjs
 *   node scripts/cleanup-zero-byte-post-photos.mjs --execute
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUCKET = 'post-photos';
const PUBLIC_MARKER = '/object/public/post-photos/';
const LIST_PAGE = 1000;
const REMOVE_BATCH = 100;
const POSTS_PAGE = 500;

const execute = process.argv.includes('--execute');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

loadEnvFile(join(__dirname, '..', '.env'));
loadEnvFile(join(__dirname, '..', '..', 'bagged', '.env'));

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://ovpyerctrapgtgqikguq.supabase.co';

const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error(
    'Missing SUPABASE_SERVICE_ROLE_KEY. Set it in the environment or in bagged/.env, then re-run.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function storagePathFromPublicUrl(url) {
  const u = String(url ?? '');
  const i = u.indexOf(PUBLIC_MARKER);
  if (i === -1) return null;
  try {
    return decodeURIComponent(u.slice(i + PUBLIC_MARKER.length));
  } catch {
    return u.slice(i + PUBLIC_MARKER.length);
  }
}

function publicUrlForPath(objectPath) {
  const encoded = objectPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${encoded}`;
}

/** @returns {Promise<Array<{ path: string, size: number | null }>>} */
async function listAllObjects(prefix = '') {
  /** @type {Array<{ path: string, size: number | null }>} */
  const out = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    if (!data?.length) break;

    for (const item of data) {
      const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
      // Folders have null id in Supabase Storage list API
      if (item.id == null) {
        const nested = await listAllObjects(itemPath);
        out.push(...nested);
      } else {
        const meta = item.metadata ?? {};
        const size =
          typeof meta.size === 'number'
            ? meta.size
            : typeof meta.contentLength === 'number'
              ? meta.contentLength
              : null;
        out.push({ path: itemPath, size });
      }
    }

    if (data.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }

  return out;
}

async function headContentLength(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return { ok: false, length: null, status: res.status };
    const cl = res.headers.get('content-length');
    const length = cl != null && cl !== '' ? Number(cl) : null;
    return {
      ok: true,
      length: Number.isFinite(length) ? length : null,
      status: res.status,
    };
  } catch (err) {
    return { ok: false, length: null, status: 0, error: String(err) };
  }
}

async function resolveZeroBytePaths(objects) {
  /** @type {string[]} */
  const zeroPaths = [];

  for (const { path, size } of objects) {
    if (size === 0) {
      zeroPaths.push(path);
      continue;
    }
    if (size != null && size > 0) continue;

    const url = publicUrlForPath(path);
    const head = await headContentLength(url);
    if (head.length === 0) {
      zeroPaths.push(path);
    } else if (head.length == null && !head.ok) {
      console.warn('[warn] could not HEAD object (not treating as zero)', {
        path,
        status: head.status,
      });
    }
  }

  return zeroPaths;
}

async function deleteStoragePaths(paths) {
  let removed = 0;
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH);
    const { data, error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw error;
    removed += (data ?? batch).length;
    console.log(`  removed storage batch ${i / REMOVE_BATCH + 1}: ${batch.length} object(s)`);
  }
  return removed;
}

function normalizePhotoUrls(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((u) => typeof u === 'string' && u.trim().length > 0);
  }
  return [];
}

async function cleanPostsPhotoUrls(deletedPathSet) {
  let offset = 0;
  let scanned = 0;
  let updated = 0;
  let urlsStripped = 0;

  while (true) {
    const { data, error } = await supabase
      .from('posts')
      .select('id, photo_urls')
      .not('photo_urls', 'eq', '{}')
      .range(offset, offset + POSTS_PAGE - 1);

    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const urls = normalizePhotoUrls(row.photo_urls);
      if (urls.length === 0) continue;

      const kept = [];
      for (const url of urls) {
        const path = storagePathFromPublicUrl(url);
        if (path && deletedPathSet.has(path)) {
          urlsStripped += 1;
          continue;
        }
        if (!path) {
          kept.push(url);
          continue;
        }
        const head = await headContentLength(url);
        if (head.length === 0) {
          urlsStripped += 1;
          if (path) deletedPathSet.add(path);
          continue;
        }
        if (!head.ok && (head.status === 404 || head.status === 400)) {
          urlsStripped += 1;
          continue;
        }
        kept.push(url);
      }

      if (kept.length === urls.length) continue;

      if (execute) {
        const { error: upErr } = await supabase
          .from('posts')
          .update({ photo_urls: kept })
          .eq('id', row.id);
        if (upErr) {
          console.error('[error] failed to update post', row.id, upErr.message);
          continue;
        }
      }
      updated += 1;
      console.log(
        `  post ${row.id}: ${urls.length} → ${kept.length} photo URL(s)${execute ? '' : ' (dry-run)'}`
      );
    }

    if (rows.length < POSTS_PAGE) break;
    offset += POSTS_PAGE;
  }

  return { scanned, updated, urlsStripped };
}

async function main() {
  console.log(execute ? '=== EXECUTE MODE ===' : '=== DRY RUN (pass --execute to apply) ===');
  console.log('Supabase URL:', supabaseUrl);
  console.log('Bucket:', BUCKET);
  console.log('');

  console.log('Listing storage objects…');
  const objects = await listAllObjects();
  console.log(`Found ${objects.length} file(s) in bucket.`);

  const zeroPaths = await resolveZeroBytePaths(objects);
  const uniqueZero = [...new Set(zeroPaths)];
  console.log(`Found ${uniqueZero.length} zero-byte object(s).`);
  if (uniqueZero.length > 0 && uniqueZero.length <= 20) {
    for (const p of uniqueZero) console.log('  ', p);
  } else if (uniqueZero.length > 20) {
    for (const p of uniqueZero.slice(0, 10)) console.log('  ', p);
    console.log(`  … and ${uniqueZero.length - 10} more`);
  }

  const deletedPathSet = new Set(uniqueZero);

  if (execute && uniqueZero.length > 0) {
    console.log('\nDeleting zero-byte storage objects…');
    const removed = await deleteStoragePaths(uniqueZero);
    console.log(`Deleted ${removed} object(s) from storage.`);
  } else if (!execute && uniqueZero.length > 0) {
    console.log('\nWould delete these objects from storage (re-run with --execute).');
  }

  console.log('\nScanning posts.photo_urls…');
  const postStats = await cleanPostsPhotoUrls(deletedPathSet);
  console.log(
    `Posts scanned: ${postStats.scanned}, posts ${execute ? 'updated' : 'that would update'}: ${postStats.updated}, URLs stripped: ${postStats.urlsStripped}`
  );

  if (!execute) {
    console.log('\nDry run complete. Re-run with --execute to apply changes.');
  } else {
    console.log('\nCleanup complete.');
  }
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
