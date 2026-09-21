export type Subcategory = {
  id: string;
  label: string;
  parentId: string;
};

export type ParentCategory = {
  id: string;
  label: string;
  subcategories: Subcategory[];
};

export const PARENT_CATEGORIES: ParentCategory[] = [
  {
    id: 'snacks',
    label: 'Snacks',
    subcategories: [
      { id: 'chips-crackers-popcorn', label: 'Chips, Crackers & Popcorn', parentId: 'snacks' },
      { id: 'cookies-sweet-snacks', label: 'Cookies & Sweet Snacks', parentId: 'snacks' },
      { id: 'candy-chocolate', label: 'Candy & Chocolate', parentId: 'snacks' },
      {
        id: 'bars-protein-granola-energy',
        label: 'Bars (Protein, Granola, Energy)',
        parentId: 'snacks',
      },
      {
        id: 'jerky-nuts-trail-mix-dried-fruit',
        label: 'Jerky, Nuts, Trail Mix & Dried Fruit',
        parentId: 'snacks',
      },
      { id: 'premade-foods', label: 'Premade Foods', parentId: 'snacks' },
    ],
  },
  {
    id: 'beverages',
    label: 'Beverages',
    subcategories: [
      {
        id: 'sodas-soft-drinks-sparkling-water',
        label: 'Sodas, Soft Drinks & Sparkling Water',
        parentId: 'beverages',
      },
      { id: 'energy-drinks', label: 'Energy Drinks', parentId: 'beverages' },
      { id: 'juices-smoothies', label: 'Juices, Smoothies & Shakes', parentId: 'beverages' },
      { id: 'coffee-tea', label: 'Coffee & Tea', parentId: 'beverages' },
      { id: 'sports-drinks', label: 'Sports Drinks', parentId: 'beverages' },
      {
        id: 'kombucha-functional-drinks',
        label: 'Kombucha & Functional Drinks',
        parentId: 'beverages',
      },
    ],
  },
  {
    id: 'dairy',
    label: 'Dairy',
    subcategories: [
      { id: 'yogurt', label: 'Yogurt & Yogurt Drinks', parentId: 'dairy' },
      { id: 'cheese', label: 'Cheese', parentId: 'dairy' },
      { id: 'butter-cream', label: 'Butter & Cream', parentId: 'dairy' },
      { id: 'eggs', label: 'Eggs', parentId: 'dairy' },
      { id: 'milk-creamers', label: 'Milk & Creamers', parentId: 'dairy' },
    ],
  },
  {
    id: 'dairy-alternatives',
    label: 'Dairy Alternatives',
    subcategories: [
      { id: 'plant-based-milk', label: 'Plant-Based Milk', parentId: 'dairy-alternatives' },
      { id: 'plant-based-yogurt', label: 'Plant-Based Yogurt', parentId: 'dairy-alternatives' },
      { id: 'plant-based-cheese', label: 'Plant-Based Cheese', parentId: 'dairy-alternatives' },
      {
        id: 'plant-based-butter-spreads',
        label: 'Plant-Based Butter & Spreads',
        parentId: 'dairy-alternatives',
      },
    ],
  },
  {
    id: 'condiments-and-sauces',
    label: 'Sauces, Dressings & Dips',
    subcategories: [
      { id: 'condiments-sauces', label: 'Condiments & Sauces', parentId: 'condiments-and-sauces' },
      { id: 'salad-dressings', label: 'Salad Dressings', parentId: 'condiments-and-sauces' },
      { id: 'spreads-dips', label: 'Spreads & Dips', parentId: 'condiments-and-sauces' },
    ],
  },
  {
    id: 'frozen',
    label: 'Frozen',
    subcategories: [
      { id: 'frozen-meals-entrees', label: 'Frozen Meals & Entrees', parentId: 'frozen' },
      { id: 'frozen-snacks-appetizers', label: 'Frozen Snacks & Appetizers', parentId: 'frozen' },
      { id: 'frozen-breakfast', label: 'Frozen Breakfast', parentId: 'frozen' },
      { id: 'ice-cream-frozen-desserts', label: 'Ice Cream & Frozen Desserts', parentId: 'frozen' },
      { id: 'frozen-fruit-vegetables', label: 'Frozen Fruit & Vegetables', parentId: 'frozen' },
    ],
  },
  {
    id: 'meat-seafood',
    label: 'Meat, Seafood, & Alt',
    subcategories: [
      { id: 'fresh-meat-seafood', label: 'Meat & Seafood', parentId: 'meat-seafood' },
      { id: 'deli-meat-charcuterie', label: 'Deli Meat & Charcuterie', parentId: 'meat-seafood' },
      { id: 'plant-based-meat', label: 'Plant-Based Protein', parentId: 'meat-seafood' },
    ],
  },
  {
    id: 'produce',
    label: 'Produce',
    subcategories: [
      { id: 'fresh-fruit', label: 'Fruit', parentId: 'produce' },
      { id: 'fresh-vegetables', label: 'Vegetable', parentId: 'produce' },
      { id: 'herbs-fresh-aromatics', label: 'Herbs & Fresh Aromatics', parentId: 'produce' },
    ],
  },
  {
    id: 'protein-supplements',
    label: 'Protein & Supplements',
    subcategories: [
      { id: 'protein-powder', label: 'Protein Powder', parentId: 'protein-supplements' },
      {
        id: 'pre-workout-amino-acids',
        label: 'Pre-Workout & Amino Acids',
        parentId: 'protein-supplements',
      },
      { id: 'vitamins-supplements', label: 'Vitamins & Supplements', parentId: 'protein-supplements' },
    ],
  },
  {
    id: 'pantry',
    label: 'Pantry',
    subcategories: [
      { id: 'pasta-rice-grains', label: 'Pasta, Rice & Grains', parentId: 'pantry' },
      { id: 'breads-wraps', label: 'Breads & Wraps', parentId: 'pantry' },
      { id: 'cereal-oatmeal', label: 'Cereal & Oatmeal', parentId: 'pantry' },
      { id: 'canned-goods-soups', label: 'Canned Goods & Soups', parentId: 'pantry' },
      { id: 'oils-vinegars', label: 'Oils & Vinegars', parentId: 'pantry' },
      { id: 'baked-goods-baking-mixes', label: 'Baked Goods & Baking Mixes', parentId: 'pantry' },
    ],
  },
  {
    id: 'alcohol',
    label: 'Alcohol',
    subcategories: [
      { id: 'beer', label: 'Beer', parentId: 'alcohol' },
      { id: 'wine', label: 'Wine', parentId: 'alcohol' },
      { id: 'spirits-liquor', label: 'Spirits & Liquor', parentId: 'alcohol' },
      { id: 'hard-seltzer-rtd-cocktails', label: 'Hard Seltzer & RTD Cocktails', parentId: 'alcohol' },
      { id: 'non-alcoholic-low-abv', label: 'Non-Alcoholic & Low-ABV', parentId: 'alcohol' },
    ],
  },
  {
    id: 'spices-seasonings',
    label: 'Spices & Seasonings',
    subcategories: [
      {
        id: 'spices-dry-rubs-seasoning-blends-salts',
        label: 'Spices, Dry Rubs, Seasoning Blends & Salts',
        parentId: 'spices-seasonings',
      },
      { id: 'bouillon-broth', label: 'Bouillon & Broth', parentId: 'spices-seasonings' },
    ],
  },
];

export const SUBCATEGORIES: Subcategory[] = PARENT_CATEGORIES.flatMap((parent) => parent.subcategories);

const SUBCATEGORY_BY_ID = new Map<string, Subcategory>(
  SUBCATEGORIES.map((subcategory) => [subcategory.id, subcategory])
);

const PARENT_BY_ID = new Map<string, ParentCategory>(
  PARENT_CATEGORIES.map((parent) => [parent.id, parent])
);

const SUBCATEGORIES_BY_PARENT_ID = new Map<string, Subcategory[]>(
  PARENT_CATEGORIES.map((parent) => [parent.id, parent.subcategories])
);

/** Default subcategory when a legacy flat category name has no explicit mapping. */
const DEFAULT_SUBCATEGORY_ID = 'chips-crackers-popcorn';

/** Maps old flat Bagged category labels to the closest new subcategory id. */
const LEGACY_CATEGORY_TO_SUBCATEGORY: Record<string, string> = {
  Snacks: 'chips-crackers-popcorn',
  Beverages: 'sodas-soft-drinks-sparkling-water',
  Dairy: 'yogurt',
  'Dairy Alt': 'plant-based-milk',
  'Meat & Seafood': 'fresh-meat-seafood',
  Spices: 'spices-dry-rubs-seasoning-blends-salts',
  Condiments: 'condiments-sauces',
  Produce: 'fresh-fruit',
  Frozen: 'frozen-meals-entrees',
  Alcohol: 'beer',
  'Protein/Supplements': 'protein-powder',
  'Powders and supplements': 'protein-powder',
};

/** Normalize legacy `posts.category` labels before comparing to subcategory parent. */
const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  'Powders and supplements': 'Protein/Supplements',
};

export function canonicalLegacyCategory(value: string): string {
  const trimmed = String(value ?? '').trim();
  return LEGACY_CATEGORY_ALIASES[trimmed] ?? trimmed;
}

export function getSubcategory(subcategoryId: string): Subcategory | null {
  return SUBCATEGORY_BY_ID.get(String(subcategoryId ?? '').trim()) ?? null;
}

export function getParentCategory(subcategoryId: string): ParentCategory | null {
  const subcategory = getSubcategory(subcategoryId);
  if (!subcategory) return null;
  return PARENT_BY_ID.get(subcategory.parentId) ?? null;
}

export function getSubcategoriesForParent(parentId: string): Subcategory[] {
  return SUBCATEGORIES_BY_PARENT_ID.get(String(parentId ?? '').trim()) ?? [];
}

export function mapLegacyCategoryToSubcategory(legacyCategory: string): string {
  const trimmed = String(legacyCategory ?? '').trim();
  if (!trimmed) return DEFAULT_SUBCATEGORY_ID;

  const direct = SUBCATEGORY_BY_ID.get(trimmed);
  if (direct) return direct.id;

  const mapped = LEGACY_CATEGORY_TO_SUBCATEGORY[trimmed];
  if (mapped) return mapped;

  return DEFAULT_SUBCATEGORY_ID;
}

/** Legacy `posts.category` label for a subcategory id (DB back-compat). */
const PARENT_ID_TO_LEGACY_CATEGORY: Record<string, string> = {
  'dairy-alternatives': 'Dairy Alt',
  'condiments-and-sauces': 'Condiments',
  'protein-supplements': 'Protein/Supplements',
  'meat-seafood': 'Meat & Seafood',
  'spices-seasonings': 'Spices',
};

export function legacyCategoryForSubcategory(subcategoryId: string): string {
  const parent = getParentCategory(subcategoryId);
  if (!parent) return 'Snacks';
  return PARENT_ID_TO_LEGACY_CATEGORY[parent.id] ?? parent.label;
}

/** Resolve ranking/display subcategory — stored id or legacy category fallback. */
export function subcategoryForRow(row: {
  subcategory?: string | null;
  category?: string | null;
}): string {
  const stored = String(row.subcategory ?? '').trim();
  if (stored && SUBCATEGORY_BY_ID.has(stored)) return stored;
  return mapLegacyCategoryToSubcategory(String(row.category ?? '').trim());
}

export function getParentCategoryById(parentId: string): ParentCategory | null {
  return PARENT_BY_ID.get(String(parentId ?? '').trim()) ?? null;
}
