import { BaggedColors } from './bagged-theme';

/** Shared diet-tag styling — forest green with transparent fill. */
const DIET_TAG_STYLE = {
  color: BaggedColors.dietTag,
  bg: BaggedColors.dietTagBg,
  bgActive: BaggedColors.dietTagBgActive,
} as const;

/** Mirrors web `DIET_TAGS` in `bagged/src/App.jsx`. */
export const DIET_TAGS = [
  { id: 'high-protein-low-cal', label: 'High Protein / Low Cal', ...DIET_TAG_STYLE },
  { id: 'keto', label: 'Keto', ...DIET_TAG_STYLE },
  { id: 'vegan', label: 'Vegan', ...DIET_TAG_STYLE },
  { id: 'vegetarian', label: 'Vegetarian', ...DIET_TAG_STYLE },
  { id: 'gluten-free', label: 'Gluten-Free', ...DIET_TAG_STYLE },
  { id: 'dairy-free', label: 'Dairy-Free', ...DIET_TAG_STYLE },
  { id: 'nut-free', label: 'Nut Free', ...DIET_TAG_STYLE },
  { id: 'paleo', label: 'Paleo', ...DIET_TAG_STYLE },
  { id: 'kosher', label: 'Kosher', ...DIET_TAG_STYLE },
  { id: 'seed-oil-free', label: 'Seed Oil Free', ...DIET_TAG_STYLE },
  { id: 'glp-1-friendly', label: 'GLP-1 Friendly', ...DIET_TAG_STYLE },
] as const;

/** Diet tags shown during onboarding profile setup (excludes Kosher). */
export const ONBOARDING_PROFILE_DIET_TAGS = DIET_TAGS.filter((t) => t.id !== 'kosher');

export const NO_DIET_RESTRICTIONS_ID = 'no-restrictions' as const;

export const HIGH_PROTEIN_LOW_CAL_ID = 'high-protein-low-cal' as const;

const DIET_TAG_IDS = new Set<string>(DIET_TAGS.map((t) => t.id));

/** Valid diet-tag ids for profile self-labeling. */
export function normalizeProfileDietTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(
    raw
      .map((t) => String(t ?? '').trim())
      .filter((id) => DIET_TAG_IDS.has(id))
  )];
}

export type MacroRatioInput = { cal: string; protein: string };

/** Both calories and protein are filled with a positive protein value (ratio can be computed). */
export function rateMacroFormHasCalAndProtein(input: MacroRatioInput): boolean {
  const calRaw = String(input.cal ?? '').trim();
  const proteinRaw = String(input.protein ?? '').trim();
  if (!calRaw || !proteinRaw) return false;
  const cal = Number(calRaw);
  const protein = Number(proteinRaw);
  return Number.isFinite(cal) && Number.isFinite(protein) && protein > 0;
}

/** ≤10 kcal per 1 g protein — mirrors web `qualifiesHighProteinLowCalFromMacros` in `bagged/src/App.jsx`. */
export function qualifiesHighProteinLowCalFromMacroForm(input: MacroRatioInput): boolean {
  if (!rateMacroFormHasCalAndProtein(input)) return false;
  const cal = Number(String(input.cal).trim());
  const protein = Number(String(input.protein).trim());
  return cal / protein <= 10;
}

/** Nutrition has cal + protein filled but does not meet the high-protein / low-cal ratio. */
export function highProteinLowCalTagDisabled(input: MacroRatioInput): boolean {
  return rateMacroFormHasCalAndProtein(input) && !qualifiesHighProteinLowCalFromMacroForm(input);
}

/** Auto-applied when qualified — user cannot toggle off while ratio still qualifies. */
export function highProteinLowCalTagLockedOn(input: MacroRatioInput): boolean {
  return qualifiesHighProteinLowCalFromMacroForm(input);
}

export function isHighProteinLowCalTagToggleDisabled(
  input: MacroRatioInput,
  selected: boolean
): boolean {
  if (highProteinLowCalTagLockedOn(input)) return true;
  if (!selected && highProteinLowCalTagDisabled(input)) return true;
  return false;
}
