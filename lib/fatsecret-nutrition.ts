/** Parsed macro numbers from a FatSecret serving (before form formatting). */
export type FatSecretMacroNumbers = {
  cal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  servingLabel: string | null;
};

type FatSecretServing = Record<string, unknown>;

/**
 * FatSecret returns `servings.serving` as either one object or an array of objects.
 * Prefer the default serving when flagged.
 */
export function pickFatSecretServing(servingsRoot: unknown): FatSecretServing {
  if (!servingsRoot || typeof servingsRoot !== 'object') return {};
  const raw = (servingsRoot as { serving?: unknown }).serving;
  const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  if (arr.length === 0) return {};

  const def = arr.find((s) => {
    if (!s || typeof s !== 'object') return false;
    const flag = (s as { is_default?: unknown }).is_default;
    return String(flag ?? '') === '1' || Number(flag) === 1;
  });

  return (def || arr[0]) as FatSecretServing;
}

/** Parse numeric nutrient values, stripping suffixes like `g`, `kcal`, `mg`. */
export function parseFatSecretNutrientValue(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const s = String(value).trim();
  if (!s) return null;

  const m = s.match(/^-?\d+(?:\.\d+)?/);
  if (!m) return null;

  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract calories / protein / carbs / fat from a FatSecret `food.get` JSON payload.
 */
export function parseFatSecretMacrosFromFoodPayload(payload: unknown): FatSecretMacroNumbers | null {
  if (!payload || typeof payload !== 'object') return null;

  const root = payload as { food?: unknown };
  const food = root.food;
  if (!food || typeof food !== 'object') return null;

  const servings = (food as { servings?: unknown }).servings;
  const serving = pickFatSecretServing(servings);
  if (!serving || typeof serving !== 'object') return null;

  const cal = parseFatSecretNutrientValue(serving.calories);
  const protein = parseFatSecretNutrientValue(serving.protein);
  const carbs = parseFatSecretNutrientValue(
    serving.carbohydrate ?? serving.carbs ?? serving.carbohydrates
  );
  const fat = parseFatSecretNutrientValue(serving.fat);
  const servingLabel = String(serving.serving_description ?? '').trim() || null;

  const hasAny = [cal, protein, carbs, fat].some((v) => v != null);
  if (!hasAny && !servingLabel) return null;

  return { cal, protein, carbs, fat, servingLabel };
}
