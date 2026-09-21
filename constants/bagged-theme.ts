/**
 * Bagged design tokens — šolski časopis palette: punchy green, white, black ink.
 */

const POSTER_GREEN = '#097D3C';
const POSTER_GREEN_RGB = '9, 125, 60';
const SURFACE = '#FFFFFF';

export const BaggedColors = {
  /** Poster green — header, accents, welcome screen */
  blue: POSTER_GREEN,
  /** White — surfaces and wordmark on green */
  cream: SURFACE,
  black: '#000000',
  charcoal: '#000000',
  white: '#FFFFFF',
  /** Legacy alias — on-green text */
  green: '#FFFFFF',
  red: POSTER_GREEN,
  cherry: POSTER_GREEN,

  bg: SURFACE,
  content: SURFACE,
  card: SURFACE,
  ink: '#000000',
  dark: '#000000',
  muted: 'rgba(0, 0, 0, 0.55)',
  border: '#000000',
  borderSoft: 'rgba(0, 0, 0, 0.2)',
  borderStrong: '#000000',
  accent: POSTER_GREEN,
  accentPale: `rgba(${POSTER_GREEN_RGB}, 0.12)`,
  /** Selected green-tinted pills — noticeably darker than `accentPale`. */
  accentPaleActive: `rgba(${POSTER_GREEN_RGB}, 0.32)`,
  dietTag: POSTER_GREEN,
  dietTagBg: `rgba(${POSTER_GREEN_RGB}, 0.08)`,
  dietTagBgActive: `rgba(${POSTER_GREEN_RGB}, 0.32)`,
  scoreHigh: POSTER_GREEN,
  scoreMid: '#D9C566',
  scoreLow: '#C33C23',
  gold: '#D9C566',
  heart: POSTER_GREEN,
  shadow: 'rgba(0, 0, 0, 0.12)',
  onBg: POSTER_GREEN,
  onBgMuted: `rgba(${POSTER_GREEN_RGB}, 0.55)`,
  borderOnBg: '#000000',
} as const;

export const BaggedFonts = {
  /** Hand-drawn wordmark / display (Comico) */
  display: 'Comico-Regular',
  /** UI + product copy */
  body: 'System',
} as const;

export const BaggedLayout = {
  screenPadding: 16,
  cardRadius: 14,
  pillRadius: 999,
  shadowCard: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  } as const,
  rateFabListInset: 120,
} as const;
