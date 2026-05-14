/** Mirrors web `DIET_TAGS` in `bagged/src/App.jsx`. */
export const DIET_TAGS = [
  { id: 'high-protein-low-cal', label: 'High Protein / Low Cal', color: '#1A8C4E', bg: '#E6F7EE' },
  { id: 'keto', label: 'Keto', color: '#7B4FD4', bg: '#F0EAFF' },
  { id: 'vegan', label: 'Vegan', color: '#388E3C', bg: '#F1F8E9' },
  { id: 'vegetarian', label: 'Vegetarian', color: '#558B2F', bg: '#F1F8E9' },
  { id: 'gluten-free', label: 'Gluten-Free', color: '#F57C00', bg: '#FFF3E0' },
  { id: 'dairy-free', label: 'Dairy-Free', color: '#0288D1', bg: '#E1F5FE' },
  { id: 'paleo', label: 'Paleo', color: '#795548', bg: '#EFEBE9' },
] as const;

export const HIGH_PROTEIN_LOW_CAL_ID = 'high-protein-low-cal' as const;

/** ≤10 kcal per 1 g protein — mirrors web `qualifiesHighProteinLowCalFromMacros` in `bagged/src/App.jsx`. */
export function qualifiesHighProteinLowCalFromMacroForm(input: { cal: string; protein: string }): boolean {
  const cal = Number(String(input.cal ?? '').trim());
  const protein = Number(String(input.protein ?? '').trim());
  if (!Number.isFinite(cal) || !Number.isFinite(protein) || protein <= 0) return false;
  return cal / protein <= 10;
}
