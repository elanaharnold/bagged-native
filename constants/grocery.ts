/**
 * Same retailer list (and order) as the web app — `STORES[0]` is the primary
 * fallback used when computing want-to-try / ranking keys.
 */
export const STORES = [
  "Trader Joe's",
  'Whole Foods',
  'Publix',
  'Fresh Market',
  'Costco',
  'Target',
  'Walmart',
  'Kroger',
  'Aldi',
] as const;

export type Store = (typeof STORES)[number];

/**
 * Primary retailer string for the same composite key as want-to-try / rankings
 * (`rankKeyPair(item, store)`) when a row has no store set.
 */
export function primaryGroceryStoreForKey(row: {
  store?: string | null;
  stores?: string[] | null;
}): string {
  const arr = Array.isArray(row.stores) ? row.stores.filter(Boolean) : [];
  return arr[0] ?? row.store ?? STORES[0];
}
