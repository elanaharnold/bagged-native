import { StyleSheet, Text } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

function scoreTierColor(score: number): string {
  if (score >= 9) return BaggedColors.scoreHigh;
  if (score >= 7) return BaggedColors.scoreMid;
  return BaggedColors.scoreLow;
}

type ScoreBadgeProps = {
  /** Preferred — same numeric scale as the web. */
  score?: number;
  /** Back-compat with older call sites. */
  rating?: number;
  /**
   * Typography scale hint (maps to display font size). Formerly the ring diameter;
   * we no longer use a fixed circle so the score cannot clip.
   */
  size?: number;
};

/**
 * Compact score readout — display numeral + tier color, no enclosing circle (avoids
 * clipping values like 10.0 in tiny rings).
 */
export function ScoreBadge({ score, rating, size = 40 }: ScoreBadgeProps) {
  const value = Number(score ?? rating ?? 0);
  const safe = Number.isFinite(value) ? value : 0;
  const color = scoreTierColor(safe);
  /** Map legacy "badge size" to font size: 14→~18, 44→~28 */
  const fontSize = Math.min(32, Math.max(15, Math.round(12 + (size / 44) * 16)));

  return (
    <Text style={[styles.scoreText, { fontSize, color }]} allowFontScaling>
      {safe.toFixed(1)}
    </Text>
  );
}

const styles = StyleSheet.create({
  scoreText: {
    fontFamily: BaggedFonts.display,
  },
});
