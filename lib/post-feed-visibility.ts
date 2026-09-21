/** Rank slot for explicit want-to-try feed posts (`want-to-try-feed.ts`). */
export const WANT_TO_TRY_RADAR_RANK_POSITION = 2_000_000_000;

export const WANT_TO_TRY_RADAR_NOTE = 'On my radar — saving this for later.';

function hasTriedScore(rating: unknown): boolean {
  const n = Number(rating);
  return Number.isFinite(n) && n > 0;
}

function isRadarOnlyDbRow(row: { radar_only?: boolean | null; rating?: number | null }): boolean {
  return row.radar_only === true && !hasTriedScore(row.rating);
}

/** Radar post created only to hold photos / metadata — not a review or want-to-try share. */
export function isMetadataOnlyRadarPost(row: {
  radar_only?: boolean | null;
  rating?: number | null;
  rank_position?: number | null;
  note?: string | null;
}): boolean {
  if (!isRadarOnlyDbRow(row)) return false;
  const note = String(row.note ?? '').trim();
  if (note === WANT_TO_TRY_RADAR_NOTE) return false;
  const rp = Number(row.rank_position);
  if (Number.isFinite(rp) && rp >= WANT_TO_TRY_RADAR_RANK_POSITION) return false;
  return true;
}

/** True for real rankings (including converted radar → ranked). */
export function isRankedReviewPost(row: {
  radar_only?: boolean | null;
  rating?: number | null;
}): boolean {
  return !isRadarOnlyDbRow(row) || hasTriedScore(row.rating);
}

/** Posts that should appear in the home feed. */
export function isFeedVisiblePost(row: {
  radar_only?: boolean | null;
  rating?: number | null;
  rank_position?: number | null;
  note?: string | null;
}): boolean {
  return !isMetadataOnlyRadarPost(row);
}
