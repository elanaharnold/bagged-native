/**
 * Canonical grocery retailers — keep in sync with `bagged/src/data.js`.
 * Always alphabetical; use `STORES` everywhere stores are listed in UI.
 */
export const TRADER_JOES_STORE = "Trader Joe's";

export const STORES = [
  '7-Eleven',
  'Albertsons',
  'Aldi',
  "BJ's Wholesale",
  "Buc-ee's",
  'Co-op Canada',
  'Costco',
  'CVS',
  'Duane Reade',
  'Earth Fare',
  'Erewhon',
  'Farm Boy',
  'Food Basics',
  'Food Lion',
  'Fred Meyer',
  'Fresh Market',
  'FreshCo',
  'Giant',
  'GNC',
  'Grove Grocer',
  'H-E-B',
  'IGA Canada',
  'Kroger',
  'Lidl',
  'Loblaw',
  'Longos',
  'Maxi',
  'Meijer',
  'Metro',
  "Milam's",
  'Morton Williams',
  'Natural Grocers',
  'No Frills',
  'Nude',
  'Provigo',
  'Publix',
  'Real Canadian Superstore',
  'Safeway',
  'Safeway Canada',
  "Sam's Club",
  'Sobeys',
  'Sprouts',
  'Stop & Shop',
  "Stew Leonard's",
  'Target',
  'Thrive Market',
  TRADER_JOES_STORE,
  'Vitamin Shoppe',
  'Walgreens',
  'Walmart',
  'Wegmans',
  'Westside Market',
  'Whole Foods',
  'WinCo',
  'Winners/HomeSense',
] as const;

export type Store = (typeof STORES)[number];

const STORE_BY_NORM = new Map(
  STORES.map((s) => [normalizeStoreToken(s), s] as const)
);

/** Legacy / alternate retailer labels → canonical `STORES` entry. */
const STORE_ALIAS_BY_NORM = new Map<string, Store>([
  ['whole foods', 'Whole Foods'],
  ['whole foods market', 'Whole Foods'],
  ['trader joes', TRADER_JOES_STORE],
  ['safeway / albertsons', 'Safeway'],
  ['vons', 'Safeway'],
  ['giant food', 'Giant'],
  ['giant-lancaster', 'Giant'],
  ['giant stop & shop', 'Giant'],
  ['stop and shop', 'Stop & Shop'],
  ["stew leonard's", "Stew Leonard's"],
  ['stew leonards', "Stew Leonard's"],
  ['sprouts', 'Sprouts'],
  ['sprouts farmers market', 'Sprouts'],
  ['fred meyer', 'Fred Meyer'],
  ['natural grocers', 'Natural Grocers'],
  ['natural grocers by vitamin cottage', 'Natural Grocers'],
  ['winco', 'WinCo'],
  ['winco foods', 'WinCo'],
  ['food lion', 'Food Lion'],
  ['thrive market', 'Thrive Market'],
  ['gnc', 'GNC'],
  ['vitamin shoppe', 'Vitamin Shoppe'],
  ['the vitamin shoppe', 'Vitamin Shoppe'],
  ['the fresh market', 'Fresh Market'],
  ["sam's club", "Sam's Club"],
  ['sams club', "Sam's Club"],
  ["bj's wholesale", "BJ's Wholesale"],
  ['bjs wholesale', "BJ's Wholesale"],
  ["bj's", "BJ's Wholesale"],
  ["buc-ee's", "Buc-ee's"],
  ['bucees', "Buc-ee's"],
  ['earth fare', 'Earth Fare'],
  ['loblaws', 'Loblaw'],
  ["longo's", 'Longos'],
  ['winners/homesense', 'Winners/HomeSense'],
  ['homesense', 'Winners/HomeSense'],
  ['7 eleven', '7-Eleven'],
  ['7eleven', '7-Eleven'],
  ['cvs pharmacy', 'CVS'],
  ['cvs/pharmacy', 'CVS'],
  ['duane reade', 'Duane Reade'],
  ['walgreen', 'Walgreens'],
  ['wallgreens', 'Walgreens'],
  ['walgreens pharmacy', 'Walgreens'],
  ['real canadian superstore', 'Real Canadian Superstore'],
  ['superstore', 'Real Canadian Superstore'],
  ['no frills', 'No Frills'],
  ['food basics', 'Food Basics'],
  ['freshco', 'FreshCo'],
  ['iga', 'IGA Canada'],
  ['iga canada', 'IGA Canada'],
  ['maxi', 'Maxi'],
  ['provigo', 'Provigo'],
  ['farm boy', 'Farm Boy'],
  ['co-op', 'Co-op Canada'],
  ['co-op canada', 'Co-op Canada'],
  ['sobeys', 'Sobeys'],
  ['metro', 'Metro'],
  ['milams', "Milam's"],
  ['nude miami', 'Nude'],
  ['safeway canada', 'Safeway Canada'],
]);

export function normalizeStoreToken(s: string | null | undefined): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'");
}

/** True when `s` names the Trader Joe's retailer (not a product brand). */
export function isTraderJoesStoreToken(s: string | null | undefined): boolean {
  const k = normalizeStoreToken(s);
  return k === "trader joe's" || k === 'trader joes';
}

export function isJunkStoreToken(s: string | null | undefined): boolean {
  const lower = normalizeStoreToken(s);
  return !lower || lower === 'null' || lower === 'undefined' || lower === 'none' || lower === 'n/a';
}

/** Map a retailer string to the canonical label from `STORES` when recognized. */
export function canonicalGroceryStoreName(s: string | null | undefined): string {
  const raw = String(s ?? '').trim();
  if (!raw || isJunkStoreToken(raw)) return '';
  const norm = normalizeStoreToken(raw);
  return STORE_BY_NORM.get(norm) ?? STORE_ALIAS_BY_NORM.get(norm) ?? raw;
}

export function isKnownGroceryStore(s: string | null | undefined): boolean {
  const n = normalizeStoreToken(s);
  return n.length > 0 && (STORE_BY_NORM.has(n) || STORE_ALIAS_BY_NORM.has(n));
}

export function isTraderJoesBrandName(brandOwner: string | null | undefined): boolean {
  const k = normalizeStoreToken(brandOwner);
  return k === "trader joe's" || k === 'trader joes';
}

/** Junk / unknown brands entered during ranking — not a real product identity. */
const UNKNOWN_USER_BRAND_KEYS = new Set([
  'any',
  'generic',
  'misc',
  'n/a',
  'na',
  'none',
  'unknown',
  'unspecified',
  'various',
]);

export function isUnknownUserBrand(brand: string | null | undefined): boolean {
  const key = normalizeStoreToken(brand);
  if (!key) return true;
  return UNKNOWN_USER_BRAND_KEYS.has(key);
}

export type PlaceholderBrandContext = {
  /** When set, TJ brand without TJ markers in the product name is a legacy placeholder. */
  description?: string | null;
  /**
   * When false, a bare "Trader Joe's" brand counts as intentional (ranking / posts).
   * Catalog merge paths leave this unset so legacy placeholder TJ is still detected.
   */
  assumePlaceholder?: boolean;
};

function descriptionMarksLegitimateTraderJoesProduct(description: string | null | undefined): boolean {
  const desc = String(description ?? '').trim().toLowerCase();
  return desc.includes('trader joe') || desc.includes('tj');
}

/** True when brand is the legacy curated_products DB default, not an intentional product brand. */
export function isPlaceholderCatalogBrand(
  brand: string | null | undefined,
  context?: PlaceholderBrandContext
): boolean {
  if (!isTraderJoesBrandName(brand)) return false;
  if (context?.description !== undefined && context.description !== null) {
    return !descriptionMarksLegitimateTraderJoesProduct(context.description);
  }
  if (context?.assumePlaceholder === false) return false;
  // Brand-merge paths without a product name: bare "Trader Joe's" is the old catalog default.
  return true;
}

/** TJ private-label — sold only at Trader Joe's (not a legacy catalog placeholder). */
export function isLegitimateTraderJoesBrand(
  brand: string | null | undefined,
  context?: PlaceholderBrandContext
): boolean {
  return isTraderJoesBrandName(brand) && !isPlaceholderCatalogBrand(brand, context);
}

/**
 * Prefer a real product brand over the legacy TJ catalog placeholder.
 * Intentional TJ private-label brands (from ranking) are kept when appropriate.
 */
export function mergeProductBrand(
  incoming: string | null | undefined,
  existing: string | null | undefined
): string {
  const inc = String(incoming ?? '').trim();
  const ex = String(existing ?? '').trim();

  if (inc && !isPlaceholderCatalogBrand(inc) && !isUnknownUserBrand(inc)) return inc;

  if (inc && isTraderJoesBrandName(inc)) {
    if (!ex || isPlaceholderCatalogBrand(ex) || isUnknownUserBrand(ex)) return inc;
    if (!isTraderJoesBrandName(ex)) return ex;
  }

  if (ex && !isPlaceholderCatalogBrand(ex) && !isUnknownUserBrand(ex)) return ex;
  return inc && isTraderJoesBrandName(inc) ? inc : '';
}

/** Resolve the brand shown on a shared product profile. */
export function resolveDisplayProductBrand(
  curatedBrand: string | null | undefined,
  paramBrand: string | null | undefined,
  postBrands: (string | null | undefined)[]
): string {
  const candidates: string[] = [];
  for (const b of postBrands) {
    const t = String(b ?? '').trim();
    if (t) candidates.push(t);
  }
  const param = String(paramBrand ?? '').trim();
  if (param) candidates.push(param);
  const curated = String(curatedBrand ?? '').trim();
  if (curated) candidates.push(curated);

  const specific = candidates.find(
    (c) => !isPlaceholderCatalogBrand(c) && !isUnknownUserBrand(c)
  );
  if (specific) return specific;
  const nonPlaceholder = candidates.find((c) => !isPlaceholderCatalogBrand(c));
  if (nonPlaceholder) return nonPlaceholder;
  return candidates.find((c) => isTraderJoesBrandName(c)) ?? '';
}

/** True when a store token is the same label as the product brand (different fields). */
export function storeTokenEqualsBrand(
  store: string | null | undefined,
  brand: string | null | undefined
): boolean {
  const s = normalizeStoreToken(store);
  const b = normalizeStoreToken(brand);
  if (!s || !b) return false;
  return s === b;
}

/**
 * Retailer strings only — strips junk, brand duplicates, and bogus TJ defaults.
 * Never treat `product_brand` as a store.
 */
export function sanitizeStoreTokens(
  stores: string[] | null | undefined,
  brand: string | null | undefined
): string[] {
  const brandTrim = String(brand ?? '').trim();
  const tjBrandOk = isLegitimateTraderJoesBrand(brandTrim, { assumePlaceholder: false });
  const seen = new Set<string>();
  const out: string[] = [];

  // Only strip a store that mirrors the brand label when the brand isn't itself
  // a real retailer. Brands like Trader Joe's or Whole Foods (365) legitimately
  // double as the store, so we must keep those tokens — otherwise downstream
  // keys (rank / want-to-try) lose the store and stop matching the row that was
  // saved with the retailer name intact.
  const brandIsRetailer = isKnownGroceryStore(brandTrim);
  for (const raw of stores ?? []) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed || isJunkStoreToken(trimmed)) continue;
    if (!brandIsRetailer && storeTokenEqualsBrand(trimmed, brandTrim)) continue;
    // Drop Trader Joe's on non–TJ-private-label brands (legacy catalog default, not a user pick).
    if (isTraderJoesStoreToken(trimmed) && !tjBrandOk) continue;
    const canon = canonicalGroceryStoreName(trimmed);
    if (!canon) continue;
    const key = normalizeStoreToken(canon);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canon);
  }
  return out;
}

/**
 * User-selected retailers, with TJ-brand items locked to Trader Joe's only.
 * Other brands may include Trader Joe's when the user selects it.
 */
export function storesForBrandAndSelections(
  brandOwner: string,
  selectedStores: string[]
): string[] {
  if (isLegitimateTraderJoesBrand(brandOwner, { assumePlaceholder: false })) {
    return [TRADER_JOES_STORE];
  }
  return sanitizeStoreTokens(selectedStores, brandOwner);
}

/** Merge raw store tokens from DB rows / user picks, then sanitize for the brand. */
export function mergeStoresForBrand(
  brandOwner: string,
  ...groups: (string[] | null | undefined)[]
): string[] {
  const merged: string[] = [];
  for (const group of groups) {
    for (const raw of group ?? []) {
      const trimmed = String(raw ?? '').trim();
      if (trimmed) merged.push(trimmed);
    }
  }
  return storesForBrandAndSelections(brandOwner, merged);
}

/**
 * Display-safe retailers from row store fields. TJ private-label → Trader Joe's only.
 */
export function retailStoresForRow(row: {
  store?: string | null;
  stores?: string[] | null;
  product_brand?: string | null;
  description?: string | null;
}): string[] {
  const brand = String(row.product_brand ?? '').trim();
  const hasDescription = row.description !== undefined && row.description !== null;
  const placeholderCtx = hasDescription
    ? { description: row.description }
    : { assumePlaceholder: false as const };

  if (isLegitimateTraderJoesBrand(brand, placeholderCtx)) {
    return [TRADER_JOES_STORE];
  }

  const fromArr = Array.isArray(row.stores)
    ? row.stores.map((s) => String(s ?? '').trim()).filter(Boolean)
    : [];
  const explicit = String(row.store ?? '').trim();

  // Legacy DB default: TJ only in `store` with an empty `stores` array.
  if (fromArr.length === 0 && explicit && isTraderJoesStoreToken(explicit)) {
    return [];
  }

  const candidates =
    fromArr.length > 0
      ? [...fromArr, ...(explicit ? [explicit] : [])]
      : explicit
        ? [explicit]
        : [];
  const brandForSanitize =
    hasDescription && isPlaceholderCatalogBrand(brand, { description: row.description })
      ? ''
      : brand;
  return sanitizeStoreTokens(candidates, brandForSanitize);
}

/**
 * Remove bogus `Trader Joe's` retailer tokens for non–TJ-private-label products.
 * Legacy rows often have `stores: ["Trader Joe's"]` from old DB defaults even when
 * the brand is e.g. Legion and the user never picked a store.
 */
export function stripLegacyDefaultTraderJoesStores(
  stores: string[],
  brand: string,
  opts?: { description?: string | null }
): string[] {
  const ctx =
    opts?.description !== undefined && opts?.description !== null
      ? { description: opts.description }
      : { assumePlaceholder: false as const };
  if (isLegitimateTraderJoesBrand(brand, ctx)) return stores;
  return stores.filter((s) => !isTraderJoesStoreToken(s));
}

/** Retailers used for Discover / Explore store filters (sanitized, no legacy TJ). */
export function exploreRetailStoresForProduct(
  row: {
    store?: string | null;
    stores?: string[] | null;
    product_brand?: string | null;
    brand?: string | null;
    description?: string | null;
  },
  brandOverride?: string
): string[] {
  const brand = String(brandOverride ?? row.product_brand ?? row.brand ?? '').trim();
  const description = row.description;
  let list = retailStoresForRow({
    store: row.store,
    stores: row.stores,
    product_brand: brand,
    description,
  });
  list = stripLegacyDefaultTraderJoesStores(list, brand, { description });
  return list;
}

/**
 * Primary retailer string for rank / want-to-try keys when a row has no store set.
 */
export function primaryGroceryStoreForKey(row: {
  store?: string | null;
  stores?: string[] | null;
  product_brand?: string | null;
}): string {
  return retailStoresForRow(row)[0] ?? '';
}

/**
 * Display-safe store label (first retailer). Empty when unknown or bogus default.
 */
export function displayStoreForRow(row: {
  store?: string | null;
  stores?: string[] | null;
  product_brand?: string | null;
}): string {
  return retailStoresForRow(row)[0] ?? '';
}
