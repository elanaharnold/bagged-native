import { useEffect, useState, type ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';

export type AutoFitTextProps = Omit<TextProps, 'adjustsFontSizeToFit' | 'minimumFontScale'> & {
  /** Smallest scale vs style `fontSize` when shrinking (iOS/Android). Default 0.82 */
  minimumFontScale?: number;
  /**
   * When true (default), only enable shrink after layout detects the text would
   * clip at the current font size — avoids tiny type on short titles in tall flex boxes.
   */
  shrinkOnlyIfOverflow?: boolean;
};

function resolvedFontSize(style: StyleProp<TextStyle>): number {
  const flat = StyleSheet.flatten(style);
  const fs = flat?.fontSize;
  return typeof fs === 'number' && fs > 0 ? fs : 14;
}

function normalizedContent(children: ReactNode): string {
  if (children == null) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children).trim();
  if (Array.isArray(children)) return children.map(normalizedContent).join('').trim();
  return '';
}

function layoutLooksTruncated(
  content: string,
  lines: Array<{ text?: string }>,
  maxLines: number
): boolean {
  if (!content || lines.length < maxLines) return false;
  const visible = lines.map((l) => l.text ?? '').join('');
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const v = norm(visible);
  const c = norm(content);
  if (!c) return false;
  if (v.length < c.length - 1) return true;
  return lines.length >= maxLines && v.length < c.length;
}

/**
 * Shrinks type to fit available lines when needed; otherwise wraps at full size.
 * Uses native `adjustsFontSizeToFit` only after overflow is detected (not on web).
 */
export function AutoFitText({
  minimumFontScale = 0.82,
  shrinkOnlyIfOverflow = true,
  numberOfLines,
  ellipsizeMode,
  children,
  onTextLayout,
  style,
  ...rest
}: AutoFitTextProps) {
  const native = Platform.OS !== 'web';
  const content = normalizedContent(children);
  const maxLines = numberOfLines ?? 0;
  const [shrinkActive, setShrinkActive] = useState(false);

  useEffect(() => {
    setShrinkActive(false);
  }, [content, maxLines, resolvedFontSize(style)]);

  const useNativeShrink =
    native &&
    maxLines > 0 &&
    (!shrinkOnlyIfOverflow || shrinkActive);

  const handleTextLayout: TextProps['onTextLayout'] = (e) => {
    if (shrinkOnlyIfOverflow && native && maxLines > 0 && !shrinkActive) {
      const lines = e.nativeEvent.lines ?? [];
      if (layoutLooksTruncated(content, lines, maxLines)) {
        setShrinkActive(true);
      }
    }
    onTextLayout?.(e);
  };

  return (
    <Text
      {...rest}
      style={style}
      onTextLayout={handleTextLayout}
      numberOfLines={maxLines > 0 ? maxLines : undefined}
      adjustsFontSizeToFit={useNativeShrink}
      minimumFontScale={useNativeShrink ? minimumFontScale : undefined}
      ellipsizeMode={useNativeShrink ? 'clip' : ellipsizeMode}
      allowFontScaling={rest.allowFontScaling ?? false}
    >
      {children}
    </Text>
  );
}
