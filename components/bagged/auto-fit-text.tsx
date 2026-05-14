import { Platform, Text, type TextProps } from 'react-native';

export type AutoFitTextProps = Omit<TextProps, 'adjustsFontSizeToFit' | 'minimumFontScale'> & {
  /** Smallest scale vs style `fontSize` when space is tight (iOS/Android). Default 0.5 */
  minimumFontScale?: number;
};

/**
 * Shrinks type to fit the available width/lines instead of ending with "…".
 * Uses native `adjustsFontSizeToFit` (not supported on web — text wraps/clips as usual).
 */
export function AutoFitText({
  minimumFontScale = 0.5,
  numberOfLines,
  ellipsizeMode,
  ...rest
}: AutoFitTextProps) {
  const native = Platform.OS !== 'web';
  const shrink = native && numberOfLines != null;

  return (
    <Text
      {...rest}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={shrink}
      minimumFontScale={shrink ? minimumFontScale : undefined}
      ellipsizeMode={shrink ? 'clip' : ellipsizeMode}
    />
  );
}
