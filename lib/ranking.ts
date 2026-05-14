/**
 * Direct port of the web app's pairwise ranking algorithm. Keeping the
 * constants, vibe-clamp passes, and binary-search advance step identical so
 * native and web give the same scores for the same input.
 */

export type Vibe = 'liked' | 'fine' | 'meh';

/** "Didn't like it" caps how high the number can go even if pairwise put it higher. */
export const MEH_RATING_CEILING = 4.7;
/** "I loved it" can't sink into terrible-looking scores just because it's lower in pairwise (within same category). */
export const LIKED_RATING_FLOOR = 8;
/** "It was fine" — middle band so last-in-category isn't 0 and first isn't a fake 10. */
export const FINE_RATING_FLOOR = 4.0;
export const FINE_RATING_CEILING = 7.7;
/** Minimum gap between adjacent ranks after vibe adjustments (keeps order vs scores monotonic). */
export const RATING_RANK_GAP = 0.08;

export const CATEGORIES = [
  'Snacks',
  'Dairy',
  'Dairy Alt',
  'Meat & Seafood',
  'Spices',
  'Condiments',
  'Produce',
  'Frozen',
  'Beverages',
  'Alcohol',
] as const;
export type Category = (typeof CATEGORIES)[number];

export function normalizeVibe(v: unknown): Vibe {
  if (v === 'liked' || v === 'fine' || v === 'meh') return v;
  return 'fine';
}

export type RankedRow<T = unknown> = T & {
  category: Category | string;
  vibe: Vibe;
  rating?: number;
};

/** Linear baseline: best→10.0, worst→0.0 (single item → 10.0). */
function computeScores<T extends { vibe: Vibe }>(list: T[]): (T & { rating: number })[] {
  const n = list.length;
  if (n === 0) return [];
  if (n === 1) return [{ ...list[0], rating: 10.0 }];
  return list.map((item, i) => ({
    ...item,
    rating: parseFloat((10 - (i / (n - 1)) * 10).toFixed(1)),
  }));
}

/**
 * Turn pairwise category order into display scores:
 * 1) Linear baseline (best→10, worst→0).
 * 2) Cap "meh" rows; clamp "fine" into the middle band.
 * 3) Lift "liked" rows toward LIKED_RATING_FLOOR; propagate gaps upward.
 * 4) Trim downward so each row is at least RATING_RANK_GAP below the row above.
 * 5) Re-clamp + reseat gaps a few times — passes converge.
 */
function applyVibeClampToScores<T extends { vibe: Vibe }>(list: T[]): (T & { rating: number })[] {
  const scored = computeScores(list);
  const n = scored.length;
  if (n === 0) return [];
  if (n === 1) {
    const row = scored[0];
    let x = Number(row.rating);
    const v = normalizeVibe(row.vibe);
    if (v === 'liked') x = Math.max(x, LIKED_RATING_FLOOR);
    if (v === 'meh') x = Math.min(x, MEH_RATING_CEILING);
    if (v === 'fine') x = Math.max(FINE_RATING_FLOOR, Math.min(FINE_RATING_CEILING, x));
    x = Math.max(0, Math.min(10, x));
    return [{ ...row, rating: parseFloat(x.toFixed(1)) }];
  }

  const x = scored.map((r) => Number(r.rating));

  for (let i = 0; i < n; i++) {
    if (normalizeVibe(scored[i].vibe) === 'meh') x[i] = Math.min(x[i], MEH_RATING_CEILING);
  }
  for (let i = 0; i < n; i++) {
    if (normalizeVibe(scored[i].vibe) === 'fine') {
      x[i] = Math.max(FINE_RATING_FLOOR, Math.min(FINE_RATING_CEILING, x[i]));
    }
  }
  for (let i = n - 2; i >= 0; i--) x[i] = Math.max(x[i], x[i + 1] + RATING_RANK_GAP);
  for (let i = 0; i < n; i++) {
    if (normalizeVibe(scored[i].vibe) === 'liked') x[i] = Math.max(x[i], LIKED_RATING_FLOOR);
  }
  for (let i = n - 2; i >= 0; i--) x[i] = Math.max(x[i], x[i + 1] + RATING_RANK_GAP);
  for (let i = 1; i < n; i++) x[i] = Math.min(x[i], x[i - 1] - RATING_RANK_GAP);

  for (let rep = 0; rep < 3; rep++) {
    for (let i = 0; i < n; i++) {
      if (normalizeVibe(scored[i].vibe) === 'fine') {
        x[i] = Math.max(FINE_RATING_FLOOR, Math.min(FINE_RATING_CEILING, x[i]));
      }
    }
    for (let i = n - 2; i >= 0; i--) x[i] = Math.max(x[i], x[i + 1] + RATING_RANK_GAP);
    for (let i = 0; i < n; i++) {
      if (normalizeVibe(scored[i].vibe) === 'liked') x[i] = Math.max(x[i], LIKED_RATING_FLOOR);
    }
    for (let i = n - 2; i >= 0; i--) x[i] = Math.max(x[i], x[i + 1] + RATING_RANK_GAP);
    for (let i = 1; i < n; i++) x[i] = Math.min(x[i], x[i - 1] - RATING_RANK_GAP);
    for (let i = 0; i < n; i++) {
      if (normalizeVibe(scored[i].vibe) === 'meh') x[i] = Math.min(x[i], MEH_RATING_CEILING);
    }
  }

  return scored.map((row, i) => {
    let v = Number(x[i]);
    if (!Number.isFinite(v)) v = 5;
    v = Math.max(0, Math.min(10, v));
    if (normalizeVibe(row.vibe) === 'meh') v = Math.min(v, MEH_RATING_CEILING);
    if (normalizeVibe(row.vibe) === 'fine') {
      v = Math.max(FINE_RATING_FLOOR, Math.min(FINE_RATING_CEILING, v));
    }
    return { ...row, rating: parseFloat(v.toFixed(1)) };
  });
}

/** Group by category, score each category independently, flatten back. */
export function computeScoresByCategory<T extends { category: string; vibe: Vibe }>(
  list: T[]
): (T & { rating: number })[] {
  const buckets = new Map<string, T[]>();
  for (const item of list) {
    const key = item.category;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }
  const out: (T & { rating: number })[] = [];
  for (const items of buckets.values()) {
    for (const scored of applyVibeClampToScores(items)) out.push(scored);
  }
  return out;
}

/** Insert a freshly ranked item at `insertIndex` within its category, preserving the rest of the list. */
export function insertIntoCategoryRanked<T extends { category: string }>(
  rankedList: T[],
  newItem: T,
  insertIndexInCategory: number
): T[] {
  const categoryItems = rankedList.filter((r) => r.category === newItem.category);
  const otherItems = rankedList.filter((r) => r.category !== newItem.category);
  const next = [
    ...categoryItems.slice(0, insertIndexInCategory),
    newItem,
    ...categoryItems.slice(insertIndexInCategory),
  ];
  return [...otherItems, ...next];
}

// ─── Binary-search comparison engine ──────────────────────────────────────────

export type CompareState = {
  lo: number;
  hi: number;
  mid: number;
  comparisons: number;
};

/** Initial state for a fresh insertion into a category list of length `n`. */
export function initialCompareState(n: number): CompareState {
  if (n === 0) return { lo: 0, hi: 0, mid: 0, comparisons: 0 };
  return { lo: 0, hi: n, mid: Math.floor(n / 2), comparisons: 0 };
}

export type CompareAdvance =
  | { kind: 'continue'; next: CompareState }
  | { kind: 'done'; insertIndex: number };

/** "I prefer the new item over the comparison item" — narrow toward the top. */
export function chooseBetter(state: CompareState, categoryLen: number): CompareAdvance {
  return advance(state, state.lo, state.mid, Math.floor((state.lo + state.mid) / 2), categoryLen);
}

/** "I prefer the comparison item" — narrow toward the bottom. */
export function chooseWorse(state: CompareState, categoryLen: number): CompareAdvance {
  return advance(
    state,
    state.mid + 1,
    state.hi,
    Math.floor((state.mid + 1 + state.hi) / 2),
    categoryLen
  );
}

/** Couldn't decide — insert directly after the comparison item. */
export function chooseTie(state: CompareState, categoryLen: number): CompareAdvance {
  return {
    kind: 'done',
    insertIndex: Math.min(state.mid + 1, categoryLen),
  };
}

function advance(
  prev: CompareState,
  newLo: number,
  newHi: number,
  newMid: number,
  categoryLen: number
): CompareAdvance {
  if (newLo >= newHi || newLo >= categoryLen) {
    return { kind: 'done', insertIndex: newLo };
  }
  return {
    kind: 'continue',
    next: { lo: newLo, hi: newHi, mid: newMid, comparisons: prev.comparisons + 1 },
  };
}

/** Estimate the number of comparisons remaining for the progress UI. */
export function estimateTotalComparisons(categoryLen: number): number {
  return Math.ceil(Math.log2(categoryLen + 1));
}

// ─── Category mapping (search-row category text → bagged category) ────────────

/** Maps a free-form category label (USDA / FatSecret / our curated tag) into a Bagged category. */
export function mapCategory(tag: string | null | undefined = ''): Category {
  const c = String(tag ?? '').toLowerCase();
  if (
    c.includes('beverage') ||
    c.includes('drink') ||
    c.includes('juice') ||
    c.includes('coffee') ||
    c.includes('tea')
  ) {
    return 'Beverages';
  }
  if (
    c.includes('ice cream') ||
    c.includes('frozen yogurt') ||
    c.includes('gelato') ||
    c.includes('sorbet') ||
    c.includes('sherbet') ||
    c.includes('frozen') ||
    c.includes('novelties') ||
    c.includes('novelty')
  ) {
    return 'Frozen';
  }
  if (
    c.includes('snack') ||
    c.includes('chip') ||
    c.includes('cracker') ||
    c.includes('cookie')
  ) {
    return 'Snacks';
  }
  if (c.includes('spice') || c.includes('seasoning') || c.includes('herb')) return 'Spices';
  if (
    c.includes('condiment') ||
    c.includes('sauce') ||
    c.includes('dressing') ||
    c.includes('spread') ||
    c.includes('jam') ||
    c.includes('broth') ||
    c.includes('stock')
  ) {
    return 'Condiments';
  }
  if (
    /\b(chicken|beef|pork|lamb|veal|bison|venison|turkey|steak|bacon|sausage|salami|pepperoni|prosciutto|meatball|jerky|ribs|brisket|kielbasa|bratwurst|hamburger|shawarma|gyro|kebab|salmon|tuna|cod|halibut|tilapia|trout|mackerel|sardine|anchovy|swordfish|catfish|pollock|haddock|flounder|grouper|snapper|shrimp|prawn|lobster|crab|scallop|clam|oyster|mussel|squid|octopus|caviar)\b/i.test(
      c
    ) ||
    /(hot dog|ground beef|pork chop|fish stick|fish fillet|fish fillets|corn dog|seafood|shellfish|sushi|sashimi|ceviche|rotisserie|spatchcock)/i.test(
      c
    )
  ) {
    return 'Meat & Seafood';
  }
  if (c.includes('produce') || c.includes('fruit') || c.includes('vegetable')) return 'Produce';
  if (c.includes('oat') || c.includes('plant') || c.includes('almond') || c.includes('soy milk')) {
    return 'Dairy Alt';
  }
  if (
    c.includes('wine') ||
    c.includes('beer') ||
    c.includes('spirit') ||
    c.includes('whiskey') ||
    c.includes('vodka') ||
    c.includes('rum') ||
    c.includes('gin') ||
    c.includes('tequila') ||
    c.includes('alcohol') ||
    c.includes('cider') ||
    c.includes('champagne') ||
    c.includes('seltzer') ||
    c.includes('lager') ||
    c.includes('ale')
  ) {
    return 'Alcohol';
  }
  if (
    c.includes('dairy') ||
    c.includes('milk') ||
    c.includes('cheese') ||
    c.includes('butter') ||
    c.includes('yogurt')
  ) {
    return 'Dairy';
  }
  return 'Snacks';
}
