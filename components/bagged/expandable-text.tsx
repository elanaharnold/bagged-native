import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { MentionText } from '@/components/bagged/username-link';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

type ExpandableTextProps = Omit<TextProps, 'children' | 'numberOfLines'> & {
  children: string;
  numberOfLines?: number;
  quoted?: boolean;
  toggleStyle?: StyleProp<TextStyle>;
};

/** Truncated text with a tap-to-expand "more" / "less" toggle when content exceeds `numberOfLines`. */
export function ExpandableText({
  children,
  style,
  numberOfLines = 3,
  quoted = false,
  toggleStyle,
  ...textProps
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const text = String(children ?? '').trim();
  if (!text) return null;

  const display = quoted ? `\u201C${text}\u201D` : text;

  return (
    <View style={styles.wrap}>
      {!expanded ? (
        <Text
          style={[style, styles.measure]}
          onTextLayout={(e) => {
            setIsTruncated(e.nativeEvent.lines.length > numberOfLines);
          }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {display}
        </Text>
      ) : null}
      <Text
        {...textProps}
        style={style}
        numberOfLines={expanded ? undefined : numberOfLines}>
        {display}
      </Text>
      {isTruncated ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show less' : 'Show full text'}>
          <Text style={[styles.toggle, toggleStyle]}>{expanded ? 'less' : 'more'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type ExpandableMentionTextProps = {
  text: string;
  style?: StyleProp<TextStyle>;
  mentionStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  quoted?: boolean;
  toggleStyle?: StyleProp<TextStyle>;
  verifiedUsernames?: ReadonlySet<string>;
};

/** Note/comment body with @mentions — collapses long text, expandable via "more". */
export function ExpandableMentionText({
  text,
  style,
  mentionStyle,
  numberOfLines = 6,
  quoted = false,
  toggleStyle,
  verifiedUsernames,
}: ExpandableMentionTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const content = String(text ?? '').trim();
  if (!content) return null;
  const measureText = quoted ? `\u201C${content}\u201D` : content;

  return (
    <View style={styles.wrap}>
      {!expanded ? (
        <Text
          style={[style, styles.measure]}
          onTextLayout={(e) => {
            setIsTruncated(e.nativeEvent.lines.length > numberOfLines);
          }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {measureText}
        </Text>
      ) : null}
      <MentionText
        text={content}
        style={style}
        mentionStyle={mentionStyle}
        quoted={quoted}
        numberOfLines={expanded ? undefined : numberOfLines}
        verifiedUsernames={verifiedUsernames}
      />
      {isTruncated ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show less' : 'Show full comment'}>
          <Text style={[styles.toggle, toggleStyle]}>{expanded ? 'less' : 'more'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  measure: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
    zIndex: -1,
  },
  toggle: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.accent,
    marginTop: 4,
  },
});
