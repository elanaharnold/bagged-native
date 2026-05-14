/**
 * Bagged design tokens — deep poster red chrome (native), cream/white surfaces.
 */

export const BaggedColors = {
  /** Poster red — top tab chrome only */
  bg: '#D12229',
  /** Warm paper — fills that should stay “cream” on top of red */
  cream: '#FFF8F0',
  /** Main area below tab bar — soft white */
  content: '#FAFAFA',
  card: '#FFFFFF',
  ink: '#2D2D2D',
  /** Primary text / active fills — alias of ink for older screens */
  dark: '#2D2D2D',
  muted: '#6B6B6B',
  border: 'rgba(45, 45, 45, 0.12)',
  borderSoft: 'rgba(45, 45, 45, 0.08)',
  borderStrong: 'rgba(45, 45, 45, 0.22)',
  accent: '#E07A3A',
  accentPale: '#FFF4EC',
  /** Score ring / emphasis — high (≥9) */
  scoreHigh: '#4CAF50',
  /** Score ring — mid (≥7) */
  scoreMid: '#FFC107',
  /** Alias for mid score / highlights */
  gold: '#FFC107',
  /** Score ring — low */
  scoreLow: '#E07A3A',
  /** Success / toggle-on — aligned with score green */
  green: '#4CAF50',
  heart: '#C85A5A',
  red: '#C54B4B',
  shadow: 'rgba(45, 45, 45, 0.08)',
  white: '#FFFFFF',
  /** Label / icon on red (`bg`) */
  onBg: '#FFFFFF',
  onBgMuted: 'rgba(255,255,255,0.78)',
  borderOnBg: 'rgba(255,255,255,0.38)',
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
  /** Card shadow — subtle elevation matching web */
  shadowCard: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  } as const,
  /** Extra space above home indicator so lists clear the floating + RATE ITEM control */
  rateFabListInset: 72,
} as const;
