import { StyleSheet, Text } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { clampBaggedScore } from '@/lib/ranking';

/** Color for a numeric score — red below 4, yellow 4–7, green above 7. */
export function scoreDisplayColor(score: number): string {
  const safe = clampBaggedScore(score);
  if (safe < 4) return BaggedColors.scoreLow;
  if (safe > 7) return BaggedColors.scoreHigh;
  return BaggedColors.scoreMid;
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
  const safe = clampBaggedScore(Number(score ?? rating ?? 0));
  const color = scoreDisplayColor(safe);
  /** Map legacy "badge size" to font size: 14→~18, 44→~28 */
  const fontSize = Math.min(32, Math.max(15, Math.round(12 + (size / 44) * 16)));

  return (
    <Text
      style={[styles.scoreText, { fontSize, color }]}
      numberOfLines={1}
      allowFontScaling={false}>
      {safe.toFixed(1)}
    </Text>
  );
}

const styles = StyleSheet.create({
  scoreText: {
    fontFamily: BaggedFonts.display,
    flexShrink: 0,
  },
});
