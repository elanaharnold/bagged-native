import { supabase } from '@/lib/supabase';

/**
 * Admin-only duplicate review. Every call goes through a database function that checks the
 * signed-in email server-side, so a non-admin gets an error even if they reach this code.
 */

export type DuplicateSide = 'a' | 'b';

export type DuplicateCandidate = {
  key_a: string;
  key_b: string;
  item_a: string;
  brand_a: string;
  verified_a: boolean;
  /** True when this name only exists in a user report and has no catalog row yet. */
  virtual_a: boolean;
  item_b: string;
  brand_b: string;
  verified_b: boolean;
  virtual_b: boolean;
  raters_a: number;
  users_a: number;
  raters_b: number;
  users_b: number;
  barcodes_a: string[];
  barcodes_b: string[];
  /** A user scanned a barcode and confirmed it is the same product they already ranked. */
  reported: boolean;
  report_barcode: string | null;
  scanned_key: string | null;
  /** How many more words one name has than the other (0 = same words, different order or wording). */
  extras: number;
  /** Which name has the extra words. */
  extra_side: DuplicateSide | null;
  extra_words: string[];
  /** Users who ranked both versions (merging would give them two posts of one product). */
  conflict_users: number;
};

export async function fetchDuplicateCandidates(): Promise<DuplicateCandidate[]> {
  const { data, error } = await supabase.rpc('admin_duplicate_candidates');
  if (error) throw error;
  return Array.isArray(data) ? (data as DuplicateCandidate[]) : [];
}

/** Supabase errors are plain objects, not Error instances, so read the message off either. */
export function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = String((err as { message?: unknown }).message ?? '').trim();
    if (m) return m;
  }
  return 'Could not load duplicates.';
}

/** Both names have ratings, so merging them combines two community averages into one. */
export function isBothRated(c: DuplicateCandidate): boolean {
  return c.raters_a > 0 && c.raters_b > 0;
}

/** Which name to keep by default: the scanner's name, then the barcode-linked one, then the busier one. */
export function suggestedCanonicalSide(c: DuplicateCandidate): DuplicateSide {
  if (c.reported && c.scanned_key) {
    if (c.scanned_key === c.key_a) return 'a';
    if (c.scanned_key === c.key_b) return 'b';
  }
  const aHas = c.barcodes_a.length > 0;
  const bHas = c.barcodes_b.length > 0;
  if (aHas !== bHas) return aHas ? 'a' : 'b';
  if (c.raters_a !== c.raters_b) return c.raters_a > c.raters_b ? 'a' : 'b';
  return 'a';
}

export type MergeResult =
  | { ok: true; updatedPosts: number; canonicalName: string }
  | { ok: false; reason: 'same_user_conflict'; users: string[] }
  | { ok: false; reason: 'error'; message: string };

/** Keep `keepSide`'s name; everything under the other name is renamed to it. */
export async function mergeDuplicate(
  c: DuplicateCandidate,
  keepSide: DuplicateSide
): Promise<MergeResult> {
  const keep =
    keepSide === 'a'
      ? { key: c.key_a, item: c.item_a, brand: c.brand_a }
      : { key: c.key_b, item: c.item_b, brand: c.brand_b };
  const drop = keepSide === 'a' ? c.key_b : c.key_a;

  const { data, error } = await supabase.rpc('admin_merge_duplicate', {
    p_alias_key: drop,
    p_canonical_key: keep.key,
    p_canonical_name: keep.item,
    p_canonical_brand: keep.brand,
  });
  if (error) {
    const message = error.message ?? '';
    if (message.startsWith('same_user_conflict:')) {
      let users: string[] = [];
      try {
        const parsed = JSON.parse(message.slice('same_user_conflict:'.length));
        if (Array.isArray(parsed)) users = parsed.map((u) => String(u));
      } catch {
        users = [];
      }
      return { ok: false, reason: 'same_user_conflict', users };
    }
    return { ok: false, reason: 'error', message };
  }
  const res = data as { ok?: boolean; reason?: string; updated_posts?: number; canonical_name?: string } | null;
  if (res?.ok) {
    return { ok: true, updatedPosts: res.updated_posts ?? 0, canonicalName: res.canonical_name ?? keep.item };
  }
  return { ok: false, reason: 'error', message: res?.reason ?? 'The merge did not go through.' };
}

/** "Not the same product": hide this pair from the review list for good. */
export async function dismissDuplicate(c: DuplicateCandidate): Promise<boolean> {
  const { error } = await supabase.rpc('admin_dismiss_duplicate', {
    p_key_a: c.key_a,
    p_key_b: c.key_b,
  });
  return !error;
}

/**
 * Admin-only review of "suggest an edit" reports from `lib/data.ts`'s
 * `submitProductEditSuggestion`. RLS restricts reads/updates on
 * `product_edit_suggestions` to the admin email, same as `curated_products`.
 */

export type ProductEditSuggestion = {
  id: string;
  reporter_id: string;
  description_key: string;
  item: string;
  brand: string | null;
  barcode: string | null;
  suggestion_type: 'name' | 'brand' | 'nutrition' | 'category_store' | 'other';
  suggested_value: string;
  note: string | null;
  status: 'pending' | 'applied' | 'dismissed';
  created_at: string;
};

export async function fetchProductEditSuggestions(): Promise<ProductEditSuggestion[]> {
  const { data, error } = await supabase
    .from('product_edit_suggestions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? (data as ProductEditSuggestion[]) : [];
}

export async function resolveProductEditSuggestion(
  id: string,
  status: 'applied' | 'dismissed'
): Promise<boolean> {
  const { error } = await supabase
    .from('product_edit_suggestions')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}
