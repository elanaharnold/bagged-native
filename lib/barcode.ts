import {
  curatedRowToSearchProductRow,
  productDescriptionKey,
  rateMacroFormFromNumbers,
  rateMacroFormHasAny,
  rateMacroFormToPrefillParams,
  searchRowBrand,
  type SearchProductRow,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';

// ─── Barcode normalisation ────────────────────────────────────────────────────

export type ScannedBarcode = {
  /** Canonical GTIN-13 (zero padded). Used for storage and lookups. */
  gtin: string;
  /** Every spelling we may have stored: GTIN-13, 12-digit UPC-A, GTIN-14. */
  candidates: string[];
};

/** GS1 mod-10 check digit for a code body (everything except the check digit). */
function gs1CheckDigit(body: string): number {
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

function isValidGs1(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** Expand an 8-digit UPC-E code into its 12-digit UPC-A form (null when invalid). */
export function expandUpcE(upce: string): string | null {
  if (!/^\d{8}$/.test(upce)) return null;
  const numberSystem = upce[0];
  if (numberSystem !== '0' && numberSystem !== '1') return null;
  const d = upce.slice(1, 7);
  const check = upce[7];
  const last = d[5];
  let body: string;
  if (last === '0' || last === '1' || last === '2') {
    body = numberSystem + d.slice(0, 2) + last + '0000' + d.slice(2, 5);
  } else if (last === '3') {
    body = numberSystem + d.slice(0, 3) + '00000' + d.slice(3, 5);
  } else if (last === '4') {
    body = numberSystem + d.slice(0, 4) + '00000' + d[4];
  } else {
    body = numberSystem + d.slice(0, 5) + '0000' + last;
  }
  const upcA = body + check;
  return isValidGs1(upcA) ? upcA : null;
}

/**
 * Turn a raw camera read into a canonical barcode. Returns null for anything
 * that is not a valid retail barcode (misreads, QR payloads, case codes), so
 * the scanner can simply keep looking.
 */
export function normalizeScan(rawData: string, type?: string): ScannedBarcode | null {
  const digits = String(rawData ?? '').replace(/\D/g, '');
  let code = digits;
  if (type === 'upc_e' && digits.length === 8) {
    const expanded = expandUpcE(digits);
    if (!expanded) return null;
    code = expanded;
  }
  if (![8, 12, 13, 14].includes(code.length)) return null;
  if (!isValidGs1(code)) return null;
  if (code.length === 14) {
    if (code[0] !== '0') return null;
    code = code.slice(1);
  }
  const gtin = code.padStart(13, '0');
  const candidates = new Set<string>([gtin, gtin.padStart(14, '0'), digits]);
  if (gtin.startsWith('0')) candidates.add(gtin.slice(1));
  return { gtin, candidates: [...candidates] };
}

// ─── Lookup ───────────────────────────────────────────────────────────────────

export type BarcodeSource = 'catalog' | 'community' | 'open_food_facts';

export type BarcodeLookupResult =
  | { kind: 'match'; source: BarcodeSource; row: SearchProductRow }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

const OFF_USER_AGENT = 'Bagged/1.0 (https://bagged-app.com)';
const OFF_TIMEOUT_MS = 8000;

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function lookupCuratedByBarcode(candidates: string[]): Promise<SearchProductRow | null> {
  const list = candidates.join(',');
  const { data, error } = await supabase
    .from('curated_products')
    .select('*')
    .or(`barcode.in.(${list}),upc.in.(${list})`)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? curatedRowToSearchProductRow(row as Record<string, unknown>) : null;
}

async function lookupCommunityBarcode(candidates: string[]): Promise<SearchProductRow | null> {
  const { data, error } = await supabase
    .from('product_barcodes')
    .select('description_key, item, brand')
    .in('barcode', candidates)
    .limit(50);
  if (error) throw error;
  if (!data || data.length === 0) return null;

  const tally = new Map<string, { count: number; item: string; brand: string }>();
  for (const r of data as { description_key: string; item: string; brand: string | null }[]) {
    const prev = tally.get(r.description_key);
    if (prev) prev.count += 1;
    else tally.set(r.description_key, { count: 1, item: r.item, brand: r.brand ?? '' });
  }
  const [descriptionKey, best] = [...tally.entries()].sort((a, b) => b[1].count - a[1].count)[0];

  const { data: curated, error: curatedErr } = await supabase
    .from('curated_products')
    .select('*')
    .eq('description_key', descriptionKey)
    .limit(1);
  if (curatedErr) throw curatedErr;
  if (curated?.[0]) return curatedRowToSearchProductRow(curated[0] as Record<string, unknown>);

  return {
    description: best.item,
    descriptionKey,
    brandName: best.brand,
    brandOwner: best.brand,
    foodCategory: '',
  };
}

/** Open Food Facts lists brands in arbitrary order (often parent company first); prefer the one in the product name. */
function pickBrand(brands: string, name: string): string {
  const list = brands.split(',').map(cleanText).filter(Boolean);
  if (list.length === 0) return '';
  const lowerName = name.toLowerCase();
  return list.find((b) => lowerName.includes(b.toLowerCase())) ?? list[0];
}

/** Open Food Facts (ODbL). Returns null when the product is unknown; throws on network errors. */
async function lookupOpenFoodFacts(gtin: string): Promise<SearchProductRow | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${gtin}.json?fields=product_name,product_name_en,brands`,
      {
        headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Open Food Facts returned ${res.status}`);
    const json = (await res.json()) as {
      status?: number;
      product?: { product_name?: string; product_name_en?: string; brands?: string };
    };
    if (json.status !== 1 || !json.product) return null;
    const name = cleanText(json.product.product_name_en) || cleanText(json.product.product_name);
    if (!name) return null;
    const brand = pickBrand(String(json.product.brands ?? ''), name);
    return {
      description: name,
      descriptionKey: productDescriptionKey(name, brand),
      brandName: brand,
      brandOwner: brand,
      foodCategory: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Catalog first, then community-linked barcodes, then Open Food Facts. */
export async function lookupBarcode(scan: ScannedBarcode): Promise<BarcodeLookupResult> {
  let hadError = false;

  try {
    const row = await lookupCuratedByBarcode(scan.candidates);
    if (row) return { kind: 'match', source: 'catalog', row };
  } catch (err) {
    hadError = true;
    if (__DEV__) console.warn('barcode catalog lookup:', err);
  }

  try {
    const row = await lookupCommunityBarcode(scan.candidates);
    if (row) return { kind: 'match', source: 'community', row };
  } catch (err) {
    hadError = true;
    if (__DEV__) console.warn('barcode community lookup:', err);
  }

  try {
    const row = await lookupOpenFoodFacts(scan.gtin);
    if (row) return { kind: 'match', source: 'open_food_facts', row };
  } catch (err) {
    hadError = true;
    if (__DEV__) console.warn('barcode open food facts lookup:', err);
  }

  if (hadError) {
    return { kind: 'error', message: 'Could not look that up. Check your connection and try again.' };
  }
  return { kind: 'none' };
}

// ─── Linking + hand-off to the rate flow ──────────────────────────────────────

/**
 * Remember that this barcode is this product, so the next person who scans it
 * gets an instant match. Best-effort: never throws, duplicates are ignored.
 */
export async function linkBarcodeToProduct(args: {
  gtin: string;
  row: SearchProductRow;
}): Promise<boolean> {
  const item = cleanText(args.row.description).slice(0, 200);
  const brand = cleanText(searchRowBrand(args.row)).slice(0, 100);
  if (!item) return false;
  const descriptionKey =
    cleanText(args.row.descriptionKey) || productDescriptionKey(item, brand);
  if (!descriptionKey) return false;

  const { error } = await supabase.from('product_barcodes').insert({
    barcode: args.gtin,
    description_key: descriptionKey.slice(0, 300),
    item,
    brand,
  });
  if (error && error.code !== '23505') {
    if (__DEV__) console.warn('linkBarcodeToProduct:', error.message);
    return false;
  }
  return true;
}

/** Route params that open the rate flow already pointed at this product. */
export function rateParamsForSearchRow(
  row: SearchProductRow,
  intent: 'tried' | 'want'
): Record<string, string> {
  const params: Record<string, string> = {
    prefilledItem: row.description,
    prefilledBrand: searchRowBrand(row),
  };
  const category = cleanText(row.foodCategory);
  if (category) params.prefilledCategory = category;
  if (intent === 'want') params.prefilledIntent = 'want';

  const macros = rateMacroFormFromNumbers({
    cal: row.cal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    servingLabel: row.servingLabel,
  });
  if (rateMacroFormHasAny(macros)) Object.assign(params, rateMacroFormToPrefillParams(macros));
  return params;
}
