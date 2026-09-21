import { retailStoresForRow } from '@/constants/grocery';

/** Relative-time string for a post timestamp; mirrors the web `formatPostTime`. */
export function formatPostTime(createdAt: string | number | Date | null | undefined): string {
  if (!createdAt) return 'just now';
  const dt = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(dt.getTime())) return 'just now';
  const now = new Date();
  const diffMs = now.getTime() - dt.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'just now';
  if (diffMs < hour) {
    const mins = Math.max(1, Math.floor(diffMs / minute));
    return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  }
  if (diffMs < day) {
    const hours = Math.max(1, Math.floor(diffMs / hour));
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (diffMs < 2 * day) return 'yesterday';
  if (diffMs < 7 * day) return dt.toLocaleDateString(undefined, { weekday: 'long' });
  return dt.toLocaleDateString();
}

/** Title-case product labels for display only; keep raw strings for keys. */
export function formatProductDisplayName(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const segment = (seg: string) => {
    if (!seg) return '';
    const lower = seg.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  return s
    .split(/\s+/)
    .map((word) => word.split('-').map(segment).join('-'))
    .join(' ');
}

/** Retailers for a row — never includes product brand; uses shared grocery sanitization. */
export function storeListForRow(row: {
  stores?: string[] | null;
  store?: string | null;
  product_brand?: string | null;
}): string[] {
  return retailStoresForRow(row);
}
