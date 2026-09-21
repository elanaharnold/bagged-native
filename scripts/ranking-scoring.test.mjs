/**
 * Scoring scenario checks — run: npx tsx scripts/ranking-scoring.test.mjs
 */
import { canonicalRatingsFromRankedRows } from '../lib/ranking.ts';

function scoreVibes(vibes) {
  const rows = vibes.map((vibe, rank_position) => ({
    category: 'Snacks',
    subcategory: 'test-sub',
    vibe,
    rank_position,
  }));
  return canonicalRatingsFromRankedRows(rows)
    .sort((a, b) => a.rank_position - b.rank_position)
    .map((r) => r.rating);
}

function assertClose(actual, expected, label) {
  const ok = Math.abs(actual - expected) < 0.05;
  console.log(`${ok ? '✓' : '✗'} ${label}: ${actual} (expected ${expected})`);
  if (!ok) process.exitCode = 1;
}

function assertMin(actual, min, label) {
  const ok = actual >= min - 0.001;
  console.log(`${ok ? '✓' : '✗'} ${label}: ${actual} (min ${min})`);
  if (!ok) process.exitCode = 1;
}

function assertMax(actual, max, label) {
  const ok = actual <= max + 0.001;
  console.log(`${ok ? '✓' : '✗'} ${label}: ${actual} (max ${max})`);
  if (!ok) process.exitCode = 1;
}

console.log('--- Singletons ---');
assertClose(scoreVibes(['liked'])[0], 9.0, '1 liked singleton');
assertClose(scoreVibes(['fine'])[0], 6.0, '1 fine singleton');
assertClose(scoreVibes(['meh'])[0], 3.0, '1 meh singleton');

console.log('\n--- 3 liked (ranks 1/2/3) ---');
const threeLiked = scoreVibes(['liked', 'liked', 'liked']);
console.log('scores:', threeLiked);
assertClose(threeLiked[0], 10.0, '#1 liked');
assertClose(threeLiked[1], 7.3, '#2 liked at floor+boost');
assertClose(threeLiked[2], 7.0, '#3 liked at floor');

console.log('\n--- 3 items: fine / liked / liked ---');
const fineLikedLiked = scoreVibes(['fine', 'liked', 'liked']);
console.log('scores:', fineLikedLiked);
assertClose(fineLikedLiked[0], 7.5, '#1 fine at ceiling');
assertMax(fineLikedLiked[1], 7.5, '#2 liked ≤ 7.5');
assertMax(fineLikedLiked[2], 7.5, '#3 liked ≤ 7.5');
assertMin(fineLikedLiked[1], 6.0, '#2 liked conflict floor');
assertMin(fineLikedLiked[2], 6.0, '#3 liked conflict floor');

console.log('\n--- 5 items: meh / liked / liked / fine / liked ---');
const five = scoreVibes(['meh', 'liked', 'liked', 'fine', 'liked']);
console.log('scores:', five);
assertClose(five[0], 4.0, '#1 meh at ceiling');
assertMin(five[1], 6.0, '#2 liked ≥ 6.0');
assertMin(five[2], 6.0, '#3 liked ≥ 6.0');
assertMin(five[4], 6.0, '#5 liked ≥ 6.0');
assertMax(five[3], 7.5, '#4 fine ≤ 7.5');

console.log('\nDone.');
