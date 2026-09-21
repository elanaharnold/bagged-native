export const WANT_TO_TRY_SOURCES = ['feed', 'discover', 'search', 'profile', 'direct'] as const;

export type WantToTrySource = (typeof WANT_TO_TRY_SOURCES)[number];

export function normalizeWantToTrySource(raw: unknown): WantToTrySource {
  const s = String(raw ?? '').trim().toLowerCase();
  return (WANT_TO_TRY_SOURCES as readonly string[]).includes(s)
    ? (s as WantToTrySource)
    : 'direct';
}
