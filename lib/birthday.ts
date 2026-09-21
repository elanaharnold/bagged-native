/** ISO date string YYYY-MM-DD for profile birthdays. */
export type BirthdayIso = `${number}-${string}-${string}`;

function isValidBirthdayParts(year: number, month: number, day: number): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dt > today) return false;
  const oldest = new Date();
  oldest.setFullYear(oldest.getFullYear() - 120);
  oldest.setHours(0, 0, 0, 0);
  if (dt < oldest) return false;
  return true;
}

export function normalizeBirthday(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map((n) => Number(n));
    return isValidBirthdayParts(y, m, d) ? s : null;
  }
  return parseBirthdayInput(s);
}

export function parseBirthdayInput(text: string): string | null {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;

  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3]);
    if (!isValidBirthdayParts(year, month, day)) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (!isValidBirthdayParts(year, month, day)) return null;
    return `${year}-${iso[2]}-${iso[3]}`;
  }

  return null;
}

/** Formats typed digits into MM/DD/YYYY as the user types. */
export function formatBirthdayDraftInput(text: string): string {
  const digits = String(text ?? '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function birthdayToDisplay(iso: string | null | undefined): string {
  const normalized = normalizeBirthday(iso);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-');
  return `${month}/${day}/${year}`;
}
