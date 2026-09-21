#!/usr/bin/env node
/**
 * Remove broken `posts.photo_urls` entries (404, 0-byte, or missing storage objects).
 * Stops empty "Tap to retry" slots in the app after manual storage deletes.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API).
 *
 *   node scripts/strip-broken-post-photo-urls.mjs           # dry run
 *   node scripts/strip-broken-post-photo-urls.mjs --execute   # apply
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUCKET = 'post-photos';
const PUBLIC_MARKER = '/object/public/post-photos/';
const LIST_PAGE = 1000;
const POSTS_PAGE = 200;
const MIN_BYTES = 32;

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
    'Missing SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Get it from Supabase → Project Settings → API → service_role, then run:\n' +
      '  SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/strip-broken-post-photo-urls.mjs --execute'
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

function normalizePhotoUrls(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((u) => typeof u === 'string' && u.trim().length > 0);
  }
  return [];
}

/** @returns {Promise<Map<string, number>>} path → byte size */
async function listStoragePathSizes(prefix = '') {
  /** @type {Map<string, number>} */
  const sizes = new Map();
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
      if (item.id == null) {
        const nested = await listStoragePathSizes(itemPath);
        for (const [p, sz] of nested) sizes.set(p, sz);
      } else {
        const meta = item.metadata ?? {};
        const size =
          typeof meta.size === 'number'
            ? meta.size
            : typeof meta.contentLength === 'number'
              ? meta.contentLength
              : 0;
        sizes.set(itemPath, size);
      }
    }

    if (data.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }

  return sizes;
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return { keep: false, reason: `HTTP ${res.status}` };
    const cl = res.headers.get('content-length');
    const n = cl != null && cl !== '' ? Number(cl) : null;
    if (n != null && Number.isFinite(n) && n < MIN_BYTES) {
      return { keep: false, reason: `size ${n}` };
    }
    return { keep: true, reason: 'ok' };
  } catch (err) {
    return { keep: false, reason: String(err) };
  }
}

async function urlShouldKeep(url, storageSizes) {
  const path = storagePathFromPublicUrl(url);
  if (!path) {
    // Non–post-photos URL — verify it still loads
    const h = await headOk(url);
    return h.keep ? { keep: true } : { keep: false, reason: h.reason };
  }

  const listed = storageSizes.get(path);
  if (listed == null) {
    return { keep: false, reason: 'missing from storage (deleted)' };
  }
  if (listed < MIN_BYTES) {
    return { keep: false, reason: `storage size ${listed}` };
  }

  const h = await headOk(url);
  if (!h.keep) return { keep: false, reason: h.reason };
  return { keep: true };
}

async function main() {
  console.log(execute ? '=== EXECUTE ===' : '=== DRY RUN (add --execute to apply) ===');
  console.log('URL:', supabaseUrl);
  console.log('');

  console.log('Indexing storage objects in post-photos…');
  const storageSizes = await listStoragePathSizes();
  const validCount = [...storageSizes.values()].filter((s) => s >= MIN_BYTES).length;
  console.log(`  ${storageSizes.size} object(s) in bucket, ${validCount} with size >= ${MIN_BYTES}`);

  let page = 0;
  let scanned = 0;
  let postsUpdated = 0;
  let urlsStripped = 0;

  // posts.id is UUID — use offset/range pagination, not .gt('id', number).
  while (true) {
    const from = page * POSTS_PAGE;
    const to = from + POSTS_PAGE - 1;
    const { data, error } = await supabase
      .from('posts')
      .select('id, photo_urls')
      .not('photo_urls', 'eq', '{}')
      .order('id', { ascending: true })
      .range(from, to);

    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) break;

    page += 1;

    for (const row of rows) {
      const urls = normalizePhotoUrls(row.photo_urls);
      if (urls.length === 0) continue;

      scanned += 1;
      const kept = [];
      for (const url of urls) {
        const decision = await urlShouldKeep(url, storageSizes);
        if (decision.keep) {
          kept.push(url);
        } else {
          urlsStripped += 1;
          console.log(`  strip post ${row.id}: ${decision.reason}`);
          console.log(`    ${url.slice(0, 100)}${url.length > 100 ? '…' : ''}`);
        }
      }

      if (kept.length === urls.length) continue;

      if (execute) {
        const { error: upErr } = await supabase
          .from('posts')
          .update({ photo_urls: kept })
          .eq('id', row.id);
        if (upErr) {
          console.error(`  [error] post ${row.id}:`, upErr.message);
          continue;
        }
      }
      postsUpdated += 1;
      console.log(
        `  post ${row.id}: ${urls.length} → ${kept.length} url(s)${execute ? '' : ' (dry-run)'}`
      );
    }

    if (rows.length < POSTS_PAGE) break;
  }

  if (page === 0) {
    console.log('  No posts with photo_urls found.');
  }

  console.log('');
  console.log(`Posts with photos checked: ${scanned}`);
  console.log(`Posts ${execute ? 'updated' : 'to update'}: ${postsUpdated}`);
  console.log(`Broken URLs ${execute ? 'removed' : 'found'}: ${urlsStripped}`);

  if (!execute && (postsUpdated > 0 || urlsStripped > 0)) {
    console.log('\nRe-run with --execute to apply.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
