import { curatedRowToSearchProductRow, type SearchProductRow } from './data';
import { supabase } from './supabase';

/**
 * Bagged boxes: a user scans the code on a box, its items queue up to rank, and
 * progress counts any ranking of those products (box list, search or barcode)
 * made after they claimed it. Backed by `claim_box()` and `my_box_items()`.
 */

export type BoxItem = {
  descriptionKey: string;
  name: string;
  brand: string;
  ranked: boolean;
};

export type MyBox = {
  boxId: string;
  name: string;
  claimedAt: Date;
  deadline: Date;
  daysLeft: number;
  items: BoxItem[];
  rankedCount: number;
  total: number;
  isComplete: boolean;
};

type MyBoxItemRow = {
  box_id: string;
  box_name: string;
  claimed_at: string;
  deadline: string;
  description_key: string;
  item_name: string | null;
  brand: string | null;
  sort_order: number;
  ranked: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Codes look like BAG-7K2Q9X. Accepts a bare code, lowercase, no dash, or a URL that contains one. */
export function parseBoxCode(text: string): string | null {
  const m = String(text ?? '').toUpperCase().match(/BAG-?([A-Z0-9]{6})(?![A-Z0-9])/);
  return m ? `BAG-${m[1]}` : null;
}

export async function fetchMyBoxes(): Promise<MyBox[]> {
  const { data, error } = await supabase.rpc('my_box_items');
  if (error) {
    console.warn('fetchMyBoxes:', error.message);
    return [];
  }
  const byBox = new Map<string, MyBox>();
  for (const r of (data ?? []) as MyBoxItemRow[]) {
    let box = byBox.get(r.box_id);
    if (!box) {
      const deadline = new Date(r.deadline);
      box = {
        boxId: r.box_id,
        name: r.box_name,
        claimedAt: new Date(r.claimed_at),
        deadline,
        daysLeft: Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / DAY_MS)),
        items: [],
        rankedCount: 0,
        total: 0,
        isComplete: false,
      };
      byBox.set(r.box_id, box);
    }
    box.items.push({
      descriptionKey: r.description_key,
      name: r.item_name ?? r.description_key,
      brand: r.brand ?? '',
      ranked: r.ranked === true,
    });
  }
  const boxes = [...byBox.values()];
  for (const box of boxes) {
    box.total = box.items.length;
    box.rankedCount = box.items.filter((i) => i.ranked).length;
    box.isComplete = box.total > 0 && box.rankedCount === box.total;
  }
  return boxes;
}

/** Items from boxes the user hasn't finished, not yet ranked. Powers the + screen quick list. */
export function unrankedBoxItems(boxes: MyBox[]): BoxItem[] {
  const seen = new Set<string>();
  const out: BoxItem[] = [];
  for (const box of boxes) {
    if (box.isComplete) continue;
    for (const item of box.items) {
      const k = item.descriptionKey.toLowerCase();
      if (item.ranked || seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

const CLAIM_ERRORS: Record<string, string> = {
  not_signed_in: 'Sign in to claim your box.',
  code_not_found: "We couldn't find that code. Check it and try again.",
  code_already_claimed: 'Someone else already claimed this box.',
  box_inactive: "This box isn't active anymore.",
};

export async function claimBoxCode(
  raw: string
): Promise<{ ok: true; boxId: string } | { ok: false; message: string }> {
  const code = parseBoxCode(raw);
  if (!code) return { ok: false, message: 'Box codes look like BAG-7K2Q9X.' };
  const { data, error } = await supabase.rpc('claim_box', { p_code: code });
  if (error) {
    const key = Object.keys(CLAIM_ERRORS).find((k) => error.message.includes(k));
    return { ok: false, message: key ? CLAIM_ERRORS[key] : 'Something went wrong. Try again.' };
  }
  return { ok: true, boxId: String(data) };
}

/** Catalog rows for box items, in box order, so they open like a search result. */
export async function searchRowsForBoxItems(items: BoxItem[]): Promise<SearchProductRow[]> {
  if (items.length === 0) return [];
  const keys = items.map((i) => i.descriptionKey);
  const { data, error } = await supabase.from('curated_products').select('*').in('description_key', keys);
  if (error) {
    console.warn('searchRowsForBoxItems:', error.message);
    return [];
  }
  const byKey = new Map(
    (data ?? []).map((r) => [String((r as { description_key?: string }).description_key ?? '').toLowerCase(), r])
  );
  const rows: SearchProductRow[] = [];
  for (const item of items) {
    const r = byKey.get(item.descriptionKey.toLowerCase());
    if (r) rows.push(curatedRowToSearchProductRow(r as Record<string, unknown>));
  }
  return rows;
}
